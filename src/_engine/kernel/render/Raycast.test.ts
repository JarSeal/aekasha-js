import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  castRayFromDirection,
  castRayFromPoints,
  getRayCastStats,
  isRayCastStatsEnabled,
  resetRayCastStats,
} from './Raycast';

/** A unit box at `z`, its world matrix updated (nothing renders here to do it). */
const boxAt = (z: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld();
  return mesh;
};

/** The objects hit, each once (a box is hit on its way in and out). */
const objectsHit = (hits: THREE.Intersection[]) => [...new Set(hits.map((hit) => hit.object))];

const origin = new THREE.Vector3(0, 0, 0);
const forward = new THREE.Vector3(0, 0, -1);

describe('Raycast', () => {
  it('resets and reads the stats before anything made them (p614 C1: made on first use)', () => {
    expect(() => resetRayCastStats()).not.toThrow();
    expect(isRayCastStatsEnabled()).toBe(false);
    expect(getRayCastStats()).toBeDefined();
  });

  it('casts on first use, and puts near / far back after a cast', () => {
    const near = boxAt(-3);
    const far = boxAt(-10);
    const hits = castRayFromDirection([near, far], origin, forward, { far: 5 });
    expect(objectsHit(hits)).toEqual([near]);
    // The next cast without `far` sees both again
    expect(objectsHit(castRayFromDirection([near, far], origin, forward))).toEqual([near, far]);
  });

  it('fills a given target and stops at the end point', () => {
    const target: THREE.Intersection[] = [{} as THREE.Intersection];
    const near = boxAt(-3);
    const hits = castRayFromPoints([near, boxAt(-10)], origin, new THREE.Vector3(0, 0, -6), {
      target,
    });
    expect(hits).toBe(target);
    expect(objectsHit(hits)).toEqual([near]);
  });
});
