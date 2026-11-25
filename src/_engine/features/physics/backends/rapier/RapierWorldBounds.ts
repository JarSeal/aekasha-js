// The Rapier backend's world bounds (p102): the box dynamic bodies must stay in, the bodies' own
// boxes (an entity's override), the check after every step that takes a body out of the simulation
// on the step it left its box, and the records of those exits for the main thread.

import type Rapier from '@dimforge/rapier3d-compat';
import type {
  BodyWorldBounds,
  OutOfBoundsRecord,
  OutOfBoundsSource,
  WorldBoundsBox,
} from '../../types/PhysicsWorldBoundsTypes';
import { getMultibodyLinks, isInMultibody } from './RapierMultibodyJoints';
import {
  backend,
  detachedBodies,
  getRigidBody,
  handleToRigidBodyId,
  rigidBodies,
} from './RapierState';

/** [minX, minY, minZ, maxX, maxY, maxZ], open sides ±Infinity; null while there are no bounds. */
let globalBounds: Float64Array | null = null;
/** The bodies' own bounds by body id, replacing the global ones: a box, or 'IGNORE' (never
 * checked). Kept through a detach (the REMOVED tier), forgotten with the body. */
const bodyBounds = new Map<number, Float64Array | 'IGNORE'>();
/** Bodies to check before the next step whatever their sleep state (a body created asleep never
 * becomes active by itself): the ones created, reattached or given their own bounds since. Reused. */
const queuedBodyIds: number[] = [];
/** The exits since the last drain (drainPendingOutOfBoundsRecords). */
let pendingRecords: OutOfBoundsRecord[] = [];
/** The drain's answer while nothing exited: never written to, so a drain allocates nothing. */
const NO_RECORDS: readonly OutOfBoundsRecord[] = Object.freeze([]);
/** The step check's finds, disabled after Rapier's iteration (its callback doesn't change the
 * world it iterates). Reused, so a step allocates no array. */
const exitedBodies: Rapier.RigidBody[] = [];
const exitedBodyIds: number[] = [];
const exitedSources: OutOfBoundsSource[] = [];

const toBoundsArray = (box: WorldBoundsBox): Float64Array | null => {
  const arr = new Float64Array([
    box.min?.x ?? -Infinity,
    box.min?.y ?? -Infinity,
    box.min?.z ?? -Infinity,
    box.max?.x ?? Infinity,
    box.max?.y ?? Infinity,
    box.max?.z ?? Infinity,
  ]);
  // A box open on every side checks nothing
  for (let i = 0; i < 3; i++) if (arr[i] !== -Infinity) return arr;
  for (let i = 3; i < 6; i++) if (arr[i] !== Infinity) return arr;
  return null;
};

/** Whether a translation is inside the bounds. Written as "inside", so a NaN translation (a
 * broken body) is outside. */
const isInside = (b: Float64Array, t: Rapier.Vector) =>
  t.x >= b[0] && t.y >= b[1] && t.z >= b[2] && t.x <= b[3] && t.y <= b[4] && t.z <= b[5];

/** resolveBounds' answer, reused: the box and where it comes from. */
const effective = { box: null as Float64Array | null, source: 'GLOBAL' as OutOfBoundsSource };

/** The box `id` must stay in (its own, else the global one) and where it comes from, written into
 * `effective`; false when it has none (no bounds, or its own say 'IGNORE'). */
const resolveBounds = (id: number) => {
  const own = bodyBounds.size ? bodyBounds.get(id) : undefined;
  if (own === 'IGNORE') return false;
  effective.box = own ?? globalBounds;
  effective.source = own ? 'ENTITY' : 'GLOBAL';
  return effective.box !== null;
};

/** Whether the body has an impulse joint: Rapier mis-solves the joints of a disabled body
 * (docs/issues/i250_rapier-joint-on-disabled-bodies-panics.md), so such a body is made FIXED. */
const isJointed = (rb: Rapier.RigidBody) => {
  let jointed = false;
  backend.world.impulseJoints.forEachJointHandleAttachedToRigidBody(rb.handle, () => {
    jointed = true;
  });
  return jointed;
};

/** Takes a multibody link's multibody out with it (p250 D6): Rapier panics on a fixed link,
 * ignores a link disabled alone, and panics with one branch disabled when an impulse joint joins
 * it to another (getMultibodyLinks), so every dynamic link is disabled and recorded, the ones taken
 * along with `takenWith`. */
const exitMultibody = (id: number, source: OutOfBoundsSource) => {
  const { stepCount: step } = backend;
  const links = getMultibodyLinks(id);
  for (let i = 0; i < links.length; i++) {
    const rb = getRigidBody(links[i]);
    if (!rb?.isEnabled()) continue;
    const t = rb.translation();
    rb.setEnabled(false);
    const record: OutOfBoundsRecord = {
      bodyId: links[i],
      step,
      x: t.x,
      y: t.y,
      z: t.z,
      source,
      frozen: false,
    };
    if (i > 0) record.takenWith = id;
    pendingRecords.push(record);
  }
};

/** Takes the body out of the simulation and records the exit. A body a multibody exit took out
 * earlier in the same check is skipped. */
const exitBody = (rb: Rapier.RigidBody, id: number, source: OutOfBoundsSource) => {
  if (!rb.isEnabled()) return;
  if (isInMultibody(id)) return exitMultibody(id, source);
  const t = rb.translation();
  const frozen = isJointed(rb);
  if (frozen) rb.setBodyType(backend.RAPIER.RigidBodyType.Fixed, false);
  else rb.setEnabled(false);
  const { stepCount: step } = backend;
  pendingRecords.push({ bodyId: id, step, x: t.x, y: t.y, z: t.z, source, frozen });
};

