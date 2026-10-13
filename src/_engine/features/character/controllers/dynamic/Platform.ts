import * as THREE from 'three/webgpu';
import { getPhysicsWorld } from '../../../physics/PhysicsAPI';
import type { RigidBodyAPI } from '../../../physics/PhysicsAPITypes';
import { LEVEL_GROUND_NORMAL } from '../../../../kernel/render/ThreeMath';
import { setVec } from './Casts';
import type { DynamicCharacterContext } from './DynamicCharacterData';
import { turnCharacter } from './Locomotion';

// Moving platforms: a character on one (a floor collider whose body's user data has
// `isMovingPlatform`, eg. the toolkit's MovingPlatform) moves and turns with it, keeping its own
// velocity relative to the platform.

/** Below this (rad/s), a platform's spin doesn't turn the character. */
const PLATFORM_ROTATION_EPSILON = 0.001;

/** What a moving platform keeps in its body's user data (the toolkit's MovingPlatform). */
type MovingPlatformUserData = {
  isMovingPlatform: boolean;
  currentPos: THREE.Vector3;
  prevPos: THREE.Vector3;
  velo: THREE.Vector3;
  angVelo: THREE.Vector3;
  friction: number;
};

const _platformPose = new Float64Array(7);
const _r = new THREE.Vector3();
const _omega = new THREE.Vector3();
const _vTan = new THREE.Vector3();
const _currentRelVelo = new THREE.Vector3();

/** Moves the character with the platform `pb` for one sub-step: the floor's velocity under its
 * feet (the platform's plus its spin's), its turn, and the character's own velocity relative to
 * it (decaying by the platform's friction without move input). Updates the body, the velocity
 * scratch and the state's velocities. */
