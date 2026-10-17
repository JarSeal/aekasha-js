import type * as THREE from 'three/webgpu';
import type {
  CharacterBodyData,
  CharacterControlMode,
  CharacterController,
  CharacterControllerConfig,
  CharacterDimensions,
  CharacterIntent,
  CharacterObject,
  CharacterProbes,
  LocomotionState,
} from '../../CharacterTypes';
import type { RigidBodyAPI } from '../../../physics/types/PhysicsBodyTypes';
import type { ColliderAPI } from '../../../physics/types/PhysicsColliderTypes';
import type { CharacterCast } from './Casts';

// The dynamic character's data, as three objects on its controller (p610 D5): `state` (written by
// the tick), `config` (the tuning, read live) and `internal` (the tick's memory). The nested
// objects are mutated in place every tick: re-read `state.velocity` etc., never keep a reference to
// one across ticks expecting a snapshot. Durations are in milliseconds and measured in fixed
// physics steps; step stamps are step indices (getPhysicsSubStepIndex), -1 when not set.

/** A dynamic character's state, written by its controller's tick once per physics step. */
export type DynamicCharacterState = {
  /** What the body is doing (see {@link LocomotionState}), derived at the end of every tick. */
  locomotionState: LocomotionState;
  /** World position of the body's center. */
  position: { x: number; y: number; z: number };
  /** World linear velocity (m/s) and its length. */
  velocity: { x: number; y: number; z: number; length: number };
  /** Linear velocity relative to the moving platform under the character (= `velocity` elsewhere). */
  relVelocity: { x: number; y: number; z: number; length: number };
  /** Angular velocity (rad/s) and its length. */
  angularVelocity: { x: number; y: number; z: number; length: number };
  /** Facing yaw around the world up axis, in radians (0 faces +X, π/2 faces -Z). */
  charRotation: number;
  /** Whether the body moves or turns (derived from its velocities, not the physics sleep state). */
  isAwake: boolean;
  /** Whether the intent asked for a move this sub-step (moves that cancel out don't count). */
  hasMoveInput: boolean;
  /** Whether the floor sensor touches anything. */
  isGrounded: boolean;
  /** Whether the character has been off the ground for longer than `isFallingThreshold`. */
  isFalling: boolean;
  /** Running (the intent's `run`): raises the max speed by `runningMultiplier` while grounded and
   * standing. */
  isRunning: boolean;
  /** Crouching (the intent's `crouch`): the crouch capsule replaces the walk capsule. */
  isCrouching: boolean;
  /** Whether the wall sensor touches a non-dynamic body. */
  isNearWall: boolean;
  /** Whether the floor sensor touches a body whose user data has `isStairs`. */
  isOnStairs: boolean;
  /** Whether the floor sensor touches a body whose user data has `isMovingPlatform`. */
  isOnMovingPlatform: boolean;
  /** Grounded, off stairs and faster than `minSlidingVelocity` without move input (or on
   * unwalkable ground). */
  isSliding: boolean;
  /** Knocked over: rotations are unlocked and the controls do nothing. */
  isTumbling: boolean;
  /** Turning upright again after tumbling (for `gettingUpDuration`). */
  isGettingUp: boolean;
  /** Whether the ground under the character is no steeper than `maxWalkableAngle`. */
  groundIsWalkable: boolean;
  /** Reserved, never set yet. */
  isMovingTowardsImpossibleSlope: boolean;
  /** Normal of the ground under the character, from the floor ray (in WORKER_THREAD mode a step
   * or more late). */
  groundNormal: { x: number; y: number; z: number };
};

/** A dynamic character's configuration: read live by the tick, except the body sizes (baked into
 * the colliders at creation). Give it with `createDynamicCharacter`'s `config`. */
