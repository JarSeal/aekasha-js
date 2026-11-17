/// <reference lib="webworker" />

// The toolkit's terrain worker (p306 Phase 4): `generateTerrainAsync`'s generation off the main
// thread. Only worker-safe modules: the protocol and the core, no three but `SimplexNoise`, no
// engine entry (`TerrainWorker.test.ts` checks the bundle).
import {
  handleTerrainWorkerRequest,
  TERRAIN_WORKER_READY,
  type TerrainWorkerRequest,
} from './TerrainWorkerProtocol';
import type { TerrainRuleNoiseTexels } from './TerrainRules';

/** The rules' noise texels by key, sent once each */
const noises = new Map<number, TerrainRuleNoiseTexels>();

self.onmessage = (event: MessageEvent<TerrainWorkerRequest>) => {
  const { response, transfer } = handleTerrainWorkerRequest(event.data, noises);
  self.postMessage(response, transfer);
};

self.postMessage({ status: TERRAIN_WORKER_READY });
