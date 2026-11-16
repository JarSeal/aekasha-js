// The terrain material's debug views (p305 D10), debug env only: node code that replaces the
// surface's shading with a view of how it's built. Reached only through
// `loadTerrainDebugViewsAsync`' `import()` behind `IS_DEBUG_ENV` (`material/TerrainDebugViews.ts`),
// so a production build has none of it. Each view is unlit: the material's albedo black, its
// roughness 1, the view in `emissiveNode` (tone mapped like the scene).
import {
  clamp,
  float,
  floor,
  fract,
  int,
  log2,
  mix,
  mod,
  normalWorldGeometry,
  positionWorld,
  select,
  step,
  textureSize,
  vec3,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node, TextureNode } from 'three/webgpu';
import type { TextureSetPacking } from 'aekasha/texturesets';
import { getSplatMapCount, type ResolvedTerrainDefine } from '../material/TerrainDefine';
import { TERRAIN_PACKING_SLOTS } from '../material/TerrainStorage';
import type { AntiTilingNodes } from '../nodes/AntiTiling';
import { getProjectionWeights, getSlope, type ProjectionNodes } from '../nodes/Projection';
import { getSlopeGateShare } from '../nodes/SlopeGate';

/** The debug views this module builds */
export type TerrainDebugView =
  | 'TEXEL_DENSITY'
  | 'NORMALS'
  | 'WEIGHTS'
  | 'PROJECTION'
  | 'TAPS'
  | 'LAYER_COUNT';

/** A layer as the texel density reads it */
export type TerrainDebugViewLayer = {
  /** The layer's tile size in metres (the set's `physicalSize` × the layer's tiling) */
  tileSize: Node<'vec2'>;
  /** The layer's colour slot texture (a set array's for `ARRAY`), whose width the density reads */
  colorTexture: TextureNode;
  /** The layer's projection: its mode and uniforms (the sharpness, the slope gate) */
  projection: ProjectionNodes;
};

/**
 * What the graph samples, in order: each layer at its own index, or each slot (sparse sampling,
 * `DOMINANT`) at the layer kept there, with its anti-tiling's mode and its projection (a slot's
 * picked: its slope gate the kept layer's)
 */
export type TerrainDebugViewSampled = {
  antiTiling: AntiTilingNodes['mode'];
  projection: ProjectionNodes;
};

/** What a view reads of the surface */
export type TerrainDebugViewContext = {
  /** The tiling's coordinates in metres, before the tile size: the world's `(x, −z)` or the UV */
  coords: Node<'vec2'>;
  /** The layers, in order */
  layers: TerrainDebugViewLayer[];
  /** The layers' blend weights (summing to 1), or null for `SINGLE`'s one layer */
  weights: Node<'float'>[] | null;
  /** What the graph samples: the layers, or the slots (`TAPS` counts their fetches) */
  sampled: TerrainDebugViewSampled[];
  /**
   * The slots, or null for every layer at its own index: their count, and each layer's weight
   * before the cut (normalized linearly), which `LAYER_COUNT` counts
   */
  slots: { count: number; layerWeights: Node<'float'>[] } | null;
  /**
   * With a far mode, the far surface's share (1 past its band, where the material samples no
   * layer: `TAPS` counts the far surface's fetches there), else null
   */
  far: { share: Node<'float'> } | null;
  /** The shaded normal in world space */
  normal: Node<'vec3'>;
  /** The define as read (its tier's), for the fetches `TAPS` counts */
  define: ResolvedTerrainDefine;
  /** The packing the layers sample */
  packing: TextureSetPacking;
};

/**
 * The texel density bands, from the lowest: under 128 texels a metre, then 128, 256, 512, 1024 and
 * 2048 and over (a doubling each)
 */
const DENSITY_BANDS = [
  vec3(0.23, 0.3, 0.75),
  vec3(0.1, 0.65, 0.85),
  vec3(0.2, 0.7, 0.3),
  vec3(0.9, 0.85, 0.2),
  vec3(0.95, 0.5, 0.1),
  vec3(0.85, 0.15, 0.15),
];
/** log2 of the first band's upper edge (128 texels a metre) */
const FIRST_BAND_LOG2 = 7;

/** The band colour of a density's log2, a step per doubling */
const getBandColor = (log2Density: Node<'float'>) => {
  const band = clamp(floor(log2Density).sub(FIRST_BAND_LOG2 - 1), 0, DENSITY_BANDS.length - 1);
  let color = DENSITY_BANDS[DENSITY_BANDS.length - 1] as unknown as Node<'vec3'>;
  for (let i = DENSITY_BANDS.length - 2; i >= 0; i--) {
    color = select(band.lessThan(i + 1), DENSITY_BANDS[i], color) as unknown as Node<'vec3'>;
  }
  return color;
};

