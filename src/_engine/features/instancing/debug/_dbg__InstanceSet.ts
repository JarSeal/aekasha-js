import type * as THREE from 'three/webgpu';
import { getRenderer } from '../../../kernel/render/Renderer';
import { getInstanceSetBackend, type InstanceSet } from '../InstanceSet';
import { LEVEL_CULLED } from '../InstanceSetNodes';
import type { InstanceSetStats } from '../InstanceSetTypes';

// An instance set's debug readback (docs/plans/p354_gpu-driven-culling.md D11): the GPU backend's
// counters and state words, read back after the GPU's queued work. Loaded by
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
  const state = { levels: new Array<number>(levelCount).fill(0), culled: 0, unselected: 0 };
  const extent = Math.min(buffers.getExtent(), words.length);
  for (let i = 0; i < extent; i++) {
    const level = words[i] & 0xff;
    if (level < levelCount) state.levels[level]++;
    else if (level === LEVEL_CULLED) state.culled++;
    else state.unselected++;
  }
  stats.state = state;
  return stats;
};
