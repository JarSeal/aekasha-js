// How the procedural surfaces scene draws a baked surface: its packing's textures decoded by the
// toolkit's `sampleTextureSet` (a baked surface is channel for channel an imported set), tiled in
// world space over the generator's physical size, shaded as the toolkit's `textureSetSurface`
// shades a set (the normal map in its UV's frame, `MINIMAL`'s bump from its height); and a live
// surface (section 4): the generator's graph itself at the same world tiling.
import { float, positionWorld, texture, vec2 } from 'three/tsl';
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

/**
 * Sets a material's nodes to draw a baked surface (again on a packing switch: it rebuilds).
 * @param material the block's material
 * @param surface the baked surface, whose generator's physical facts it was baked with
 */
export const shadeBakedSurface = (material: MeshStandardNodeMaterial, surface: BakedSurface) => {
  const { physicalSize, heightScale } = surface.generator;
  const tileUv = vec2(positionWorld.x, positionWorld.z.negate()).div(
    vec2(physicalSize[0], physicalSize[1])
  ) as unknown as Node<'vec2'>;
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
 * Sets a material's nodes to draw a live surface (`createLiveSurface` at its default world
 * tiling): its normal the taps' in the surface's UV frame when it has one, else a bump from its
 * height in metres; its AO when it has one.
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
