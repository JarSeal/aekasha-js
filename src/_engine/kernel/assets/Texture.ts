import * as THREE from 'three/webgpu';
import { lerror, lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { isHDR, isKTX2 } from './AssetFiles';
import {
  loadHDRTextureInWorker,
  loadTextureInWorker,
  recordAssetLoadReport,
  runAssetTask,
} from './AssetsAPI';
import type { AssetLoadReport } from './AssetsAPITypes';
import {
  getAssetOwnerScope,
  recordAssetOwner,
  retagAssetOwner,
  runInAssetOwnerScope,
} from './AssetOwners';
import { resolveAssetUrl, resolveFileUrl, type GeneratedAssetUrls } from './AssetUrl';
import { loadKTX2Texture } from './import/KTX2';
import { getRenderer } from '../render/Renderer';
import type { TextureArrayInfo } from './TextureArray';
import type { TextureAtlasInfo } from './TextureAtlas';
import type { TextureAtlasSlotInfo } from '../../schemas/TextureAtlasSchema';

/**
 * A texture's sampler state, UV transform, upload settings and format, applied over what its
 * loader set (a field left out keeps the loader's). `image` is only for a texture without a file
 * (its source image).
 */
export type TexOpts = {
  /** The source image of a texture without a file. */
  image?: TexImageSource | OffscreenCanvas;
  mapping?: THREE.AnyMapping;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  magFilter?: THREE.MagnificationTextureFilter;
  minFilter?: THREE.MinificationTextureFilter;
  format?: THREE.PixelFormat;
  type?: THREE.TextureDataType;
  /** Anisotropic filtering samples (1: off), or `'MAX'` for the renderer's
   * `getMaxAnisotropy()` (16 before the renderer is initialised). */
  anisotropy?: number | 'MAX';
  /** How often it repeats over the UVs, `[x, y]`. */
  repeat?: [number, number];
  /** The UV offset, `[x, y]`. */
  offset?: [number, number];
  /** The UV rotation in radians around `center`. */
  rotation?: number;
  /** The rotation's centre in UV space, `[x, y]`. */
  center?: [number, number];
  /** Flips the image vertically. An image the assets worker decodes is flipped there (the
   * texture's own `flipY` stays false), and a compressed texture can't be flipped: a KTX2 file
   * has its flip baked in. */
  flipY?: boolean;
  generateMipmaps?: boolean;
  /** Premultiplies the colour by the alpha. Done by the assets worker's decode, as `flipY`; not
   * for a compressed texture. */
  premultiplyAlpha?: boolean;
  colorSpace?: THREE.ColorSpace;
};

/**
 * A texture {@link loadTextureAsync} loads: a `*.texture.json`'s props (with the asset pipeline's
 * generated fields), or code's.
 */
export type TextureProps = {
  /** The registry id. A registered id returns the registered texture. Default: the texture's
   * uuid. */
  id?: string;
  /** The file, served from `src/public` (eg. `/textures/rock.png`); six files (+x, -x, +y, -y,
   * +z, -z) for a cube texture. A texture from generated data loads its pipeline output instead. */
  fileName?: string | string[];
  /** A URL prefix for `fileName` (a cube texture's folder, eg. `/skyboxes/space/`). */
  path?: string;
  /** Loads an `.hdr` file as HDR data (a HalfFloat `DataTexture`). */
  useHDRLoader?: boolean;
  /** Its sampler state and format, over the loader's. */
  texOpts?: TexOpts;
  /** Rejects when the file can't load. Default: logs and resolves an empty stand-in texture
   * (not registered). */
  throwOnError?: boolean;
  /** Never released by its scene: only {@link deleteTexture} removes it. */
  isPersistent?: boolean;
  /** The texture's `userData` (the engine adds `id`). */
  userData?: Record<string, unknown>;
  /** The name (also the texture's `name`) and description for the debug tooling. */
  debugData?: { name?: string; description?: string };
  /**
   * A texture array asset's (`*.textureArray.json`, p299 D2) layer names by layer index, baked in
   * by gatherAppData: its `__url` is one KTX2 array file, loaded as a `CompressedArrayTexture`.
   */
  __layers?: string[];
  /**
   * A texture atlas slot's (`*.textureAtlas.json`, p299 D3) layout and cell table, baked in by
   * gatherAppData: its `__url` is the slot's KTX2 output, with a mip chain cut where the layout
   * stops keeping the cells apart.
   */
  __atlas?: TextureAtlasSlotInfo;
} & GeneratedAssetUrls;

const textures: {
  [id: string]: {
    resource: THREE.Texture;
    persistent?: boolean;
  };
} = {};

/** Textures whose image is an ImageBitmap decoded in the assets worker: nothing else holds it,
 * so it is closed when the texture is disposed. (Not flagged in userData: setTextureOpts replaces
 * it, and a `.clone()` copies it while sharing the bitmap.) */
const workerBitmapTextures = new WeakSet<THREE.Texture>();

/** Disposes a registered texture, and closes its ImageBitmap if it was decoded in the assets
 * worker. */
const disposeTextureResource = (texture: THREE.Texture) => {
  texture.dispose();
  if (workerBitmapTextures.has(texture)) (texture.image as ImageBitmap).close();
};

/** Resolves a file name the way three's loaders do (`path + fileName`, then against the
 * document, or a mounted engine's `assetBaseUrl`), so the worker fetches exactly the same URL. */
const toLoaderUrl = (fileName: string, path?: string) => resolveFileUrl((path || './') + fileName);

/** A texture from an assets-worker ImageBitmap, in the state TextureLoader leaves a texture in,
 * except flipY and premultiplyAlpha: the decode baked them into the bitmap (applyTexOpts leaves
 * them false). */
const createTextureFromWorkerBitmap = (bitmap: ImageBitmap) => {
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  workerBitmapTextures.add(texture);
  return texture;
};

/** A DataTexture from assets-worker HDR data, in the state HDRLoader.load() (DataTextureLoader
 * plus its own onLoad) leaves a HalfFloatType texture in. */
const createHDRTextureFromWorkerData = ({
  width,
  height,
  data,
}: {
  width: number;
  height: number;
  data: Uint16Array;
}) => {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 1;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
};

/**
 * HDRLoader, imported with the first `.hdr` file (p607 D14).
 * @internal
 */
export const importHDRLoader = async () =>
  (await import('three/addons/loaders/HDRLoader.js')).HDRLoader;

/**
 * Registers a freshly loaded texture. If a parallel load registered the same id first, the fresh
 * one is disposed and the registered one returned, so only one instance is ever used.
 * @internal
 */
export const saveLoadedTexture = <T extends THREE.Texture>(
  texture: T,
  id: string | undefined,
  isPersistent?: boolean
): T => {
  const saved = registerTexture(texture, id || texture.uuid, isPersistent);
  if (saved !== texture) disposeTextureResource(texture);
  return saved;
};

/** The texture input resolvers' module, once loaded and registered */
let textureInputResolvers: Promise<void> | undefined;

/**
 * Loads and registers the texture array and atlas cell material input resolvers (p299 D5,
 * `TextureInputResolvers.ts`) on the first call: the loads of an array or an atlas slot await it
 * before they resolve, so the materials made after them find the resolvers. Not in the kernel's
 * install, so a build without arrays or atlases doesn't carry them. A failed import rejects (the
 * load that awaited it fails with it), and the next call tries again.
 * @internal
 */
export const loadTextureInputResolversAsync = () =>
  (textureInputResolvers ??= import('./TextureInputResolvers').then(
    ({ registerTextureInputResolvers }) => registerTextureInputResolvers(),
    (err: unknown) => {
      textureInputResolvers = undefined;
      throw err;
    }
  ));

/** saveLoadedTexture() in the owner scope the load was called in (AssetOwners: it registers after
 * the load's awaits), plus the load's report (with the file's URL) for the debug tooling, kept
 * only when this load's texture is the one registered. */
const saveAndReport = <T extends THREE.Texture>(
  texture: T,
  id: string | undefined,
  isPersistent: boolean | undefined,
  report: AssetLoadReport,
  sourceUrl: string,
  ownerScope: string | null | undefined
): T => {
  const saved = runInAssetOwnerScope(ownerScope, () =>
    saveLoadedTexture(texture, id, isPersistent)
  );
  if (saved === texture) {
    recordAssetLoadReport(`texture:${saved.userData.id}`, { ...report, sourceUrl });
  }
  return saved;
};

/** `'MAX'` anisotropy as a number: the renderer's most, or WebGPU's 16 before it's initialised
 * (the WebGL backend clamps to the device's). */
const resolveAnisotropy = (anisotropy: number | 'MAX') => {
  if (anisotropy !== 'MAX') return anisotropy;
  const renderer = getRenderer();
  return renderer?.hasInitialized() ? renderer.getMaxAnisotropy() : 16;
};

/**
 * Applies every defined texOpts value to a texture (`anisotropy: 0` and `flipY: false` too),
 * except `flipY` and `premultiplyAlpha` on a texture that has them baked in (an image the assets
 * worker decoded, a compressed texture). Marks a texture that has its data for upload again, so
 * the new settings reach the GPU.
 * @internal
 */
export const applyTexOpts = (texture: THREE.Texture, texOpts?: TexOpts) => {
  if (!texOpts) return;
  const { repeat, offset, rotation, center, flipY, premultiplyAlpha } = texOpts;
  if (texOpts.mapping !== undefined) texture.mapping = texOpts.mapping;
  if (texOpts.wrapS !== undefined) texture.wrapS = texOpts.wrapS;
  if (texOpts.wrapT !== undefined) texture.wrapT = texOpts.wrapT;
  if (texOpts.magFilter !== undefined) texture.magFilter = texOpts.magFilter;
  if (texOpts.minFilter !== undefined) texture.minFilter = texOpts.minFilter;
  if (texOpts.format !== undefined) texture.format = texOpts.format;
  if (texOpts.type !== undefined) texture.type = texOpts.type;
  if (texOpts.anisotropy !== undefined) texture.anisotropy = resolveAnisotropy(texOpts.anisotropy);
  if (texOpts.colorSpace !== undefined) texture.colorSpace = texOpts.colorSpace;
  if (repeat) texture.repeat.set(repeat[0], repeat[1]);
  if (offset) texture.offset.set(offset[0], offset[1]);
  if (rotation !== undefined) texture.rotation = rotation;
  if (center) texture.center.set(center[0], center[1]);
  if (texOpts.generateMipmaps !== undefined) texture.generateMipmaps = texOpts.generateMipmaps;
  const isBaked =
    workerBitmapTextures.has(texture) || (texture as THREE.CompressedTexture).isCompressedTexture;
  if (!isBaked) {
    if (flipY !== undefined) texture.flipY = flipY;
    if (premultiplyAlpha !== undefined) texture.premultiplyAlpha = premultiplyAlpha;
  }
  // A texture without data yet (version 0) isn't marked: three warns about one without an image
  if (texture.version > 0) texture.needsUpdate = true;
};

/**
 * Applies texOpts to a texture (`applyTexOpts`) and replaces its userData (with `userData`,
 * or an empty object), plus debugData's name and description.
 * @internal
 */
export const setTextureOpts = (
  texture: THREE.Texture | THREE.DataTexture | THREE.CubeTexture,
  texOpts?: TexOpts,
  userData?: Record<string, unknown>,
  debugData?: { name?: string; description?: string }
) => {
  applyTexOpts(texture, texOpts);
  texture.userData = userData || {};
  if (debugData) {
    texture.name = debugData.name || texture.name;
    texture.userData.name = debugData.name;
    texture.userData.description = debugData.description;
  }
  return texture;
};

/**
 * A texture without a file: from `texOpts.image` when it has one, else empty (a cube texture with
 * `isCubeTexture`). The loaders' stand-in for a texture that can't load. Not registered.
 * @internal
 */
export const getNoFileTexture = (texOpts?: TexOpts, isCubeTexture?: boolean) => {
  const texture = isCubeTexture ? new THREE.CubeTexture() : new THREE.Texture(texOpts?.image);
  applyTexOpts(texture, texOpts);
  return texture;
};

/**
 * The URL loadTextureAsync loads a single-file texture from: the asset pipeline's output, or its
 * `fileName` resolved like three's loaders do (see resolveAssetUrl).
 * @internal
 */
export const resolveTextureUrl = ({
  id,
  fileName,
  path,
  __url,
  __sourceUrl,
}: Omit<TextureProps, 'fileName'> & { fileName?: string }) =>
  resolveAssetUrl({ id, fileName, __url, __sourceUrl }, (name) => toLoaderUrl(name, path));

type TextureFileLoaderType = 'KTX2Loader' | 'HDRLoader' | 'TextureLoader';

const getTextureFileLoaderType = (url: string, useHDRLoader?: boolean): TextureFileLoaderType =>
  isKTX2(url) ? 'KTX2Loader' : useHDRLoader && isHDR(url) ? 'HDRLoader' : 'TextureLoader';

/**
 * Loads one texture file without registering it (loadTextureAsync registers what this returns),
 * with the loader its URL calls for: a KTX2 file gives a CompressedTexture (a
 * CompressedArrayTexture for an array file) with its flip and mip chain baked in, an HDR file
 * (with `useHDRLoader`) a HalfFloat DataTexture, anything else a Texture. Standard and HDR files
 * load where AppConfig.assets targets textures. A Texture decoded in the assets worker holds an
 * ImageBitmap with `texOpts`' flip (default flipped) and premultiplied alpha baked in (`flipY`
 * and `premultiplyAlpha` false); one the caller doesn't register is the caller's to close.
 * @internal
 * @param url the file's URL, as resolveAssetUrl returns it
 * @param opts.useHDRLoader load an `.hdr` file as HDR data
 * @param opts.texOpts the texture's options: the worker's decode reads `flipY` and
 * `premultiplyAlpha` (the caller still applies them all)
 */
export const loadTextureFileAsync = async (
  url: string,
  opts: { useHDRLoader?: boolean; texOpts?: TexOpts } = {}
): Promise<{ texture: THREE.Texture; report: AssetLoadReport }> => {
  const { useHDRLoader, texOpts } = opts;
  const loaderType = getTextureFileLoaderType(url, useHDRLoader);
  if (loaderType === 'KTX2Loader') {
    // Compressed texture: flipY and mipmaps are baked into the file (see loadKTX2Texture)
    const startedAt = performance.now();
    const texture = await loadKTX2Texture(url);
    const report: AssetLoadReport = {
      target: 'MAIN_THREAD',
      loadedOn: 'MAIN_THREAD',
      durationMs: performance.now() - startedAt,
    };
    return { texture, report };
  }
  if (loaderType === 'HDRLoader') {
    const { result, report } = await runAssetTask<THREE.DataTexture>(
      'TEXTURE',
      async () => createHDRTextureFromWorkerData(await loadHDRTextureInWorker(url)),
      async () => new (await importHDRLoader())().loadAsync(url),
      null // HDR parsing is plain JS, no worker capability needed
    );
    return { texture: result, report };
  }
  if (useHDRLoader) {
    lwarn(`useHDRLoader is ignored for a file that isn't .hdr: ${url}`);
  }
  const { result, report } = await runAssetTask<THREE.Texture>(
    'TEXTURE',
    async () =>
      createTextureFromWorkerBitmap(
        await loadTextureInWorker(url, {
          flipY: texOpts?.flipY !== false,
          premultiplyAlpha: texOpts?.premultiplyAlpha === true,
        })
      ),
    () => new THREE.TextureLoader().loadAsync(url)
  );
  return { texture: result, report };
};

/** A texture array asset's stand-in when it can't load: one black texel per layer. */
const getNoFileArrayTexture = (layers: number, texOpts?: TexOpts) => {
  const texture = new THREE.DataArrayTexture(new Uint8Array(4 * layers), 1, 1, layers);
  texture.needsUpdate = true;
  return setTextureOpts(texture, texOpts);
};

/**
 * A loaded texture array file as a `CompressedArrayTexture` with `layers.length` layers. `ktx
 * create --layers 1` writes `layerCount: 1`, which KTX2Loader loads as a plain
 * `CompressedTexture`: that one is wrapped. Throws when the file has another layer count.
 */
const toCompressedArrayTexture = (texture: THREE.Texture, layers: string[]) => {
  const compressed = texture as THREE.CompressedTexture;
  if (!compressed.isCompressedTexture) throw new Error('its output is not a KTX2 file');
  const isArray = (texture as THREE.CompressedArrayTexture).isCompressedArrayTexture;
  const depth = isArray ? (texture.image as { depth: number }).depth : 1;
  if (depth !== layers.length) {
    throw new Error(
      `its output has ${depth} layer(s) and its generated data names ${layers.length} (__layers): run "yarn gatherAppData"`
    );
  }
  if (isArray) return texture as THREE.CompressedArrayTexture;
  const { width, height } = compressed.image as { width: number; height: number };
  const array = new THREE.CompressedArrayTexture(
    compressed.mipmaps as unknown as ImageData[],
    width,
    height,
    1,
    compressed.format,
    compressed.type
  );
  array.colorSpace = compressed.colorSpace;
  array.premultiplyAlpha = compressed.premultiplyAlpha;
  array.wrapS = compressed.wrapS;
  array.wrapT = compressed.wrapT;
  array.minFilter = compressed.minFilter;
  array.magFilter = compressed.magFilter;
  array.anisotropy = compressed.anisotropy;
  array.generateMipmaps = false;
  array.needsUpdate = true;
  compressed.dispose(); // Never uploaded
  return array;
};

/**
 * loadTextureAsync for a texture array asset (`__layers`, p299 D2): its KTX2 output, or (without
 * `throwOnError`) an empty array texture with the same layer count when there is none or it
 * fails. It has no source file to fall back to. Its `userData.textureArray` describes it like a
 * runtime array's (`getTextureArrayInfo`).
 */
const loadTextureArrayAssetAsync = async (
  {
    id,
    texOpts,
    throwOnError,
    isPersistent,
    userData,
    debugData,
    __url,
    __layers: layers,
  }: TextureProps & { __layers: string[] },
  ownerScope: string | null | undefined
) => {
  let url: string | undefined;
  try {
    if (!__url) {
      throw new Error(
        'the asset pipeline has no output for it (encoder missing, the encode failed, its textures side is off, or not built yet; see the dev server\'s log, or run "yarn assets"): an array loads only from its KTX2 output'
      );
    }
    url = resolveTextureUrl({ id, __url });
    const [{ texture, report }] = await Promise.all([
      loadTextureFileAsync(url),
      loadTextureInputResolversAsync(),
    ]);
    const array = toCompressedArrayTexture(texture, layers);
    setTextureOpts(array, texOpts, userData, debugData);
    const mipmaps = array.mipmaps as unknown as { data: ArrayBufferView }[];
    const info: TextureArrayInfo = {
      origin: 'BUILD',
      members: [...layers],
      kind: 'COMPRESSED',
      width: array.image.width,
      height: array.image.height,
      levels: mipmaps.length,
      layerBytes: mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0) / layers.length,
      swappable: false,
      cpuDataReleased: false,
    };
    array.userData.textureArray = info;
    return saveAndReport(array, id, isPersistent, report, url, ownerScope);
  } catch (err) {
    const errorMsg = `Could not load texture array "${id}" in loadTextureAsync${url ? ` (url: "${url}")` : ''}: ${(err as Error).message}`;
    lerror(errorMsg);
    if (throwOnError) throw new Error(errorMsg);
    return getNoFileArrayTexture(layers.length, texOpts);
  }
};