export type DynamicCharacterConfig = {
  /** Standing height, from the capsule's bottom to its top (m). */
  height: number;
  /** Capsule radius (m). */
  radius: number;
  /** Crouching height, from the crouch capsule's bottom to its top (m). Its bottom stays where the
   * walk capsule's is. */
  crouchHeight: number;
  /** How much wider than the capsule the wall sensor is, as a fraction of `radius`. */
  skinThickness: number;
  /** Height of the floor sensor's center above the capsule's bottom (m). */
  groundDetectorOffset: number;
  /** Floor sensor radius, as a fraction of `radius`. */
  groundDetectorRadius: number;
  /** Relative speed (m/s) above which landing starts tumbling. */
  tumblingGroundSpeedThreshold: number;
  /** Relative speed (m/s) above which touching a wall starts tumbling. */
  tumblingWallSpeedThreshold: number;
  /** Minimum tumbling time (ms) before getting up. */
  tumblingMinTime: number;
  /** Tumbling can end only below this relative speed (m/s). */
  tumblingEndMinVelo: number;
  /** Tumbling can end only below this angular speed (rad/s). */
  tumblingEndMinAngVelo: number;
  /** Max angular speed while tumbling (rad/s). */
  tumblingMaxAngVelo: number;
  /** The body's angular damping while tumbling. */
  tumblingAngularDamping: number;
  /** How long getting up takes (ms). */
  gettingUpDuration: number;
  /** The body's angular damping while getting up. */
  gettingUpAngularDamping: number;
  /** Max angular speed while getting up (rad/s). */
  gettingUpMaxAngVelo: number;
  /** Strength of the uprighting torque impulse (per radian off upright), once fully eased in. */
  gettingUpTorque: number;
  /** Turn speed (rad/s), for turn input and for turning toward a yaw or the move direction. */
  rotateSpeed: number;
  /** Turn toward the move direction while moving (default: the brain's, on for the `WORLD_FIXED`
   * and `CAMERA_RELATIVE` player brains). The intent's `turn` and `faceYaw` override it. */
  turnToMoveDirection: boolean;
  /** Max walking speed (m/s). */
  maxVelocity: number;
  /** Steepest walkable slope (radians). */
  maxWalkableAngle: number;
  /** Speed (m/s) above which a grounded character without move input is sliding. */
  minSlidingVelocity: number;
  /** Upward velocity (m/s) added to grounded moves (eg. 0.15 climbs steeper slopes). */
  moveYOffset: number;
  /** Upward jump impulse. */
  jumpAmount: number;
  /** Minimum time between jumps (ms). */
  jumpCooldown: number;
  /** Acceleration multiplier while in the air. */
  inTheAirDiminisher: number;
  /** Acceleration toward the max speed (m/s²). */
  accumulateVeloPerInterval: number;
  /** How long (ms) the character can be off the ground before it is falling (`isFalling`). */
  isFallingThreshold: number;
  /** Max speed multiplier while running. */
  runningMultiplier: number;
  /** Max speed multiplier while crouching (the acceleration gets 1 + this). */
  crouchingMultiplier: number;
  /** Landing with move input and a vertical speed above this (m/s) zeroes the vertical speed. */
  keepMovingAfterJumpThreshold: number;
  /** Speed (m/s) away from a wall added while sliding along it: it breaks the contact whose
   * friction would otherwise hold the character up. */
  wallMicroPush: number;
  /** Wall cast hits with a normal steeper than this (|y|) are floors or ceilings, not walls. */
  wallNormalMaxY: number;
  /** How far ahead (m) the wall cast looks. */
  wallCastDistance: number;
  /** Downhill acceleration (m/s²) on unwalkable slopes, up to `maxVelocity` (gravity can slide
   * the character faster). */
  slopeSlideSpeed: number;
  /** How long (ms) the character must be off the ground, without a jump, before its locomotion
   * state is `FALL` (shorter gaps, like a stair step, keep the grounded state). */
  fallStateDelay: number;
};

/** A dynamic character's internal memory: what its tick keeps between steps (not configurable;
 * diagnostics only). */
