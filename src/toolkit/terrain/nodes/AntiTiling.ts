// The terrain material's anti-tiling (p305 D3): a texture set sampled at a layer's tiling UV in one
// of three ways, each a build-time branch: `NONE` one tap; `DUAL_SCALE` a second tap at a larger,
// turned scale, mixed in with the view distance and the macro texture's patches; `HEX` Mikkelsen's
// practical hex tiling ("Practical Real-Time Hex-Tiling", JCGT 2022): three taps on a hex lattice,
// each offset and turned at random, sampled with the UV's own (turned) gradients so the mip level
// never jumps at a hex's border, blended by weights that keep the contrast (height-weighted, then
// a gain). The taps' tangent-space normals are turned back into the layer's UV frame, so the
// result is one `TextureSetSample` the layer's frame takes as it takes a plain one.
import { dFdx, dFdy, float, mix, select, smoothstep, step, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { TextureSetArrayInput, TextureSetInput } from 'aekasha/texturesets';
import { hashCell12, hashCell22, toSeedNode } from './noise/Hash';
import { sampleTextureSet, type TextureSetSample } from './SampleTextureSet';

/** A layer's anti-tiling as the nodes its graph reads: the mode, and its uniforms */
export type AntiTilingNodes =
  | { mode: 'NONE' }
  | {
      mode: 'DUAL_SCALE';
      /** The second tap's scale of the UV, under 1 */
      farScale: Node<'float'>;
      /** The view distances (metres) over which the second tap's share grows */
      distance: Node<'vec2'>;
    }
  | {
      mode: 'HEX';
      /** Mikkelsen's gain, 0.05..0.95 (0.5 changes nothing) */
      contrast: Node<'float'>;
      /** How far a tap may turn, 0..1 of a full turn either way */
      rotation: Node<'float'>;
    };

/** What the modes read besides the UV */
export type AntiTilingContext = {
  /** The view distance in metres (`DUAL_SCALE`) */
  viewDistance: Node<'float'>;
  /** The macro texture's patches (its B), 0..1, or null without a macro texture (`DUAL_SCALE`) */
  patches: Node<'float'> | null;
  /** The layer's own seed, so two layers of one set don't share their hexes (`HEX`) */
  seed: number;
  /** The layer of a `{ textureSetArray }` bundle, or undefined for a `{ textureSet }` one */
  layer?: number;
  /**
   * The UV's screen-space gradients, for a UV that isn't continuous (a projection's plane chosen
   * per pixel) or one sampled in a branch: every tap samples with them (turned and scaled as its
   * UV is), never its own derivatives. Undefined: the taps' own (`HEX`: the UV's)
   */
  grad?: TapGradients;
};

/** A UV's screen-space gradients */
type TapGradients = { dx: Node<'vec2'>; dy: Node<'vec2'> };

/** The second tap's turn (D3: 37°, so its texels never line up with the first's) and offset */
const FAR_ANGLE = (37 * Math.PI) / 180;
const FAR_COS = Math.cos(FAR_ANGLE);
const FAR_SIN = Math.sin(FAR_ANGLE);
const FAR_OFFSET = [0.37, 0.61] as const;
/** The macro patches' level cut into a mask (macroNoise's B is 0.5 along the borders) */
const PATCH_EDGES = [0.3, 0.7] as const;

/** Mikkelsen's lattice: 2√3 triangle rows a tile, so a hex spans about half a tile */
const HEX_RATE = 2 * Math.sqrt(3);
/** The skew of the triangle grid (√3 / 3 and 2 / √3) and back (√3 / 2) */
const SKEW_X = 0.57735027;
const SKEW_Y = 1.15470054;
const UNSKEW_Y = 0.8660254;
/** How much a tap's height sways its weight (Mikkelsen's fall-off contrast) */
const HEX_HEIGHT_INFLUENCE = 0.6;

/** A tap: its sample, its weight, and the turn its normal is turned back by (cos, sin), or none */
type Tap = {
  sample: TextureSetSample;
  weight: Node<'float'>;
  turn: { cos: Node<'float'> | number; sin: Node<'float'> | number } | null;
};

/** `v` turned counter-clockwise by the angle of `cos` and `sin` */
const turn2 = (v: Node<'vec2'>, cos: Node<'float'> | number, sin: Node<'float'> | number) =>
  vec2(v.x.mul(cos).sub(v.y.mul(sin)), v.x.mul(sin).add(v.y.mul(cos))) as unknown as Node<'vec2'>;

const negate = (n: Node<'float'> | number) => (typeof n === 'number' ? -n : n.negate());

/**
 * A tap's tangent-space normal in the layer's UV frame: the tap's UV is the layer's turned by an
 * angle, so its normal turns back by it
 */
const getTapNormal = (tap: Tap): Node<'vec3'> | null => {
  const n = tap.sample.normalTS;
  if (!n || !tap.turn) return n;
  const xy = turn2(n.xy as Node<'vec2'>, tap.turn.cos, negate(tap.turn.sin));
  return vec3(xy, n.z) as unknown as Node<'vec3'>;
};

/**
 * The weighted sum of a value the taps all have (or none have). Typed as a vec3 for the maths;
 * a float's sum is a float (`asFloat`)
 */
const sumOf = (
  taps: Tap[],
  pick: (tap: Tap) => Node<'float'> | Node<'vec3'> | null
): Node<'vec3'> | null => {
  let sum: Node<'vec3'> | null = null;
  for (const tap of taps) {
    const value = pick(tap) as unknown as Node<'vec3'> | null;
    if (!value) return null;
    const weighted = value.mul(tap.weight) as Node<'vec3'>;
    sum = sum ? (sum.add(weighted) as Node<'vec3'>) : weighted;
  }
  return sum;
};

const asFloat = (node: Node<'vec3'> | null) => node as unknown as Node<'float'> | null;

/** The taps blended by their weights (which sum to 1): one sample, its normal unit length */
const blendTaps = (taps: Tap[]): TextureSetSample => {
  const [{ sample }] = taps;
  const normal = sumOf(taps, getTapNormal);
  return {
    packing: sample.packing,
    albedo: sumOf(taps, (tap) => tap.sample.albedo) as Node<'vec3'>,
    normalTS: normal ? (normal.normalize() as Node<'vec3'>) : null,
    roughness: asFloat(sumOf(taps, (tap) => tap.sample.roughness)),
    ao: asFloat(sumOf(taps, (tap) => tap.sample.ao)),
    isAoBaked: sample.isAoBaked,
    height: asFloat(sumOf(taps, (tap) => tap.sample.height)) as Node<'float'>,
  };
};

/**
 * `DUAL_SCALE`: the UV's tap and one at the UV × `farScale`, turned 37° and offset. The second's
 * share grows from the near share to the far one over the distance range; with the macro patches,
 * the near share runs 0..0.5 and the far 0.5..1 with them, else 0 and 0.5.
 */
const sampleDualScale = (
  bundle: TextureSetInput | TextureSetArrayInput,
  uv: Node<'vec2'>,
  nodes: Extract<AntiTilingNodes, { mode: 'DUAL_SCALE' }>,
  ctx: AntiTilingContext
) => {
  const farUv = turn2(uv.mul(nodes.farScale) as Node<'vec2'>, FAR_COS, FAR_SIN).add(
    vec2(...FAR_OFFSET)
  ) as Node<'vec2'>;
  const byDistance = smoothstep(nodes.distance.x, nodes.distance.y, ctx.viewDistance);
  const patch = ctx.patches
    ? (smoothstep(PATCH_EDGES[0], PATCH_EDGES[1], ctx.patches).mul(0.5) as Node<'float'>)
    : float(0);
  const share = mix(patch, patch.add(0.5), byDistance) as Node<'float'>;
  const { grad } = ctx;
  const farGrad = grad && {
    dx: turn2(grad.dx.mul(nodes.farScale) as Node<'vec2'>, FAR_COS, FAR_SIN),
    dy: turn2(grad.dy.mul(nodes.farScale) as Node<'vec2'>, FAR_COS, FAR_SIN),
  };
  return blendTaps([
    {
      sample: sampleTextureSet(bundle, uv, { layer: ctx.layer, grad }),
      weight: float(1).sub(share) as Node<'float'>,
      turn: null,
    },
    {
      sample: sampleTextureSet(bundle, farUv, { layer: ctx.layer, grad: farGrad }),
      weight: share,
      turn: { cos: FAR_COS, sin: FAR_SIN },
    },
  ]);
};

/** A hex vertex's centre in the UV (the triangle grid's vertex unskewed) */
const getHexCentre = (vertex: Node<'vec2'>) =>
  vec2(vertex.x.add(vertex.y.mul(0.5)), vertex.y.mul(UNSKEW_Y)).div(
    HEX_RATE
  ) as unknown as Node<'vec2'>;

/**
 * The triangle of the hex lattice's grid around the UV: its three vertices (whole-numbered, in the
 * skewed grid) and their barycentric weights (Heitz and Neyret's `TriangleGrid`, branch-free)
 */
const getHexTriangle = (uv: Node<'vec2'>) => {
  const p = uv.mul(HEX_RATE) as Node<'vec2'>;
  const skewed = vec2(p.x.sub(p.y.mul(SKEW_X)), p.y.mul(SKEW_Y)) as unknown as Node<'vec2'>;
  const base = skewed.floor() as Node<'vec2'>;
  const f = skewed.fract() as Node<'vec2'>;
  const z = float(1).sub(f.x).sub(f.y);
  // The upper triangle of the cell (z ≤ 0) or the lower
  const s = step(0, z.negate()) as Node<'float'>;
  const s2 = s.mul(2).sub(1);
  const notS = float(1).sub(s);
  return [
    { vertex: base.add(vec2(s, s)), weight: z.negate().mul(s2) },
    { vertex: base.add(vec2(s, notS)), weight: s.sub(f.y.mul(s2)) },
    { vertex: base.add(vec2(notS, s)), weight: s.sub(f.x.mul(s2)) },
  ] as { vertex: Node<'vec2'>; weight: Node<'float'> }[];
};

/** `w⁷` without `pow`: Mikkelsen's exponent, which narrows each tap to its hex's middle */
const pow7 = (w: Node<'float'>) => {
  const w2 = w.mul(w);
  return w2.mul(w2).mul(w2).mul(w) as Node<'float'>;
};

/**
 * Mikkelsen's `Gain3` of one weight: over 0.5 contrast raises it towards 1, under lowers it
 * towards 0; `k` is `−log2(1 − r)` (`r` 0.5: k 1, no change). The weight is clamped first: one
 * normalized to a hair over 1 (a hex's middle, where one tap has it all) gave `pow` a negative
 * base, a NaN, a black pixel.
 */
const gain = (weight: Node<'float'>, k: Node<'float'>) => {
  const w = weight.saturate() as Node<'float'>;
  return select(
    w.lessThan(0.5),
    w.mul(2).pow(k).mul(0.5),
    float(1).sub(float(2).sub(w.mul(2)).pow(k).mul(0.5))
  ) as unknown as Node<'float'>;
};

/** Weights over their sum */
const normalizeWeights = (weights: Node<'float'>[]) => {
  const sum = weights[0].add(weights[1]).add(weights[2]);
  return weights.map((w) => w.div(sum) as Node<'float'>);
};

/**
 * `HEX`: the three taps of the hex lattice's triangle around the UV, each tap's UV turned about
 * its hex's centre (at random up to `rotation` of a full turn either way) and offset at random,
 * sampled with the UV's gradients turned alike (no mip seams at the hexes' borders). Weights:
 * the barycentrics⁷ × the tap's height (0.6 of its influence), normalized, through the gain.
 */
const sampleHex = (
  bundle: TextureSetInput | TextureSetArrayInput,
  uv: Node<'vec2'>,
  nodes: Extract<AntiTilingNodes, { mode: 'HEX' }>,
  ctx: AntiTilingContext
) => {
  // The UV's own gradients (or the given ones), before anything turns it: continuous across the
  // hexes
  const dx = ctx.grad?.dx ?? (dFdx(uv) as unknown as Node<'vec2'>);
  const dy = ctx.grad?.dy ?? (dFdy(uv) as unknown as Node<'vec2'>);
  const offsetSeed = toSeedNode(ctx.seed * 2);
  const angleSeed = toSeedNode(ctx.seed * 2 + 1);
  const taps = getHexTriangle(uv).map(({ vertex, weight }) => {
    const angle = hashCell12(vertex, angleSeed)
      .sub(0.5)
      .mul(2 * Math.PI)
      .mul(nodes.rotation) as Node<'float'>;
    const cos = angle.cos() as Node<'float'>;
    const sin = angle.sin() as Node<'float'>;
    const centre = getHexCentre(vertex);
    const tapUv = turn2(uv.sub(centre) as Node<'vec2'>, cos, sin)
      .add(centre)
      .add(hashCell22(vertex, offsetSeed)) as Node<'vec2'>;
    const sample = sampleTextureSet(bundle, tapUv, {
      layer: ctx.layer,
      grad: { dx: turn2(dx, cos, sin), dy: turn2(dy, cos, sin) },
    });
    const heightInfluence = mix(float(1), sample.height, HEX_HEIGHT_INFLUENCE);
    return { sample, weight: pow7(weight).mul(heightInfluence) as Node<'float'>, cos, sin };
  });
  const k = float(1).sub(nodes.contrast).log2().negate() as Node<'float'>;
  const weights = normalizeWeights(
    normalizeWeights(taps.map((tap) => tap.weight)).map((w) => gain(w, k))
  );
  return blendTaps(
    taps.map(({ sample, cos, sin }, i) => ({ sample, weight: weights[i], turn: { cos, sin } }))
  );
};

/**
 * A texture set sampled at a layer's tiling UV with the layer's anti-tiling (p305 D3): `NONE` one
 * tap, `DUAL_SCALE` two, `HEX` three (each tap samples every slot of the packing). The taps blend
 * into one sample whose tangent-space normal is in the UV's frame, so the layer turns it into the
 * world as a plain sample's.
 * @internal
 * @param bundle the layer's `{ textureSet }` bundle, or the `{ textureSetArray }` bundle with
 * `ctx.layer`
 * @param uv the layer's tiling UV, in tiles (continuous: `HEX` takes its gradients)
 * @param nodes the mode and its uniforms
 * @param ctx the view distance, the macro patches, the layer's seed, its array layer and the UV's
 * gradients when given
 */
export const sampleAntiTiled = (
  bundle: TextureSetInput | TextureSetArrayInput,
  uv: Node<'vec2'>,
  nodes: AntiTilingNodes,
  ctx: AntiTilingContext
): TextureSetSample => {
  if (nodes.mode === 'DUAL_SCALE') return sampleDualScale(bundle, uv, nodes, ctx);
  if (nodes.mode === 'HEX') return sampleHex(bundle, uv, nodes, ctx);
  return sampleTextureSet(bundle, uv, { layer: ctx.layer, grad: ctx.grad });
};
