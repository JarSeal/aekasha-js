// The rotation fields' maths (p804 D8): Euler angles, quaternions and axis-angle, each way, with
// three's formulas and conventions (an Euler's `order`, the gimbal threshold) but no three import:
// the kit doesn't bring three into a bundle (RotationMath.test.ts checks them against three's).

/**
 * The order an Euler's rotations apply in: three's (`THREE.Euler`'s `order`).
 */
export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';

/**
 * A quaternion's components: a `THREE.Quaternion`'s shape.
 * @internal
 */
export type Quat = { x: number; y: number; z: number; w: number };

/**
 * Every Euler order, three's default (`'XYZ'`) first.
 * @internal
 */
export const EULER_ORDERS: readonly EulerOrder[] = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'];

/**
 * Degrees to radians: a field shows degrees and writes radians.
 * @internal
 */
export const DEG_TO_RAD = Math.PI / 180;

/**
 * Radians to degrees.
 * @internal
 */
export const RAD_TO_DEG = 180 / Math.PI;

/** Each order's signs in three's `setFromEuler`: x = s1c2c3 ± c1s2s3, y = c1s2c3 ± s1c2s3,
 * z = c1c2s3 ± s1s2c3, w = c1c2c3 ± s1s2s3 */
const EULER_SIGNS: Readonly<Record<EulerOrder, readonly [number, number, number, number]>> = {
  XYZ: [1, -1, 1, -1],
  YXZ: [1, -1, -1, 1],
  ZXY: [-1, 1, 1, -1],
  ZYX: [-1, 1, -1, 1],
  YZX: [1, 1, -1, -1],
  XZY: [-1, -1, 1, 1],
};

/** Below one: three's gimbal threshold in `Euler.setFromRotationMatrix` */
const GIMBAL_LIMIT = 0.9999999;

const clamp1 = (value: number) => Math.min(1, Math.max(-1, value));

/**
 * A quaternion of unit length (the identity for a zero one).
 * @internal
 */
export const normalizeQuaternion = (q: Quat): Quat => {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length === 0) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
};

/**
 * Euler angles (radians) as a quaternion (three's `Quaternion.setFromEuler`).
 * @internal
 */
export const eulerToQuaternion = (x: number, y: number, z: number, order: EulerOrder): Quat => {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  const [sx, sy, sz, sw] = EULER_SIGNS[order];
  return {
    x: s1 * c2 * c3 + sx * c1 * s2 * s3,
    y: c1 * s2 * c3 + sy * s1 * c2 * s3,
    z: c1 * c2 * s3 + sz * s1 * s2 * c3,
    w: c1 * c2 * c3 + sw * s1 * s2 * s3,
  };
};

/**
 * A unit quaternion as Euler angles in radians, `[x, y, z]` (three's `Euler.setFromQuaternion`:
 * through the rotation matrix, the middle axis' angle in ±90°, and at the gimbal lock one of the
 * other two 0).
 * @internal
 */
export const quaternionToEuler = (q: Quat, order: EulerOrder): [number, number, number] => {
  const { x, y, z, w } = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m11 = 1 - (yy + zz);
  const m12 = xy - wz;
  const m13 = xz + wy;
  const m21 = xy + wz;
  const m22 = 1 - (xx + zz);
  const m23 = yz - wx;
  const m31 = xz - wy;
  const m32 = yz + wx;
  const m33 = 1 - (xx + yy);
  switch (order) {
    case 'XYZ': {
      const free = Math.abs(m13) < GIMBAL_LIMIT;
      return [
        free ? Math.atan2(-m23, m33) : Math.atan2(m32, m22),
        Math.asin(clamp1(m13)),
        free ? Math.atan2(-m12, m11) : 0,
      ];
    }
    case 'YXZ': {
      const free = Math.abs(m23) < GIMBAL_LIMIT;
      return [
        Math.asin(-clamp1(m23)),
        free ? Math.atan2(m13, m33) : Math.atan2(-m31, m11),
        free ? Math.atan2(m21, m22) : 0,
      ];
    }
    case 'ZXY': {
      const free = Math.abs(m32) < GIMBAL_LIMIT;
      return [
        Math.asin(clamp1(m32)),
        free ? Math.atan2(-m31, m33) : 0,
        free ? Math.atan2(-m12, m22) : Math.atan2(m21, m11),
      ];
    }
    case 'ZYX': {
      const free = Math.abs(m31) < GIMBAL_LIMIT;
      return [
        free ? Math.atan2(m32, m33) : 0,
        Math.asin(-clamp1(m31)),
        free ? Math.atan2(m21, m11) : Math.atan2(-m12, m22),
      ];
    }
    case 'YZX': {
      const free = Math.abs(m21) < GIMBAL_LIMIT;
      return [
        free ? Math.atan2(-m23, m22) : 0,
        free ? Math.atan2(-m31, m11) : Math.atan2(m13, m33),
        Math.asin(clamp1(m21)),
      ];
    }
    case 'XZY': {
      const free = Math.abs(m12) < GIMBAL_LIMIT;
      return [
        free ? Math.atan2(m32, m22) : Math.atan2(-m23, m33),
        free ? Math.atan2(m13, m11) : 0,
        Math.asin(-clamp1(m12)),
      ];
    }
  }
};

/**
 * An axis and an angle (radians) as a quaternion (three's `Quaternion.setFromAxisAngle`, the axis
 * normalised here; a zero axis is no rotation).
 * @internal
 */
export const axisAngleToQuaternion = (ax: number, ay: number, az: number, angle: number): Quat => {
  const length = Math.hypot(ax, ay, az);
  if (length === 0) return { x: 0, y: 0, z: 0, w: 1 };
  const s = Math.sin(angle / 2) / length;
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
};

/**
 * A unit quaternion as `[ax, ay, az, angle]` (radians, 0 to π: a negative `w` is the same
 * rotation flipped). With no rotation the axis has no direction: `previous`'s is kept (the one
 * shown), else +X.
 * @internal
 */
export const quaternionToAxisAngle = (
  q: Quat,
  previous?: readonly [number, number, number]
): [number, number, number, number] => {
  const sign = q.w < 0 ? -1 : 1;
  const w = clamp1(q.w * sign);
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-9) {
    const [ax, ay, az] = previous ?? [1, 0, 0];
    return [ax, ay, az, 0];
  }
  return [(q.x * sign) / s, (q.y * sign) / s, (q.z * sign) / s, angle];
};
