import { llog } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { deleteGeometry, getGeometryRegistry } from './Geometry';
import {
  deleteMaterial,
  deleteTexturesFromMaterial,
  getMaterialRegistry,
  isTextureUsedByAnyMaterial,
} from './Material';
import { deleteTexture, getTextureRegistry } from './Texture';
import { releaseImportsOwnedBy } from './import/ImportRegistry';
import { getSceneRetainedTextures } from '../scene/SceneHooks';
import { getAssetOwner } from './AssetOwners';

/**
 * Releases the non-persistent assets a scene still owns (see AssetOwners) that nothing uses:
 * its import manifests, its materials and geometries with ref count 0, and its textures that no
 * registered material uses and no feature retains (the current sky box's, a `retainedTextures`
 * scene hook). SceneLoader runs this for the previous scene
 * once the next one has loaded, so whatever the next scene shares has been re-tagged to it (or
 * has taken refs) and stays.
 *
 * A released material disposes the texture clones it holds alone; registered textures are only
 * released here by owner, never through a material.
 * @param sceneId owner scene id
 * @returns the released ids by kind
 */
export const releaseSceneOwnedAssets = (sceneId: string) => {
  const isOwned = (asset: object) => getAssetOwner(asset) === sceneId;
  const released = {
    imports: releaseImportsOwnedBy(sceneId),
    materials: [] as string[],
    geometries: [] as string[],
    textures: [] as string[],
  };

  // Materials before textures: releasing a material can leave its textures unused
  for (const [id, entry] of Object.entries(getMaterialRegistry())) {
    if (entry.persistent || entry.count > 0 || !isOwned(entry.resource)) continue;
    deleteTexturesFromMaterial(entry.resource, { keepRegistered: true });
    deleteMaterial(id);
    released.materials.push(id);
  }

  for (const [id, entry] of Object.entries(getGeometryRegistry())) {
    // Gone already: released with an earlier one (a base geometry's LOD levels)
    if (!getGeometryRegistry()[id]) continue;
    if (entry.persistent || entry.count > 0 || !isOwned(entry.resource)) continue;
    deleteGeometry(id);
    released.geometries.push(id);
  }

  // A sky box texture's baked PMREM is disposed with it (SkyBox/SkyEnvironment.ts)
  const retained = getSceneRetainedTextures();
  for (const [id, entry] of Object.entries(getTextureRegistry())) {
    if (entry.persistent || !isOwned(entry.resource)) continue;
    if (retained.has(entry.resource) || isTextureUsedByAnyMaterial(entry.resource)) continue;
    deleteTexture(id);
    released.textures.push(id);
  }

  if (IS_DEBUG_ENV) {
    const count = Object.values(released).reduce((sum, ids) => sum + ids.length, 0);
    if (count) llog(`[Assets] Released ${count} assets of scene "${sceneId}":`, released);
  }
  return released;
};
