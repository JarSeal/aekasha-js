// Impulse joints: their creates and deletes, and the joint walks of the physics tiers (p352).
// Each operation branches on the worker target once: on MAIN_THREAD its async form runs its *Sync
// one.

import { existsOrThrow } from '../../utils/Assert';
import { messageWorkerAsync, toWireJointParams } from './PhysicsMessaging';
import { checkDeletedId, forgetJoint, joints } from './PhysicsRegistry';
import { assertMainThread, assertWorldCreated, facade, isWorkerTarget } from './PhysicsState';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type { CreateJointResponse, DeleteJointResponse } from './protocol/PhysicsResponses';
import { JointProxyAPI } from './proxies/JointProxyAPI';
import type { JointAPI, JointParams } from './types/PhysicsJointTypes';

/**
 * Creates an impulse joint connecting two rigid bodies (by id). Rejects without a world, and when
 * either body doesn't exist.
 */
export const createJoint = async (params: JointParams): Promise<JointAPI> => {
  if (!isWorkerTarget()) return createJointSync(params);
  assertWorldCreated('a joint');
  const res = await messageWorkerAsync<CreateJointResponse>({
    type: PhysicsProtocolType.CREATE_JOINT,
    params: toWireJointParams(params),
  });
  const jointProxy = new JointProxyAPI(res.id, params.body1Id, params.body2Id, params.userData);
  joints.set(res.id, jointProxy);
  return jointProxy;
};

/**
 * {@link createJoint}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const createJointSync = (params: JointParams): JointAPI => {
  assertWorldCreated('a joint');
  assertMainThread('createJointSync', 'createJoint');
  const joint = existsOrThrow(
    facade.engAPI?.createJoint(params),
    `Could not create a joint ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
  );
  joints.set(joint.id, joint);
  return joint;
};

/**
 * Deletes a joint. Resolves with its id, or undefined without a world (a quiet no-op, see
 * {@link _engine/features/physics/PhysicsBodies!deleteRigidBody}).
 */
export const deleteJoint = async (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  if (!isWorkerTarget()) return deleteJointSync(id, wakeUp);
  forgetJoint(id);
  const res = await messageWorkerAsync<DeleteJointResponse>({
    type: PhysicsProtocolType.DELETE_JOINT,
    id,
    wakeUp,
  });
  return checkDeletedId('a joint', id, res?.id);
};

/**
 * {@link deleteJoint}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const deleteJointSync = (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  assertMainThread('deleteJointSync', 'deleteJoint');
  forgetJoint(id);
  return checkDeletedId('a joint', id, facade.engAPI?.deleteJoint(id, wakeUp)?.id);
};

/**
 * Calls `fn` with the two body ids of every live impulse joint, synchronously in both worker
 * targets (p352's joint groups).
 * @internal
 */
export const forEachJointBodyPair = (fn: (body1Id: number, body2Id: number) => void) => {
  for (const joint of joints.values()) fn(joint.body1IdSync(), joint.body2IdSync());
};

/**
 * Whether a live impulse joint is attached to the body: the walk stops at the first one.
 * @internal
 */
export const isBodyJointed = (bodyId: number) => {
  for (const joint of joints.values()) {
    if (joint.body1IdSync() === bodyId || joint.body2IdSync() === bodyId) return true;
  }
  return false;
};

/**
 * Whether any impulse joint exists, so a joint walk can be skipped.
 * @internal
 */
export const hasJoints = () => joints.size > 0;
