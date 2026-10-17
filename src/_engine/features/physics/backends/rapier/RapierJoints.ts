// The Rapier backend's impulse joints: create and delete.

import type Rapier from '@dimforge/rapier3d-compat';
import type { JointParams } from '../../types/PhysicsJointTypes';
import { existsOrThrow } from '../../../../utils/Assert';
import { lwarn } from '../../../../utils/Logger';
import { EngineJointProxyAPI } from './proxies/EngineJointProxyAPI';
import { backend, getRigidBody, handleToJointId, jointAPIs, joints } from './RapierState';

// The running id (see RapierState.ts' maps)
let nextJointId = 0;

export const createJoint = (params: JointParams) => {
  const body1 = existsOrThrow(
    getRigidBody(params.body1Id),
    `Could not find body1 (id: ${params.body1Id}) when creating a joint.`
  );
  const body2 = existsOrThrow(
    getRigidBody(params.body2Id),
    `Could not find body2 (id: ${params.body2Id}) when creating a joint.`
  );

  let jointData: Rapier.JointData;
  switch (params.type) {
    case 'FIXED':
      jointData = backend.RAPIER.JointData.fixed(
        params.anchor1,
        params.frame1,
        params.anchor2,
        params.frame2
      );
      break;
    case 'REVOLUTE':
      jointData = backend.RAPIER.JointData.revolute(params.anchor1, params.anchor2, params.axis);
      break;
    case 'PRISMATIC':
      jointData = backend.RAPIER.JointData.prismatic(params.anchor1, params.anchor2, params.axis);
      break;
    case 'SPHERICAL':
      jointData = backend.RAPIER.JointData.spherical(params.anchor1, params.anchor2);
      break;
    case 'ROPE':
      jointData = backend.RAPIER.JointData.rope(params.length, params.anchor1, params.anchor2);
      break;
    case 'SPRING':
      jointData = backend.RAPIER.JointData.spring(
        params.restLength,
        params.stiffness,
        params.damping,
        params.anchor1,
        params.anchor2
      );
      break;
    case 'GENERIC':
      jointData = backend.RAPIER.JointData.generic(
        params.anchor1,
        params.anchor2,
        params.axis,
        params.axesMask as Rapier.JointAxesMask
      );
      break;
  }

  const wakeUp = params.wakeUp !== false;
  const joint = backend.world.createImpulseJoint(jointData, body1, body2, wakeUp);
  const id = nextJointId;
  nextJointId += 1;
  joints.set(id, joint.handle);
  handleToJointId.set(joint.handle, id);
  const jointAPI = new EngineJointProxyAPI(id, params.body1Id, params.body2Id, params.userData);
  jointAPIs.set(id, jointAPI);

  return jointAPI;
};

export const createJoints = (paramsArray: JointParams[]) =>
  paramsArray.map((params) => createJoint(params));

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

export const deleteJoints = (ids: number[], wakeUps?: boolean[]) => {
  const deletedIds = [];
  for (let i = 0; i < ids.length; i++) {
    const { id } = deleteJoint(ids[i], wakeUps ? wakeUps[i] : undefined);
    if (id !== undefined) deletedIds.push(id);
  }
  return { ids: deletedIds };
};
