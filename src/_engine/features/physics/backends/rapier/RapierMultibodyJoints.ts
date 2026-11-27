// The Rapier backend's multibody joints (p250): create, delete, and the multibodies' trees
// (RapierState.ts' multibodyParents), which the guards read: Rapier panics on what a multibody
// can't be (a loop, a second parent, a fixed or kinematic link), killing the world, so those are
// refused here before Rapier sees them.

import type Rapier from '@dimforge/rapier3d-compat';
import { RigidBodyTypeAPI } from '../../types/PhysicsBodyTypes';
import type { MultibodyJointParams } from '../../types/PhysicsJointTypes';
import { existsOrThrow } from '../../../../utils/Assert';
import { lwarn } from '../../../../utils/Logger';
import { EngineMultibodyJointProxyAPI } from './proxies/EngineMultibodyJointProxyAPI';
import { fromRapierBodyType } from './RapierEnums';
import { toJointData } from './RapierJoints';
import {
  backend,
  getRigidBody,
  handleToMultibodyJointId,
  multibodyChildCounts,
  multibodyJointAPIs,
  multibodyJoints,
  multibodyParents,
} from './RapierState';

// The running id (see RapierState.ts' maps)
let nextMultibodyJointId = 0;

const MULTIBODY_JOINT_TYPES: ReadonlySet<string> = new Set<MultibodyJointParams['type']>([
  'FIXED',
  'REVOLUTE',
  'PRISMATIC',
  'SPHERICAL',
]);

const typeName = (rb: Rapier.RigidBody) => RigidBodyTypeAPI[fromRapierBodyType(rb.bodyType())];

/** Records `childId` under `parentId`. */
const link = (childId: number, parentId: number, jointId: number) => {
  multibodyParents.set(childId, { parentId, jointId });
  multibodyChildCounts.set(parentId, (multibodyChildCounts.get(parentId) ?? 0) + 1);
};

/** Forgets `childId`'s parent: it's a root now (Rapier splits the multibody there). */
const unlink = (childId: number) => {
  const parent = multibodyParents.get(childId);
  if (!parent) return;
  multibodyParents.delete(childId);
  const count = (multibodyChildCounts.get(parent.parentId) ?? 0) - 1;
  if (count > 0) multibodyChildCounts.set(parent.parentId, count);
  else multibodyChildCounts.delete(parent.parentId);
};

/** Forgets a multibody joint Rapier no longer has (removed, or taken with a body). */
const forgetMultibodyJoint = (id: number, handle: number) => {
  const api = multibodyJointAPIs.get(id);
  if (api) unlink(api.body2IdSync());
  multibodyJoints.delete(id);
  multibodyJointAPIs.delete(id);
  handleToMultibodyJointId.delete(handle);
};

/** Whether `ancestorId` is `bodyId` or above it in its multibody. */
const isSelfOrAncestor = (bodyId: number, ancestorId: number) => {
  for (let id: number | undefined = bodyId; id !== undefined; ) {
    if (id === ancestorId) return true;
    id = multibodyParents.get(id)?.parentId;
  }
  return false;
};

/** Why Rapier can't take the joint (it would panic, at the insert or the next step), or null. */
const getMultibodyRefusal = (
  params: MultibodyJointParams,
  body1: Rapier.RigidBody,
  body2: Rapier.RigidBody
): string | null => {
  const { body1Id, body2Id } = params;
  if (body1Id === body2Id) return 'a body can not be joined to itself';
  if (!body2.isDynamic()) {
    return `body2 is ${typeName(body2)}: a multibody's child must be Dynamic (only its root can be fixed or kinematic)`;
  }
  const parent = multibodyParents.get(body2Id);
  if (parent) {
    return `body2 has a parent already (body ${parent.parentId}, multibody joint ${parent.jointId}): a link has one parent`;
  }
  if (isSelfOrAncestor(body1Id, body2Id)) {
    return "body1 is in body2's multibody already: the joint would close a loop (close it with an impulse joint, createJoint)";
  }
  if (!body1.isDynamic() && multibodyParents.has(body1Id)) {
    return `body1 is ${typeName(body1)} and has a parent: only a multibody's root can be fixed or kinematic`;
  }
  return null;
};

/**
 * Creates a multibody joint between two live bodies, `body1Id` the parent and `body2Id` the child,
 * and returns its API object. Throws naming a missing body, a type Rapier has no multibody joint
 * for, and what would make Rapier panic (`getMultibodyRefusal`), before calling it.
 * @internal
 */