export type DynamicCharacterInternal = {
  /** The step `locomotionState` last changed in. */
  locomotionStateStartStep: number;
  /** In a jump (locomotionState `JUMP`): from the jump until the character stops rising in the
   * air or lands. */
  isJumping: boolean;
  /** Whether the current jump has left the ground yet. */
  jumpLeftGround: boolean;
  /** The step the character left the ground in (-1 while grounded). */
  isFallingStartStep: number;
  /** The step tumbling started in (-1 while not tumbling). */
  isTumblingStartStep: number;
  /** The step the last jump was applied in (-1 before the first). */
  jumpStep: number;
  /** `isGrounded` as of the floor sensor's last collision event (the landing logic reads it). */
  lastIsGroundedState: boolean;
  /** cos(`maxWalkableAngle`), derived from the configuration. */
  maxWalkableAngleCos: number;
  /** Ids of the non-dynamic colliders the wall sensor touches. */
  touchingWallColliders: number[];
  /** Ids of the colliders the floor sensor touches. */
  touchingGroundColliders: number[];
  /** The angular damping restored when tumbling ends (the body's default, 0). */
  charAngDamping: number;
  /** The step getting up started in (-1 while not getting up). */
  isGettingUpStartStep: number;
  /** The moving platform's velocity the tick added to the body on the last sub-step. */
  lastAppliedPlatformVelocity: { x: number; y: number; z: number };
  /** The velocity of the moving platform's floor under the character this sub-step. */
  currentPlatformVelocity: { x: number; y: number; z: number };
  /** A sensor saw a hit hard enough to tumble: the next tick starts tumbling (only the tick
   * writes the body). */
  pendingTumble: boolean;
  /** The floor sensor saw a landing with move input: the next tick drops the vertical speed. */
  pendingLanding: boolean;
};

/**
 * A dynamic character's data as one flat object (`CharacterObject.data`): the state keys as they
 * are, the configuration keys with one underscore (`_maxVelocity`), the internal ones with two
 * (`__jumpStep`). Each key reads and writes the controller's own objects.
 * @deprecated Use the controller's `state`, `config.values` and `internal` (removed in engine
 * 6.0.0).
 */
export type CharacterData = DynamicCharacterState & {
  [K in keyof DynamicCharacterConfig as `_${K}`]: DynamicCharacterConfig[K];
} & {
  [K in keyof DynamicCharacterInternal as `__${K}`]: DynamicCharacterInternal[K];
};

/** The `DYNAMIC_CHARACTER` controller (`character.controller` of a dynamic character): its state,
 * configuration and internal memory, and its probes' last results. */
export type DynamicCharacterController = CharacterController<
  DynamicCharacterState,
  DynamicCharacterConfig,
  DynamicCharacterInternal
> & {
  /** What the tick writes every step (read-only from outside). */
  state: Readonly<DynamicCharacterState>;
  /** The configuration values and how to edit them from outside. */
  config: CharacterControllerConfig<DynamicCharacterConfig>;
  /** The tick's memory (read-only from outside). */
  internal: Readonly<DynamicCharacterInternal>;
  /** The body and the probes' last results, for diagnostics (read-only). */
  probes: Readonly<CharacterProbes>;
};

const DEFAULT_STATE: Readonly<DynamicCharacterState> = {
  locomotionState: 'IDLE',
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0, length: 0 },
  relVelocity: { x: 0, y: 0, z: 0, length: 0 },
  angularVelocity: { x: 0, y: 0, z: 0, length: 0 },
  charRotation: 0,
  isAwake: false,
  hasMoveInput: false,
  isGrounded: false,
  isFalling: false,
  isRunning: false,
  isCrouching: false,
  isNearWall: false,
  isOnStairs: false,
  isOnMovingPlatform: false,
  isSliding: false,
  isTumbling: false,
  isGettingUp: false,
  groundIsWalkable: true,
  isMovingTowardsImpossibleSlope: false,
  groundNormal: { x: 0, y: 1, z: 0 },
};

