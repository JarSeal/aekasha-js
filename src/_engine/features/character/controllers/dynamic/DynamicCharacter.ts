import * as THREE from 'three/webgpu';
import {
  applySavedCharacterConfig,
  createCharacter,
  onLocomotionStateChange,
} from '../../Character';
import type {
  CharacterBodyPlan,
  CharacterColliderRole,
  CharacterConfigValues,
  CharacterControllerConfig,
  CharacterDimensions,
  CharacterIntent,
  CharacterObject,
  LocomotionStateListener,
} from '../../CharacterTypes';
import { getBodyKind, HUMANOID_CAPSULE } from '../../CharacterBodyPlans';
import { clearIntentSubStep, createIntent } from '../../CharacterIntent';
import { getInputBrainSpec, type CharacterInputOpts } from '../../CharacterInputSchemes';
import type { CharacterBrainSpec } from '../../ActorTypes';
import { createBrain } from '../../ActorKinds';
import { lwarn } from '../../../../utils/Logger';
import { existsOrThrow } from '../../../../utils/Assert';
import { getECSWorld } from '../../../../kernel/ecs/ECS';
import { ComponentType } from '../../../../kernel/ecs/ECSCoreComponents';
import type { ColliderParams, RigidBodyParams } from '../../../physics/PhysicsAPITypes';
import { createCast } from './Casts';
import { updateCrouch } from './Crouch';
import {
  BAKED_CONFIG_KEYS,
  createDynamicCharacterData,
  DERIVED_CONFIG,
  type CharacterData,
  type DynamicCharacterConfig,
  type DynamicCharacterContext,
  type DynamicCharacterController,
  type DynamicCharacterDataObjects,
} from './DynamicCharacterData';
import {
  applyPendingLanding,
  createFloorSensorHandler,
  refreshFloorNormal,
  updateFalling,
} from './Floor';
import { tryJump, updateJumpPhase } from './Jump';
import {
  moveFromIntent,
  turnFromIntent,
  updateLocomotionState,
  writeMotionState,
  writeVelocityState,
} from './Locomotion';
import { followMovingPlatform } from './Platform';
import { applyControlMode, applyPendingTumble, updateGettingUp, updateTumbling } from './Tumble';
import { createWallSensorHandler } from './Wall';

// The dynamic character controller (`DYNAMIC_CHARACTER`): its factory and its tick, which calls
// the parts (this folder's modules) in a fixed order once per physics step.

/** The `DYNAMIC_CHARACTER` controller kind's params (`createCharacterOfKind`): its body and
 * tuning, the part of {@link DynamicCharacterOpts} that isn't the character's identity. */
export type DynamicCharacterParams = {
  /** The body's shape and kind (default `HUMANOID_CAPSULE`). */
  body?: CharacterBodyPlan;
  /** The configuration, over the defaults (see {@link DynamicCharacterConfig}). */
  config?: Partial<DynamicCharacterConfig>;
  /**
   * Overrides of the default data as one flat object: configuration keys with one underscore
   * (`_maxVelocity`), state keys as they are. `config` wins over its `_` keys.
   * @deprecated Use `config` (removed in engine 6.0.0).
   */
  charData?: Partial<CharacterData>;
};

/** {@link createDynamicCharacter}'s options. */
export type DynamicCharacterOpts = DynamicCharacterParams & {
  /** The character's id (namespaces its binding ids). An existing character with it is replaced. */
  id: string;
  /** A display name (the debug tools show it). */
  name?: string;
  /** The visual root the body moves (eg. a mesh or a group), with an entity (made with
   * createMeshEntity or createGroupEntity): that entity becomes the character. The controller
   * never reads it, so any Object3D works (a capsule, a skinned mesh, a group). */
  visual: THREE.Object3D;
  /** What writes the intent: a registered brain kind and its params, eg. a player brain
   * (`TANK`, `WORLD_FIXED`, `CAMERA_RELATIVE`) on its own action map. Without one, code drives
   * the character through its intent. Switch it later with `setCharacterBrain`. */
  brain?: CharacterBrainSpec;
  /**
   * Keyboard input: a scheme and its key mappings, made into the player brain of the same kind
   * (ignored when `brain` is given).
   * @deprecated Use `brain` (removed in engine 6.0.0).
   */
  input?: CharacterInputOpts;
  /** Called on every locomotion state change (the same as registering it with
   * `onLocomotionStateChange` right after creation). */
  onLocomotionStateChange?: LocomotionStateListener;
};

