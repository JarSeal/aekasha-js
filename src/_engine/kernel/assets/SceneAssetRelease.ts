import { llog } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { deleteGeometry, getGeometryRegistry } from './Geometry';
import {
  deleteMaterial,
  deleteTexturesFromMaterial,
  getKeptTextures,
  getMaterialRegistry,
  isTextureUsedByAnyMaterial,
} from './Material';
import { deleteTexture, getTextureRegistry } from './Texture';
import { getCellOwnerKey, isSceneOwnerKey, releaseAssetOwners } from './AssetOwners';

/** Which owner keys a release drops (see AssetOwners) */
type OwnerMatcher = (owner: string) => boolean;

/** The import registry's release of the imports some owners hold, once anything was imported */
let releaseOwnedImports: ((isReleased: OwnerMatcher) => string[]) | null = null;

/**
 * Sets the release of the import manifests some owners hold: the import registry sets its own
 * on its first import, so this module doesn't name it and the glTF import path loads only with an
 * import.
 * @internal
 */
export const setSceneImportRelease = (release: (isReleased: OwnerMatcher) => string[]) => {
  releaseOwnedImports = release;
};

/**
 * The ids an asset release freed, by kind.
 * @internal
 */
export type ReleasedAssets = {
  /** Import manifests dropped. */
  imports: string[];
  /** Materials deleted. */
  materials: string[];
  /** Geometries deleted. */
  geometries: string[];
  /** Registered textures deleted. */
  textures: string[];
};

/** Drops the matched owners from every non-persistent asset, and frees the ones they alone held
 * that nothing uses. */
const releaseOwnedAssets = (isReleased: OwnerMatcher): ReleasedAssets => {
  const released: ReleasedAssets = {
    imports: releaseOwnedImports?.(isReleased) ?? [],
    materials: [],
    geometries: [],
    textures: [],
  };

  // Materials before textures: releasing a material can leave its textures unused
  for (const [id, entry] of Object.entries(getMaterialRegistry())) {
    if (entry.persistent || !releaseAssetOwners(entry.resource, isReleased)) continue;
    if (entry.count > 0) continue;
    deleteTexturesFromMaterial(entry.resource, { keepRegistered: true });
    deleteMaterial(id);
    released.materials.push(id);
  }

  for (const [id, entry] of Object.entries(getGeometryRegistry())) {
    // Gone already: released with an earlier one (a base geometry's LOD levels)
    if (!getGeometryRegistry()[id]) continue;
    if (entry.persistent || !releaseAssetOwners(entry.resource, isReleased)) continue;
    if (entry.count > 0) continue;
    deleteGeometry(id);
    released.geometries.push(id);
  }

  // A sky box texture's baked PMREM is disposed with it (SkyBox/SkyEnvironment.ts)
  const kept = getKeptTextures();
  for (const [id, entry] of Object.entries(getTextureRegistry())) {
    if (entry.persistent || !releaseAssetOwners(entry.resource, isReleased)) continue;
    if (kept.has(entry.resource) || isTextureUsedByAnyMaterial(entry.resource)) continue;
    deleteTexture(id);
    released.textures.push(id);
  }
  return released;
};

/**
 * How many assets a release freed.
 * @internal
 */
export const countReleasedAssets = (released: ReleasedAssets) =>
  released.imports.length +
  released.materials.length +
  released.geometries.length +
  released.textures.length;

/**
 * Releases the non-persistent assets a scene still holds (see AssetOwners), its streaming cells'
 * included, that nothing uses: its import manifests, its materials and geometries with ref count
 * 0, and its textures that no registered material uses and nothing keeps (`getKeptTextures`: a
 * `retainedTextures` scene hook's, such as the current sky box's, and the root scene's background
 * and environment). An asset another owner holds too only loses the scene's keys; one still in use
 * keeps them, for the scene's next release. SceneLoader runs this for the previous scene once the
 * next one has loaded, so whatever the next scene shares has been re-tagged to it (or has taken
 * refs) and stays.
 *
 * A released material disposes the texture clones it holds alone; registered textures are only
 * released here by owner, never through a material.
 * @internal
 * @param sceneId owner scene id
 * @returns the released ids by kind
 */
export const releaseSceneOwnedAssets = (sceneId: string) => {
  const released = releaseOwnedAssets((owner) => isSceneOwnerKey(owner, sceneId));
  if (IS_DEBUG_ENV) {
    const count = countReleasedAssets(released);
    if (count) llog(`[Assets] Released ${count} assets of scene "${sceneId}":`, released);
  }
  return released;
};

/**
 * Releases what a streaming cell's content holds (its owner key, `getCellOwnerKey`) as
 * {@link releaseSceneOwnedAssets} does a scene's: an asset another cell or the scene holds too
 * stays theirs, and one still in use stays the cell's until its next release (or its scene's).
 * Not logged (a cell unload is routine): the Streaming debug tab counts it.
 * @internal
 * @returns the released ids by kind
 */
export const releaseCellOwnedAssets = (sceneId: string, cellKey: number) => {
  const key = getCellOwnerKey(sceneId, cellKey);
  return releaseOwnedAssets((owner) => owner === key);
};
