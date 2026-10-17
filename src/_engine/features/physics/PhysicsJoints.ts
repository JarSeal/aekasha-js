// Impulse joints: their creates and deletes, and the joint walks of the physics tiers (p352).

import { existsOrThrow } from '../../utils/Assert';
import { messageWorkerAsync, toWireJointParams } from './PhysicsMessaging';
import { joints } from './PhysicsRegistry';
import { facade } from './PhysicsState';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type { CreateJointResponse, DeleteJointResponse } from './protocol/PhysicsResponses';
import { JointProxyAPI } from './proxies/JointProxyAPI';
import type { JointAPI, JointParams } from './types/PhysicsJointTypes';

/** Create an impulse joint connecting two rigid bodies (by id). */
export const createJoint = async (params: JointParams) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a joint.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const joint = existsOrThrow(
      facade.engAPI?.createJoint(params),
      `Could not create a joint ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    joints.set(joint.id, joint);
    return joint;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const res = await messageWorkerAsync<CreateJointResponse>({
      type: PhysicsProtocolType.CREATE_JOINT,
      params: toWireJointParams(params),
    });
    const jointProxy = new JointProxyAPI(
      res.id,
      params.body1Id,
      params.body2Id,
      params.userData
    ) as JointAPI;
    joints.set(res.id, jointProxy);
    return jointProxy;
  }
  // Should not get here..
  throw new Error(
    `Could not create a joint (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Create an impulse joint (sync). Only for main thread mode. */
export const createJointSync = (params: JointParams) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before creating a joint.'
  );
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const joint = existsOrThrow(
      facade.engAPI?.createJoint(params),
      `Could not create a joint ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
    );
    joints.set(joint.id, joint);
    return joint;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use createJointSync in worker mode. Use createJoint instead.');
  }
  // Should not get here..
  throw new Error(
    `Could not create a joint (workerTarget was not 'MAIN_THREAD' nor was it 'WORKER_THREAD'), worker target: ${facade.state.workerTarget}`
  );
};

/** Deletes a joint. Returns the id of the deleted jointAPI, or undefined without a world (a quiet
 * no-op, see deleteRigidBody). */
export const deleteJoint = async (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  let deletedId: number | undefined = undefined;
  if (joints.has(id)) joints.delete(id);
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteJoint(id, wakeUp);
    deletedId = response?.id;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    const response = await messageWorkerAsync<DeleteJointResponse>({
      type: PhysicsProtocolType.DELETE_JOINT,
      id,
      wakeUp,
    });
    deletedId = response?.id;
  }
  if (deletedId !== id) {
    throw new Error(
      `Could not delete a joint, the returned id (${deletedId}) did not match the id: ${id}.`
    );
  }
  return deletedId;
};

/** Deletes a joint. Returns the id of the deleted jointAPI (sync), or undefined without a world (see
 * deleteRigidBody). Only for main thread mode. */
export const deleteJointSync = (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  let deletedId: number | undefined = undefined;
  if (joints.has(id)) joints.delete(id);
  if (facade.state.workerTarget === 'MAIN_THREAD') {
    const response = facade.engAPI?.deleteJoint(id, wakeUp);
    deletedId = response?.id;
  } else if (facade.state.workerTarget === 'WORKER_THREAD') {
    throw new Error('Cannot use deleteJointSync in worker mode. Use deleteJoint instead.');
  }
  if (deletedId !== id) {
    throw new Error(
      `Could not delete a joint, the returned id (${deletedId}) did not match the id: ${id}.`
    );
  }
  return deletedId;
};

/** Calls `fn` with the two body ids of every live impulse joint, synchronously in both worker
 * targets (p352's joint groups). */
export const forEachJointBodyPair = (fn: (body1Id: number, body2Id: number) => void) => {
  for (const joint of joints.values()) fn(joint.body1IdSync(), joint.body2IdSync());
};

/** Whether any impulse joint exists, so a joint walk can be skipped. */
export const hasJoints = () => joints.size > 0;
