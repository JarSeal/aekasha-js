// Physics tier distance policy (docs/plans/_DONE_p352_physics-simulation-tiers.md §5,
// _DONE_p343_deterministic-physics-tier-policy.md): each member entity (PHYSICS_TIER_POLICY)
// gets the tier of the ring around the focus it's in, through requestPhysicsTier. With the STEPS
// cadence (default) it measures on a fixed physics step and applies `interval` steps later, so
// it's deterministic; with FRAMES it runs every N frames at APP_LOGIC. The physics feature
// installs its systems (installPhysicsTierPolicy); without a policy they return at once
// (createPhysicsEntity's `tierPolicy` option only adds the component).

import * as THREE from 'three/webgpu';

import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { getMainCamera } from '../../kernel/camera/Camera';
import {
  DEFAULT_ECS_WORLD_ID,
  type ECSWorld,
  getAllECSWorlds,
  getECSWorld,
  onECSWorldRegistryChange,
} from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { IComponentStorage } from '../../kernel/ecs/ECSComponentStorage';
import { readBodyPositionsAtStep, readBodyPositionsSync } from './PhysicsBodies';
import { forEachJointBodyPair, hasJoints } from './PhysicsJoints';
import { getPhysicsState } from './PhysicsState';
import {
  addPhysicsStepGate,
  getPhysicsSimHistoryEpoch,
  getPhysicsSubStepIndex,
} from './PhysicsStepping';
import type {
  PhysicsSimTierData,
  PhysicsTier,
  PhysicsTierPolicy,
  PhysicsTierPolicyCadence,
} from './PhysicsTierTypes';
import { getPhysicsBodyOwner, getPhysicsEntityBody } from './PhysicsEntity';
import { requestPhysicsTier } from './PhysicsTiers';
import type { FeatureContext } from '../../kernel/init/Features';

// The defaults PhysicsTierPolicy's fields name
const DEFAULT_HYSTERESIS = 0.15;
const DEFAULT_TIER_POLICY_CADENCE: PhysicsTierPolicyCadence = 'STEPS';
const DEFAULT_TIER_POLICY_INTERVAL = 10;
/**
 * The determinism probe's freeze source. A STEPS policy ignores it: it's deterministic, so the
 * probe tests it instead of freezing it.
 * @internal
 */
export const DETERMINISM_PROBE_FREEZE_SOURCE = 'DETERMINISM_PROBE';
/** STEPS: in APP_PHYSICS_STEP before physicsTierSystem (100; higher runs first), so a decision's
 * requests apply in the sub-step it's made in. */
const POLICY_STEP_SYSTEM_ORDER = 110;

/** STEPS: the positions measured on step `step`, decided on step `applyAt`. Pooled with its
 * arrays (measurementPool), so a pass allocates only a WORKER_THREAD request. */
type Measurement = {
  step: number;
  applyAt: number;
  /** Bumped when it goes back to the pool (decided or dropped): a worker reply to an earlier use
   * is ignored. */
  use: number;
  /** The members measured, in entity id order: the first `count`. Entity ids are int32 (ECS.ts'
   * packing), and a typed array's read stays a small integer, not a boxed double. */
  entityIds: Int32Array;
  count: number;
  /** The members' bodies (`count` ids); with a focus entity that has a body, its body is the
   * last id. */
  bodyIds: number[];
  /** The focus when it isn't a body read with the members (`hasFocus`). */
  focus: THREE.Vector3;
  hasFocus: boolean;
  /** x, y, z per body id; null until the worker's reply (WORKER_THREAD). */
  positions: Float32Array | null;
  /** MAIN_THREAD: what `positions` is read into, kept with the measurement. */
  positionsBuffer: Float32Array | null;
  /** WORKER_THREAD: holds stepping before `applyAt` until the reply is in. */
  releaseGate: (() => void) | null;
};

