import { describe, expect, it } from 'vitest';
import { generateAsteroid } from './Asteroid';

describe('generateAsteroid', () => {
  it('is the same rock for the same seed and options, another for another seed', () => {
    const rock = generateAsteroid({ seed: 3 });
    expect(generateAsteroid({ seed: 3 }).hullVertices).toEqual(rock.hullVertices);
    expect(generateAsteroid({ seed: 4 }).hullVertices).not.toEqual(rock.hullVertices);
  });

  it('has 10·(detail + 1)² + 2 hull vertices, detail rounded and clamped to 1-10', () => {
    for (const [detail, used] of [
      [1, 1],
      [3, 3],
      [4.4, 4],
      [0, 1],
      [12, 10],
    ]) {
      const { hullVertices } = generateAsteroid({ detail });
      expect(hullVertices.length / 3).toBe(10 * (used + 1) ** 2 + 2);
    }
  });

  it('builds finite unit normals, flat (non-indexed) by default, smooth (indexed) when asked', () => {
    for (const flatShading of [true, false]) {
      const { geometry } = generateAsteroid({ detail: 2, flatShading });
      expect(geometry.getIndex() === null).toBe(flatShading);
      const normal = geometry.getAttribute('normal');
      for (let i = 0; i < normal.count; i++) {
        const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
        expect(length).toBeCloseTo(1, 5);
      }
      expect(geometry.getAttribute('uv')).toBeUndefined();
    }
  });

  it("keeps the mesh's volume within its hull's, and every vertex within the bounding radius", () => {
    const rock = generateAsteroid({ seed: 9, radius: 2, shape: [1.4, 0.7, 1] });
    expect(rock.volume).toBeGreaterThan(0);
    expect(rock.volume).toBeLessThanOrEqual(rock.hullVolume + 1e-9);
    const v = rock.hullVertices;
    let farthest = 0;
    for (let i = 0; i < v.length; i += 3)
      farthest = Math.max(farthest, Math.hypot(v[i], v[i + 1], v[i + 2]));
    expect(rock.boundingRadius).toBeCloseTo(farthest, 5);
  });

  it('a smooth sphere without lumps or craters is a sphere of radius', () => {
    const rock = generateAsteroid({
      radius: 3,
      detail: 6,
      noise: { amplitude: 0 },
      craters: { count: 0 },
    });
    expect(rock.boundingRadius).toBeCloseTo(3, 5);
    // The icosphere's volume approaches 4/3·π·r³ from below
    const sphere = (4 / 3) * Math.PI * 27;
    expect(rock.volume).toBeLessThan(sphere);
    expect(rock.volume).toBeGreaterThan(sphere * 0.98);
  });
});
