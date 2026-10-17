// The facade's registry: the world's rigid bodies, colliders and joints by id (both worker
// targets), the WORKER_THREAD collider callbacks, and the body-moved listener.

import { facade } from './PhysicsState';
import type { RigidBodyAPI } from './types/PhysicsBodyTypes';
import type { ColliderAPI, ColliderParams } from './types/PhysicsColliderTypes';
import type { TempContactForceEvent } from './types/PhysicsEventTypes';
import type { JointAPI } from './types/PhysicsJointTypes';

/** Told the id of every rigid body moved by setTranslation/setRotation (p352). */
let bodyMovedListener: ((rigidBodyId: number) => void) | null = null;

/**
 * Sets (or clears, with null) the one listener told the id of every rigid body moved by
 * `setTranslation` / `setRotation`, in both worker targets. `BODY_STATIC` entities (bodies
 * created `FIXED`, and dynamic ones in the `STATIC` or `DISABLED` physics tier) aren't synced to
 * their entities every frame (p352), so PhysicsManager.ts uses this to bring such a move to the
 * mesh. It's called for every move, so it must be cheap.
 */
export const setBodyMovedListener = (listener: ((rigidBodyId: number) => void) | null) => {
  bodyMovedListener = listener;
  facade.engAPI?.setBodyMovedObserver(listener);
};

/**
 * The listener {@link setBodyMovedListener} set, or null.
 * @internal
 */
export const getBodyMovedListener = () => bodyMovedListener;

/**
 * The world's rigid bodies by their running id (both worker targets).
 * @internal
 */
export const rigidBodies = new Map<number, RigidBodyAPI>();
/**
 * The world's colliders by their running id (both worker targets).
 * @internal
 */
export const colliders = new Map<number, ColliderAPI>();
/**
 * The world's impulse joints by their running id (both worker targets).
 * @internal
 */
export const joints = new Map<number, JointAPI>();

/**
 * A collider's collision callback: called with the collider, the other one, and whether they
 * started touching.
 * @internal
 */
export type CollisionEventFn = (
  collider1: ColliderAPI,
  collider2: ColliderAPI,
  started: boolean
) => void;
/**
 * A collider's contact-force callback.
 * @internal
 */
export type ContactForceEventFn = (event: TempContactForceEvent) => void;
/**
 * WORKER_THREAD only: each collider's collision callbacks, by collider id. Real callback
 * functions can't cross the postMessage boundary (createCollider / createColliders strip them
 * into hasCollisionEventFn / hasContactForceEventFn instead), so they're kept here on the main
 * thread, and invoked when an EVENTS_PUSH message names that id.
 * @internal
 */
export const workerCollisionEventFns = new Map<number, CollisionEventFn[]>();
/**
 * WORKER_THREAD only: each collider's contact-force callbacks, by collider id (see
 * {@link workerCollisionEventFns}).
 * @internal
 */
export const workerContactForceEventFns = new Map<number, ContactForceEventFn[]>();

/** WORKER_THREAD only: registers a collider's real callbacks (once its id is known, i.e.
 * after the CREATE_COLLIDER(S) response resolves) so the EVENTS_PUSH handler can invoke
 * them later. No-op for a collider with neither callback.
 * @internal
 */
export const registerWorkerColliderEventFns = (id: number, params: ColliderParams) => {
  if (params.collisionEventFn) {
    const fns = workerCollisionEventFns.get(id) || [];
    fns.push(params.collisionEventFn);
    workerCollisionEventFns.set(id, fns);
  }
  if (params.contactForceEventFn) {
    const fns = workerContactForceEventFns.get(id) || [];
    fns.push(params.contactForceEventFn);
    workerContactForceEventFns.set(id, fns);
  }
};

/** Removes a collider id's registered WORKER_THREAD event callbacks, if any. Harmless
 * no-op in MAIN_THREAD mode, where these registries are never populated.
 * @internal
 */
export const cleanupWorkerColliderEventFns = (id: number) => {
  workerCollisionEventFns.delete(id);
  workerContactForceEventFns.delete(id);
};

/**
 * Forgets every API object and callback: they all belonged to the world just deleted.
 * @internal
 */
export const clearPhysicsRegistry = () => {
  rigidBodies.clear();
  colliders.clear();
  joints.clear();
  workerCollisionEventFns.clear();
  workerContactForceEventFns.clear();
};

/**
 * How many physics objects the current world has (counted on the main thread, both worker
 * targets).
 * @returns ({ bodies: number; colliders: number; joints: number })
 */
export const getPhysicsObjectCounts = () => ({
  bodies: rigidBodies.size,
  colliders: colliders.size,
  joints: joints.size,
});

export const getRigidBody = (id: number) => rigidBodies.get(id);
export const getCollider = (id: number) => colliders.get(id);
export const getJoint = (id: number) => joints.get(id);
/** All currently tracked rigid bodies, keyed by their physics id (both thread modes). */
export const getAllRigidBodyEntries = (): IterableIterator<[number, RigidBodyAPI]> =>
  rigidBodies.entries();
/** All currently tracked colliders, keyed by their physics id (both thread modes). */
export const getAllColliderEntries = (): IterableIterator<[number, ColliderAPI]> =>
  colliders.entries();
/** All currently tracked joints, keyed by their physics id (both thread modes). */
export const getAllJointEntries = (): IterableIterator<[number, JointAPI]> => joints.entries();