type ResolvedPolicy = {
  def: Readonly<PhysicsTierPolicy>;
  /** Each ring's tier, nearest first. */
  tiers: PhysicsTier[];
  /** Each ring's squared outer radius (the last ring's is Infinity). */
  withinSq: number[];
  /** Each ring's squared radius an entity in it moves out past: within × (1 + hysteresis). */
  leaveSq: number[];
  cadence: PhysicsTierPolicyCadence;
  interval: number;
  /** FRAMES: frames until the next pass. */
  framesUntilPass: number;
  /** STEPS: measurements waiting for their step, oldest first. */
  pending: Measurement[];
  /** STEPS: the physics world (getPhysicsSimHistoryEpoch) the pending measurements belong to. */
  simEpoch: number;
  /** STEPS: the step of the latest measurement, -1 before the first. */
  lastMeasuredStep: number;
};

const policies = new Map<ECSWorld, ResolvedPolicy>();
/** Per world: whoever froze its policy (the app, the debug tab, the determinism probe). */
const freezeSources = new WeakMap<ECSWorld, Set<string>>();

const getWorld = (ecsWorld: ECSWorld | undefined, fnName: string) =>
  ecsWorld || existsOrThrow(getECSWorld(), `Could not get ECS world in ${fnName}.`);

/** Throws on a policy whose rings can't be resolved. */
const validatePolicy = (policy: PhysicsTierPolicy) => {
  const fail = (reason: string) => {
    throw new Error(`setPhysicsTierPolicy: ${reason}.`);
  };
  const { rings } = policy;
  if (!rings.length) fail('a policy needs at least one ring');
  const seen = new Set<PhysicsTier>();
  let prevWithin = 0;
  rings.forEach(({ tier, within }, i) => {
    if (seen.has(tier)) fail(`tier ${tier} is in more than one ring`);
    seen.add(tier);
    const isLast = i === rings.length - 1;
    if (isLast) {
      if (within !== undefined) {
        fail(`the last ring (${tier}) covers everything beyond the others, so it has no within`);
      }
      return;
    }
    if (within === undefined || !Number.isFinite(within) || within <= prevWithin) {
      fail(`ring ${i} (${tier}) needs a within greater than ${prevWithin}`);
    }
    prevWithin = within!;
  });
  const hysteresis = policy.hysteresis ?? DEFAULT_HYSTERESIS;
  if (!Number.isFinite(hysteresis) || hysteresis < 0) fail('hysteresis must be 0 or more');
  const interval = policy.interval ?? DEFAULT_TIER_POLICY_INTERVAL;
  if (!Number.isInteger(interval) || interval < 1) {
    fail('interval must be a whole number of 1 or more');
  }
  const cadence = policy.cadence ?? DEFAULT_TIER_POLICY_CADENCE;
  if (cadence !== 'STEPS' && cadence !== 'FRAMES') fail(`unknown cadence ${cadence}`);
};

/** The measurements not in use, of every policy. */
const measurementPool: Measurement[] = [];

const takeMeasurement = (): Measurement =>
  measurementPool.pop() ?? {
    step: 0,
    applyAt: 0,
    use: 0,
    entityIds: new Int32Array(0),
    count: 0,
    bodyIds: [],
    focus: new THREE.Vector3(),
    hasFocus: false,
    positions: null,
    positionsBuffer: null,
    releaseGate: null,
  };

/** Puts a measurement back in the pool: its gate is released, and a late reply to it ignored. */
const releaseMeasurement = (measurement: Measurement) => {
  measurement.releaseGate?.();
  measurement.releaseGate = null;
  measurement.positions = null;
  measurement.use++;
  measurementPool.push(measurement);
};

/** Drops a policy's pending measurements (new world, policy replaced) and releases their gates. */
const dropMeasurements = (policy: ResolvedPolicy) => {
  for (const measurement of policy.pending) releaseMeasurement(measurement);
  policy.pending.length = 0;
};

const deletePolicy = (world: ECSWorld) => {
  const policy = policies.get(world);
  if (!policy) return;
  dropMeasurements(policy);
  policies.delete(world);
};

