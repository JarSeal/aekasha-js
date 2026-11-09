import type * as THREE from 'three/webgpu';
import type { LodDef } from '../lod/LodTypes';
import type { InstancedLodPoolLevel } from './InstancedMeshPool';

// --- src/_engine/features/instancing/InstanceSetTypes.ts ---
//
// The instance sets' types that the front (InstanceSet.ts) and its backends share, apart from
// them so `ECSCoreComponents.ts` can import the component's data and a backend the contract
// without pulling the front in. Types only. docs/plans/p354_gpu-driven-culling.md D1, D10.

/**
 * The `INSTANCE_SET` component's data: the set its entity owns. Deleting the entity (or removing
 * the component) disposes the set.
 * @internal
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
   * Writes the instances `start` to `start + count - 1` from `matrices`: 16 floats each, column
   * major (three's `Matrix4.elements`), uniform scale. They're drawn from the next frame.
   */
  writeInstances: (start: number, matrices: Float32Array, count: number) => void;
  /** Frees the backend's draws and buffers (the front releases the registry refs). */
  dispose: () => void;
  /** The buffers the debug readback reads: the GPU backend's. */
  debugBuffers?: InstanceSetDebugBuffers;
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
  /** The instances added so far: the state's live part. */
  getExtent: () => number;
  /** The slots a camera holds, by slot index. */
  getSlots: () => readonly InstanceSetDebugSlot[];
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
  /** Per level: the instances the main camera's last dispatch drew (a cross-fading one in both its
   * levels); zeros while the main camera has no slot. */
  drawn: number[];
  /** Per level: the instances in the main camera's view past `maxVisible`, which weren't drawn. */
  overflow: number[];
  /** Every camera that holds a slot, in slot order (the main camera's included). */
  slots: InstanceSetSlotStats[];
  /** With `state: true`: every instance's selected level, counted (in view or not). */
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
