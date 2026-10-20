import { describe, expect, test } from 'vitest';
import { selectLevel } from './LodSystem';

// Level 0 from screen size 0.5, level 1 from 0.2, level 2 below (its own screenSize isn't read)
const LEVELS = [{ screenSize: 0.5 }, { screenSize: 0.2 }, { screenSize: 0.05 }];

describe('selectLevel', () => {
  test('picks the finest level whose screenSize the size reaches on a first selection', () => {
    expect(selectLevel(LEVELS, 0.6, -1, 0.1)).toBe(0);
    expect(selectLevel(LEVELS, 0.5, -1, 0.1)).toBe(0);
    expect(selectLevel(LEVELS, 0.3, -1, 0.1)).toBe(1);
    expect(selectLevel(LEVELS, 0.01, -1, 0.1)).toBe(2);
  });

  test('moves to a finer level at its screenSize', () => {
    expect(selectLevel(LEVELS, 0.2, 2, 0.1)).toBe(1);
    expect(selectLevel(LEVELS, 0.5, 2, 0.1)).toBe(0);
  });

  test('moves to a coarser level only below screenSize × (1 - hysteresis)', () => {
    expect(selectLevel(LEVELS, 0.46, 0, 0.1)).toBe(0);
    expect(selectLevel(LEVELS, 0.44, 0, 0.1)).toBe(1);
    expect(selectLevel(LEVELS, 0.19, 1, 0.1)).toBe(1);
    expect(selectLevel(LEVELS, 0.17, 1, 0.1)).toBe(2);
  });

  test('skips levels on a large drop, holding the first one the band keeps', () => {
    expect(selectLevel(LEVELS, 0.1, 0, 0.1)).toBe(2);
    // Below level 0's band but inside level 1's
    expect(selectLevel(LEVELS, 0.19, 0, 0.1)).toBe(1);
  });

  test('without hysteresis, is the raw selection', () => {
    for (const s of [0.6, 0.49, 0.3, 0.19, 0.01]) {
      expect(selectLevel(LEVELS, s, 0, 0)).toBe(selectLevel(LEVELS, s, -1, 0));
    }
  });

  test('a single level is always selected', () => {
    expect(selectLevel([{ screenSize: 0.5 }], 0.01, -1, 0.1)).toBe(0);
    expect(selectLevel([{ screenSize: 0.5 }], 0.9, 0, 0.1)).toBe(0);
  });
});
