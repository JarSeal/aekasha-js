import {
  APP_RENDER_SYNC_ORDER,
  ComponentType,
  ECSSystemStage,
  getActiveCamera,
  getECSWorld,
  getEntityIdByAppId,
  getRenderer,
  getRootScene,
} from 'aekasha';
import type * as THREE from 'three/webgpu';
import { createGpuProfiler, type GpuProfileMode } from './_dbg__terrainBlockTestGpuProfile';
import { decalWalkSettings, decalWalkState } from './terrainBlockTestDecalWalk';

// p309 Phase 4's check (section 5), the debug side of the runtime decals' walk: the tab's pane
// (the camera's views and follow, the walk's rate and pause, each pool's decals and batch) and the
// bench's window API (`devTools/bench/terrainBlockTestDecals.ts`), set on the scene's window
// global by `installDecalProbe`:
// - `measure(frames)`: the medians and 90th percentiles of the next frames' CPU frame (the first
//   MAIN system to the first LATE_MAIN one), render submit (the last APP_RENDER_SYNC system to the
//   first LATE_MAIN one), batch sync (the pose producers to just after the merge batch sync),
//   APP_LOGIC (the walk's spawns and the pools' fades: the stage holds nothing else here), draw
//   calls and triangles, and once at its end the pools' objects drawn (the scene graph's visible
//   ones: a batch per pool, or each decal's own mesh when shown unmerged) and each pool's batch;
// - `setUnmerged(isOn)`: the pools' groups shown unmerged (the Merging tab's A/B view, through the
//   page's own `_dbg__MergingUnmerged.ts`, which the Merging tab loaded);
// - `setRate(rate)`: the walk's footprints a second (the bench fills the pools fast first);
// - `profileGpu(mode, frames)`: WebGL2's GPU time of the pools' objects or of the whole render
//   (`_dbg__terrainBlockTestGpuProfile.ts`, D4's open question);
// - `decalBuffers()`: each pool's batch sizes, the renderer's geometries, textures and draw calls
//   and the JS heap (the 10-minute churn's samples);
// - `lookAtDecalWalk()`: the camera over the whole decal block.

const PREFIX = 'tbtDecalProbe:';
/** A system order before every other in its stage, and after every other */
const FIRST = 1e9;
const LAST = -1e9;

/** three's `BatchedMesh` privates the figures read (r187) */
type BatchPrivates = {
  _multiDrawCount: number;
  _mergedDrawCount: number;
  _nextVertexStart: number;
  _maxVertexCount: number;
  _nextIndexStart: number;
  _maxIndexCount: number;
  _geometryCount: number;
};

/** A pool's merge group entity, through its first decal (`decalPool/<id>/0`), once joined */
const findPoolGroupEntity = (poolId: string) => {
  const first = getEntityIdByAppId(`decalPool/${poolId}/0`);
  if (first === undefined) return undefined;
  return getECSWorld().getComponent(first, ComponentType.MERGE_MEMBER)?.groupEntityId;
};

/** A pool's batch: its group's mesh, once built */
const findPoolBatch = (poolId: string) => {
  const groupEntityId = findPoolGroupEntity(poolId);
  const object =
    groupEntityId !== undefined &&
    getECSWorld().getComponent(groupEntityId, ComponentType.OBJECT3D)?.value;
  return (object as Partial<THREE.BatchedMesh> | undefined)?.isBatchedMesh
    ? (object as THREE.BatchedMesh & BatchPrivates)
    : null;
};

/** A pool's batch sizes, or null before its build */
const readPoolBatch = (poolId: string) => {
  const batch = findPoolBatch(poolId);
  return batch
    ? {
        maxInstances: batch.maxInstanceCount,
        instances: batch.instanceCount,
        visible: batch._multiDrawCount,
        mergedDraws: batch._mergedDrawCount,
        geometrySlots: batch._geometryCount,
        vertices: batch._nextVertexStart,
        maxVertices: batch._maxVertexCount,
        indices: batch._nextIndexStart,
        maxIndices: batch._maxIndexCount,
      }
    : null;
};

/** The pools' batches, the renderer's figures and the heap: the bench's samples */
const decalBuffers = () => {
  const info = getRenderer()?.info as
    | { memory?: { geometries?: number; textures?: number }; render?: { drawCalls?: number } }
    | undefined;
  const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  const { footprints, tracks } = decalWalkState;
  return {
    footprintsSpawned: decalWalkState.footprintsSpawned,
    segmentsSpawned: decalWalkState.segmentsSpawned,
    footprints: footprints && {
      decals: footprints.getDecalCount(),
      batch: readPoolBatch(footprints.id),
    },
    tracks: tracks && { decals: tracks.getDecalCount(), batch: readPoolBatch(tracks.id) },
    geometries: info?.memory?.geometries ?? NaN,
    textures: info?.memory?.textures ?? NaN,
    drawCalls: info?.render?.drawCalls ?? NaN,
    heapMb: heap ? heap.usedJSHeapSize / 1048576 : NaN,
  };
};

