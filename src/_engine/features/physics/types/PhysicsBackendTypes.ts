import type { LoopState } from '../../../kernel/loop/MainLoop';
import type {
  RigidBodyAPI,
  RigidBodyAttachState,
  RigidBodyParams,
  RigidBodyPose,
  PhysicsBodyActivity,
} from './PhysicsBodyTypes';
import type { ColliderAPI, ColliderParams } from './PhysicsColliderTypes';
import type { PhysVector } from './PhysicsCommonTypes';
import type { PhysicsState } from './PhysicsConfigTypes';
import type { CollisionEventRecord, ContactForceEventRecord } from './PhysicsEventTypes';
import type { JointAPI, JointParams } from './PhysicsJointTypes';
import type { PhysicsQueryObserver } from './PhysicsQueryTypes';
import type { WorldAPI } from './PhysicsWorldTypes';

/**
 * Physics Engine API, which handles the communication between
 * PhysicsAPI and EngineAPI. Each physics engine file (eg. EngineRapier.ts)
 * needs to have this signature.
 */
export type EngineAPIType = {
  init: (
    physicsState: PhysicsState,
    isDebugEnvironment: boolean,
    loopState: LoopState,
    doNotCreateWorld?: boolean
  ) => WorldAPI | undefined;
  createWorld: (
    gravity: PhysVector,
    opts?: {
      timestep?: number;
      numSolverIterations?: number;
      numInternalPgsIterations?: number;
    }
  ) => WorldAPI;
  createRigidBody: (params: RigidBodyParams) => RigidBodyAPI;
  createCollider: (params: ColliderParams, parentId?: number) => ColliderAPI;
  createRigidBodies: (params: RigidBodyParams[]) => RigidBodyAPI[];
  createColliders: (params: ColliderParams[]) => ColliderAPI[];
  createJoint: (params: JointParams) => JointAPI;
  createJoints: (params: JointParams[]) => JointAPI[];
  deleteWorld: () => { worldDeleted: boolean };
  deleteRigidBody: (id: number) => { id: number; colliderIds: number[]; jointIds: number[] };
  deleteRigidBodies: (id: number[]) => { ids: number[]; colliderIds: number[]; jointIds: number[] };
  deleteCollider: (id: number, wakeUp?: boolean) => { id: number };
  deleteColliders: (ids: number[], wakeUps?: boolean[]) => { ids: number[] };
  deleteJoint: (id: number, wakeUp?: boolean) => { id: number };
  deleteJoints: (ids: number[], wakeUps?: boolean[]) => { ids: number[] };
  takeSnapshot: () => Uint8Array | undefined;
  restoreSnapshot: (snapshot: Uint8Array) => WorldAPI;
  getRigidBodyAPIWithId: (id: number) => RigidBodyAPI | undefined;
  getColliderAPIWithId: (id: number) => ColliderAPI | undefined;
  getJointAPIWithId: (id: number) => JointAPI | undefined;
  /** Enumerates the ids of all currently-live rigid bodies (worker per-step hot-path write-back). */
  getAllRigidBodyIds: () => IterableIterator<number>;
  step: (eventQueue?: unknown, hooks?: unknown) => void;
  debugRender: () => { vertices: Float32Array; colors: Float32Array } | undefined;
  /** WORKER_THREAD only: returns (and clears) collision/contact-force events accumulated
   * since the last call, for the worker's STEP handler to push via EVENTS_PUSH. */
  drainPendingEventRecords: () => {
    collisions: CollisionEventRecord[];
    contactForces: ContactForceEventRecord[];
  };
  /** MAIN_THREAD only: delivers (and clears) the events accumulated by step() since the last
   * call to their registered callbacks. */
  dispatchPendingEventRecords: () => void;
  /** MAIN_THREAD only: sets (or clears, with null) the observer every query method reports to.
   * While none is set a query costs one null check. Only the `*Sync` implementations report,
   * so an async wrapper that delegates to one is not counted twice. */
  setQueryObserver: (observer: PhysicsQueryObserver | null) => void;
  /** MAIN_THREAD only: sets (or clears, with null) the observer told the id of every body moved
   * by setTranslation/setRotation (p352: BODY_STATIC bodies aren't synced per frame, so a move
   * reaches the body's entity through this). While none is set a move costs one null check. */
  setBodyMovedObserver: (observer: ((rigidBodyId: number) => void) | null) => void;
  /** Counts the awake and sleeping dynamic bodies into `out` and returns it (step stats). */
  countDynamicBodyActivity: (out: PhysicsBodyActivity) => PhysicsBodyActivity;
  /** Writes each body's translation into `out` (x, y, z per id), also for a detached body (the
   * REMOVED tier), NaN for an unknown id; returns `out`. Exact: Rapier stores f32 (p343). */
  readBodyPositions: (ids: ArrayLike<number>, out: Float32Array) => Float32Array;
  /** The REMOVED physics tier (p352): takes a body and its colliders out of the world, keeping
   * their state and their ids. Returns the body's pose, or undefined when it has no body to
   * detach (unknown, already detached, or held by a joint). */
  detachRigidBody: (id: number) => RigidBodyPose | undefined;
  /** Puts a detached body back as it was detached, with `state`'s type and enabled state.
   * Returns its pose, or undefined when it isn't detached. */
  reattachRigidBody: (id: number, state: RigidBodyAttachState) => RigidBodyPose | undefined;
};
