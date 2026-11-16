// The terrain material's projections (p305 D5): a layer's texture set sampled on world planes
// instead of the tiling's coordinates alone, for faces planar tiling stretches (cliffs). Each
// plane's UV is the world position on two axes over the layer's tile size, turned by its rotation:
// X `(−z, y)`, Y `(x, −z)` (planar world tiling's, so the top plane samples what `PLANAR` does) and
// Z `(x, y)`. No sign flips by facing: a face turned away from an axis sees that plane's texture
// mirrored, and its normal stays right, since each plane's normal goes through its own UV's frame.
// `TRIPLANAR` samples the three planes weighted by the facing (`|n|^sharpness`); `BIPLANAR`
// (Quilez, "Biplanar Mapping") the two the surface faces most, chosen per pixel. Every tap samples
// with the world position's gradients on its plane (`.grad()`): a plane chosen per pixel has no
// continuous UV, and the slope gate's branch can't take derivatives. The planes' normal maps meet
// the geometry normal per Golus ("Normal Mapping for a Triplanar Shader": whiteout, UDN or RNM)
// in the plane's frame, then go to world space and blend by the weights. A slope gate (planar on
// gentle slopes, the projection in a branch on steep ones) is `SlopeGate.ts`'.
import {
  acos,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  max,
  normalWorldGeometry,
  positionWorld,
  select,
  step,
  vec2,
  vec3,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { TextureSetArrayInput, TextureSetInput } from 'aekasha/texturesets';
import type { TerrainProjectionDefine } from '../material/TerrainDefine';
import { sampleAntiTiled, type AntiTilingContext, type AntiTilingNodes } from './AntiTiling';
import type { TextureSetSample } from './SampleTextureSet';

/** A projecting mode's normal blend */
type NormalBlend = Exclude<TerrainProjectionDefine, { mode: 'PLANAR' }>['normalBlend'];

/** A layer's projection as the nodes its graph reads: the mode, its uniforms and normal blend */
export type ProjectionNodes =
  | { mode: 'PLANAR' }
  | {
      mode: 'BIPLANAR' | 'TRIPLANAR';
      /** `TRIPLANAR`: the exponent on the facing; `BIPLANAR`: Quilez's k */
      sharpness: Node<'float'>;
      normalBlend: NormalBlend;
      /** The slopes in degrees over which the projection fades in over planar, or null */
      slopeGate: Node<'vec2'> | null;
    };

/** A projecting layer's nodes: what {@link sampleProjected} samples and how */
export type ProjectedLayer = {
  /** The layer's `{ textureSet }` bundle, or the `{ textureSetArray }` one with `antiTiling.layer` */
  bundle: TextureSetInput | TextureSetArrayInput;
  projection: Exclude<ProjectionNodes, { mode: 'PLANAR' }>;
  tiling: ProjectionTiling;
  /** The normal's strength (the set's × the layer's) */
  strength: Node<'float'>;
  /** The layer's anti-tiling and its context (the view distance, the patches, the seed, the layer) */
  antiTiling: AntiTilingNodes;
  antiTilingContext: AntiTilingContext;
};

/** What every projected layer reads of the surface, built once for all of them */
export type ProjectionContext = {
  position: Node<'vec3'>;
  /** The position's screen-space derivatives: each plane's UV gradients */
  dpdx: Node<'vec3'>;
  dpdy: Node<'vec3'>;
  /** The geometry's world normal: the facing, and the base the normal maps meet */
  normal: Node<'vec3'>;
  /** The geometry's slope in degrees, 0 flat (the slope gate's) */
  slope: Node<'float'>;
};

/** A layer's tiling as the planes take it: the tile size and the rotation's turn */
export type ProjectionTiling = {
  /** The set's `physicalSize` × the layer's tiling, metres */
  tileSize: Node<'vec2'>;
  /** The rotation's cosine and sine, or null for none */
  turn: { cos: Node<'float'>; sin: Node<'float'> } | null;
};

/** A plane: its UV and gradients in tiles, its world directions, the normal's part on its axis */
type Plane = {
  uv: Node<'vec2'>;
  grad: { dx: Node<'vec2'>; dy: Node<'vec2'> };
  /** The world directions of the UV's U and V (turned with the tiling) */
  u: Node<'vec3'>;
  v: Node<'vec3'>;
  axis: Node<'vec3'>;
  /** The geometry normal's component on the axis, signed */
  facing: Node<'float'>;
};

/** A plane's axes before the turn: U, V and the axis, and a vector's (U, V) on it */
type PlaneAxes = {
  u: [number, number, number];
  v: [number, number, number];
  axis: [number, number, number];
  flat: (p: Node<'vec3'>) => Node<'vec2'>;
};

/** The three planes: X `(−z, y)`, Y `(x, −z)` (planar world tiling's), Z `(x, y)` */
const PLANE_AXES: PlaneAxes[] = [
  {
    u: [0, 0, -1],
    v: [0, 1, 0],
    axis: [1, 0, 0],
    flat: (p) => vec2(p.z.negate(), p.y) as unknown as Node<'vec2'>,
  },
  {
    u: [1, 0, 0],
    v: [0, 0, -1],
    axis: [0, 1, 0],
    flat: (p) => vec2(p.x, p.z.negate()) as unknown as Node<'vec2'>,
  },
  {
    u: [1, 0, 0],
    v: [0, 1, 0],
    axis: [0, 0, 1],
    flat: (p) => vec2(p.x, p.y) as unknown as Node<'vec2'>,
  },
];

/** Quilez's floor for the facing weights: 1/√3, where the major axis's facing can't go under */
const BIPLANAR_FLOOR = 0.5773;
/** Quilez's k at which the remapped weights take no exponent */
const BIPLANAR_UNIT_SHARPNESS = 8;
const RAD_TO_DEG = 180 / Math.PI;
/** The top plane's index (Y): its UV is planar world tiling's */
const TOP_PLANE = 1;

/**
 * A normal's slope in degrees, 0 flat, 90 a vertical face.
 * @internal
 */
export const getSlope = (normal: Node<'vec3'>) =>
  acos(clamp(normal.y, -1, 1)).mul(RAD_TO_DEG) as unknown as Node<'float'>;

/**
 * What the projected layers read of the surface (the position, its derivatives, the geometry
 * normal and its slope), built once before them.
 * @internal
 */
export const createProjectionContext = (): ProjectionContext => {
  const normal = normalWorldGeometry as unknown as Node<'vec3'>;
  return {
    position: positionWorld as unknown as Node<'vec3'>,
    dpdx: dFdx(positionWorld) as unknown as Node<'vec3'>,
    dpdy: dFdy(positionWorld) as unknown as Node<'vec3'>,
    normal,
    slope: getSlope(normal),
  };
};

/** A vector of plane metres into the layer's tiles: over the tile size, turned with the tiling */
const toTiles = (v: Node<'vec2'>, tiling: ProjectionTiling) => {
  const t = v.div(tiling.tileSize) as Node<'vec2'>;
  if (!tiling.turn) return t;
  const { cos, sin } = tiling.turn;
  return vec2(
    cos.mul(t.x).add(sin.mul(t.y)),
    cos.mul(t.y).sub(sin.mul(t.x))
  ) as unknown as Node<'vec2'>;
};

/** A plane of the layer: its UV, its gradients, its directions turned with the tiling */
const getPlane = (axes: PlaneAxes, tiling: ProjectionTiling, ctx: ProjectionContext): Plane => {
  const u = vec3(...axes.u) as unknown as Node<'vec3'>;
  const v = vec3(...axes.v) as unknown as Node<'vec3'>;
  const axis = vec3(...axes.axis) as unknown as Node<'vec3'>;
  const turn = tiling.turn;
  return {
    uv: toTiles(axes.flat(ctx.position), tiling),
    grad: {
      dx: toTiles(axes.flat(ctx.dpdx), tiling),
      dy: toTiles(axes.flat(ctx.dpdy), tiling),
    },
    // The UV turned by +a reads the texture along U cos + V sin, V cos − U sin
    u: turn ? (u.mul(turn.cos).add(v.mul(turn.sin)) as Node<'vec3'>) : u,
    v: turn ? (v.mul(turn.cos).sub(u.mul(turn.sin)) as Node<'vec3'>) : v,
    axis,
    facing: dot(ctx.normal, axis) as unknown as Node<'float'>,
  };
};

/**
 * A plane's tangent-space normal (its slopes × the strength) met with the geometry normal in the
 * plane's frame (U, V, the axis on the facing's side), by the blend, into world space; not
 * normalized (the planes' sum is)
 */
const getPlaneNormal = (
  normalTS: Node<'vec3'>,
  strength: Node<'float'>,
  plane: Plane,
  normal: Node<'vec3'>,
  blend: NormalBlend
): Node<'vec3'> => {
  const t = vec3(normalTS.xy.mul(strength), normalTS.z) as unknown as Node<'vec3'>;
  // −1 or 1 by arithmetic: a `select` builds an `if` per plane
  const side = step(0, plane.facing).mul(2).sub(1);
  const w = plane.axis.mul(side) as Node<'vec3'>;
  const base = vec3(dot(normal, plane.u), dot(normal, plane.v), plane.facing.abs());
  let r: Node<'vec3'>;
  if (blend === 'UDN') {
    r = vec3(t.xy.add(base.xy), base.z) as unknown as Node<'vec3'>;
  } else if (blend === 'RNM') {
    const n1 = base.add(vec3(0, 0, 1));
    const n2 = t.mul(vec3(-1, -1, 1));
    r = n1.mul(dot(n1, n2)).div(n1.z).sub(n2) as unknown as Node<'vec3'>;
  } else {
    r = vec3(t.xy.add(base.xy), t.z.abs().mul(base.z)) as unknown as Node<'vec3'>;
  }
  return plane.u.mul(r.x).add(plane.v.mul(r.y)).add(w.mul(r.z)) as Node<'vec3'>;
};

/** `TRIPLANAR`'s weights: the facing `|n|^sharpness`, over their sum */
const getTriplanarWeights = (normal: Node<'vec3'>, sharpness: Node<'float'>) => {
  const w = normal.abs().pow(vec3(sharpness)) as Node<'vec3'>;
  const sum = w.x.add(w.y).add(w.z);
  return [w.x.div(sum), w.y.div(sum), w.z.div(sum)] as Node<'float'>[];
};

/** A plane field picked by a plane's index (0 X, 1 Y, 2 Z) */
const pick = <T extends Node<'vec2'> | Node<'vec3'> | Node<'float'>>(
  index: Node<'float'>,
  values: T[]
) =>
  select(index.equal(0), values[0], select(index.equal(1), values[1], values[2])) as unknown as T;

/** The plane of an index (0 X, 1 Y, 2 Z), each field picked per pixel */
const pickPlane = (index: Node<'float'>, planes: Plane[]): Plane => ({
  uv: pick(
    index,
    planes.map((plane) => plane.uv)
  ),
  grad: {
    dx: pick(
      index,
      planes.map((plane) => plane.grad.dx)
    ),
    dy: pick(
      index,
      planes.map((plane) => plane.grad.dy)
    ),
  },
  u: pick(
    index,
    planes.map((plane) => plane.u)
  ),
  v: pick(
    index,
    planes.map((plane) => plane.v)
  ),
  axis: pick(
    index,
    planes.map((plane) => plane.axis)
  ),
  facing: pick(
    index,
    planes.map((plane) => plane.facing)
  ),
});

/**
 * `BIPLANAR`'s two axes (Quilez): the one the surface faces most and the median one, by index (0
 * X, 1 Y, 2 Z), chosen per pixel, and their weights: the facing over 1/√3 remapped to 0..1,
 * `^(k / 8)`, over their sum
 */
const getBiplanarAxes = (normal: Node<'vec3'>, sharpness: Node<'float'>) => {
  const n = normal.abs() as Node<'vec3'>;
  const major = select(
    n.x.greaterThan(n.y).and(n.x.greaterThan(n.z)),
    float(0),
    select(n.y.greaterThan(n.z), float(1), float(2))
  ) as unknown as Node<'float'>;
  const minor = select(
    n.x.lessThan(n.y).and(n.x.lessThan(n.z)),
    float(0),
    select(n.y.lessThan(n.z), float(1), float(2))
  ) as unknown as Node<'float'>;
  const median = float(3).sub(major).sub(minor) as Node<'float'>;
  const facings = [n.x, n.y, n.z] as Node<'float'>[];
  const exponent = sharpness.div(BIPLANAR_UNIT_SHARPNESS);
  const weigh = (index: Node<'float'>) =>
    clamp(
      pick(index, facings)
        .sub(BIPLANAR_FLOOR)
        .div(1 - BIPLANAR_FLOOR),
      0,
      1
    ).pow(exponent) as unknown as Node<'float'>;
  const weights = [weigh(major), weigh(median)];
  // Both 0 only where the facing is the diagonal's on every axis
  const sum = max(weights[0].add(weights[1]), 1e-5);
  return {
    axes: [major, median],
    weights: weights.map((weight) => weight.div(sum) as Node<'float'>),
  };
};

/** `BIPLANAR`'s two planes, chosen per pixel, and their weights */
const getBiplanarPlanes = (planes: Plane[], normal: Node<'vec3'>, sharpness: Node<'float'>) => {
  const { axes, weights } = getBiplanarAxes(normal, sharpness);
  return { planes: axes.map((axis) => pickPlane(axis, planes)), weights };
};

/**
 * A projecting mode's weight on each axis's plane (X, Y, Z), summing to 1: `TRIPLANAR`'s three,
 * `BIPLANAR`'s two on their axes. The debug views' (`PROJECTION`).
 * @internal
 * @param projection the projecting mode and its sharpness
 * @param normal the geometry's world normal
 */
export const getProjectionWeights = (
  projection: Exclude<ProjectionNodes, { mode: 'PLANAR' }>,
  normal: Node<'vec3'>
): Node<'vec3'> => {
  if (projection.mode === 'TRIPLANAR') {
    const [x, y, z] = getTriplanarWeights(normal, projection.sharpness);
    return vec3(x, y, z) as unknown as Node<'vec3'>;
  }
  const { axes, weights } = getBiplanarAxes(normal, projection.sharpness);
  // An axis's one-hot: 1 on the component its index names
  const onAxis = (index: Node<'float'>) =>
    step(
      vec3(index)
        .sub(vec3(0, 1, 2))
        .abs(),
      vec3(0.5)
    ) as unknown as Node<'vec3'>;
  return onAxis(axes[0]).mul(weights[0]).add(onAxis(axes[1]).mul(weights[1])) as Node<'vec3'>;
};

/** A value of every sample (or of none) by the weights, which sum to 1 */
const sumOf = <T extends Node<'float'> | Node<'vec3'>>(
  samples: TextureSetSample[],
  weights: Node<'float'>[],
  pickValue: (sample: TextureSetSample) => T | null
): T | null => {
  const values = samples.map(pickValue);
  if (values.some((value) => !value)) return null;
  return (values as T[])
    .map((value, i) => value.mul(weights[i]) as unknown as T)
    .reduce((total, value) => total.add(value) as unknown as T);
};

/** A layer's sample and its world normal (null without a normal map: the layer bumps the height) */
export type ProjectedSample = { sample: TextureSetSample; normal: Node<'vec3'> | null };

/**
 * A layer's texture set sampled with its projection (p305 D5): its anti-tiling's taps on each
 * plane (`TRIPLANAR` three, `BIPLANAR` the two chosen per pixel), every tap with the plane's
 * gradients, blended by the planes' weights into one sample (its height the planes' blend, for the
 * height blend) and, when the packing has a normal map, the planes' normals met with the geometry
 * normal by the normal blend, in world space, unit length. `MINIMAL` (no normal map) returns no
 * normal: the layer bumps the blended height.
 * @internal
 * @param layer the layer's bundle, projection, tiling, normal strength and anti-tiling
 * @param ctx the position, its derivatives and the geometry normal ({@link createProjectionContext})
 * @param top `TRIPLANAR`'s top plane already sampled: the layer's planar tap, whose UV is the top
 * plane's (its tangent normal in the layer's UV frame); undefined samples it
 */
export const sampleProjected = (
  layer: ProjectedLayer,
  ctx: ProjectionContext,
  top?: TextureSetSample
): ProjectedSample => {
  const { projection, strength } = layer;
  const allPlanes = PLANE_AXES.map((axes) => getPlane(axes, layer.tiling, ctx));
  const { planes, weights } =
    projection.mode === 'TRIPLANAR'
      ? { planes: allPlanes, weights: getTriplanarWeights(ctx.normal, projection.sharpness) }
      : getBiplanarPlanes(allPlanes, ctx.normal, projection.sharpness);
  const samples = planes.map((plane, i) =>
    top && projection.mode === 'TRIPLANAR' && i === TOP_PLANE
      ? top
      : sampleAntiTiled(layer.bundle, plane.uv, layer.antiTiling, {
          ...layer.antiTilingContext,
          grad: plane.grad,
        })
  );
  const [first] = samples;
  // One packing: every plane's sample has a normal map or none has
  const normal = first.normalTS
    ? (planes
        .map((plane, i) => {
          const normalTS = samples[i].normalTS as Node<'vec3'>;
          const blend = projection.normalBlend;
          return getPlaneNormal(normalTS, strength, plane, ctx.normal, blend).mul(weights[i]);
        })
        .reduce((total, value) => total.add(value) as Node<'vec3'>)
        .normalize() as Node<'vec3'>)
    : null;
  return {
    sample: {
      packing: first.packing,
      albedo: sumOf(samples, weights, (sample) => sample.albedo) as Node<'vec3'>,
      normalTS: null,
      roughness: sumOf(samples, weights, (sample) => sample.roughness),
      ao: sumOf(samples, weights, (sample) => sample.ao),
      isAoBaked: first.isAoBaked,
      height: sumOf(samples, weights, (sample) => sample.height) as Node<'float'>,
    },
    normal,
  };
};
