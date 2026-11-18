import { afterEach, describe, expect, it } from 'vitest';
import { deleteGeometry, getGeometry } from 'aekasha';
import { generateLeafCard, LEAF_CARD_GEOMETRY_ID, saveLeafCardGeometry } from './LeafCard';

describe('generateLeafCard', () => {
  it('is a square of 4 triangles lying flat, its edges curled up, its normals facing up', () => {
    const card = generateLeafCard({ size: 0.2, curl: 0.1 });
    expect(card.getIndex()!.count / 3).toBe(4);
    const box = card.boundingBox!;
    expect(box.min.x).toBeCloseTo(-0.1, 6);
    expect(box.max.z).toBeCloseTo(0.1, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(0.02, 6);
    const normal = card.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0.9);
    // Each triangle's winding faces up too (three's front face)
    const index = card.getIndex()!;
    const position = card.getAttribute('position');
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => index.getX(t + k));
      const abx = position.getX(b) - position.getX(a);
      const abz = position.getZ(b) - position.getZ(a);
      const acx = position.getX(c) - position.getX(a);
      const acz = position.getZ(c) - position.getZ(a);
      expect(abz * acx - abx * acz).toBeGreaterThan(0);
    }
  });

  it('lays its UV over the square, V along the midrib to the tip at −z', () => {
    const card = generateLeafCard();
    const position = card.getAttribute('position');
    const uv = card.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) / 0.14 + 0.5, 6);
      expect(uv.getY(i)).toBeCloseTo(0.5 - position.getZ(i) / 0.14, 6);
    }
  });
});

describe('saveLeafCardGeometry', () => {
  afterEach(() => {
    if (getGeometry(LEAF_CARD_GEOMETRY_ID)) deleteGeometry(LEAF_CARD_GEOMETRY_ID);
  });

  it('registers the default card once', () => {
    expect(saveLeafCardGeometry()).toBe(LEAF_CARD_GEOMETRY_ID);
    const card = getGeometry(LEAF_CARD_GEOMETRY_ID);
    expect(card).toBeDefined();
    saveLeafCardGeometry();
    expect(getGeometry(LEAF_CARD_GEOMETRY_ID)).toBe(card);
  });
});
