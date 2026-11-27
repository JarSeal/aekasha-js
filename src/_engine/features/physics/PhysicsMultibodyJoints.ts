// Multibody joints (p250): their creates and deletes, and what the facade knows of the trees they
// make (whether a body has a parent, for the WORKER_THREAD body proxy's type check). The backend keeps the
// trees too, and refuses what Rapier would panic on (backends/rapier/RapierMultibodyJoints.ts).
// Each operation branches on the worker target once: on MAIN_THREAD its async form runs its *Sync
// one.

import { existsOrThrow } from '../../utils/Assert';
import { lerror } from '../../utils/Logger';
import { messageWorkerAsync, toWireJointParams } from './PhysicsMessaging';
import { checkDeletedId, forgetMultibodyJoint, multibodyJoints } from './PhysicsRegistry';
import { assertMainThread, assertWorldCreated, facade, isWorkerTarget } from './PhysicsState';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type {
  CreateMultibodyJointResponse,
  DeleteMultibodyJointResponse,
} from './protocol/PhysicsResponses';
import { MultibodyJointProxyAPI } from './proxies/MultibodyJointProxyAPI';
import type { MultibodyJointAPI, MultibodyJointParams } from './types/PhysicsJointTypes';

/** Told the two body ids of every multibody joint `createMultibodyJoint` makes, once it exists. */
let jointCreatedListener: ((body1Id: number, body2Id: number) => void) | null = null;

/**
 * Sets (or clears, with null) the one listener told the two body ids of every multibody joint
 * {@link createMultibodyJoint} makes, once it exists (on `WORKER_THREAD` at its reply: an insert
 * Rapier can't take is refused, and a tiered body's state is safe to insert on, so unlike an
 * impulse joint's nothing has to change before it): `physicsTiers()`'s, which gives the joined
 * group a tier it can have.
 * @internal
 */
export const setMultibodyJointCreatedListener = (
  listener: ((body1Id: number, body2Id: number) => void) | null
) => {
  jointCreatedListener = listener;
};

const notifyJointCreated = (params: MultibodyJointParams) => {
  try {
    jointCreatedListener?.(params.body1Id, params.body2Id);
  } catch (err) {
    lerror('Physics: the multibody-joint-created listener threw.', err);
  }
};

/** WORKER_THREAD: the bodies of multibody joints requested and not replied yet, by body id (a
 * count), so {@link isBodyInMultibody} sees them before the joint is in the registry. */
const bodiesOfJointsInFlight = new Map<number, number>();
/** WORKER_THREAD: the children of those joints (a count), for {@link hasMultibodyParent}. */
const childrenOfJointsInFlight = new Map<number, number>();

const count = (map: Map<number, number>, id: number, delta: 1 | -1) => {
  const n = (map.get(id) ?? 0) + delta;
  if (n > 0) map.set(id, n);
  else map.delete(id);
};

const countJointInFlight = (params: MultibodyJointParams, delta: 1 | -1) => {
  count(bodiesOfJointsInFlight, params.body1Id, delta);
  count(bodiesOfJointsInFlight, params.body2Id, delta);
  count(childrenOfJointsInFlight, params.body2Id, delta);
};

// p250
/**
 * Creates a multibody joint: `body1Id` the parent, `body2Id` the child, the joints between
 * bodies making a tree solved in reduced coordinates, without the drift impulse joints have.
 * Rejects without a world, when either body doesn't exist, and on what a multibody can't be
 * ({@link MultibodyJointParams}' remarks).
 * @example
 * ```ts
 * import { getECSWorld } from 'aekasha';
 * import { createMultibodyJoint, createPhysicsEntity } from 'aekasha/physics';
 *
 * // A fixed base and a link hanging 1 m to its right on a hinge
 * const box = { type: 'BOX', hx: 0.2, hy: 0.2, hz: 0.2 } as const;
 * const baseId = await createPhysicsEntity({ colliders: box, body: { rigidType: 'FIXED' } });
 * const linkId = await createPhysicsEntity({
 *   colliders: box,
 *   body: { rigidType: 'DYNAMIC', translation: { x: 1, y: 0, z: 0 } },
 * });
 * const bodyIdOf = (entityId: number) => getECSWorld().getRigidBody(entityId)!.id;
 * await createMultibodyJoint({
 *   type: 'REVOLUTE',
 *   body1Id: bodyIdOf(baseId),
 *   body2Id: bodyIdOf(linkId),
 *   anchor1: { x: 0.5, y: 0, z: 0 },
 *   anchor2: { x: -0.5, y: 0, z: 0 },
 *   axis: { x: 0, y: 0, z: 1 },
 * });
 * ```
 */