/**
 * Sets `world`'s physics tier distance policy (p352), or removes it with `null`. On each pass,
 * each entity with the PHYSICS_TIER_POLICY component (createPhysicsEntity's `tierPolicy` option,
 * or setPhysicsTierPolicyMember) gets the tier of the first ring whose `within` its position is
 * in, measured from the focus. After its first pass, it moves out to a coarser ring only beyond
 * `within × (1 + hysteresis)`. The policy only calls `requestPhysicsTier`; a request it refuses
 * (eg. `REMOVED` for a body with joints) isn't repeated until the entity's ring changes.
 *
 * `cadence` (p343) says when a pass runs:
 * - `STEPS` (default): it measures the members' and the focus' positions on every fixed physics
 *   step whose index is a multiple of `interval` (the world's steps: the phase restarts with
 *   every scene load), and decides `interval` steps later, where its requests apply. With a
 *   deterministic focus every decision lands on the same step on every load and in both worker
 *   targets. In WORKER_THREAD mode the positions are read by the worker; when the reply is late,
 *   stepping waits for it at the decision's step (getPhysicsStepGateStats counts it).
 * - `FRAMES`: every `interval` frames at `APP_LOGIC` (the first pass on the next frame), from
 *   the members' TRANSFORM positions; the requests apply on the next physics step, so where
 *   depends on frame timing.
 *
 * Bodies connected by joints change tier together (requestPhysicsTier), so a joint group gets
 * the tier of its member nearest to the focus.
 *
 * Make the `DISABLED` ring start beyond anything that could reach a body before the next pass
 * (a thrown object, a vehicle): a disabled body is invisible to everything else, and the policy
 * only checks the ring order, not that margin.
 *
 * Removing the policy, or an entity from it, leaves its tier as it is. The determinism probe
 * freezes a `FRAMES` policy, and tests a `STEPS` one.
 * @example
 * ```ts
 * import { setPhysicsTierPolicy } from 'aekasha/physics';
 *
 * setPhysicsTierPolicy({
 *   rings: [
 *     { tier: 'FULL', within: 60 },
 *     { tier: 'STATIC', within: 150 },
 *     { tier: 'DISABLED', within: 400 },
 *     { tier: 'REMOVED' }, // beyond
 *   ],
 *   sceneId: 'myScene', // removed when the scene is left
 * });
 * ```
 */
export const setPhysicsTierPolicy = (policy: PhysicsTierPolicy | null, ecsWorld?: ECSWorld) => {
  const world = getWorld(ecsWorld, 'setPhysicsTierPolicy');
  if (!policy) {
    deletePolicy(world);
    return;
  }
  validatePolicy(policy);
  deletePolicy(world);
  const def = { ...policy, rings: policy.rings.map((ring) => ({ ...ring })) };
  const leaveFactor = (1 + (policy.hysteresis ?? DEFAULT_HYSTERESIS)) ** 2;
  const withinSq = def.rings.map(({ within }) => (within === undefined ? Infinity : within ** 2));
  policies.set(world, {
    def,
    tiers: def.rings.map(({ tier }) => tier),
    withinSq,
    leaveSq: withinSq.map((sq) => sq * leaveFactor),
    cadence: policy.cadence ?? DEFAULT_TIER_POLICY_CADENCE,
    interval: policy.interval ?? DEFAULT_TIER_POLICY_INTERVAL,
    framesUntilPass: 1,
    pending: [],
    simEpoch: getPhysicsSimHistoryEpoch(),
    lastMeasuredStep: -1,
  });
};

/**
 * `world`'s physics tier policy as it was set, or null (the debug tab's).
 * @internal
 */
export const getPhysicsTierPolicy = (ecsWorld?: ECSWorld): Readonly<PhysicsTierPolicy> | null =>
  policies.get(getWorld(ecsWorld, 'getPhysicsTierPolicy'))?.def ?? null;

/**
 * `world`'s policy as it runs, or null without one: its cadence and interval (defaults applied),
 * and with `STEPS` the step of its latest measurement (-1 before the first) and how many
 * measurements wait for their decision step. For debug readouts.
 * @internal
 */
export const getPhysicsTierPolicyStatus = (ecsWorld?: ECSWorld) => {
  const policy = policies.get(getWorld(ecsWorld, 'getPhysicsTierPolicyStatus'));
  if (!policy) return null;
  return {
    cadence: policy.cadence,
    interval: policy.interval,
    lastMeasuredStep: policy.lastMeasuredStep,
    pendingMeasurements: policy.pending.length,
  };
};

