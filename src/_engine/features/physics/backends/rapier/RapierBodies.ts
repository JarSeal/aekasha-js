// The Rapier backend's rigid bodies: create, delete, and the REMOVED tier's detach and reattach.

import type Rapier from '@dimforge/rapier3d-compat';
import {
  type PhysicsBodyActivity,
  type RigidBodyAttachState,
  type RigidBodyParams,
  type RigidBodyPose,
  RigidBodyTypeAPI,
} from '../../types/PhysicsBodyTypes';
import type { PhysVector } from '../../types/PhysicsCommonTypes';
import { lwarn } from '../../../../utils/Logger';
import { EngineColliderProxyAPI } from './proxies/EngineColliderProxyAPI';
import { EngineRigidBodyProxyAPI } from './proxies/EngineRigidBodyProxyAPI';
import { toRapierBodyType } from './RapierEnums';
import { cleanupColliderEventRegistrations } from './RapierEvents';
import {
  backend,
  colliderAPIs,
  colliders,
  type DetachedCollider,
  detachedBodies,
  getColliderAPI,
  getJointAPI,
  getRigidBody,
  handleToColliderId,
  handleToJointId,
  jointAPIs,
  joints,
  rigidBodies,
  rigidBodyAPIs,
} from './RapierState';

// The running id (see RapierState.ts' maps)
let nextRigidBodyId = 0;

/**
 * Awake and sleeping dynamic bodies right now (step stats, p352), written into `out`.
 * @internal
 */
export const countDynamicBodyActivity = (out: PhysicsBodyActivity) => {
  out.awake = 0;
  out.sleeping = 0;
  for (const rbAPI of rigidBodyAPIs.values()) {
    if (!rbAPI.isDynamicSync()) continue;
    if (rbAPI.isSleepingSync()) out.sleeping++;
    else out.awake++;
  }
  return out;
};

/**
 * Writes each body's translation into `out` (x, y, z per id, in order), also for a detached body
 * (the REMOVED tier: where it was taken out), NaN for an unknown id. Rapier stores f32, so the
 * values are exact in a Float32Array (p343: a deterministic tier policy reads them on a step).
 * @internal
 */
export const readBodyPositions = (ids: ArrayLike<number>, out: Float32Array) => {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const o = i * 3;
    const rb = getRigidBody(id);
    const pos = rb ? rb.translation() : detachedBodies.get(id)?.translation;
    out[o] = pos ? pos.x : NaN;
    out[o + 1] = pos ? pos.y : NaN;
    out[o + 2] = pos ? pos.z : NaN;
  }
  return out;
};

/**
 * Creates a rigid body with its params applied (each setter with `wakeUp`, default true) and
 * returns its API object.
 * @internal
 */