/**
 * The weights' sum of a value per layer (a float or a vec3), or the first layer's for `SINGLE`
 */
const weigh = <T extends Node<'float'> | Node<'vec3'>>(
  values: T[],
  weights: Node<'float'>[] | null
) =>
  weights
    ? values
        .map((value, i) => value.mul(weights[i]) as unknown as T)
        .reduce((total, value) => total.add(value) as unknown as T)
    : values[0];

/** A layer's texels a metre along U, as log2: its colour texture's width over the tile's metres */
const getLog2Density = (layer: TerrainDebugViewLayer) => {
  const size = textureSize(layer.colorTexture, int(0)) as unknown as Node<'ivec2'>;
  const width = size.x.toFloat() as unknown as Node<'float'>;
  return log2(width.div(layer.tileSize.x)) as unknown as Node<'float'>;
};

/** The 1 m checker's shade of the tiling's coordinates, 0.55 or 1 */
const getChecker = (ctx: TerrainDebugViewContext) =>
  mix(float(0.55), float(1), mod(floor(ctx.coords.x).add(floor(ctx.coords.y)), 2));

/**
 * `TEXEL_DENSITY`: the colour texture's texels a metre along U (its width over the tile's metres)
 * as a band colour, over a 1 m checker of the tiling's coordinates; with several layers the
 * weights' blend of each layer's log2 density, so a border shows the step between them
 */
const buildTexelDensity = (ctx: TerrainDebugViewContext): Node<'vec3'> => {
  const log2Density = weigh(ctx.layers.map(getLog2Density), ctx.weights);
  return getBandColor(log2Density).mul(getChecker(ctx)) as Node<'vec3'>;
};

/** The layers' false colours (`WEIGHTS`), one per layer up to 16 */
const LAYER_COLORS = [
  vec3(0.9, 0.9, 0.9),
  vec3(0.9, 0.2, 0.15),
  vec3(0.2, 0.75, 0.25),
  vec3(0.2, 0.4, 0.95),
  vec3(0.95, 0.85, 0.15),
  vec3(0.85, 0.25, 0.85),
  vec3(0.15, 0.85, 0.9),
  vec3(0.95, 0.55, 0.1),
  vec3(0.5, 0.25, 0.75),
  vec3(0.6, 0.9, 0.2),
  vec3(0.95, 0.6, 0.7),
  vec3(0.1, 0.5, 0.5),
  vec3(0.55, 0.35, 0.2),
  vec3(0.15, 0.15, 0.5),
  vec3(0.5, 0.5, 0.1),
  vec3(0.45, 0.1, 0.15),
] as unknown as Node<'vec3'>[];

/**
 * `WEIGHTS`: each layer's false colour (layer 0 white, 1 red, 2 green, 3 blue, 4 yellow, …) by its
 * blend weight, over the 1 m checker (lighter, so a weight's colour still reads)
 */
const buildWeights = (ctx: TerrainDebugViewContext): Node<'vec3'> => {
  const colors = ctx.layers.map((_, i) => LAYER_COLORS[i]);
  return weigh(colors, ctx.weights).mul(mix(0.8, 1, getChecker(ctx))) as Node<'vec3'>;
};

/** `NORMALS`: the shaded normal in world space, `n × 0.5 + 0.5` */
const buildNormals = (ctx: TerrainDebugViewContext): Node<'vec3'> =>
  ctx.normal.mul(0.5).add(0.5) as Node<'vec3'>;

/** The planar layers' colour in `PROJECTION`: all the top plane (Y, green) */
const PLANAR_COLOR = vec3(0, 1, 0) as unknown as Node<'vec3'>;
/** The slope gate band's stripes: their width in metres, and how far they lighten */
const BAND_STRIPE_METRES = 0.5;
const BAND_LIGHTEN = 0.6;

/**
 * A projection's gate share, or null without a gate (the geometry's slope, the gate's uniform; a
 * slot's picked gate)
 */
const getGateShare = ({ projection }: { projection: ProjectionNodes }) =>
  projection.mode !== 'PLANAR' && projection.slopeGate
    ? getSlopeGateShare(projection.slopeGate, getSlope(normalWorldGeometry as never))
    : null;

/** 1 where a share is strictly between 0 and 1 (the gate's band), else 0 */
const inBand = (share: Node<'float'>) =>
  step(1e-4, share).mul(step(share, 1 - 1e-4)) as unknown as Node<'float'>;

/**
 * `PROJECTION`: each layer's planes' weights as colour (X red, Y green, Z blue; a planar layer
 * green, a gated one mixed by its share), blended by the layers' weights, and the slope gates'
 * bands striped lighter (diagonal world stripes)
 */
