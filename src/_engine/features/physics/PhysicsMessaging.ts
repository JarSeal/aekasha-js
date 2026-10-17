// The facade's side of the worker's transport (WORKER_THREAD mode, p614 D5): requests and their
// replies, one-way commands and their capture per sub-step, the worker's pushes, and the plain
// data every message carries.

import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lerror } from '../../utils/Logger';
import { createNewResolver, rejectRequest, resolveRequest } from '../../utils/PromiseResolver';
import { PhysicsDebugStateBuffer } from './PhysicsDebugStateBuffer';
import { colliders, workerCollisionEventFns, workerContactForceEventFns } from './PhysicsRegistry';
import { facade } from './PhysicsState';
import { recordPushedStepStats } from './PhysicsStepStats';
import { PhysicsTransformBuffer } from './PhysicsTransformBuffer';
import { ValidProtocolTypes } from './PhysicsUtils';
import type { PhysicsDownProtocol } from './protocol/PhysicsDownProtocol';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type { EventsPushMessage } from './protocol/PhysicsResponses';
import type { PhysicsUpProtocol } from './protocol/PhysicsUpProtocol';
import type { PhysicsTransport } from './transport/PhysicsTransport';
import { createWorkerTransport } from './transport/WorkerTransport';
import type { RigidBodyParams } from './types/PhysicsBodyTypes';
import type { ColliderParams } from './types/PhysicsColliderTypes';
import type { PhysRotation } from './types/PhysicsCommonTypes';
import { ContactForceEventSnapshot } from './types/PhysicsEventTypes';
import type { JointParams } from './types/PhysicsJointTypes';

/** The channel to the worker (WORKER_THREAD mode, from initPhysics): every message to it and from
 * it goes through this (p614 D5). */
let workerTransport: PhysicsTransport<PhysicsUpProtocol, PhysicsDownProtocol> | null = null;
/** Requests sent to the worker (or captured for a sub-step) and not settled yet: what stopPhysics
 * rejects. The resolvers themselves are PromiseResolver's, shared with the assets API. */
const pendingWorkerRequestIds = new Set<number>();

/**
 * initPhysics, WORKER_THREAD: opens the transport around the started worker and listens to it.
 * @internal
 */
export const openWorkerTransport = (worker: Worker) => {
  workerTransport = createWorkerTransport<PhysicsUpProtocol, PhysicsDownProtocol>(worker);
  workerTransport.onMessage(onWorkerMessage);
};

/**
 * Whether the worker's transport is open (WORKER_THREAD mode, from initPhysics until stopPhysics).
 * @internal
 */
export const hasWorkerTransport = () => workerTransport !== null;

/**
 * stopPhysics: closes the transport (which terminates the worker) and rejects every request still
 * waiting for a reply. A no-op without one.
 * @internal
 */
export const closeWorkerTransport = () => {
  if (!workerTransport) return;
  workerTransport.close();
  workerTransport = null;
  const reason = new Error('Physics was stopped (the engine was unmounted): no reply will come.');
  for (const requestId of [...pendingWorkerRequestIds]) rejectRequest(requestId, reason);
};

/** postMessage structured-clones only own fields, and a THREE.Quaternion keeps its values in
 * private `_x/_y/_z/_w` fields behind prototype getters — posted as-is, the worker would receive
 * a rotation with no x/y/z/w at all. Every rotation crossing to the worker goes through this.
 * @internal
 */
export const toPlainRot = (rot: PhysRotation): PhysRotation => ({
  x: rot.x,
  y: rot.y,
  z: rot.z,
  w: rot.w,
});

/** While stepPhysics() runs a sub-step's APP_PHYSICS_STEP callback in WORKER_THREAD mode, the
 * one-way commands it issues are collected here instead of posted, and then travel inside that
 * frame's single STEP message to be replayed right before their own sub-step. (Request/response
 * calls via messageWorkerAsync are still posted immediately — they reach the worker ahead of
 * the STEP message, i.e. before this frame's first sub-step.) */
let substepCommandCapture: PhysicsUpProtocol[] | null = null;

/**
 * stepPhysics, WORKER_THREAD: starts capturing the one-way commands of a sub-step's
 * APP_PHYSICS_STEP callback (see substepCommandCapture).
 * @internal
 */
export const beginSubStepCapture = () => {
  substepCommandCapture = [];
};

/**
 * Ends the capture {@link beginSubStepCapture} started, and returns its commands.
 * @internal
 */
export const endSubStepCapture = () => {
  const captured = substepCommandCapture ?? [];
  substepCommandCapture = null;
  return captured;
};

/**
 * A one-way command to the worker (no reply). Inside a sub-step's APP_PHYSICS_STEP callback it's
 * captured instead, and replayed right before that sub-step.
 * @internal
 */
