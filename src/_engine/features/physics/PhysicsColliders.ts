// Colliders: their creates and deletes.

import { existsOrThrow } from '../../utils/Assert';
import { lwarn } from '../../utils/Logger';
import { messageWorkerAsync, toWireColliderParams } from './PhysicsMessaging';
import {
  cleanupWorkerColliderEventFns,
  colliders,
  registerWorkerColliderEventFns,
} from './PhysicsRegistry';
import { facade } from './PhysicsState';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type {
  CreateColliderResponse,
  CreateCollidersResponse,
  DeleteColliderResponse,
  DeleteCollidersResponse,
} from './protocol/PhysicsResponses';
import { ColliderProxyAPI } from './proxies/ColliderProxyAPI';
import type { ColliderAPI, ColliderParams } from './types/PhysicsColliderTypes';

/** Create a collider. */
export const createCollider = async (params: ColliderParams, parentId?: number) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a collider.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const coll = existsOrThrow(
      facade.engAPI?.createCollider(params, parentId),
      `Could not create a collider ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    colliders.set(coll.id, coll);
    return coll;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const res = await messageWorkerAsync<CreateColliderResponse>({
      type: PhysicsProtocolType.CREATE_COLLIDER,
      params: toWireColliderParams(params),
      parentId,
    });
    const collProxy = new ColliderProxyAPI(res.id, res.parentId, params.userData) as ColliderAPI;
    colliders.set(res.id, collProxy); // register locally
    registerWorkerColliderEventFns(res.id, params);
    return collProxy;
  }
  // Should not get here..
  throw new Error(
    `Could not create a collider (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Create a collider (sync). Only for main thread mode. */
export const createColliderSync = (params: ColliderParams, parentId?: number) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a collider.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const coll = existsOrThrow(
      facade.engAPI?.createCollider(params, parentId),
      `Could not create a collider ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    colliders.set(coll.id, coll);
    return coll;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use createColliderSync in worker mode. Use createCollider instead.');
  }
  // Should not get here..
  throw new Error(
    `Could not create a collider (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Create multiple colliders at once. */
export const createColliders = async (params: ColliderParams[]) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a collider.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const collAPIs = existsOrThrow(
      facade.engAPI?.createColliders(params),
      `Could not create colliders ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    // Registered like in WORKER_THREAD mode: deleteColliders skips ids it doesn't know
    for (const coll of collAPIs) colliders.set(coll.id, coll);
    return collAPIs;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const collIds = (
      await messageWorkerAsync<CreateCollidersResponse>({
        type: PhysicsProtocolType.CREATE_COLLIDERS,
        params: params.map(toWireColliderParams),
      })
    ).ids;
    existsOrThrow(
      collIds.length,
      `Could not create colliders ("WORKER_THREAD"). Params: ${JSON.stringify(params)}`
    );
    const collAPIs = [];
    for (let i = 0; i < collIds.length; i++) {
      const id = collIds[i];
      const collAPI = new ColliderProxyAPI(id, params[i].parentId, params[i].userData);
      collAPIs.push(collAPI);
      colliders.set(id, collAPI);
      registerWorkerColliderEventFns(id, params[i]);
    }
    return collAPIs;
  }
  // Should not get here..
  throw new Error(
    `Could not create colliders (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Create multiple colliders at once (sync). Only for main thread mode. */
export const createCollidersSync = (params: ColliderParams[]) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a collider.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const collAPIs = existsOrThrow(
      facade.engAPI?.createColliders(params),
      `Could not create colliders ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    // Registered like in WORKER_THREAD mode: deleteColliders skips ids it doesn't know
    for (const coll of collAPIs) colliders.set(coll.id, coll);
    return collAPIs;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use createCollidersSync in worker mode. Use createColliders instead.');
  }
  // Should not get here..
  throw new Error(
    `Could not create colliders (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Deletes a collider. Returns the id of the deleted colliderAPI, or undefined without a world (a
 * quiet no-op, see deleteRigidBody). */
export const deleteCollider = async (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  let deletedId: number | undefined = undefined;
  if (colliders.has(id)) colliders.delete(id);
  cleanupWorkerColliderEventFns(id);
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteCollider(id, wakeUp);
    deletedId = response?.id;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const response = await messageWorkerAsync<DeleteColliderResponse>({
      type: PhysicsProtocolType.DELETE_COLLIDER,
      id,
      wakeUp: wakeUp || false,
    });
    deletedId = response?.id;
  }
  if (deletedId !== id) {
    throw new Error(
      `Could not delete a collider, the returned id (${deletedId}) did not match the id: ${id}.`
    );
  }
  return deletedId;
};

/** Deletes a collider. Returns the id of the deleted colliderAPI (sync), or undefined without a world
 * (see deleteRigidBody). Only for main thread mode. */
export const deleteColliderSync = (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  let deletedId: number | undefined = undefined;
  if (colliders.has(id)) colliders.delete(id);
  cleanupWorkerColliderEventFns(id);
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteCollider(id, wakeUp);
    deletedId = response?.id;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use deleteColliderSync in worker mode. Use deleteCollider instead.');
  }
  if (deletedId !== id) {
    throw new Error(
      `Could not delete a collider, the returned id (${deletedId}) did not match the id: ${id}.`
    );
  }
  return deletedId;
};

/** Deletes multiple colliders. Returns the ids of the deleted colliderAPIs. Unknown ids are
 * skipped quietly, and without a world nothing happens (see deleteRigidBody). */
export const deleteColliders = async (allIds: number[], allWakeUps?: boolean[]) => {
  if (!facade.worldEnabled) return [];
  const ids: number[] = [];
  const wakeUps: boolean[] | undefined = allWakeUps ? [] : undefined;
  for (let i = 0; i < allIds.length; i++) {
    if (!colliders.has(allIds[i])) continue;
    ids.push(allIds[i]);
    wakeUps?.push(allWakeUps![i]);
  }
  if (!ids.length) return [];
  let deletedIds: number[] | undefined = undefined;
  for (let i = 0; i < ids.length; i++) {
    if (colliders.has(ids[i])) colliders.delete(ids[i]);
    cleanupWorkerColliderEventFns(ids[i]);
  }
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteColliders(ids, wakeUps);
    deletedIds = response?.ids;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const response = await messageWorkerAsync<DeleteCollidersResponse>({
      type: PhysicsProtocolType.DELETE_COLLIDERS,
      ids,
      wakeUps: ids.map((_, index) => Boolean(wakeUps && wakeUps[index])),
    });
    deletedIds = response?.ids;
  }
  if (deletedIds === undefined) {
    throw new Error(
      `Could not delete colliders, the returned ids was undefined for ids: ${ids.join(', ')}.`
    );
  }
  for (let i = 0; i < ids.length; i++) {
    if (deletedIds[i] !== ids[i]) {
      lwarn(
        `Could not delete all colliders, the returned id (${deletedIds[i]}) did not match the id: ${ids[i]}.`
      );
    }
  }
  return deletedIds;
};

/** Deletes multiple colliders. Returns the ids of the deleted colliderAPIs (sync); without a world
 * nothing happens (see deleteRigidBody). Only for main thread mode. */
export const deleteCollidersSync = (ids: number[], wakeUps?: boolean[]) => {
  if (!facade.worldEnabled) return [];
  if (!ids.length) return [];
  let deletedIds: number[] | undefined = undefined;
  for (let i = 0; i < ids.length; i++) {
    if (colliders.has(ids[i])) colliders.delete(ids[i]);
    cleanupWorkerColliderEventFns(ids[i]);
  }
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteColliders(ids, wakeUps);
    deletedIds = response?.ids;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use deleteCollidersSync in worker mode. Use deleteColliders instead.');
  }
  if (deletedIds === undefined) {
    throw new Error(
      `Could not delete colliders, the returned ids was undefined for ids: ${ids.join(', ')}.`
    );
  }
  for (let i = 0; i < ids.length; i++) {
    if (deletedIds[i] !== ids[i]) {
      lwarn(
        `Could not delete all colliders, the returned id (${deletedIds[i]}) did not match the id: ${ids[i]}.`
      );
    }
  }
  return deletedIds;
};
