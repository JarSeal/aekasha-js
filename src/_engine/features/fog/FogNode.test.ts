import { describe, expect, it } from 'vitest';
import {
  createFogNodes,
  FOG_FLAT_RAY_EPSILON,
  getExp2FogFactor,
  getFogSunGlow,
  getHeightFogFactor,
  getLinearFogFactor,
} from './FogNode';

const HEIGHT = { density: 0.02, baseHeight: 0, falloff: 0.1, startDistance: 0, maxOpacity: 1 };

/** `HEIGHT`'s optical depth integrated numerically (the midpoint rule) along the ray. */
const integrateHeightFog = (
  params: typeof HEIGHT,
  cameraY: number,
  rayLength: number,
  rayY: number,
  steps = 20000
) => {
  const { density, baseHeight, falloff, startDistance } = params;
  let sum = 0;
  const from = Math.min(startDistance, rayLength);
  const dt = (rayLength - from) / steps;
  for (let i = 0; i < steps; i++) {
    const t = from + (i + 0.5) * dt;
    const y = cameraY + (rayY * t) / rayLength;
    sum += density * Math.exp(-falloff * (y - baseHeight)) * dt;
  }
  return 1 - Math.exp(-sum);
};

describe('the factors on the CPU', () => {
  it('LINEAR is a smoothstep from near to far', () => {
    expect(getLinearFogFactor(10, 110, 0)).toBe(0);
    expect(getLinearFogFactor(10, 110, 10)).toBe(0);
    expect(getLinearFogFactor(10, 110, 60)).toBe(0.5);
    expect(getLinearFogFactor(10, 110, 35)).toBeCloseTo(0.15625);
    expect(getLinearFogFactor(10, 110, 110)).toBe(1);
    expect(getLinearFogFactor(10, 110, 1000)).toBe(1);
  });

  it('EXP2 is 1 − exp(−(density · depth)²)', () => {
    expect(getExp2FogFactor(0.01, 0)).toBe(0);
    expect(getExp2FogFactor(0.01, 100)).toBeCloseTo(1 - Math.exp(-1));
    expect(getExp2FogFactor(0, 1e6)).toBe(0);
    expect(getExp2FogFactor(0.01, 1e4)).toBe(1);
  });

  describe('HEIGHT', () => {
    it('is the density integrated along the ray, up and down', () => {
      for (const [cameraY, rayLength, rayY] of [
        [2, 300, -2],
        [50, 400, -50],
        [0, 200, 40],
        [-10, 1000, 30],
      ]) {
        expect(getHeightFogFactor(HEIGHT, cameraY, rayLength, rayY)).toBeCloseTo(
          integrateHeightFog(HEIGHT, cameraY, rayLength, rayY),
          6
        );
      }
    });

    it('is thick in a valley and thin over the hills', () => {
      const valley = getHeightFogFactor(HEIGHT, 0, 200, 0);
      const hills = getHeightFogFactor(HEIGHT, 40, 200, 0);
      expect(valley).toBeGreaterThan(0.9);
      expect(hills).toBeLessThan(0.1);
    });

    it('takes the limit on a level ray, continuous across the epsilon', () => {
      // falloff · Δy just below, at and above the epsilon: the two forms agree
      const rayYs = [0, 0.5, 0.99, 1.01, 2].map((share) => (share * FOG_FLAT_RAY_EPSILON) / 0.1);
      const factors = rayYs.map((rayY) => getHeightFogFactor(HEIGHT, 5, 300, rayY));
      const exact = rayYs.map((rayY) => integrateHeightFog(HEIGHT, 5, 300, rayY));
      factors.forEach((factor, i) => expect(factor).toBeCloseTo(exact[i], 7));
      // A level ray through a uniform density, and no falloff, are Beer-Lambert
      const atLevel = 0.02 * Math.exp(-0.1 * 5) * 300;
      expect(getHeightFogFactor(HEIGHT, 5, 300, 0)).toBeCloseTo(1 - Math.exp(-atLevel), 10);
      const noFalloff = getHeightFogFactor({ ...HEIGHT, falloff: 0 }, 5, 300, -40);
      expect(noFalloff).toBeCloseTo(1 - Math.exp(-0.02 * 300), 10);
    });

    it('starts at startDistance', () => {
      const params = { ...HEIGHT, startDistance: 100 };
      expect(getHeightFogFactor(params, 0, 50, -1)).toBe(0);
      expect(getHeightFogFactor(params, 0, 100, -1)).toBe(0);
      // The rest of the ray, from the point 100 m along it
      expect(getHeightFogFactor(params, 10, 300, -30)).toBeCloseTo(
        getHeightFogFactor(HEIGHT, 0, 200, -20),
        10
      );
    });

    it('stops at maxOpacity', () => {
      expect(getHeightFogFactor({ ...HEIGHT, maxOpacity: 0.6 }, 0, 1e4, 0)).toBe(0.6);
      expect(getHeightFogFactor({ ...HEIGHT, maxOpacity: 0.6 }, 0, 1, 0)).toBeLessThan(0.6);
    });

    it('stays a number at the extremes', () => {
      // A camera deep below the base, the ray's ends clamped: full fog, not NaN
      expect(getHeightFogFactor(HEIGHT, -5000, 100, -10)).toBe(1);
      expect(getHeightFogFactor(HEIGHT, -5000, 100, 4800)).toBe(1);
      // High above it: none
      expect(getHeightFogFactor(HEIGHT, 5000, 100, 10)).toBe(0);
      // A zero-length ray (taken as 1 µm), and no density
      expect(getHeightFogFactor(HEIGHT, 0, 0, 0)).toBeCloseTo(0, 6);
      expect(getHeightFogFactor({ ...HEIGHT, density: 0 }, -5000, 100, 0)).toBe(0);
    });
  });

  it('the sun glow is strength · max(cos, 0)^exponent', () => {
    expect(getFogSunGlow(0.5, 8, 1)).toBe(0.5);
    expect(getFogSunGlow(0.5, 8, Math.cos(0.3))).toBeCloseTo(0.5 * Math.cos(0.3) ** 8);
    expect(getFogSunGlow(0.5, 8, -1)).toBe(0);
    expect(getFogSunGlow(0, 8, 1)).toBe(0);
    // No sun: a zero direction's cosine is 0
    expect(getFogSunGlow(1, 1e-3, 0)).toBe(0);
  });
});

describe('createFogNodes', () => {
  it('starts with no fog, and its graph is three’s fog node', () => {
    const nodes = createFogNodes();
    expect(nodes.enabled.value).toBe(0);
    expect(nodes.modeWeights.value.toArray()).toEqual([0, 0, 0]);
    expect(nodes.sunDirection.value.toArray()).toEqual([0, 0, 0]);
    expect(nodes.sunStrength.value).toBe(0);
    expect(nodes.node.isNode).toBe(true);
    // Each call makes its own: the feature keeps one a page load
    expect(createFogNodes().node).not.toBe(nodes.node);
  });
});
