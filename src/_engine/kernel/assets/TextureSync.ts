// The synchronous texture loaders (D12 of p613): `loadTexture` and `loadTextures` return at once
// and fill their textures when the files have loaded, with three's TextureLoader on the main
// thread. Deprecated: `loadTextureAsync` (Texture.ts) loads the asset pipeline's outputs, in the
// assets worker where configured, and its `throwOnError` reaches the caller.
import * as THREE from 'three/webgpu';
import { lerror } from '../../utils/Logger';
import { isHDR, isKTX2 } from './AssetFiles';
import { retagAssetOwner } from './AssetOwners';
import { resolveFileUrl } from './AssetUrl';
import {
  getNoFileTexture,
  getTexture,
  importHDRLoader,
  saveLoadedTexture,
  saveTexture,
  setTextureOpts,
  type TexOpts,
} from './Texture';

/** Copies what HDRLoader's load sets on its texture (DataTextureLoader's `_applyTexData` with
 * HDRLoader's parse result, three r186) onto `target`: its format, mapping and mipmaps stay. */
const applyLoadedHDRTexture = (target: THREE.DataTexture, loaded: THREE.DataTexture) => {
  target.image = loaded.image;
  target.wrapS = loaded.wrapS;
  target.wrapT = loaded.wrapT;
  target.magFilter = loaded.magFilter;
  target.minFilter = loaded.minFilter;
  target.anisotropy = loaded.anisotropy;
  target.colorSpace = loaded.colorSpace;
  target.flipY = loaded.flipY;
  target.type = loaded.type;
  target.generateMipmaps = loaded.generateMipmaps;
  target.needsUpdate = true;
};

/**
 * Creates and registers a texture for the synchronous loaders (`loadTexture`, `loadTextures`):
 * from `fileName` with TextureLoader (or HDRLoader for an `.hdr` file), filled when the file has
 * loaded, or without a file an empty texture (or one from `texOpts.image`). A KTX2 file can't load
 * synchronously: it gets the empty texture. The texture is registered under `id` (its uuid
 * without one); an id already registered returns that texture.
 *
 * `throwOnError` throws only for what's known before the load starts (a KTX2 file): a failed
 * load ends after this has returned, so it's logged and the texture stays empty.
 */
const createTexture = (
  id?: string,
  fileName?: string,
  texOpts?: TexOpts,
  throwOnError?: boolean,
  userData?: Record<string, unknown>,
  debugData?: { name?: string; description?: string },
  isPersistent?: boolean
) => {
  const cached = id ? getTexture(id) : undefined;
  if (cached) {
    retagAssetOwner(cached);
    return cached;
  }

  if (!fileName) {
    const texture = setTextureOpts(getNoFileTexture(texOpts), undefined, userData, debugData);
    return saveTexture(texture, id, isPersistent);
  }

  if (isKTX2(fileName)) {
    const errorMsg = `KTX2 textures can only be loaded with loadTextureAsync (id: "${id}", fileName: "${fileName}")`;
    lerror(errorMsg);
    if (throwOnError) throw new Error(errorMsg);
    const texture = setTextureOpts(getNoFileTexture(texOpts), undefined, userData, debugData);
    return saveTexture(texture, id, isPersistent);
  }

  // Ends after the texture was returned: a throw here would be uncaught, never the caller's
  const onError = (err: unknown) =>
    lerror(`Could not load texture in createTexture (id: "${id}", fileName: "${fileName}")`, err);

  if (isHDR(fileName)) {
    // The texture HDRLoader's load would return, filled the same way when the file has loaded:
    // the loader is imported first
    const texture = new THREE.DataTexture();
    setTextureOpts(texture, texOpts, userData, debugData);
    importHDRLoader().then(
      (HDRLoader) =>
        new HDRLoader()
          .setDataType(THREE.HalfFloatType)
          .load(
            resolveFileUrl(fileName),
            (loaded) => applyLoadedHDRTexture(texture, loaded),
            undefined,
            onError
          ),
      onError
    );
    return saveTexture(texture, id, isPersistent);
  }

  const texture = new THREE.TextureLoader().load(
    resolveFileUrl(fileName),
    undefined,
    undefined,
    onError
  );
  setTextureOpts(texture, texOpts, userData, debugData);
  return saveTexture(texture, id, isPersistent);
};

/**
 * Loads textures with three's TextureLoader on the main thread and registers each when it has
 * loaded (under its `id`, else its uuid). Returns at once; `updateStatusFn` reports the textures
 * loaded so far (once before the loads, then once per texture, a failed one included), so the
 * last call has `loadedCount === totalCount`. A KTX2 file can't load this way.
 * @param texData the textures to load: each one's id, file name, options, persistence, userData
 * and debug name
 * @param updateStatusFn called with the textures loaded so far by id, their count and the total
 * @param onErrorAction what a texture that can't load gets: `NO_TEXTURE` (the default) none,
 * `EMPTY_TEXTURE` an empty texture registered under its id, `THROW_ERROR` a throw for what's known
 * before the loads start (a KTX2 file); a load that fails later can't reach the caller, so it's
 * logged and counted like `NO_TEXTURE`
 * @throws when `texData` is empty
 * @deprecated Use `loadTextureAsync` (await the files in parallel with `Promise.all`). Removed in
 * engine 6.0.0.
 */