export const createRigidBody = (params: RigidBodyParams) => {
  let rigidBody: Rapier.RigidBody | undefined = undefined;
  let rigidBodyDesc: Rapier.RigidBodyDesc;

  switch (params.rigidType) {
    case 'DYNAMIC':
      rigidBodyDesc = backend.RAPIER.RigidBodyDesc.dynamic();
      rigidBody = backend.world.createRigidBody(rigidBodyDesc);
      break;
    case 'POS_BASED':
      rigidBodyDesc = backend.RAPIER.RigidBodyDesc.kinematicPositionBased();
      rigidBody = backend.world.createRigidBody(rigidBodyDesc);
      break;
    case 'VELO_BASED':
      rigidBodyDesc = backend.RAPIER.RigidBodyDesc.kinematicVelocityBased();
      rigidBody = backend.world.createRigidBody(rigidBodyDesc);
      break;
    case 'FIXED':
    default:
      rigidBodyDesc = backend.RAPIER.RigidBodyDesc.fixed();
      rigidBody = backend.world.createRigidBody(rigidBodyDesc);
      break;
  }

  const wakeUp = params.wakeUp !== false ? true : false;

  if (params.enabled !== undefined) rigidBody.setEnabled(params.enabled);
  if (params.translation) rigidBody.setTranslation(params.translation, wakeUp);
  if (params.rotation) rigidBody.setRotation(params.rotation, wakeUp);
  if (params.linvel) rigidBody.setLinvel(params.linvel, wakeUp);
  if (params.angvel) rigidBody.setAngvel(params.angvel, wakeUp);
  if (params.gravityScale !== undefined) rigidBody.setGravityScale(params.gravityScale, wakeUp);
  if (params.force) rigidBody.addForce(params.force, wakeUp);
  if (params.torqueForce) rigidBody.addTorque(params.torqueForce, wakeUp);
  if (params.forceAtPoint)
    rigidBody.addForceAtPoint(params.forceAtPoint.force, params.forceAtPoint.point, wakeUp);
  if (params.impulse) rigidBody.applyImpulse(params.impulse, wakeUp);
  if (params.torqueImpulse) rigidBody.applyTorqueImpulse(params.torqueImpulse, wakeUp);
  if (params.impulseAtPoint)
    rigidBody.applyImpulseAtPoint(params.impulseAtPoint.force, params.impulseAtPoint.point, wakeUp);
  if (params.additionalMass !== undefined)
    rigidBody.setAdditionalMass(params.additionalMass, wakeUp);
  if (params.lockTranslations) {
    rigidBody.lockTranslations(true, wakeUp);
    rigidBody.setEnabledTranslations(
      !params.lockTranslations.x,
      !params.lockTranslations.y,
      !params.lockTranslations.z,
      wakeUp
    );
  }
  if (params.lockRotations) {
    rigidBody.lockRotations(true, wakeUp);
    rigidBody.setEnabledRotations(
      !params.lockRotations.x,
      !params.lockRotations.y,
      !params.lockRotations.z,
      wakeUp
    );
    if (!rigidBody.userData) rigidBody.userData = {};
    (rigidBody.userData as { [key: string]: unknown }).lockRotationsX = params.lockRotations.x;
    (rigidBody.userData as { [key: string]: unknown }).lockRotationsY = params.lockRotations.y;
    (rigidBody.userData as { [key: string]: unknown }).lockRotationsZ = params.lockRotations.z;
  }
  if (params.linearDamping) rigidBody.setLinearDamping(params.linearDamping);
  if (params.angularDamping) rigidBody.setAngularDamping(params.angularDamping);
  if (params.dominance) rigidBody.setDominanceGroup(params.dominance);
  if (params.ccdEnabled) rigidBody.enableCcd(params.ccdEnabled);
  if (params.softCcdDistance) rigidBody.setSoftCcdPrediction(params.softCcdDistance);

  if (params.userData) rigidBody.userData = params.userData;

  const id = nextRigidBodyId;
  nextRigidBodyId += 1;
  rigidBodies.set(id, rigidBody.handle);
  const rigidBodyAPI = new EngineRigidBodyProxyAPI(id, params.userData);
  const lt = params.lockTranslations;
  if (lt) rigidBodyAPI.writeOnly.translationsEnabled = [!lt.x, !lt.y, !lt.z];
  const lr = params.lockRotations;
  if (lr) rigidBodyAPI.writeOnly.rotationsEnabled = [!lr.x, !lr.y, !lr.z];
  if (params.additionalMass !== undefined) {
    rigidBodyAPI.writeOnly.additionalMass = { mass: params.additionalMass };
  }
  rigidBodyAPIs.set(id, rigidBodyAPI);

  return rigidBodyAPI;
};

/**
 * Creates rigid bodies, in order. Not all or nothing: a throw leaves the bodies made before it.
 * @internal
 */
export const createRigidBodies = (paramsArray: RigidBodyParams[]) =>
  paramsArray.map((params) => createRigidBody(params));

