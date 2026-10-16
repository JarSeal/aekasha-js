/// <reference lib="webworker" />

// Only import worker-safe modules here (no Config.ts, Logger.ts or
// kernel/config/DebugModules.ts: those touch `window`/`document`, directly or through their
// imports).
import type {
  AssetsDownProtocol,
  AssetsUpProtocol,
  AssetsWorkerCapabilities,
  AssetsWorkerReadyMessage,
} from '../AssetsAPITypes';
import { AssetsProtocolType } from '../AssetsAPITypes';
import { AssetsSourceError } from './AssetsFetch';

const STATUS_READY_STRING = 'INIT_READY';

// Each job kind's module (and the loaders and decoders it brings) loads on its first job (p607
// D5): a worker can't be handed code, so the job kinds are named here, not registered. An app
// that never simplifies a geometry (no LOD) never loads LodSimplify.
/** Loads a job module once; a failed load is tried again by the next job. */
const createJobLoader = <T>(load: () => Promise<T>) => {
  let loading: Promise<T> | null = null;
  return () =>
    (loading ??= load().catch((err: unknown) => {
      loading = null;
      throw err;
    }));
};
const loadTextureJob = createJobLoader(() => import('./AssetsSwitchTexture'));
const loadGLTFJob = createJobLoader(() => import('./AssetsSwitchGLTF'));
const loadSimplifyJob = createJobLoader(
  () => import('../../../features/lod/worker/AssetsSwitchSimplify')
);

/** The same test GLTFLoader runs (three 0.186.1, GLTFParser constructor; check it on a three
 * update) to choose between ImageBitmapLoader and the `document`-dependent TextureLoader. */
const getCapabilities = (): AssetsWorkerCapabilities => {
  const hasCreateImageBitmap = typeof createImageBitmap !== 'undefined';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
  const safariMatch = userAgent.match(/Version\/(\d+)/);
  const safariVersion = isSafari && safariMatch ? parseInt(safariMatch[1], 10) : -1;
  const isFirefox = userAgent.indexOf('Firefox') > -1;
  const firefoxMatch = userAgent.match(/Firefox\/([0-9]+)\./);
  const firefoxVersion = isFirefox && firefoxMatch ? parseInt(firefoxMatch[1], 10) : -1;
  return {
    createImageBitmap: hasCreateImageBitmap,
    gltfImageBitmapPath:
      hasCreateImageBitmap &&
      !(isSafari && safariVersion < 17) &&
      !(isFirefox && firefoxVersion < 98),
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  };
};

const sendMessage = (message: AssetsDownProtocol, transfer?: Transferable[]) =>
  self.postMessage(message, transfer || []);

const handleMessage = async (data: AssetsUpProtocol) => {
  const { type, requestId } = data;
  try {
    switch (type) {
      case AssetsProtocolType.PING:
        return sendMessage({ type, requestId, workerTime: performance.now() });
      case AssetsProtocolType.LOAD_TEXTURE:
      case AssetsProtocolType.LOAD_HDR_TEXTURE:
        return await (await loadTextureJob()).assetsSwitchTexture(data, sendMessage);
      case AssetsProtocolType.LOAD_GLTF:
        return await (await loadGLTFJob()).assetsSwitchGLTF(data, sendMessage);
      case AssetsProtocolType.SIMPLIFY_GEOMETRY:
        return await (await loadSimplifyJob()).assetsSwitchSimplify(data, sendMessage);
      default:
        return sendMessage({
          type: AssetsProtocolType.ERROR,
          requestId,
          message: `Unknown assets worker (up) protocol type: ${type}`,
        });
    }
  } catch (err) {
    sendMessage({
      type: AssetsProtocolType.ERROR,
      requestId,
      message: err instanceof Error ? err.message : String(err),
      isSourceError: err instanceof AssetsSourceError,
    });
  }
};

self.onmessage = (event: MessageEvent<AssetsUpProtocol>) => handleMessage(event.data);

// Automatically send the handshake (with the capabilities) when this file is executed
self.postMessage({
  status: STATUS_READY_STRING,
  capabilities: getCapabilities(),
} satisfies AssetsWorkerReadyMessage);
