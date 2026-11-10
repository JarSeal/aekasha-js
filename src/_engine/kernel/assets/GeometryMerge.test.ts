import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene } from '../scene/Scene';
import { getGeometry, saveBufferGeometry } from './Geometry';
import {
  mergeGeometryParts,
  registerMergedGeometry,
  registerMergedGeoProps,
} from './GeometryMerge';

beforeAll(() => {
  createRootScene();
});

describe('mergeGeometryParts', () => {
  test('resolves registered ids and throws for an unregistered one', () => {
    const box = saveBufferGeometry(new THREE.BoxGeometry(), { id: 'geometryMergeTestBox' });
    const merged = mergeGeometryParts([{ geo: 'geometryMergeTestBox' }, { geo: box }]);
    expect(merged.attributes.position.count).toBe(48);
    expect(() => mergeGeometryParts([{ geo: 'geometryMergeTestNone' }])).toThrow(
      /geometryMergeTestNone/
    );
  });
});

describe('registerMergedGeometry', () => {
  test('registers the merge, and returns the registered one for a taken id', () => {
    const parts = [{ geo: new THREE.BoxGeometry() }, { geo: new THREE.SphereGeometry() }];
    const first = registerMergedGeometry(parts, { id: 'geometryMergeTestMerged' });
    expect(getGeometry('geometryMergeTestMerged')).toBe(first);
    expect(first.userData.mergeParts).toHaveLength(2);
    const again = registerMergedGeometry([{ geo: new THREE.BoxGeometry() }], {
      id: 'geometryMergeTestMerged',
    });
    expect(again).toBe(first);
  });
});

describe('registerMergedGeoProps', () => {
  const box = (y: number) => {
    const geometry = registerMergedGeoProps({
      id: `geometryMergeTestProps${y}`,
      type: 'MERGED',
      params: {
        parts: [
          { geo: 'geometryMergeTestUnit', position: { y }, key: 'plain' },
          {
            geo: 'geometryMergeTestUnit',
            position: { x: 10 },
            rotation: { z: Math.PI / 2 },
            scale: { x: 2, y: 1, z: 1 },
            materialSlot: 1,
            key: 'rotated',
          },
          {
            geo: 'geometryMergeTestUnit',
            position: { x: -10 },
            // A quarter turn about z, which wins over the rotation
            quaternion: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
            rotation: { x: 1 },
          },
        ],
        groups: 'BY_SLOT',
      },
    });
    geometry.computeBoundingBox();
    return geometry;
  };

  test('composes each part as a mesh: position, rotation (quaternion over it), scale', () => {
    // A 2×1×1 box: the scale stretches it along its own x, the quarter turn puts that on y
    saveBufferGeometry(new THREE.BoxGeometry(1, 1, 1), { id: 'geometryMergeTestUnit' });
    const geometry = box(0);
    const ranges = geometry.userData.mergeParts as { key?: string; vertexStart: number }[];
    expect(ranges.map((range) => range.key)).toEqual(['plain', undefined, 'rotated']);
    const partBox = (start: number) =>
      new THREE.Box3().setFromBufferAttribute(
        new THREE.Float32BufferAttribute(
          (geometry.attributes.position.array as Float32Array).slice(start * 3, (start + 24) * 3),
          3
        )
      );
    const rotated = partBox(ranges[2].vertexStart);
    expect(rotated.min.x).toBeCloseTo(9.5);
    expect(rotated.max.x).toBeCloseTo(10.5);
    expect(rotated.min.y).toBeCloseTo(-1);
    expect(rotated.max.y).toBeCloseTo(1);
    const quaternion = partBox(ranges[1].vertexStart);
    expect(quaternion.min.x).toBeCloseTo(-10.5);
    expect(quaternion.max.z).toBeCloseTo(0.5);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    expect(getGeometry('geometryMergeTestProps0')).toBe(geometry);
  });
});