const rideOnPlatform = (
  c: DynamicCharacterContext,
  pb: RigidBodyAPI,
  ud: MovingPlatformUserData,
  dt: number
) => {
  const { state, internal, pose, vels } = c;
  const currentPlatformVelo = internal.currentPlatformVelocity;
  const lastAppliedPlatformVelo = internal.lastAppliedPlatformVelocity;

  // 1. GET CORRECT ANGULAR VELOCITY
  // Rapier's angvel() is often 0 for kinematic bodies. We MUST use the one we calculated
  // (the physics engine's only as a fallback when the user data is missing).
  const udAngVel = ud.angVelo;
  const physicsAngVel = udAngVel ? null : pb.avel;
  const angVeloX = udAngVel ? udAngVel.x : physicsAngVel!.x;
  const angVeloY = udAngVel ? udAngVel.y : physicsAngVel!.y;
  const angVeloZ = udAngVel ? udAngVel.z : physicsAngVel!.z;

  // 2. CALCULATE VECTORS
  pb.readPoseInto(_platformPose);

  // Flatten Y to prevent "wobble" errors in the radius
  const r = _r.set(pose[0] - _platformPose[0], 0, pose[2] - _platformPose[2]);

  const omega = _omega.set(angVeloX, angVeloY, angVeloZ);
  const vTan = _vTan.crossVectors(omega, r);

  // 3. CALCULATE TOTAL FLOOR VELOCITY
  // This is the absolute world speed of the floor under the player's feet.
  currentPlatformVelo.x = ud.velo.x + vTan.x;
  currentPlatformVelo.y = ud.velo.y + vTan.y;
  currentPlatformVelo.z = ud.velo.z + vTan.z;

  // 4. ROTATION (turn with the platform — through the body, like input turning,
  // since the body's rotation is what the mesh gets synced from)
  const hasPlatformRotation = Math.abs(angVeloY) > PLATFORM_ROTATION_EPSILON;
  if (hasPlatformRotation && !state.isTumbling) {
    turnCharacter(c, angVeloY * dt);
  }

  // 5. VELOCITY RECONSTRUCTION (The Sling Fix)

  // A/B. Extract Relative Velocity from the current world velocity:
  // we subtract the TOTAL platform velocity we applied last sub-step.
  const currentRelVelo = _currentRelVelo.set(
    vels[0] - lastAppliedPlatformVelo.x,
    vels[1] - lastAppliedPlatformVelo.y,
    vels[2] - lastAppliedPlatformVelo.z
  );

  if (hasPlatformRotation) {
    // Rotate the vector around the Y axis
    currentRelVelo.applyAxisAngle(LEVEL_GROUND_NORMAL, angVeloY * dt);
  }

  // C. STABILIZATION (Critical)
  // If the player is not trying to move, Force Relative X/Z to 0.
  // This kills the "Centrifugal Drift" that causes the slinging.
  if (!state.hasMoveInput && !state.isTumbling) {
    // Apply Friction (Decay the relative velocity)
    // 0.8 = slippery, 0.95 = icy, 0.5 = sticky
    currentRelVelo.x *= ud.friction;
    currentRelVelo.z *= ud.friction;

    // Snap to zero if very slow to prevent micro-sliding forever
    if (Math.abs(currentRelVelo.x) < 0.01) currentRelVelo.x = 0;
    if (Math.abs(currentRelVelo.z) < 0.01) currentRelVelo.z = 0;
  }

  // D. Reconstruct New World Velocity
  // New World = Clean Relative + New Platform Total
  const newVelX = currentRelVelo.x + currentPlatformVelo.x;
  const newVelY = currentRelVelo.y + currentPlatformVelo.y;
  const newVelZ = currentRelVelo.z + currentPlatformVelo.z;

  // 6. APPLY AND STORE
  c.body.setLinvel(setVec(newVelX, newVelY, newVelZ), true);
  vels[0] = newVelX;
  vels[1] = newVelY;
  vels[2] = newVelZ;
  lastAppliedPlatformVelo.x = currentPlatformVelo.x;
  lastAppliedPlatformVelo.y = currentPlatformVelo.y;
  lastAppliedPlatformVelo.z = currentPlatformVelo.z;

  // 7. UPDATE STATUS
  const { velocity, relVelocity, angularVelocity } = state;
  velocity.x = newVelX;
  velocity.y = newVelY;
  velocity.z = newVelZ;
  velocity.length = Math.hypot(newVelX, newVelY, newVelZ);
  relVelocity.x = newVelX - currentPlatformVelo.x;
  relVelocity.y = newVelY - currentPlatformVelo.y;
  relVelocity.z = newVelZ - currentPlatformVelo.z;
  relVelocity.length = Math.hypot(relVelocity.x, relVelocity.y, relVelocity.z);
  angularVelocity.x = angVeloX;
  angularVelocity.y = angVeloY;
  angularVelocity.z = angVeloZ;
  angularVelocity.length = Math.hypot(angVeloX, angVeloY, angVeloZ);
};

/** On a moving platform (and controlled), rides the first touching floor body that is one; off
 * it, forgets the platform velocity last applied. Resets this sub-step's floor velocity first. */
export const followMovingPlatform = (
  c: DynamicCharacterContext,
  isControlled: boolean,
  dt: number
) => {
  const { state, internal } = c;
  const currentPlatformVelo = internal.currentPlatformVelocity;
  currentPlatformVelo.x = 0;
  currentPlatformVelo.y = 0;
  currentPlatformVelo.z = 0;

  if (!isControlled || !state.isOnMovingPlatform) {
    const lastAppliedPlatformVelo = internal.lastAppliedPlatformVelocity;
    lastAppliedPlatformVelo.x = 0;
    lastAppliedPlatformVelo.y = 0;
    lastAppliedPlatformVelo.z = 0;
    return;
  }
  const world = getPhysicsWorld();
  const touching = internal.touchingGroundColliders;
  for (let i = 0; i < touching.length; i++) {
    const collider = world.getColliderSync(touching[i]);
    if (!collider) continue;
    const pb = world.getRigidBodySync(collider.parentId ?? -1);
    if (!pb) continue;
    const ud = pb.getUserDataSync() as MovingPlatformUserData;
    if (ud?.isMovingPlatform) {
      rideOnPlatform(c, pb, ud, dt);
      // Stop processing other platforms
      break;
    }
  }
};