export const createMultibodyJoint = async (
  params: MultibodyJointParams
): Promise<MultibodyJointAPI> => {
  if (!isWorkerTarget()) return createMultibodyJointSync(params);
  assertWorldCreated('a multibody joint');
  countJointInFlight(params, 1);
  let res: CreateMultibodyJointResponse;
  try {
    res = await messageWorkerAsync<CreateMultibodyJointResponse>({
      type: PhysicsProtocolType.CREATE_MULTIBODY_JOINT,
      params: toWireJointParams(params),
    });
  } finally {
    countJointInFlight(params, -1);
  }
  const jointProxy = new MultibodyJointProxyAPI(
    res.id,
    params.body1Id,
    params.body2Id,
    params.userData
  );
  multibodyJoints.set(res.id, jointProxy);
  notifyJointCreated(params);
  return jointProxy;
};

/**
 * {@link createMultibodyJoint}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const createMultibodyJointSync = (params: MultibodyJointParams): MultibodyJointAPI => {
  assertWorldCreated('a multibody joint');
  assertMainThread('createMultibodyJointSync', 'createMultibodyJoint');
  const joint = existsOrThrow(
    facade.engAPI?.createMultibodyJoint(params),
    `Could not create a multibody joint ("MAIN_THREAD"). Params: ${JSON.stringify(params)}`
  );
  multibodyJoints.set(joint.id, joint);
  notifyJointCreated(params);
  return joint;
};

/**
 * Deletes a multibody joint: its child becomes the root of its own multibody, with its subtree.
 * Resolves with its id, or undefined without a world (a quiet no-op, see
 * {@link _engine/features/physics/PhysicsBodies!deleteRigidBody}).
 */
export const deleteMultibodyJoint = async (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  if (!isWorkerTarget()) return deleteMultibodyJointSync(id, wakeUp);
  forgetMultibodyJoint(id);
  const res = await messageWorkerAsync<DeleteMultibodyJointResponse>({
    type: PhysicsProtocolType.DELETE_MULTIBODY_JOINT,
    id,
    wakeUp,
  });
  return checkDeletedId('a multibody joint', id, res?.id);
};

/**
 * {@link deleteMultibodyJoint}, synchronous: MAIN_THREAD only (it throws in WORKER_THREAD mode).
 * @internal
 */
export const deleteMultibodyJointSync = (id: number, wakeUp?: boolean) => {
  if (!facade.worldEnabled) return undefined;
  assertMainThread('deleteMultibodyJointSync', 'deleteMultibodyJoint');
  forgetMultibodyJoint(id);
  return checkDeletedId(
    'a multibody joint',
    id,
    facade.engAPI?.deleteMultibodyJoint(id, wakeUp)?.id
  );
};

/**
 * Calls `fn` with the parent's and the child's body ids of every live multibody joint,
 * synchronously in both worker targets (the tiers' joint groups).
 * @internal
 */
export const forEachMultibodyJointBodyPair = (fn: (body1Id: number, body2Id: number) => void) => {
  for (const joint of multibodyJoints.values()) fn(joint.body1IdSync(), joint.body2IdSync());
};

/**
 * Whether a live multibody joint is attached to the body, or one requested from the worker and
 * not replied yet.
 * @internal
 */
export const isBodyInMultibody = (bodyId: number) => {
  if (bodiesOfJointsInFlight.has(bodyId)) return true;
  for (const joint of multibodyJoints.values()) {
    if (joint.body1IdSync() === bodyId || joint.body2IdSync() === bodyId) return true;
  }
  return false;
};

/**
 * Whether the body hangs from a parent in its multibody (a joint's child), counting a joint
 * requested from the worker and not replied yet.
 * @internal
 */
export const hasMultibodyParent = (bodyId: number) => {
  if (childrenOfJointsInFlight.has(bodyId)) return true;
  for (const joint of multibodyJoints.values()) if (joint.body2IdSync() === bodyId) return true;
  return false;
};

/**
 * Whether any multibody joint exists, so a joint walk can be skipped.
 * @internal
 */
export const hasMultibodyJoints = () => multibodyJoints.size > 0;
