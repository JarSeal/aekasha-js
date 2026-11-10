/// <reference lib="webworker" />

import * as THREE from 'three/webgpu';
import type { AssetsDownProtocol, AssetsMergeGeometryRequest } from '../AssetsAPITypes';
import { mergeGeometryPartsCore } from '../GeometryMergeCore';
import { deserializeGeometry, serializeGeometry } from '../import/GeometryTransfer';

/**
 * The assets worker's merge job (`AssetsWorker.ts` imports this module on the first one): the
 * same `mergeGeometryPartsCore` the main-thread fallback runs, on the request's geometries (each
 * sent once, however many parts name it). The merged geometry's arrays are transferred back,
 * not copied; its `userData.mergeParts` and bounds go with it.
 * @internal
 * @param data the request
 * @param sendMessage posts the response, with the buffers to transfer
 * @throws as `mergeGeometryPartsCore` (the main thread checks the parts before it sends them, so
 * only a bug gets here), which the worker answers with an ERROR
 */
export const assetsSwitchMerge = (
  data: AssetsMergeGeometryRequest,
  sendMessage: (message: AssetsDownProtocol, transfer?: Transferable[]) => void
) => {
  const { type, requestId, options } = data;
  const geometries = data.geometries.map(deserializeGeometry);
  const parts = data.parts.map(({ geometryIndex, matrix, materialSlot, key }) => ({
    geometry: geometries[geometryIndex],
    ...(matrix ? { matrix: new THREE.Matrix4().fromArray(matrix) } : {}),
    ...(materialSlot !== undefined ? { materialSlot } : {}),
    ...(key !== undefined ? { key } : {}),
  }));
  const { geometry, warnings } = mergeGeometryPartsCore(parts, options);
  const transfer = new Set<ArrayBuffer>();
  sendMessage({ type, requestId, geometry: serializeGeometry(geometry, transfer), warnings }, [
    ...transfer,
  ]);
};