/** What {@link createDynamicCharacter} returns. */
export type DynamicCharacter = {
  /** The registry entry (the entity's `CHARACTER` component). */
  character: CharacterObject;
  /** The controller (the same object as `character.controller`): its `state`, `config` and
   * `internal`. */
  controller: DynamicCharacterController;
  /**
   * The live data as one flat object (the same object as `character.data`).
   * @deprecated Use `controller.state`, `controller.config.values` and `controller.internal`
   * (removed in engine 6.0.0).
   */
  data: CharacterData;
  /** The character's intent (the same object as `character.intent`). */
  intent: CharacterIntent;
  /** Shorthands that write the intent (nothing else: the tick is what moves the body). Call the
   * per-sub-step ones (rotate, move) once per sub-step, eg. from an APP_PHYSICS_STEP system. */
  controlFns: {
    /** Turns this sub-step (the intent's `turn`). */
    rotate: (direction: 'LEFT' | 'RIGHT') => void;
    /** Moves along the facing this sub-step (the intent's `moveForward`): FORWARD + BACKWARD
     * cancel out. */
    move: (direction: 'FORWARD' | 'BACKWARD') => void;
    /** Jumps on the next tick, if grounded, standing and off the jump cooldown. */
    jump: () => void;
    /** Toggles running. */
    run: () => void;
    /** Toggles crouching. */
    crouch: () => void;
  };
};

/** The collider roles the controller needs from a body plan. */
const REQUIRED_COLLIDER_ROLES: CharacterColliderRole[] = [
  'MAIN',
  'CROUCH',
  'WALL_SENSOR',
  'FLOOR_SENSOR',
];

/**
 * The tick: run by Character.ts's controller system once per fixed physics sub-step. The per-step
 * amounts (eg. turning with a rotating platform by angVelo * timestep) are only right at that
 * cadence. `intent` is the character's (`c.intent`); `step` is the clock: durations are counted in
 * fixed steps, never on the wall clock.
 */
const tickDynamicCharacter = (
  c: DynamicCharacterContext,
  dt: number,
  intent: CharacterIntent,
  step: number
) => {
  const { state, body } = c;
  const stepMs = dt * 1000;

  // What the sensors recorded at this sub-step's start (the events' flush), applied around the
  // body read, where the callbacks used to write it themselves
  applyPendingTumble(c, step);
  // The body's state, read once (no allocation); every velocity write below updates `vels` too
  body.readPoseInto(c.pose);
  body.readVelocitiesInto(c.vels);
  applyPendingLanding(c);

  const isControlled = applyControlMode(c, step);

  // The intent of this sub-step, read once (its per-sub-step fields are cleared right away)
  const turnInput = Math.max(-1, Math.min(1, intent.turn));
  const worldMoveX = intent.moveX;
  const worldMoveZ = intent.moveZ;
  const moveForward = intent.moveForward;
  const wantsJump = intent.jump;
  clearIntentSubStep(intent);
  state.isRunning = intent.run;
  updateCrouch(c, intent.crouch, isControlled);

  if (isControlled && !state.isTumbling) {
    turnFromIntent(c, turnInput, intent.faceYaw, worldMoveX, worldMoveZ, dt);
  }
  moveFromIntent(c, worldMoveX, worldMoveZ, moveForward, isControlled, dt);
  updateTumbling(c, step, stepMs, isControlled);
  updateGettingUp(c, step, stepMs, isControlled);
  updateFalling(c, step, stepMs);

  const worldVelo = writeVelocityState(c);
  followMovingPlatform(c, isControlled, dt);
  writeMotionState(c, worldVelo);

  // Ground normal for the next sub-steps (also while idle or sliding)
  refreshFloorNormal(c);

  updateJumpPhase(c, step, stepMs);
  tryJump(c, wantsJump, isControlled, step, stepMs);
  updateLocomotionState(c, step, stepMs, isControlled);
};