/**
 * Makes `entityId`'s tier follow its world's policy, or stops it (its tier stays as it is). For
 * an entity created without createPhysicsEntity's `tierPolicy` option. Returns false (with a
 * debug-env warning) for an entity without a body created DYNAMIC by createPhysicsEntity.
 * @example
 * ```ts
 * import { createMeshEntity } from 'aekasha';
 * import { createPhysicsEntity, setPhysicsTierPolicyMember } from 'aekasha/physics';
 *
 * declare const rockMesh: Parameters<typeof createMeshEntity>[0];
 * const rockId = createMeshEntity(rockMesh);
 * await createPhysicsEntity({ type: 'BALL', radius: 1 }, { rigidType: 'DYNAMIC' }, rockId);
 * setPhysicsTierPolicyMember(rockId, true);
 * ```
 */
export const setPhysicsTierPolicyMember = (
  entityId: number,
  member: boolean,
  ecsWorld?: ECSWorld
): boolean => {
  const world = getWorld(ecsWorld, 'setPhysicsTierPolicyMember');
  if (!member) {
    world.removeComponent(entityId, ComponentType.PHYSICS_TIER_POLICY);
    return true;
  }
  if (world.hasComponent(entityId, ComponentType.PHYSICS_TIER_POLICY)) return true;
  const body = getPhysicsEntityBody(world, entityId);
  const owner = body ? getPhysicsBodyOwner(body.id) : undefined;
  if (owner?.world !== world || owner.entityId !== entityId || owner.rigidType !== 'DYNAMIC') {
    if (IS_DEBUG_ENV) {
      lwarn(
        `setPhysicsTierPolicyMember: entity ${entityId} has no DYNAMIC body made by createPhysicsEntity.`
      );
    }
    return false;
  }
  world.addComponent(entityId, ComponentType.PHYSICS_TIER_POLICY, {
    refusedTier: null,
    placed: false,
  });
  return true;
};

/**
 * Freezes `world`'s policy (no passes, every tier stays as it is) or unfreezes it. Each `source`
 * freezes on its own, and the policy runs again once no source holds it (the determinism probe
 * and the debug tab use their own). A frozen `STEPS` policy measures nothing, but decides what it
 * measured before. The probe's source (DETERMINISM_PROBE_FREEZE_SOURCE) doesn't freeze `STEPS`.
 * @internal
 */
export const setPhysicsTierPolicyFrozen = (
  frozen: boolean,
  source = 'APP',
  ecsWorld?: ECSWorld
) => {
  const world = getWorld(ecsWorld, 'setPhysicsTierPolicyFrozen');
  let sources = freezeSources.get(world);
  if (!sources) {
    sources = new Set();
    freezeSources.set(world, sources);
  }
  if (frozen) sources.add(source);
  else sources.delete(source);
};

/** The sources a freeze of `world` holds its policy with, in the order they froze it: a `STEPS`
 * policy leaves the determinism probe's out. */
const getHoldingSources = (world: ECSWorld): string[] => {
  const sources = freezeSources.get(world);
  if (!sources?.size) return [];
  const isSteps = policies.get(world)?.cadence === 'STEPS';
  return [...sources].filter((s) => !isSteps || s !== DETERMINISM_PROBE_FREEZE_SOURCE);
};

/**
 * Whether `world`'s policy is frozen (a `STEPS` policy isn't by the determinism probe), or with
 * `source`, whether that source froze it.
 * @internal
 */
export const isPhysicsTierPolicyFrozen = (ecsWorld?: ECSWorld, source?: string) => {
  const world = getWorld(ecsWorld, 'isPhysicsTierPolicyFrozen');
  if (source !== undefined) return freezeSources.get(world)?.has(source) ?? false;
  return getHoldingSources(world).length > 0;
};

/**
 * The sources that freeze `world`'s policy, in the order they froze it (empty when it runs; a
 * `STEPS` policy leaves the determinism probe's out).
 * @internal
 */
export const getPhysicsTierPolicyFreezeSources = (ecsWorld?: ECSWorld): string[] =>
  getHoldingSources(getWorld(ecsWorld, 'getPhysicsTierPolicyFreezeSources'));

const _focus = new THREE.Vector3();