export const loadTextures = (
  texData: {
    id?: string;
    fileName?: string;
    texOpts?: TexOpts;
    isPersistent?: boolean;
    userData?: Record<string, unknown>;
    debugData?: { name?: string; description?: string };
  }[],
  updateStatusFn?: (
    loadedTextures: { [id: string]: THREE.Texture },
    loadedCount: number,
    totalCount: number
  ) => void,
  onErrorAction?: 'NO_TEXTURE' | 'EMPTY_TEXTURE' | 'THROW_ERROR'
) => {
  const totalCount = texData.length;
  let loadedCount = 0;
  if (!totalCount) {
    throw new Error('Could not load textures, "texData" array was empty.');
  }

  const batchTextures: { [id: string]: THREE.Texture } = {};

  const onOneDone = () => {
    loadedCount++;
    if (updateStatusFn) updateStatusFn(batchTextures, loadedCount, totalCount);
  };

  const loadOneBatchTexture = (index: number) => {
    const { id, fileName, texOpts, isPersistent, userData, debugData } = texData[index];
    // An empty texture, registered (under the texture's uuid without an id)
    const addEmptyTexture = () => {
      const texture = createTexture(
        id,
        undefined,
        texOpts,
        false,
        userData,
        debugData,
        isPersistent
      );
      batchTextures[texture.userData.id as string] = texture;
    };

    const cached = id ? getTexture(id) : undefined;
    if (cached) {
      retagAssetOwner(cached);
      batchTextures[id!] = cached;
      onOneDone();
      return;
    }

    if (fileName && isKTX2(fileName)) {
      lerror(
        `KTX2 textures can only be loaded with loadTextureAsync, skipped in loadTextures (id: ${id}, fileName: ${fileName})`
      );
      if (onErrorAction === 'THROW_ERROR') {
        throw new Error(`KTX2 texture in loadTextures (id: ${id}, fileName: ${fileName})`);
      }
      if (onErrorAction === 'EMPTY_TEXTURE') addEmptyTexture();
      onOneDone();
    } else if (fileName) {
      new THREE.TextureLoader().load(
        resolveFileUrl(fileName),
        (loaded) => {
          setTextureOpts(loaded, texOpts, userData, debugData);
          // A parallel load of the same id may have registered first: that one is used
          const texture = saveLoadedTexture(loaded, id, isPersistent);
          batchTextures[texture.userData.id as string] = texture;
          onOneDone();
        },
        undefined,
        (err) => {
          // Ends after loadTextures has returned: a throw here would be uncaught
          lerror(`Could not load texture in loadTextures (id: ${id}, fileName: ${fileName})`, err);
          if (onErrorAction === 'EMPTY_TEXTURE') addEmptyTexture();
          onOneDone();
        }
      );
    } else {
      addEmptyTexture();
      onOneDone();
    }
  };

  // Call once before loading
  if (updateStatusFn) updateStatusFn(batchTextures, loadedCount, totalCount);

  for (let i = 0; i < totalCount; i++) {
    loadOneBatchTexture(i);
  }
};

/**
 * Returns a texture at once and fills it when its file has loaded (three's TextureLoader, or
 * HDRLoader for an `.hdr` file, on the main thread). Registered under `id`, or else its
 * `fileName`; a texture already registered under either is returned instead. Without a
 * `fileName` it's an empty texture (or one from `texOpts.image`). A KTX2 file can't load this way:
 * it gets an empty texture.
 * @remarks `throwOnError` throws only for a KTX2 file: a failed load ends after this has returned,
 * so it's logged and the texture stays empty.
 * @deprecated Use `loadTextureAsync`, which loads the asset pipeline's output (KTX2 too), in the
 * assets worker where configured, and whose `throwOnError` reaches the caller. Removed in engine
 * 6.0.0.
 */
export const loadTexture = ({
  id,
  fileName,
  texOpts,
  throwOnError,
  isPersistent,
  userData,
  debugData,
}: {
  id?: string;
  fileName?: string;
  texOpts?: TexOpts;
  throwOnError?: boolean;
  isPersistent?: boolean;
  userData?: Record<string, unknown>;
  debugData?: { name?: string; description?: string };
}) => {
  const cached = (id && getTexture(id)) || (fileName && getTexture(fileName));
  if (cached) {
    retagAssetOwner(cached);
    return cached;
  }
  // Registered once, under its id or else its file name (createTexture registers it)
  return createTexture(
    id || fileName,
    fileName,
    texOpts,
    throwOnError,
    userData,
    debugData,
    isPersistent
  );
};
