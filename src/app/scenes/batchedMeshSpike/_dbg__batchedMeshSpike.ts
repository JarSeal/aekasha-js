import {
  APP_RENDER_SYNC_ORDER,
  ComponentType,
  ECSSystemStage,
  createSeededRandom,
  getRenderer,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { getLodFrameStats, setLodBias, setLodFadeSeconds } from 'aekasha/lod';
import type * as THREE from 'three/webgpu';
import {
  bmsSettings,
  bmsState,
  colorBmsMember,
  onBmsExit,
  writeBmsMatrix,
  type BmsMember,
} from './batchedMeshSpike';
import { bmsDecalSettings, bmsDecalState, getBmsDecalEntity } from './batchedMeshSpikeDecals';

// The BatchedMesh spike's measuring (p375 Phase 0): systems at the stages' far ends bracket the
// CPU frame (the first MAIN system to the first LATE_MAIN one: the update and the render submit)
// and the render submit (the last APP_RENDER_SYNC system to the first LATE_MAIN one), and the
// pose producers' order to just after the engine's batch sync (MERGE_BATCH_SYNC) brackets the
// batch syncs: the hand-built one's, and in the ENGINE way the engine's (physics' interpolation
// too, with bodies). The batch figures are the hand-built batch's, or the engine group's. `window.__aekBms.measure(frames)` gives each
// figure's median and 90th percentile over the next `frames` frames; `churnInstances` and
// `churnGeometries` are spike item 6's slot reuse, on a batch only. p375 Phase 2 S6: each frame's
// LOD swaps and fading members (`getLodFrameStats`) and the batch's merged draws, the swaps a
// second over the measure, and `engineGroup()` (the engine group's data: the bench reads its
// batch's runs and compactions through the page's own merging module). p375 Phase 3 S5 (`?bmsDecals`):
// each frame's spawns and the spawner's time, `spawnDecals(n)` (a timed burst), `decals({ rate })`
// and `decalBuffers()` (the batch's reserved sizes, the renderer's geometries and textures and the
// JS heap: the long churn's samples); the engine group is the decal pool's then.

const PREFIX = 'bms:';
const FIRST = 1e9;
const LAST = -1e9;

type Frame = {
  cpuMs: number;
  renderMs: number;
  syncMs: number;
  drawCalls: number;
  triangles: number;
  /** The LOD's level swaps this frame, and its members fading */
  lodApplies: number;
  lodFading: number;
  /** The batch's merged draws at its last pass (three r187's count; -1 without a batch) */
  mergedDraws: number;
  /** The decal spawner's time (ms) and spawns this frame */
  spawnMs: number;
  spawns: number;
};
const KEYS: (keyof Frame)[] = [
  'cpuMs',
  'renderMs',
  'syncMs',
  'drawCalls',
  'triangles',
  'lodApplies',
  'lodFading',
  'mergedDraws',
  'spawnMs',
  'spawns',
];

/** A batch's private draw figures (three r187): the visible members and the merged draws */
type BatchPrivates = {
  _multiDrawCount: number;
  _mergedDrawCount: number;
  _nextVertexStart: number;
  _maxVertexCount: number;
  _nextIndexStart: number;
  _maxIndexCount: number;
  _geometryCount: number;
};

const median = (values: number[], q = 0.5) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

/** An entity of the ENGINE way's group: the field's first member, or the decal pool's */
const getEngineEntity = () =>
  bmsSettings.way === 'ENGINE' ? bmsState.members[0]?.entityId ?? getBmsDecalEntity() : undefined;

/** The ENGINE way's batch: its group's mesh, through its first member, once built. */
const findEngineBatch = (world: ECSWorld) => {
  const first = getEngineEntity();
  if (first === undefined) return null;
  const member = world.getComponent(first, ComponentType.MERGE_MEMBER);
  const object = member && world.getComponent(member.groupEntityId, ComponentType.OBJECT3D)?.value;
  return (object as Partial<THREE.BatchedMesh> | undefined)?.isBatchedMesh
    ? (object as THREE.BatchedMesh)
    : null;
};

const readBatch = (world: ECSWorld) => {
  const batch = (bmsState.batch ?? findEngineBatch(world)) as
    | (THREE.BatchedMesh & BatchPrivates)
    | null;
  if (!batch) return null;
  return {
    instances: batch.instanceCount,
    visible: batch._multiDrawCount,
    mergedDraws: batch._mergedDrawCount,
    geometrySlots: batch._geometryCount,
    vertices: `${batch._nextVertexStart} / ${batch._maxVertexCount}`,
    indices: `${batch._nextIndexStart} / ${batch._maxIndexCount}`,
  };
};

/** Installs the measuring systems and the window global for this load (removed on its exit). */
export const installBmsProbe = (world: ECSWorld) => {
  const frame: Frame = {
    cpuMs: 0,
    renderMs: 0,
    syncMs: 0,
    drawCalls: 0,
    triangles: 0,
    lodApplies: 0,
    lodFading: 0,
    mergedDraws: -1,
    spawnMs: 0,
    spawns: 0,
  };
  const marks = { frameStart: 0, syncStart: 0, renderStart: 0 };
  let pending: {
    frames: Frame[];
    left: number;
    start: number;
    resolve: (f: Frame[], seconds: number) => void;
  } | null = null;

  const systems: [ECSSystemStage, string, () => void, number][] = [
    [ECSSystemStage.MAIN, 'frameStart', () => (marks.frameStart = performance.now()), FIRST],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'syncStart',
      () => (marks.syncStart = performance.now()),
      APP_RENDER_SYNC_ORDER.POSE_PRODUCERS + 0.25,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'syncEnd',
      () => (frame.syncMs = performance.now() - marks.syncStart),
      // After the engine's batch sync, before the pose consumers
      (APP_RENDER_SYNC_ORDER.MERGE_BATCH_SYNC + APP_RENDER_SYNC_ORDER.POSE_CONSUMERS) / 2,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'renderStart',
      () => (marks.renderStart = performance.now()),
      LAST,
    ],
    [
      ECSSystemStage.LATE_MAIN,
      'frameEnd',
      () => {
        const now = performance.now();
        frame.renderMs = now - marks.renderStart;
        frame.cpuMs = now - marks.frameStart;
        const render = getRenderer()?.info.render;
        frame.drawCalls = render?.drawCalls ?? 0;
        frame.triangles = render?.triangles ?? 0;
        // Read after the frame's figures: not in its CPU time
        const lod = getLodFrameStats(world);
        frame.lodApplies = lod.applies;
        frame.lodFading = lod.fading;
        const batch = (bmsState.batch ?? findEngineBatch(world)) as
          | (THREE.BatchedMesh & BatchPrivates)
          | null;
        frame.mergedDraws = batch ? batch._mergedDrawCount : -1;
        frame.spawnMs = bmsDecalState.frameMs;
        frame.spawns = bmsDecalState.frameSpawns;
        if (pending) {
          pending.frames.push({ ...frame });
          if (--pending.left <= 0) {
            pending.resolve(pending.frames, (now - pending.start) / 1000);
            pending = null;
          }
        }
      },
      FIRST,
    ],
  ];
  for (const [stage, id, fn, order] of systems) world.addSystem(stage, PREFIX + id, fn, order);

  const random = createSeededRandom(3751);
  const batchOrThrow = () => {
    if (!bmsState.batch) throw new Error('not a hand-built batch (?bmsWay=batched)');
    return bmsState.batch;
  };
  /** Takes the members out of the batch, then adds each back, with `nextGeometry`'s geometry */
  const reAdd = (members: BmsMember[], nextGeometry: (m: BmsMember) => number) => {
    const batch = batchOrThrow();
    for (const m of members) {
      batch.deleteInstance(m.instanceId);
      m.instanceId = -1;
    }
    for (const m of members) {
      m.geometry = nextGeometry(m);
      m.instanceId = batch.addInstance(bmsState.batchGeometryIds[m.geometry]);
      writeBmsMatrix(world, batch, m);
      if (bmsSettings.colors) colorBmsMember(batch, m);
    }
  };

  const api = {
    /** The medians and 90th percentiles of the next `frames` frames, and the batch's figures */
    measure: (frames: number) =>
      new Promise((resolve) => {
        pending = {
          frames: [],
          left: Math.max(1, frames),
          start: performance.now(),
          resolve: (list, seconds) => {
            const result: Record<string, number> = {};
            for (const key of KEYS) {
              const values = list.map((f) => f[key]);
              result[key] = median(values);
              result[`${key}P90`] = median(values, 0.9);
            }
            let swaps = 0;
            let spawns = 0;
            let spawnMs = 0;
            for (const f of list) {
              swaps += f.lodApplies;
              spawns += f.spawns;
              spawnMs += f.spawnMs;
            }
            resolve({
              frames: list.length,
              seconds,
              swapsPerSecond: seconds > 0 ? swaps / seconds : 0,
              spawnsPerSecond: seconds > 0 ? spawns / seconds : 0,
              msPerSpawn: spawns > 0 ? spawnMs / spawns : NaN,
              ...result,
              settings: { ...bmsSettings },
              backend: (getRenderer()?.backend as { isWebGPUBackend?: boolean } | undefined)
                ?.isWebGPUBackend
                ? 'WebGPU'
                : 'WebGL2',
              batch: readBatch(world),
              moveWaitFrames: bmsState.moveWaitFrames,
            });
          },
        };
      }),
    batch: () => readBatch(world),
    /** The ENGINE way's group data (`MERGE_GROUP`), the key of its batch's state, else null */
    engineGroup: () => {
      const first = getEngineEntity();
      if (first === undefined) return null;
      const member = world.getComponent(first, ComponentType.MERGE_MEMBER);
      return (
        (member && world.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP)) ?? null
      );
    },
    /** p375 Phase 2 (`?bmsLod`): the global LOD bias and fade seconds. A long fade and a new bias
     * start fades on many members at once, for a look mid-way */
    lod: (options: { bias?: number; fadeSeconds?: number }) => {
      if (options.fadeSeconds !== undefined) setLodFadeSeconds(options.fadeSeconds);
      if (options.bias !== undefined) setLodBias(options.bias);
    },
    /** `?bmsDecals`: spawns `count` decals now (then the fades); the time, its patch builds' */
    spawnDecals: (count: number) => {
      if (!bmsDecalState.spawnNow) throw new Error('no decal pool (?bmsDecals=blend|cutout)');
      const { ms, patchMs } = bmsDecalState.spawnNow(count);
      return { count, ms, patchMs, msPerSpawn: ms / count, patchMsPerSpawn: patchMs / count };
    },
    /** `?bmsDecals`: the spawns a second from now on */
    decals: (options: { rate?: number }) => {
      if (options.rate !== undefined) bmsDecalSettings.rate = Math.max(0, options.rate);
    },
    /** `?bmsDecals`: what a long churn watches: the batch's reserved sizes and slots, the
     * renderer's geometries and textures, the JS heap (Chromium's), the spawns so far */
    decalBuffers: () => {
      const batch = (bmsState.batch ?? findEngineBatch(world)) as
        | (THREE.BatchedMesh & BatchPrivates)
        | null;
      const memory = getRenderer()?.info.memory as
        | { geometries?: number; textures?: number }
        | undefined;
      const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        spawned: bmsDecalState.spawned,
        batch: batch
          ? {
              maxInstances: batch.maxInstanceCount,
              instances: batch.instanceCount,
              maxVertices: batch._maxVertexCount,
              maxIndices: batch._maxIndexCount,
              geometrySlots: batch._geometryCount,
            }
          : null,
        geometries: memory?.geometries ?? NaN,
        textures: memory?.textures ?? NaN,
        heapMb: heap ? heap.usedJSHeapSize / 1048576 : NaN,
      };
    },
    /** Item 6, members: `rounds` times, a seeded `share` of the members leave the batch and come
     * back with a random geometry (freed ids are reused lowest first) */
    churnInstances: (share: number, rounds = 1) => {
      const members = bmsState.members;
      const n = Math.max(1, Math.round(members.length * share));
      for (let r = 0; r < rounds; r++) {
        const picked = new Set<BmsMember>();
        while (picked.size < n) picked.add(members[Math.floor(random() * members.length)]);
        reAdd([...picked], () => Math.floor(random() * bmsSettings.geometries));
      }
      return readBatch(world);
    },
    /** Item 6, geometries: `rounds` times, a geometry's members leave, the geometry is replaced
     * and they come back. `DELETE_ADD`: `deleteGeometry`, then `addGeometry` (a freed id, but
     * its space appended: r187 reuses ids, not ranges); `OPTIMIZE`: the same, then `optimize()`
     * (compacts); `SET_AT`: `setGeometryAt` on the same slot. Stops at the first error. */
    churnGeometries: (mode: 'DELETE_ADD' | 'OPTIMIZE' | 'SET_AT', rounds = 1) => {
      const batch = batchOrThrow();
      const ids = bmsState.batchGeometryIds;
      let done = 0;
      try {
        for (let r = 0; r < rounds; r++) {
          const k = r % ids.length;
          const members = bmsState.members.filter((m) => m.geometry === k);
          if (mode === 'SET_AT') {
            batch.setGeometryAt(ids[k], bmsState.geometries[k]);
          } else {
            for (const m of members) {
              batch.deleteInstance(m.instanceId);
              m.instanceId = -1;
            }
            batch.deleteGeometry(ids[k]);
            ids[k] = batch.addGeometry(bmsState.geometries[k]);
            if (mode === 'OPTIMIZE') batch.optimize();
            for (const m of members) {
              m.instanceId = batch.addInstance(ids[k]);
              writeBmsMatrix(world, batch, m);
              if (bmsSettings.colors) colorBmsMember(batch, m);
            }
          }
          done++;
        }
        return { done, error: null, batch: readBatch(world) };
      } catch (err) {
        return { done, error: (err as Error).message, batch: readBatch(world) };
      }
    },
  };
  (window as unknown as { __aekBms?: typeof api }).__aekBms = api;

  onBmsExit(() => {
    for (const [, id] of systems) world.removeSystem(PREFIX + id);
    delete (window as unknown as { __aekBms?: unknown }).__aekBms;
  });
};