/** The main camera's position, the default focus: the default world's main camera is cached
 * (getMainCamera, p612 D7), another world's is queried. */
const readCameraFocus = (world: ECSWorld, out: THREE.Vector3): THREE.Vector3 | null => {
  let camera: THREE.Object3D | undefined;
  if (world.id === DEFAULT_ECS_WORLD_ID) {
    camera = getMainCamera();
  } else {
    const cameraId = world.getEntitiesWith(ComponentType.TAG_IS_MAIN_CAMERA).next().value;
    if (cameraId !== undefined)
      camera = world.getComponent(cameraId, ComponentType.OBJECT3D)?.value;
  }
  return camera ? camera.getWorldPosition(out) : null;
};

/** FRAMES: the focus position for this pass, or null to skip it. */
const resolveFrameFocus = (world: ECSWorld, policy: ResolvedPolicy): THREE.Vector3 | null => {
  const { focus } = policy.def;
  if (!focus) return readCameraFocus(world, _focus);
  const at = focus();
  if (at === null || at === undefined) return null;
  if (typeof at === 'number') {
    const transform = world.getComponent(at, ComponentType.TRANSFORM);
    return transform ? _focus.copy(transform.position) : null;
  }
  return _focus.set(at.x, at.y, at.z);
};

/** The index of the first ring `distSq` is within, by `radiiSq` (withinSq or leaveSq). */
const ringIndexFor = (distSq: number, radiiSq: number[]) => {
  for (let i = 0; i < radiiSq.length - 1; i++) {
    if (distSq <= radiiSq[i]) return i;
  }
  return radiiSq.length - 1;
};

// Per pass, in measurement order (the order the requests go out in): each member decided on, the
// ring it should be in, and its joint group (a root body id; NO_GROUP when it has none). Written
// by index and never shrunk, so a pass allocates nothing; `passCount` entries are this pass's.
const NO_GROUP = -1;
const passEntityIds: number[] = [];
const passRings: number[] = [];
const passGroups: number[] = [];
let passCount = 0;
/** Per pass: joint group → the tier requestPhysicsTier refused it. */
const refusedGroups = new Map<number, PhysicsTier>();

/**
 * Gives every joint group with members in this pass the ring of its nearest member, and records
 * each jointed member's group in `passGroups`. Groups are linked through DYNAMIC
 * createPhysicsEntity bodies of `world`, as requestPhysicsTier's are.
 * Without this, a member that stays put wouldn't request, and another member's request would
 * move the whole group away from it (and back on the next pass).
 */