export const createMultibodyJoint = (params: MultibodyJointParams) => {
  const { body1Id, body2Id } = params;
  const what = `a multibody joint (body1 id: ${body1Id}, body2 id: ${body2Id})`;
  if (!MULTIBODY_JOINT_TYPES.has(params.type)) {
    throw new Error(
      `Could not create ${what}: ${params.type} isn't a multibody joint type (FIXED, REVOLUTE, PRISMATIC or SPHERICAL).`
    );
  }
  const body1 = existsOrThrow(
    getRigidBody(body1Id),
    `Could not find body1 (id: ${body1Id}) when creating a multibody joint.`
  );
  const body2 = existsOrThrow(
    getRigidBody(body2Id),
    `Could not find body2 (id: ${body2Id}) when creating a multibody joint.`
  );
  const refusal = getMultibodyRefusal(params, body1, body2);
  if (refusal) throw new Error(`Could not create ${what}: ${refusal}.`);

  const joint = backend.world.createMultibodyJoint(
    toJointData(params),
    body1,
    body2,
    params.wakeUp !== false
  );
  const id = nextMultibodyJointId;
  nextMultibodyJointId += 1;
  multibodyJoints.set(id, joint.handle);
  handleToMultibodyJointId.set(joint.handle, id);
  link(body2Id, body1Id, id);
  const jointAPI = new EngineMultibodyJointProxyAPI(id, body1Id, body2Id, params.userData);
  multibodyJointAPIs.set(id, jointAPI);
  return jointAPI;
};

/**
 * Deletes a multibody joint, waking its bodies unless `wakeUp` is false. Its child becomes the
 * root of its own multibody, with its subtree. An unknown id is a no-op (a debug-env warning).
 * @internal
 */
export const deleteMultibodyJoint = (id: number, wakeUp?: boolean) => {
  const handle = multibodyJoints.get(id);
  if (handle === undefined) {
    if (backend.isDebugEnvironment) {
      lwarn(`Trying to remove a non existing multibody joint (no handle found), id: ${id}`);
    }
    return { id };
  }
  const joint = backend.world.multibodyJoints.get(handle);
  if (joint) backend.world.removeMultibodyJoint(joint, wakeUp !== false);
  else if (backend.isDebugEnvironment) {
    lwarn(`Trying to remove a non existing multibody joint (no joint found), id: ${id}`);
  }
  forgetMultibodyJoint(id, handle);
  return { id };
};

/**
 * Forgets the multibody joints attached to a body about to be removed (Rapier removes them with
 * it, splitting its multibody there), and returns their ids.
 * @internal
 */
export const reapBodyMultibodyJoints = (rbHandle: number) => {
  const ids: number[] = [];
  const handles: number[] = [];
  backend.world.multibodyJoints.forEachJointHandleAttachedToRigidBody(rbHandle, (handle) => {
    const id = handleToMultibodyJointId.get(handle);
    if (id === undefined) return;
    ids.push(id);
    handles.push(handle);
  });
  for (let i = 0; i < ids.length; i++) forgetMultibodyJoint(ids[i], handles[i]);
  return ids;
};

/**
 * Whether the body is in a multibody (it has a parent or a child).
 * @internal
 */
export const isInMultibody = (bodyId: number) =>
  multibodyParents.has(bodyId) || multibodyChildCounts.has(bodyId);

// p250 D6
/**
 * The dynamic bodies of `bodyId`'s multibody, `bodyId` first: every link of its tree, through a
 * fixed or kinematic root too. The world bounds' exit of a link takes them all: an
 * impulse joint between two branches of a multibody panics at the next step when one branch is
 * disabled and the other isn't (a branch alone is fine without one).
 * @internal
 */
export const getMultibodyLinks = (bodyId: number) => {
  let rootId = bodyId;
  for (let parent = multibodyParents.get(rootId); parent; parent = multibodyParents.get(rootId)) {
    rootId = parent.parentId;
  }
  const children = new Map<number, number[]>();
  for (const [childId, { parentId }] of multibodyParents) {
    const siblings = children.get(parentId);
    if (siblings) siblings.push(childId);
    else children.set(parentId, [childId]);
  }
  const links = [bodyId];
  const tree = [rootId];
  for (let i = 0; i < tree.length; i++) {
    const id = tree[i];
    if (id !== bodyId && getRigidBody(id)?.isDynamic()) links.push(id);
    tree.push(...(children.get(id) ?? []));
  }
  return links;
};

/**
 * Makes the multibodies' trees again from the live joints' proxies (a snapshot restore, after its
 * walk: the joints it kept are exactly the restored world's).
 * @internal
 */
export const rebuildMultibodyTree = () => {
  multibodyParents.clear();
  multibodyChildCounts.clear();
  for (const [id, api] of multibodyJointAPIs) link(api.body2IdSync(), api.body1IdSync(), id);
};

/**
 * Forgets every multibody joint and link (the world's delete). The running id goes on.
 * @internal
 */
export const clearMultibodyJoints = () => {
  multibodyJoints.clear();
  multibodyJointAPIs.clear();
  handleToMultibodyJointId.clear();
  multibodyParents.clear();
  multibodyChildCounts.clear();
};