/** The context of a character being created: its data, intent, sizes and casts. Its body and
 * collider fields are filled in once the character exists. */
const createContext = (
  id: string,
  data: DynamicCharacterDataObjects,
  dims: CharacterDimensions
): DynamicCharacterContext => ({
  id,
  // Set once createCharacter resolves, before the sensors fire or the tick runs
  character: null!,
  body: null!,
  bodyId: -1,
  mainCollider: null!,
  crouchCollider: null!,
  state: data.state,
  config: data.config,
  internal: data.internal,
  // Written by the brain, controlFns and game code; read only by the tick
  intent: createIntent(),
  dims,
  appliedControlMode: 'CONTROLLED',
  pose: new Float64Array(7),
  vels: new Float64Array(6),
  wall: {
    cast: createCast(),
    hit: { isValid: false, normal: new THREE.Vector3(), distance: 0 },
  },
  floor: { cast: createCast() },
});

/** The body plan's colliders (all sharing one rigid body), with the controller's parts added by
 * role: the crouch collider starts disabled, and the sensors get their collision handlers. Throws
 * on a missing role. */
const getBodyColliders = (c: DynamicCharacterContext, body: CharacterBodyPlan) => {
  // Capsule radii must be explicit: the Physics API doesn't derive them from the mesh
  const bodyColliders = body.getColliders(c.dims, c.config);
  const indexes = {} as Record<CharacterColliderRole, number>;
  for (let i = 0; i < REQUIRED_COLLIDER_ROLES.length; i++) {
    const role = REQUIRED_COLLIDER_ROLES[i];
    const index = bodyColliders.findIndex((collider) => collider.role === role);
    if (index === -1) {
      throw new Error(
        `createDynamicCharacter: body plan '${getBodyKind(body)}' has no '${role}' collider (character '${c.id}').`
      );
    }
    indexes[role] = index;
  }
  const params: ColliderParams[] = bodyColliders.map(({ role, params }) => {
    switch (role) {
      case 'MAIN':
        return { ...params, enabled: true };
      case 'CROUCH':
        return { ...params, enabled: false };
      case 'WALL_SENSOR':
        return { ...params, collisionEventFn: createWallSensorHandler(c) };
      case 'FLOOR_SENSOR':
        return { ...params, collisionEventFn: createFloorSensorHandler(c) };
      default:
        return params;
    }
  });
  return { params, indexes, roles: bodyColliders.map((collider) => collider.role) };
};

/** Fills in the context's body and colliders from the character's entity. */
const attachBody = (
  c: DynamicCharacterContext,
  character: CharacterObject,
  indexes: Record<CharacterColliderRole, number>
) => {
  const ecsWorld = getECSWorld();
  const entityId = character.entityId;
  c.character = character;
  c.body = existsOrThrow(
    ecsWorld.getRigidBody(entityId),
    `Could not find character physics object rigid body with id: '${entityId}'.`
  );
  c.bodyId = c.body.id;
  c.wall.cast.debug.id = `char_wall_${entityId}`;
  c.floor.cast.debug.id = `char_floor_${entityId}`;
  // The entity's colliders are in the order of their params
  const liveColliders = existsOrThrow(
    ecsWorld.getComponent(entityId, ComponentType.COLLIDER),
    `Could not find character colliders for entity id: '${entityId}'.`
  );
  c.mainCollider = liveColliders[indexes.MAIN];
  c.crouchCollider = liveColliders[indexes.CROUCH];
};

/** The controller's configuration hooks: `applyDefaults` sets each value the creation options
 * didn't give (a brain's configDefaults; a key this controller doesn't have is skipped). */
const createControllerConfig = (
  data: DynamicCharacterDataObjects
): Omit<CharacterControllerConfig<DynamicCharacterConfig>, 'initial'> => {
  const { config, internal, givenConfigKeys } = data;
  const values = config as Record<string, unknown>;
  return {
    values: config,
    bakedKeys: BAKED_CONFIG_KEYS,
    onChange: (key) => DERIVED_CONFIG.get(key)?.(config, internal),
    applyDefaults: (defaults: CharacterConfigValues) => {
      for (const key of Object.keys(defaults)) {
        if (givenConfigKeys.has(key) || !Object.prototype.hasOwnProperty.call(values, key))
          continue;
        values[key] = defaults[key];
        DERIVED_CONFIG.get(key)?.(config, internal);
      }
    },
  };
};