/**
 * A loaded atlas slot file's {@link TextureAtlasInfo}. Throws when the file doesn't fit its
 * layout: its size must be the layout's halved per dropped top level, and those levels plus the
 * stored ones at most the layout's `levels` (with `mipChain: 'FULL'`, its full chain's).
 */
const getAtlasSlotInfo = (texture: THREE.Texture, atlas: TextureAtlasSlotInfo) => {
  const compressed = texture as THREE.CompressedTexture;
  if (!compressed.isCompressedTexture) throw new Error('its output is not a KTX2 file');
  const { width, height } = compressed.image as { width: number; height: number };
  const [layoutWidth, layoutHeight] = atlas.size;
  const dropped = Math.log2(layoutWidth / width);
  if (!Number.isInteger(dropped) || dropped < 0 || layoutHeight / height !== 2 ** dropped) {
    throw new Error(
      `its output is ${width}×${height} and its layout ${layoutWidth}×${layoutHeight} (__atlas.size): run "yarn gatherAppData"`
    );
  }
  const storedLevels = compressed.mipmaps.length;
  // A full chain goes down to 1×1 (the schema's getFullMipLevelCount; core imports no zod)
  const maxLevels =
    atlas.mipChain === 'FULL'
      ? Math.floor(Math.log2(Math.max(layoutWidth, layoutHeight))) + 1
      : atlas.levels;
  if (dropped + storedLevels > maxLevels) {
    throw new Error(
      `its output has ${storedLevels} mip level(s)${dropped ? ` below ${dropped} dropped one(s)` : ''} and its layout ${atlas.mipChain === 'FULL' ? `has a full chain of ${maxLevels}` : `keeps ${maxLevels} apart (__atlas.levels)`}: run "yarn gatherAppData"`
    );
  }
  const info: TextureAtlasInfo = {
    ...structuredClone(atlas),
    width,
    height,
    storedLevels,
  };
  return info;
};

