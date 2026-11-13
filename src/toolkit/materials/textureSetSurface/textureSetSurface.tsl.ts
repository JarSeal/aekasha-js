import { float, mix, positionWorld, uv, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import {
  bumpNormalView,
  sampleTextureSet,
  transformTangentNormalToView,
} from 'aekasha/toolkit/terrain';

/** `tiling`: world tiling from above (terrain), or the mesh's UV in metres (structures, walls). */
const TILINGS = ['WORLD_XZ', 'UV'] as const;
/** `minimalNormal`: `MINIMAL`'s normal, a bump from its height or the mesh's own. */
const MINIMAL_NORMALS = ['BUMP', 'FLAT'] as const;

/** `MINIMAL`'s roughness before `roughnessScale`: the packing has no roughness map. */
const MINIMAL_ROUGHNESS = 0.8;

const readDefine = <T extends string>(
  defines: Record<string, unknown> | undefined,
  key: string,
  values: readonly T[]
): T => {
  const value = defines?.[key] ?? values[0];
  if (!values.includes(value as T)) {
    throw new Error(
      `[textureSetSurface] Static define "${key}" is ${JSON.stringify(value)}: use ${values.map((v) => `"${v}"`).join(' or ')}.`
    );
  }
  return value as T;
};

/**
 * One texture set on a surface (p303 D7): the baseline every terrain technique (p305) is compared
 * against, the `terrainGallery`'s block material and the simplest structure material. No
 * anti-tiling, no splat, no triplanar.
 *
 * Input `surface`: a `{ "textureSet": id, "packing"? }` (the `textureSets()` feature), in any
 * packing; give a mesh its set with `matOverrides.inputs.surface`. The set's fields do what they
 * name: `physicalSize` metres a tile, `tint` × the albedo (linear), `normalStrength` × the normal's
 * slope, `roughnessScale` × the roughness (clamped to 1), `aoStrength` the `FULL` AO's influence
 * (`LITE` and `MINIMAL` have it baked into the albedo at pack time), `heightScale` the `MINIMAL`
 * bump's metres of relief. Metalness is 0.
 *
 * Static defines:
 * - `tiling`: `"WORLD_XZ"` (default) tiles at the world's `(x, −z)` over `physicalSize`, seen from
 *   above in the source's orientation, for terrain (a slope stretches by 1 / cos of its angle);
 *   `"UV"` tiles at the mesh's UV over `physicalSize`, for a mesh whose UVs are in metres (walls,
 *   structures).
 * - `minimalNormal`: `MINIMAL`'s normal, `"BUMP"` (default; from the height's screen-space
 *   derivatives, `heightScale` metres of relief) or `"FLAT"` (the mesh's).
 *
 * The normal map's tangent frame is the tiling UV's (`transformTangentNormalToView`), not the
 * mesh UV's that three's `normalMap()` uses: the relief is lit from the right side in either tiling.
 * Asset code: the material's generated loader imports it.
 * @internal
 */
export const setup = (
  inputs: { surface?: TextureSetInput },
  material: MeshStandardNodeMaterial,
  staticDefines?: Record<string, unknown>
) => {
  const set = inputs.surface;
  if (!set) {
    throw new Error(
      '[textureSetSurface] Missing input "surface": a { "textureSet": id } (the textureSets() feature).'
    );
  }
  const tiling = readDefine(staticDefines, 'tiling', TILINGS);
  const minimalNormal = readDefine(staticDefines, 'minimalNormal', MINIMAL_NORMALS);

  const physicalSize = set.physicalSize as unknown as Node<'vec2'>;
  const meshUv = uv() as unknown as Node<'vec2'>;
  const tileUv = (tiling === 'UV' ? meshUv : vec2(positionWorld.x, positionWorld.z.negate())).div(
    physicalSize
  ) as Node<'vec2'>;
  const surface = sampleTextureSet(set, tileUv);
  const strength = set.normalStrength as unknown as Node<'float'>;

  material.metalnessNode = float(0);
  material.colorNode = surface.albedo.mul(set.tint as unknown as Node<'vec3'>);
  const roughness = surface.roughness ?? float(MINIMAL_ROUGHNESS);
  material.roughnessNode = roughness.mul(set.roughnessScale as unknown as Node<'float'>).min(1);
  if (surface.ao) {
    material.aoNode = mix(float(1), surface.ao, set.aoStrength as unknown as Node<'float'>);
  }
  if (surface.normalTS) {
    const n = surface.normalTS;
    const scaled = vec3(n.xy.mul(strength), n.z) as unknown as Node<'vec3'>;
    material.normalNode = transformTangentNormalToView(scaled, tileUv);
  } else if (minimalNormal === 'BUMP') {
    const heightScale = set.heightScale as unknown as Node<'float'>;
    material.normalNode = bumpNormalView(
      surface.height.mul(heightScale).mul(strength) as Node<'float'>
    );
  }
};
