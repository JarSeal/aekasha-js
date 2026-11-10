import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene } from '../scene/Scene';
import { getGeometry, saveBufferGeometry } from './Geometry';
import { mergeGeometryParts, registerMergedGeometry } from './GeometryMerge';

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