/**
 * loadTextureAsync for a texture atlas slot (`__atlas`, p299 D3): its KTX2 output, or (without
 * `throwOnError`) an empty texture when there is none or it fails. A slot has no source file to
 * fall back to. Its `userData.textureAtlas` has the cell table (`getTextureAtlasInfo`).
 */
const loadTextureAtlasSlotAsync = async (
  {
    id,
    texOpts,
    throwOnError,
    isPersistent,
    userData,
    debugData,
    __url,
    __atlas: atlas,
  }: TextureProps & { __atlas: TextureAtlasSlotInfo },
  ownerScope: string | null | undefined
) => {
  let url: string | undefined;
  try {
    if (!__url) {
      throw new Error(
        'the asset pipeline has no output for it (encoder missing, the encode failed, its textures side is off, or not built yet; see the dev server\'s log, or run "yarn assets"): an atlas slot loads only from its KTX2 output'
      );
    }
    url = resolveTextureUrl({ id, __url });
    const [{ texture, report }] = await Promise.all([
      loadTextureFileAsync(url),
      loadTextureInputResolversAsync(),
    ]);
    const info = getAtlasSlotInfo(texture, atlas);
    setTextureOpts(texture, texOpts, userData, debugData);
    texture.userData.textureAtlas = info;
    return saveAndReport(texture, id, isPersistent, report, url, ownerScope);
  } catch (err) {
    const errorMsg = `Could not load texture atlas slot "${id}" in loadTextureAsync${url ? ` (url: "${url}")` : ''}: ${(err as Error).message}`;
    lerror(errorMsg);
    if (throwOnError) throw new Error(errorMsg);
    return getNoFileTexture(texOpts);
  }
};

