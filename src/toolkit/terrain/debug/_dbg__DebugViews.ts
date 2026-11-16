// The terrain material's debug views (p305 D10), debug env only: node code that replaces the
// surface's shading with a view of how it's built. Reached only through
// `loadTerrainDebugViewsAsync`' `import()` behind `IS_DEBUG_ENV` (`material/TerrainDebugViews.ts`),
// so a production build has none of it. Each view is unlit: the material's albedo black, its
// roughness 1, the view in `emissiveNode` (tone mapped like the scene).
import { clamp, float, floor, int, log2, mix, mod, select, textureSize, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node, TextureNode } from 'three/webgpu';

/** The debug views this module builds */
export type TerrainDebugView = 'TEXEL_DENSITY' | 'NORMALS' | 'WEIGHTS';

/** A layer as the texel density reads it */
export type TerrainDebugViewLayer = {
  /** The layer's tile size in metres (the set's `physicalSize` × the layer's tiling) */
  tileSize: Node<'vec2'>;
  /** The layer's colour slot texture (a set array's for `ARRAY`), whose width the density reads */
  colorTexture: TextureNode;
};

/** What a view reads of the surface */
export type TerrainDebugViewContext = {
  /** The tiling's coordinates in metres, before the tile size: the world's `(x, −z)` or the UV */
  coords: Node<'vec2'>;
  /** The layers, in order */
  layers: TerrainDebugViewLayer[];
  /** The layers' blend weights (summing to 1), or null for `SINGLE`'s one layer */
  weights: Node<'float'>[] | null;
  /** The shaded normal in world space */
  normal: Node<'vec3'>;
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

/** Each view's builder */
const VIEW_BUILDERS: Record<TerrainDebugView, (ctx: TerrainDebugViewContext) => Node<'vec3'>> = {
  TEXEL_DENSITY: buildTexelDensity,
  NORMALS: buildNormals,
  WEIGHTS: buildWeights,
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