/**
 * Deletes a body, live or detached, and with it its colliders and joints, whose ids it returns. An
 * unknown id is a no-op (a debug-env warning).
 * @internal
 */
export const deleteRigidBody = (id: number) => {
  const colliderIds: number[] = [];
  const jointIds: number[] = [];
  // A detached body (p352 REMOVED tier) is only its kept state: nothing is in the world
  const detached = detachedBodies.get(id);
  if (detached) {
    detachedBodies.delete(id);
    for (const coll of detached.colliders) {
      cleanupColliderEventRegistrations(coll.api.id);
      colliderIds.push(coll.api.id);
    }
    return { id, colliderIds, jointIds };
  }
  const rbHandle = rigidBodies.get(id);
  if (rbHandle === undefined) {
    if (backend.isDebugEnvironment) {
      lwarn(`Trying to remove a non existing rigid body (no handle found), handle: ${rbHandle}`);
    }
    return { id, colliderIds, jointIds };
  }
  const rb = backend.world.getRigidBody(rbHandle);
  if (!rb) {
    if (backend.isDebugEnvironment) {
      lwarn(
        `Trying to remove a non existing rigid body (no rigid body found), handle: ${rbHandle}`
      );
    }
    rigidBodies.delete(id);
    return { id, colliderIds, jointIds };
  }
  const colliderCount = rb.numColliders();
  for (let i = 0; i < colliderCount; i++) {
    const childHandle = rb.collider(i).handle;
    const colliderId = getColliderAPI(childHandle)?.id;
    if (colliderId !== undefined) {
      colliders.delete(colliderId);
      colliderAPIs.delete(colliderId);
      handleToColliderId.delete(childHandle);
      cleanupColliderEventRegistrations(colliderId);
      colliderIds.push(colliderId);
    }
  }
  // Rapier auto-removes this body's attached joints internally on removeRigidBody, but our
  // own shadow registries (joints/jointAPIs/handleToJointId) don't know about that — reap
  // them here first, mirroring the collider cleanup above.
  backend.world.impulseJoints.forEachJointHandleAttachedToRigidBody(rbHandle, (jointHandle) => {
    const jointId = getJointAPI(jointHandle)?.id;
    if (jointId !== undefined) {
      joints.delete(jointId);
      jointAPIs.delete(jointId);
      handleToJointId.delete(jointHandle);
      jointIds.push(jointId);
    }
  });
  backend.world.removeRigidBody(rb);
  rigidBodyAPIs.delete(id);
  rigidBodies.delete(id);
  return { id, colliderIds, jointIds };
};

/**
 * Deletes bodies as deleteRigidBody does, returning every deleted id.
 * @internal
 */
export const deleteRigidBodies = (ids: number[]) => {
  const deletedIds: number[] = [];
  const deletedColliderIds: number[] = [];
  const deletedJointIds: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const { id, colliderIds, jointIds } = deleteRigidBody(ids[i]);
    deletedIds.push(id);
    deletedColliderIds.push(...colliderIds);
    deletedJointIds.push(...jointIds);
  }
  return { ids: deletedIds, colliderIds: deletedColliderIds, jointIds: deletedJointIds };
};

/**
 * The REMOVED physics tier (p352): takes the body and its colliders out of the world. Their state
 * is read first, so reattachRigidBody can put them back exactly; their ids, proxies and event
 * callbacks are kept for that, outside the live maps (so nothing iterates or finds them). Rapier
 * has no getter for some of it (locked axes, additional mass, how a collider's mass was given): the
 * proxies mirror those writes. Refused (undefined) for a body with joints, which the removal would
 * delete.
 * @internal
 */
