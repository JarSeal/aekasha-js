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
}

/**
 * Creates a set's backend: what a backend module exports.
 * @internal
 */
export type CreateInstanceSetBackend = (params: InstanceSetBackendParams) => InstanceSetBackend;