export const messageWorker = (message: PhysicsUpProtocol) => {
  if (!workerTransport) return;
  if (substepCommandCapture) {
    // Cloned now, as postMessage would: callers reuse scratch vectors (e.g. a platform's
    // kinematic target), and the STEP message is only cloned after every sub-step's systems
    // ran, so a captured reference would carry the last sub-step's value into all of them.
    substepCommandCapture.push(structuredClone(message));
    return;
  }
  workerTransport.send(message);
};

/** A worker request's resolver id, kept in pendingWorkerRequestIds until the request settles. */
const createWorkerRequest = <T>(resolve: (value: T) => void, reject: (reason: unknown) => void) => {
  const requestId: number = createNewResolver(
    (value: T) => {
      pendingWorkerRequestIds.delete(requestId);
      resolve(value);
    },
    {
      reject: (reason) => {
        pendingWorkerRequestIds.delete(requestId);
        reject(reason);
      },
    }
  );
  pendingWorkerRequestIds.add(requestId);
  return requestId;
};

/** A request to the worker: settled by its reply, or rejected by the worker's ERROR for it (a throw
 * while handling it, see onWorkerMessage), or by stopPhysics.
 * @internal
 */
export const messageWorkerAsync = async <T>(message: PhysicsUpProtocol) =>
  new Promise<T>((resolve, reject) => {
    if (!workerTransport) {
      return reject(
        new Error(
          'Worker not found in messageWorkerAsync. Make sure you have initialized the worker before using messageWorkerAsync.'
        )
      );
    }
    const requestId = createWorkerRequest(resolve, reject);
    workerTransport.send({ ...message, requestId });
  });

/** A request that runs where a one-way command would (messageWorker): inside an APP_PHYSICS_STEP
 * sub-step it's captured and replayed right before that sub-step, and the worker replies from
 * the replay. So what it does lands on a fixed step, not on the frame's first one (p352).
 * @internal
 */
export const messageWorkerAtStep = async <T>(message: PhysicsUpProtocol) => {
  if (!substepCommandCapture) return messageWorkerAsync<T>(message);
  const capture = substepCommandCapture;
  return new Promise<T>((resolve, reject) => {
    const requestId = createWorkerRequest(resolve, reject);
    capture.push(structuredClone({ ...message, requestId }));
  });
};

const onWorkerMessage = (data: PhysicsDownProtocol) => {
  const type = data.type;
  const requestId = data.requestId;

  if (type === PhysicsProtocolType.ERROR) {
    // A request's error rejects it (its caller handles it); a one-way command's has no one to
    // reach, so it's logged
    if (requestId !== undefined) {
      if (rejectRequest(requestId, new Error(`Physics worker: ${data.message}`))) return;
    }
    lerror(`Error in physics worker, message: ${data.message}`);
    return;
  } else if (type === PhysicsProtocolType.TRANSFORMS_PUSH) {
    // Unsolicited push (MESSAGE_BATCH fallback) — no requestId, not a response to resolve.
    // The wrapper is built once per world and only re-pointed at each new copy after that.
    if (facade.transformBuffer) facade.transformBuffer.rebind(data.buffer);
    else facade.transformBuffer = new PhysicsTransformBuffer(facade.state.maxBodies, data.buffer);
    // Step stats (p027) ride along on this message in MESSAGE_BATCH mode, so the receipt
    // time here is the return leg's real arrival time. Only present while measuring.
    recordPushedStepStats(data);
    return;
  } else if (type === PhysicsProtocolType.EVENTS_PUSH) {
    // Unsolicited push, only ever sent when at least one event occurred that step — no
    // requestId, not a response to resolve.
    // Delivered by flushPhysicsEvents() at the start of the next sub-step, not right away.
    pendingEventPushes.push(data);
    return;
  } else if (type === PhysicsProtocolType.DEBUG_STATE_PUSH) {
    // Unsolicited push (MESSAGE_BATCH fallback) — only ever sent while debug-state
    // tracking is on. No requestId, not a response to resolve.
    facade.debugStateBuffer = new PhysicsDebugStateBuffer(facade.state.maxBodies, data.buffer);
    return;
  } else if (!ValidProtocolTypes.has(type)) {
    lerror(`Error in physics onWorkerMessage, unknown protocol type: ${type}`);
    return;
  }

  if (requestId === undefined) return;
  if (!resolveRequest(requestId, data) && IS_DEBUG_ENV) {
    lerror(
      `Error in physics onWorkerMessage, no pending request ${requestId} (protocol type: ${type}).`
    );
  }
};

let pendingEventPushes: EventsPushMessage[] = [];

/**
 * Drops the event pushes not delivered yet: a new world's, or a deleted one's.
 * @internal
 */
