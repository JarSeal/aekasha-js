// Rigid bodies: their creates and deletes (with their colliders too), the REMOVED tier's detach
// and reattach, the reads at a step, and the transform buffer's capacity. Each operation branches
// on the worker target once: on MAIN_THREAD its async form runs its *Sync one.

import { existsOrThrow } from '../../utils/Assert';
import { createColliderSync, deleteCollidersSync, registerColliderProxy } from './PhysicsColliders';
import {
  messageWorkerAsync,
  messageWorkerAtStep,
  toWireColliderParams,
  toWireRigidBodyParams,
} from './PhysicsMessaging';
import {
  checkDeletedId,
  checkDeletedIds,
  forgetCollider,
  forgetJoint,
  forgetRigidBody,
  rigidBodies,
} from './PhysicsRegistry';
import { assertMainThread, assertWorldCreated, facade, isWorkerTarget } from './PhysicsState';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type {
  CreatePhysicsEntityResponse,
  CreateRigidBodiesResponse,
  CreateRigidBodyResponse,
  DeleteRigidBodiesResponse,
  DeleteRigidBodyResponse,
  RigidDetachResponse,
  RigidReadPositionsResponse,
  RigidReattachResponse,
} from './protocol/PhysicsResponses';
import { RigidBodyProxyAPI } from './proxies/RigidBodyProxyAPI';
import { RigidBodyTypeAPI } from './types/PhysicsBodyTypes';
import type {
  RigidBodyAPI,
  RigidBodyAttachState,
  RigidBodyParams,
  RigidBodyPose,
} from './types/PhysicsBodyTypes';
import type { ColliderAPI, ColliderParams } from './types/PhysicsColliderTypes';

/** Rigid body creates refused because the transform buffer was full (WORKER_THREAD), since boot. */
let refusedBodyCount = 0;

/**
 * Rejection reason of a rigid body create that found every transform-buffer slot taken
 * (`WORKER_THREAD` mode, p352): nothing of it was created. Raise `AppConfig.physics.maxBodies`,
 * or create the bodies that never move as `FIXED` (they take no slot).
 */
export class PhysicsCapacityError extends Error {
  /** @param maxBodies the buffer's capacity, `AppConfig.physics.maxBodies` */
  constructor(
    /** The buffer's capacity, `AppConfig.physics.maxBodies`. */
    public readonly maxBodies: number
  ) {
    super(
      `Physics transform buffer full: all ${maxBodies} slots are taken (AppConfig.physics.maxBodies). FIXED bodies take no slot.`
    );
    this.name = 'PhysicsCapacityError';
  }
}

/** Counts a refused create and throws its PhysicsCapacityError, if the worker refused it. */
const throwIfCapacityExceeded = (capacityExceeded: number | undefined) => {
  if (capacityExceeded === undefined) return;
  refusedBodyCount++;
  throw new PhysicsCapacityError(capacityExceeded);
};

/** A rigid body's creation type (`RigidBodyParams.rigidType`) as the API's enum. */
const toRigidBodyTypeAPI = (rigidType: RigidBodyParams['rigidType']): RigidBodyTypeAPI => {
  switch (rigidType) {
    case 'FIXED':
      return RigidBodyTypeAPI.Fixed;
    case 'POS_BASED':
      return RigidBodyTypeAPI.KinematicPositionBased;
    case 'VELO_BASED':
      return RigidBodyTypeAPI.KinematicVelocityBased;
    default:
      return RigidBodyTypeAPI.Dynamic;
  }
};

/** WORKER_THREAD: registers the proxy of a body the worker made (`slot` and `pose` its reply's). */
const registerBodyProxy = (
  id: number,
  slot: number,
  params: RigidBodyParams,
  pose: RigidBodyPose | undefined
): RigidBodyAPI => {
  const rbAPI = new RigidBodyProxyAPI(
    id,
    slot,
    params.userData,
    pose,
    toRigidBodyTypeAPI(params.rigidType),
    params.enabled ?? true
  );
  rigidBodies.set(id, rbAPI);
  return rbAPI;
};

/** What a body delete took along: forgets its colliders and the joints attached to it. */
const forgetBodyParts = (colliderIds: number[] = [], jointIds: number[] = []) => {
  for (let i = 0; i < colliderIds.length; i++) forgetCollider(colliderIds[i]);
  for (let i = 0; i < jointIds.length; i++) forgetJoint(jointIds[i]);
};

/** A body delete's reply (the backend's or the worker's). */
type BodyDeleteResult = { id?: number; colliderIds?: number[]; jointIds?: number[] } | undefined;
/** A delete-many's reply (the backend's or the worker's). */
type BodiesDeleteResult =
  | { ids?: number[]; colliderIds?: number[]; jointIds?: number[] }
  | undefined;

