import type * as THREE from 'three/webgpu';
import {
  type LodContentDebugInfo,
  type LodContentDebugStats,
  registerLodContentDebugSource,
} from '../../../kernel/ecs/LodTargets';
import { getRenderer } from '../../../kernel/render/Renderer';
import {
  getInstanceSetBackend,
  getInstanceSetDebugInfo,
  getLiveInstanceSets,
  type InstanceSet,
} from '../InstanceSet';
import type { InstancedLodPoolLevel } from '../InstancedMeshPool';
import { LEVEL_CULLED, LEVEL_NONE } from '../InstanceSetNodes';
import type { InstanceSetStats } from '../InstanceSetTypes';

// An instance set's debug readback (docs/plans/p354_gpu-driven-culling.md D11): the GPU backend's
// counters and state words (the level and the outgoing one), read back after the GPU's queued work. Loaded by
// `readInstanceSetStatsAsync` (InstanceSet.ts) in the debug env and prod test mode.

/**
 * Reads a set's last dispatch's counts per level and, with `state`, its state words counted.
 * Null for a set without a GPU backend, or disposed.
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
  // Both reads queued now, after this frame's work
  const countersRead = renderer.getArrayBufferAsync(buffers.counters);
  const stateRead = opts?.state ? renderer.getArrayBufferAsync(buffers.state) : null;

  const counters = new Uint32Array(await countersRead);
  const stats: InstanceSetStats = { drawn: [], overflow: [] };
  for (let level = 0; level < levelCount; level++) {
    const appended = counters[level];
    stats.drawn.push(Math.min(appended, maxVisible));
    stats.overflow.push(Math.max(appended - maxVisible, 0));
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
      lastStats.set(set, {
        drawn: stats.drawn,
        selected: state.levels,
        culled: state.culled,
        fading: state.fading,
        overflow: stats.overflow.reduce((sum, n) => sum + n, 0),
        triangles: stats.drawn.reduce((sum, n, i) => sum + n * countTriangles(levels[i]), 0),
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
          stats: lastStats.get(set) ?? null,
        });
      }
      return infos;
    },
  });
};
