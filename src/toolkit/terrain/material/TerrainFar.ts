// The terrain material's far surface (p305 D7): past the detail normals' fade (`distance.fade`'s
// end) the layers aren't sampled. A TSL `If` on the far surface's share skips them, inside a `Fn`
// that returns the surface as one struct var (three's `normalView` pattern, as the slope gate's):
// the far surface is the struct's initializer, from the layers' weights alone (`AVERAGE_COLOR`:
// each set's average colour, no fetch; `COLOR_MAP`: the colour map's sample), and the branch,
// where the share is under 1, builds the near surface and mixes the far one into it over the
// `farBlend` band. Every input the branch reads is a var assigned before it (`BranchInputs.ts`):
// the weights, the view distance, the macro's patches, the coordinates and the position with their
// derivatives (the near layers sample with them: an implicit-derivative sample in a branch is
// non-uniform), the geometry normal. The normal isn't mixed: the far surface starts where the
// detail normals have faded to the geometry's (the setup's `fadeDetailNormal`), and a `MINIMAL`
// bump is the caller's, after the branch, of the height the branch leaves.
import { dFdx, dFdy, float, Fn, If, mix, struct } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { TextureSetPacking } from 'aekasha/texturesets';
import { declareBranchInput as declare, toVar } from '../nodes/BranchInputs';
import { getFarShare, sumByWeights } from '../nodes/Distance';
import { normalizeWeights } from '../nodes/HeightBlend';
import { getSlope, type ProjectionContext } from '../nodes/Projection';
import { getSurfaceSpace } from '../nodes/SurfaceSpace';
import type { ResolvedTerrainDefine } from './TerrainDefine';
import type { LayerParams } from './TerrainInputs';
import {
  getLayerCoords,
  MINIMAL_ROUGHNESS,
  type LayerUniforms,
  type SharedCoords,
} from './TerrainLayers';

/**
 * The surface on either side of the branch: the normal in world space (null where the caller
 * bumps `bumpHeight` after the branch), the texture AO (null without: not `FULL`)
 * @internal
 */
export type BranchSurface = {
  albedo: Node<'vec3'>;
  roughness: Node<'float'>;
  normal: Node<'vec3'> | null;
  bumpHeight: Node<'float'> | null;
  ao: Node<'float'> | null;
};

/**
 * What the branch reads from outside it, each declared (a var assigned) before it
 * @internal
 */
export type FarBranchInputs = {
  /** The raw weights (null for `SINGLE`) */
  weights: Node<'float'>[] | null;
  viewDistance: Node<'float'>;
  /** The macro texture's sample (its variation, `DUAL_SCALE`'s patches), or null without a macro */
  macro: Node<'vec4'> | null;
  /** The colour map's sample (`DETAIL`, far `COLOR_MAP`), or null without */
  colorMap: Node<'vec3'> | null;
  /** The tiling's coordinates, their gradients and the world position's */
  shared: Required<SharedCoords>;
  /** The projections' position, its derivatives (the shared ones), the geometry normal, its slope */
  projection: ProjectionContext;
};

/**
 * The far surface's albedo and roughness from the layers' weights (raw, normalized linearly: the
 * height blend needs the layers' heights): `AVERAGE_COLOR` each set's average colour × its tints,
 * `COLOR_MAP` the colour map; the roughness `MINIMAL`'s × each layer's scales, capped at 1
 * @internal
 * @param define the define (its far mode)
 * @param layers each layer's set params and uniforms
 * @param inputs the declared weights and colour map
 */
export const getFarSurface = (
  define: ResolvedTerrainDefine,
  layers: { params: LayerParams; uniforms: LayerUniforms }[],
  inputs: Pick<FarBranchInputs, 'weights' | 'colorMap'>
) => {
  const weights = inputs.weights
    ? normalizeWeights(inputs.weights)
    : [float(1) as unknown as Node<'float'>];
  const roughness = sumByWeights(
    layers.map(
      ({ params, uniforms }) =>
        float(MINIMAL_ROUGHNESS)
          .mul(params.roughnessScale)
          .mul(uniforms.roughnessScale)
          .min(1) as unknown as Node<'float'>
    ),
    weights
  );
  if (define.far?.mode === 'COLOR_MAP') {
    const colorMap = inputs.colorMap;
    if (!colorMap) throw new Error('[terrain] The far COLOR_MAP surface has no colour map sample.');
    return { albedo: colorMap, roughness };
  }
  const albedo = sumByWeights(
    layers.map(({ params, uniforms }) => {
      if (!params.averageColor) {
        throw new Error("[terrain] The far AVERAGE_COLOR surface reads a set's average colour.");
      }
      return params.averageColor.mul(params.tint).mul(uniforms.tint) as Node<'vec3'>;
    }),
    weights
  );
  return { albedo, roughness };
};

/**
 * The coordinates, the position, their derivatives and the geometry normal the near layers read in
 * the branch, built before it (`FarBranchInputs`' `shared` and `projection`)
 * @internal
 */
