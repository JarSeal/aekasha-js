// Shared by the main thread (AssetsAPI.ts) and the assets worker: keep this file free of
// runtime imports, so the worker never pulls in main-thread-only modules (eg. Config.ts reads
// `window` at module load).

import type { KTX2LoaderWorkerConfig } from 'three/addons/loaders/KTX2Loader.js';
import type { TransferableGeometry } from './import/GeometryTransfer';
import type { ResolvedLodChainOptions, SimplifiedLodChain } from '../../features/lod/LodSimplify';
import type { TransferableLodChain } from '../../features/lod/LodChainGLTF';
import type { ImportedGeometryInfo } from './import/ImportTypes';
import type { TransferableImage, TransferableTexture } from './import/TextureTransfer';
import type { TextureMapKeys } from './Material';

/** Where an asset kind is loaded. */
export type AssetsWorkerTarget = 'MAIN_THREAD' | 'WORKER_THREAD';

/**
 * The asset kinds that can be loaded (or, for SIMPLIFY, LOD chains generated) in the assets
 * worker. Each has its own workerTarget.
 * @internal
 */
export type AssetKind = 'GLTF' | 'TEXTURE' | 'SIMPLIFY';

/**
 * Resolved assets config (AppConfig.assets with the defaults filled in).
 * @internal
 */
export type AssetsState = {
  /** Shared default for all asset kinds. */
  workerTarget: AssetsWorkerTarget;
  /** Per-kind overrides; undefined falls back to workerTarget. SIMPLIFY's is always set (its
   * default is 'WORKER_THREAD'). */
  gltfWorkerTarget?: AssetsWorkerTarget;
  textureWorkerTarget?: AssetsWorkerTarget;
  simplifyWorkerTarget?: AssetsWorkerTarget;
  /** Max number of requests in flight in the worker at once, the rest wait in a queue. */
  maxConcurrentLoads: number;
  /** A worker request (and the worker handshake) not answered in this time falls back (or fails). */
  requestTimeoutMs: number;
  /** Re-run a failed worker request on the main thread. When false, the failure is thrown. */
  fallbackToMainThread: boolean;
};

/**
 * What the worker's runtime supports, reported in its INIT_READY handshake.
 * @internal
 */
export type AssetsWorkerCapabilities = {
  createImageBitmap: boolean;
  /** GLTFLoader decodes images with ImageBitmapLoader (no `document` needed). It falls back to
   * TextureLoader (needs `document`) without createImageBitmap, on Safari < 17 and Firefox < 98. */
  gltfImageBitmapPath: boolean;
  offscreenCanvas: boolean;
};

/**
 * The main thread's DRACO settings (DracoDecoder.ts), for the worker's own DRACOLoader.
 * @internal
 */
export type DracoWorkerSettings = {
  /** Absolute URL of the decoder directory. */
  decoderPath: string;
  decoderType: 'wasm' | 'js';
  workerLimit?: number;
};

/**
 * The main thread's KTX2 settings (KTX2.ts), for the worker's own KTX2Loader. The worker has no
 * renderer to detect the supported GPU formats with, so it gets the main thread's result.
 * @internal
 */
export type KTX2WorkerSettings = {
  /** Absolute URL of the Basis transcoder directory. */
  transcoderPath: string;
  /** KTX2Loader.detectSupport()'s result on the main thread's renderer. */
  workerConfig: KTX2LoaderWorkerConfig;
};

/**
 * The assets worker's lifecycle: started by the first worker-targeted request, `FAILED` for
 * good once a start fails, the worker crashes or `stopAssetsWorker` runs: later requests fall
 * back at once.
 * @internal
 */
export type AssetsWorkerStatus = 'NOT_STARTED' | 'STARTING' | 'READY' | 'FAILED';

/**
 * Why a worker-targeted request ran on the main thread instead.
 * @internal
 */
export type AssetsFallbackCause =
  /** The worker could not be started (or its handshake timed out). */
  | 'INIT_FAILED'
  /** The worker runtime lacks something this asset kind needs. */
  | 'CAPABILITY'
  /** The request was not answered within requestTimeoutMs. */
  | 'TIMEOUT'
  /** The worker answered the request with an ERROR. */
  | 'WORKER_ERROR'
  /** The worker crashed (uncaught error) while the request was in flight, or before it was sent. */
  | 'CRASHED';

