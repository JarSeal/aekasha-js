import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import type { LodDef } from '../lod/LodTypes';
import type { InstancedLodPoolLevel } from './InstancedMeshPool';

// --- src/_engine/features/instancing/InstanceSetTypes.ts ---
//
// The instance sets' types that the front (InstanceSet.ts) and its backends share, apart from
// them so `ECSCoreComponents.ts` can import the component's data and a backend the contract
// without pulling the front in. Types only. docs/plans/_DONE_p354_gpu-driven-culling.md D1, D10.

/**
 * The `INSTANCE_SET` component's data: the set its entity owns. Deleting the entity (or removing
 * the component) disposes the set. Set by `createInstanceSetAsync`: don't add it.
 */
export interface InstanceSetData {
  /** The set's draws, a child of the scene it's added to. */
  object: THREE.Group;
  /** Frees everything the set holds: its draws, buffers and registry refs. Called once. */
  _dispose: () => void;
}

/** A run of a set's instances, as `InstanceSet.addInstances` returns it. */
export interface InstanceRange {
  /** The first instance's index in the set. */
  readonly start: number;
  /** How many instances it has. */
  readonly count: number;
}

/**
 * What a set's backend is created with: everything checked and resolved by the front.
 * @internal
 */
export interface InstanceSetBackendParams {
  /** The owning entity's world: the CPU backend steps its instances in a system of it. */
  world: ECSWorld;
  /** The set's group: the backend adds its draws to it. */
  object: THREE.Group;
  /** Level 0 first, `screenSize` descending. */
  levels: readonly InstancedLodPoolLevel[];
  /** The selection settings every instance shares (`fadeSeconds` undefined: the global one). */
  lod: Omit<LodDef, 'levels'>;
  /** The most instances the set holds. */
  maxInstances: number;
  /** Visible instances per camera and level, at most (the GPU backend's list budget). */
  maxVisible: number;
  /** Cameras drawing the set at once, at most (the GPU backend's slots). */
  maxSlots: number;
  /** Whether the instances receive shadows (every level). */
  receiveShadow: boolean;
  /** Compile the draws once `object` is added to the root scene (`preWarmObjectsAsync`). */
  preWarm: boolean;
  /** For warnings and the debug tools: the owning entity's app id, or the entity id. */
  label: string;
}

/**
 * A set's backend (D9, D10): the GPU one (compute culling, indirect draws) or the CPU one, each a
 * module of its own behind an `import()` from the front.
 * @internal
 */
export interface InstanceSetBackend {
  /**
   * Starts the instances `start` to `start + count - 1` (new, or a removed range taken again): not
   * selected yet, whatever was there before, and written from `matrices` as `writeInstances`
   * writes them. They're drawn from the next frame.
   */
  addInstances: (start: number, matrices: Float32Array, count: number) => void;
  /**
   * Writes live instances `start` to `start + count - 1` from `matrices`: 16 floats each, column
   * major (three's `Matrix4.elements`), uniform scale. They keep their levels and fades.
   */
  writeInstances: (start: number, matrices: Float32Array, count: number) => void;
  /** Stops the instances `start` to `start + count - 1` (a removed range): none of them is
   * selected or drawn from the next frame on, until `addInstances` starts them again. */
  removeInstances: (start: number, count: number) => void;
  /** The instances to visit: the highest live one + 1 (the front's ranges' end). */
  setExtent: (extent: number) => void;
  /** Frees the backend's draws and buffers (the front releases the registry refs). */
  dispose: () => void;
  /** The GPU buffers the backend made, for the GPU memory tab's source of the set (its levels'
   * geometries are assets, counted there). */
  debugMemory: () => readonly THREE.BufferAttribute[];
  /** The buffers the debug readback reads: the GPU backend's. */
  debugBuffers?: InstanceSetDebugBuffers;
  /** The arrays the debug readback reads: the CPU backend's. */
  debugCpu?: InstanceSetCpuDebugData;
}