const DEFAULT_CONFIG: Readonly<DynamicCharacterConfig> = {
  height: 1.6,
  radius: 0.5,
  crouchHeight: 1.32,
  skinThickness: 0.05,
  groundDetectorOffset: 0.3,
  groundDetectorRadius: 0.8,
  tumblingGroundSpeedThreshold: 9,
  tumblingWallSpeedThreshold: 6,
  tumblingMinTime: 2200,
  tumblingEndMinVelo: 1.4,
  tumblingEndMinAngVelo: 0.5,
  tumblingMaxAngVelo: 4.6,
  tumblingAngularDamping: 2.5,
  gettingUpDuration: 1000,
  gettingUpAngularDamping: 25,
  gettingUpMaxAngVelo: 2,
  gettingUpTorque: 0.2,
  rotateSpeed: 5,
  turnToMoveDirection: false,
  maxVelocity: 3.7,
  maxWalkableAngle: Math.PI / 4, // 45 degrees (radians)
  minSlidingVelocity: 2,
  moveYOffset: 0,
  jumpAmount: 5,
  jumpCooldown: 100,
  inTheAirDiminisher: 0.6,
  accumulateVeloPerInterval: 30,
  isFallingThreshold: 1200,
  runningMultiplier: 1.5,
  crouchingMultiplier: 0.9,
  keepMovingAfterJumpThreshold: -10,
  wallMicroPush: 0.05,
  wallNormalMaxY: 0.7,
  wallCastDistance: 0.2,
  slopeSlideSpeed: 15,
  fallStateDelay: 100,
};

const DEFAULT_INTERNAL: Readonly<DynamicCharacterInternal> = {
  locomotionStateStartStep: -1,
  isJumping: false,
  jumpLeftGround: false,
  isFallingStartStep: -1,
  isTumblingStartStep: -1,
  jumpStep: -1,
  lastIsGroundedState: false,
  maxWalkableAngleCos: 0,
  touchingWallColliders: [],
  touchingGroundColliders: [],
  charAngDamping: 0,
  isGettingUpStartStep: -1,
  lastAppliedPlatformVelocity: { x: 0, y: 0, z: 0 },
  currentPlatformVelocity: { x: 0, y: 0, z: 0 },
  pendingTumble: false,
  pendingLanding: false,
};

/** The configuration keys the body plan sizes the colliders and probes from: read only at
 * creation (the config's `bakedKeys`). */
export const BAKED_CONFIG_KEYS: ReadonlySet<string> = new Set(
  Object.keys({
    height: true,
    radius: true,
    crouchHeight: true,
    skinThickness: true,
    groundDetectorOffset: true,
    groundDetectorRadius: true,
  } satisfies Record<keyof CharacterBodyData, true>)
);

/** Configuration key → what derives its internal values from it. Run at creation and on the
 * config's `onChange`. */
export const DERIVED_CONFIG = new Map<
  string,
  (config: DynamicCharacterConfig, internal: DynamicCharacterInternal) => void
>([
  [
    'maxWalkableAngle' satisfies keyof DynamicCharacterConfig,
    (config, internal) => {
      internal.maxWalkableAngleCos = Math.cos(config.maxWalkableAngle);
    },
  ],
]);

/** A dynamic character's three data objects, and the deprecated flat view over them. */
export type DynamicCharacterDataObjects = {
  state: DynamicCharacterState;
  config: DynamicCharacterConfig;
  internal: DynamicCharacterInternal;
  /** The deprecated flat view (`CharacterObject.data`). */
  view: CharacterData;
  /** The configuration keys the creation options gave (a brain's defaults leave them alone). */
  givenConfigKeys: ReadonlySet<string>;
};

/** Defines `prefix + key` on `view` for every key of `target`, reading and writing `target`. */
const defineViewKeys = (view: object, prefix: string, target: Record<string, unknown>) => {
  for (const key of Object.keys(target)) {
    Object.defineProperty(view, prefix + key, {
      enumerable: true,
      get: () => target[key],
      set: (value: unknown) => {
        target[key] = value;
      },
    });
  }
};

/**
 * The three data objects from the defaults (every nested object and array a new copy), with the
 * creation options written over them: the deprecated `charData` first (through the flat view, so
 * `_` keys reach the configuration and `__` keys the internal memory; a key the view doesn't have
 * stays on it as a plain value, as before), then `config`. Derives the internal values from the
 * configuration. The flat view's accessors are made here, once.
 */
