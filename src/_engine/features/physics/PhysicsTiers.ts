// Physics simulation tiers (p352): a dynamic body can be
// frozen in place but collidable (STATIC), taken out of the simulation (DISABLED) or out of the
// physics world (REMOVED), and put back (FULL). The physicsTiers() feature installs its system and
// hooks (installPhysicsTiers, PhysicsTiersFeature.ts); with no tier requested, the system returns
// at once.

import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { type ECSWorld, getAllECSWorlds, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  detachRigidBody,
  detachRigidBodySync,
  reattachRigidBody,
  reattachRigidBodySync,
} from './PhysicsBodies';
import {
  forEachJointBodyPair,
  hasJoints,
  isBodyJointed,
  setJointCreatedListener,
} from './PhysicsJoints';
import {
  forEachMultibodyJointBodyPair,
  hasMultibodyJoints,
  isBodyInMultibody,
  setMultibodyJointCreatedListener,
} from './PhysicsMultibodyJoints';
import { assertPhysicsTiersInstalled, getPhysicsState } from './PhysicsState';
import { type RigidBodyPose, RigidBodyTypeAPI } from './types/PhysicsBodyTypes';
import type { PhysicsSimTierData, PhysicsTier } from './PhysicsTierTypes';
import type { PhysicsTierWant } from '../../kernel/ecs/PhysicsTierAccess';
import { getPhysicsBodyOwner, getPhysicsEntityBody, queueStaticBodySync } from './PhysicsEntity';
import { resetPhysicsInterpolationHistory } from './PhysicsInterpolation';
import { onPhysicsRestore } from './PhysicsWorld';

/** First in APP_PHYSICS_STEP (higher runs first), so the other systems of that sub-step see
 * the new tiers and buckets. */
const PHYSICS_TIER_SYSTEM_ORDER = 100;

/** Per world: entities whose target differs from their tier, in request order. */
const pendingByWorld = new WeakMap<ECSWorld, Set<number>>();

const getPending = (world: ECSWorld) => {
  let pending = pendingByWorld.get(world);
  if (!pending) {
    pending = new Set();
    pendingByWorld.set(world, pending);
  }
  return pending;
};

/**
 * Whether any joint of either kind exists, so a joint walk can be skipped.
 * @internal
 */
export const hasAnyJoints = () => hasJoints() || hasMultibodyJoints();

/**
 * Calls `fn` with the two body ids of every live joint, impulse and multibody (p250): the joint
 * groups' edges.
 * @internal
 */
export const forEachJointedBodyPair = (fn: (body1Id: number, body2Id: number) => void) => {
  forEachJointBodyPair(fn);
  forEachMultibodyJointBodyPair(fn);
};

/** Whether the body has a joint of either kind (also one in flight to the worker). */
const isBodyAnyJointed = (bodyId: number) => isBodyJointed(bodyId) || isBodyInMultibody(bodyId);

/** The kinds of joint a body or a group has, as bits. */
const IMPULSE_JOINT = 1;
const MULTIBODY_JOINT = 2;

const getBodyJointKinds = (bodyId: number) =>
  (isBodyJointed(bodyId) ? IMPULSE_JOINT : 0) | (isBodyInMultibody(bodyId) ? MULTIBODY_JOINT : 0);

/**
 * The tier a body or group with joints of `kinds` takes for `tier` (p250 D5): Rapier mishandles
 * impulse joints on disabled bodies (i250: `DISABLED` is `STATIC`), and panics on a multibody link
 * that isn't dynamic (`STATIC` is `DISABLED`), so with both kinds neither frozen tier is safe
 * (`FULL`). `FULL` and `REMOVED` pass (`REMOVED` is refused with any joint before this).
 */
const toSafeTier = (kinds: number, tier: PhysicsTier): PhysicsTier => {
  if ((tier !== 'STATIC' && tier !== 'DISABLED') || !kinds) return tier;
  if (kinds === (IMPULSE_JOINT | MULTIBODY_JOINT)) return 'FULL';
  return kinds === IMPULSE_JOINT ? 'STATIC' : 'DISABLED';
};

