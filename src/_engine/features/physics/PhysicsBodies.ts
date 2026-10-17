// Rigid bodies: their creates and deletes (with their colliders too), the REMOVED tier's detach
// and reattach, the reads at a step, and the transform buffer's capacity.

import { existsOrThrow } from '../../utils/Assert';
import { lwarn } from '../../utils/Logger';
import { createColliderSync, deleteCollidersSync } from './PhysicsColliders';
import {
  messageWorkerAsync,
  messageWorkerAtStep,
  toWireColliderParams,
  toWireRigidBodyParams,
} from './PhysicsMessaging';
import {
  cleanupWorkerColliderEventFns,
  colliders,
  joints,
  registerWorkerColliderEventFns,
  rigidBodies,
} from './PhysicsRegistry';
import { facade } from './PhysicsState';
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
import { ColliderProxyAPI } from './proxies/ColliderProxyAPI';
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
  constructor(public readonly maxBodies: number) {
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

/**
 * The transform buffer's capacity (`WORKER_THREAD` mode, p352): slots taken by live non-fixed
 * bodies, `AppConfig.physics.maxBodies`, and the creates refused since boot because it was
 * full ({@link PhysicsCapacityError}). `undefined` in `MAIN_THREAD` mode, which has no buffer
 * and no cap. Walks every body: for debug readouts, not per frame.
 */
export const getPhysicsBodyCapacity = () => {
  if (facade.state.workerTarget !== 'WORKER_THREAD') return undefined;
  let used = 0;
  for (const rb of rigidBodies.values()) {
    if (rb instanceof RigidBodyProxyAPI && rb.hasSlot) used++;
  }
  return { used, max: facade.state.maxBodies, refused: refusedBodyCount };
};

/** Create a rigid body (async). */
export const createRigidBody = async (params: RigidBodyParams) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a rigid body.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const rbAPI = existsOrThrow(
      facade.engAPI?.createRigidBody(params),
      `Could not create a rigid body ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    rigidBodies.set(rbAPI.id, rbAPI);
    return rbAPI;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const res = await messageWorkerAsync<CreateRigidBodyResponse>({
      type: PhysicsProtocolType.CREATE_RIGID_BODY,
      params: toWireRigidBodyParams(params),
    });
    throwIfCapacityExceeded(res.capacityExceeded);
    const rbAPI = new RigidBodyProxyAPI(
      res.id,
      res.slot,
      params.userData,
      res.pose,
      toRigidBodyTypeAPI(params.rigidType)
    ) as RigidBodyAPI;
    rigidBodies.set(res.id, rbAPI);
    return rbAPI;
  }
  // Should not get here..
  throw new Error(
    `Could not create rigid bodies (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Create a rigid body (sync). Only for main thread mode. */
export const createRigidBodySync = (params: RigidBodyParams) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a rigid body.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const rbAPI = existsOrThrow(
      facade.engAPI?.createRigidBody(params),
      `Could not create a rigid body ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    rigidBodies.set(rbAPI.id, rbAPI);
    return rbAPI;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use createRigidBodySync in worker mode. Use createRigidBody instead.');
  }
  // Should not get here..
  throw new Error(
    `Could not create rigid bodies (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Create multiple rigid bodies at once (async). */
export const createRigidBodies = async (params: RigidBodyParams[]) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a rigid body.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const rbAPIs = existsOrThrow(
      facade.engAPI?.createRigidBodies(params),
      `Could not create a rigid bodies ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    for (const rbAPI of rbAPIs) rigidBodies.set(rbAPI.id, rbAPI);
    return rbAPIs;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const res = await messageWorkerAsync<CreateRigidBodiesResponse>({
      type: PhysicsProtocolType.CREATE_RIGID_BODIES,
      params: params.map(toWireRigidBodyParams),
    });
    throwIfCapacityExceeded(res.capacityExceeded);
    existsOrThrow(
      res.ids.length,
      `Could not create a rigid bodies ("WORKER_THREAD"). Params: ${JSON.stringify(params)}`
    );
    const rbAPIs = [];
    for (let i = 0; i < res.ids.length; i++) {
      const id = res.ids[i];
      const rbAPI = new RigidBodyProxyAPI(
        id,
        res.slots[i],
        params[i].userData,
        res.poses[i],
        toRigidBodyTypeAPI(params[i].rigidType)
      );
      rbAPIs.push(rbAPI);
      rigidBodies.set(id, rbAPI);
    }
    return rbAPIs;
  }
  // Should not get here..
  throw new Error(
    `Could not create rigid bodies (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Create multiple rigid bodies at once (sync). Only for main thread mode. */
export const createRigidBodiesSync = (params: RigidBodyParams[]) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a rigid body.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const rbAPIs = existsOrThrow(
      facade.engAPI?.createRigidBodies(params),
      `Could not create a rigid bodies ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    for (const rbAPI of rbAPIs) rigidBodies.set(rbAPI.id, rbAPI);
    return rbAPIs;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error(
      'Cannot use createRigidBodiesSync in worker mode. Use createRigidBodies instead.'
    );
  }
  // Should not get here..
  throw new Error(
    `Could not create rigid bodies (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Deletes a rigid body (and all child colliders). Returns the id of the deleted rigidBodyAPI,
 * or undefined (a quiet no-op) if there is no world or no body with that id, e.g. a late delete
 * of a body whose world has already been replaced (resetPhysicsWorld). */
export const deleteRigidBody = async (id: number) => {
  if (!facade.worldEnabled || !rigidBodies.has(id)) return undefined;
  let deletedId: number | undefined = undefined;
  let deletedColliderIds: number[] = [];
  let deletedJointIds: number[] = [];
  if (rigidBodies.has(id)) rigidBodies.delete(id);
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteRigidBody(id);
    deletedId = response?.id;
    deletedColliderIds = response?.colliderIds || [];
    deletedJointIds = response?.jointIds || [];
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const response = await messageWorkerAsync<DeleteRigidBodyResponse>({
      type: PhysicsProtocolType.DELETE_RIGID_BODY,
      id,
    });
    deletedId = response?.id;
    deletedColliderIds = response?.colliderIds || [];
    deletedJointIds = response?.jointIds || [];
  }
  if (deletedId !== id) {
    throw new Error(
      `Could not delete a rigid body, the returned id (${deletedId}) did not match the id: ${id}.`
    );
  }
  // Delete all possible colliderAPIs that are children of the rigid body
  for (let i = 0; i < deletedColliderIds.length; i++) {
    const collId = deletedColliderIds[i];
    if (colliders.has(collId)) colliders.delete(collId);
    cleanupWorkerColliderEventFns(collId);
  }
  // Delete all possible jointAPIs attached to the rigid body
  for (let i = 0; i < deletedJointIds.length; i++) {
    joints.delete(deletedJointIds[i]);
  }

  return deletedId;
};

/** Deletes a rigid body (and all child colliders). Returns the id of the deleted rigidBodyAPI (sync), or
 * undefined without a world (a quiet no-op, see deleteRigidBody). Only for main thread mode. */
export const deleteRigidBodySync = (id: number) => {
  if (!facade.worldEnabled) return undefined;
  let deletedId: number | undefined = undefined;
  let deletedColliderIds: number[] = [];
  let deletedJointIds: number[] = [];
  if (rigidBodies.has(id)) rigidBodies.delete(id);
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteRigidBody(id);
    deletedId = response?.id;
    deletedColliderIds = response?.colliderIds || [];
    deletedJointIds = response?.jointIds || [];
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use deleteRigidBodySync in worker mode. Use deleteRigidBody instead.');
  }
  if (deletedId !== id) {
    throw new Error(
      `Could not delete a rigid body, the returned id (${deletedId}) did not match the id: ${id}.`
    );
  }
  // Delete all possible colliderAPIs that are children of the rigid body
  for (let i = 0; i < deletedColliderIds.length; i++) {
    const collId = deletedColliderIds[i];
    if (colliders.has(collId)) colliders.delete(collId);
    cleanupWorkerColliderEventFns(collId);
  }
  // Delete all possible jointAPIs attached to the rigid body
  for (let i = 0; i < deletedJointIds.length; i++) {
    joints.delete(deletedJointIds[i]);
  }

  return deletedId;
};

/** Deletes multiple rigid bodies (and all child colliders). Returns the ids of the deleted rigidBodyAPIs;
 * without a world nothing happens (see deleteRigidBody). */
export const deleteRigidBodies = async (ids: number[]) => {
  if (!facade.worldEnabled) return [];
  if (!ids.length) return [];
  let deletedIds: number[] | undefined = undefined;
  let deletedColliderIds: number[] = [];
  let deletedJointIds: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (rigidBodies.has(ids[i])) rigidBodies.delete(ids[i]);
  }
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteRigidBodies(ids);
    deletedIds = response?.ids;
    deletedColliderIds = response?.colliderIds || [];
    deletedJointIds = response?.jointIds || [];
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const response = await messageWorkerAsync<DeleteRigidBodiesResponse>({
      type: PhysicsProtocolType.DELETE_RIGID_BODIES,
      ids,
    });
    deletedIds = response?.ids;
    deletedColliderIds = response?.colliderIds || [];
    deletedJointIds = response?.jointIds || [];
  }
  if (deletedIds === undefined) {
    throw new Error(
      `Could not delete rigid bodies, the returned ids was undefined for ids: ${ids.join(', ')}.`
    );
  }
  for (let i = 0; i < ids.length; i++) {
    if (deletedIds[i] !== ids[i]) {
      lwarn(
        `Could not delete all rigid bodies, the returned id (${deletedIds[i]}) did not match the id: ${ids[i]}.`
      );
    }
  }
  // Delete all possible colliderAPIs that are children of the rigid body
  for (let i = 0; i < deletedColliderIds.length; i++) {
    const collId = deletedColliderIds[i];
    if (colliders.has(collId)) colliders.delete(collId);
    cleanupWorkerColliderEventFns(collId);
  }
  // Delete all possible jointAPIs attached to the rigid bodies
  for (let i = 0; i < deletedJointIds.length; i++) {
    joints.delete(deletedJointIds[i]);
  }

  return deletedIds;
};

/** Deletes multiple rigid bodies (and all child colliders). Returns the ids of the deleted rigidBodyAPIs
 * (sync); without a world nothing happens (see deleteRigidBody). Only for main thread mode. */
export const deleteRigidBodiesSync = (ids: number[]) => {
  if (!facade.worldEnabled) return [];
  if (!ids.length) return [];
  let deletedIds: number[] | undefined = undefined;
  let deletedColliderIds: number[] = [];
  let deletedJointIds: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (rigidBodies.has(ids[i])) rigidBodies.delete(ids[i]);
  }
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteRigidBodies(ids);
    deletedIds = response?.ids;
    deletedColliderIds = response?.colliderIds || [];
    deletedJointIds = response?.jointIds || [];
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error(
      'Cannot use deleteRigidBodiesSync in worker mode. Use deleteRigidBodies instead.'
    );
  }
  if (deletedIds === undefined) {
    throw new Error(
      `Could not delete rigid bodies, the returned ids was undefined for ids: ${ids.join(', ')}.`
    );
  }
  for (let i = 0; i < ids.length; i++) {
    if (deletedIds[i] !== ids[i]) {
      lwarn(
        `Could not delete all rigid bodies, the returned id (${deletedIds[i]}) did not match the id: ${ids[i]}.`
      );
    }
  }
  // Delete all possible colliderAPIs that are children of the rigid body
  for (let i = 0; i < deletedColliderIds.length; i++) {
    const collId = deletedColliderIds[i];
    if (colliders.has(collId)) colliders.delete(collId);
    cleanupWorkerColliderEventFns(collId);
  }
  // Delete all possible jointAPIs attached to the rigid bodies
  for (let i = 0; i < deletedJointIds.length; i++) {
    joints.delete(deletedJointIds[i]);
  }

  return deletedIds;
};

/**
 * Engine internal, for the REMOVED physics tier (p352, PhysicsTiers.ts): takes a body and its
 * colliders out of the world with their state, ids and proxies kept (engine side), and frees
 * its transform-buffer slot. Resolves with its pose, or undefined when nothing was detached or
 * a later detach/reattach of the body has overtaken this one. In WORKER_THREAD mode, called
 * from an APP_PHYSICS_STEP system, it runs right before that sub-step.
 */
export const detachRigidBody = async (id: number): Promise<RigidBodyPose | undefined> => {
  if (!facade.worldEnabled) return undefined;
  if (facade.state.workerTarget === 'MAIN_THREAD') return detachRigidBodySync(id);
  const rb = rigidBodies.get(id);
  if (!(rb instanceof RigidBodyProxyAPI)) return undefined;
  const generation = rb._detach();
  const res = await messageWorkerAtStep<RigidDetachResponse>({
    type: PhysicsProtocolType.RIGID_DETACH,
    id,
  });
  return rb._isAttachGeneration(generation) ? res.pose : undefined;
};

/** detachRigidBody (sync). Only for main thread mode. */
export const detachRigidBodySync = (id: number) => {
  if (facade.state.workerTarget !== 'MAIN_THREAD') {
    throw new Error('Cannot use detachRigidBodySync in worker mode. Use detachRigidBody instead.');
  }
  return facade.worldEnabled ? facade.engAPI?.detachRigidBody(id) : undefined;
};

/**
 * Engine internal (p352): puts a detached body (detachRigidBody) back, as it was detached
 * except for `state`. Resolves with its pose, or undefined when it wasn't detached or a later
 * detach/reattach has overtaken this one. Rejects with a PhysicsCapacityError when a
 * WORKER_THREAD world's transform buffer is full: the body stays detached. Runs at the sub-step
 * like detachRigidBody.
 */
export const reattachRigidBody = async (
  id: number,
  state: RigidBodyAttachState
): Promise<RigidBodyPose | undefined> => {
  if (!facade.worldEnabled) return undefined;
  if (facade.state.workerTarget === 'MAIN_THREAD') return reattachRigidBodySync(id, state);
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
  rb._attach(res.slot, res.pose);
  return res.pose;
};

/** reattachRigidBody (sync). Only for main thread mode, which has no capacity limit. */
export const reattachRigidBodySync = (id: number, state: RigidBodyAttachState) => {
  if (facade.state.workerTarget !== 'MAIN_THREAD') {
    throw new Error(
      'Cannot use reattachRigidBodySync in worker mode. Use reattachRigidBody instead.'
    );
  }
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
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    return readBodyPositionsSync(ids, new Float32Array(ids.length * 3));
  }
  const res = await messageWorkerAtStep<RigidReadPositionsResponse>({
    type: PhysicsProtocolType.RIGID_READ_POSITIONS,
    ids,
  });
  return res.positions;
};

/** readBodyPositionsAtStep (sync), into `out` (3 floats per id). Only for main thread mode. */
export const readBodyPositionsSync = (ids: ArrayLike<number>, out: Float32Array) => {
  if (facade.state.workerTarget !== 'MAIN_THREAD') {
    throw new Error(
      'Cannot use readBodyPositionsSync in worker mode. Use readBodyPositionsAtStep instead.'
    );
  }
  if (!facade.worldEnabled || !facade.engAPI) return out.fill(NaN);
  return facade.engAPI.readBodyPositions(ids, out);
};

/** What createRigidBodyWithColliders() creates. */
export type RigidBodyWithColliders = { rigidBody?: RigidBodyAPI; colliders: ColliderAPI[] };

/**
 * Creates an optional rigid body and its colliders together (with a body, every collider's
 * parentId is set to it). In WORKER_THREAD mode this is one message, posted synchronously by
 * this call: the worker creates everything in the order these calls were made (like
 * MAIN_THREAD does), and no step can ever run between a body and its colliders.
 */
export const createRigidBodyWithColliders = async (
  rigidBodyParams: RigidBodyParams | undefined,
  colliderParams: ColliderParams[]
): Promise<RigidBodyWithColliders> => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a rigid body or colliders.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    return createRigidBodyWithCollidersSync(rigidBodyParams, colliderParams);
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const res = await messageWorkerAsync<CreatePhysicsEntityResponse>({
      type: PhysicsProtocolType.CREATE_PHYSICS_ENTITY,
      rigidBody: toWireRigidBodyParams(rigidBodyParams),
      colliders: colliderParams.map(toWireColliderParams),
    });
    throwIfCapacityExceeded(res.capacityExceeded);
    let rigidBody: RigidBodyAPI | undefined;
    if (rigidBodyParams && res.id !== undefined) {
      rigidBody = new RigidBodyProxyAPI(
        res.id,
        res.slot,
        rigidBodyParams.userData,
        res.pose,
        toRigidBodyTypeAPI(rigidBodyParams.rigidType)
      ) as RigidBodyAPI;
      rigidBodies.set(res.id, rigidBody);
    }
    const collAPIs: ColliderAPI[] = [];
    for (let i = 0; i < res.colliderIds.length; i++) {
      const id = res.colliderIds[i];
      const params = colliderParams[i];
      const collAPI = new ColliderProxyAPI(
        id,
        rigidBody?.id ?? params.parentId,
        params.userData
      ) as ColliderAPI;
      collAPIs.push(collAPI);
      colliders.set(id, collAPI);
      registerWorkerColliderEventFns(id, params);
    }
    return { rigidBody, colliders: collAPIs };
  }
  // Should not get here..
  throw new Error(
    `Could not create a rigid body with colliders (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** createRigidBodyWithColliders() (sync). Only for main thread mode. */
export const createRigidBodyWithCollidersSync = (
  rigidBodyParams: RigidBodyParams | undefined,
  colliderParams: ColliderParams[]
): RigidBodyWithColliders => {
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