/**
 * The transform buffer's capacity (`WORKER_THREAD` mode, p352): slots taken by live non-fixed
 * bodies, `AppConfig.physics.maxBodies`, and the creates refused since boot because it was
 * full ({@link PhysicsCapacityError}). `undefined` in `MAIN_THREAD` mode, which has no buffer
 * and no cap. Walks every body: for debug readouts, not per frame.
 * @internal
 */
export const getPhysicsBodyCapacity = () => {
  if (!isWorkerTarget()) return undefined;
  let used = 0;
  for (const rb of rigidBodies.values()) {
    if (rb instanceof RigidBodyProxyAPI && rb.hasSlot) used++;
  }
  return { used, max: facade.state.maxBodies, refused: refusedBodyCount };
};

/**
 * Creates a rigid body (without colliders: {@link createRigidBodyWithColliders} or the
 * collider creates add them). Rejects without a world, and with a
 * {@link PhysicsCapacityError} when a `WORKER_THREAD` world's transform buffer is full.
 */
export const createRigidBody = async (params: RigidBodyParams): Promise<RigidBodyAPI> => {
  if (!isWorkerTarget()) return createRigidBodySync(params);
  assertWorldCreated('a rigid body');
  const res = await messageWorkerAsync<CreateRigidBodyResponse>({
    type: PhysicsProtocolType.CREATE_RIGID_BODY,
    params: toWireRigidBodyParams(params),
  });
  throwIfCapacityExceeded(res.capacityExceeded);
  return registerBodyProxy(res.id, res.slot, params, res.pose);
};

/**
 * {@link createRigidBody}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const createRigidBodySync = (params: RigidBodyParams): RigidBodyAPI => {
  assertWorldCreated('a rigid body');
  assertMainThread('createRigidBodySync', 'createRigidBody');
  const rbAPI = existsOrThrow(
    facade.engAPI?.createRigidBody(params),
    `Could not create a rigid body ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
  );
  rigidBodies.set(rbAPI.id, rbAPI);
  return rbAPI;
};

/**
 * Creates several rigid bodies at once (see {@link createRigidBody}). In `WORKER_THREAD` mode a
 * full transform buffer refuses them all.
 */
export const createRigidBodies = async (params: RigidBodyParams[]): Promise<RigidBodyAPI[]> => {
  if (!isWorkerTarget()) return createRigidBodiesSync(params);
  assertWorldCreated('a rigid body');
  const res = await messageWorkerAsync<CreateRigidBodiesResponse>({
    type: PhysicsProtocolType.CREATE_RIGID_BODIES,
    params: params.map(toWireRigidBodyParams),
  });
  throwIfCapacityExceeded(res.capacityExceeded);
  existsOrThrow(
    res.ids.length === params.length,
    `Could not create rigid bodies ("WORKER_THREAD"). Params: ${JSON.stringify(params)}`
  );
  return res.ids.map((id, i) => registerBodyProxy(id, res.slots[i], params[i], res.poses[i]));
};

/**
 * {@link createRigidBodies}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const createRigidBodiesSync = (params: RigidBodyParams[]): RigidBodyAPI[] => {
  assertWorldCreated('a rigid body');
  assertMainThread('createRigidBodiesSync', 'createRigidBodies');
  const rbAPIs = existsOrThrow(
    facade.engAPI?.createRigidBodies(params),
    `Could not create rigid bodies ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
  );
  for (const rbAPI of rbAPIs) rigidBodies.set(rbAPI.id, rbAPI);
  return rbAPIs;
};

/** A body delete's reply checked (its id), and its colliders and joints forgotten. */
const finishBodyDelete = (id: number, res: BodyDeleteResult) => {
  checkDeletedId('a rigid body', id, res?.id);
  forgetBodyParts(res?.colliderIds, res?.jointIds);
  return id;
};

/**
 * Deletes a rigid body, with its colliders and the joints attached to it. Resolves with its id,
 * or undefined (a quiet no-op) without a world or a body with that id, eg. a late delete of a
 * body whose world has already been replaced (a scene load).
 */
export const deleteRigidBody = async (id: number) => {
  if (!facade.worldEnabled || !rigidBodies.has(id)) return undefined;
  if (!isWorkerTarget()) return deleteRigidBodySync(id);
  forgetRigidBody(id);
  const res = await messageWorkerAsync<DeleteRigidBodyResponse>({
    type: PhysicsProtocolType.DELETE_RIGID_BODY,
    id,
  });
  return finishBodyDelete(id, res);
};

