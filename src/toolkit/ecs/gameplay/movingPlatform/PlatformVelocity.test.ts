import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  computePlatformVelocities,
  zeroPlatformVelocities,
  type PlatformVelocities,
} from './PlatformVelocity';

const createOut = (): PlatformVelocities => ({
  velo: { x: 9, y: 9, z: 9 },
  angVelo: { x: 9, y: 9, z: 9 },
});
const quatY = (degrees: number) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (degrees * Math.PI) / 180);
const origin = new THREE.Vector3();
const identity = new THREE.Quaternion();
const ZERO = { x: 0, y: 0, z: 0 };

describe('computePlatformVelocities', () => {
  it('moves the distance in the duration', () => {
    const to = new THREE.Vector3(10, -4, 2);
    const out = computePlatformVelocities(origin, to, identity, identity, 2, createOut());
    expect(out).toEqual({ velo: { x: 5, y: -2, z: 1 }, angVelo: ZERO });
  });

  it('turns about the axis at the angle over the duration', () => {
    const { angVelo } = computePlatformVelocities(
      origin,
      origin,
      quatY(0),
      quatY(90),
      2,
      createOut()
    );
    expect(angVelo.x).toBeCloseTo(0, 12);
    expect(angVelo.y).toBeCloseTo(Math.PI / 4, 12);
    expect(angVelo.z).toBeCloseTo(0, 12);
  });

  it('turns the shorter way round', () => {
    // 350° to 10° is 20° forward, not 340° back
    const { angVelo } = computePlatformVelocities(
      origin,
      origin,
      quatY(350),
      quatY(10),
      1,
      createOut()
    );
    expect(angVelo.y).toBeCloseTo((20 * Math.PI) / 180, 12);
  });

  it('gives zero velocities for a duration of 0, NaN or Infinity', () => {
    const to = new THREE.Vector3(10, 0, 0);
    for (const duration of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = computePlatformVelocities(origin, to, quatY(0), quatY(90), duration, createOut());
      expect(Math.abs(out.velo.x) + Math.abs(out.angVelo.y)).toBe(0);
    }
  });

  it('writes into out and returns it', () => {
    const out = createOut();
    expect(computePlatformVelocities(origin, origin, identity, identity, 1, out)).toBe(out);
    expect(out).toEqual({ velo: ZERO, angVelo: ZERO });
  });
});

describe('zeroPlatformVelocities', () => {
  it('sets both velocities to zero in place', () => {
    const out = createOut();
    const { velo } = out;
    expect(zeroPlatformVelocities(out)).toBe(out);
    expect(out).toEqual({ velo: ZERO, angVelo: ZERO });
    expect(out.velo).toBe(velo);
  });
});
