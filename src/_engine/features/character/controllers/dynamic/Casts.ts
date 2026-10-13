import type { CharacterCastRecord } from '../../CharacterTypes';
import { getPhysicsState } from '../../../physics/PhysicsAPI';
import type { PhysVector } from '../../../physics/PhysicsAPITypes';
import type { RayDebugOpts } from '../../../../kernel/render/RayDebugTypes';

// The dynamic controller's casts (their records and the state of the one in flight), and the
// scratch it passes to the physics calls, shared by every character (ticks never interleave).
// Passing these is safe in both worker targets: MAIN_THREAD copies them into Rapier, and
// WORKER_THREAD clones them when the command is captured or posted (the ray helpers copy too).

const _vec = { x: 0, y: 0, z: 0 };
const _rot = { x: 0, y: 0, z: 0, w: 1 };
/** The cast origin scratch. */
export const castPos = { x: 0, y: 0, z: 0 };
/** The cast direction scratch. */
export const castDir = { x: 0, y: 0, z: 0 };
/** The casts' rotation: the identity quaternion. */
export const castRot = { w: 1, x: 0, y: 0, z: 0 };
/** Straight down. */
export const rayDown = { x: 0, y: -1, z: 0 };
/** The floor ray: from `castPos`, straight down. */
export const floorRay = { origin: castPos, dir: rayDown };

/** Whether the simulation runs in the physics worker (async casts, no sync body reads). */
export const isWorkerTarget = () => getPhysicsState().workerTarget === 'WORKER_THREAD';

/** The vector scratch, set: for one physics call (the next call overwrites it). */
export const setVec = (x: number, y: number, z: number) => {
  _vec.x = x;
  _vec.y = y;
  _vec.z = z;
  return _vec;
};

/** The rotation scratch, set: a plain object, not a THREE.Quaternion, whose values live in private
 * fields that don't survive the WORKER_THREAD postMessage structured clone. */
export const setRot = (x: number, y: number, z: number, w: number) => {
  _rot.x = x;
  _rot.y = y;
  _rot.z = z;
  _rot.w = w;
  return _rot;
};

/** Copies `from`'s x, y and z into `to`. */
export const copyVec = (to: PhysVector, from: PhysVector) => {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
};

/** One of a character's casts: its last result for diagnostics (`CharacterProbes`), the cast as
 * fired, whether one is in flight (WORKER_THREAD only) and its physics ray helper. */
export type CharacterCast = {
  /** The last result, as the controller used it. */
  readonly record: CharacterCastRecord;
  /** The cast as it was fired: the scratch is reused before the result arrives. */
  readonly shot: CharacterCastRecord;
  /** WORKER_THREAD: an async cast is in flight (at most one per cast). */
  inFlight: boolean;
  /** The physics ray helper id (drawn only while the physics helpers are on), set once the
   * character entity exists. */
  readonly debug: RayDebugOpts;
};

const createCastRecord = (): CharacterCastRecord => ({
  resolvedAtStep: -1,
  resolvedAt: 0,
  isCrouching: false,
  origin: { x: 0, y: 0, z: 0 },
  dir: { x: 0, y: 0, z: 0 },
  maxDistance: 0,
  isHit: false,
  distance: 0,
  point: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 0 },
});

/** A cast with no result yet, nothing in flight and no ray helper id. */
export const createCast = (): CharacterCast => ({
  record: createCastRecord(),
  shot: createCastRecord(),
  inFlight: false,
  debug: { id: '' },
});

/** Keeps a cast as it fires, in `shot`: the cast scratch is reused before the result arrives. */
export const recordCastShot = (
  shot: CharacterCastRecord,
  origin: PhysVector,
  dir: PhysVector,
  maxDistance: number,
  isCrouching: boolean
) => {
  copyVec(shot.origin, origin);
  copyVec(shot.dir, dir);
  shot.maxDistance = maxDistance;
  shot.isCrouching = isCrouching;
};

/** Publishes a cast's result into its record, with the cast it belongs to (`shot`), resolved at
 * `step`. A hit's point and normal are the caller's to write, right after (`distance` < 0 = a
 * miss). */
export const resolveCastRecord = (
  record: CharacterCastRecord,
  shot: CharacterCastRecord,
  distance: number,
  step: number
) => {
  record.resolvedAtStep = step;
  // Deprecated: step time in ms, from 1 so that 0 still means "no result"
  record.resolvedAt = (step + 1) * getPhysicsState().timestepRatio * 1000;
  copyVec(record.origin, shot.origin);
  copyVec(record.dir, shot.dir);
  record.maxDistance = shot.maxDistance;
  record.isCrouching = shot.isCrouching;
  record.isHit = distance >= 0;
  record.distance = Math.max(0, distance);
};
