import * as THREE from 'three/webgpu';
import { LEVEL_GROUND_NORMAL } from '../../../../kernel/render/ThreeMath';
import { emitLocomotionStateChange } from '../../Character';
import { wrapToPi, yawFromDirection } from '../../CharacterIntent';
import type { LocomotionState } from '../../CharacterTypes';
import { setRot, setVec } from './Casts';
import type {
  DynamicCharacterConfig,
  DynamicCharacterContext,
  DynamicCharacterInternal,
  DynamicCharacterState,
} from './DynamicCharacterData';
import { slideAlongWall } from './Wall';

// Locomotion: turning, the move (acceleration, running and crouching speeds, moving platform and
// wall corrections, steep slopes), the motion state written from the body every tick, and the
// locomotion state.

/** Below this (m/s or rad/s), the character counts as resting (isAwake = false). */
const AWAKE_EPSILON = 0.001;
/** Below this squared length (of the intent's summed move), there is no move input. */
const MOVE_EPSILON_SQ = 1e-6;
/** Closer than this (rad) to a target yaw, the character doesn't turn. */
const YAW_EPSILON = 1e-4;
/** How much faster (m/s) than its own top speed a sliding character must go to be in `SLIDE`. */
const SLIDE_STATE_SPEED_MARGIN = 0.1;

const _yawQuat = new THREE.Quaternion();
const _moveVel = new THREE.Vector3();

/** Turns the character by `amount` radians around the world up axis. The yaw accumulates in
 * `state.charRotation` and goes only into the body: the body is the single source of truth and the
 * mesh follows it like any other physics-driven Object3D. Never write the visual's quaternion here:
 * it is rewritten from the physics pose (interpolated, and one step late in WORKER_THREAD mode),
 * and since this only runs on frames with a physics sub-step, a direct write makes the rendered yaw
 * alternate between the live and the physics yaw whenever the render rate exceeds the physics
 * rate. */
export const turnCharacter = (c: DynamicCharacterContext, amount: number) => {
  c.state.charRotation += amount;
  const q = _yawQuat.setFromAxisAngle(LEVEL_GROUND_NORMAL, c.state.charRotation);
  c.body.setRotation(setRot(q.x, q.y, q.z, q.w), true);
};

/** Turns by the turn input, else toward `faceYaw`, else toward the move direction (at most
 * `rotateSpeed`). Before the move, so a forward move goes along the new facing. */
export const turnFromIntent = (
  c: DynamicCharacterContext,
  turnInput: number,
  faceYaw: number | null,
  worldMoveX: number,
  worldMoveZ: number,
  dt: number
) => {
  const maxTurn = c.config.rotateSpeed * dt;
  if (turnInput !== 0) {
    turnCharacter(c, turnInput * maxTurn);
    return;
  }
  const hasWorldMove = worldMoveX * worldMoveX + worldMoveZ * worldMoveZ > MOVE_EPSILON_SQ;
  const targetYaw =
    faceYaw ??
    (c.config.turnToMoveDirection && hasWorldMove
      ? yawFromDirection(worldMoveX, worldMoveZ)
      : null);
  if (targetYaw !== null) {
    const yawDiff = wrapToPi(targetYaw - c.state.charRotation);
    if (Math.abs(yawDiff) > YAW_EPSILON) {
      turnCharacter(c, Math.max(-maxTurn, Math.min(maxTurn, yawDiff)));
    }
  }
};

/** Ground steeper than `maxWalkableAngle` (groundIsWalkable false) can't be climbed: the uphill
 * part of `vel`'s horizontal velocity is dropped, and the rest kept, so the character can still
 * cross the slope. While grounded on it, the character also slides down: the downhill speed is at
 * least the body's current one (`bodyVelX`/`bodyVelZ`, so a move never cancels the slide) plus
 * `slopeSlideSpeed` × `delta`. */
const applySteepSlope = (
  c: DynamicCharacterContext,
  vel: THREE.Vector3,
  bodyVelX: number,
  bodyVelZ: number,
  delta: number
) => {
  const { state, config } = c;
  // The ground normal leans downhill: its horizontal part is the downhill direction
  const n = state.groundNormal;
  const horizontalLength = Math.hypot(n.x, n.z);
  if (horizontalLength < 1e-4) return;
  const downhillX = n.x / horizontalLength;
  const downhillZ = n.z / horizontalLength;
  const velDownhill = vel.x * downhillX + vel.z * downhillZ;
  let targetDownhill = Math.max(0, velDownhill);
  if (state.isGrounded && !state.isOnStairs) {
    // The slide push stops at the walking speed; gravity alone takes it any faster
    const bodyDownhill = Math.max(0, bodyVelX * downhillX + bodyVelZ * downhillZ);
    const pushed = Math.min(bodyDownhill + config.slopeSlideSpeed * delta, config.maxVelocity);
    targetDownhill = Math.max(targetDownhill, bodyDownhill, pushed);
  }
  vel.x += (targetDownhill - velDownhill) * downhillX;
  vel.z += (targetDownhill - velDownhill) * downhillZ;
};