export const createBranchCoords = (
  define: ResolvedTerrainDefine
): Pick<FarBranchInputs, 'shared' | 'projection'> => {
  const coords = getLayerCoords(define);
  const space = getSurfaceSpace(define.space);
  const positionGrad = {
    dx: dFdx(space.position) as unknown as Node<'vec3'>,
    dy: dFdy(space.position) as unknown as Node<'vec3'>,
  };
  const { normal } = space;
  return {
    shared: {
      coords,
      grad: {
        dx: dFdx(coords) as unknown as Node<'vec2'>,
        dy: dFdy(coords) as unknown as Node<'vec2'>,
      },
      positionGrad,
    },
    projection: {
      position: space.position,
      dpdx: positionGrad.dx,
      dpdy: positionGrad.dy,
      normal,
      slope: getSlope(normal),
    },
  };
};

/** The inputs declared: each a var assigned where this is called (in the `Fn`, before the `If`) */
const declareInputs = (inputs: FarBranchInputs): FarBranchInputs => {
  const { shared, projection } = inputs;
  const positionGrad = {
    dx: declare(shared.positionGrad.dx, 'vec3'),
    dy: declare(shared.positionGrad.dy, 'vec3'),
  };
  const normal = declare(projection.normal, 'vec3');
  return {
    weights: inputs.weights && inputs.weights.map((weight) => declare(weight, 'float')),
    viewDistance: declare(inputs.viewDistance, 'float'),
    macro: inputs.macro && declare(inputs.macro, 'vec4'),
    colorMap: inputs.colorMap && declare(inputs.colorMap, 'vec3'),
    shared: {
      coords: declare(shared.coords, 'vec2'),
      grad: { dx: declare(shared.grad.dx, 'vec2'), dy: declare(shared.grad.dy, 'vec2') },
      positionGrad,
    },
    projection: {
      position: declare(projection.position, 'vec3'),
      dpdx: positionGrad.dx,
      dpdy: positionGrad.dy,
      normal,
      slope: getSlope(normal),
    },
  };
};

/** A member's node in the struct var */
type StructVar = { get: (name: string) => Node<'float'> & { assign: (value: unknown) => void } };

/**
 * The surface's members of a packing: the normal unless `MINIMAL` (its bump the caller's, of the
 * height), the texture AO with `FULL`
 */
const getMembers = (packing: TextureSetPacking) => ({
  albedo: 'vec3',
  roughness: 'float',
  ...(packing === 'MINIMAL' ? { bumpHeight: 'float' } : { normal: 'vec3' }),
  ...(packing === 'FULL' ? { ao: 'float' } : {}),
});

/** What {@link buildFarBranch} branches between */
export type FarBranchProps = {
  /** The layers' one packing: the struct's members */
  packing: TextureSetPacking;
  /** Where the far surface starts (`distance.fade`'s end) and its band, metres (uniforms) */
  from: Node<'float'>;
  blend: Node<'float'>;
  /** What the branch reads from outside it, not yet declared */
  inputs: FarBranchInputs;
  /** The far surface from the declared inputs (`getFarSurface`) */
  getFar: (inputs: FarBranchInputs) => { albedo: Node<'vec3'>; roughness: Node<'float'> };
  /** The near surface from the declared inputs, built in the branch, its bump deferred */
  buildNear: (inputs: FarBranchInputs) => BranchSurface;
};

/**
 * The surface with a far mode (p305 D7): the far surface everywhere, and where its share is under
 * 1 (before the `farBlend` band's end) a dynamic branch that builds the near surface and mixes the
 * far one into it by the share; the layers aren't sampled past the band. Returns the surface's
 * members of one struct var.
 * @internal
 */
export const buildFarBranch = (props: FarBranchProps): BranchSurface => {
  const members = getMembers(props.packing);
  const names = Object.keys(members);
  const Surface = struct(members);

  const call = Fn(() => {
    const inputs = declareInputs(props.inputs);
    const share = toVar(getFarShare(inputs.viewDistance, props.from, props.blend));
    const far = props.getFar(inputs);
    const values: Record<string, unknown> = {
      albedo: far.albedo,
      roughness: far.roughness,
      normal: inputs.projection.normal,
      bumpHeight: float(0),
      ao: float(1),
    };
    // Three's struct takes its members by name too (the typings list the positional forms only)
    const out = toVar(
      Surface(Object.fromEntries(names.map((name) => [name, values[name]])) as never)
    ) as unknown as StructVar;
    If(share.lessThan(1), () => {
      const near = props.buildNear(inputs);
      // Each member reads its own far value and writes it once: the order doesn't matter
      out.get('albedo').assign(mix(near.albedo, out.get('albedo'), share));
      out.get('roughness').assign(mix(near.roughness, out.get('roughness'), share));
      if (near.ao && 'ao' in members) out.get('ao').assign(mix(near.ao, out.get('ao'), share));
      if (near.normal && 'normal' in members) out.get('normal').assign(near.normal);
      if (near.bumpHeight && 'bumpHeight' in members) {
        out.get('bumpHeight').assign(near.bumpHeight);
      }
    });
    return out;
  }).once()();
  const surface = toVar(call) as unknown as StructVar;
  const get = (name: string) => (name in members ? surface.get(name) : null);
  return {
    albedo: get('albedo') as unknown as Node<'vec3'>,
    roughness: get('roughness') as Node<'float'>,
    normal: get('normal') as unknown as Node<'vec3'> | null,
    bumpHeight: get('bumpHeight'),
    ao: get('ao'),
  };
};
