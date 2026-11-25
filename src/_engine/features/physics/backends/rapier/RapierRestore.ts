// The Rapier backend's snapshot restore (p500): once Rapier has made the restored world, rebinds the
// API objects both the snapshot and the API know, forgets the ones only the API knows (reaped) and
// takes out what only the snapshot has (orphans).
//
// Rapier keeps every handle (index and generation) through a snapshot, so the id → handle maps stay
// valid and need no remapping. Its JS lookups ignore the generation, though: a handle whose index
// another object holds in the restored world finds that object. A wrapper whose own handle isn't the
// stored one is therefore something else, and the stored object isn't in the snapshot. The wrappers
// themselves are new objects of the new world, so each proxy is pointed at its new one.
//
// A multibody joint's handle is its child body's (p250), so the handle test can't tell a joint
// deleted and made again on the same child since the snapshot: its parent can. Rapier's joints
// have no body getters, but a body's attached joints are its own link's and its children's, so the
// joint is the stored one's only when its parent lists it.

import type Rapier from '@dimforge/rapier3d-compat';
import type { RestoreSnapshotDelta, RestoreSnapshotOpts } from '../../types/PhysicsWorldTypes';
import { lerror, lwarn } from '../../../../utils/Logger';
import type { EngineColliderProxyAPI } from './proxies/EngineColliderProxyAPI';
import type { EngineJointProxyAPI } from './proxies/EngineJointProxyAPI';
import type { EngineMultibodyJointProxyAPI } from './proxies/EngineMultibodyJointProxyAPI';
import type { EngineRigidBodyProxyAPI } from './proxies/EngineRigidBodyProxyAPI';
import { cleanupColliderEventRegistrations, clearPendingEventRecords } from './RapierEvents';
import { rebuildMultibodyTree } from './RapierMultibodyJoints';
import {
  clearPendingOutOfBoundsRecords,
  forgetBodyWorldBounds,
  queueBodyCheck,
} from './RapierWorldBounds';
import {
  backend,
  colliderAPIs,
  colliders,
  handleToColliderId,
  handleToJointId,
  handleToMultibodyJointId,
  handleToRigidBodyId,
  jointAPIs,
  joints,
  multibodyJointAPIs,
  multibodyJoints,
  rigidBodies,
  rigidBodyAPIs,
} from './RapierState';

/**
 * What a restore's sweep found: the delta's ids and counts (the world's settings are read by the
 * caller).
 * @internal
 */
export type RestoreSweep = Pick<
  RestoreSnapshotDelta,
  | 'reapedRigidBodyIds'
  | 'reapedColliderIds'
  | 'reapedJointIds'
  | 'reapedMultibodyJointIds'
  | 'orphanCounts'
>;

type Wrapper = { handle: number; isValid(): boolean };

/** Whether `wrapper` is the stored object itself (its own handle, generation included) and live. */
const isLive = (wrapper: Wrapper | null | undefined, handle: number) =>
  Boolean(wrapper && wrapper.handle === handle && wrapper.isValid());

/** Rebinds each stored object the restored world has (claiming its handle) and lists the ids of the
 * ones it hasn't. `isSame`, when given, checks what the handle can't tell. */
const claim = <W extends Wrapper>(
  handles: Map<number, number>,
  get: (handle: number) => W | null | undefined,
  rebind: (id: number, wrapper: W) => void,
  claimed: Set<number>,
  isSame?: (id: number, handle: number) => boolean
) => {
  const reaped: number[] = [];
  for (const [id, handle] of handles) {
    const wrapper = get(handle);
    if (wrapper && wrapper.handle === handle && (!isSame || isSame(id, handle))) {
      claimed.add(handle);
      rebind(id, wrapper);
    } else {
      reaped.push(id);
    }
  }
  return reaped;
};

/** The handles of the restored world's objects no stored id claimed. */
const collectOrphans = <W extends Wrapper>(
  forEach: (fn: (wrapper: W) => void) => void,
  claimed: Set<number>
) => {
  const orphans: number[] = [];
  forEach((wrapper) => {
    if (!claimed.has(wrapper.handle)) orphans.push(wrapper.handle);
  });
  return orphans;
};

/** The ids whose objects aren't live after the sweep: none, unless the handle test was wrong. */
const findInvalid = (
  handles: Map<number, number>,
  get: (handle: number) => Wrapper | null | undefined
) => {
  const invalid: number[] = [];
  for (const [id, handle] of handles) if (!isLive(get(handle), handle)) invalid.push(id);
  return invalid;
};

const reapBodies = (ids: number[]) => {
  for (const id of ids) {
    const handle = rigidBodies.get(id);
    if (handle !== undefined) handleToRigidBodyId.delete(handle);
    rigidBodies.delete(id);
    rigidBodyAPIs.delete(id);
    forgetBodyWorldBounds(id);
  }
};

