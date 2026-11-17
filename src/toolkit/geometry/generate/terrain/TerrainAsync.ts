// `generateTerrain` off the main thread (p306 Phase 4): the toolkit's own module worker
// (`TerrainWorker.ts`), started on the first request and kept for the page. The assets worker
// can't take it: its job kinds are named in the engine, which never imports the toolkit.
import { createSeededRandom, lwarn, type AssetsWorkerTarget } from 'aekasha';
import {
  generateTerrain,
  toGeneratedTerrain,
  type GeneratedTerrain,
  type TerrainOptions,
} from './Terrain';
import { recordTerrainNoiseDraws, type TerrainData } from './TerrainCore';
import type { TerrainHeightmap } from './TerrainHeightmap';
import type { TerrainRuleNoiseTexels } from './TerrainRules';
import {
  TERRAIN_WORKER_READY,
  type TerrainWorkerOptions,
  type TerrainWorkerRequest,
  type TerrainWorkerResponse,
} from './TerrainWorkerProtocol';

/**
 * {@link generateTerrainAsync}'s options: `generateTerrain`'s without its functions (`heightFn`,
 * `heightModifier`: a worker can't be handed code), and the thread to generate on.
 */
export type TerrainAsyncOptions = Omit<TerrainOptions, 'heightFn' | 'heightModifier'> & {
  /**
   * Where the terrain is generated (default `WORKER_THREAD`): the toolkit's terrain worker, or
   * this thread (`generateTerrain`'s work, resolved at once).
   */
  workerTarget?: AssetsWorkerTarget;
};

/** How long the worker's start may take (its module loads on the first request) */
const HANDSHAKE_TIMEOUT_MS = 15000;

type PendingRequest = { resolve: (data: TerrainData) => void; reject: (err: Error) => void };

/**
 * The worker's start (null: it didn't, so this thread generates), its requests, and the keys of
 * the noise texels and heightmaps it was sent
 */
const client = {
  start: null as Promise<Worker | null> | null,
  pending: new Map<number, PendingRequest>(),
  nextId: 1,
  nextKey: 1,
  keys: new WeakMap<TerrainRuleNoiseTexels | TerrainHeightmap, number>(),
};

/** A shared object's key, and whether the worker hasn't been sent it yet */
const getKey = (value: TerrainRuleNoiseTexels | TerrainHeightmap) => {
  const known = client.keys.get(value);
  if (known !== undefined) return { key: known, isNew: false };
  const key = client.nextKey++;
  client.keys.set(value, key);
  return { key, isNew: true };
};

const onResponse = ({ data: response }: MessageEvent<TerrainWorkerResponse>) => {
  const request = client.pending.get(response.id);
  if (!request) return;
  client.pending.delete(response.id);
  if ('error' in response) request.reject(new Error(response.error));
  else request.resolve(response.data);
};

/** The worker failed after its start: its requests rejected, this thread generating from now on */
const onWorkerFailed = (worker: Worker, message: string) => {
  worker.terminate();
  client.start = Promise.resolve(null);
  lwarn(
    `generateTerrainAsync: the terrain worker failed (${message}): generating on the main thread from now on.`
  );
  const error = new Error(`generateTerrainAsync: the terrain worker failed (${message}).`);
  client.pending.forEach((request) => request.reject(error));
  client.pending.clear();
};

/** Resolves with the worker once its handshake arrives; an error or the timeout terminates it */
const handshakeAsync = (worker: Worker) =>
  new Promise<Worker>((resolve, reject) => {
    const fail = (message: string) => {
      clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error(message));
    };
    const timeoutId = setTimeout(
      () => fail(`no handshake in ${HANDSHAKE_TIMEOUT_MS} ms`),
      HANDSHAKE_TIMEOUT_MS
    );
    worker.onerror = (event) => fail(event.message || 'a worker error');
    worker.onmessage = (event: MessageEvent<{ status?: string }>) => {
      if (event.data?.status !== TERRAIN_WORKER_READY) return;
      clearTimeout(timeoutId);
      worker.onmessage = onResponse;
      worker.onerror = (err) => onWorkerFailed(worker, err.message || 'a worker error');
      resolve(worker);
    };
  });