/** Why `entityId` can't have `tier`, or null when it can. */
const getTierRefusal = (world: ECSWorld, entityId: number, tier: PhysicsTier): string | null => {
  if (world.hasComponent(entityId, ComponentType.TAG_IS_CHARACTER)) {
    return 'it is a character (p420 owns character tiers)';
  }
  const rb = getPhysicsEntityBody(world, entityId);
  if (!rb) return 'it has no rigid body (request a tier once its createPhysicsEntity resolves)';
  const owner = getPhysicsBodyOwner(rb.id);
  if (!owner || owner.world !== world || owner.entityId !== entityId) {
    return 'its body was not created by createPhysicsEntity';
  }
  if (owner.rigidType !== 'DYNAMIC') {
    return `its body was created ${owner.rigidType}, and only DYNAMIC bodies have tiers`;
  }
  if (tier === 'REMOVED' && isBodyAnyJointed(rb.id)) {
    return 'it has joints, which REMOVED would delete (p500 owns re-creating joints)';
  }
  return null;
};

/**
 * The entities that change tier together with `entityId`: every body connected to it by joints
 * of either kind, through bodies that can have tiers. A FIXED or kinematic body, or one not created by
 * createPhysicsEntity, ends a group without joining it (two chains hanging from one fixed
 * ceiling are two groups, and so are two branches of a multibody under a fixed root, each of
 * which Rapier freezes alone when its links are disabled). Returns the refusal reason instead when one of them can't have a tier.
 * `REMOVED` is refused with any joint, so its group is the entity alone.
 */
const resolveTierGroup = (
  world: ECSWorld,
  entityId: number,
  tier: PhysicsTier
): number[] | string => {
  const refusal = getTierRefusal(world, entityId, tier);
  if (refusal) return refusal;
  if (tier === 'REMOVED' || !hasAnyJoints()) return [entityId];

  const adjacency = new Map<number, number[]>();
  const link = (from: number, to: number) => {
    const linked = adjacency.get(from);
    if (linked) linked.push(to);
    else adjacency.set(from, [to]);
  };
  forEachJointedBodyPair((body1Id, body2Id) => {
    link(body1Id, body2Id);
    link(body2Id, body1Id);
  });

  const startBodyId = getPhysicsEntityBody(world, entityId)!.id;
  const members = [entityId];
  const seen = new Set([startBodyId]);
  const queue = [startBodyId];
  while (queue.length) {
    const linked = adjacency.get(queue.pop()!);
    if (!linked) continue;
    for (const bodyId of linked) {
      if (seen.has(bodyId)) continue;
      seen.add(bodyId);
      const owner = getPhysicsBodyOwner(bodyId);
      if (!owner || owner.world !== world || owner.rigidType !== 'DYNAMIC') continue;
      const memberRefusal = getTierRefusal(world, owner.entityId, tier);
      if (memberRefusal) return `joint group member ${owner.entityId}: ${memberRefusal}`;
      members.push(owner.entityId);
      queue.push(bodyId);
    }
  }
  return members;
};

// p352
/**
 * Requests a simulation tier for a dynamic physics entity. It applies at the start of
 * the next `APP_PHYSICS_STEP` sub-step, so a request from an `APP_PHYSICS_STEP` system or from
 * scene-load code is deterministic. Requests before then collapse into the latest one.
 *
 * - `FULL`: simulated as created.
 * - `STATIC`: switched to `FIXED`. It still collides, but nothing moves or wakes it. Rapier
 *   zeroes its velocities, so it resumes from rest.
 * - `DISABLED`: out of the broad phase, contacts and queries (rays miss it), so only where
 *   nothing can reach it. It keeps its pose and velocities exactly. A body with impulse joints (its
 *   whole group) gets `STATIC` instead, and so does a `DISABLED` one an impulse joint is created
 *   on, before the next step: Rapier mishandles impulse joints on disabled bodies.
 * - `REMOVED`: the body and its colliders leave the physics world and free their
 *   transform-buffer slot; the entity and its visual stay. Their state is kept, with their ids
 *   (references to the body and colliders work again once it's back). A body at rest comes back
 *   exactly as if it had never left; a moving one with its pose, velocities and sleep state, but
 *   Rapier's contact and solver state starts over. Refused for a body with joints.
 *
 * `STATIC` and `DISABLED` move the entity to `BODY_STATIC`: no per-frame sync or interpolation,
 * and `world.getRigidBody` still returns its body. The body's type and enabled state belong to
 * the tier until it's `FULL` again (`world.setDisabled` keeps a `DISABLED` body disabled).
 * `REMOVED` takes its bucket and COLLIDER components away (`world.getRigidBody` returns
 * undefined), and `world.setTransform` moves only its visual until it's back. In WORKER_THREAD
 * mode the components come back a frame or so after the body does (`getPhysicsTier`'s
 * `inFlight`); a full transform buffer then refuses it (`PhysicsCapacityError`, logged), and it
 * stays `REMOVED`.
 *
 * Every body connected to it by joints changes tier with it (see resolveTierGroup). A group with
 * multibody joints gets `DISABLED` for `STATIC` (a multibody link can't be fixed), and one with
 * both kinds stays `FULL` for either (a debug-env warning).
 * Returns false and changes nothing when the entity or a member of its joint group can't have a
 * tier: a character, no rigid body (yet), or a body not created `DYNAMIC` by
 * `createPhysicsEntity`. Throws without the `physicsTiers()` feature in `InitEngine`'s
 * `features`.
 * @example
 * ```ts
 * import { createPhysicsEntity, requestPhysicsTier } from 'aekasha/physics';
 *
 * const crateId = await createPhysicsEntity({
 *   colliders: { type: 'BOX', hx: 0.5, hy: 0.5, hz: 0.5 },
 *   body: { rigidType: 'DYNAMIC', translation: { x: 0, y: 2, z: 0 } },
 * });
 * // Out of sight: frozen in place, still collidable
 * requestPhysicsTier(crateId, 'STATIC');
 * ```
 */
