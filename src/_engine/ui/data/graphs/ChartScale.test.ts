import { describe, expect, it } from 'vitest';
import { formatTick, getNiceCeiling, getNiceStep, getNiceTicks } from './ChartScale';

describe('chart scale (p805 D9)', () => {
  it('picks a step of 1, 2, 2.5 or 5 times a power of ten, at least the span over the count', () => {
    expect(getNiceStep(10, 5)).toBe(2);
    expect(getNiceStep(12, 5)).toBe(2.5);
    expect(getNiceStep(26, 5)).toBe(10);
    expect(getNiceStep(0.9, 5)).toBe(0.2);
    expect(getNiceStep(4800, 5)).toBe(1000);
    expect(getNiceStep(0, 5)).toBe(1);
    expect(getNiceStep(NaN, 5)).toBe(1);
  });

  it('widens the range to the step and lists the ticks without float noise', () => {
    expect(getNiceTicks(3, 97)).toEqual({
      min: 0,
      max: 100,
      step: 20,
      values: [0, 20, 40, 60, 80, 100],
      decimals: 0,
    });
    const tenths = getNiceTicks(0.1, 0.7);
    expect(tenths.values).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(tenths.decimals).toBe(1);
    const quarters = getNiceTicks(0, 12);
    expect(quarters.values).toEqual([0, 2.5, 5, 7.5, 10, 12.5]);
    expect(quarters.decimals).toBe(1);
    expect(getNiceTicks(-23, 41).values).toEqual([-40, -20, 0, 20, 40, 60]);
    // An exact end stays the end
    expect(getNiceTicks(0, 10).max).toBe(10);
  });

  it('includes 0 for a baseline, and makes a range of nothing or one value', () => {
    expect(getNiceTicks(40, 90, { includeZero: true }).values).toEqual([0, 20, 40, 60, 80, 100]);
    expect(getNiceTicks(-8, -3, { includeZero: true }).max).toBe(0);
    expect(getNiceTicks(0, 0).values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(getNiceTicks(NaN, NaN)).toMatchObject({ min: 0, max: 1 });
    const one = getNiceTicks(50, 50);
    expect(one.min).toBeLessThan(50);
    expect(one.max).toBeGreaterThan(50);
    expect(getNiceTicks(50, 50, { includeZero: true })).toMatchObject({ min: 0, max: 50 });
    // Reversed ends are swapped
    expect(getNiceTicks(10, 0).values).toEqual([0, 2, 4, 6, 8, 10]);
    expect(getNiceTicks(0, 100, { count: 2 }).values).toEqual([0, 50, 100]);
  });

  it('grows a ceiling to the next nice number', () => {
    expect(getNiceCeiling(16.7)).toBe(20);
    expect(getNiceCeiling(21)).toBe(25);
    expect(getNiceCeiling(40)).toBe(50);
    expect(getNiceCeiling(100)).toBe(100);
    expect(getNiceCeiling(0.031)).toBe(0.05);
    expect(getNiceCeiling(0)).toBe(1);
  });

  it("writes a tick at its axis' decimals", () => {
    expect(formatTick(2.5, 1)).toBe('2.5');
    expect(formatTick(5, 1)).toBe('5.0');
    expect(formatTick(-0.0000001, 0)).toBe('0');
    expect(formatTick(1000, 0)).toBe('1000');
  });
});
