import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { smoothDampVec3 } from './ThreeMath';

describe('smoothDampVec3', () => {
  it('never writes the target, also when maxSpeed clamps', () => {
    const current = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(100, 0, 0);
    const velocity = new THREE.Vector3();
    smoothDampVec3(current, target, velocity, 0.5, 1, 1 / 60);
    expect(target.toArray()).toEqual([100, 0, 0]);
  });

  it('approaches the target without passing it', () => {
    const current = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(1, 2, -3);
    const velocity = new THREE.Vector3();
    let prevDistance = current.distanceTo(target);
    for (let i = 0; i < 600; i++) {
      smoothDampVec3(current, target, velocity, 0.3, Infinity, 1 / 60);
      const distance = current.distanceTo(target);
      expect(distance).toBeLessThanOrEqual(prevDistance + 1e-9);
      // Never on the far side of the target, on any axis
      expect(current.x).toBeLessThanOrEqual(1 + 1e-9);
      expect(current.y).toBeLessThanOrEqual(2 + 1e-9);
      expect(current.z).toBeGreaterThanOrEqual(-3 - 1e-9);
      prevDistance = distance;
    }
    expect(prevDistance).toBeLessThan(1e-3);
  });

  it('keeps to maxSpeed', () => {
    const current = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(1000, 0, 0);
    const velocity = new THREE.Vector3();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      const before = current.x;
      smoothDampVec3(current, target, velocity, 0.2, 5, dt);
      expect((current.x - before) / dt).toBeLessThanOrEqual(5 + 1e-6);
    }
  });
});
