import * as THREE from 'three/webgpu';
import {
  getPhysicsSnapshotStepIndex,
  getPhysicsSubStepIndex,
  getPhysicsWorld,
} from '../../../physics/PhysicsAPI';
import {
  QueryFilterFlags,
  RigidBodyTypeAPI,
  type ColliderAPI,
  type ShapeCastHitAPI,
} from '../../../physics/PhysicsAPITypes';
import {
  castDir,
  castPos,
  castRot,
  copyVec,
  isWorkerTarget,
  recordCastShot,
  resolveCastRecord,
} from './Casts';
import type { DynamicCharacterContext } from './DynamicCharacterData';

// Walls: the wall sensor (isNearWall, tumbling on a hard hit), the wall shape-cast along the
// horizontal velocity, and the slide along the wall it finds.

const _moveDir = new THREE.Vector3();
const _flatNormal = new THREE.Vector3();
const _wallCastShape = { type: 'CYLINDER' as const, halfHeight: 0, radius: 0 };

/** A wall cast's result, resolved at `step`: its record and the context's wall hit. */
const applyWallHit = (c: DynamicCharacterContext, hit: ShapeCastHitAPI | null, step: number) => {
  const { record, shot } = c.wall.cast;
  const wallHit = c.wall.hit;
  resolveCastRecord(record, shot, hit ? hit.timeOfImpact : -1, step);
  if (hit) {
    // Both on the hit collider, in world space
    copyVec(record.point, hit.witness1);
    copyVec(record.normal, hit.normal1);
  }
  if (!hit || Math.abs(hit.normal1.y) > c.config.wallNormalMaxY) {
    wallHit.isValid = false;
    return;
  }
  wallHit.isValid = true;
  wallHit.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
  wallHit.distance = hit.timeOfImpact;
};

/**
 * Casts the wall probe along the horizontal velocity and updates the wall hit. On MAIN_THREAD the
 * cast is synchronous, so the tick uses the result of its own step: the same on every run, whatever
 * the frame timing. The sync casts throw in WORKER_THREAD mode (spatial queries need the live
 * physics world, which lives off-thread there), so there an async cast is fired again once the
 * previous one resolved, and the latest resolved result is used meanwhile: a frame or so late,
 * depending on the frame timing, so the worker targets aren't deterministic (p428). Reads the
 * tick's pose and velocity scratch.
 */
const refreshWallHit = (c: DynamicCharacterContext) => {
  const cast = c.wall.cast;
  if (cast.inFlight) return;
  const { state, config, pose, vels } = c;
  _moveDir.set(vels[0], 0, vels[2]);
  // Optimization: If standing still, wall sliding is irrelevant.
  if (_moveDir.lengthSq() < 0.001) {
    c.wall.hit.isValid = false;
    return;
  }
  _moveDir.normalize();
  castDir.x = _moveDir.x;
  castDir.y = 0; // Force horizontal
  castDir.z = _moveDir.z;

  // The body plan's creation-time sizes (geometry can't be queried off the active collider
  // synchronously in WORKER_THREAD mode)
  const probes = state.isCrouching ? c.dims.crouching : c.dims.standing;

  castPos.x = pose[0];
  castPos.y = pose[1] + probes.wallCastOffsetY;
  castPos.z = pose[2];

  recordCastShot(cast.shot, castPos, castDir, config.wallCastDistance, state.isCrouching);
  _wallCastShape.halfHeight = probes.wallCastHalfHeight;
  _wallCastShape.radius = probes.wallCastRadius;
  const world = getPhysicsWorld();
  if (!isWorkerTarget()) {
    applyWallHit(
      c,
      world.castShapeSync(
        castPos,
        castRot,
        castDir,
        _wallCastShape,
        0.0,
        config.wallCastDistance,
        true, // Stop at Penetration
        QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        c.body, // Exclude Self
        undefined,
        cast.debug
      ),
      getPhysicsSubStepIndex()
    );
    return;
  }
  cast.inFlight = true;
  world
    .castShape(
      castPos,
      castRot,
      castDir,
      _wallCastShape,
      0.0,
      config.wallCastDistance,
      true, // Stop at Penetration
      QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      c.body, // Exclude Self
      undefined,
      cast.debug
    )
    .then((hit) => {
      cast.inFlight = false;
      applyWallHit(c, hit, getPhysicsSnapshotStepIndex());
    })
    .catch(() => {
      cast.inFlight = false;
    });
};