export const clearPendingEventPushes = () => {
  pendingEventPushes = [];
};

/**
 * Delivers every collision/contact-force event that has become available since the last call to
 * its registered callbacks. The main loop calls this once per fixed sub-step, after held-key
 * polling and before the APP_PHYSICS_STEP systems. Gameplay code depends on that order: e.g. on the
 * sub-step a character leaves a moving platform, its held-key move() still runs with the
 * pre-event "on platform" state (keeping the platform's velocity), and only the character tick
 * after it sees the ground sensor's "stopped touching". Dispatching straight after each step
 * would flip that state before move() and drop the platform's velocity from the jump.
 */
export const flushPhysicsEvents = () => {
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    facade.engAPI?.dispatchPendingEventRecords();
    return;
  }
  if (!pendingEventPushes.length) return;
  const pushes = pendingEventPushes;
  pendingEventPushes = [];
  for (let i = 0; i < pushes.length; i++) dispatchPushedEvents(pushes[i]);
};

/** Resolves an EVENTS_PUSH message's plain-data records back to ColliderAPIs (via the
 * locally-registered colliders map) and invokes each side's registered WORKER_THREAD
 * callbacks with the *other* collider as the second argument — mirrors EngineRapier.ts's
 * MAIN_THREAD drainAndDispatchEvents() dispatch. Silently skips any record naming a
 * collider id this thread doesn't (or no longer) know about. */
const dispatchPushedEvents = (data: EventsPushMessage) => {
  for (let i = 0; i < data.collisions.length; i++) {
    const rec = data.collisions[i];
    const collider1 = colliders.get(rec.collider1Id);
    const collider2 = colliders.get(rec.collider2Id);
    if (!collider1 || !collider2) continue;
    const fns1 = workerCollisionEventFns.get(rec.collider1Id);
    if (fns1) for (let j = 0; j < fns1.length; j++) fns1[j](collider1, collider2, rec.started);
    const fns2 = workerCollisionEventFns.get(rec.collider2Id);
    if (fns2) for (let j = 0; j < fns2.length; j++) fns2[j](collider2, collider1, rec.started);
  }

  for (let i = 0; i < data.contactForces.length; i++) {
    const rec = data.contactForces[i];
    const collider1 = colliders.get(rec.collider1Id);
    const collider2 = colliders.get(rec.collider2Id);
    if (!collider1 || !collider2) continue;
    const snapshot = new ContactForceEventSnapshot(rec);
    const fns1 = workerContactForceEventFns.get(rec.collider1Id);
    if (fns1) for (let j = 0; j < fns1.length; j++) fns1[j](snapshot);
    const fns2 = workerContactForceEventFns.get(rec.collider2Id);
    if (fns2) for (let j = 0; j < fns2.length; j++) fns2[j](snapshot);
  }
};

/** A RigidBodyParams for the postMessage boundary: its rotation as a plain object (a
 * THREE.Quaternion would arrive without x/y/z/w, see toPlainRot). Returns the original object
 * when it has no rotation.
 * @internal
 */
export const toWireRigidBodyParams = <T extends RigidBodyParams | undefined>(params: T): T =>
  params?.rotation ? { ...params, rotation: toPlainRot(params.rotation) } : params;

/** A JointParams for the postMessage boundary: a FIXED joint's frames as plain objects
 * (toPlainRot). Returns the original object for every other type.
 * @internal
 */
export const toWireJointParams = (params: JointParams): JointParams =>
  params.type === 'FIXED'
    ? { ...params, frame1: toPlainRot(params.frame1), frame2: toPlainRot(params.frame2) }
    : params;

/** Strips collisionEventFn/contactForceEventFn from a ColliderParams before it crosses
 * the postMessage boundary (functions can't be structured-cloned — this is what would
 * otherwise throw DataCloneError), replacing them with the boolean flags EngineRapier.ts
 * uses to still set up the right Rapier ActiveEvents on the worker side, and makes its
 * rotation a plain object (toPlainRot). Returns the original object unchanged when there's
 * nothing to change.
 * @internal
 */
export const toWireColliderParams = (colliderParams: ColliderParams): ColliderParams => {
  const params = colliderParams.rotation
    ? { ...colliderParams, rotation: toPlainRot(colliderParams.rotation) }
    : colliderParams;
  if (!params.collisionEventFn && !params.contactForceEventFn) return params;
  const { collisionEventFn, contactForceEventFn, ...rest } = params;
  return {
    ...rest,
    hasCollisionEventFn: Boolean(collisionEventFn) || rest.hasCollisionEventFn,
    hasContactForceEventFn: Boolean(contactForceEventFn) || rest.hasContactForceEventFn,
  } as ColliderParams;
};