/**
 * Loads a texture asynchronously supporting standard textures, HDR data textures, KTX2 compressed
 * textures and CubeTextures. Standard and HDR textures load where AppConfig.assets targets
 * textures (main thread or the assets worker, with the same result either way). KTX2 textures
 * are transcoded in the KTX2 loader's own worker pool, from the main thread (it needs the
 * renderer), and cube textures always load on the main thread.
 *
 * A texture from generated data (a `*.texture.json`) loads the asset pipeline's output (`__url`)
 * instead of its `fileName`, see resolveAssetUrl. The loader is picked by the loaded URL. A
 * texture array asset (`*.textureArray.json`, p299 D2) loads its KTX2 output as a
 * `CompressedArrayTexture`, a one-layer array too. A texture atlas slot (`*.textureAtlas.json`,
 * p299 D3) loads its KTX2 output with its cell table on `userData.textureAtlas`.
 *
 * The texture is registered under `id` (else its uuid), owned by the scene loading (or current)
 * and released with it unless a material, a sky box or the scene's background holds it. A
 * registered `id` resolves that texture without loading; two loads of one id at once register
 * the first to finish and dispose the other's.
 * @returns the registered texture, or (when the load fails without `throwOnError`) an empty one
 * that isn't registered
 * @example
 * ```ts
 * import { createMaterial, loadTextureAsync } from 'aekasha';
 *
 * const albedo = await loadTextureAsync({ id: 'crateAlbedo', fileName: '/textures/crate.png' });
 * createMaterial({ id: 'crateMaterial', type: 'STANDARD', params: { map: albedo } });
 * ```
 */
