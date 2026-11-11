import { APP_RENDER_SYNC_ORDER, ECSSystemStage, createSeededRandom, getRenderer } from 'aekasha';
import type { ECSWorld } from 'aekasha';
import type * as THREE from 'three/webgpu';
import {
  bmsSettings,
  bmsState,
  colorBmsMember,
  onBmsExit,
  writeBmsMatrix,
  type BmsMember,
} from './batchedMeshSpike';

// The BatchedMesh spike's measuring (p375 Phase 0): systems at the stages' far ends bracket the
// CPU frame (the first MAIN system to the first LATE_MAIN one: the update and the render submit)
// and the render submit (the last APP_RENDER_SYNC system to the first LATE_MAIN one), and the
// pose producers' order brackets the batch sync. `window.__aekBms.measure(frames)` gives each
// figure's median and 90th percentile over the next `frames` frames; `churnInstances` and
// `churnGeometries` are spike item 6's slot reuse, on a batch only.

const PREFIX = 'bms:';
const FIRST = 1e9;
const LAST = -1e9;

type Frame = {
  cpuMs: number;
  renderMs: number;
  syncMs: number;
  drawCalls: number;
  triangles: number;
};
const KEYS: (keyof Frame)[] = ['cpuMs', 'renderMs', 'syncMs', 'drawCalls', 'triangles'];

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

const readBatch = () => {
  const batch = bmsState.batch as (THREE.BatchedMesh & BatchPrivates) | null;
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
  const frame: Frame = { cpuMs: 0, renderMs: 0, syncMs: 0, drawCalls: 0, triangles: 0 };
  const marks = { frameStart: 0, syncStart: 0, renderStart: 0 };
  let pending: { frames: Frame[]; left: number; resolve: (f: Frame[]) => void } | null = null;

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
      APP_RENDER_SYNC_ORDER.POSE_PRODUCERS - 0.25,
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
        if (pending) {
          pending.frames.push({ ...frame });
          if (--pending.left <= 0) {
            pending.resolve(pending.frames);
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
    if (!bmsState.batch) throw new Error('not a batch (?bmsWay=batched)');
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
          resolve: (list) => {
            const result: Record<string, number> = {};
            for (const key of KEYS) {
              const values = list.map((f) => f[key]);
              result[key] = median(values);
              result[`${key}P90`] = median(values, 0.9);
            }
            resolve({
              frames: list.length,
              ...result,
              settings: { ...bmsSettings },
              backend: (getRenderer()?.backend as { isWebGPUBackend?: boolean } | undefined)
                ?.isWebGPUBackend
                ? 'WebGPU'
                : 'WebGL2',
              batch: readBatch(),
              moveWaitFrames: bmsState.moveWaitFrames,
            });
          },
        };
      }),
    batch: readBatch,
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
      return readBatch();
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
        return { done, error: null, batch: readBatch() };
      } catch (err) {
        return { done, error: (err as Error).message, batch: readBatch() };
      }
    },
  };
  (window as unknown as { __aekBms?: typeof api }).__aekBms = api;

  onBmsExit(() => {
    for (const [, id] of systems) world.removeSystem(PREFIX + id);
    delete (window as unknown as { __aekBms?: unknown }).__aekBms;
  });
};
