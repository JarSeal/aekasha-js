import { describe, expect, it } from 'vitest';
import {
  evaluateTerrainRulesCPU,
  getTerrainRuleCoverageCPU,
  type TerrainRuleNoiseTexels,
  type TerrainRulePoint,
} from './TerrainRules';

const DEG = Math.PI / 180;

/** A point at a height on a surface sloping `slope` degrees, facing (downhill) `facing` [x, z] */
const pointAt = (
  y: number,
  slope = 0,
  facing: [number, number] = [1, 0],
  x = 0,
  z = 0
): TerrainRulePoint => {
  const length = Math.hypot(...facing);
  return {
    x,
    y,
    z,
    normalX: (Math.sin(slope * DEG) * facing[0]) / length,
    normalY: Math.cos(slope * DEG),
    normalZ: (Math.sin(slope * DEG) * facing[1]) / length,
  };
};

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** 2 × 2 texels: R 0 / 255 left / right, G 0 top row, 255 bottom row, B 128, A 64 */
const NOISE: TerrainRuleNoiseTexels = {
  width: 2,
  height: 2,
  data: [0, 0, 128, 64, 255, 0, 128, 64, 0, 255, 128, 64, 255, 255, 128, 64],
};

describe('getTerrainRuleCoverageCPU', () => {
  it('fades a range over its softness past each end, with the defaults', () => {
    const rule = { layer: 1, slope: { min: 30, max: 50 } };
    expect(getTerrainRuleCoverageCPU(rule, pointAt(0, 40))).toBeCloseTo(1, 6);
    // The default slope softness, 5°
    expect(getTerrainRuleCoverageCPU(rule, pointAt(0, 27.5))).toBeCloseTo(
      smoothstep(25, 30, 27.5),
      6
    );
    expect(getTerrainRuleCoverageCPU(rule, pointAt(0, 55))).toBeCloseTo(0, 6);
    const height = { layer: 1, height: { max: 10, softness: 4 } };
    expect(getTerrainRuleCoverageCPU(height, pointAt(11))).toBeCloseTo(
      1 - smoothstep(10, 14, 11),
      6
    );
    // A softness of 0 is a step
    expect(
      getTerrainRuleCoverageCPU({ layer: 1, height: { min: 5, softness: 0 } }, pointAt(5))
    ).toBe(1);
    expect(
      getTerrainRuleCoverageCPU({ layer: 1, height: { min: 5, softness: 0 } }, pointAt(4.99))
    ).toBe(0);
  });

  it('tests the facing on slopes, passes it on flat ground', () => {
    const north = { layer: 1, aspect: { direction: [0, -2] as [number, number], range: 45 } };
    expect(getTerrainRuleCoverageCPU(north, pointAt(0, 30, [0, -1]))).toBeCloseTo(1, 6);
    expect(getTerrainRuleCoverageCPU(north, pointAt(0, 30, [0, 1]))).toBeCloseTo(0, 6);
    // 50° off: 5° into the default 15° softness
    const off = pointAt(0, 30, [Math.sin(50 * DEG), -Math.cos(50 * DEG)]);
    expect(getTerrainRuleCoverageCPU(north, off)).toBeCloseTo(1 - smoothstep(45, 60, 50), 5);
    expect(getTerrainRuleCoverageCPU(north, pointAt(0, 0, [0, 1]))).toBe(1);
  });

  it('moves the coverage by the noise channel at (x, −z) / scale, × strength', () => {
    const rule = {
      layer: 1,
      height: { max: 0, softness: 1 },
      noise: { scale: 10, amount: 0.5 },
      strength: 0.8,
    };
    // Height 0.5: coverage 0.5. At u 0.25 (texel 0's centre), R 0: −0.5
    expect(getTerrainRuleCoverageCPU(rule, pointAt(0.5, 0, [1, 0], 2.5, -2.5), NOISE)).toBe(0);
    // At u 0.75: R 255, +0.5, × 0.8
    expect(getTerrainRuleCoverageCPU(rule, pointAt(0.5, 0, [1, 0], 7.5, -2.5), NOISE)).toBe(0.8);
    // Halfway, and repeating: u 1.5 is u 0.5, R 127.5
    expect(getTerrainRuleCoverageCPU(rule, pointAt(0.5, 0, [1, 0], 15, -2.5), NOISE)).toBeCloseTo(
      0.4,
      6
    );
    // G along v = −z / scale: v 0.75 is the second row, 255
    const green = { ...rule, noise: { scale: 10, amount: 0.5, channel: 'G' as const } };
    expect(getTerrainRuleCoverageCPU(green, pointAt(0.5, 0, [1, 0], 2.5, -7.5), NOISE)).toBe(0.8);
    expect(() => getTerrainRuleCoverageCPU(rule, pointAt(0))).toThrow(/texels/);
  });
});

describe('evaluateTerrainRulesCPU', () => {
  it('composites the rules in order, keeping the sum', () => {
    const rules = [
      { layer: 1, slope: { min: 20, softness: 0 } },
      { layer: 2, height: { min: 10, softness: 0 }, strength: 0.5 },
    ];
    expect(evaluateTerrainRulesCPU(rules, pointAt(0, 30), [1, 0, 0])).toEqual([0, 1, 0]);
    expect(evaluateTerrainRulesCPU(rules, pointAt(12, 30), [1, 0, 0])).toEqual([0, 0.5, 0.5]);
    const painted = evaluateTerrainRulesCPU(rules, pointAt(12, 0), new Float32Array([0.6, 0.4, 0]));
    expect(Array.from(painted)).toEqual([0.30000001192092896, 0.20000000298023224, 0.5]);
    expect(() => evaluateTerrainRulesCPU(rules, pointAt(0), [1, 0])).toThrow(/layer is 2/);
  });
});
