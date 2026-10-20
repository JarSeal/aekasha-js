/// <reference lib="webworker" />

import type {
  AssetsDownProtocol,
  AssetsSimplifyGeometryRequest,
} from '../../../kernel/assets/AssetsAPITypes';
import { simplifyLodChain } from '../LodSimplify';

/**
 * A geometry's LOD chain (the same simplifyLodChain() the main-thread fallback runs). Its index
 * and vertex arrays are transferred, not copied.
 * The assets worker loads it on its first simplify job.
 * @internal
 */
export const assetsSwitchSimplify = async (
  data: AssetsSimplifyGeometryRequest,
  sendMessage: (message: AssetsDownProtocol, transfer?: Transferable[]) => void
) => {
  const { type, requestId, geometry, options } = data;
  const transfer = new Set<ArrayBuffer>();
  const result = await simplifyLodChain(geometry, options, transfer);
  sendMessage({ type, requestId, result }, [...transfer]);
};
