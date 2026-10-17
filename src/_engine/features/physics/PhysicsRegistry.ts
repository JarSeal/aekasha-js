// The facade's registry: the world's rigid bodies, colliders and joints by id (both worker
// targets), the WORKER_THREAD collider callbacks, and the body-moved listener.

import { lwarn } from '../../utils/Logger';
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
 * their entities every frame (p352), so PhysicsEntity.ts uses this to bring such a move to the
 * mesh. It's called for every move, so it must be cheap.
 * @internal
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

/** Marks every API object of a map deleted, for anyone still holding one, and empties it. */
const forgetAll = (map: Map<number, { isBeingDeleted: boolean }>) => {
  for (const api of map.values()) api.isBeingDeleted = true;
  map.clear();
};

/**
 * Forgets every API object and callback: they all belonged to the world just deleted. Each is
 * marked `isBeingDeleted`.
 * @internal
 */
export const clearPhysicsRegistry = () => {
  forgetAll(rigidBodies);
  forgetAll(colliders);
  forgetAll(joints);
  workerCollisionEventFns.clear();
  workerContactForceEventFns.clear();
};

/**
 * Forgets a rigid body being deleted, marking its API object `isBeingDeleted` for anyone still
 * holding it. A no-op for an unknown id.
 * @internal
 */
export const forgetRigidBody = (id: number) => {
  const rb = rigidBodies.get(id);
  if (!rb) return;
  rb.isBeingDeleted = true;
  rigidBodies.delete(id);
};

/**
 * Forgets a collider being deleted (see {@link forgetRigidBody}), and its WORKER_THREAD
 * callbacks.
 * @internal
 */
export const forgetCollider = (id: number) => {
  const coll = colliders.get(id);
  if (coll) {
    coll.isBeingDeleted = true;
    colliders.delete(id);
  }
  cleanupWorkerColliderEventFns(id);
};

/**
 * Forgets a joint being deleted (see {@link forgetRigidBody}).
 * @internal
 */
export const forgetJoint = (id: number) => {
  const joint = joints.get(id);
  if (!joint) return;
  joint.isBeingDeleted = true;
  joints.delete(id);
};

/**
 * Checks a delete's reply: the id it deleted must be the one asked for (`what`, eg. "a
 * collider", names it in the error). Returns the id.
 * @internal
 */
export const checkDeletedId = (what: string, id: number, deletedId: number | undefined) => {
  if (deletedId !== id) {
    throw new Error(
      `Could not delete ${what}, the returned id (${deletedId}) did not match the id: ${id}.`
    );
  }
  return id;
};

/**
 * Checks a delete-many's reply: it throws without one, and warns for each id deleted in another
 * order or not at all (`what`, eg. "colliders", names them). Returns the deleted ids.
 * @internal
 */
export const checkDeletedIds = (what: string, ids: number[], deletedIds: number[] | undefined) => {
  if (deletedIds === undefined) {
    throw new Error(
      `Could not delete ${what}, the returned ids was undefined for ids: ${ids.join(', ')}.`
    );
  }
  for (let i = 0; i < ids.length; i++) {
    if (deletedIds[i] !== ids[i]) {
      lwarn(
        `Could not delete all ${what}, the returned id (${deletedIds[i]}) did not match the id: ${ids[i]}.`
      );
    }
  }
  return deletedIds;
};

/**
 * How many rigid bodies, colliders and joints the current world has (counted on the main thread,
 * both worker targets).
 * @internal
 */
export const getPhysicsObjectCounts = () => ({
  bodies: rigidBodies.size,
  colliders: colliders.size,
  joints: joints.size,
});

/**
 * The current world's rigid body with this id, in both worker targets (no round trip), or
 * undefined: an unknown id, or a body deleted or of a replaced world.
 */
export const getRigidBody = (id: number): RigidBodyAPI | undefined => rigidBodies.get(id);
/** The current world's collider with this id, or undefined (see {@link getRigidBody}). */
export const getCollider = (id: number): ColliderAPI | undefined => colliders.get(id);
/** The current world's impulse joint with this id, or undefined (see {@link getRigidBody}). */
export const getJoint = (id: number): JointAPI | undefined => joints.get(id);
/**
 * All currently tracked rigid bodies, keyed by their physics id (both thread modes).
 * @internal
 */
export const getAllRigidBodyEntries = (): IterableIterator<[number, RigidBodyAPI]> =>
  rigidBodies.entries();
/**
 * All currently tracked colliders, keyed by their physics id (both thread modes).
 * @internal
 */
export const getAllColliderEntries = (): IterableIterator<[number, ColliderAPI]> =>
  colliders.entries();
/**
 * All currently tracked joints, keyed by their physics id (both thread modes).
 * @internal
 */
export const getAllJointEntries = (): IterableIterator<[number, JointAPI]> => joints.entries();
