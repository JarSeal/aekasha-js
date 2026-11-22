// The Rapier backend's world bounds (p102): the box dynamic bodies must stay in, the check after
// every step that takes a body out of the simulation on the step it left the box, and the records
// of those exits for the main thread.

import type Rapier from '@dimforge/rapier3d-compat';
import type { OutOfBoundsRecord, WorldBoundsBox } from '../../types/PhysicsWorldBoundsTypes';
import { backend, handleToRigidBodyId, rigidBodies } from './RapierState';

/** [minX, minY, minZ, maxX, maxY, maxZ], open sides ±Infinity; null while there are no bounds. */
let globalBounds: Float64Array | null = null;
/** The exits since the last drain (drainPendingOutOfBoundsRecords). */
let pendingRecords: OutOfBoundsRecord[] = [];
/** The drain's answer while nothing exited: never written to, so a drain allocates nothing. */
const NO_RECORDS: readonly OutOfBoundsRecord[] = Object.freeze([]);
/** The step check's finds, disabled after Rapier's iteration (its callback doesn't change the
 * world it iterates). Reused, so a step allocates no array. */
const exitedBodies: Rapier.RigidBody[] = [];
const exitedBodyIds: number[] = [];

const toBoundsArray = (box: WorldBoundsBox): Float64Array | null => {
  const arr = new Float64Array([
    box.min?.x ?? -Infinity,
    box.min?.y ?? -Infinity,
    box.min?.z ?? -Infinity,
    box.max?.x ?? Infinity,
    box.max?.y ?? Infinity,
    box.max?.z ?? Infinity,
  ]);
  // A box open on every side checks nothing: no bounds, so the step skips the check
  for (let i = 0; i < 3; i++) if (arr[i] !== -Infinity) return arr;
  for (let i = 3; i < 6; i++) if (arr[i] !== Infinity) return arr;
  return null;
};

/** Whether a translation is inside the bounds. Written as "inside", so a NaN translation (a
 * broken body) is outside. */
const isInside = (b: Float64Array, t: Rapier.Vector) =>
  t.x >= b[0] && t.y >= b[1] && t.z >= b[2] && t.x <= b[3] && t.y <= b[4] && t.z <= b[5];

/** Whether the body has a joint: Rapier mis-solves the joints of a disabled body
 * (docs/issues/i250_rapier-joint-on-disabled-bodies-panics.md), so such a body is made FIXED. */
const isJointed = (rb: Rapier.RigidBody) => {
  let jointed = false;
  backend.world.impulseJoints.forEachJointHandleAttachedToRigidBody(rb.handle, () => {
    jointed = true;
  });
  return jointed;
};

/** Takes the body out of the simulation and records the exit. */
const exitBody = (rb: Rapier.RigidBody, id: number) => {
  const t = rb.translation();
  if (isJointed(rb)) rb.setBodyType(backend.RAPIER.RigidBodyType.Fixed, false);
  else rb.setEnabled(false);
  pendingRecords.push({
    bodyId: id,
    step: backend.stepCount,
    x: t.x,
    y: t.y,
    z: t.z,
    source: 'GLOBAL',
  });
};

/** Rapier's active-body callback: notes an enabled dynamic body outside the bounds. A function of
 * its own, so a step allocates no closure. */
const noteActiveBody = (rb: Rapier.RigidBody) => {
  if (!rb.isDynamic() || !rb.isEnabled() || isInside(globalBounds!, rb.translation())) return;
  const id = handleToRigidBodyId.get(rb.handle);
  if (id === undefined) return;
  exitedBodies.push(rb);
  exitedBodyIds.push(id);
};

/**
 * Sets (or clears, with null) the world bounds, and checks every enabled dynamic body against them
 * at once, the sleeping ones included (the step's check sees only the awake ones). A box open on
 * every side is no bounds. The current world's: a new world starts without (deleteWorld).
 * @internal
 */
export const setWorldBounds = (box: WorldBoundsBox | null) => {
  globalBounds = box ? toBoundsArray(box) : null;
  if (!globalBounds) return;
  for (const [id, handle] of rigidBodies) {
    const rb = backend.world.getRigidBody(handle);
    if (rb?.isDynamic() && rb.isEnabled() && !isInside(globalBounds, rb.translation())) {
      exitBody(rb, id);
    }
  }
};

/**
 * After a step (step(), RapierWorld.ts): takes every awake, enabled dynamic body outside the bounds
 * out of the simulation (FIXED when it has a joint, else disabled) and records it. One check of a
 * flag without bounds. A sleeping body can't have moved, and an exited one isn't checked again.
 * @internal
 */
export const checkWorldBounds = () => {
  if (!globalBounds) return;
  backend.world.forEachActiveRigidBody(noteActiveBody);
  for (let i = 0; i < exitedBodies.length; i++) exitBody(exitedBodies[i], exitedBodyIds[i]);
  exitedBodies.length = 0;
  exitedBodyIds.length = 0;
};

/**
 * A new body against the bounds (createRigidBody, RapierBodies.ts): one created asleep never
 * becomes active by itself, so the step's check would never see it.
 * @internal
 */
export const checkBodyAtCreate = (rb: Rapier.RigidBody, id: number) => {
  if (!globalBounds || !rb.isDynamic() || !rb.isEnabled()) return;
  if (!isInside(globalBounds, rb.translation())) exitBody(rb, id);
};

/**
 * Returns (and clears) the exits recorded since the last call, in the order they happened.
 * MAIN_THREAD: the facade delivers them at the start of the next sub-step; WORKER_THREAD: the STEP
 * handler pushes them with the events (EVENTS_PUSH).
 * @internal
 */
export const drainPendingOutOfBoundsRecords = (): readonly OutOfBoundsRecord[] => {
  if (!pendingRecords.length) return NO_RECORDS;
  const records = pendingRecords;
  pendingRecords = [];
  return records;
};

/**
 * Forgets the bounds and the exits not drained yet (deleteWorld).
 * @internal
 */
export const clearWorldBounds = () => {
  globalBounds = null;
  pendingRecords = [];
};