/**
 * Where one load ran, and how long it took (debug info, see recordAssetLoadReport()).
 * @internal
 */
export type AssetLoadReport = {
  /** Where the asset kind was targeted. */
  target: AssetsWorkerTarget;
  /** Where it was actually loaded. */
  loadedOn: AssetsWorkerTarget;
  /** Why a worker-targeted load ran on the main thread instead. */
  fallbackCause?: AssetsFallbackCause;
  fallbackDetail?: string;
  /** From the request to the result, incl. waiting for a worker slot or for the worker to start. */
  durationMs: number;
  /** The loaded file's absolute URL, added by the caller (debug tooling can't read it from an
   * ImageBitmap or a DataTexture). */
  sourceUrl?: string;
};

/**
 * The worker's handshake message (read by initWorker, not part of the protocol unions).
 * @internal
 */
export type AssetsWorkerReadyMessage = {
  status: 'INIT_READY';
  capabilities: AssetsWorkerCapabilities;
};

/**
 * The message kinds between the main thread and the assets worker: a request and its response
 * share one type (see {@link AssetsUpProtocol} and {@link AssetsDownProtocol}).
 * @internal
 */
export enum AssetsProtocolType {
  /** The worker's answer to a request it could not run, or to an unknown type. */
  ERROR = 0,
  /** Round-trip check, eg. to confirm the worker is alive. */
  PING = 1,
  /** A standard (non-HDR) texture: fetched and decoded into an ImageBitmap. */
  LOAD_TEXTURE = 2,
  /** An .hdr texture: fetched and parsed by HDRLoader into half-float RGBA data. */
  LOAD_HDR_TEXTURE = 3,
  /** A .glb/.gltf file: fetched, parsed (DRACO decoded) and its mesh primitives extracted. */
  LOAD_GLTF = 4,
  /** A geometry's LOD chain: simplified by meshoptimizer (features/lod/LodSimplify.ts). */
  SIMPLIFY_GEOMETRY = 5,
}

// UP (main thread → worker). Every request has a requestId; the worker answers each one with
// a response of the same type, or with an ERROR carrying the same requestId.

/**
 * Asks the worker to answer at once (see `pingAssetsWorker`).
 * @internal
 */
export type AssetsPingRequest = { type: AssetsProtocolType.PING; requestId: number };

/**
 * `url` must be absolute: a relative one would resolve against the worker script's URL.
 * @internal
 */
export type AssetsLoadTextureRequest = {
  type: AssetsProtocolType.LOAD_TEXTURE;
  requestId: number;
  url: string;
};

/**
 * `url` must be absolute: a relative one would resolve against the worker script's URL.
 * @internal
 */
export type AssetsLoadHDRTextureRequest = {
  type: AssetsProtocolType.LOAD_HDR_TEXTURE;
  requestId: number;
  url: string;
};

/**
 * `url` must be absolute: a relative one would resolve against the worker script's URL (the
 * glTF's own relative .bin/image URIs resolve against `url`).
 * @internal
 */
export type AssetsLoadGLTFRequest = {
  type: AssetsProtocolType.LOAD_GLTF;
  requestId: number;
  url: string;
  /** The (main-thread-resolved) import id, the geometry id prefix. */
  importId: string;
  meshIndex?: number | number[];
  /** Also send the textures of the primitives' glTF material slots. */
  importTextures: boolean;
  draco: DracoWorkerSettings;
  /** Null when the main thread has no KTX2 support set up (no renderer yet): a file with
   * KHR_texture_basisu then fails in the worker and re-runs on the main thread. */
  ktx2: KTX2WorkerSettings | null;
  /** Also send the file's prebuilt LOD chains (the `lod()` feature is installed): the worker loads
   * their code only then. */
  readLodChains: boolean;
};

/**
 * The geometry's arrays are copies, transferred: the main thread's geometry stays usable.
 * @internal
 */