const reapColliders = (ids: number[]) => {
  for (const id of ids) {
    const handle = colliders.get(id);
    if (handle !== undefined) handleToColliderId.delete(handle);
    colliders.delete(id);
    colliderAPIs.delete(id);
    cleanupColliderEventRegistrations(id);
  }
};

const reapJoints = (ids: number[]) => {
  for (const id of ids) {
    const handle = joints.get(id);
    if (handle !== undefined) handleToJointId.delete(handle);
    joints.delete(id);
    jointAPIs.delete(id);
  }
};

const reapMultibodyJoints = (ids: number[]) => {
  for (const id of ids) {
    const handle = multibodyJoints.get(id);
    if (handle !== undefined) handleToMultibodyJointId.delete(handle);
    multibodyJoints.delete(id);
    multibodyJointAPIs.delete(id);
  }
};

/**
 * Whether the restored world's multibody joint at `handle` (its child's handle) hangs from the
 * stored joint's parent: its parent's attached joints list it. Run after the bodies' reap, so a
 * parent made since the snapshot has no handle.
 */
const isSameMultibodyParent = (world: Rapier.World, id: number, handle: number) => {
  const api = multibodyJointAPIs.get(id);
  if (!api) return false;
  const parentHandle = rigidBodies.get(api.body1IdSync());
  if (parentHandle === undefined || rigidBodies.get(api.body2IdSync()) !== handle) return false;
  let isListed = false;
  world.multibodyJoints.forEachJointHandleAttachedToRigidBody(parentHandle, (attached) => {
    if (attached === handle) isListed = true;
  });
  return isListed;
};

/** Takes the orphan multibody joints out of `world`, whatever the orphan policy (p250 D7): Rapier
 * can't tell the engine their bodies, so a kept one would hide a link from the guards. */
const removeOrphanMultibodyJoints = (world: Rapier.World, handles: number[]) => {
  for (const handle of handles) {
    const joint = world.multibodyJoints.get(handle);
    if (joint && isLive(joint, handle)) world.removeMultibodyJoint(joint, false);
  }
};

/**
 * Takes out of `world` the orphans the claims left (`'DELETE'`): the bodies first, whose removal
 * takes their colliders and joints with it, then the colliders and joints still there.
 */
const removeOrphans = (
  world: Rapier.World,
  bodyHandles: number[],
  colliderHandles: number[],
  jointHandles: number[]
) => {
  for (const handle of bodyHandles) {
    const rb = world.getRigidBody(handle);
    if (isLive(rb, handle)) world.removeRigidBody(rb);
  }
  for (const handle of colliderHandles) {
    const coll = world.getCollider(handle);
    if (isLive(coll, handle)) world.removeCollider(coll, false);
  }
  for (const handle of jointHandles) {
    const joint = world.impulseJoints.get(handle);
    if (joint && isLive(joint, handle)) world.removeImpulseJoint(joint, false);
  }
};

/**
 * Reconciles the backend with `world`, the world Rapier just restored (already `backend.world`), in
 * one walk per kind: rebinds the proxies of the bodies, colliders, joints and multibody joints it
 * has, forgets the ones it hasn't (reaped: their ids, handles, world bounds and event callbacks),
 * and takes out its objects no id claims (orphans) unless `orphanPolicy` is `'KEEP'` (orphan
 * multibody joints always). Then checks the survivors are live (a failed check reaps them, an error
 * in debug builds), makes the multibodies' trees again from the joints kept, and drops the event
 * and world-bounds records of the replaced world. A detached body (the `REMOVED` tier) is in none
 * of the maps and stays detached: a copy of it in the snapshot is an orphan.
 * @internal
 */