const unifyJointGroups = (world: ECSWorld, tierStorage: IComponentStorage<PhysicsSimTierData>) => {
  const parent = new Map<number, number>();
  const find = (bodyId: number): number => {
    let root = bodyId;
    for (
      let next = parent.get(root);
      next !== undefined && next !== root;
      next = parent.get(root)
    ) {
      root = next;
    }
    // Path compression
    for (let id = bodyId; id !== root; ) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const isTierable = (bodyId: number) => {
    const owner = getPhysicsBodyOwner(bodyId);
    return owner?.world === world && owner.rigidType === 'DYNAMIC';
  };
  forEachJointBodyPair((body1Id, body2Id) => {
    if (!isTierable(body1Id) || !isTierable(body2Id)) return;
    if (!parent.has(body1Id)) parent.set(body1Id, body1Id);
    if (!parent.has(body2Id)) parent.set(body2Id, body2Id);
    parent.set(find(body1Id), find(body2Id));
  });
  if (!parent.size) return;

  const bodyOf = (entityId: number) =>
    (world.getRigidBody(entityId) ?? tierStorage.get(entityId)?.body)?.id;
  const groupRings = new Map<number, number>();
  for (let i = 0; i < passCount; i++) {
    const bodyId = bodyOf(passEntityIds[i]);
    if (bodyId === undefined || !parent.has(bodyId)) continue;
    const root = find(bodyId);
    passGroups[i] = root;
    groupRings.set(root, Math.min(groupRings.get(root) ?? passRings[i], passRings[i]));
  }
  for (let i = 0; i < passCount; i++) {
    if (passGroups[i] !== NO_GROUP) passRings[i] = groupRings.get(passGroups[i])!;
  }
};

/**
 * One pass, from the members' positions (x, y, z per entity in `positions`; an entity id of -1 or
 * a NaN position is skipped) and the focus: picks each member's ring and requests its tier. The
 * members' tier state (hysteresis, refusals) is read now, at the decision.
 */
const decide = (
  world: ECSWorld,
  policy: ResolvedPolicy,
  focus: THREE.Vector3,
  entityIds: ArrayLike<number>,
  positions: ArrayLike<number>
) => {
  const members = world.getStorage(ComponentType.PHYSICS_TIER_POLICY);
  const tierStorage = world.getStorage(ComponentType.PHYSICS_SIM_TIER);
  const { tiers, withinSq, leaveSq } = policy;

  passCount = 0;
  for (let i = 0; i < entityIds.length; i++) {
    const entityId = entityIds[i];
    const member = entityId >= 0 ? members.get(entityId) : undefined;
    if (!member) continue;
    const dx = positions[i * 3] - focus.x;
    const dy = positions[i * 3 + 1] - focus.y;
    const dz = positions[i * 3 + 2] - focus.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (Number.isNaN(distSq)) continue;
    // The latest request (an entity with no component is FULL)
    const currentRing = tiers.indexOf(tierStorage.get(entityId)?.target ?? 'FULL');
    let ring = ringIndexFor(distSq, withinSq);
    // Moving out: only past the hysteresis margin of the ring it's in. A new member, or one in
    // a tier the policy has no ring for (requested by other code), goes straight to its ring.
    if (member.placed && currentRing >= 0 && ring > currentRing) {
      ring = Math.max(currentRing, ringIndexFor(distSq, leaveSq));
    }
    passEntityIds[passCount] = entityId;
    passRings[passCount] = ring;
    passGroups[passCount] = NO_GROUP;
    passCount++;
    member.placed = true;
  }
  if (hasJoints()) unifyJointGroups(world, tierStorage);

  for (let i = 0; i < passCount; i++) {
    const entityId = passEntityIds[i];
    const member = members.get(entityId)!;
    const tier = tiers[passRings[i]];
    // Read again: a joint group member's request may have moved this one already
    if (tier === (tierStorage.get(entityId)?.target ?? 'FULL')) {
      member.refusedTier = null;
      continue;
    }
    if (member.refusedTier === tier) continue;
    // requestPhysicsTier refuses a whole joint group: its other members aren't asked (or warned
    // about) again
    const group = passGroups[i];
    if (group !== NO_GROUP && refusedGroups.get(group) === tier) {
      member.refusedTier = tier;
      continue;
    }
    member.refusedTier = requestPhysicsTier(entityId, tier, world) ? null : tier;
    if (member.refusedTier && group !== NO_GROUP) refusedGroups.set(group, tier);
  }
  // A clear allocates a new table, also for an empty map
  if (refusedGroups.size) refusedGroups.clear();
};

// --- FRAMES ---------------------------------------------------------------------------------

/** FRAMES: the members and their TRANSFORM positions, refilled by index every pass (a length of
 * 0 would free their storage). */
const frameEntityIds: number[] = [];
const framePositions: number[] = [];

const runFramePass = (world: ECSWorld, policy: ResolvedPolicy) => {
  const members = world.getStorage(ComponentType.PHYSICS_TIER_POLICY);
  if (!members.size) return;
  const focus = resolveFrameFocus(world, policy);
  if (!focus) return;
  const transforms = world.getStorage(ComponentType.TRANSFORM);
  let count = 0;
  for (const entityId of members.keys()) {
    const position = transforms.get(entityId)?.position;
    if (!position) continue;
    frameEntityIds[count] = entityId;
    framePositions[count * 3] = position.x;
    framePositions[count * 3 + 1] = position.y;
    framePositions[count * 3 + 2] = position.z;
    count++;
  }
  frameEntityIds.length = count;
  framePositions.length = count * 3;
  decide(world, policy, focus, frameEntityIds, framePositions);
};

const physicsTierPolicyFrameSystem = (world: ECSWorld) => {
  const policy = policies.get(world);
  if (!policy || policy.cadence !== 'FRAMES' || isPhysicsTierPolicyFrozen(world)) return;
  if (--policy.framesUntilPass > 0) return;
  policy.framesUntilPass = policy.interval;
  runFramePass(world, policy);
};

// --- STEPS ----------------------------------------------------------------------------------

const isMainThread = () => getPhysicsState().workerTarget === 'MAIN_THREAD';

// measure's member walk: a pass runs every `interval` steps, too rarely for V8 to optimize it,
// and an unoptimized `for … of` allocates a result object per member; the builtin forEach
// allocates none (and a module-level callback no closure)
let collectedIds = new Int32Array(0);
let collectedCount = 0;
const collectMemberId = (_member: unknown, entityId: number) => {
  collectedIds[collectedCount++] = entityId;
};

/** STEPS, on step `step`: reads the members' bodies and the focus, and keeps them for the
 * decision `interval` steps later. MAIN_THREAD reads now; WORKER_THREAD asks the worker to read
 * right before this step, and holds stepping before the decision step until it has the reply. */
const measure = (world: ECSWorld, policy: ResolvedPolicy, step: number) => {
  const members = world.getStorage(ComponentType.PHYSICS_TIER_POLICY);
  if (!members.size) return;
  const measurement = takeMeasurement();

  // The focus, called with the step: a body is read with the members
  let focusBodyId: number | undefined;
  measurement.hasFocus = false;
  const at = policy.def.focus ? policy.def.focus(step) : undefined;
  if (!policy.def.focus) {
    measurement.hasFocus = readCameraFocus(world, measurement.focus) !== null;
  } else if (typeof at === 'number') {
    focusBodyId = getPhysicsEntityBody(world, at)?.id;
    if (focusBodyId === undefined) {
      const position = world.getComponent(at, ComponentType.TRANSFORM)?.position;
      if (position) {
        measurement.focus.copy(position);
        measurement.hasFocus = true;
      }
    }
  } else if (at) {
    measurement.focus.set(at.x, at.y, at.z);
    measurement.hasFocus = true;
  }
  if (!measurement.hasFocus && focusBodyId === undefined) {
    measurementPool.push(measurement);
    return;
  }

  // In entity id order: the requests of a decision then go out in the same order on every load.
  // A typed array sorts numerically in place (no work array: one view per pass)
  let entityIds = measurement.entityIds;
  if (entityIds.length < members.size) {
    entityIds = measurement.entityIds = new Int32Array(members.size + (members.size >> 1));
  }
  collectedIds = entityIds;
  collectedCount = 0;
  // Every storage but a TYPED_ARRAY TRANSFORM's is a Map (ECSComponentStorage.ts)
  if (members instanceof Map) members.forEach(collectMemberId);
  else for (const entityId of members.keys()) collectMemberId(undefined, entityId);
  const memberCount = collectedCount;
  entityIds.subarray(0, memberCount).sort();
  // The members with a body, in place
  const bodyIds = measurement.bodyIds;
  let count = 0;
  for (let i = 0; i < memberCount; i++) {
    const body = getPhysicsEntityBody(world, entityIds[i]);
    if (!body) continue;
    entityIds[count] = entityIds[i];
    bodyIds[count] = body.id;
    count++;
  }
  if (!count) {
    measurementPool.push(measurement);
    return;
  }
  if (focusBodyId !== undefined) bodyIds[count] = focusBodyId;
  bodyIds.length = focusBodyId !== undefined ? count + 1 : count;

  measurement.count = count;
  measurement.step = step;
  measurement.applyAt = step + policy.interval;
  measurement.positions = null;
  policy.pending.push(measurement);
  policy.lastMeasuredStep = step;

  if (isMainThread()) {
    const size = bodyIds.length * 3;
    if (!measurement.positionsBuffer || measurement.positionsBuffer.length < size) {
      measurement.positionsBuffer = new Float32Array(size + (size >> 1));
    }
    measurement.positions = readBodyPositionsSync(bodyIds, measurement.positionsBuffer);
    return;
  }
  measurement.releaseGate = addPhysicsStepGate(measurement.applyAt);
  // The request clones bodyIds (at the sub-step's capture), so the pooled array can be reused
  const use = measurement.use;
  readBodyPositionsAtStep(bodyIds).then(
    (positions) => {
      if (measurement.use !== use) return;
      measurement.positions = positions;
      measurement.releaseGate?.();
      measurement.releaseGate = null;
    },
    (err) => {
      if (measurement.use !== use) return;
      lerror(`Physics tier policy: the positions measured on step ${step} didn't arrive.`, err);
      measurement.releaseGate?.();
      measurement.releaseGate = null;
    }
  );
};

/** Members whose body changed since their measurement are skipped. */
const _decisionEntityIds: number[] = [];

/** STEPS: the decision on a measurement's `applyAt` step. */
const applyMeasurement = (world: ECSWorld, policy: ResolvedPolicy, measurement: Measurement) => {
  const { entityIds, bodyIds, positions, count } = measurement;
  if (!positions) return;
  let focus = measurement.focus;
  if (!measurement.hasFocus) {
    const o = count * 3;
    focus = _focus.set(positions[o], positions[o + 1], positions[o + 2]);
    if (Number.isNaN(focus.x)) return;
  }
  // One taken out of the policy or given another body since the measurement isn't decided
  _decisionEntityIds.length = count;
  for (let i = 0; i < count; i++) {
    const entityId = entityIds[i];
    _decisionEntityIds[i] =
      getPhysicsEntityBody(world, entityId)?.id === bodyIds[i] ? entityId : -1;
  }
  decide(world, policy, focus, _decisionEntityIds, positions);
};

const physicsTierPolicyStepSystem = (world: ECSWorld) => {
  const policy = policies.get(world);
  if (!policy || policy.cadence !== 'STEPS') return;
  const step = getPhysicsSubStepIndex();
  if (step < 0) return;
  // A new physics world (a scene load) restarts the step count: what was measured is gone
  const simEpoch = getPhysicsSimHistoryEpoch();
  if (policy.simEpoch !== simEpoch) {
    dropMeasurements(policy);
    policy.simEpoch = simEpoch;
  }

  while (policy.pending.length && policy.pending[0].applyAt <= step) {
    const measurement = policy.pending.shift()!;
    measurement.releaseGate?.();
    measurement.releaseGate = null;
    if (measurement.applyAt === step && measurement.positions) {
      applyMeasurement(world, policy, measurement);
    } else if (IS_DEBUG_ENV) {
      lwarn(
        `Physics tier policy: the measurement of step ${measurement.step} missed its decision step ${measurement.applyAt} (now ${step}).`
      );
    }
    releaseMeasurement(measurement);
  }
  if (step % policy.interval === 0 && !isPhysicsTierPolicyFrozen(world)) {
    measure(world, policy, step);
  }
};

/**
 * Deletes the policies scoped to a scene (`PhysicsTierPolicy.sceneId`): a scene-scoped policy goes
 * with its scene. The physics feature's scene exit hook calls it with the scene being left.
 * @internal
 */
export const deleteScenePhysicsTierPolicies = (sceneId: string | undefined) => {
  if (!sceneId) return;
  for (const [world, policy] of policies) {
    if (policy.def.sceneId === sceneId) deletePolicy(world);
  }
};

/**
 * Installs the policy's systems (both cadences) and drops the policies of deleted worlds (the
 * physics feature's install).
 * @internal
 */
export const installPhysicsTierPolicy = (ctx: FeatureContext) => {
  ctx.registerPlugin((world) => {
    world.addSystem(
      ECSSystemStage.APP_LOGIC,
      'physicsTierPolicyFrameSystem',
      physicsTierPolicyFrameSystem
    );
    world.addSystem(
      ECSSystemStage.APP_PHYSICS_STEP,
      'physicsTierPolicyStepSystem',
      physicsTierPolicyStepSystem,
      POLICY_STEP_SYSTEM_ORDER
    );
  });

  // Deleted worlds (a scene's secondary worlds) drop their policies
  onECSWorldRegistryChange(() => {
    if (!policies.size) return;
    const alive = new Set(getAllECSWorlds());
    for (const world of policies.keys()) {
      if (!alive.has(world)) deletePolicy(world);
    }
  });
};