/** The worker, started on the first call (its module imported then); null when it couldn't start */
const startWorkerAsync = () =>
  (client.start ??= import('./TerrainWorker?worker')
    .then(({ default: TerrainWorker }) =>
      handshakeAsync(new TerrainWorker({ name: 'Terrain Worker' }))
    )
    .catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      lwarn(
        `generateTerrainAsync: the terrain worker couldn't start (${reason}): generating on the main thread.`
      );
      return null;
    }));

/**
 * The worker's request: the options without what it can't take or doesn't need, the noise's draws
 * (no heightmap), and the rules' noise texels and the heightmap by key (each itself only the first
 * time)
 */
const toRequest = (opts: Omit<TerrainAsyncOptions, 'workerTarget'>): TerrainWorkerRequest => {
  const { seed = 1, collider: _collider, vertexColors, heightmap, ...rest } = opts;
  const options: TerrainWorkerOptions = rest;
  if (!heightmap) options.noiseDraws = recordTerrainNoiseDraws(createSeededRandom(seed));
  const request: TerrainWorkerRequest = { id: client.nextId++, options };
  if (heightmap) {
    const { key, isNew } = getKey(heightmap);
    request.heightmapKey = key;
    if (isNew) request.heightmap = heightmap;
  }
  if (!vertexColors) return request;
  const { noise, ...colors } = vertexColors;
  options.vertexColors = colors;
  if (noise) {
    const { key, isNew } = getKey(noise);
    request.noiseKey = key;
    if (isNew) request.noise = noise;
  }
  return request;
};

/**
 * {@link generateTerrain} on the toolkit's terrain worker: the same terrain (to the bit), without
 * blocking the main thread for the generation (tens of milliseconds for a 257² block with AO).
 * The worker starts with the first call and stays for the page; it takes one request at a time,
 * in order. Only the declarative options go: no `heightFn` or `heightModifier` (a `heightmap`
 * does, sent once per object, so blocks sharing one map send it once). Where the worker
 * can't start (no module workers, its handshake failed), it warns once and generates on this
 * thread from then on.
 * @returns the terrain, once generated: its geometry, `getHeightAt` and the rest are made here
 * from the worker's arrays
 * @throws (rejects) for `heightFn` or `heightModifier`, `generateTerrain`'s option errors, or a
 * worker that failed while generating
 * @example
 * ```ts
 * import { createMeshEntity, saveBufferGeometry } from 'aekasha';
 * import { createPhysicsEntity } from 'aekasha/physics';
 * import { generateTerrainAsync } from 'aekasha/toolkit/geometry';
 *
 * // A 256 m block with valley AO in its vertex colours, generated on the worker
 * const block = await generateTerrainAsync({
 *   width: 256,
 *   depth: 256,
 *   widthSegments: 256,
 *   depthSegments: 256,
 *   maxHeight: 24,
 *   seed: 11,
 *   normals: 'HEIGHT_FN',
 *   ao: { radius: 16 },
 *   vertexColors: { layout: 'RGB_AO' },
 *   collider: true,
 * });
 * const meshId = createMeshEntity({
 *   geo: saveBufferGeometry(block.geometry, { id: 'bigBlock' }),
 *   mat: 'myVertexColorTerrain',
 * });
 * await createPhysicsEntity({
 *   colliders: [block.heightfield!],
 *   body: { rigidType: 'FIXED' },
 *   target: meshId,
 * });
 * ```
 */
export const generateTerrainAsync = async (
  opts: TerrainAsyncOptions
): Promise<GeneratedTerrain> => {
  const { workerTarget = 'WORKER_THREAD', ...terrainOpts } = opts;
  const functions = (['heightFn', 'heightModifier'] as const).filter(
    (key) => (opts as TerrainOptions)[key] !== undefined
  );
  if (functions.length) {
    throw new Error(
      `generateTerrainAsync: ${functions.join(' and ')} can't go to a worker (a function): use generateTerrain.`
    );
  }
  const worker = workerTarget === 'WORKER_THREAD' ? await startWorkerAsync() : null;
  if (!worker) return generateTerrain(terrainOpts);
  const request = toRequest(terrainOpts);
  const data = await new Promise<TerrainData>((resolve, reject) => {
    // Posted first: a request that can't be cloned throws here, before it's pending
    worker.postMessage(request);
    client.pending.set(request.id, { resolve, reject });
  });
  return toGeneratedTerrain(data, terrainOpts);
};