/** Checks one body by id now, whatever its sleep state: an enabled dynamic body outside its box
 * exits. A body not in the world (deleted, detached) is skipped. */
const checkBodyNow = (id: number) => {
  const handle = rigidBodies.get(id);
  const rb = handle === undefined ? undefined : backend.world.getRigidBody(handle);
  if (!rb?.isDynamic() || !rb.isEnabled() || !resolveBounds(id)) return;
  if (!isInside(effective.box!, rb.translation())) exitBody(rb, id, effective.source);
};

/** Rapier's active-body callback: notes an enabled dynamic body outside its box. A function of its
 * own, so a step allocates no closure. */
const noteActiveBody = (rb: Rapier.RigidBody) => {
  if (!rb.isDynamic() || !rb.isEnabled()) return;
  const id = handleToRigidBodyId.get(rb.handle);
  if (id === undefined || !resolveBounds(id) || isInside(effective.box!, rb.translation())) return;
  exitedBodies.push(rb);
  exitedBodyIds.push(id);
  exitedSources.push(effective.source);
};

/**
 * Sets (or clears, with null) the world bounds, and checks every enabled dynamic body against its
 * box at once, the sleeping ones included (the step's check sees only the awake ones). A box open
 * on every side is no bounds. The current world's: a new world starts without (deleteWorld).
 * @internal
 */
export const setWorldBounds = (box: WorldBoundsBox | null) => {
  globalBounds = box ? toBoundsArray(box) : null;
  if (!globalBounds) return;
  for (const id of rigidBodies.keys()) checkBodyNow(id);
};

/**
 * Sets (or clears, with null) a body's own bounds, which replace the global ones for it: a box (one
 * open on every side, like 'IGNORE', is never checked), or 'IGNORE'. The body is checked against
 * them before the next step, asleep or not. An id the world doesn't know (a deleted body) is
 * ignored; a detached one (the REMOVED tier) keeps them for its return.
 * @internal
 */
export const setBodyWorldBounds = (id: number, bounds: BodyWorldBounds | null) => {
  if (!rigidBodies.has(id) && !detachedBodies.has(id)) return;
  if (bounds === null) bodyBounds.delete(id);
  else bodyBounds.set(id, bounds === 'IGNORE' ? 'IGNORE' : toBoundsArray(bounds) ?? 'IGNORE');
  queueBodyCheck(id);
};

/**
 * Checks a body before the next step whatever its sleep state (a body created asleep never becomes
 * active by itself, so the step's check would never see it): a create's (createRigidBody), a
 * reattach's (RapierBodies.ts) and setBodyWorldBounds'. Queued, not checked now: an entity's own
 * bounds sent with its body's create (CREATE_PHYSICS_ENTITY) apply first.
 * @internal
 */
export const queueBodyCheck = (id: number) => {
  queuedBodyIds.push(id);
};

/**
 * Forgets a body's own bounds (its delete, RapierBodies.ts).
 * @internal
 */
export const forgetBodyWorldBounds = (id: number) => {
  bodyBounds.delete(id);
};

/**
 * Before a step (step(), RapierWorld.ts) and a drain: checks the bodies queued since the last call
 * (queueBodyCheck) and empties the queue. An exit found then is recorded on the step count the
 * world has (the steps run so far), as one found at a create.
 * @internal
 */
export const checkQueuedWorldBounds = () => {
  if (!queuedBodyIds.length) return;
  if (globalBounds || bodyBounds.size) {
    // checkBodyNow queues nothing, so the loop sees a fixed length
    for (let i = 0; i < queuedBodyIds.length; i++) checkBodyNow(queuedBodyIds[i]);
  }
  queuedBodyIds.length = 0;
};

/**
 * After a step (step(), RapierWorld.ts): takes every awake, enabled dynamic body outside its box
 * out of the simulation (FIXED when it has an impulse joint, else disabled; a multibody link with
 * its multibody, exitMultibody) and records it. One check of a
 * flag and a size without bounds. A sleeping body can't have moved, and an exited one isn't
 * checked again.
 * @internal
 */
export const checkWorldBounds = () => {
  if (!globalBounds && !bodyBounds.size) return;
  backend.world.forEachActiveRigidBody(noteActiveBody);
  for (let i = 0; i < exitedBodies.length; i++) {
    exitBody(exitedBodies[i], exitedBodyIds[i], exitedSources[i]);
  }
  exitedBodies.length = 0;
  exitedBodyIds.length = 0;
  exitedSources.length = 0;
};

/**
 * Returns (and clears) the exits recorded since the last call, in the order they happened, the
 * queued bodies checked first (queueBodyCheck). MAIN_THREAD: the facade delivers them at the start
 * of the next sub-step; WORKER_THREAD: the STEP handler pushes them with the events (EVENTS_PUSH).
 * @internal
 */
export const drainPendingOutOfBoundsRecords = (): readonly OutOfBoundsRecord[] => {
  checkQueuedWorldBounds();
  if (!pendingRecords.length) return NO_RECORDS;
  const records = pendingRecords;
  pendingRecords = [];
  return records;
};

/**
 * Drops the exits not drained yet, keeping the bounds (a snapshot restore: they describe the
 * replaced world's steps).
 * @internal
 */
export const clearPendingOutOfBoundsRecords = () => {
  pendingRecords = [];
};

/**
 * Forgets the bounds, the bodies' own, the queued checks and the exits not drained yet
 * (deleteWorld).
 * @internal
 */
export const clearWorldBounds = () => {
  globalBounds = null;
  bodyBounds.clear();
  queuedBodyIds.length = 0;
  pendingRecords = [];
};