/**
 * {@link deleteRigidBody}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * Undefined without a world.
 * @internal
 */
export const deleteRigidBodySync = (id: number) => {
  if (!facade.worldEnabled) return undefined;
  assertMainThread('deleteRigidBodySync', 'deleteRigidBody');
  forgetRigidBody(id);
  return finishBodyDelete(id, facade.engAPI?.deleteRigidBody(id));
};

/** A delete-many's reply checked, and the bodies' colliders and joints forgotten. */
const finishBodiesDelete = (ids: number[], res: BodiesDeleteResult) => {
  const deletedIds = checkDeletedIds('rigid bodies', ids, res?.ids);
  forgetBodyParts(res?.colliderIds, res?.jointIds);
  return deletedIds;
};

/**
 * Deletes several rigid bodies (see {@link deleteRigidBody}). Resolves with the deleted ids;
 * without a world nothing happens.
 */
export const deleteRigidBodies = async (ids: number[]) => {
  if (!facade.worldEnabled || !ids.length) return [];
  if (!isWorkerTarget()) return deleteRigidBodiesSync(ids);
  for (let i = 0; i < ids.length; i++) forgetRigidBody(ids[i]);
  const res = await messageWorkerAsync<DeleteRigidBodiesResponse>({
    type: PhysicsProtocolType.DELETE_RIGID_BODIES,
    ids,
  });
  return finishBodiesDelete(ids, res);
};

/**
 * {@link deleteRigidBodies}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const deleteRigidBodiesSync = (ids: number[]) => {
  if (!facade.worldEnabled || !ids.length) return [];
  assertMainThread('deleteRigidBodiesSync', 'deleteRigidBodies');
  for (let i = 0; i < ids.length; i++) forgetRigidBody(ids[i]);
  return finishBodiesDelete(ids, facade.engAPI?.deleteRigidBodies(ids));
};

/**
 * For the REMOVED physics tier (p352, PhysicsTiers.ts): takes a body and its colliders out of
 * the world with their state, ids and proxies kept (engine side), and frees its transform-buffer
 * slot. Resolves with its pose, or undefined when nothing was detached or a later
 * detach/reattach of the body has overtaken this one. In WORKER_THREAD mode, called from an
 * APP_PHYSICS_STEP system, it runs right before that sub-step.
 * @internal
 */
export const detachRigidBody = async (id: number): Promise<RigidBodyPose | undefined> => {
  if (!facade.worldEnabled) return undefined;
  if (!isWorkerTarget()) return detachRigidBodySync(id);
  const rb = rigidBodies.get(id);
  if (!(rb instanceof RigidBodyProxyAPI)) return undefined;
  const generation = rb._detach();
  const res = await messageWorkerAtStep<RigidDetachResponse>({
    type: PhysicsProtocolType.RIGID_DETACH,
    id,
  });
  return rb._isAttachGeneration(generation) ? res.pose : undefined;
};

/**
 * {@link detachRigidBody}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const detachRigidBodySync = (id: number) => {
  assertMainThread('detachRigidBodySync', 'detachRigidBody');
  return facade.worldEnabled ? facade.engAPI?.detachRigidBody(id) : undefined;
};

/**
 * For the REMOVED physics tier (p352): puts a detached body ({@link detachRigidBody}) back, as
 * it was detached except for `state`. Resolves with its pose, or undefined when it wasn't
 * detached or a later detach/reattach has overtaken this one. Rejects with a
 * {@link PhysicsCapacityError} when a WORKER_THREAD world's transform buffer is full: the body
 * stays detached. Runs at the sub-step like detachRigidBody.
 * @internal
 */
export const reattachRigidBody = async (
  id: number,
  state: RigidBodyAttachState
): Promise<RigidBodyPose | undefined> => {
  if (!facade.worldEnabled) return undefined;
  if (!isWorkerTarget()) return reattachRigidBodySync(id, state);
  const rb = rigidBodies.get(id);
  if (!(rb instanceof RigidBodyProxyAPI)) return undefined;
  const generation = rb._beginReattach();
  const res = await messageWorkerAtStep<RigidReattachResponse>({
    type: PhysicsProtocolType.RIGID_REATTACH,
    id,
    state,
  });
  if (!rb._isAttachGeneration(generation)) return undefined;
  throwIfCapacityExceeded(res.capacityExceeded);
  if (!res.pose) return undefined;
  rb._attach(res.slot, res.pose, state);
  return res.pose;
};

/**
 * {@link reattachRigidBody}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode),
 * which has no capacity limit.
 * @internal
 */
export const reattachRigidBodySync = (id: number, state: RigidBodyAttachState) => {
  assertMainThread('reattachRigidBodySync', 'reattachRigidBody');
  return facade.worldEnabled ? facade.engAPI?.reattachRigidBody(id, state) : undefined;
};

