// The Rapier backend's impulse joints: create and delete.

import type Rapier from '@dimforge/rapier3d-compat';
import type { JointParams } from '../../types/PhysicsJointTypes';
import { existsOrThrow } from '../../../../utils/Assert';
import { lwarn } from '../../../../utils/Logger';
import { EngineJointProxyAPI } from './proxies/EngineJointProxyAPI';
import { backend, getRigidBody, handleToJointId, jointAPIs, joints } from './RapierState';

// The running id (see RapierState.ts' maps)
let nextJointId = 0;

// docs/issues/i250_rapier-joint-on-disabled-bodies-panics.md
/** Rapier 0.19.3 panicked (`unreachable`, in the next step) on a joint inserted when neither body
 * is an enabled dynamic one and they've been stepped so (two disabled bodies, or a disabled one and
 * a fixed one: the DISABLED physics tier's). 0.21.0 doesn't;
 * kept until the second symptom (stepping such bodies corrupted other joints' solving) is
 * checked on it. A disabled body is
 * enabled for the insert and disabled again: it stays where it was, with its velocities. */
const createImpulseJointOnDisabled = (
  jointData: Rapier.JointData,
  body1: Rapier.RigidBody,
  body2: Rapier.RigidBody,
  wakeUp: boolean
) => {
  const isOff1 = !body1.isEnabled();
  const isOff2 = !body2.isEnabled();
  if (isOff1) body1.setEnabled(true);
  if (isOff2) body2.setEnabled(true);
  try {
    return backend.world.createImpulseJoint(jointData, body1, body2, wakeUp);
  } finally {
    if (isOff1) body1.setEnabled(false);
    if (isOff2) body2.setEnabled(false);
  }
};

/**
 * The joint's Rapier JointData, for an impulse joint or a multibody one (RapierMultibodyJoints.ts).
 * @internal
 */
export const toJointData = (params: JointParams): Rapier.JointData => {
  switch (params.type) {
    case 'FIXED':
      return backend.RAPIER.JointData.fixed(
        params.anchor1,
        params.frame1,
        params.anchor2,
        params.frame2
      );
    case 'REVOLUTE':
      return backend.RAPIER.JointData.revolute(params.anchor1, params.anchor2, params.axis);
    case 'PRISMATIC':
      return backend.RAPIER.JointData.prismatic(params.anchor1, params.anchor2, params.axis);
    case 'SPHERICAL':
      return backend.RAPIER.JointData.spherical(params.anchor1, params.anchor2);
    case 'ROPE':
      return backend.RAPIER.JointData.rope(params.length, params.anchor1, params.anchor2);
    case 'SPRING':
      return backend.RAPIER.JointData.spring(
        params.restLength,
        params.stiffness,
        params.damping,
        params.anchor1,
        params.anchor2
      );
    case 'GENERIC':
      return backend.RAPIER.JointData.generic(
        params.anchor1,
        params.anchor2,
        params.axis,
        params.axesMask as Rapier.JointAxesMask
      );
  }
};

/**
 * Creates an impulse joint between two live bodies (throws naming a missing one) and returns its
 * API object.
 * @internal
 */
export const createJoint = (params: JointParams) => {
  const body1 = existsOrThrow(
    getRigidBody(params.body1Id),
    `Could not find body1 (id: ${params.body1Id}) when creating a joint.`
  );
  const body2 = existsOrThrow(
    getRigidBody(params.body2Id),
    `Could not find body2 (id: ${params.body2Id}) when creating a joint.`
  );

  const jointData = toJointData(params);
  const wakeUp = params.wakeUp !== false;
  const joint = createImpulseJointOnDisabled(jointData, body1, body2, wakeUp);
  const id = nextJointId;
  nextJointId += 1;
  joints.set(id, joint.handle);
  handleToJointId.set(joint.handle, id);
  const jointAPI = new EngineJointProxyAPI(id, params.body1Id, params.body2Id, params.userData);
  jointAPIs.set(id, jointAPI);

  return jointAPI;
};

/**
 * Creates impulse joints, in order. Not all or nothing: a throw leaves the joints made before it.
 * @internal
 */
export const createJoints = (paramsArray: JointParams[]) =>
  paramsArray.map((params) => createJoint(params));

/**
 * Deletes a joint, waking its bodies unless `wakeUp` is false. An unknown id is a no-op (a
 * debug-env warning).
 * @internal
 */
export const deleteJoint = (id: number, wakeUp?: boolean) => {
  const jointHandle = joints.get(id);
  if (jointHandle === undefined) {
    if (backend.isDebugEnvironment) {
      lwarn(`Trying to remove a non existing joint (no handle found), handle: ${jointHandle}`);
    }
    return { id };
  }
  const joint = backend.world.impulseJoints.get(jointHandle);
  if (!joint) {
    if (backend.isDebugEnvironment) {
      lwarn(`Trying to remove a non existing joint (no joint found), handle: ${jointHandle}`);
    }
    joints.delete(id);
    handleToJointId.delete(jointHandle);
    return { id };
  }
  backend.world.removeImpulseJoint(joint, wakeUp !== false);
  jointAPIs.delete(id);
  joints.delete(id);
  handleToJointId.delete(jointHandle);
  return { id };
};

/**
 * Deletes joints as deleteJoint does, each with its `wakeUps` entry.
 * @internal
 */
export const deleteJoints = (ids: number[], wakeUps?: boolean[]) => {
  const deletedIds = [];
  for (let i = 0; i < ids.length; i++) {
    const { id } = deleteJoint(ids[i], wakeUps ? wakeUps[i] : undefined);
    if (id !== undefined) deletedIds.push(id);
  }
  return { ids: deletedIds };
};