/** Near a wall, casts the wall probe and, when the move `vel` pushes into the wall it found,
 * slides along it instead (with a micro-push away from it). Leaves `vel.y` alone, so gravity and
 * jumping work. */
export const slideAlongWall = (c: DynamicCharacterContext, vel: THREE.Vector3) => {
  refreshWallHit(c);
  const wallHit = c.wall.hit;
  if (!wallHit.isValid) return;

  // 1. Flatten the Normal (Critical for Vertical Stability)
  // We strictly ignore the Y component of the wall.
  // This prevents the wall from pushing us UP or holding us in the air.
  const rawNormal = wallHit.normal;
  const flatNormal = _flatNormal.set(rawNormal.x, 0, rawNormal.z).normalize();

  // 2. Use the INTENDED velocity 'vel', not the old body velocity
  // 'vel' is the vector you calculated from inputs (xAddition, zAddition)
  const currentX = vel.x;
  const currentZ = vel.z;

  // 3. Calculate Dot Product (Horizontal Only)
  const dot = currentX * flatNormal.x + currentZ * flatNormal.z;

  // 4. Only slide if we are pushing INTO the wall
  if (dot < 0) {
    // Slide Math: Remove the velocity component that points into the wall
    let slideX = currentX - dot * flatNormal.x;
    let slideZ = currentZ - dot * flatNormal.z;

    // 5. THE MICRO-PUSH (Fixes "Sticky/Floating" walls)
    // We add a tiny velocity AWAY from the wall.
    // This breaks physical contact for the next frame, ensuring Rapier
    // doesn't apply vertical friction that fights gravity.
    slideX += flatNormal.x * c.config.wallMicroPush;
    slideZ += flatNormal.z * c.config.wallMicroPush;

    // 6. Apply back to the output vector
    vel.x = slideX;
    vel.z = slideZ;
    // We explicitly leave vel.y alone so gravity/jumping works perfectly
  }
};

/** The wall sensor's collision handler: counts the touching non-dynamic bodies (isNearWall), and a
 * fast enough hit starts tumbling on the next tick. Runs at the sub-step's start (the events'
 * flush), so it records and never writes the body. */
export const createWallSensorHandler =
  (c: DynamicCharacterContext) =>
  (collider1: ColliderAPI, collider2: ColliderAPI, started: boolean) => {
    const { state, config, internal } = c;
    // Whichever of the pair belongs to the character's own rigid body is "me" — the
    // wall sensor's own collisionEventFn only ever fires for events that include it.
    const isColl1Mine = collider1.parentId === c.bodyId;
    const otherCollider = isColl1Mine ? collider2 : collider1;

    if (started) {
      const otherBody = getPhysicsWorld().getRigidBodySync(otherCollider.parentId ?? -1);
      if (!otherBody) return;
      // Synchronous on every target (the worker's proxy keeps its body's type)
      if (otherBody.bodyTypeSync() !== RigidBodyTypeAPI.Dynamic) {
        internal.touchingWallColliders.push(otherCollider.id);
        state.isNearWall = true;
      }
      if (
        c.appliedControlMode === 'CONTROLLED' &&
        state.relVelocity.length > config.tumblingWallSpeedThreshold
      ) {
        internal.pendingTumble = true;
      }
      return;
    }
    const indexToRemove = internal.touchingWallColliders.indexOf(otherCollider.id);
    if (indexToRemove !== -1) {
      internal.touchingWallColliders.splice(indexToRemove, 1);
    }
    if (!internal.touchingWallColliders.length) state.isNearWall = false;
  };
