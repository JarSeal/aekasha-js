// The terrain material's debug views (p305 D10), debug env only: node code that replaces the
// surface's shading with a view of how it's built. Reached only through
// `loadTerrainDebugViewsAsync`' `import()` behind `IS_DEBUG_ENV` (`material/TerrainDebugViews.ts`),
// so a production build has none of it. Each view is unlit: the material's albedo black, its
// roughness 1, the view in `emissiveNode` (tone mapped like the scene).
import { clamp, float, floor, int, log2, mix, mod, select, textureSize, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node, TextureNode } from 'three/webgpu';

/** The debug views this module builds */
export type TerrainDebugView = 'TEXEL_DENSITY' | 'NORMALS';

/** What a view reads of the surface (the one layer's, for SINGLE) */
export type TerrainDebugViewContext = {
  /** The tiling's coordinates in metres, before the tile size: the world's `(x, −z)` or the UV */
  coords: Node<'vec2'>;
  /** The layer's tile size in metres (the set's `physicalSize` × the layer's tiling) */
  tileSize: Node<'vec2'>;
  /** The layer's colour slot texture, whose resolution the texel density reads */
  colorTexture: TextureNode;
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

/** The band colour of a density, a step per doubling */
const getBandColor = (density: Node<'float'>) => {
  const band = clamp(floor(log2(density)).sub(FIRST_BAND_LOG2 - 1), 0, DENSITY_BANDS.length - 1);
  let color = DENSITY_BANDS[DENSITY_BANDS.length - 1] as unknown as Node<'vec3'>;
  for (let i = DENSITY_BANDS.length - 2; i >= 0; i--) {
    color = select(band.lessThan(i + 1), DENSITY_BANDS[i], color) as unknown as Node<'vec3'>;
  }
  return color;
};

/**
 * `TEXEL_DENSITY`: the colour texture's texels a metre along U (its width over the tile's metres)
 * as a band colour, over a 1 m checker of the tiling's coordinates
 */
const buildTexelDensity = (ctx: TerrainDebugViewContext): Node<'vec3'> => {
  const size = textureSize(ctx.colorTexture, int(0)) as unknown as Node<'ivec2'>;
  const width = size.x.toFloat() as unknown as Node<'float'>;
  const density = width.div(ctx.tileSize.x) as Node<'float'>;
  const parity = mod(floor(ctx.coords.x).add(floor(ctx.coords.y)), 2);
  return getBandColor(density).mul(mix(float(0.55), float(1), parity)) as Node<'vec3'>;
};

/** `NORMALS`: the shaded normal in world space, `n × 0.5 + 0.5` */
const buildNormals = (ctx: TerrainDebugViewContext): Node<'vec3'> =>
  ctx.normal.mul(0.5).add(0.5) as Node<'vec3'>;

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
  material.emissiveNode = view === 'TEXEL_DENSITY' ? buildTexelDensity(ctx) : buildNormals(ctx);
};
