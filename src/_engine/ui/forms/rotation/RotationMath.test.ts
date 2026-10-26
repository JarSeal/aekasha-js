import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  axisAngleToQuaternion,
  EULER_ORDERS,
  eulerToQuaternion,
  normalizeQuaternion,
  quaternionToAxisAngle,
  quaternionToEuler,
  type Quat,
} from './RotationMath';

/** Angles that reach every quadrant, the gimbal lock (±90° on the middle axis) and 0 */
const ANGLES = [0, 0.3, -1.1, Math.PI / 2, -Math.PI / 2, 2.5, -Math.PI, Math.PI / 8];

const expectQuat = (actual: Quat, expected: Quat, digits = 12) => {
  // q and -q are the same rotation
  const sign = Math.sign(actual.w * expected.w || 1);
  for (const key of ['x', 'y', 'z', 'w'] as const) {
    expect(actual[key] * sign).toBeCloseTo(expected[key], digits);
  }
};

describe('RotationMath (p804 D8), against three', () => {
  it('Euler to quaternion: three’s setFromEuler, in every order', () => {
    for (const order of EULER_ORDERS) {
      for (const x of ANGLES) {
        for (const y of ANGLES) {
          const z = (x - y) / 2;
          const three = new Quaternion().setFromEuler(new Euler(x, y, z, order));
          expectQuat(eulerToQuaternion(x, y, z, order), three);
        }
      }
    }
  });

  it('quaternion to Euler: three’s setFromQuaternion, the gimbal lock included', () => {
    for (const order of EULER_ORDERS) {
      for (const x of ANGLES) {
        for (const y of ANGLES) {
          const q = new Quaternion().setFromEuler(new Euler(x, y, -x, order));
          const three = new Euler().setFromQuaternion(q, order);
          const [ex, ey, ez] = quaternionToEuler(q, order);
          expect(ex).toBeCloseTo(three.x, 10);
          expect(ey).toBeCloseTo(three.y, 10);
          expect(ez).toBeCloseTo(three.z, 10);
          // And back: the same rotation (to asin's precision at the gimbal lock)
          expectQuat(eulerToQuaternion(ex, ey, ez, order), q, 7);
        }
      }
    }
  });

  it('axis-angle both ways: three’s setFromAxisAngle, the angle 0 to π, the axis kept at 0', () => {
    const axes: [number, number, number][] = [
      [1, 0, 0],
      [0, 2, 0],
      [1, 1, 1],
      [-0.3, 0.5, 0.8],
    ];
    for (const [ax, ay, az] of axes) {
      for (const angle of [0.4, 1.5, 3, -2]) {
        const unit = new Vector3(ax, ay, az).normalize();
        const three = new Quaternion().setFromAxisAngle(unit, angle);
        const q = axisAngleToQuaternion(ax, ay, az, angle);
        expectQuat(q, three);
        const [bx, by, bz, back] = quaternionToAxisAngle(q);
        expect(back).toBeGreaterThanOrEqual(0);
        expect(back).toBeLessThanOrEqual(Math.PI);
        expectQuat(axisAngleToQuaternion(bx, by, bz, back), three);
      }
    }
    expect(axisAngleToQuaternion(0, 0, 0, 1)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(quaternionToAxisAngle({ x: 0, y: 0, z: 0, w: 1 }, [0, 1, 0])).toEqual([0, 1, 0, 0]);
    expect(quaternionToAxisAngle({ x: 0, y: 0, z: 0, w: -1 })).toEqual([1, 0, 0, 0]);
  });

  it('normalises, the zero quaternion to the identity', () => {
    expectQuat(normalizeQuaternion({ x: 0, y: 0, z: 2, w: 2 }), {
      x: 0,
      y: 0,
      z: Math.SQRT1_2,
      w: Math.SQRT1_2,
    });
    expect(normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 })).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
