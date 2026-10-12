import * as THREE from 'three/webgpu';

export const RENDERER_SHADOW_OPTIONS = [
  { value: THREE.BasicShadowMap, text: 'Basic shadow map' },
  { value: THREE.PCFShadowMap, text: 'PCF shadow map' },
  { value: THREE.PCFSoftShadowMap, text: 'PCF soft shadow map' },
  { value: THREE.VSMShadowMap, text: 'VSM shadow map' },
];

// Directions for ray casting with angle (castRayFromAngle)
export const DIRECTIONS = {
  FORWARD: new THREE.Vector3(0, 0, -1),
  BACKWARD: new THREE.Vector3(0, 0, 1),
  UP: new THREE.Vector3(0, 1, 0),
  DOWN: new THREE.Vector3(0, -1, 0),
  RIGHT: new THREE.Vector3(1, 0, 0),
  LEFT: new THREE.Vector3(-1, 0, 0),
};

export const LEVEL_GROUND_NORMAL = new THREE.Vector3(0, 1, 0);
export const GRAVITY_DOWN_NORMAL = new THREE.Vector3(0, -1, 0);

export const ThreeVector3 = new THREE.Vector3();
export const ThreeQuoternion = new THREE.Quaternion();
export const ThreeEuler = new THREE.Euler();

export const getQuatFromAngle = (deg: number) => {
  ThreeQuoternion.setFromAxisAngle(ThreeVector3.set(0, 1, 0), THREE.MathUtils.degToRad(deg));
  return { x: ThreeQuoternion.x, y: ThreeQuoternion.y, z: ThreeQuoternion.z, w: ThreeQuoternion.w };
};

// @TODO: rename this (slerp to slerpQuat)
export const slerp = (a: THREE.Quaternion, b: THREE.Quaternion, t: number) => a.clone().slerp(b, t);

/**
 * Smoothly dampens a vector towards a target.
 * @param current Current position (Modified in place!)
 * @param target Target position
 * @param currentVelocity Current velocity (Modified in place! Must persist across frames)
 * @param smoothTime Approximately the time it takes to reach the target
 * @param maxSpeed Maximum speed
 * @param deltaTime Time since last frame
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

  // The target before the clamp below rewrites it (plain numbers, not a per-call clone)
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

  target.x = current.x - changeX;
  target.y = current.y - changeY;
  target.z = current.z - changeZ;

  // 4. Calculate new velocity
  const tempX = (currentVelocity.x + omega * changeX) * deltaTime;
  const tempY = (currentVelocity.y + omega * changeY) * deltaTime;
  const tempZ = (currentVelocity.z + omega * changeZ) * deltaTime;

  currentVelocity.x = (currentVelocity.x - omega * tempX) * exp;
  currentVelocity.y = (currentVelocity.y - omega * tempY) * exp;
  currentVelocity.z = (currentVelocity.z - omega * tempZ) * exp;

  // 5. Calculate new position
  let outputX = target.x + (changeX + tempX) * exp;
  let outputY = target.y + (changeY + tempY) * exp;
  let outputZ = target.z + (changeZ + tempZ) * exp;

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
