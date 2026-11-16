// The terrain material's slope gate (p305 D5): a projecting layer that is planar on gentle slopes
// and projected on steep ones, mixed by `smoothstep(gate[0], gate[1], slope)`, with the projection
// in a dynamic branch, so a pixel under the gate's first slope pays for the planar tap alone. The
// branch is a TSL `If` inside a `Fn` that returns the layer's values as a struct var (one var read
// by every socket and sub-build, three's `normalView` pattern: `Fn(…).once()().toVar()`); the
// planar values are its initializer, the branch mixes the projection into them. `TRIPLANAR`'s top
// plane is the planar tap itself (its UV is planar world tiling's), so the branch samples two
// planes. Every tap in the branch samples with explicit gradients (the projection's): WGSL refuses
// implicit derivatives in non-uniform control flow.
import { float, Fn, If, int, mix, smoothstep, struct, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { AntiTilingContext } from './AntiTiling';
import {
  sampleProjected,
  type ProjectedLayer,
  type ProjectedSample,
  type ProjectionContext,
} from './Projection';
import type { TextureSetSample } from './SampleTextureSet';

/** The struct's members, each a value of the layer's sample (or its normal) */
const MEMBER_TYPES = {
  albedo: 'vec3',
  height: 'float',
  roughness: 'float',
  ao: 'float',
  normal: 'vec3',
  normalTS: 'vec3',
} as const;
type Member = keyof typeof MEMBER_TYPES;
/** The members the branch mixes the projection into (`normalTS` is the top plane's, read only) */
const MIXED: readonly Member[] = ['albedo', 'height', 'roughness', 'ao'];

/** A member's node in the struct var */
type StructVar = { get: (name: string) => Node<'float'> & { assign: (value: unknown) => void } };

/** A node as a var declared where this is called: in a `Fn`, before what follows */
const toVar = <T>(node: T): T => (node as unknown as { toVar: () => T }).toVar();

/** The zero a declared input of each type starts from */
const ZEROS = {
  float: () => float(0),
  int: () => int(0),
  vec2: () => vec2(0),
  vec3: () => vec3(0),
};

/**
 * A node as a var assigned where this is called (in a `Fn`, before what follows): three declares
 * a var that is only read where it's first used, which for the branch's inputs is in the branch,
 * so each is a zero var with an explicit assignment, which keeps its place in the statements
 */
const declare = <T>(node: T, type: keyof typeof ZEROS): T => {
  const variable = (ZEROS[type]() as unknown as { toVar: () => unknown }).toVar() as {
    assign: (value: unknown) => void;
  };
  variable.assign(node);
  return variable as unknown as T;
};

/**
 * The planar values the struct starts from: the planar tap's (the packing's only), its world
 * normal, and for `TRIPLANAR` with a normal map its tangent normal (the top plane's)
 */
const getPlanarValues = (layer: ProjectedLayer, planar: ProjectedSample) => {
  const { sample, normal } = planar;
  const values: Partial<Record<Member, Node<'float'> | Node<'vec3'>>> = {
    albedo: sample.albedo,
    height: sample.height,
  };
  if (sample.roughness) values.roughness = sample.roughness;
  if (sample.ao) values.ao = sample.ao;
  if (normal) values.normal = normal;
  if (layer.projection.mode === 'TRIPLANAR' && sample.normalTS) values.normalTS = sample.normalTS;
  return values;
};

/** A slot's layer or seed (an int node) as a declared var; an index stays a number */
const declareIndex = <T extends number | Node<'int'> | undefined>(index: T): T =>
  typeof index === 'object' ? declare(index, 'int') : index;

/**
 * What the branch reads from outside it, each a var assigned before it: a node the rest of the
 * graph shares (the position, the tile size, the macro patches, a slot's layer) first built in a
 * TSL `If` would be declared inside the branch (the sky box trap, its `CLAUDE.md`), and the
 * position's derivatives there are non-uniform (WGSL's uniformity rule)
 */
const declareInputs = (layer: ProjectedLayer, ctx: ProjectionContext) => {
  const { tiling, antiTilingContext } = layer;
  const antiTiling: AntiTilingContext = {
    ...antiTilingContext,
    viewDistance: declare(antiTilingContext.viewDistance, 'float'),
    patches: antiTilingContext.patches && declare(antiTilingContext.patches, 'float'),
    seed: declareIndex(antiTilingContext.seed),
    layer: declareIndex(antiTilingContext.layer),
  };
  const { turn } = tiling;
  return {
    layer: {
      ...layer,
      tiling: {
        tileSize: declare(tiling.tileSize, 'vec2'),
        turn: turn && { cos: declare(turn.cos, 'float'), sin: declare(turn.sin, 'float') },
      },
      strength: declare(layer.strength, 'float'),
      antiTilingContext: antiTiling,
    },
    ctx: {
      position: declare(ctx.position, 'vec3'),
      dpdx: declare(ctx.dpdx, 'vec3'),
      dpdy: declare(ctx.dpdy, 'vec3'),
      normal: declare(ctx.normal, 'vec3'),
      slope: ctx.slope,
    },
  };
};

/**
 * A slope gate's share of the projection: 0 under its first slope, 1 past its second, smooth
 * between.
 * @internal
 * @param gate the gate's slopes in degrees (`terrain_l<i>_slopeGate`)
 * @param slope the geometry's slope in degrees
 */
export const getSlopeGateShare = (gate: Node<'vec2'>, slope: Node<'float'>) =>
  smoothstep(gate.x, gate.y, slope) as unknown as Node<'float'>;

/**
 * A projecting layer with a slope gate (p305 D5): its planar tap under the gate's first slope, its
 * projection past the second, mixed between, the projection's taps sampled only where the share is
 * over 0 (a dynamic branch). Returns the layer's sample and normal as members of one struct var.
 * @internal
 * @param layer the layer's bundle, projection (with its `slopeGate` uniform), tiling, normal
 * strength and anti-tiling
 * @param planar the layer's planar tap (at its tiling UV, with its anti-tiling) and that tap's
 * normal through the planar frame, in world space (null without a normal map)
 * @param ctx the position, its derivatives, the geometry normal and its slope
 */
export const sampleSlopeGated = (
  layer: ProjectedLayer,
  planar: ProjectedSample,
  ctx: ProjectionContext
): ProjectedSample => {
  const gate = layer.projection.slopeGate;
  if (!gate) throw new Error('[terrain] sampleSlopeGated: the layer has no slope gate.');
  const values = getPlanarValues(layer, planar);
  const members = Object.keys(values) as Member[];
  const Gated = struct(Object.fromEntries(members.map((name) => [name, MEMBER_TYPES[name]])));
  const { packing, isAoBaked } = planar.sample;

  const gatedCall = Fn(() => {
    const share = toVar(getSlopeGateShare(gate, ctx.slope));
    const inputs = declareInputs(layer, ctx);
    // Three's struct takes its members by name too (the typings list the positional forms only)
    const out = toVar(Gated(values as never)) as unknown as StructVar;
    If(share.greaterThan(0), () => {
      const top: TextureSetSample | undefined =
        layer.projection.mode === 'TRIPLANAR'
          ? {
              packing,
              albedo: out.get('albedo') as unknown as Node<'vec3'>,
              normalTS: values.normalTS ? (out.get('normalTS') as unknown as Node<'vec3'>) : null,
              roughness: values.roughness ? out.get('roughness') : null,
              ao: values.ao ? out.get('ao') : null,
              isAoBaked,
              height: out.get('height'),
            }
          : undefined;
      const projected = sampleProjected(inputs.layer, inputs.ctx, top);
      // Each member reads its own planar value and writes it once: the order doesn't matter
      for (const name of MIXED) {
        const value = projected.sample[name as Exclude<Member, 'normal' | 'normalTS'>];
        if (values[name] && value) out.get(name).assign(mix(out.get(name), value, share));
      }
      if (values.normal && projected.normal) {
        const normal = out.get('normal') as unknown as Node<'vec3'>;
        out.get('normal').assign(mix(normal, projected.normal, share).normalize());
      }
    });
    return out;
  }).once()();
  const gated = toVar(gatedCall) as unknown as StructVar;

  const get = (name: Member) => (values[name] ? gated.get(name) : null);
  return {
    sample: {
      packing,
      albedo: get('albedo') as unknown as Node<'vec3'>,
      normalTS: null,
      roughness: get('roughness'),
      ao: get('ao'),
      isAoBaked,
      height: get('height') as Node<'float'>,
    },
    normal: get('normal') as unknown as Node<'vec3'> | null,
  };
};