export const loadTextureAsync = async (props: TextureProps) => {
  const {
    id,
    fileName,
    path,
    useHDRLoader,
    texOpts,
    throwOnError,
    isPersistent,
    userData,
    debugData,
    __url,
    __sourceUrl,
    __layers,
    __atlas,
  } = props;
  if (id && textures[id]) {
    retagAssetOwner(textures[id].resource);
    return textures[id].resource;
  }
  // Before the first await: the texture registers in its caller's owner scope (AssetOwners)
  const ownerScope = getAssetOwnerScope();
  if (__layers) return loadTextureArrayAssetAsync({ ...props, __layers }, ownerScope);
  if (__atlas) return loadTextureAtlasSlotAsync({ ...props, __atlas }, ownerScope);

  // A packed texture (p300 DD5) has no fileName, only its output
  if (!fileName && !__url) return getNoFileTexture(texOpts);

  let loaderType = '';
  let url: string | undefined;

  try {
    if (!Array.isArray(fileName)) {
      url = resolveTextureUrl({ id, fileName, path, __url, __sourceUrl });
      loaderType = getTextureFileLoaderType(url, useHDRLoader);
      const { texture: result, report } = await loadTextureFileAsync(url, {
        useHDRLoader,
        texOpts,
      });
      // A `--layers` KTX2 loaded as a texture: its layers can be sampled by an input too
      if ((result as THREE.CompressedArrayTexture).isCompressedArrayTexture) {
        await loadTextureInputResolversAsync();
      }
      const loadedTexture = setTextureOpts(result, texOpts, userData, debugData);
      return saveAndReport(loadedTexture, id, isPersistent, report, url, ownerScope);
    } else {
      // Cube texture (always loaded on the main thread)
      if (fileName.length !== 6) {
        throw new Error(
          `Cube texture has to have exactly 6 images in an array (found ${fileName.length} images).`
        );
      }
      loaderType = 'CubeTextureLoader';
      const loader = new THREE.CubeTextureLoader();
      const loadedTexture = setTextureOpts(
        await loader.setPath(resolveFileUrl(path || './')).loadAsync(fileName),
        texOpts,
        userData,
        debugData
      );
      return runInAssetOwnerScope(ownerScope, () =>
        saveLoadedTexture(loadedTexture, id, isPersistent)
      ) as THREE.CubeTexture;
    }
  } catch (err) {
    const errorMsg = `Could not load texture in loadTextureAsync (id: "${id}", fileName: "${Array.isArray(fileName) ? fileName.join(', ') : fileName ?? ''}", ${path ? `path: "${path}", ` : ''}${url ? `url: "${url}", ` : ''}loaderType: "${loaderType}")`;
    lerror(errorMsg, err);
    if (throwOnError) throw new Error(errorMsg);
    if (Array.isArray(fileName)) return getNoFileTexture(texOpts, true) as THREE.CubeTexture;
    return getNoFileTexture(texOpts) as THREE.Texture;
  }
};