export const requestPhysicsTier = (
  entityId: number,
  tier: PhysicsTier,
  ecsWorld?: ECSWorld
): boolean => {
  assertPhysicsTiersInstalled('requestPhysicsTier');
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in requestPhysicsTier.');
  const group = resolveTierGroup(world, entityId, tier);
  if (typeof group === 'string') {
    if (IS_DEBUG_ENV) {
      lwarn(`requestPhysicsTier: entity ${entityId} can't change tier to ${tier}: ${group}.`);
    }
    return false;
  }
  const safeTier = toJointSafeTier(world, group, tier);
  if (IS_DEBUG_ENV && safeTier === 'FULL' && tier !== 'FULL') {
    lwarn(
      `requestPhysicsTier: entity ${entityId}'s joint group has impulse and multibody joints, so it stays FULL for ${tier}: Rapier can't take a fixed multibody link, nor (i250) disabled impulse joints.`
    );
  }
  setGroupTarget(world, group, safeTier);
  return true;
};

/** The kinds of joint the members of a resolved group have (a group of one can be jointed to a
 * fixed body), joints in flight to the worker included. */
const getGroupJointKinds = (world: ECSWorld, group: readonly number[]) => {
  let kinds = 0;
  for (let i = 0; i < group.length; i++) {
    const body = getPhysicsEntityBody(world, group[i]);
    if (body) kinds |= getBodyJointKinds(body.id);
  }
  return kinds;
};

/**
 * Whether the entity's body has a joint (also one requested from the worker, not replied yet).
 * @internal
 */
export const isPhysicsEntityJointed = (world: ECSWorld, entityId: number) => {
  const body = getPhysicsEntityBody(world, entityId);
  return !!body && isBodyAnyJointed(body.id);
};

/** The tier a resolved group can have for `tier`, by its joints (`toSafeTier`): an impulse-jointed
 * group's `DISABLED` is `STATIC` (Rapier 0.19.3 panicked on a joint inserted between disabled
 * bodies, and stepping them corrupted other joints' solving, unchecked on 0.21.0:
 * docs/issues/i250_rapier-joint-on-disabled-bodies-panics.md), a multibody's `STATIC` is
 * `DISABLED`, and with both it's `FULL`. */
const toJointSafeTier = (world: ECSWorld, group: readonly number[], tier: PhysicsTier) =>
  tier === 'STATIC' || tier === 'DISABLED'
    ? toSafeTier(getGroupJointKinds(world, group), tier)
    : tier;

/** Makes `tier` the target of every entity of a resolved group (resolveTierGroup), queued for the
 * next APP_PHYSICS_STEP sub-step. */
