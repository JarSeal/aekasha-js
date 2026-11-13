/// <reference lib="webworker" />

import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type {
  AssetsDownProtocol,
  AssetsLoadHDRTextureRequest,
  AssetsLoadTextureRequest,
} from '../AssetsAPITypes';
import { AssetsProtocolType } from '../AssetsAPITypes';
import { fetchAsset } from './AssetsFetch';

let hdrLoader: HDRLoader | null = null;

/**
 * The assets worker's texture job (`AssetsWorker.ts` imports this module on the first one):
 * answers a LOAD_TEXTURE with the file decoded into an ImageBitmap (flipped vertically and the
 * alpha premultiplied as the request asks) and a LOAD_HDR_TEXTURE with HDRLoader's half-float data, each transferred.
 * @internal
 * @param data the request
 * @param sendMessage posts the response, with the buffers to transfer
 * @throws `AssetsSourceError` when the file can't be fetched; any other error (an image
 * that doesn't decode, an HDR file without half-float data) as is, which the worker answers
 * with an ERROR
 */
export const assetsSwitchTexture = async (
  data: AssetsLoadTextureRequest | AssetsLoadHDRTextureRequest,
  sendMessage: (message: AssetsDownProtocol, transfer?: Transferable[]) => void
) => {
  const { type, requestId, url } = data;
  switch (type) {
    case AssetsProtocolType.LOAD_TEXTURE: {
      const blob = await (await fetchAsset(url)).blob();
      // Bakes in the texture's flipY (TextureLoader's default true flips at upload time, which
      // the WebGL backend ignores for an ImageBitmap) and premultiplyAlpha (default false)
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: data.flipY ? 'flipY' : 'from-image',
        premultiplyAlpha: data.premultiplyAlpha ? 'premultiply' : 'none',
      });
      return sendMessage({ type, requestId, bitmap }, [bitmap]);
    }
    case AssetsProtocolType.LOAD_HDR_TEXTURE: {
      const buffer = await (await fetchAsset(url)).arrayBuffer();
      if (!hdrLoader) hdrLoader = new HDRLoader(); // Default HalfFloatType, as on the main thread
      const texData = hdrLoader.parse(buffer);
      // @types/three says Float32Array | Uint8Array, but HalfFloatType data is a Uint16Array
      const hdrData: unknown = texData.data;
      const { width, height } = texData;
      if (!(hdrData instanceof Uint16Array) || width === undefined || height === undefined) {
        throw new Error(`HDRLoader returned no half-float data for "${url}".`);
      }
      return sendMessage({ type, requestId, width, height, data: hdrData }, [hdrData.buffer]);
    }
  }
};
