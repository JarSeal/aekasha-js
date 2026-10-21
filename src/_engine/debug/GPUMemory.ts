import type * as THREE from 'three/webgpu';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';
import { isProfilerLoadedInThisMode } from './Profiler';

/** Profiler window tab id of the GPU memory and draw-call tab. */
export const GPU_MEMORY_TAB_ID = 'gpuMemory';

let debugGUI: DebugModuleRef<typeof import('./gpuMemory/_dbg__GPUMemory')> | null = null;

/**
 * Creates the profiler's GPU memory tab (three's GPU memory bookkeeping, draw calls) and its
 * per-frame sampler. The implementation is only loaded where the profiler is: the debug env, and
 * prodTest mode when the profiler is enabled there. Call after `registerProfiler` (the tab needs
 * the profiler) and before the renderer is created (the allocation tracker). The boot calls it.
 * @internal
 */
export const registerGPUMemoryDebugGUI = async () => {
  if (!isProfilerLoadedInThisMode()) return;
  debugGUI = await loadDebugModuleAsync(
    () => import('./gpuMemory/_dbg__GPUMemory'),
    true,
    'GPU memory'
  );
  useDebug(debugGUI, true)?._createGPUMemoryDebugGUI();
};

// Sources (p345 §2.3)

/**
 * A GPU-backed object a source holds. Its bytes are three's own (`renderer.info`): a render
 * target counts its textures (an internal depth buffer too), a geometry its attributes and index,
 * and an attribute every buffer three made from its array (eg. the instance attributes an
 * `InstancedMesh`'s `instanceMatrix` is read through).
 */
export type GPUMemoryResource =
  | THREE.Texture
  | THREE.RenderTarget
  | THREE.BufferGeometry
  | THREE.BufferAttribute
  | THREE.InterleavedBufferAttribute;

/** GPU resources that aren't registered assets, named for the profiler's GPU memory tab. */
export type GPUMemorySource = {
  /** Unique; registering the same id again replaces the source. */
  id: string;
  /** The source's name in the tab's "By owner" list */
  label: string;
  /** The objects it holds now. Called only while the GPU memory tab refreshes. */
  getResources: () => Iterable<GPUMemoryResource | null | undefined>;
  /** An AssetOwners key (a scene id, later `sceneId#cellKey`), or a function for one that
   * changes (eg. the current scene). Without one, the source is listed under "engine". */
  owner?: string | (() => string | null | undefined);
};

const sources = new Map<string, GPUMemorySource>();

/**
 * Names GPU resources that aren't registered assets (render targets, instance buffers), so the
 * GPU memory tab can list them and take them out of "untracked". Works at any time, also before
 * the profiler has loaded. `getResources` returns the three objects, never a byte estimate: the
 * tab reads their bytes from three's own bookkeeping.
 * @returns a function that removes the source (a no-op once another source took its id)
 * @remarks A no-op returning a no-op where the profiler doesn't load (see
 * `isProfilerLoadedInThisMode`): outside the debug env, unless it is enabled in prodTest mode.
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getCurrentSceneId } from 'aekasha';
 * import { registerGPUMemorySource } from 'aekasha/debug';
 *
 * const minimapTarget = new THREE.RenderTarget(256, 256);
 *
 * const removeMinimapSource = registerGPUMemorySource({
 *   id: 'game.minimap',
 *   label: 'Minimap',
 *   getResources: () => [minimapTarget],
 *   owner: () => getCurrentSceneId(),
 * });
 * ```
 */
export const registerGPUMemorySource = (source: GPUMemorySource) => {
  if (!isProfilerLoadedInThisMode()) return () => {};
  sources.set(source.id, source);
  return () => {
    if (sources.get(source.id) === source) sources.delete(source.id);
  };
};

/**
 * The registered sources (the GPU memory tab).
 * @internal
 */
export const _getGPUMemorySources = (): ReadonlyMap<string, GPUMemorySource> => sources;
