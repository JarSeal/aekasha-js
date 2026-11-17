// The terrain worker's messages and its handler (p306 Phase 4): `generateTerrainAsync`'s request,
// the core run on it, and the arrays sent back as transfers. Apart from the worker entry, so a
// test runs the handler in this thread. Worker-safe: the core and types only.
import { buildTerrainData, type TerrainCoreOptions, type TerrainData } from './TerrainCore';
import type { TerrainRuleNoiseTexels } from './TerrainRules';

/**
 * The core's options a worker takes: no closures, and the rules' noise texels by key (sent once).
 * @internal
 */
export type TerrainWorkerOptions = Omit<TerrainCoreOptions, 'heightFn' | 'heightModifier'>;

/**
 * A generation request: its id, the options and the rules' noise by key, with the texels the first
 * time that key is sent.
 * @internal
 */
export type TerrainWorkerRequest = {
  id: number;
  options: TerrainWorkerOptions;
  noiseKey?: number;
  noise?: TerrainRuleNoiseTexels;
};

/**
 * A request's answer: the arrays, or the core's error message.
 * @internal
 */
export type TerrainWorkerResponse =
  | { id: number; data: TerrainData }
  | { id: number; error: string };

/** The handshake's status, the engine workers' (`initWorker`) */
export const TERRAIN_WORKER_READY = 'INIT_READY';

/**
 * Runs a request: the noise kept by its key (the first request with it carries the texels), the
 * core on the options, its arrays' buffers to transfer.
 * @internal
 * @param noises the worker's noise texels by key, kept across its requests
 */
export const handleTerrainWorkerRequest = (
  { id, options, noiseKey, noise }: TerrainWorkerRequest,
  noises: Map<number, TerrainRuleNoiseTexels>
): { response: TerrainWorkerResponse; transfer: ArrayBuffer[] } => {
  try {
    if (noiseKey !== undefined && noise) noises.set(noiseKey, noise);
    const texels = noiseKey === undefined ? undefined : noises.get(noiseKey);
    if (noiseKey !== undefined && !texels) {
      throw new Error(`generateTerrain: the terrain worker has no noise texels ${noiseKey}.`);
    }
    const { vertexColors } = options;
    const data = buildTerrainData(
      vertexColors && texels
        ? { ...options, vertexColors: { ...vertexColors, noise: texels } }
        : options
    );
    const arrays = [
      data.positions,
      data.uvs,
      data.normals,
      data.colors,
      data.index,
      data.heights,
      data.ao,
    ];
    const transfer = arrays.flatMap((array) => (array ? [array.buffer as ArrayBuffer] : []));
    return { response: { id, data }, transfer };
  } catch (err) {
    return {
      response: { id, error: err instanceof Error ? err.message : String(err) },
      transfer: [],
    };
  }
};