/**
 * Creates a dynamic character: a dynamic, rotation-locked rigid body moved by setting its
 * velocities, with gravity and contacts left to the physics engine. It walks, runs, crouches,
 * jumps, slides down too steep slopes, rides moving platforms, and tumbles and gets up again.
 *
 * The body's shape comes from the body plan (`body`, default `HUMANOID_CAPSULE`), its tuning from
 * `config` (see {@link DynamicCharacterConfig}). It moves only by its intent, which its brain,
 * `controlFns` or game code (eg. an AI in an APP_PHYSICS_STEP system) write; the controller's tick
 * reads it once per physics sub-step. Deleting the character's entity any way deletes the
 * character.
 * @returns the character, its controller, its intent and the `controlFns` shorthands
 */
export const createDynamicCharacter = async (
  opts: DynamicCharacterOpts
): Promise<DynamicCharacter> => {
  const {
    id,
    name,
    visual,
    body = HUMANOID_CAPSULE,
    input: inputOpts,
    onLocomotionStateChange: locomotionStateListener,
  } = opts;
  if (opts.brain && inputOpts) {
    lwarn(
      `createDynamicCharacter: '${id}' has both 'brain' and the deprecated 'input': 'input' is ignored.`
    );
  }
  const brainSpec = opts.brain ?? (inputOpts ? getInputBrainSpec(inputOpts) : undefined);

  const data = createDynamicCharacterData(opts.charData, opts.config);
  const c = createContext(id, data, body.getDimensions(data.config));
  const { intent } = c;
  const colliders = getBodyColliders(c, body);
  const rigidBodyParams: RigidBodyParams = {
    rigidType: 'DYNAMIC',
    lockRotations: { x: true, y: true, z: true },
    linearDamping: 0,
  };
  const config = createControllerConfig(data);

  // Made last before the character, so nothing above can throw with it made; its configuration
  // defaults go in before the creation-time snapshot (the saved debug edits win)
  const brain = brainSpec ? createBrain(brainSpec, id) : undefined;
  if (brain?.configDefaults) config.applyDefaults?.(brain.configDefaults);
  const initial = Object.freeze({ ...data.config });
  let character: CharacterObject;
  try {
    character = await createCharacter({
      id,
      name,
      bodyKind: getBodyKind(body),
      physicsParams: { colliders: colliders.params, rigidBody: rigidBodyParams },
      visual,
      data: data.view,
      intent,
      brain,
    });
  } catch (err) {
    brain?.dispose?.();
    throw err;
  }
  attachBody(c, character, colliders.indexes);
  if (locomotionStateListener) onLocomotionStateChange(id, locomotionStateListener);

  const controller: DynamicCharacterController = {
    kind: 'DYNAMIC_CHARACTER',
    state: data.state,
    config: { ...config, initial },
    internal: data.internal,
    probes: {
      body,
      dims: c.dims,
      colliderRoles: colliders.roles,
      floorRay: c.floor.cast.record,
      wallCast: c.wall.cast.record,
    },
    // It goes with the entity: no cleanup needed
    tick: (dt, tickIntent, step) => tickDynamicCharacter(c, dt, tickIntent, step),
  };
  character.controller = controller;
  // The tuned values saved by the debugger (debug env only), now that onChange exists
  applySavedCharacterConfig(character);

  const controlFns: DynamicCharacter['controlFns'] = {
    rotate: (direction) => (intent.turn += direction === 'LEFT' ? 1 : -1),
    move: (direction) => (intent.moveForward += direction === 'FORWARD' ? 1 : -1),
    jump: () => (intent.jump = true),
    run: () => (intent.run = !intent.run),
    crouch: () => (intent.crouch = !intent.crouch),
  };
  return { character, controller, data: data.view, intent, controlFns };
};
