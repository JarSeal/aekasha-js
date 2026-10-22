import { describe, expect, it } from 'vitest';
import { generateBushGeometry, generateTreeGeometry } from './Foliage';

describe('generateBushGeometry', () => {
  it('a bush of 0 clusters builds', () => {
    expect(() => generateBushGeometry({ clusterCount: 0 })).not.toThrow();
  });
});

describe('generateTreeGeometry', () => {
  it('is a trunk and a canopy in two material groups, standing on y = 0', () => {
    const { geometry, materialGroups } = generateTreeGeometry({ trunkHeight: 2, foliageHeight: 3 });
    expect(materialGroups).toEqual({ trunk: 0, foliage: 1 });
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 6);
    // The canopy overlaps the trunk by 0.15
    expect(box.max.y).toBeCloseTo(2 + 3 - 0.15, 6);
  });
});

describe('generateBushGeometry', () => {
  it('is the same bush for the same seed, in one group, its blobs centred above y = 0', () => {
    const bush = generateBushGeometry({ seed: 4, clusterCount: 5 });
    const again = generateBushGeometry({ seed: 4, clusterCount: 5 });
    expect(again.getAttribute('position').array).toEqual(bush.getAttribute('position').array);
    expect(
      generateBushGeometry({ seed: 5, clusterCount: 5 }).getAttribute('position').array
    ).not.toEqual(bush.getAttribute('position').array);
    expect(bush.groups).toEqual([]);
    // Each blob's centre is 0.6 of its radius up: the blobs sink a little into the ground
    const { min, max } = bush.boundingBox!;
    expect(min.y).toBeLessThan(0);
    expect((min.y + max.y) / 2).toBeGreaterThan(0);
  });

  it('a bush of 0 clusters is an empty geometry', () => {
    const bush = generateBushGeometry({ clusterCount: 0 });
    expect(bush.getAttribute('position').count).toBe(0);
  });
});