export type AssetsSimplifyGeometryRequest = {
  type: AssetsProtocolType.SIMPLIFY_GEOMETRY;
  requestId: number;
  geometry: TransferableGeometry;
  options: ResolvedLodChainOptions;
};

/**
 * Every message the main thread sends the worker (`AssetsAPI.ts`' requests).
 * @internal
 */
export type AssetsUpProtocol =
  | AssetsPingRequest
  | AssetsLoadTextureRequest
  | AssetsLoadHDRTextureRequest
  | AssetsLoadGLTFRequest
  | AssetsSimplifyGeometryRequest;

// DOWN (worker → main thread)

/**
 * The worker's answer to a request that failed there: the main thread falls back (re-runs it), or
 * throws `message` as is for a source error.
 * @internal
 */
export type AssetsErrorResponse = {
  type: AssetsProtocolType.ERROR;
  /** Missing when the error isn't tied to a request. */
  requestId?: number;
  message: string;
  /** The file itself failed (eg. an HTTP error or a missing file), so the main thread would
   * fail the same way: the request is not re-run there. */
  isSourceError?: boolean;
};

/**
 * The worker's answer to a PING.
 * @internal
 */
export type AssetsPingResponse = {
  type: AssetsProtocolType.PING;
  requestId: number;
  /** The worker's performance.now() when it answered. */
  workerTime: number;
};

/**
 * The decoded image, already flipped vertically (the flip TextureLoader's default
 * `flipY = true` would do), not premultiplied. Transferred, not copied.
 * @internal
 */
export type AssetsLoadTextureResponse = {
  type: AssetsProtocolType.LOAD_TEXTURE;
  requestId: number;
  bitmap: ImageBitmap;
};

/**
 * HDRLoader's parse result in its default HalfFloatType. `data` is transferred, not copied.
 * @internal
 */
export type AssetsLoadHDRTextureResponse = {
  type: AssetsProtocolType.LOAD_HDR_TEXTURE;
  requestId: number;
  width: number;
  height: number;
  data: Uint16Array;
};

/**
 * GLTFExtract's extractPrimitives() result, run in the worker. Nodes sharing one glTF mesh share
 * one geometry (`geometryIndex`), as they share one BufferGeometry on the main thread. With
 * importTextures, also GLTFTextureCollect's collectGLTFTextures() result (textures sharing one
 * image share its `imageIndex`, as they share one THREE.Source). The geometries' arrays and the
 * images (ImageBitmaps, or compressed mip data) are transferred, not copied.
 * @internal
 */
export type AssetsLoadGLTFResponse = {
  type: AssetsProtocolType.LOAD_GLTF;
  requestId: number;
  /** extractPrimitives()'s error (eg. no node at meshIndex): the file loaded, the import fails. */
  error?: string;
  geometries: TransferableGeometry[];
  primitives: { geometryIndex: number; info: ImportedGeometryInfo }[];
  /** The asset pipeline's prebuilt LOD chains (p347 Phase 3), one per base in `geometries`. */
  lodChains: { geometryIndex: number; chain: TransferableLodChain }[];
  /** Empty without importTextures. ImageBitmaps, or KTX2 textures' compressed mip levels. */
  images: TransferableImage[];
  /** Empty without importTextures. */
  textures: { texture: TransferableTexture; name: string; gltfTextureKey: string }[];
  /** Per primitive (same order): slot → index in `textures`. Empty without importTextures. */
  textureSlotsPerPrimitive: Partial<Record<TextureMapKeys, number>>[];
};

/**
 * LodSimplify's simplifyLodChain() result, run in the worker. Its arrays are transferred.
 * @internal
 */
export type AssetsSimplifyGeometryResponse = {
  type: AssetsProtocolType.SIMPLIFY_GEOMETRY;
  requestId: number;
  result: SimplifiedLodChain;
};

/**
 * Every message the worker sends the main thread but its handshake
 * ({@link AssetsWorkerReadyMessage}): one response per request, by `requestId`.
 * @internal
 */
export type AssetsDownProtocol =
  | AssetsErrorResponse
  | AssetsPingResponse
  | AssetsLoadTextureResponse
  | AssetsLoadHDRTextureResponse
  | AssetsLoadGLTFResponse
  | AssetsSimplifyGeometryResponse;
