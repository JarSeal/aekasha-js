// The Rapier backend's collision and contact-force events: the callbacks by collider (MAIN_THREAD)
// and the plain records each step collects for them.

import type { ColliderAPI, ColliderParams } from '../../types/PhysicsColliderTypes';
import {
  type CollisionEventRecord,
  type ContactForceEventRecord,
  ContactForceEventSnapshot,
  type TempContactForceEvent,
} from '../../types/PhysicsEventTypes';
import { backend, colliderAPIs, getColliderAPI } from './RapierState';

let collisionEventFnCount = 0;
let contactForceEventFnCount = 0;
type CollisionEventFn = (collider1: ColliderAPI, collider2: ColliderAPI, started: boolean) => void;
type ContactForceEventFn = (event: TempContactForceEvent) => void;
// { "collider id", callbacks[] } — arrays to match the legacy file's multi-callback support
// for compound colliders. MAIN_THREAD only; WORKER_THREAD keeps the real callbacks on the
// main thread (PhysicsRegistry.ts) and only reads plain records back from this module.
const collisionEventFns = new Map<number, CollisionEventFn[]>();
const contactForceEventFns = new Map<number, ContactForceEventFn[]>();
// Plain-data records accumulated by every step() call. WORKER_THREAD: taken by
// drainPendingEventRecords() once per STEP message (which may run multiple sub-steps) and pushed
// to the main thread via EVENTS_PUSH. MAIN_THREAD: delivered by dispatchPendingEventRecords() at
// the start of the next sub-step (see PhysicsMessaging.ts' flushPhysicsEvents for why not right away).
let pendingCollisionRecords: CollisionEventRecord[] = [];
let pendingContactForceRecords: ContactForceEventRecord[] = [];
// Tracks which collider ids counted towards collisionEventFnCount/contactForceEventFnCount,
// so deleteCollider()/deleteWorld() can decrement accurately.
const collisionActiveColliderIds = new Set<number>();
const contactForceActiveColliderIds = new Set<number>();

/** Removes id's event callback/counter/registry bookkeeping (does not touch colliders/colliderAPIs). */
export const cleanupColliderEventRegistrations = (id: number) => {
  collisionEventFns.delete(id);
  contactForceEventFns.delete(id);
  if (collisionActiveColliderIds.delete(id)) collisionEventFnCount--;
  if (contactForceActiveColliderIds.delete(id)) contactForceEventFnCount--;
};

/**
 * Registers a new collider's event callbacks (MAIN_THREAD) and counts it towards the drains
 * (both targets).
 * @internal
 */
export const registerColliderEventFns = (
  id: number,
  params: ColliderParams,
  hasCollisionFn: boolean,
  hasContactForceFn: boolean
) => {
  if (hasCollisionFn) {
    collisionActiveColliderIds.add(id);
    collisionEventFnCount++;
  }
  if (hasContactForceFn) {
    contactForceActiveColliderIds.add(id);
    contactForceEventFnCount++;
  }
  if (params.collisionEventFn) {
    const fns = collisionEventFns.get(id) || [];
    fns.push(params.collisionEventFn);
    collisionEventFns.set(id, fns);
  }
  if (params.contactForceEventFn) {
    const fns = contactForceEventFns.get(id) || [];
    fns.push(params.contactForceEventFn);
    contactForceEventFns.set(id, fns);
  }
};

/**
 * Forgets every collider's callbacks and the records not delivered yet (deleteWorld).
 * @internal
 */
export const clearEventRegistrations = () => {
  collisionEventFns.clear();
  contactForceEventFns.clear();
  collisionActiveColliderIds.clear();
  contactForceActiveColliderIds.clear();
  collisionEventFnCount = 0;
  contactForceEventFnCount = 0;
  pendingCollisionRecords = [];
  pendingContactForceRecords = [];
};

/** Drains the module's own backend.eventQueue (populated by backend.world.step()) into plain-data
 * records (pendingCollisionRecords/pendingContactForceRecords), gated by the counters so a scene
 * with no collision/contact-force callbacks pays zero per-step cost. Nothing is dispatched here:
 * WORKER_THREAD hands the records to the main thread (drainPendingEventRecords), MAIN_THREAD
 * delivers them with dispatchPendingEventRecords().
 */
export const drainAndDispatchEvents = () => {
  if (!backend.eventQueue) return;

  if (collisionEventFnCount) {
    backend.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const collider1 = getColliderAPI(handle1);
      const collider2 = getColliderAPI(handle2);
      if (!collider1 || !collider2) return;
      pendingCollisionRecords.push({
        collider1Id: collider1.id,
        collider2Id: collider2.id,
        started,
      });
    });
  }

  if (contactForceEventFnCount) {
    backend.eventQueue.drainContactForceEvents((event) => {
      const collider1 = getColliderAPI(event.collider1());
      const collider2 = getColliderAPI(event.collider2());
      if (!collider1 || !collider2) return;
      pendingContactForceRecords.push({
        collider1Id: collider1.id,
        collider2Id: collider2.id,
        totalForce: event.totalForce(),
        totalForceMagnitude: event.totalForceMagnitude(),
        maxForceDirection: event.maxForceDirection(),
        maxForceMagnitude: event.maxForceMagnitude(),
      });
    });
  }
};

/** MAIN_THREAD only: invokes the registered callbacks for every event record accumulated since
 * the last call (each side's callbacks get the *other* collider as the second argument), then
 * clears them. Silently skips records naming a collider that no longer exists. */
export const dispatchPendingEventRecords = () => {
  if (!pendingCollisionRecords.length && !pendingContactForceRecords.length) return;
  const { collisions, contactForces } = drainPendingEventRecords();

  for (let i = 0; i < collisions.length; i++) {
    const rec = collisions[i];
    const collider1 = colliderAPIs.get(rec.collider1Id);
    const collider2 = colliderAPIs.get(rec.collider2Id);
    if (!collider1 || !collider2) continue;
    const fns1 = collisionEventFns.get(collider1.id);
    if (fns1) for (let j = 0; j < fns1.length; j++) fns1[j](collider1, collider2, rec.started);
    const fns2 = collisionEventFns.get(collider2.id);
    if (fns2) for (let j = 0; j < fns2.length; j++) fns2[j](collider2, collider1, rec.started);
  }

  for (let i = 0; i < contactForces.length; i++) {
    const rec = contactForces[i];
    if (!colliderAPIs.has(rec.collider1Id) || !colliderAPIs.has(rec.collider2Id)) continue;
    const snapshot = new ContactForceEventSnapshot(rec);
    const fns1 = contactForceEventFns.get(rec.collider1Id);
    if (fns1) for (let j = 0; j < fns1.length; j++) fns1[j](snapshot);
    const fns2 = contactForceEventFns.get(rec.collider2Id);
    if (fns2) for (let j = 0; j < fns2.length; j++) fns2[j](snapshot);
  }
};

/** WORKER_THREAD: returns everything accumulated by drainAndDispatchEvents() since
 * the last call, and clears the accumulators. Called once per STEP message (which may run
 * multiple sub-steps) from physicsWorker.ts's STEP handler.
 */
export const drainPendingEventRecords = (): {
  collisions: CollisionEventRecord[];
  contactForces: ContactForceEventRecord[];
} => {
  const collisions = pendingCollisionRecords;
  const contactForces = pendingContactForceRecords;
  pendingCollisionRecords = [];
  pendingContactForceRecords = [];
  return { collisions, contactForces };
};