const buildProjection = (ctx: TerrainDebugViewContext): Node<'vec3'> => {
  const normal = normalWorldGeometry as unknown as Node<'vec3'>;
  const shares = ctx.layers.map(getGateShare);
  const colors = ctx.layers.map(({ projection }, i) => {
    if (projection.mode === 'PLANAR') return PLANAR_COLOR;
    const weights = getProjectionWeights(projection, normal);
    const share = shares[i];
    return share ? (mix(PLANAR_COLOR, weights, share) as unknown as Node<'vec3'>) : weights;
  });
  const color = weigh(colors, ctx.weights);
  const zero = float(0) as unknown as Node<'float'>;
  const band = weigh(
    shares.map((share) => (share ? inBand(share) : zero)),
    ctx.weights
  );
  const p = positionWorld as unknown as Node<'vec3'>;
  const stripes = step(0.5, fract(p.x.add(p.y).add(p.z).div(BAND_STRIPE_METRES)));
  return mix(color, vec3(1), band.mul(stripes).mul(BAND_LIGHTEN)) as unknown as Node<'vec3'>;
};

/** The anti-tiling modes' taps (p305 D3) */
const ANTI_TILING_TAPS = { NONE: 1, DUAL_SCALE: 2, HEX: 3 } as const;

/**
 * A sampled layer's or slot's texture fetches: always (its planar tap's, or every plane's) and in
 * its slope gate's branch (the projection's planes but `TRIPLANAR`'s top, which is the planar
 * tap: 2 either way)
 */
const getSampledFetches = (ctx: TerrainDebugViewContext, sampled: TerrainDebugViewSampled) => {
  const tap = TERRAIN_PACKING_SLOTS[ctx.packing].length * ANTI_TILING_TAPS[sampled.antiTiling];
  const { projection } = sampled;
  if (projection.mode === 'PLANAR') return { always: tap, gated: 0 };
  if (projection.slopeGate) return { always: tap, gated: tap * 2 };
  return { always: tap * (projection.mode === 'TRIPLANAR' ? 3 : 2), gated: 0 };
};

/**
 * The material's own texture fetches beside the layers': the splat maps, the macro variation's
 * one, each rule's noise and the colour map's one (`DETAIL`, or the far `COLOR_MAP`: sampled
 * outside the far branch); three's lighting, shadows and environment not counted
 */
const getMaterialFetches = ({ define }: TerrainDebugViewContext) => {
  const rules = define.blend.source === 'SINGLE' ? [] : define.blend.rules;
  return (
    getSplatMapCount(define.blend, define.layers.length) +
    (define.macro ? 1 : 0) +
    rules.filter((rule) => rule.noise).length +
    (define.colorMap?.mode === 'DETAIL' || define.far?.mode === 'COLOR_MAP' ? 1 : 0)
  );
};

/**
 * The material's own texture fetches at a pixel, as `TAPS` counts them: those every pixel makes
 * (each sampled layer's or slot's taps, its packing slots × its anti-tiling's taps × its planes;
 * the splat maps, the macro, the rules' noise, the colour map), each slope gate's branch's, made where its
 * share is over 0 (a slot's: the kept layer's gate).
 * @internal
 */
export const estimateTerrainFetches = (ctx: TerrainDebugViewContext) => {
  const material = getMaterialFetches(ctx);
  let always = material;
  const gated: { share: Node<'float'>; fetches: number }[] = [];
  for (const sampled of ctx.sampled) {
    const fetches = getSampledFetches(ctx, sampled);
    always += fetches.always;
    const share = getGateShare(sampled);
    if (share && fetches.gated) gated.push({ share, fetches: fetches.gated });
  }
  return { always, gated, material };
};

/**
 * The fetch count's bands, each the highest count it takes: up to 2, 4, 8, 12, 16, 24 and 32, then
 * more (blue to red, then magenta)
 */
const TAP_BANDS = [2, 4, 8, 12, 16, 24, 32] as const;
const TAP_COLORS = [
  vec3(0.15, 0.2, 0.6),
  vec3(0.15, 0.45, 0.9),
  vec3(0.1, 0.75, 0.8),
  vec3(0.2, 0.75, 0.3),
  vec3(0.9, 0.85, 0.2),
  vec3(0.95, 0.5, 0.1),
  vec3(0.85, 0.15, 0.15),
  vec3(0.85, 0.2, 0.85),
] as unknown as Node<'vec3'>[];