/** Applies one sub-step's move to the body's velocity: along the unit horizontal direction
 * (`dirX`, `dirZ`), at `magnitude` (0..1) of the max speed. Called by the tick, with the pose and
 * velocity scratch already read. */
const applyMove = (
  c: DynamicCharacterContext,
  dirX: number,
  dirZ: number,
  magnitude: number,
  delta: number
) => {
  const { state, config, internal, vels } = c;
  const bodyVelX = vels[0];
  const bodyVelZ = vels[2];
  const vel = _moveVel.set(vels[0], vels[1], vels[2]);
  const maxVeloMultiplier =
    // isRunning
    state.isRunning && state.isGrounded && !state.isCrouching
      ? config.runningMultiplier
      : // isCrouching
        state.isGrounded && state.isCrouching
        ? config.crouchingMultiplier
        : 1;
  const maxVelo = config.maxVelocity * maxVeloMultiplier * magnitude;
  const inTheAirDiminisher = state.isGrounded && !state.isFalling ? 1 : config.inTheAirDiminisher;
  const crouchVeloAccuMultiplier = state.isCrouching ? config.crouchingMultiplier + 1 : 1;
  const veloAccu =
    config.accumulateVeloPerInterval * inTheAirDiminisher * crouchVeloAccuMultiplier * delta;

  // The velocity the move builds on: on a moving platform it's relative to the platform. This
  // sub-step's collision events ran before the tick, so when one of them just took the character
  // off a platform, relVelocity is still relative to it: the platform velocity last applied (only
  // non-zero until this tick resets it) is added back, keeping the momentum it gave.
  const lastPlatformVelo = internal.lastAppliedPlatformVelocity;
  const leftPlatformVeloX = state.isOnMovingPlatform ? 0 : lastPlatformVelo.x;
  const leftPlatformVeloZ = state.isOnMovingPlatform ? 0 : lastPlatformVelo.z;
  const curLinvelX = (state.relVelocity.x || 0) + leftPlatformVeloX;
  const curLinvelZ = (state.relVelocity.z || 0) + leftPlatformVeloZ;

  // The horizontal velocity moves toward dir × maxVelo by at most veloAccu. Along the direction,
  // grounded speed over the max is cut to it at once, while in the air it's kept (the target is
  // then the current speed).
  const along = curLinvelX * dirX + curLinvelZ * dirZ;
  const overMax = state.isGrounded ? Math.max(0, along - maxVelo) : 0;
  const startX = curLinvelX - overMax * dirX;
  const startZ = curLinvelZ - overMax * dirZ;
  const targetAlong = state.isGrounded ? maxVelo : Math.max(maxVelo, along);
  let stepX = dirX * targetAlong - startX;
  let stepZ = dirZ * targetAlong - startZ;
  const stepLength = Math.hypot(stepX, stepZ);
  if (stepLength > veloAccu) {
    stepX *= veloAccu / stepLength;
    stepZ *= veloAccu / stepLength;
  }
  const xAddition = startX + stepX;
  const zAddition = startZ + stepZ;

  let charLinvelY = vels[1];
  if (state.isGrounded) {
    charLinvelY += config.moveYOffset;
  }

  vel.set(xAddition, charLinvelY, zAddition);

  // Is on moving platform compensation
  if (state.isOnMovingPlatform) {
    vel.set(
      xAddition + state.velocity.x - curLinvelX,
      charLinvelY,
      zAddition + state.velocity.z - curLinvelZ
    );
  }

  // Near wall check (and possible cancelation)
  if (state.isNearWall) slideAlongWall(c, vel);

  // Unwalkable slope check (uses the latest resolved ground normal)
  if (!state.groundIsWalkable) applySteepSlope(c, vel, bodyVelX, bodyVelZ, delta);

  c.body.setLinvel(setVec(vel.x, vel.y, vel.z), true);
  vels[0] = vel.x;
  vels[1] = vel.y;
  vels[2] = vel.z;
};

/** The move: the intent's world move plus its forward move along the (new) facing, up to length 1
 * (`hasMoveInput`). Without one, too steep ground still slides the character down. */
