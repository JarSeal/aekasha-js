/// <reference lib="webworker" />

// The toolkit's terrain worker (p306 Phase 4): `generateTerrainAsync`'s generation off the main
// thread. Only worker-safe modules: the protocol and the core, no three but `SimplexNoise`, no
// engine entry (`TerrainWorker.test.ts` checks the bundle).
import {
  handleTerrainWorkerRequest,
  TERRAIN_WORKER_READY,
  type TerrainWorkerCache,
  type TerrainWorkerRequest,
} from './TerrainWorkerProtocol';

/** The rules' noise texels and the heightmaps by key, sent once each */
const cache: TerrainWorkerCache = { noises: new Map(), heightmaps: new Map() };

self.onmessage = (event: MessageEvent<TerrainWorkerRequest>) => {
  const { response, transfer } = handleTerrainWorkerRequest(event.data, cache);
  self.postMessage(response, transfer);
};

self.postMessage({ status: TERRAIN_WORKER_READY });