/**
 * `TAPS`: the material's own texture fetches at the pixel (p301 §6's estimate made visible): every
 * sampled layer's or slot's taps (its packing slots × its anti-tiling's taps × its planes), its
 * slope gate's branch's where the share is over 0, the splat maps, the macro, the rules' noise and
 * the colour map; past a far mode's band, those last alone (the far surface samples no layer). In
 * bands (up to 2 dark blue, 4 blue, 8 cyan, 12 green, 16 yellow, 24 orange, 32 red, more magenta)
 * over the faint 1 m checker. A layer at its own index is sampled whatever its weight; sparse
 * sampling samples its slots alone.
 */
const buildTaps = (ctx: TerrainDebugViewContext): Node<'vec3'> => {
  const { always, gated, material } = estimateTerrainFetches(ctx);
  const near = gated.reduce(
    (count, { share, fetches }) => count.add(step(1e-4, share).mul(fetches)) as Node<'float'>,
    float(always) as unknown as Node<'float'>
  );
  const total = ctx.far
    ? (select(ctx.far.share.greaterThanEqual(1), float(material), near) as unknown as Node<'float'>)
    : near;
  let color = TAP_COLORS[TAP_COLORS.length - 1];
  for (let i = TAP_BANDS.length - 1; i >= 0; i--) {
    color = select(
      total.lessThanEqual(TAP_BANDS[i]),
      TAP_COLORS[i],
      color
    ) as unknown as Node<'vec3'>;
  }
  return color.mul(mix(0.8, 1, getChecker(ctx))) as Node<'vec3'>;
};

/** The weight over which `LAYER_COUNT` counts a layer: one step of an 8-bit weight */
const LAYER_WEIGHT_FLOOR = 1 / 255;
/** `LAYER_COUNT`'s colours: 1 layer, 2, 3, 4, then 5 or more */
const LAYER_COUNT_COLORS = [
  vec3(0.15, 0.2, 0.6),
  vec3(0.2, 0.7, 0.3),
  vec3(0.9, 0.85, 0.2),
  vec3(0.95, 0.5, 0.1),
  vec3(0.85, 0.15, 0.15),
] as unknown as Node<'vec3'>[];
/** The stripes where the slots drop a layer: their width in metres, and how far they lighten */
const DROP_STRIPE_METRES = 0.5;
const DROP_LIGHTEN = 0.6;

/**
 * `LAYER_COUNT`: how many layers weigh over 1/255 at the pixel (the final weights; in slots the
 * weights before the cut, normalized linearly), 1 dark blue, 2 green, 3 yellow, 4 orange, 5 or
 * more red, over the faint 1 m checker; in slots, lighter diagonal stripes where more layers weigh
 * in than the slots keep (the cut drops their weight: where sparse sampling can pop)
 */
const buildLayerCount = (ctx: TerrainDebugViewContext): Node<'vec3'> => {
  const weights = ctx.slots?.layerWeights ?? ctx.weights;
  const one = float(1) as unknown as Node<'float'>;
  const count = weights
    ? weights.reduce(
        (sum, weight) => sum.add(step(LAYER_WEIGHT_FLOOR, weight)) as unknown as Node<'float'>,
        float(0) as unknown as Node<'float'>
      )
    : one;
  let color = LAYER_COUNT_COLORS[LAYER_COUNT_COLORS.length - 1];
  for (let i = LAYER_COUNT_COLORS.length - 2; i >= 0; i--) {
    color = select(
      count.lessThan(i + 1.5),
      LAYER_COUNT_COLORS[i],
      color
    ) as unknown as Node<'vec3'>;
  }
  const shaded = color.mul(mix(0.8, 1, getChecker(ctx))) as Node<'vec3'>;
  if (!ctx.slots) return shaded;
  const dropped = step(ctx.slots.count + 0.5, count);
  const p = positionWorld as unknown as Node<'vec3'>;
  const stripes = step(0.5, fract(p.x.sub(p.z).div(DROP_STRIPE_METRES)));
  return mix(shaded, vec3(1), dropped.mul(stripes).mul(DROP_LIGHTEN)) as unknown as Node<'vec3'>;
};

/** Each view's builder */
const VIEW_BUILDERS: Record<TerrainDebugView, (ctx: TerrainDebugViewContext) => Node<'vec3'>> = {
  TEXEL_DENSITY: buildTexelDensity,
  NORMALS: buildNormals,
  WEIGHTS: buildWeights,
  PROJECTION: buildProjection,
  TAPS: buildTaps,
  LAYER_COUNT: buildLayerCount,
};

/**
 * Replaces the material's surface with a debug view: unlit, the view in `emissiveNode`.
 * @internal
 */
export const applyTerrainDebugView = (
  material: MeshStandardNodeMaterial,
  view: TerrainDebugView,
  ctx: TerrainDebugViewContext
) => {
  material.colorNode = vec3(0);
  material.roughnessNode = float(1);
  material.aoNode = null;
  material.emissiveNode = VIEW_BUILDERS[view](ctx);
};