export const rebindRestoredWorld = (
  world: Rapier.World,
  opts?: RestoreSnapshotOpts
): RestoreSweep => {
  const claimedBodies = new Set<number>();
  const claimedColliders = new Set<number>();
  const claimedJoints = new Set<number>();
  const claimedMultibodyJoints = new Set<number>();
  const getBody = (handle: number) => world.getRigidBody(handle);
  const getCollider = (handle: number) => world.getCollider(handle);
  const getJoint = (handle: number) => world.impulseJoints.get(handle);
  const getMultibodyJoint = (handle: number) => world.multibodyJoints.get(handle);

  const reapedRigidBodyIds = claim(
    rigidBodies,
    getBody,
    (id, rb) => (rigidBodyAPIs.get(id) as EngineRigidBodyProxyAPI)._rebind(rb, true),
    claimedBodies
  );
  const reapedColliderIds = claim(
    colliders,
    getCollider,
    (id, coll) => (colliderAPIs.get(id) as EngineColliderProxyAPI)._rebind(coll),
    claimedColliders
  );
  const reapedJointIds = claim(
    joints,
    getJoint,
    (id, joint) => (jointAPIs.get(id) as EngineJointProxyAPI)._rebind(joint),
    claimedJoints
  );
  reapBodies(reapedRigidBodyIds);
  reapColliders(reapedColliderIds);
  reapJoints(reapedJointIds);
  // After the bodies' reap: the parent test reads their handles
  const reapedMultibodyJointIds = claim(
    multibodyJoints,
    getMultibodyJoint,
    (id, joint) => (multibodyJointAPIs.get(id) as EngineMultibodyJointProxyAPI)._rebind(joint),
    claimedMultibodyJoints,
    (id, handle) => isSameMultibodyParent(world, id, handle)
  );
  reapMultibodyJoints(reapedMultibodyJointIds);

  const orphanBodies = collectOrphans<Rapier.RigidBody>(
    (fn) => world.bodies.forEach(fn),
    claimedBodies
  );
  const orphanColliders = collectOrphans<Rapier.Collider>(
    (fn) => world.colliders.forEach(fn),
    claimedColliders
  );
  const orphanJoints = collectOrphans<Rapier.ImpulseJoint>(
    (fn) => world.impulseJoints.forEach(fn),
    claimedJoints
  );
  const orphanMultibodyJoints = collectOrphans<Rapier.MultibodyJoint>(
    (fn) => world.multibodyJoints.forEach(fn),
    claimedMultibodyJoints
  );
  if ((opts?.orphanPolicy ?? 'DELETE') === 'DELETE') {
    removeOrphans(world, orphanBodies, orphanColliders, orphanJoints);
  }
  removeOrphanMultibodyJoints(world, orphanMultibodyJoints);

  // The safety net: Rapier checks the generation itself here. A survivor that fails it means the
  // handle test above aliased (a Rapier version whose handles changed shape)
  const invalidBodies = findInvalid(rigidBodies, getBody);
  const invalidColliders = findInvalid(colliders, getCollider);
  const invalidJoints = findInvalid(joints, getJoint);
  const invalidMultibodyJoints = findInvalid(multibodyJoints, getMultibodyJoint);
  const invalidCount =
    invalidBodies.length +
    invalidColliders.length +
    invalidJoints.length +
    invalidMultibodyJoints.length;
  if (invalidCount) {
    if (backend.isDebugEnvironment) {
      lerror(
        `Physics snapshot restore: ${invalidCount} rebound object(s) aren't valid in the restored world (bodies ${invalidBodies.join(', ')}; colliders ${invalidColliders.join(', ')}; joints ${invalidJoints.join(', ')}; multibody joints ${invalidMultibodyJoints.join(', ')}). Reaped them: check the handle test in RapierRestore.ts against the Rapier version.`
      );
    }
    reapBodies(invalidBodies);
    reapColliders(invalidColliders);
    reapJoints(invalidJoints);
    reapMultibodyJoints(invalidMultibodyJoints);
    reapedRigidBodyIds.push(...invalidBodies);
    reapedColliderIds.push(...invalidColliders);
    reapedJointIds.push(...invalidJoints);
    reapedMultibodyJointIds.push(...invalidMultibodyJoints);
  }
  rebuildMultibodyTree();

  // The replaced world's events and exits describe a timeline the restore left
  backend.eventQueue?.clear();
  clearPendingEventRecords();
  clearPendingOutOfBoundsRecords();
  // The bounds may have changed since the snapshot, and a body restored asleep is never checked
  for (const id of rigidBodies.keys()) queueBodyCheck(id);

  const orphanCounts = {
    rigidBodies: orphanBodies.length,
    colliders: orphanColliders.length,
    joints: orphanJoints.length,
    multibodyJoints: orphanMultibodyJoints.length,
  };
  if (
    backend.isDebugEnvironment &&
    (reapedRigidBodyIds.length ||
      reapedColliderIds.length ||
      reapedJointIds.length ||
      reapedMultibodyJointIds.length ||
      orphanBodies.length ||
      orphanColliders.length ||
      orphanJoints.length ||
      orphanMultibodyJoints.length)
  ) {
    const orphansKept = opts?.orphanPolicy === 'KEEP' ? 'kept' : 'taken out';
    lwarn(
      `Physics snapshot restore wasn't an exact rewind (p500 D11): reaped ${reapedRigidBodyIds.length} bodies, ${reapedColliderIds.length} colliders, ${reapedJointIds.length} joints and ${reapedMultibodyJointIds.length} multibody joints made after the snapshot; ${orphanBodies.length} bodies, ${orphanColliders.length} colliders and ${orphanJoints.length} joints deleted since were ${orphansKept}, and ${orphanMultibodyJoints.length} multibody joints taken out.`
    );
  }
  return {
    reapedRigidBodyIds,
    reapedColliderIds,
    reapedJointIds,
    reapedMultibodyJointIds,
    orphanCounts,
  };
};
