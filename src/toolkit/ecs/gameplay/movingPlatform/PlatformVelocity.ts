import * as THREE from 'three/webgpu';

/**
 * A plain `{ x, y, z }`: the platform's user data carries these, never three's classes.
 * @internal
 */
export interface PlatformVec3 {
  /** The x component. */
  x: number;
  /** The y component. */
  y: number;
  /** The z component. */
  z: number;
}

/**
 * The part of a moving platform's rigid body user data the dynamic character reads to ride it:
 * the velocity and the angular velocity of the segment it's on (both zero while it stands).
 * @internal
 */
export type PlatformVelocities = {
  /** The linear velocity, units per second. */
  velo: PlatformVec3;
  /** The angular velocity, an axis scaled by radians per second. */
  angVelo: PlatformVec3;
};

// Scratch for computePlatformVelocities, which runs once per segment change
const _fromRot = new THREE.Quaternion();
const _toRot = new THREE.Quaternion();

/**
 * Writes into `out` the constant velocities that move a platform from `fromPos` / `fromRot` to
 * `toPos` / `toRot` in `duration` seconds: the turn along the shorter way round. A `duration`
 * that isn't above 0 (a `dur: 0` jump, or `NaN`) gives zero velocities; an infinite one (a speed
 * multiplier of 0) too.
 * @internal
 * @param out the velocities to write, returned
 * @returns `out`
 */
export const computePlatformVelocities = (
  fromPos: THREE.Vector3,
  toPos: THREE.Vector3,
  fromRot: THREE.Quaternion,
  toRot: THREE.Quaternion,
  duration: number,
  out: PlatformVelocities
): PlatformVelocities => {
  const { velo, angVelo } = out;
  if (!(duration > 0)) return zeroPlatformVelocities(out);

  // Each component times 1 / duration, as Vector3.divideScalar does
  const inverseDuration = 1 / duration;
  velo.x = (toPos.x - fromPos.x) * inverseDuration;
  velo.y = (toPos.y - fromPos.y) * inverseDuration;
  velo.z = (toPos.z - fromPos.z) * inverseDuration;

  const q1 = _fromRot.copy(fromRot);
  const q2 = _toRot.copy(toRot);
  if (q1.dot(q2) < 0) {
    q2.x = -q2.x;
    q2.y = -q2.y;
    q2.z = -q2.z;
    q2.w = -q2.w;
  }
  const qDiff = q2.multiply(q1.invert());
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, qDiff.w)));
  const sinHalfAngle = Math.sqrt(1 - qDiff.w * qDiff.w);
  if (angle < 0.0001 || sinHalfAngle <= 0.001) {
    angVelo.x = 0;
    angVelo.y = 0;
    angVelo.z = 0;
    return out;
  }
  // The axis (qDiff's vector part over sin(angle / 2)) times the angular speed
  const angularSpeed = angle / duration;
  const inverseSin = 1 / sinHalfAngle;
  angVelo.x = qDiff.x * inverseSin * angularSpeed;
  angVelo.y = qDiff.y * inverseSin * angularSpeed;
  angVelo.z = qDiff.z * inverseSin * angularSpeed;
  return out;
};

/**
 * Sets both of `out`'s velocities to zero.
 * @internal
 * @param out the velocities to write, returned
 * @returns `out`
 */
export const zeroPlatformVelocities = (out: PlatformVelocities): PlatformVelocities => {
  out.velo.x = 0;
  out.velo.y = 0;
  out.velo.z = 0;
  out.angVelo.x = 0;
  out.angVelo.y = 0;
  out.angVelo.z = 0;
  return out;
};