export const createDynamicCharacterData = (
  charData: Partial<CharacterData> | undefined,
  configOpts: Partial<DynamicCharacterConfig> | undefined
): DynamicCharacterDataObjects => {
  const d = DEFAULT_STATE;
  const state: DynamicCharacterState = {
    ...d,
    position: { ...d.position },
    velocity: { ...d.velocity },
    relVelocity: { ...d.relVelocity },
    angularVelocity: { ...d.angularVelocity },
    groundNormal: { ...d.groundNormal },
  };
  const config: DynamicCharacterConfig = { ...DEFAULT_CONFIG };
  const i = DEFAULT_INTERNAL;
  const internal: DynamicCharacterInternal = {
    ...i,
    touchingWallColliders: [...i.touchingWallColliders],
    touchingGroundColliders: [...i.touchingGroundColliders],
    lastAppliedPlatformVelocity: { ...i.lastAppliedPlatformVelocity },
    currentPlatformVelocity: { ...i.currentPlatformVelocity },
  };

  // Key order: state, configuration, internal (the debug tools' groups)
  const view = {} as CharacterData;
  defineViewKeys(view, '', state);
  defineViewKeys(view, '_', config);
  defineViewKeys(view, '__', internal);

  const givenConfigKeys = new Set<string>();
  if (charData) {
    Object.assign(view, charData);
    for (const key of Object.keys(charData)) {
      if (!key.startsWith('_') || key.startsWith('__')) continue;
      if ((charData as Record<string, unknown>)[key] !== undefined)
        givenConfigKeys.add(key.slice(1));
    }
  }
  if (configOpts) {
    Object.assign(config, configOpts);
    for (const key of Object.keys(configOpts)) {
      if ((configOpts as Record<string, unknown>)[key] !== undefined) givenConfigKeys.add(key);
    }
  }
  for (const derive of DERIVED_CONFIG.values()) derive(config, internal);
  return { state, config, internal, view, givenConfigKeys };
};

/**
 * What every part of the dynamic controller works on: one per character, made at creation. The
 * body and collider fields are set once `createCharacter` resolves, before anything reads them
 * (the sensors fire and the tick runs only after that).
 */
export type DynamicCharacterContext = {
  /** The character's id. */
  readonly id: string;
  /** The registry entry (set once it exists). */
  character: CharacterObject;
  /** The character's rigid body (set once it exists). */
  body: RigidBodyAPI;
  /** Its id (-1 until it exists): the sensors tell their own collider from the other by it. */
  bodyId: number;
  /** The standing collider (`MAIN`, enabled at creation). */
  mainCollider: ColliderAPI;
  /** The crouching collider (`CROUCH`, disabled at creation). */
  crouchCollider: ColliderAPI;
  readonly state: DynamicCharacterState;
  readonly config: DynamicCharacterConfig;
  readonly internal: DynamicCharacterInternal;
  /** The character's intent, written by its brain and code, read by the tick. */
  readonly intent: CharacterIntent;
  /** The body plan's creation-time sizes. */
  readonly dims: CharacterDimensions;
  /** The control mode the tick last applied (the character's `controlMode` takes effect on the
   * next tick). */
  appliedControlMode: CharacterControlMode;
  /** [posX, posY, posZ, rotX, rotY, rotZ, rotW] of the body, read once per tick. */
  readonly pose: Float64Array;
  /** [linvelX, linvelY, linvelZ, angvelX, angvelY, angvelZ] of the body, read once per tick;
   * every velocity write of the tick updates it too. */
  readonly vels: Float64Array;
  /** The wall shape-cast and the wall it last found. */
  readonly wall: {
    readonly cast: CharacterCast;
    readonly hit: { isValid: boolean; normal: THREE.Vector3; distance: number };
  };
  /** The floor ray. */
  readonly floor: { readonly cast: CharacterCast };
};