const setGroupTarget = (world: ECSWorld, group: readonly number[], tier: PhysicsTier) => {
  const pending = getPending(world);
  for (const memberId of group) {
    let data = world.getComponent(memberId, ComponentType.PHYSICS_SIM_TIER);
    if (!data) {
      if (tier === 'FULL') continue; // no component = FULL
      data = {
        tier: 'FULL',
        target: tier,
        bucket: world.hasComponent(memberId, ComponentType.BODY_DYNAMIC_VISUAL)
          ? 'BODY_DYNAMIC_VISUAL'
          : 'BODY_DYNAMIC_HEADLESS',
        body: world.getRigidBody(memberId)!,
        colliders: null,
        inFlight: false,
        removalSeq: 0,
      };
      world.addComponent(memberId, ComponentType.PHYSICS_SIM_TIER, data);
    }
    data.target = tier;
    if (data.target === data.tier) pending.delete(memberId);
    else pending.add(memberId);
  }
};

/** A tier's coarseness: a joint group takes its members' finest want. */
const TIER_RANK: Record<PhysicsTier, number> = { FULL: 0, STATIC: 1, DISABLED: 2, REMOVED: 3 };

/**
 * Requests tiers for a batch of entities by what the caller wants for each (p353 Phase 4 D6; the
 * kernel's `PhysicsTierAccess.requestTiers`, which `physicsTiers()` sets): an entity that can't
 * have tiers, or whose group can't take the tier, is skipped without a warning (the caller asks
 * for whatever its entities are). A joint group takes the finest want of its members, asking
 * `wantOf` for the unlisted ones too, and a `POLICY` member leaves the group to the policy. Each
 * group is requested once per batch. A jointed group gets `STATIC` for `REMOVED`
 * (`requestPhysicsTier` refuses `REMOVED` for one), which its joints then make what they can have
 * (`toJointSafeTier`: `STATIC`, `DISABLED` for a multibody, `FULL` with both kinds).
 * @internal
 */
export const requestPhysicsTierWants = (
  world: ECSWorld,
  entityIds: readonly number[],
  wantOf: (entityId: number) => PhysicsTierWant | null
) => {
  const isJointed = hasAnyJoints();
  const handled = isJointed ? new Set<number>() : null;
  for (let i = 0; i < entityIds.length; i++) {
    const entityId = entityIds[i];
    if (handled?.has(entityId)) continue;
    const want = wantOf(entityId);
    if (want === null) continue;
    let tier: PhysicsTierWant = want;
    if (handled) {
      // The whole joint group, whatever the tier (a REMOVED want is STATIC below)
      const group = resolveTierGroup(world, entityId, 'FULL');
      if (typeof group === 'string') continue;
      for (let j = 0; j < group.length && tier !== 'POLICY'; j++) {
        const memberId = group[j];
        const memberWant = memberId === entityId ? want : wantOf(memberId);
        if (memberWant === 'POLICY') tier = 'POLICY';
        else if (memberWant !== null && TIER_RANK[memberWant] < TIER_RANK[tier]) tier = memberWant;
      }
      for (let j = 0; j < group.length; j++) handled.add(group[j]);
    }
    if (tier === 'POLICY') continue;
    let group = resolveTierGroup(world, entityId, tier);
    if (typeof group === 'string' && tier === 'REMOVED' && handled) {
      // A jointed group can't leave the world (its joints would go): STATIC, as for DISABLED
      // (p353 Phase 5 D11). Any other refusal refuses STATIC too.
      tier = 'STATIC';
      group = resolveTierGroup(world, entityId, tier);
    }
    if (typeof group !== 'string')
      setGroupTarget(world, group, toJointSafeTier(world, group, tier));
  }
};

/**
 * `entityId`'s tier, the tier requested for it that hasn't applied yet (null if none), and
 * whether it's in flight back from `REMOVED` (WORKER_THREAD: the body is back, its bucket and
 * COLLIDER components aren't yet). An entity that never got a tier is `FULL` (every entity, without
 * the `physicsTiers()` feature).
 * @example
 * ```ts
 * import { getPhysicsTier } from 'aekasha/physics';
 *
 * declare const crateId: number;
 * const { tier, pending } = getPhysicsTier(crateId);
 * if (tier === 'REMOVED' && pending === null) console.log('the crate is out of the world');
 * ```
 */