export const moveFromIntent = (
  c: DynamicCharacterContext,
  worldMoveX: number,
  worldMoveZ: number,
  moveForward: number,
  isControlled: boolean,
  dt: number
) => {
  const { state, vels } = c;
  const moveX = worldMoveX + moveForward * Math.cos(state.charRotation);
  const moveZ = worldMoveZ - moveForward * Math.sin(state.charRotation);
  const moveLength = Math.hypot(moveX, moveZ);
  state.hasMoveInput = moveLength * moveLength > MOVE_EPSILON_SQ;
  if (isControlled && state.hasMoveInput && !state.isTumbling) {
    applyMove(c, moveX / moveLength, moveZ / moveLength, Math.min(1, moveLength), dt);
  } else if (
    isControlled &&
    !state.groundIsWalkable &&
    state.isGrounded &&
    !state.isTumbling &&
    !state.isOnMovingPlatform
  ) {
    // Without a move, too steep ground still slides the character down
    const vel = _moveVel.set(vels[0], vels[1], vels[2]);
    applySteepSlope(c, vel, vels[0], vels[2], dt);
    if (vel.x !== vels[0] || vel.z !== vels[2]) {
      c.body.setLinvel(setVec(vel.x, vel.y, vel.z), true);
      vels[0] = vel.x;
      vels[2] = vel.z;
    }
  }
};

/** Writes the body's velocities into the state (`relVelocity` = `velocity` until the moving
 * platform corrects it). Returns the world speed, which `isSliding` reads before that correction. */
export const writeVelocityState = (c: DynamicCharacterContext) => {
  const { state, vels } = c;
  const velocity = state.velocity;
  velocity.x = vels[0];
  velocity.y = vels[1];
  velocity.z = vels[2];
  velocity.length = Math.hypot(vels[0], vels[1], vels[2]);
  const relVelocity = state.relVelocity;
  relVelocity.x = velocity.x;
  relVelocity.y = velocity.y;
  relVelocity.z = velocity.z;
  relVelocity.length = velocity.length;

  const angularVelocity = state.angularVelocity;
  angularVelocity.x = vels[3];
  angularVelocity.y = vels[4];
  angularVelocity.z = vels[5];
  angularVelocity.length = Math.hypot(vels[3], vels[4], vels[5]);
  return velocity.length;
};

/** `isAwake`, `isSliding` (from `worldVelo`, the speed before the moving platform's correction)
 * and the position. */
export const writeMotionState = (c: DynamicCharacterContext, worldVelo: number) => {
  const { state, pose } = c;
  // From the velocities: Rapier's isMoving() is an RPC in WORKER_THREAD mode
  state.isAwake =
    state.velocity.length > AWAKE_EPSILON || state.angularVelocity.length > AWAKE_EPSILON;

  state.isSliding =
    state.isGrounded &&
    worldVelo > c.config.minSlidingVelocity &&
    (!state.hasMoveInput || !state.groundIsWalkable) &&
    !state.isOnStairs;

  state.position.x = pose[0];
  state.position.y = pose[1];
  state.position.z = pose[2];
};

/** The locomotion state from the controller's data (see {@link LocomotionState}). */
const deriveLocomotionState = (
  s: DynamicCharacterState,
  config: DynamicCharacterConfig,
  internal: DynamicCharacterInternal,
  step: number,
  stepMs: number,
  isControlled: boolean
): LocomotionState => {
  // Physics alone moves the body (eg. a ragdoll): it's tumbling as far as animation goes
  if (!isControlled) return 'TUMBLE';
  if (s.isGettingUp) return 'GET_UP';
  if (s.isTumbling) return 'TUMBLE';
  if (internal.isJumping) return 'JUMP';
  // A short time off the ground (a stair step, a bump) keeps the grounded state
  if (!s.isGrounded && (step - internal.isFallingStartStep) * stepMs >= config.fallStateDelay) {
    return 'FALL';
  }
  // Only a slide the character can't make by itself: on too steep ground, or faster than it moves
  // (isSliding alone is also true while it slows down after a move)
  if (
    s.isSliding &&
    (!s.groundIsWalkable ||
      Math.hypot(s.relVelocity.x, s.relVelocity.z) >
        config.maxVelocity * Math.max(1, config.runningMultiplier) + SLIDE_STATE_SPEED_MARGIN)
  ) {
    return 'SLIDE';
  }
  if (s.isCrouching) return s.hasMoveInput ? 'CROUCH_WALK' : 'CROUCH';
  if (s.hasMoveInput) return s.isRunning ? 'RUN' : 'WALK';
  return 'IDLE';
};

/** Derives the locomotion state and calls the character's listeners once per change. Last in the
 * tick. */
export const updateLocomotionState = (
  c: DynamicCharacterContext,
  step: number,
  stepMs: number,
  isControlled: boolean
) => {
  const { state } = c;
  const prevState = state.locomotionState;
  const nextState = deriveLocomotionState(state, c.config, c.internal, step, stepMs, isControlled);
  if (nextState !== prevState) {
    state.locomotionState = nextState;
    c.internal.locomotionStateStartStep = step;
    emitLocomotionStateChange(c.character, nextState, prevState);
  }
};
