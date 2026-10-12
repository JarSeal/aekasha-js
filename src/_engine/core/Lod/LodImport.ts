// LOD's part of the imports (p607 D5): the `lod()` feature's import extension. The kernel's
// import (Import/ImportRegistry.ts) calls it to read a file's prebuilt chains and to start the
// chains an import's `lodChain` asks for.
import { lerror } from '../../utils/Logger';
import type { ImportExtension } from '../Import/ImportExtensions';
import type { ImportedAssetManifest } from '../Import/ImportTypes';
import { doesGeoExist } from '../Geometry';
import { deserializeLodChain, readGLTFLodChains, type ExtractedLodChain } from './LodChainGLTF';
import type { LodChainOptions } from './LodChainOptions';
import { trackLodChainRequest } from './LodChainRequests';

/** Starts the LOD chains an import asks for (`lodChain`, p347): one per rendered geometry that
 * has no chain yet and none pending. Not awaited by the import. LodChains is loaded on first use,
 * so apps that never ask for a chain don't download it. generateLodChain refuses (and warns about)
 * skinned and morph-target geometry. */
const requestLodChains = (manifest: ImportedAssetManifest, lodChain: true | LodChainOptions) => {
  const geometryIds = new Set<string>();
  for (const { geometryId, customProps } of manifest.geometries) {
    // Collider only: never rendered (spawnImportedAsset gives it no mesh)
    if (customProps.isPhysObj && !customProps.keepMesh) continue;
    geometryIds.add(geometryId);
  }
  if (!geometryIds.size) return;
  const opts = lodChain === true ? undefined : lodChain;
  const ready = import('./LodChains');
  ready.catch((err) =>
    lerror(`Import "${manifest.id}": could not load the LOD chain module.`, err)
  );
  for (const geometryId of geometryIds) {
    // Tracked from now, so a mesh with `lod: 'AUTO'` created before the module loads waits for it
    const settled = ready.then(({ generateLodChain, getLodChain, isLodChainPending }) => {
      // Released while the module loaded, or already chained (the first options win)
      if (!doesGeoExist(geometryId)) return;
      if (getLodChain(geometryId) || isLodChainPending(geometryId)) return;
      return generateLodChain(geometryId, opts).catch((err) =>
        lerror(`Import "${manifest.id}": LOD chain for geometry "${geometryId}" failed.`, err)
      );
    });
    trackLodChainRequest(geometryId, settled);
  }
};

/** Registers the LOD chains the asset pipeline built into the file (p347 Phase 3), whatever the
 * import's `lodChain` says: the file is shared by every use, and its levels were downloaded
 * anyway. Awaited, so a `lodChain` request right after the import finds them. */
const registerPrebuiltLodChains = async (
  importId: string,
  prebuilt: { geometryId: string; chain: ExtractedLodChain }[]
) => {
  try {
    const { registerPrebuiltLodChain } = await import('./LodChains');
    for (const { geometryId, chain } of prebuilt) registerPrebuiltLodChain(geometryId, chain);
  } catch (err) {
    lerror(`Import "${importId}": could not load the LOD chain module.`, err);
  }
};

/**
 * The LOD chains' import extension, which `lod()` registers.
 * @internal
 */
export const lodImportExtension: ImportExtension = {
  id: 'lod',
  lodChains: {
    read: readGLTFLodChains,
    deserialize: deserializeLodChain,
    registerPrebuilt: registerPrebuiltLodChains,
    request: requestLodChains,
  },
};