export const getPhysicsTier = (
  entityId: number,
  ecsWorld?: ECSWorld
): { tier: PhysicsTier; pending: PhysicsTier | null; inFlight: boolean } => {
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in getPhysicsTier.');
  const data = world.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER);
  if (!data) return { tier: 'FULL', pending: null, inFlight: false };
  return {
    tier: data.tier,
    pending: data.target !== data.tier ? data.target : null,
    inFlight: data.inFlight,
  };
};

const isMainThread = () => getPhysicsState().workerTarget === 'MAIN_THREAD';

/** Whether a worker reply for the move to or from REMOVED numbered `seq` is still the latest. */
const isCurrentRemoval = (
  world: ECSWorld,
  entityId: number,
  data: PhysicsSimTierData,
  seq: number
) =>
  world.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER) === data && data.removalSeq === seq;

/** Shows a REMOVED entity where its body was taken out: in WORKER_THREAD mode the transform can
 * be a frame behind it. */
const showRemovedPose = (world: ECSWorld, entityId: number, pose: RigidBodyPose | undefined) => {
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (!pose || !transform) return;
  transform.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
  transform.quaternion.set(pose.rot.x, pose.rot.y, pose.rot.z, pose.rot.w);
  transform.setDirty();
  world.commitTransform(entityId, transform);
};

/** Takes the entity's body out of the physics world (to REMOVED). In WORKER_THREAD mode it's
 * detached right before this sub-step, and the reply only brings its pose for the visual. */
const removeFromWorld = (world: ECSWorld, entityId: number, data: PhysicsSimTierData) => {
  const bodyId = data.body.id;
  // A joint made since the request (getTierRefusal checked then)
  if (isBodyAnyJointed(bodyId)) {
    if (IS_DEBUG_ENV) {
      lwarn(`requestPhysicsTier: entity ${entityId} got joints, it stays ${data.tier}.`);
    }
    data.target = data.tier;
    return;
  }
  if (!data.inFlight) {
    world.removeComponent(
      entityId,
      ComponentType[data.tier === 'FULL' ? data.bucket : 'BODY_STATIC']
    );
    data.colliders = world.getComponent(entityId, ComponentType.COLLIDER) ?? [];
    world.removeComponent(entityId, ComponentType.COLLIDER);
  }
  // A return still in flight is overtaken: its reply is dropped
  data.inFlight = false;
  data.tier = 'REMOVED';
  const seq = ++data.removalSeq;
  if (isMainThread()) {
    showRemovedPose(world, entityId, detachRigidBodySync(bodyId));
    return;
  }
  detachRigidBody(bodyId).then(
    (pose) => {
      if (isCurrentRemoval(world, entityId, data, seq)) showRemovedPose(world, entityId, pose);
    },
    (err) => lerror(`Physics tier: failed to remove entity ${entityId}.`, err)
  );
};

/** Gives a body that is back in the world its bucket and COLLIDER components, for its tier. */
const placeInWorld = (world: ECSWorld, entityId: number, data: PhysicsSimTierData) => {
  // Its interpolation history ends where it was removed: it starts over from the current pose
  resetPhysicsInterpolationHistory(world, entityId);
  if (data.tier === 'FULL') {
    world.addComponent(entityId, ComponentType[data.bucket], data.body);
  } else {
    world.addComponent(entityId, ComponentType.BODY_STATIC, data.body);
    queueStaticBodySync(world, entityId);
  }
  world.addComponent(entityId, ComponentType.COLLIDER, data.colliders ?? []);
  data.colliders = null;
};

/** A return that didn't happen (a full transform buffer): the entity stays REMOVED. */
const stayRemoved = (world: ECSWorld, entityId: number, data: PhysicsSimTierData, err: unknown) => {
  data.tier = 'REMOVED';
  data.target = 'REMOVED';
  pendingByWorld.get(world)?.delete(entityId);
  lwarn(`Physics tier: entity ${entityId} stays REMOVED.`, err);
};

/** Puts the entity's body back into the physics world (from REMOVED), straight into tier `to`.
 * In WORKER_THREAD mode it's back right before this sub-step, and it's in flight until the
 * reply brings its slot: later requests still apply on their own steps (the worker runs them
 * in order), only the components wait for it. */
