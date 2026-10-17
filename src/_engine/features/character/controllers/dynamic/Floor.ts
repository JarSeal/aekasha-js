import * as THREE from 'three/webgpu';
import { getPhysicsWorld } from '../../../physics/PhysicsState';
import {
  getPhysicsSnapshotStepIndex,
  getPhysicsSubStepIndex,
} from '../../../physics/PhysicsStepping';
import type { ColliderAPI } from '../../../physics/types/PhysicsColliderTypes';
import {
  QueryFilterFlags,
  type RayColliderIntersectionAPI,
} from '../../../physics/types/PhysicsQueryTypes';
import { LEVEL_GROUND_NORMAL } from '../../../../kernel/render/ThreeMath';
import { hasMoveIntent } from '../../CharacterIntent';
import {
  castPos,
  copyVec,
  floorRay,
  isWorkerTarget,
  rayDown,
  recordCastShot,
  resolveCastRecord,
  setVec,
} from './Casts';
import type { DynamicCharacterContext } from './DynamicCharacterData';

// The ground: the floor sensor (grounded, stairs, moving platforms, landing, tumbling on a hard
// landing), the floor ray (the ground normal and whether it's walkable) and falling.

const _groundDot = new THREE.Vector3();

/** A floor ray's result, resolved at `step`: its record, the ground normal and whether the ground
 * is walkable. */
const applyFloorHit = (
  c: DynamicCharacterContext,
  hit: RayColliderIntersectionAPI | null,
  step: number
) => {
  const { record, shot } = c.floor.cast;
  const { state } = c;
  resolveCastRecord(record, shot, hit ? hit.timeOfImpact : -1, step);
  if (hit) {
    const { origin, dir, point } = record;
    point.x = origin.x + dir.x * hit.timeOfImpact;
    point.y = origin.y + dir.y * hit.timeOfImpact;
    point.z = origin.z + dir.z * hit.timeOfImpact;
    copyVec(record.normal, hit.normal);
  }
  const groundNormal = state.groundNormal;
  if (hit) {
    groundNormal.x = hit.normal.x;
    groundNormal.y = hit.normal.y;
    groundNormal.z = hit.normal.z;
  } else {
    groundNormal.x = 0;
    groundNormal.y = 1;
    groundNormal.z = 0;
  }
  const groundDot = _groundDot
    .set(groundNormal.x, groundNormal.y, groundNormal.z)
    .dot(LEVEL_GROUND_NORMAL);
  state.groundIsWalkable = !hit || groundDot > c.internal.maxWalkableAngleCos;
};

/** Casts the floor ray straight down from the body's center and updates the ground normal and
 * whether the ground is walkable (synchronous on MAIN_THREAD, async in WORKER_THREAD mode: see
 * `Wall.ts`' wall cast). Reads the tick's pose scratch. */
export const refreshFloorNormal = (c: DynamicCharacterContext) => {
  const cast = c.floor.cast;
  if (cast.inFlight) return;
  const { state, pose } = c;
  castPos.x = pose[0];
  castPos.y = pose[1];
  castPos.z = pose[2];
  const probes = state.isCrouching ? c.dims.crouching : c.dims.standing;
  recordCastShot(cast.shot, castPos, rayDown, probes.floorRayLength, state.isCrouching);
  const world = getPhysicsWorld();
  if (!isWorkerTarget()) {
    applyFloorHit(
      c,
      world.castRayAndGetNormalSync(
        floorRay,
        probes.floorRayLength,
        false,
        QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        c.body,
        undefined,
        cast.debug
      ),
      getPhysicsSubStepIndex()
    );
    return;
  }
  cast.inFlight = true;
  world
    .castRayAndGetNormal(
      floorRay,
      probes.floorRayLength,
      false,
      QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      c.body,
      undefined,
      cast.debug
    )
    .then((hit) => {
      cast.inFlight = false;
      applyFloorHit(c, hit, getPhysicsSnapshotStepIndex());
    })
    .catch(() => {
      cast.inFlight = false;
    });
};

