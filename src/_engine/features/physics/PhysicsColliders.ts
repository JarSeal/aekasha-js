// Colliders: their creates and deletes. Each operation branches on the worker target once: on
// MAIN_THREAD its async form runs its *Sync one.

import { existsOrThrow } from '../../utils/Assert';
import { messageWorkerAsync, toWireColliderParams } from './PhysicsMessaging';
import {
  checkDeletedId,
  checkDeletedIds,
  colliders,
  forgetCollider,
  registerWorkerColliderEventFns,
} from './PhysicsRegistry';
import { assertMainThread, assertWorldCreated, facade, isWorkerTarget } from './PhysicsState';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type {
  CreateColliderResponse,
  CreateCollidersResponse,
  DeleteColliderResponse,
  DeleteCollidersResponse,
} from './protocol/PhysicsResponses';
import { ColliderProxyAPI } from './proxies/ColliderProxyAPI';
import type { ColliderAPI, ColliderParams } from './types/PhysicsColliderTypes';

/**
 * WORKER_THREAD: registers the proxy of a collider the worker made, with its callbacks.
 * @internal
 */
export const registerColliderProxy = (
  id: number,
  parentId: number | undefined,
  params: ColliderParams
): ColliderAPI => {
  const collAPI = new ColliderProxyAPI(id, parentId, params.userData);
  colliders.set(id, collAPI);
  registerWorkerColliderEventFns(id, params);
  return collAPI;
};

/**
 * Creates a collider, attached to the rigid body `parentId` (or `params.parentId`) when given.
 * Rejects without a world, and with the backend's error for invalid params (eg. a `TRIMESH`
 * without indices).
 */
export const createCollider = async (
  params: ColliderParams,
  parentId?: number
): Promise<ColliderAPI> => {
  if (!isWorkerTarget()) return createColliderSync(params, parentId);
  assertWorldCreated('a collider');
  const res = await messageWorkerAsync<CreateColliderResponse>({
    type: PhysicsProtocolType.CREATE_COLLIDER,
    params: toWireColliderParams(params),
    parentId,
  });
  return registerColliderProxy(res.id, res.parentId, params);
};

/**
 * {@link createCollider}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const createColliderSync = (params: ColliderParams, parentId?: number): ColliderAPI => {
  assertWorldCreated('a collider');
  assertMainThread('createColliderSync', 'createCollider');
  const coll = existsOrThrow(
    facade.engAPI?.createCollider(params, parentId),
    `Could not create a collider ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
  );
  colliders.set(coll.id, coll);
  return coll;
};

/**
 * Creates several colliders at once, each attached to its `params.parentId` when given. All or
 * nothing: when one throws, the ones made before it are deleted.
 */
export const createColliders = async (params: ColliderParams[]): Promise<ColliderAPI[]> => {
  if (!isWorkerTarget()) return createCollidersSync(params);
  assertWorldCreated('a collider');
  const { ids } = await messageWorkerAsync<CreateCollidersResponse>({
    type: PhysicsProtocolType.CREATE_COLLIDERS,
    params: params.map(toWireColliderParams),
  });
  existsOrThrow(
    ids.length === params.length,
    `Could not create colliders ("WORKER_THREAD"). Params: ${JSON.stringify(params)}`
  );
  return ids.map((id, i) => registerColliderProxy(id, params[i].parentId, params[i]));
};

/**
 * {@link createColliders}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const createCollidersSync = (params: ColliderParams[]): ColliderAPI[] => {
  assertWorldCreated('a collider');
  assertMainThread('createCollidersSync', 'createColliders');
  const collAPIs = existsOrThrow(
    facade.engAPI?.createColliders(params),
    `Could not create colliders ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
  );
  for (const coll of collAPIs) colliders.set(coll.id, coll);
  return collAPIs;
};

/**
 * Deletes a collider. Resolves with its id, or undefined without a world (a quiet no-op, see
 * {@link _engine/features/physics/PhysicsBodies!deleteRigidBody}).
 */
export const deleteCollider = async (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  if (!isWorkerTarget()) return deleteColliderSync(id, wakeUp);
  forgetCollider(id);
  const res = await messageWorkerAsync<DeleteColliderResponse>({
    type: PhysicsProtocolType.DELETE_COLLIDER,
    id,
    wakeUp: wakeUp || false,
  });
  return checkDeletedId('a collider', id, res?.id);
};

/**
 * {@link deleteCollider}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const deleteColliderSync = (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  assertMainThread('deleteColliderSync', 'deleteCollider');
  forgetCollider(id);
  return checkDeletedId('a collider', id, facade.engAPI?.deleteCollider(id, wakeUp)?.id);
};

/**
 * Deletes several colliders. Resolves with the deleted ids. Unknown ids are skipped quietly, and
 * without a world nothing happens (see
 * {@link _engine/features/physics/PhysicsBodies!deleteRigidBody}).
 */
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
  if (!isWorkerTarget()) return deleteCollidersSync(ids, wakeUps);
  for (let i = 0; i < ids.length; i++) forgetCollider(ids[i]);
  const res = await messageWorkerAsync<DeleteCollidersResponse>({
    type: PhysicsProtocolType.DELETE_COLLIDERS,
    ids,
    wakeUps: ids.map((_, index) => Boolean(wakeUps && wakeUps[index])),
  });
  return checkDeletedIds('colliders', ids, res?.ids);
};

/**
 * {@link deleteColliders}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * Unlike the async form, it doesn't skip unknown ids.
 * @internal
 */
export const deleteCollidersSync = (ids: number[], wakeUps?: boolean[]) => {
  if (!facade.worldEnabled || !ids.length) return [];
  assertMainThread('deleteCollidersSync', 'deleteColliders');
  for (let i = 0; i < ids.length; i++) forgetCollider(ids[i]);
  return checkDeletedIds('colliders', ids, facade.engAPI?.deleteColliders(ids, wakeUps)?.ids);
};