const returnToWorld = (
  world: ECSWorld,
  entityId: number,
  data: PhysicsSimTierData,
  to: PhysicsTier
) => {
  const bodyId = data.body.id;
  const state = {
    bodyType: to === 'STATIC' ? RigidBodyTypeAPI.Fixed : RigidBodyTypeAPI.Dynamic,
    // A world-disabled entity's body stays disabled whatever its tier (ECSWorld.setDisabled)
    enabled: to !== 'DISABLED' && !world.isDisabled(entityId),
  };
  data.tier = to;
  const seq = ++data.removalSeq;
  if (isMainThread()) {
    if (reattachRigidBodySync(bodyId, state)) placeInWorld(world, entityId, data);
    else stayRemoved(world, entityId, data, `rigid body ${bodyId} was not detached`);
    return;
  }
  data.inFlight = true;
  reattachRigidBody(bodyId, state).then(
    (pose) => {
      if (!isCurrentRemoval(world, entityId, data, seq)) return;
      data.inFlight = false;
      if (pose) placeInWorld(world, entityId, data);
      else stayRemoved(world, entityId, data, `rigid body ${bodyId} was not detached`);
    },
    (err) => {
      if (!isCurrentRemoval(world, entityId, data, seq)) return;
      data.inFlight = false;
      stayRemoved(world, entityId, data, err);
    }
  );
};

/**
 * Moves one entity from its tier to its target. FULL, STATIC and DISABLED are body states:
 * FULL = DYNAMIC and enabled, STATIC = FIXED and enabled, DISABLED = DYNAMIC and disabled; only
 * the difference is written. All of it is one-way commands, so in WORKER_THREAD mode they ride
 * in this sub-step's STEP message. REMOVED takes the body out of the world (removeFromWorld,
 * returnToWorld).
 */
const applyTier = (world: ECSWorld, entityId: number, data: PhysicsSimTierData) => {
  // A joint made since the request: the body's own joints decide (toJointSafeTier is the group's)
  if (data.target === 'STATIC' || data.target === 'DISABLED') {
    data.target = toSafeTier(getBodyJointKinds(data.body.id), data.target);
  }
  const from = data.tier;
  const to = data.target;
  if (from === to) return;
  if (to === 'REMOVED') return removeFromWorld(world, entityId, data);
  if (from === 'REMOVED') return returnToWorld(world, entityId, data, to);

  const rb = data.body;
  if ((from === 'STATIC') !== (to === 'STATIC')) {
    const toStatic = to === 'STATIC';
    rb.setBodyType(toStatic ? RigidBodyTypeAPI.Fixed : RigidBodyTypeAPI.Dynamic, !toStatic);
  }
  // A world-disabled entity's body stays disabled whatever its tier (ECSWorld.setDisabled)
  if ((from === 'DISABLED') !== (to === 'DISABLED') && !world.isDisabled(entityId)) {
    rb.setEnabled(to !== 'DISABLED');
  }
  data.tier = to;
  moveToTierBucket(world, entityId, data, from, to);
};

/** Moves an entity whose tier went `from` → `to` (neither REMOVED) between its dynamic bucket
 * (FULL) and BODY_STATIC (STATIC, DISABLED). Not while in flight back from REMOVED: placeInWorld
 * picks the bucket for the tier it has by then. */
const moveToTierBucket = (
  world: ECSWorld,
  entityId: number,
  data: PhysicsSimTierData,
  from: PhysicsTier,
  to: PhysicsTier
) => {
  if (data.inFlight || (from === 'FULL') === (to === 'FULL')) return;
  if (from === 'FULL') {
    world.removeComponent(entityId, ComponentType[data.bucket]);
    world.addComponent(entityId, ComponentType.BODY_STATIC, data.body);
    // The mesh shows the interpolated pose, which can be behind: the transform is marked dirty
    // so object3DSyncSystem copies it, and synced until a snapshot includes the frozen pose.
    const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (transform) {
      transform.setDirty();
      world.commitTransform(entityId, transform);
    }
    queueStaticBodySync(world, entityId);
  } else {
    // Its interpolation history has a gap now, so it starts over from the current pose
    world.removeComponent(entityId, ComponentType.BODY_STATIC);
    world.addComponent(entityId, ComponentType[data.bucket], data.body);
  }
};

const physicsTierSystem = (world: ECSWorld) => {
  const pending = pendingByWorld.get(world);
  if (!pending?.size) return;
  for (const entityId of pending) {
    const data = world.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER);
    if (data) applyTier(world, entityId, data);
  }
  pending.clear();
};

