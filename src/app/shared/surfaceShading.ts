// How the app's scenes draw a procedural surface (`proceduralSurfaces`, the `terrainGallery`'s
// Procedural row). A baked one: its packing's textures decoded by the toolkit's `sampleTextureSet`
// (a baked surface is channel for channel an imported set), tiled over the generator's physical
// size, shaded as the toolkit's `textureSetSurface` shades a set (the normal map in its UV's frame,
// `MINIMAL`'s bump from its height). A live one (`createLiveSurface`): the generator's graph itself
// at the same tiling.
import { float, positionWorld, texture, uv, vec2 } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node, Texture } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import {
  bumpNormalView,
  sampleTextureSet,
  transformTangentNormalToView,
  type BakedSurface,
  type LiveSurface,
} from 'aekasha/toolkit/terrain';

/** `MINIMAL` has no roughness: `textureSetSurface`'s stand-in. */
const MINIMAL_ROUGHNESS = 0.8;

/** Where a surface's tiles lie, as `textureSetSurface`'s `tiling`: over the world's `(x, −z)` seen
 * from above (terrain), or over the mesh's UV in metres (a wall). */
export type SurfaceTiling = 'WORLD_XZ' | 'UV';

/**
 * The point in tiles for a tiling: the world's `(x, −z)` or the mesh's UV (in metres), over the
 * tile's size. A live surface's `uv` option for a wall (its default is the world's).
 * @param physicalSize the metres one tile covers
 * @param tiling where the tiles lie
 * @returns the point in tiles
 */
export const getSurfaceTileUv = (physicalSize: readonly [number, number], tiling: SurfaceTiling) =>
  (tiling === 'UV' ? uv() : vec2(positionWorld.x, positionWorld.z.negate())).div(
    vec2(physicalSize[0], physicalSize[1])
  ) as unknown as Node<'vec2'>;

/**
 * Sets a material's nodes to draw a baked surface (again for another bake: it rebuilds).
 * @param material the block's material
 * @param surface the baked surface, whose generator's physical facts it was baked with
 * @param tiling where its tiles lie (default the world's, from above)
 */
export const shadeBakedSurface = (
  material: MeshStandardNodeMaterial,
  surface: BakedSurface,
  tiling: SurfaceTiling = 'WORLD_XZ'
) => {
  const { physicalSize, heightScale } = surface.generator;
  const tileUv = getSurfaceTileUv(physicalSize, tiling);
  // The bundle a `{ textureSet }` input would give: the packing's slots as texture nodes
  const bundle = Object.fromEntries(
    Object.entries(surface.bake.textures).map(([slot, baked]) => [slot, texture(baked as Texture)])
  ) as unknown as TextureSetInput;
  const sample = sampleTextureSet(bundle, tileUv);
  material.colorNode = sample.albedo;
  material.metalnessNode = float(0);
  material.roughnessNode = sample.roughness ?? float(MINIMAL_ROUGHNESS);
  material.aoNode = sample.ao;
  material.normalNode = sample.normalTS
    ? transformTangentNormalToView(sample.normalTS, tileUv)
    : bumpNormalView(sample.height.mul(heightScale) as Node<'float'>);
  material.needsUpdate = true;
};

/**
 * Sets a material's nodes to draw a live surface (`createLiveSurface`, at its default world tiling
 * or the `uv` it was given): its normal the taps' in the surface's UV frame when it has one, else a
 * bump from its height in metres; its AO when it has one.
 * @param material the block's material
 * @param live what `createLiveSurface` returned
 */
export const shadeLiveSurface = (material: MeshStandardNodeMaterial, live: LiveSurface) => {
  material.colorNode = live.albedo;
  material.metalnessNode = float(0);
  material.roughnessNode = live.roughness;
  material.aoNode = live.ao;
  material.normalNode = live.normalTS
    ? transformTangentNormalToView(live.normalTS, live.uv)
    : bumpNormalView(live.height.mul(live.heightScale) as Node<'float'>);
  material.needsUpdate = true;
};
