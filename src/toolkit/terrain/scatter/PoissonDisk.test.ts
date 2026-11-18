import { describe, expect, it } from 'vitest';
import { createSeededRandom } from 'aekasha';
import { samplePoissonDisk } from './PoissonDisk';

/** The closest two points' distance, by brute force */
const getMinDistance = (points: Float32Array) => {
  let min = Infinity;
  for (let i = 0; i < points.length; i += 2) {
    for (let j = i + 2; j < points.length; j += 2) {
      min = Math.min(min, Math.hypot(points[i] - points[j], points[i + 1] - points[j + 1]));
    }
  }
  return min;
};

describe('samplePoissonDisk', () => {
  it('keeps every point apart by the radius, inside the rectangle', () => {
    const points = samplePoissonDisk({
      width: 12,
      depth: 8,
      radius: 0.5,
      random: createSeededRandom(4),
    });
    expect(getMinDistance(points)).toBeGreaterThanOrEqual(0.5 - 1e-5);
    for (let i = 0; i < points.length; i += 2) {
      expect(points[i]).toBeGreaterThanOrEqual(0);
      expect(points[i]).toBeLessThanOrEqual(12);
      expect(points[i + 1]).toBeGreaterThanOrEqual(0);
      expect(points[i + 1]).toBeLessThanOrEqual(8);
    }
  });

  it('covers the rectangle evenly: no gap a point would fit in', () => {
    const points = samplePoissonDisk({
      width: 20,
      depth: 20,
      radius: 1,
      random: createSeededRandom(9),
    });
    // Bridson's packing: about 0.6-0.7 points per radius² (a hexagonal packing's 1.15 the most)
    const perArea = points.length / 2 / 400;
    expect(perArea).toBeGreaterThan(0.55);
    expect(perArea).toBeLessThan(0.8);
    // Every quarter has its share
    const quarters = [0, 0, 0, 0];
    for (let i = 0; i < points.length; i += 2) {
      quarters[(points[i] < 10 ? 0 : 1) + (points[i + 1] < 10 ? 0 : 2)]++;
    }
    const share = points.length / 2 / 4;
    for (const quarter of quarters) expect(Math.abs(quarter - share) / share).toBeLessThan(0.1);
  });

  it('gives the same points for the same seed, others for another', () => {
    const sample = (seed: number) =>
      samplePoissonDisk({ width: 10, depth: 10, radius: 0.7, random: createSeededRandom(seed) });
    expect(sample(3)).toEqual(sample(3));
    expect(sample(3)).not.toEqual(sample(4));
  });
});