/**
 * A joint of either kind is being created between the two bodies (an impulse one at its call, a
 * multibody one once it exists): a body wanting `STATIC` or `DISABLED` makes its group, joined now,
 * want what its joints let it have, before the next step (toJointSafeTier; a `DISABLED` group an
 * impulse joint joins goes `STATIC`). An impulse joint's own insert is safe either way (the
 * backend's `createImpulseJointOnDisabled`). The tiers' listener (`setJointCreatedListener`,
 * `setMultibodyJointCreatedListener`).
 * @internal
 */
export const onPhysicsJointCreated = (body1Id: number, body2Id: number) => {
  for (const bodyId of [body1Id, body2Id]) {
    const owner = getPhysicsBodyOwner(bodyId);
    if (!owner) continue;
    const data = owner.world.getComponent(owner.entityId, ComponentType.PHYSICS_SIM_TIER);
    const want = data?.target;
    if (want !== 'STATIC' && want !== 'DISABLED') continue;
    const group = resolveTierGroup(owner.world, owner.entityId, want);
    if (typeof group !== 'string') {
      setGroupTarget(owner.world, group, toJointSafeTier(owner.world, group, want));
    }
  }
};

/** The tier a restored body is in: its type and enabled state are the snapshot's. A world-disabled
 * entity's body is disabled in FULL too (ECSWorld.setDisabled), so it keeps FULL or DISABLED, as it
 * can't be told which. */
const getRestoredTier = (world: ECSWorld, entityId: number, data: PhysicsSimTierData) => {
  if (data.body.bodyTypeSync() === RigidBodyTypeAPI.Fixed) return 'STATIC';
  if (data.body.isEnabledSync()) return 'FULL';
  if (world.isDisabled(entityId) && data.tier !== 'DISABLED') return 'FULL';
  return 'DISABLED';
};

/**
 * The tiers' restore hook (p500 Phase 3, `onPhysicsRestore`): a snapshot restore puts every body's
 * type and enabled state back to the snapshot's, so each tiered entity of every ECS world gets the
 * tier its body is in (FIXED: `STATIC`; dynamic and enabled: `FULL`; dynamic and disabled:
 * `DISABLED`) and that tier's bucket, and the requests not applied yet are dropped: the tiers are
 * the snapshot's, and the policy decides again from its step. A `REMOVED` entity stays: its body is
 * out of the world (one detached since the snapshot stays so, its copy in the snapshot an orphan).
 * The body proxies hold the restored state when the hooks run (WORKER_THREAD: the reply's).
 * @internal
 */
export const resetPhysicsTiersAfterRestore = () => {
  for (const world of getAllECSWorlds()) {
    for (const entityId of world.getEntitiesWith(ComponentType.PHYSICS_SIM_TIER)) {
      const data = world.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER)!;
      // A deleted world's body (an entity of another ECS world left from an earlier scene)
      if (data.body.isBeingDeleted) continue;
      const from = data.tier;
      const to = from === 'REMOVED' ? from : getRestoredTier(world, entityId, data);
      data.tier = to;
      // A request not applied yet is dropped: still queued, it finds nothing to do
      data.target = to;
      if (to !== 'REMOVED') moveToTierBucket(world, entityId, data, from, to);
    }
  }
};

/**
 * Installs the tiers' `APP_PHYSICS_STEP` system, the `PHYSICS_SIM_TIER` hooks, the joint
 * listener and the restore hook (the `physicsTiers()` feature's install).
 * @internal
 */
export const installPhysicsTiers = (ctx: FeatureContext) => {
  setJointCreatedListener(onPhysicsJointCreated);
  setMultibodyJointCreatedListener(onPhysicsJointCreated);
  // After physics' own restore hook (install order): the reaped entities are gone
  onPhysicsRestore(resetPhysicsTiersAfterRestore);
  ctx.registerPlugin((world) => {
    world.addSystem(
      ECSSystemStage.APP_PHYSICS_STEP,
      'physicsTierSystem',
      physicsTierSystem,
      PHYSICS_TIER_SYSTEM_ORDER
    );
  });

  ctx.registerComponentHooks(ComponentType.PHYSICS_SIM_TIER, {
    onRemoveComponent: (entityId, world) => pendingByWorld.get(world)?.delete(entityId),
    onDeleteEntity: (entityId, world) => pendingByWorld.get(world)?.delete(entityId),
  });
};