/**
 * The registered texture with the id, or undefined.
 * @example
 * ```ts
 * import { getTexture } from 'aekasha';
 *
 * const albedo = getTexture('crateAlbedo');
 * if (albedo) albedo.anisotropy = 8;
 * ```
 */
export const getTexture = (id: string) => textures[id]?.resource;

/**
 * Every registered texture by id, in a new object (the registry itself isn't handed out).
 * @example
 * ```ts
 * import { getAllTextures } from 'aekasha';
 *
 * const ids = Object.keys(getAllTextures());
 * ```
 */
export const getAllTextures = () => {
  const flatMap: { [id: string]: THREE.Texture } = {};
  Object.keys(textures).forEach((key) => {
    flatMap[key] = textures[key].resource;
  });
  return flatMap;
};

/**
 * The texture registry by id: each entry's texture (`resource`) and persistence. Read it, never
 * write it.
 * @internal
 */
export const getTextureRegistry = () => textures;

/**
 * Whether a texture is registered under the id.
 * @internal
 */
export const doesTextureExist = (id: string) => Boolean(textures[id]);

/**
 * Disposes one or many registered textures (closing a worker-decoded image) and removes them from
 * the registry, whatever their persistence and users: a material still holding one samples a
 * disposed texture. An id that isn't registered warns.
 * @param id texture id or array of ids
 * @example
 * ```ts
 * import { deleteTexture } from 'aekasha';
 *
 * deleteTexture(['crateAlbedo', 'crateNormal']);
 * ```
 */