/**
 * Creates a set's backend: what a backend module exports.
 * @internal
 */
export type CreateInstanceSetBackend = (params: InstanceSetBackendParams) => InstanceSetBackend;

/**
 * What the debug readback (`readInstanceSetStatsAsync`) reads of a GPU set: its buffers, as data.
 * @internal
 */
export interface InstanceSetDebugBuffers {
  /** Per (slot, level): the instances the slot's last dispatch appended (past the budget too). */
  counters: THREE.StorageBufferAttribute;
  /** Per instance: its state word (`InstanceSetNodes.ts`). */
  state: THREE.StorageBufferAttribute;
  /** The set's levels. */
  levelCount: number;
  /** Each visible list's budget. */
  maxVisible: number;
  /** The slots a camera holds, by slot index. */
  getSlots: () => readonly InstanceSetDebugSlot[];
}

/**
 * What the debug readback (`readInstanceSetStatsAsync`) reads of a CPU set: its state and level
 * meshes, live (read synchronously).
 * @internal
 */
export interface InstanceSetCpuDebugData {
  /** The set's levels. */
  levelCount: number;
  /** Per instance: its level, `LOD_LEVEL_NONE` or `LOD_LEVEL_CULLED` (`utils/LodRules.ts`); a
   * removed instance's is neither (read the live ranges only). */
  levels: Int16Array;
  /** Per instance: the level it fades out of, `LOD_LEVEL_NONE` (no fade) or `LOD_LEVEL_CULLED`. */
  outgoing: Int16Array;
  /** Per level: its mesh, whose `count` is the copies it draws. */
  meshes: readonly THREE.InstancedMesh[];
}

/**
 * A slot a camera holds in a GPU set (the debug readback's).
 * @internal
 */
export interface InstanceSetDebugSlot {
  /** Its index: its counters, lists and args are the index's part of each buffer. */
  index: number;
  /** The camera holding it: renders through it draw this slot's draws. */
  camera: THREE.Camera;
  /** Its dispatches since the camera took it: one per render of the camera that reached the set. */
  dispatches: number;
}

/** One camera's draws of a set, as `readInstanceSetStatsAsync` reads them back. */
export interface InstanceSetSlotStats {
  /** The camera: `main` for the main camera, `<light name or type> shadow` for a light's shadow in
   * the root scene, else its name, or its type and id. */
  camera: string;
  /** Its dispatches since it took its slot: one per render of the camera that reached the set
   * (two renders in a frame are two; only the frame's first moves the state). */
  dispatches: number;
  /** Per level: the instances its last dispatch drew (a cross-fading one in both its levels). */
  drawn: number[];
  /** Per level: the instances in its view past `maxVisible`, which weren't drawn. */
  overflow: number[];
}

/** What `readInstanceSetStatsAsync` reads back of a set (debug only). */
export interface InstanceSetStats {
  /** The instances the set visits each frame: the highest live one + 1. A removed range below it
   * waits for a later `addInstances` to take it again (the set's `count` is the live ones). */
  extent: number;
  /** Per level: the instances the main camera's last dispatch drew (a cross-fading one in both its
   * levels); zeros while the main camera has no slot. */
  drawn: number[];
  /** Per level: the instances in the main camera's view past `maxVisible`, which weren't drawn. */
  overflow: number[];
  /** Every camera that holds a slot, in slot order (the main camera's included). */
  slots: InstanceSetSlotStats[];
  /** With `state: true`: every live instance's selected level, counted (in view or not). */
  state?: {
    /** Per level: a cross-fading instance counts in both its levels (one fading to or from culled
     * in its one), as an instanced LOD pool's level meshes hold it. */
    levels: number[];
    /** Beyond the last level (one fading out to it too). */
    culled: number;
    /** Not selected yet. */
    unselected: number;
    /** Cross-fading: a level change, or to or from culled. */
    fading: number;
  };
}
