import { describe, expect, it } from 'vitest';
import {
  constrainNumber,
  createValueFormatter,
  formatNumber,
  getDecimalDigits,
  getShownDecimals,
  roundToDecimals,
} from './ValueText';

describe('a number’s decimals (p804 D6)', () => {
  it('counts them as Tweakpane does, at most 10', () => {
    expect(getDecimalDigits(1)).toBe(0);
    expect(getDecimalDigits(0.01)).toBe(2);
    expect(getDecimalDigits(0.25)).toBe(2);
    expect(getDecimalDigits(-1.5)).toBe(1);
    expect(getDecimalDigits(Math.PI / 8)).toBe(10);
    expect(getDecimalDigits(1e-12)).toBe(0);
    expect(getDecimalDigits(1e21)).toBe(0);
    expect(getDecimalDigits(NaN)).toBe(0);
  });

  it('shows precision’s, else the step’s, else the value’s and at least 2', () => {
    expect(getShownDecimals({ step: 0.01 }, 1)).toBe(2);
    expect(getShownDecimals({ step: 1 }, 1.234)).toBe(0);
    expect(getShownDecimals({ step: 0.01, precision: 4 }, 1)).toBe(4);
    expect(getShownDecimals({}, 1)).toBe(2);
    expect(getShownDecimals({}, 1.2345)).toBe(4);
  });
});

describe('rounding and the step grid (p804 D6)', () => {
  it('rounds float noise away, halves away from zero', () => {
    expect(roundToDecimals(1.0999999999999999, 1)).toBe(1.1);
    expect(roundToDecimals(2.5000000000000004, 1)).toBe(2.5);
    expect(roundToDecimals(1.005, 2)).toBe(1.01);
    expect(roundToDecimals(-1.25, 1)).toBe(-1.3);
    expect(Object.is(roundToDecimals(-0.001, 2), 0)).toBe(true);
    expect(roundToDecimals(Infinity, 2)).toBe(Infinity);
  });

  it('writes 1 + 0.1 as 1.1, and a typed 2.5 on a grid from 0.1 as 2.5 (Phase 0’s noise)', () => {
    expect(constrainNumber(1 + 0.1, { step: 0.1 })).toBe(1.1);
    expect(constrainNumber(2.5, { min: 0.1, step: 0.1 })).toBe(2.5);
  });

  it('snaps to the grid from min, else from 0', () => {
    expect(constrainNumber(0.37, { step: 0.25 })).toBe(0.25);
    expect(constrainNumber(0.38, { step: 0.25 })).toBe(0.5);
    expect(constrainNumber(1.2, { min: 0.1, step: 0.5 })).toBe(1.1);
    expect(constrainNumber(7, { step: 0 })).toBe(7);
  });

  it('clamps to the range, keeping an end off the grid', () => {
    expect(constrainNumber(-3, { min: 0, max: 10, step: 1 })).toBe(0);
    expect(constrainNumber(12, { min: 0, max: 10, step: 1 })).toBe(10);
    // The rounding takes max's decimals too, so the clamp to 1.05 survives it
    expect(constrainNumber(2, { min: 0, max: 1.05, step: 0.1 })).toBe(1.05);
    expect(constrainNumber(5, { min: 1 })).toBe(5);
  });

  it('wraps at the range with wrap', () => {
    expect(constrainNumber(190, { min: -180, max: 180, step: 1, wrap: true })).toBe(-170);
    expect(constrainNumber(-190, { min: -180, max: 180, step: 1, wrap: true })).toBe(170);
    expect(constrainNumber(180, { min: -180, max: 180, wrap: true })).toBe(-180);
    expect(constrainNumber(725.5, { min: 0, max: 360, step: 0.5, wrap: true })).toBe(5.5);
  });

  it('keeps a value without rules as it is, up to 10 decimals', () => {
    expect(constrainNumber(1 / 3, {})).toBe(0.3333333333);
    expect(constrainNumber(1.5, { precision: 0 })).toBe(2);
  });
});

describe('the value’s text (p804 D6)', () => {
  it('writes the shown decimals, never -0', () => {
    expect(formatNumber(1.5, 2)).toBe('1.50');
    expect(formatNumber(-0, 2)).toBe('0.00');
    expect(createValueFormatter({ step: 0.01 }).getText(0.5)).toBe('0.50');
    expect(createValueFormatter({ step: 0.01, precision: 3 }).getText(0.5)).toBe('0.500');
    const free = createValueFormatter({});
    expect(free.getText(3)).toBe('3.00');
    expect(free.getText(1.2345)).toBe('1.2345');
  });

  it('takes format’s text instead, and says the unit', () => {
    const options = { step: 1, unit: 'ms', format: (v: number) => `${v}!` };
    const formatted = createValueFormatter(options);
    expect(formatted.getText(5)).toBe('5!');
    expect(formatted.getSpokenText('5!')).toBe('5! ms');
    const plain = createValueFormatter({ step: 1 });
    expect(plain.getSpokenText(plain.getText(5))).toBe('5');
  });
});