export const deleteTexture = (id: string | string[]) => {
  const targetIds = Array.isArray(id) ? id : [id];
  const idsDeleted: string[] = [];

  for (const texId of targetIds) {
    const entry = textures[texId];
    if (!entry) continue;

    disposeTextureResource(entry.resource);
    delete textures[texId];
    idsDeleted.push(texId);
  }

  if (!idsDeleted.length) {
    lwarn(
      `None of the textures with ids "${targetIds.join(', ')}" could be found and could not be deleted.`
    );
    return;
  }

  const idsNotDeleted = targetIds.filter((texId) => !idsDeleted.includes(texId));
  if (idsNotDeleted.length) {
    lwarn(`Textures with ids "${idsNotDeleted.join(', ')}" could not be found or deleted.`);
  }
};

// Registers a texture, or returns the one registered under its id (re-tagged to the scene getting
// it). saveTexture and saveLoadedTexture's (a parallel load of the same id is no mistake there)
const registerTexture = <T extends THREE.Texture>(
  texture: T,
  id: string,
  isPersistent: boolean | undefined
): T => {
  if (textures[id]) {
    retagAssetOwner(textures[id].resource);
    return textures[id].resource as T;
  }

  texture.userData.id = id;
  textures[id] = {
    resource: texture,
    ...(isPersistent ? { persistent: true } : {}),
  };
  recordAssetOwner(texture);
  return texture;
};

