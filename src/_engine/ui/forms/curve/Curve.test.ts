import { describe, expect, it } from 'vitest';
import {
  evaluateCurve,
  getCurvePreset,
  isBezierCurve,
  type CurveBezier,
  type CurveKey,
} from './Curve';

/** A cubic-bezier's y at x by plain bisection on t: the reference the solver is checked against */
const referenceBezier = ([x1, y1, x2, y2]: CurveBezier, x: number) => {
  const at = (p1: number, p2: number, t: number) =>
    3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (at(x1, x2, mid) < x) low = mid;
    else high = mid;
  }
  return at(y1, y2, (low + high) / 2);
};

const SAMPLES = [0, 0.05, 0.1, 0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 0.99, 1];

describe('evaluateCurve (p804 D8)', () => {
  it('an easing is CSS’s cubic-bezier, to 6 digits at any x, clamped to 0-1', () => {
    const curves: CurveBezier[] = [
      [0.25, 0.1, 0.25, 1],
      [0.42, 0, 1, 1],
      [0, 0, 0.58, 1],
      [0.42, 0, 0.58, 1],
      [0.68, -0.6, 0.32, 1.6],
      [0, 1, 1, 0],
      [0.9, 0.1, 0.1, 0.9],
    ];
    for (const curve of curves) {
      for (const x of SAMPLES) {
        expect(evaluateCurve(curve, x)).toBeCloseTo(referenceBezier(curve, x), 6);
      }
      expect(evaluateCurve(curve, -1)).toBeCloseTo(0, 9);
      expect(evaluateCurve(curve, 2)).toBeCloseTo(1, 9);
    }
    // The x's are clamped to 0-1, as CSS requires
    // (off the middle: x'(t) is 0 there, where a bisection's t loses its digits)
    expect(evaluateCurve([1.5, 0, -1, 1], 0.3)).toBeCloseTo(referenceBezier([1, 0, 0, 1], 0.3), 6);
  });

  it('keys without tangents are straight lines, flat past the ends, in any order', () => {
    const keys: CurveKey[] = [
      { x: 10, y: 0 },
      { x: 0, y: 1 },
      { x: 4, y: 2 },
    ];
    expect(evaluateCurve(keys, -5)).toBe(1);
    expect(evaluateCurve(keys, 2)).toBeCloseTo(1.5, 12);
    expect(evaluateCurve(keys, 4)).toBe(2);
    expect(evaluateCurve(keys, 7)).toBeCloseTo(1, 12);
    expect(evaluateCurve(keys, 20)).toBe(0);
    expect(evaluateCurve([], 0.5)).toBe(0);
    expect(evaluateCurve([{ x: 3, y: 7 }], 0)).toBe(7);
  });

  it('two keys at one x are a step: the later one’s value at it', () => {
    const keys: CurveKey[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
    ];
    expect(evaluateCurve(keys, 0.5)).toBeCloseTo(0.5, 12);
    expect(evaluateCurve(keys, 1)).toBe(5);
    expect(evaluateCurve(keys, 1.5)).toBe(5);
  });

  it('tangents shape the segment (a cubic Hermite), each side its own', () => {
    // Flat at both ends: smoothstep, scaled to the segment
    const keys: CurveKey[] = [
      { x: 2, y: 10, outTangent: 0 },
      { x: 4, y: 20, inTangent: 0 },
    ];
    for (const u of SAMPLES) {
      expect(evaluateCurve(keys, 2 + u * 2)).toBeCloseTo(10 + 10 * (3 * u * u - 2 * u * u * u), 9);
    }
    // One side only: the other is the straight slope
    const half: CurveKey[] = [
      { x: 0, y: 0, outTangent: 0 },
      { x: 1, y: 1 },
    ];
    // y = 3t² - 2t³ + (t³ - t²) · 1 = 2t² - t³
    expect(evaluateCurve(half, 0.5)).toBeCloseTo(0.375, 12);
  });
});

describe('getCurvePreset (p804 D8)', () => {
  it('each preset is the same curve as an easing and as keys, where both are exact', () => {
    const exact = {
      linear: (x: number) => x,
      smoothstep: (x: number) => 3 * x * x - 2 * x * x * x,
    };
    for (const [name, f] of Object.entries(exact)) {
      const bezier = getCurvePreset(name as keyof typeof exact, 'bezier');
      const keys = getCurvePreset(name as keyof typeof exact, 'keys');
      for (const x of SAMPLES) {
        expect(evaluateCurve(bezier, x)).toBeCloseTo(f(x), 6);
        expect(evaluateCurve(keys, x)).toBeCloseTo(f(x), 12);
      }
    }
  });

  it('as keys the easings are the quadratic ones; as an easing CSS’s keywords', () => {
    for (const x of SAMPLES) {
      expect(evaluateCurve(getCurvePreset('easeIn', 'keys'), x)).toBeCloseTo(x * x, 12);
      expect(evaluateCurve(getCurvePreset('easeOut', 'keys'), x)).toBeCloseTo(
        1 - (1 - x) * (1 - x),
        12
      );
      const inOut = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
      expect(evaluateCurve(getCurvePreset('easeInOut', 'keys'), x)).toBeCloseTo(inOut, 12);
    }
    expect(getCurvePreset('easeIn', 'bezier')).toEqual([0.42, 0, 1, 1]);
    expect(getCurvePreset('easeOut', 'bezier')).toEqual([0, 0, 0.58, 1]);
    expect(getCurvePreset('easeInOut', 'bezier')).toEqual([0.42, 0, 0.58, 1]);
  });

  it('a new value each call, its shape the mode’s', () => {
    const a = getCurvePreset('easeIn', 'keys');
    a[0].y = 5;
    expect(getCurvePreset('easeIn', 'keys')[0].y).toBe(0);
    expect(isBezierCurve(getCurvePreset('linear', 'bezier'))).toBe(true);
    expect(isBezierCurve(getCurvePreset('linear', 'keys'))).toBe(false);
    expect(isBezierCurve([])).toBe(false);
  });
});
