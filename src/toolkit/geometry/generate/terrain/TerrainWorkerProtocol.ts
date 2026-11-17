// The terrain worker's messages and its handler (p306 Phase 4): `generateTerrainAsync`'s request,
// the core run on it, and the arrays sent back as transfers. Apart from the worker entry, so a
// test runs the handler in this thread. Worker-safe: the core and types only.
import { buildTerrainData, type TerrainCoreOptions, type TerrainData } from './TerrainCore';
import type { TerrainHeightmap } from './TerrainHeightmap';
import type { TerrainRuleNoiseTexels } from './TerrainRules';

/**
 * The core's options a worker takes: no closures, and the rules' noise texels and the heightmap
 * by key (each sent once).
 * @internal
 */
export type TerrainWorkerOptions = Omit<
  TerrainCoreOptions,
  'heightFn' | 'heightModifier' | 'heightmap'
>;

/**
 * A generation request: its id, the options, and the rules' noise and the heightmap by key, each
 * with its data the first time its key is sent.
 * @internal
 */
export type TerrainWorkerRequest = {
  id: number;
  options: TerrainWorkerOptions;
  noiseKey?: number;
  noise?: TerrainRuleNoiseTexels;
  heightmapKey?: number;
  heightmap?: TerrainHeightmap;
};

/**
 * The noise texels and heightmaps a worker keeps by key across its requests.
 * @internal
 */
export type TerrainWorkerCache = {
  noises: Map<number, TerrainRuleNoiseTexels>;
  heightmaps: Map<number, TerrainHeightmap>;
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

/** A keyed value: kept with its key when the request carries it, else the one kept before */
const getKeyed = <T>(
  cache: Map<number, T>,
  key: number | undefined,
  value: T | undefined,
  name: string
) => {
  if (key === undefined) return undefined;
  if (value) cache.set(key, value);
  const kept = cache.get(key);
  if (!kept) throw new Error(`generateTerrain: the terrain worker has no ${name} ${key}.`);
  return kept;
};

/**
 * Runs a request: the noise and the heightmap kept by their keys (the first request with one
 * carries it), the core on the options, its arrays' buffers to transfer.
 * @internal
 * @param cache the worker's noise texels and heightmaps by key, kept across its requests
 */
export const handleTerrainWorkerRequest = (
  request: TerrainWorkerRequest,
  cache: TerrainWorkerCache
): { response: TerrainWorkerResponse; transfer: ArrayBuffer[] } => {
  const { id, options } = request;
  try {
    const texels = getKeyed(cache.noises, request.noiseKey, request.noise, 'noise texels');
    const heightmap = getKeyed(
      cache.heightmaps,
      request.heightmapKey,
      request.heightmap,
      'heightmap'
    );
    const { vertexColors } = options;
    const data = buildTerrainData({
      ...options,
      ...(vertexColors && texels ? { vertexColors: { ...vertexColors, noise: texels } } : {}),
      ...(heightmap ? { heightmap } : {}),
    });
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