/**
 * Registers a texture you built (a `DataTexture`, a `CanvasTexture`): owned by the scene
 * loading (or current), like {@link loadTextureAsync}'s, and released with it. An id already
 * registered keeps its texture and leaves the one passed in unregistered (the debug env warns when
 * they differ): dispose it, or check {@link getTexture} before creating one.
 * @param texture the texture to register
 * @param givenId its registry id. Default: its uuid
 * @param isPersistent never released by its scene
 * @returns the registered texture
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getTexture, saveTexture } from 'aekasha';
 *
 * const createWhite = () => {
 *   const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
 *   texture.needsUpdate = true;
 *   return texture;
 * };
 * const white = getTexture('white4x4') ?? saveTexture(createWhite(), 'white4x4');
 * ```
 */
export const saveTexture = <T extends THREE.Texture = THREE.Texture>(
  texture: T,
  givenId?: string,
  isPersistent?: boolean
): T => {
  const id = givenId || texture.uuid;
  if (IS_DEBUG_ENV && textures[id] && textures[id].resource !== texture) {
    lwarn(
      `saveTexture: "${id}" is registered already, so the registered texture is returned and the one passed in isn't registered (dispose it, or check getTexture("${id}") before creating one).`
    );
  }
  return registerTexture(texture, id, isPersistent);
};