/** A landing the floor sensor recorded: with move input, it keeps the horizontal speed and drops
 * the vertical. Right after the tick reads the body. */
export const applyPendingLanding = (c: DynamicCharacterContext) => {
  const { internal, vels } = c;
  if (!internal.pendingLanding) return;
  internal.pendingLanding = false;
  if (c.config.keepMovingAfterJumpThreshold < vels[1]) {
    vels[1] = 0;
    c.body.setLinvel(setVec(vels[0], 0, vels[2]), true);
  }
};

/** `isFalling`: off the ground for longer than `isFallingThreshold`, counted from the step the
 * character left it. */
export const updateFalling = (c: DynamicCharacterContext, step: number, stepMs: number) => {
  const { state, internal } = c;
  if (state.isGrounded) {
    internal.isFallingStartStep = -1;
    state.isFalling = false;
  } else if (internal.isFallingStartStep < 0) {
    internal.isFallingStartStep = step;
  } else if ((step - internal.isFallingStartStep) * stepMs > c.config.isFallingThreshold) {
    state.isFalling = true;
  }
};

/** The user data the floor sensor reads from the body under the character. */
type FloorUserData = {
  isStairs?: boolean;
  stairsColliderIndex?: number | number[]; // Support array or number
  isMovingPlatform?: boolean;
};

/** The floor sensor's collision handler: grounded, stairs and moving platform state, landing, and
 * tumbling on a hard landing. Runs at the sub-step's start (the events' flush): the landing and
 * the tumbling are recorded for the tick, which applies them first. */
export const createFloorSensorHandler =
  (c: DynamicCharacterContext) =>
  (collider1: ColliderAPI, collider2: ColliderAPI, started: boolean) => {
    const { state, config, internal } = c;
    // 1. Identify "The Other Collider" immediately
    const isColl1Mine = collider1.parentId === c.bodyId;
    const otherCollider = isColl1Mine ? collider2 : collider1;

    // 2. Get the other body's userData ONCE
    const otherBody = getPhysicsWorld().getRigidBodySync(otherCollider.parentId ?? -1);
    const userData = otherBody?.getUserDataSync() as FloorUserData | undefined;

    if (started) {
      // --- STARTED TOUCHING ---
      internal.touchingGroundColliders.push(otherCollider.id);
      state.isGrounded = true;

      // Tumble Check (in PHYSICS_ONLY mode, physics alone moves the body)
      const isControlled = c.appliedControlMode === 'CONTROLLED';
      if (
        isControlled &&
        state.relVelocity.length > config.tumblingGroundSpeedThreshold &&
        !internal.lastIsGroundedState
      ) {
        internal.pendingTumble = true;
        return;
      }

      // Keep Moving / Landing Logic. Collision events run before the tick, so this sub-step's
      // move input is still only in the intent.
      if (
        isControlled &&
        !state.isFalling &&
        !internal.lastIsGroundedState &&
        (state.hasMoveInput || hasMoveIntent(c.intent))
      ) {
        internal.pendingLanding = true;
      }
      internal.lastIsGroundedState = state.isGrounded;

      // --- STAIRS CHECK ---
      if (userData?.isStairs) {
        state.isOnStairs = true;
      }

      // --- MOVING PLATFORM CHECK ---
      if (userData?.isMovingPlatform) {
        state.isOnMovingPlatform = true;
      }
    } else {
      // --- STOPPED TOUCHING ---
      const index = internal.touchingGroundColliders.indexOf(otherCollider.id);
      if (index !== -1) {
        internal.touchingGroundColliders.splice(index, 1);
      }

      if (internal.touchingGroundColliders.length === 0) {
        state.isGrounded = false;
      }

      internal.lastIsGroundedState = state.isGrounded;

      if (userData?.isStairs) {
        state.isOnStairs = false;
      }

      if (userData?.isMovingPlatform) {
        state.isOnMovingPlatform = false;
      }
    }
  };