/** The objects in the scene graph drawing a pool's material: visible meshes (a batch included) */
const collectPoolObjects = () => {
  // The pools' batches and their decals' own meshes (`decalPool/<id>/<place>`), not the block's
  // decal set (Phase 3's meshes, on the same material)
  const world = getECSWorld();
  const objects = new Set<THREE.Object3D>();
  for (const pool of [decalWalkState.footprints, decalWalkState.tracks]) {
    if (!pool) continue;
    const batch = findPoolBatch(pool.id);
    if (batch) objects.add(batch);
    for (let place = 0; place < pool.maxDecals; place++) {
      const entityId = getEntityIdByAppId(`decalPool/${pool.id}/${place}`);
      const object = entityId !== undefined && world.getComponent(entityId, ComponentType.OBJECT3D);
      if (object) objects.add(object.value);
    }
  }
  return objects;
};

/** The pools' objects drawn: the visible ones in the scene graph */
const countPoolObjects = () => {
  const objects = collectPoolObjects();
  let count = 0;
  getRootScene()?.traverseVisible((object) => {
    if (objects.has(object)) count++;
  });
  return count;
};

/** The pane's readout: each pool and its batch */
const formatDecals = () => {
  const b = decalBuffers();
  const pool = (name: string, figures: ReturnType<typeof decalBuffers>['footprints']) => {
    if (!figures) return `${name}: none`;
    const batch = figures.batch;
    return [
      `${name}: ${figures.decals} decals`,
      batch
        ? `  batch: ${batch.instances} / ${batch.maxInstances} instances, ${batch.visible} drawn, ${batch.mergedDraws} draws, ${batch.geometrySlots} slots`
        : '  batch: not built',
      batch
        ? `  vertices ${batch.vertices} / ${batch.maxVertices}, indices ${batch.indices} / ${batch.maxIndices}`
        : '',
    ].join('\n');
  };
  return [
    `Spawned: ${b.footprintsSpawned} footprints, ${b.segmentsSpawned} track segments`,
    pool('Footprints', b.footprints),
    pool('Tracks', b.tracks),
    `Renderer: ${b.drawCalls} draw calls, ${b.geometries} geometries`,
  ].join('\n');
};

/** The camera's follow: behind and above the walker, eased */
const follow = { isOn: false, x: 0, z: 0 };
const FOLLOW_EASE = 0.05;
const FOLLOW_OFFSET = { back: 6, up: 5 };

const followWalker = (walker: { x: number; z: number; dx: number; dz: number }) => {
  const camera = getActiveCamera();
  if (!follow.isOn || !camera) return;
  follow.x += (walker.x - follow.x) * FOLLOW_EASE;
  follow.z += (walker.z - follow.z) * FOLLOW_EASE;
  camera.position.set(
    follow.x - walker.dx * FOLLOW_OFFSET.back,
    FOLLOW_OFFSET.up,
    follow.z - walker.dz * FOLLOW_OFFSET.back
  );
  camera.lookAt(follow.x, 1, follow.z);
};

/** The whole decal block (grid (-4, 3), 32 m) from above its +z edge */
const DECAL_WALK_VIEW = { position: [-128, 26, 124], target: [-128, 0, 98] } as const;

/** Moves the active camera over the runtime decals' loops (the follow off) */
const lookAtDecalWalk = () => {
  const camera = getActiveCamera();
  if (!camera) return;
  follow.isOn = false;
  camera.position.set(...DECAL_WALK_VIEW.position);
  camera.lookAt(...DECAL_WALK_VIEW.target);
};

/** Shows the pools' groups unmerged or merged again; the groups it switched */
const setUnmergedAsync = async (isOn: boolean) => {
  const entries = performance
    .getEntriesByType('resource')
    .filter((e) =>
      new URL(e.name).pathname.endsWith('/_engine/features/merging/debug/_dbg__MergingUnmerged.ts')
    );
  if (entries.length !== 1) throw new Error('the Merging tab’s unmerged view isn’t loaded');
  const unmerged = (await import(/* @vite-ignore */ entries[0].name)) as {
    setMergeGroupUnmergedView: (groupEntityId: number, isOn: boolean) => boolean;
  };
  let switched = 0;
  for (const pool of [decalWalkState.footprints, decalWalkState.tracks]) {
    const groupEntityId = pool ? findPoolGroupEntity(pool.id) : undefined;
    if (groupEntityId === undefined) continue;
    if (unmerged.setMergeGroupUnmergedView(groupEntityId, isOn) === isOn) switched++;
  }
  return switched;
};

/** A frame's figures (ms, counts) */
type Frame = {
  cpuMs: number;
  renderMs: number;
  syncMs: number;
  logicMs: number;
  drawCalls: number;
  triangles: number;
};
const KEYS: (keyof Frame)[] = ['cpuMs', 'renderMs', 'syncMs', 'logicMs', 'drawCalls', 'triangles'];

const quantile = (values: number[], q: number) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

/**
 * Installs the probe's systems and sets the bench's API on `state` (the scene's window global).
 * @returns the remover, for the scene's exit
 */