export const detachRigidBody = (id: number): RigidBodyPose | undefined => {
  const handle = rigidBodies.get(id);
  const api = rigidBodyAPIs.get(id);
  const rb = handle !== undefined ? backend.world.getRigidBody(handle) : undefined;
  if (!rb || !(api instanceof EngineRigidBodyProxyAPI)) return undefined;
  let hasJoints = false;
  backend.world.impulseJoints.forEachJointHandleAttachedToRigidBody(rb.handle, () => {
    hasJoints = true;
  });
  if (hasJoints) {
    if (backend.isDebugEnvironment)
      lwarn(`detachRigidBody: rigid body ${id} has joints, not detached.`);
    return undefined;
  }

  const detachedColliders: DetachedCollider[] = [];
  const colliderHandles: number[] = [];
  for (let i = 0; i < rb.numColliders(); i++) {
    const coll = rb.collider(i);
    const collId = handleToColliderId.get(coll.handle);
    const collAPI = collId !== undefined ? colliderAPIs.get(collId) : undefined;
    if (!(collAPI instanceof EngineColliderProxyAPI)) continue;
    colliderHandles.push(coll.handle);
    detachedColliders.push({
      api: collAPI,
      shape: coll.shape,
      translation: coll.translationWrtParent() ?? { x: 0, y: 0, z: 0 },
      rotation: coll.rotationWrtParent() ?? { x: 0, y: 0, z: 0, w: 1 },
      friction: coll.friction(),
      restitution: coll.restitution(),
      frictionCombineRule: coll.frictionCombineRule(),
      restitutionCombineRule: coll.restitutionCombineRule(),
      isSensor: coll.isSensor(),
      // Not coll.isEnabled(): that's false for every collider of a disabled body (the DISABLED
      // tier), and a collider re-created disabled stays so when its body is enabled again
      enabled: collAPI.ownEnabled,
      collisionGroups: coll.collisionGroups(),
      solverGroups: coll.solverGroups(),
      activeEvents: coll.activeEvents(),
      activeHooks: coll.activeHooks(),
      activeCollisionTypes: coll.activeCollisionTypes(),
      contactForceEventThreshold: coll.contactForceEventThreshold(),
      contactSkin: coll.contactSkin(),
    });
  }
  const translation = rb.translation();
  const rotation = rb.rotation();
  detachedBodies.set(id, {
    api,
    translation,
    rotation,
    linvel: rb.linvel(),
    angvel: rb.angvel(),
    isSleeping: rb.isSleeping(),
    gravityScale: rb.gravityScale(),
    linearDamping: rb.linearDamping(),
    angularDamping: rb.angularDamping(),
    dominanceGroup: rb.dominanceGroup(),
    isCcdEnabled: rb.isCcdEnabled(),
    softCcdPrediction: rb.softCcdPrediction(),
    additionalSolverIterations: rb.additionalSolverIterations(),
    userForce: rb.userForce(),
    userTorque: rb.userTorque(),
    userData: rb.userData,
    colliders: detachedColliders,
  });

  // Removes its colliders too
  backend.world.removeRigidBody(rb);
  rigidBodies.delete(id);
  rigidBodyAPIs.delete(id);
  for (let i = 0; i < detachedColliders.length; i++) {
    const collId = detachedColliders[i].api.id;
    colliders.delete(collId);
    colliderAPIs.delete(collId);
    handleToColliderId.delete(colliderHandles[i]);
  }
  return {
    pos: { x: translation.x, y: translation.y, z: translation.z },
    rot: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  };
};

const isZeroVector = (v: PhysVector) => v.x === 0 && v.y === 0 && v.z === 0;

/**
 * Puts a detached body (detachRigidBody) and its colliders back into the world, with the ids and
 * proxies they had and the state they were detached with, except for `state`'s body type and
 * enabled state (the tier it comes back to). A FIXED body comes back at rest, as a body switched to
 * FIXED does. Undefined when the body isn't detached.
 * @internal
 */