/**
 * The bodies' translations (x, y, z per id, in order; NaN for an unknown id; a REMOVED-tier body
 * where it was taken out), read on a fixed step: called from an APP_PHYSICS_STEP system, they
 * are read right before that sub-step runs, in both worker targets, so both get the same values
 * (Rapier's own f32). MAIN_THREAD reads at the call; WORKER_THREAD resolves with the worker's
 * reply, a frame or more later. Outside a sub-step the worker reads before the frame's first
 * step. Without a world it resolves with NaNs. For p343's deterministic tier policy.
 */
export const readBodyPositionsAtStep = async (ids: number[]): Promise<Float32Array> => {
  if (!facade.worldEnabled) return new Float32Array(ids.length * 3).fill(NaN);
  if (!isWorkerTarget()) return readBodyPositionsSync(ids, new Float32Array(ids.length * 3));
  const res = await messageWorkerAtStep<RigidReadPositionsResponse>({
    type: PhysicsProtocolType.RIGID_READ_POSITIONS,
    ids,
  });
  return res.positions;
};

/**
 * {@link readBodyPositionsAtStep}, synchronous, into `out` (3 floats per id): MAIN_THREAD only (it
 * throws in WORKER_THREAD mode).
 * @internal
 */
export const readBodyPositionsSync = (ids: ArrayLike<number>, out: Float32Array) => {
  assertMainThread('readBodyPositionsSync', 'readBodyPositionsAtStep');
  if (!facade.worldEnabled || !facade.engAPI) return out.fill(NaN);
  return facade.engAPI.readBodyPositions(ids, out);
};

/**
 * What {@link createRigidBodyWithColliders} creates.
 * @internal
 */
export type RigidBodyWithColliders = {
  /** The body, when one was asked for. */
  rigidBody?: RigidBodyAPI;
  /** The colliders, in the order of their params. */
  colliders: ColliderAPI[];
};

/**
 * Creates an optional rigid body and its colliders together (with a body, every collider's
 * parentId is set to it), all or nothing: when a collider throws, what was made before it is
 * deleted. In WORKER_THREAD mode this is one message, posted synchronously by this call: the
 * worker creates everything in the order these calls were made (like MAIN_THREAD does), and no
 * step can ever run between a body and its colliders.
 * @internal
 */
export const createRigidBodyWithColliders = async (
  rigidBodyParams: RigidBodyParams | undefined,
  colliderParams: ColliderParams[]
): Promise<RigidBodyWithColliders> => {
  if (!isWorkerTarget()) return createRigidBodyWithCollidersSync(rigidBodyParams, colliderParams);
  assertWorldCreated('a rigid body or colliders');
  const res = await messageWorkerAsync<CreatePhysicsEntityResponse>({
    type: PhysicsProtocolType.CREATE_PHYSICS_ENTITY,
    rigidBody: toWireRigidBodyParams(rigidBodyParams),
    colliders: colliderParams.map(toWireColliderParams),
  });
  throwIfCapacityExceeded(res.capacityExceeded);
  const rigidBody =
    rigidBodyParams && res.id !== undefined
      ? registerBodyProxy(res.id, res.slot, rigidBodyParams, res.pose)
      : undefined;
  const colliders = res.colliderIds.map((id, i) =>
    registerColliderProxy(id, rigidBody?.id ?? colliderParams[i].parentId, colliderParams[i])
  );
  return { rigidBody, colliders };
};

/**
 * {@link createRigidBodyWithColliders}, synchronous: MAIN_THREAD only (it throws in
 * WORKER_THREAD mode).
 * @internal
 */
export const createRigidBodyWithCollidersSync = (
  rigidBodyParams: RigidBodyParams | undefined,
  colliderParams: ColliderParams[]
): RigidBodyWithColliders => {
  assertWorldCreated('a rigid body or colliders');
  const rigidBody = rigidBodyParams ? createRigidBodySync(rigidBodyParams) : undefined;
  const params = rigidBody
    ? colliderParams.map((p) => ({ ...p, parentId: rigidBody.id }))
    : colliderParams;
  // All or nothing: a collider that throws takes the body (and its colliders) or the colliders
  // made before it along
  const colls: ColliderAPI[] = [];
  try {
    for (let i = 0; i < params.length; i++) colls.push(createColliderSync(params[i]));
  } catch (err) {
    if (rigidBody) deleteRigidBodySync(rigidBody.id);
    else if (colls.length) deleteCollidersSync(colls.map((c) => c.id));
    throw err;
  }
  return { rigidBody, colliders: colls };
};
