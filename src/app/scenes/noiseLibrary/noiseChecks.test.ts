import { describe, expect, it } from 'vitest';
import {
  checkNoiseRow,
  getChannelMaxByte,
  getChannelStats,
  type ChannelStats,
} from './noiseChecks';

/** An RGBA8 image whose red channel is `value(x, y)` (a byte) */
const makeImage = (width: number, height: number, value: (x: number, y: number) => number) => {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) bytes[(y * width + x) * 4] = value(x, y);
  }
  return bytes;
};

const stats = (overrides: Partial<ChannelStats>): ChannelStats => ({
  mean: 0.5,
  std: 0.2,
  min: 0,
  max: 1,
  neighbourStep: 0.05,
  wrapStep: 0.04,
  ...overrides,
});

describe('getChannelStats', () => {
  it('sums a channel up: mean, spread, range, the steps inside and across the wrap', () => {
    // A ramp along x: 0, 51, 102, 153 (steps of 0.2), the same on every row
    const result = getChannelStats(
      makeImage(4, 2, (x) => x * 51),
      4,
      2,
      0
    );
    expect(result.mean).toBeCloseTo(0.3);
    expect(result.std).toBeCloseTo(Math.sqrt(0.05));
    expect(result.min).toBe(0);
    expect(result.max).toBeCloseTo(0.6);
    expect(result.neighbourStep).toBeCloseTo(0.2);
    // The first column against the last: 0 against 0.6
    expect(result.wrapStep).toBeCloseTo(0.6);
  });

  it('refuses bytes that aren’t the image’s', () => {
    expect(() => getChannelStats(new Uint8Array(10), 4, 2, 0)).toThrow(/isn't a 4 × 2 RGBA8/);
  });

  it('finds a channel’s largest byte', () => {
    expect(
      getChannelMaxByte(
        makeImage(3, 3, (x, y) => x + y * 10),
        0
      )
    ).toBe(22);
    expect(
      getChannelMaxByte(
        makeImage(3, 3, () => 7),
        1
      )
    ).toBe(0);
  });
});

describe('checkNoiseRow', () => {
  it('passes a periodic bake that tiles, repeats and matches the plain one', () => {
    expect(checkNoiseRow(stats({}), stats({ mean: 0.52, std: 0.21 }), 1).failures).toEqual([]);
  });

  it('names each failure', () => {
    const { failures } = checkNoiseRow(
      stats({ wrapStep: 0.3 }),
      stats({ mean: 0.6, std: 0.3 }),
      40
    );
    expect(failures).toHaveLength(4);
    expect(failures[0]).toMatch(/a seam/);
    expect(failures[1]).toMatch(/not periodic/);
    expect(failures[2]).toMatch(/the means differ/);
    expect(failures[3]).toMatch(/the spreads differ/);
  });
});
