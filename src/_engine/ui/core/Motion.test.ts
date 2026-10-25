import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMotionFactor } from './Motion';

/** A window whose getComputedStyle reports `value` as the element's --aek-motion */
const stubMotion = (value: string) =>
  vi.stubGlobal('window', {
    getComputedStyle: () => ({
      getPropertyValue: (name: string) => (name === '--aek-motion' ? value : ''),
    }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getMotionFactor', () => {
  const elem = {} as Element;

  it("reads the element's --aek-motion", () => {
    stubMotion('0');
    expect(getMotionFactor(elem)).toBe(0);
    stubMotion(' 0.5');
    expect(getMotionFactor(elem)).toBe(0.5);
  });

  it('is 1 when the property is unset, not a number or negative', () => {
    for (const value of ['', 'none', '-1']) {
      stubMotion(value);
      expect(getMotionFactor(elem)).toBe(1);
    }
  });

  it('is 1 without getComputedStyle (a DOM stand-in)', () => {
    vi.stubGlobal('window', {});
    expect(getMotionFactor(elem)).toBe(1);
  });
});
