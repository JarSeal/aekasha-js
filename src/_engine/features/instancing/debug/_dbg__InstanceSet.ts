import type * as THREE from 'three/webgpu';
import {
  type LodContentDebugInfo,
  type LodContentDebugStats,
  registerLodContentDebugSource,
} from '../../../kernel/ecs/LodTargets';
import { getMainCamera } from '../../../kernel/camera/Camera';
import { getRenderer } from '../../../kernel/render/Renderer';
import { getRootScene } from '../../../kernel/scene/Scene';
import {
  getInstanceSetBackend,
  getInstanceSetDebugInfo,
  getLiveInstanceSets,
  type InstanceSet,
} from '../InstanceSet';
import type { InstancedLodPoolLevel } from '../InstancedMeshPool';
import { LEVEL_CULLED, LEVEL_NONE } from '../InstanceSetNodes';
import type { InstanceSetSlotStats, InstanceSetStats } from '../InstanceSetTypes';

// An instance set's debug readback (docs/plans/p354_gpu-driven-culling.md D11): the GPU backend's
// counters per slot and state words (the level and the outgoing one), read back after the GPU's
// queued work. Loaded by `readInstanceSetStatsAsync` (InstanceSet.ts) in the debug env and prod
// test mode.

/** The light in the root scene whose shadow map `camera` renders, if any. */
const findShadowLight = (camera: THREE.Camera) => {
  let found: THREE.Light | undefined;
  getRootScene()?.traverse((object) => {
    const light = object as THREE.Light & { shadow?: THREE.LightShadow };
    if (!found && light.isLight && light.shadow?.camera === camera) found = light;
  });
  return found;
};

/** A slot's camera, as the stats name it: `main`, a light's shadow, or the camera's own name. */
const getCameraName = (camera: THREE.Camera) => {
  if (camera === getMainCamera()) return 'main';
  const light = findShadowLight(camera);
  if (light) return `${light.name || light.type} shadow`;
  return camera.name || `${camera.type} ${camera.id}`;
};

/**
 * Reads each slot's last dispatch's counts per level (the main camera's as `drawn` and
 * `overflow`) and, with `state`, the state words counted. Null for a set without a GPU backend, or
 * disposed.
 * @internal
 */
export const _readInstanceSetStatsAsync = async (
  set: InstanceSet,
  opts?: { state?: boolean }
): Promise<InstanceSetStats | null> => {
  const buffers = getInstanceSetBackend(set)?.debugBuffers;
  const renderer = getRenderer() as THREE.WebGPURenderer | null;
  if (!buffers || !renderer) return null;
  const { levelCount, maxVisible } = buffers;
  // The slots as they are now, with both reads queued after this frame's work
  const slots = buffers.getSlots().map(({ index, camera, dispatches }) => ({
    index,
    camera: getCameraName(camera),
    dispatches,
  }));
  const countersRead = renderer.getArrayBufferAsync(buffers.counters);
  const stateRead = opts?.state ? renderer.getArrayBufferAsync(buffers.state) : null;

  const counters = new Uint32Array(await countersRead);
  const stats: InstanceSetStats = {
    drawn: new Array<number>(levelCount).fill(0),
    overflow: new Array<number>(levelCount).fill(0),
    slots: [],
  };
  for (const { index, camera, dispatches } of slots) {
    const slot: InstanceSetSlotStats = { camera, dispatches, drawn: [], overflow: [] };
    for (let level = 0; level < levelCount; level++) {
      const appended = counters[index * levelCount + level];
      slot.drawn.push(Math.min(appended, maxVisible));
      slot.overflow.push(Math.max(appended - maxVisible, 0));
    }
    stats.slots.push(slot);
    if (camera !== 'main') continue;
    stats.drawn = slot.drawn;
    stats.overflow = slot.overflow;
  }
  if (!stateRead) return stats;

  const words = new Uint32Array(await stateRead);
  const state = {
    levels: new Array<number>(levelCount).fill(0),
    culled: 0,
    unselected: 0,
    fading: 0,
  };
  const extent = Math.min(buffers.getExtent(), words.length);
  for (let i = 0; i < extent; i++) {
    const level = words[i] & 0xff;
    const outgoing = (words[i] >>> 8) & 0xff;
    if (level < levelCount) state.levels[level]++;
    else if (level === LEVEL_CULLED) state.culled++;
    else state.unselected++;
    if (outgoing === LEVEL_NONE) continue;
    state.fading++;
    if (outgoing < levelCount) state.levels[outgoing]++;
  }
  stats.state = state;
  return stats;
};

/** The live sets' infos, rewritten in place on each read. */
const infos: LodContentDebugInfo[] = [];
/** Each set's last readback for the LOD tab, and the sets with one on the way. */
const lastStats = new WeakMap<InstanceSet, LodContentDebugStats>();
const pendingReads = new WeakSet<InstanceSet>();

let removeDebugSource: (() => void) | null = null;

/** A level's triangles: its index (or vertices) over 3, every group. */
const countTriangles = (level: InstancedLodPoolLevel) => {
  const { geometry } = level;
  const vertices = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  return Math.floor(vertices / 3);
};

/** Starts a readback of `set` for the LOD tab, unless one is on the way: its figures are the
 * tab's from its next refresh. Only while the tab refreshes (it's open): nothing otherwise. */
const requestStats = (set: InstanceSet, levels: readonly InstancedLodPoolLevel[]) => {
  if (pendingReads.has(set)) return;
  pendingReads.add(set);
  void _readInstanceSetStatsAsync(set, { state: true })
    .then((stats) => {
      if (!stats?.state) return;
      const { state } = stats;
      const sum = (counts: number[], perLevel?: (level: number) => number) =>
        counts.reduce((total, n, i) => total + n * (perLevel?.(i) ?? 1), 0);
      lastStats.set(set, {
        drawn: stats.drawn,
        selected: state.levels,
        culled: state.culled,
        fading: state.fading,
        overflow: stats.slots.reduce((total, slot) => total + sum(slot.overflow), 0),
        triangles: stats.slots.reduce(
          (total, slot) => total + sum(slot.drawn, (i) => countTriangles(levels[i])),
          0
        ),
        cameras: stats.slots.map((slot) => ({ name: slot.camera, drawn: slot.drawn })),
      });
    })
    .finally(() => pendingReads.delete(set));
};

/**
 * Lists the live sets in the LOD tab (once; the `instancing()` feature's `onDebug`), each with
 * its last readback, which every read of the list (the tab's refresh) asks again for.
 * @internal
 */
export const _registerInstanceSetDebugSource = () => {
  removeDebugSource ??= registerLodContentDebugSource({
    getInfos: () => {
      infos.length = 0;
      for (const set of getLiveInstanceSets()) {
        const info = getInstanceSetDebugInfo(set);
        if (!info) continue;
        requestStats(set, info.levels);
        infos.push({
          label: info.label,
          backend: set.backend,
          levelCount: info.levels.length,
          instanceCount: set.count,
          cameraCount: getInstanceSetBackend(set)?.debugBuffers?.getSlots().length ?? 0,
          stats: lastStats.get(set) ?? null,
        });
      }
      return infos;
    },
  });
};