export const reattachRigidBody = (
  id: number,
  state: RigidBodyAttachState
): RigidBodyPose | undefined => {
  const detached = detachedBodies.get(id);
  if (!detached) return undefined;
  const { api, translation: t, rotation: r } = detached;
  const writeOnly = api.writeOnly;
  const desc = new backend.RAPIER.RigidBodyDesc(toRapierBodyType(state.bodyType))
    .setTranslation(t.x, t.y, t.z)
    .setRotation(r)
    .setGravityScale(detached.gravityScale)
    .setLinearDamping(detached.linearDamping)
    .setAngularDamping(detached.angularDamping)
    .setDominanceGroup(detached.dominanceGroup)
    .setCcdEnabled(detached.isCcdEnabled)
    .setSoftCcdPrediction(detached.softCcdPrediction)
    .setAdditionalSolverIterations(detached.additionalSolverIterations)
    .setEnabled(state.enabled)
    .enabledTranslations(...writeOnly.translationsEnabled)
    .enabledRotations(...writeOnly.rotationsEnabled);
  if (state.bodyType !== RigidBodyTypeAPI.Fixed) {
    // The sleep state too: a resting body put back awake would settle again, differently
    desc
      .setLinvel(detached.linvel.x, detached.linvel.y, detached.linvel.z)
      .setAngvel(detached.angvel)
      .setSleeping(detached.isSleeping);
  }
  const additionalMass = writeOnly.additionalMass;
  if (additionalMass && 'centerOfMass' in additionalMass) {
    desc.setAdditionalMassProperties(
      additionalMass.mass,
      additionalMass.centerOfMass,
      additionalMass.principalAngularInertia,
      additionalMass.angularInertiaLocalFrame
    );
  } else if (additionalMass) {
    desc.setAdditionalMass(additionalMass.mass);
  }

  const rb = backend.world.createRigidBody(desc);
  rb.userData = detached.userData;
  // Without waking it: a sleeping body keeps its user forces asleep too
  if (!isZeroVector(detached.userForce)) rb.addForce(detached.userForce, false);
  if (!isZeroVector(detached.userTorque)) rb.addTorque(detached.userTorque, false);
  rigidBodies.set(id, rb.handle);
  api._rebind(rb);
  rigidBodyAPIs.set(id, api);

  for (const c of detached.colliders) {
    const collDesc = new backend.RAPIER.ColliderDesc(c.shape)
      .setTranslation(c.translation.x, c.translation.y, c.translation.z)
      .setRotation(c.rotation)
      .setFriction(c.friction)
      .setRestitution(c.restitution)
      .setFrictionCombineRule(c.frictionCombineRule)
      .setRestitutionCombineRule(c.restitutionCombineRule)
      .setSensor(c.isSensor)
      .setEnabled(c.enabled)
      .setCollisionGroups(c.collisionGroups)
      .setSolverGroups(c.solverGroups)
      .setActiveEvents(c.activeEvents)
      .setActiveHooks(c.activeHooks)
      .setActiveCollisionTypes(c.activeCollisionTypes)
      .setContactForceEventThreshold(c.contactForceEventThreshold)
      .setContactSkin(c.contactSkin);
    const massMode = c.api.massMode;
    if ('density' in massMode) {
      collDesc.setDensity(massMode.density);
    } else if ('centerOfMass' in massMode) {
      collDesc.setMassProperties(
        massMode.mass,
        massMode.centerOfMass,
        massMode.principalAngularInertia,
        massMode.angularInertiaLocalFrame
      );
    } else {
      collDesc.setMass(massMode.mass);
    }
    const coll = backend.world.createCollider(collDesc, rb);
    const collId = c.api.id;
    colliders.set(collId, coll.handle);
    handleToColliderId.set(coll.handle, collId);
    c.api._rebind(coll);
    colliderAPIs.set(collId, c.api);
  }
  detachedBodies.delete(id);
  return {
    pos: { x: t.x, y: t.y, z: t.z },
    rot: { x: r.x, y: r.y, z: r.z, w: r.w },
  };
};
