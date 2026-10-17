// The Rapier backend's colliders: create and delete.

import type Rapier from '@dimforge/rapier3d-compat';
import type { ColliderParams } from '../../types/PhysicsColliderTypes';
import { lwarn } from '../../../../utils/Logger';
import { EngineColliderProxyAPI } from './proxies/EngineColliderProxyAPI';
import { cleanupColliderEventRegistrations, registerColliderEventFns } from './RapierEvents';
import { paramsToShape } from './RapierShapes';
import { backend, colliderAPIs, colliders, getRigidBody, handleToColliderId } from './RapierState';

// The running id (see RapierState.ts' maps)
let nextColliderId = 0;

const getCombineRule = (rule?: 'MAX' | 'MULTIPLY' | 'MIN' | 'AVERAGE') => {
  switch (rule) {
    case 'MAX':
      return backend.RAPIER.CoefficientCombineRule.Max;
    case 'MULTIPLY':
      return backend.RAPIER.CoefficientCombineRule.Multiply;
    case 'MIN':
      return backend.RAPIER.CoefficientCombineRule.Min;
    case 'AVERAGE':
    default:
      return backend.RAPIER.CoefficientCombineRule.Average;
  }
};

/**
 * Creates a collider, on the body `parentIdArg` (or `params.parentId`) when given, and returns its
 * API object. `params` is only read, so a caller may reuse it.
 * @internal
 */
export const createCollider = (params: ColliderParams, parentIdArg?: number) => {
  // Read, never written back: a caller may reuse its params for another collider
  const parentId = parentIdArg ?? params.parentId;

  const shape = paramsToShape(params);

  const colliderDesc = new backend.RAPIER.ColliderDesc(shape);

  // For importing models: since Rapier shapes start on Y, we rotate them if the Blender spine was X or Z (for CYLINDER and CAPSULE)
  if (params.orientation) {
    colliderDesc.setRotation(
      new backend.RAPIER.Quaternion(
        params.orientation.x,
        params.orientation.y,
        params.orientation.z,
        params.orientation.w
      )
    );
  }

  if (params.density !== undefined) colliderDesc.setDensity(params.density);
  if (params.translation)
    colliderDesc.setTranslation(params.translation.x, params.translation.y, params.translation.z);
  if (params.rotation) colliderDesc.setRotation(params.rotation);
  // `!== undefined`: 0 is a friction (Rapier's default is 0.5)
  if (params.friction !== undefined) colliderDesc.setFriction(params.friction);
  if (params.restitution) colliderDesc.setRestitution(params.restitution);
  if (params.frictionCombineRule)
    colliderDesc.setFrictionCombineRule(getCombineRule(params.frictionCombineRule));
  if (params.restitutionCombineRule)
    colliderDesc.setRestitutionCombineRule(getCombineRule(params.restitutionCombineRule));
  if (params.isSensor !== undefined) colliderDesc.setSensor(params.isSensor);
  // A collider created disabled must never have been enabled at all: an enabled one would
  // collide and, more subtly, count towards its rigid body's mass until switched off.
  if (params.enabled !== undefined) colliderDesc.setEnabled(params.enabled);

  // In MAIN_THREAD mode the real callback is available directly on params (no serialization
  // boundary); in WORKER_THREAD mode the facade (toWireColliderParams) strips it and sends hasCollisionEventFn/
  // hasContactForceEventFn instead. Either one enables the corresponding active events.
  const hasCollisionFn = Boolean(params.collisionEventFn) || Boolean(params.hasCollisionEventFn);
  const hasContactForceFn =
    Boolean(params.contactForceEventFn) || Boolean(params.hasContactForceEventFn);

  let activeEvents: Rapier.ActiveEvents = backend.RAPIER.ActiveEvents.NONE;
  if (
    (params.enableCollisionActiveEvents || hasCollisionFn) &&
    (params.enableContactForceActiveEvents || hasContactForceFn)
  ) {
    activeEvents =
      backend.RAPIER.ActiveEvents.COLLISION_EVENTS |
      backend.RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
  } else if (params.enableCollisionActiveEvents || hasCollisionFn) {
    activeEvents = backend.RAPIER.ActiveEvents.COLLISION_EVENTS;
  } else if (params.enableContactForceActiveEvents || hasContactForceFn) {
    activeEvents = backend.RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
  }

  if (activeEvents !== backend.RAPIER.ActiveEvents.NONE) {
    colliderDesc.setActiveEvents(activeEvents);
    if (!backend.eventQueue) backend.eventQueue = new backend.RAPIER.EventQueue(true);
  }

  const collider = backend.world.createCollider(colliderDesc, getRigidBody(parentId));
  const id = nextColliderId;
  nextColliderId += 1;
  colliders.set(id, collider.handle);
  handleToColliderId.set(collider.handle, id);
  const colliderAPI = new EngineColliderProxyAPI(id, parentId, params.userData);
  // ColliderDesc's default density is 1
  colliderAPI.massMode = { density: params.density ?? 1 };
  colliderAPI.ownEnabled = params.enabled ?? true;

  registerColliderEventFns(id, params, hasCollisionFn, hasContactForceFn);
  colliderAPIs.set(id, colliderAPI);

  return colliderAPI;
};

/**
 * Creates the colliders in order, all or nothing: when one throws, the ones made before it are
 * deleted and the throw goes on (p614 A10).
 * @internal
 */
export const createColliders = (paramsArray: ColliderParams[]) => {
  const created: EngineColliderProxyAPI[] = [];
  try {
    for (let i = 0; i < paramsArray.length; i++) created.push(createCollider(paramsArray[i]));
  } catch (err) {
    if (created.length) deleteColliders(created.map((coll) => coll.id));
    throw err;
  }
  return created;
};

/**
 * Deletes a collider, waking its body only when `wakeUp`. An unknown id is a no-op (a debug-env
 * warning).
 * @internal
 */
export const deleteCollider = (id: number, wakeUp?: boolean) => {
  const collHandle = colliders.get(id);
  if (collHandle === undefined) {
    if (backend.isDebugEnvironment) {
      lwarn(`Trying to remove a non existing collider (no handle found), handle: ${collHandle}`);
    }
    return { id };
  }
  const coll = backend.world.getCollider(collHandle);
  if (!coll) {
    if (backend.isDebugEnvironment) {
      lwarn(`Trying to remove a non existing collider (no collider found), handle: ${collHandle}`);
    }
    colliders.delete(id);
    handleToColliderId.delete(collHandle);
    cleanupColliderEventRegistrations(id);
    return { id };
  }
  backend.world.removeCollider(coll, Boolean(wakeUp));
  colliderAPIs.delete(id);
  colliders.delete(id);
  handleToColliderId.delete(collHandle);
  cleanupColliderEventRegistrations(id);
  return { id };
};

/**
 * Deletes colliders as deleteCollider does, each waking its body when its `wakeUps` entry is true.
 * @internal
 */
export const deleteColliders = (ids: number[], wakeUps?: boolean[]) => {
  const deletedIds = [];
  for (let i = 0; i < ids.length; i++) {
    const { id } = deleteCollider(ids[i], Boolean(wakeUps && wakeUps[i]));
    if (id !== undefined) deletedIds.push(id);
  }
  return { ids: deletedIds };
};