export const installDecalProbe = (state: object) => {
  const world = getECSWorld();
  const gpuProfiler = createGpuProfiler();
  const frame: Frame = { cpuMs: 0, renderMs: 0, syncMs: 0, logicMs: 0, drawCalls: 0, triangles: 0 };
  const marks = { frameStart: 0, syncStart: 0, logicStart: 0, renderStart: 0 };
  let pending: {
    frames: Frame[];
    left: number;
    start: number;
    footprints: number;
    segments: number;
    resolve: (result: object) => void;
  } | null = null;

  const finish = (p: NonNullable<typeof pending>) => {
    const seconds = (performance.now() - p.start) / 1000;
    const result: Record<string, number> = {};
    for (const key of KEYS) {
      const values = p.frames.map((f) => f[key]);
      result[key] = quantile(values, 0.5);
      result[`${key}P90`] = quantile(values, 0.9);
    }
    const isWebGPU = (getRenderer()?.backend as { isWebGPUBackend?: boolean } | undefined)
      ?.isWebGPUBackend;
    p.resolve({
      frames: p.frames.length,
      seconds,
      ...result,
      footprintsPerSecond: (decalWalkState.footprintsSpawned - p.footprints) / seconds,
      segmentsPerSecond: (decalWalkState.segmentsSpawned - p.segments) / seconds,
      poolObjects: countPoolObjects(),
      buffers: decalBuffers(),
      settings: { ...decalWalkSettings },
      backend: isWebGPU ? 'WebGPU' : 'WebGL2',
    });
  };

  const systems: [ECSSystemStage, string, () => void, number][] = [
    [ECSSystemStage.MAIN, 'frameStart', () => (marks.frameStart = performance.now()), FIRST],
    [ECSSystemStage.APP_LOGIC, 'logicStart', () => (marks.logicStart = performance.now()), FIRST],
    [
      ECSSystemStage.APP_LOGIC,
      'logicEnd',
      () => (frame.logicMs = performance.now() - marks.logicStart),
      LAST,
    ],
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
      // After the merge batch sync, before the pose consumers
      (APP_RENDER_SYNC_ORDER.MERGE_BATCH_SYNC + APP_RENDER_SYNC_ORDER.POSE_CONSUMERS) / 2,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'renderStart',
      () => {
        marks.renderStart = performance.now();
        gpuProfiler.renderStart();
      },
      LAST,
    ],
    [
      ECSSystemStage.LATE_MAIN,
      'frameEnd',
      () => {
        const now = performance.now();
        gpuProfiler.frameEnd();
        frame.renderMs = now - marks.renderStart;
        frame.cpuMs = now - marks.frameStart;
        const render = getRenderer()?.info.render;
        frame.drawCalls = render?.drawCalls ?? 0;
        frame.triangles = render?.triangles ?? 0;
        if (!pending) return;
        pending.frames.push({ ...frame });
        if (--pending.left <= 0) {
          const done = pending;
          pending = null;
          finish(done);
        }
      },
      FIRST,
    ],
  ];
  for (const [stage, id, fn, order] of systems) world.addSystem(stage, PREFIX + id, fn, order);

  Object.assign(state, {
    measure: (frames: number) =>
      new Promise((resolve) => {
        pending = {
          frames: [],
          left: Math.max(1, frames),
          start: performance.now(),
          footprints: decalWalkState.footprintsSpawned,
          segments: decalWalkState.segmentsSpawned,
          resolve,
        };
      }),
    setUnmerged: setUnmergedAsync,
    setRate: (rate: number) => {
      decalWalkSettings.rate = rate;
    },
    profileGpu: (mode: GpuProfileMode, frames: number) =>
      gpuProfiler.startAsync(mode, frames, collectPoolObjects()),
    decalBuffers,
    lookAtDecalWalk,
  });
  return () => {
    for (const [, id] of systems) world.removeSystem(PREFIX + id);
  };
};

/** The tab's pane for the walk: the views, its rate and pause, the follow and the pools' readout */
export const createDecalPane = () => {
  follow.isOn = false;
  decalWalkState.onWalkFrame = followWalker;
  const followToggle = {
    get isOn() {
      return follow.isOn;
    },
    set isOn(isOn: boolean) {
      follow.isOn = isOn;
      follow.x = decalWalkState.walker.x;
      follow.z = decalWalkState.walker.z;
    },
  };
  const readout = {
    get text() {
      return formatDecals();
    },
  };
  return {
    pane: true as const,
    title: 'Runtime decals (p309 Phase 4)',
    content: [
      { type: 'button' as const, title: 'Look at the runtime decals', onClick: lookAtDecalWalk },
      {
        label: 'Footprints a second',
        target: decalWalkSettings,
        key: 'rate' as const,
        min: 0.5,
        max: 60,
        step: 0.5,
      },
      { label: 'Paused', target: decalWalkSettings, key: 'isPaused' as const },
      { label: 'Follow the walker', target: followToggle, key: 'isOn' as const },
      {
        label: 'Pools',
        target: readout,
        key: 'text' as const,
        readonly: true,
        multiline: true,
        rows: 8,
      },
    ],
  };
};
