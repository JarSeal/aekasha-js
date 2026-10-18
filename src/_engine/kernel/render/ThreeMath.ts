import * as THREE from 'three/webgpu';
import type { ColorJSON } from '../../schemas/_HelperSchemas';

/**
 * Unit directions in three's axes (−z forward, +y up), for ray casting from an angle
 * (`castRayFromAngle`). Shared objects: read them, never write them.
 * @internal
 */
export const DIRECTIONS = {
  FORWARD: new THREE.Vector3(0, 0, -1),
  BACKWARD: new THREE.Vector3(0, 0, 1),
  UP: new THREE.Vector3(0, 1, 0),
  DOWN: new THREE.Vector3(0, -1, 0),
  RIGHT: new THREE.Vector3(1, 0, 0),
  LEFT: new THREE.Vector3(-1, 0, 0),
};

/**
 * The world up normal (+y) a flat floor has, for the character controllers' slope maths. A shared
 * object: read it, never write it.
 * @internal
 */
export const LEVEL_GROUND_NORMAL = new THREE.Vector3(0, 1, 0);

// Scratch objects for this file's helpers
const ThreeVector3 = new THREE.Vector3();
const ThreeQuaternion = new THREE.Quaternion();

/**
 * A rotation of `deg` degrees about the world up axis (+y), as a plain quaternion object (a new
 * one per call), eg. for `setTransform`'s `rot` or a moving platform's points.
 * @param deg the angle in degrees, counter-clockwise seen from above
 */
export const getQuatFromAngle = (deg: number) => {
  ThreeQuaternion.setFromAxisAngle(ThreeVector3.set(0, 1, 0), THREE.MathUtils.degToRad(deg));
  return { x: ThreeQuaternion.x, y: ThreeQuaternion.y, z: ThreeQuaternion.z, w: ThreeQuaternion.w };
};

/**
 * Moves `current` towards `target` like a critically damped spring (Unity's `SmoothDamp`), without
 * overshooting it: a camera that follows, a value that eases in. Writes `current` and
 * `currentVelocity`; allocates nothing.
 * @param current the value to move, written in place
 * @param target where it goes (read only)
 * @param currentVelocity the speed state, written in place: keep one per damped value, across frames
 * @param smoothTime about the time to reach the target, in the same unit as `deltaTime` (min 0.0001)
 * @param maxSpeed the highest speed per unit of time (pass `Infinity` for none)
 * @param deltaTime the time since the last call
 * @remarks `maxSpeed` comes before the required `deltaTime`, so its default can't be left out:
 * pass `Infinity`.
 */
export const smoothDampVec3 = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  currentVelocity: THREE.Vector3,
  smoothTime: number,
  maxSpeed: number = Infinity,
  deltaTime: number
) => {
  // 1. Friction / Smoothness constant
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;

  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  // 2. Calculate difference
  let changeX = current.x - target.x;
  let changeY = current.y - target.y;
  let changeZ = current.z - target.z;

  // The target, kept for the overshoot check (the clamp below moves the one the spring uses)
  const originalToX = target.x;
  const originalToY = target.y;
  const originalToZ = target.z;

  // 3. Clamp maximum speed
  const maxChange = maxSpeed * smoothTime;
  const maxChangeSq = maxChange * maxChange;
  const distSq = changeX * changeX + changeY * changeY + changeZ * changeZ;

  if (distSq > maxChangeSq) {
    const mag = Math.sqrt(distSq);
    changeX = (changeX / mag) * maxChange;
    changeY = (changeY / mag) * maxChange;
    changeZ = (changeZ / mag) * maxChange;
  }

  // The (clamped) target, in locals: the caller's target is never written
  const toX = current.x - changeX;
  const toY = current.y - changeY;
  const toZ = current.z - changeZ;

  // 4. Calculate new velocity
  const tempX = (currentVelocity.x + omega * changeX) * deltaTime;
  const tempY = (currentVelocity.y + omega * changeY) * deltaTime;
  const tempZ = (currentVelocity.z + omega * changeZ) * deltaTime;

  currentVelocity.x = (currentVelocity.x - omega * tempX) * exp;
  currentVelocity.y = (currentVelocity.y - omega * tempY) * exp;
  currentVelocity.z = (currentVelocity.z - omega * tempZ) * exp;

  // 5. Calculate new position
  let outputX = toX + (changeX + tempX) * exp;
  let outputY = toY + (changeY + tempY) * exp;
  let outputZ = toZ + (changeZ + tempZ) * exp;

  // 6. Prevent overshooting
  const origMinusCurrentX = originalToX - current.x;
  const origMinusCurrentY = originalToY - current.y;
  const origMinusCurrentZ = originalToZ - current.z;
  const outMinusOrigX = outputX - originalToX;
  const outMinusOrigY = outputY - originalToY;
  const outMinusOrigZ = outputZ - originalToZ;

  if (
    origMinusCurrentX * outMinusOrigX +
      origMinusCurrentY * outMinusOrigY +
      origMinusCurrentZ * outMinusOrigZ >
    0
  ) {
    outputX = originalToX;
    outputY = originalToY;
    outputZ = originalToZ;

    currentVelocity.x = (outputX - originalToX) / deltaTime;
    currentVelocity.y = (outputY - originalToY) / deltaTime;
    currentVelocity.z = (outputZ - originalToZ) / deltaTime;
  }

  // Apply result
  current.x = outputX;
  current.y = outputY;
  current.z = outputZ;
};

/**
 * A colour as three takes it, from a JSON colour (`ColorJSON`: a CSS colour string, or
 * `{ r, g, b }` in 0-255) or one of three's own forms (passed through). `{ r, g, b }` is sRGB, as
 * a `'#rrggbb'` string is: three would ignore the plain object and keep its default (white).
 * @internal
 */
export const toThreeColor = <T extends THREE.ColorRepresentation | ColorJSON | undefined>(
  color: T
): Exclude<T, ColorJSON> | THREE.ColorRepresentation => {
  if (typeof color !== 'object' || (color as THREE.Color).isColor) {
    return color as Exclude<T, ColorJSON>;
  }
  const { r, g, b } = color as Exclude<ColorJSON, string>;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
};
