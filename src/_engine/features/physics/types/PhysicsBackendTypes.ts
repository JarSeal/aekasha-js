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
 * The backend contract: what a physics backend module (`backends/rapier/EngineRapier.ts`) exports,
 * and what the facade (MAIN_THREAD) and the worker (WORKER_THREAD) call. Ids are the backend's own
 * running integers; nothing here crosses a thread.
 * @internal
 */
export type EngineAPIType = {
  /** Keeps the settings and the debug flag, and creates the world (none with `doNotCreateWorld`,
   * then undefined). The loop state is unused. */
  init: (
    physicsState: PhysicsState,
    isDebugEnvironment: boolean,
    loopState: LoopState,
    doNotCreateWorld?: boolean
  ) => WorldAPI | undefined;
  /** Creates the world; while one exists, returns it as it is (`deleteWorld` first to replace it). */
  createWorld: (
    gravity: PhysVector,
    opts?: {
      timestep?: number;
      numSolverIterations?: number;
      numInternalPgsIterations?: number;
    }
  ) => WorldAPI;
  /** Creates a rigid body. */
  createRigidBody: (params: RigidBodyParams) => RigidBodyAPI;
  /** Creates a collider, on the body `parentId` (or `params.parentId`) when given. */
  createCollider: (params: ColliderParams, parentId?: number) => ColliderAPI;
  /** Creates rigid bodies, in order. */
  createRigidBodies: (params: RigidBodyParams[]) => RigidBodyAPI[];
  /** Creates colliders, in order, each on its `params.parentId`. */
  createColliders: (params: ColliderParams[]) => ColliderAPI[];
  /** Creates an impulse joint between two bodies. */
  createJoint: (params: JointParams) => JointAPI;
  /** Creates impulse joints, in order. */
  createJoints: (params: JointParams[]) => JointAPI[];
  /** Frees the world and forgets its bodies, colliders and joints. */
  deleteWorld: () => { worldDeleted: boolean };
  /** Deletes a body, and with it its colliders and joints, whose ids it returns. */
  deleteRigidBody: (id: number) => { id: number; colliderIds: number[]; jointIds: number[] };
  /** Deletes bodies, and with them their colliders and joints, whose ids it returns. */
  deleteRigidBodies: (id: number[]) => { ids: number[]; colliderIds: number[]; jointIds: number[] };
  /** Deletes a collider, waking its body when `wakeUp`. */
  deleteCollider: (id: number, wakeUp?: boolean) => { id: number };
  /** Deletes colliders, each waking its body when its `wakeUps` entry is true. */
  deleteColliders: (ids: number[], wakeUps?: boolean[]) => { ids: number[] };
  /** Deletes a joint, waking its bodies when `wakeUp`. */
  deleteJoint: (id: number, wakeUp?: boolean) => { id: number };
  /** Deletes joints, each waking its bodies when its `wakeUps` entry is true. */
  deleteJoints: (ids: number[], wakeUps?: boolean[]) => { ids: number[] };
  /** The world serialized by the backend (undefined without a world); see p500. */
  takeSnapshot: () => Uint8Array | undefined;
  /** Replaces the world with one restored from `takeSnapshot`'s bytes; see p500. */
  restoreSnapshot: (snapshot: Uint8Array) => WorldAPI;
  /** The body with this id, or undefined. */
  getRigidBodyAPIWithId: (id: number) => RigidBodyAPI | undefined;
  /** The collider with this id, or undefined. */
  getColliderAPIWithId: (id: number) => ColliderAPI | undefined;
  /** The joint with this id, or undefined. */
  getJointAPIWithId: (id: number) => JointAPI | undefined;
  /** Enumerates the ids of all currently-live rigid bodies (worker per-step hot-path write-back). */
  getAllRigidBodyIds: () => IterableIterator<number>;
  /** Runs one fixed step, collecting its events for `dispatchPendingEventRecords` /
   * `drainPendingEventRecords`. */
  step: (eventQueue?: unknown, hooks?: unknown) => void;
  /** The world's debug render lines (as {@link WorldAPI.debugRender}); needs a world. */
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
