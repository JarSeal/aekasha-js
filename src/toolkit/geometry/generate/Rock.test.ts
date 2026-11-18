import { afterEach, describe, expect, it } from 'vitest';
import { deleteGeometry, getGeometry } from 'aekasha';
import { generateRock, ROCK_TRIANGLE_BUDGETS, saveRockGeometries, type RockKind } from './Rock';

const KINDS: RockKind[] = ['PEBBLE', 'ROCK', 'BOULDER'];

const getTriangles = (rock: ReturnType<typeof generateRock>) =>
  (rock.geometry.getIndex()?.count ?? 0) / 3;

describe('generateRock', () => {
  it('keeps each kind within its triangle budget, indexed with smooth unit normals and no UVs', () => {
    for (const kind of KINDS) {
      const rock = generateRock({ kind });
      expect(getTriangles(rock)).toBeGreaterThan(0);
      expect(getTriangles(rock)).toBeLessThanOrEqual(ROCK_TRIANGLE_BUDGETS[kind]);
      const normal = rock.geometry.getAttribute('normal');
      for (let i = 0; i < normal.count; i++) {
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
      }
      expect(rock.geometry.getAttribute('uv')).toBeUndefined();
    }
  });

  it('is the same rock for the same seed and options, another for another seed', () => {
    const rock = generateRock({ seed: 5 });
    expect(generateRock({ seed: 5 }).hullVertices).toEqual(rock.hullVertices);
    expect(generateRock({ seed: 6 }).hullVertices).not.toEqual(rock.hullVertices);
  });

  it('stands on a flat base at its origin, centred on x and z, lower than it is wide', () => {
    for (const kind of KINDS) {
      const rock = generateRock({ kind, seed: 3 });
      const box = rock.geometry.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeCloseTo(rock.height, 6);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
      expect(rock.height).toBeLessThan(box.max.x - box.min.x);
      // The base: several vertices on the cut, none under it
      const v = rock.hullVertices;
      let onBase = 0;
      for (let i = 1; i < v.length; i += 3) {
        expect(v[i]).toBeGreaterThanOrEqual(-1e-6);
        if (Math.abs(v[i]) < 1e-6) onBase++;
      }
      expect(onBase).toBeGreaterThanOrEqual(3);
    }
  });

  it("follows squash and flatten, and keeps its volume within its hull's", () => {
    const tall = generateRock({ seed: 2, squash: 1, flatten: 0 });
    const flat = generateRock({ seed: 2, squash: 0.5, flatten: 0 });
    expect(flat.height).toBeCloseTo(tall.height / 2, 5);
    const cut = generateRock({ seed: 2, squash: 1, flatten: 0.4 });
    expect(cut.height).toBeCloseTo(tall.height * 0.6, 5);
    for (const rock of [tall, flat, cut]) {
      expect(rock.volume).toBeGreaterThan(0);
      expect(rock.volume).toBeLessThanOrEqual(rock.hullVolume + 1e-9);
    }
  });
});

describe('saveRockGeometries', () => {
  const ids = [
    'rockPebble_a',
    'rockPebble_b',
    'rockPebble_c',
    'rockSmall_a',
    'rockSmall_b',
    'rockSmall_c',
    'boulder_a',
    'boulder_b',
  ];
  afterEach(() => {
    for (const id of ids) if (getGeometry(id)) deleteGeometry(id);
  });

  it('registers the eight variants, the kinds asked for only, and keeps those registered', () => {
    expect(saveRockGeometries({ kinds: ['PEBBLE'] })).toEqual(ids.slice(0, 3));
    expect(getGeometry('rockSmall_a')).toBeUndefined();
    const pebble = getGeometry('rockPebble_a');
    expect(saveRockGeometries()).toEqual(ids);
    expect(getGeometry('rockPebble_a')).toBe(pebble);
    for (const id of ids) expect(getGeometry(id)).toBeDefined();
    expect(getGeometry('rockPebble_a')).not.toBe(getGeometry('rockPebble_b'));
  });
});
