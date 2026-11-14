import { describe, expect, it } from 'vitest';
import { checkMacroNoise, checkRippleAtlas, getNeighbourCorrelation } from './sharedTextureChecks';

/** An RGBA8 image from `texel(x, y)`'s four bytes */
const makeImage = (size: number, texel: (x: number, y: number) => number[]) => {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) bytes.set(texel(x, y), (y * size + x) * 4);
  }
  return bytes;
};

/** A smooth wave that tiles over `size`, 0..255 */
const wave = (x: number, y: number, size: number) =>
  Math.round(
    127.5 + 127.5 * Math.sin((2 * Math.PI * x) / size) * Math.cos((2 * Math.PI * y) / size)
  );
const checker = (x: number, y: number) => ((x + y) % 2 ? 190 : 65);

describe('getNeighbourCorrelation', () => {
  it('is −1 for a checker, inside and across an even wrap, and 0 for a flat channel', () => {
    const image = makeImage(8, (x, y) => [checker(x, y), 9, 0, 0]);
    const { inside, wrap } = getNeighbourCorrelation(image, 8, 8, 0);
    expect(inside).toBeCloseTo(-1);
    expect(wrap).toBeCloseTo(-1);
    expect(getNeighbourCorrelation(image, 8, 8, 1)).toEqual({ inside: 0, wrap: 0 });
  });

  it('is near 1 for a smooth channel', () => {
    const image = makeImage(32, (x, y) => [wave(x, y, 32), 0, 0, 0]);
    expect(getNeighbourCorrelation(image, 32, 32, 0).inside).toBeGreaterThan(0.9);
  });
});

describe('checkMacroNoise', () => {
  const size = 32;
  const good = (x: number, y: number) => [
    wave(x, y, size),
    wave(x + 5, y, size),
    wave(x, y + 9, size),
    checker(x, y),
  ];

  it('passes smooth tiling channels and a blue-ish alpha', () => {
    const result = checkMacroNoise(makeImage(size, good), size);
    expect(result.failures).toEqual([]);
    expect(result.figures['A neighbours']).toBeCloseTo(-1);
  });

  it('names a seam, a flat channel, an off mean and an alpha that is not blue-ish', () => {
    const ramp = (x: number) => Math.round((x / (size - 1)) * 255);
    const result = checkMacroNoise(
      makeImage(size, (x, y) => [ramp(x), 128, 20 + (wave(x, y, size) >> 3), wave(x, y, size)]),
      size
    );
    expect(result.failures).toEqual([
      expect.stringMatching(/^R: a seam: the wrap steps 1.000/),
      expect.stringMatching(/^G: flat/),
      expect.stringMatching(/^B: its mean is 0.1\d\d, not about 0.5/),
      expect.stringMatching(/^B: flat/),
      expect.stringMatching(/^A: not blue-ish/),
    ]);
  });
});

describe('checkRippleAtlas', () => {
  const size = 32;
  const cells = 2;
  const cell = size / cells;
  /** A drop on each cell's middle texel, reaching 6 texels; `flip` turns the directions inwards */
  const atlas =
    (opts: { flip?: boolean; reach?: number; sameTimes?: boolean } = {}) =>
    (x: number, y: number) => {
      const dx = (x % cell) - cell / 2;
      const dy = (y % cell) - cell / 2;
      const distance = Math.hypot(dx, dy);
      const mask = Math.max(0, 1 - distance / (opts.reach ?? 6));
      const sign = opts.flip ? -1 : 1;
      const direction = (d: number) =>
        mask > 0 ? Math.round(127.5 + (127.5 * sign * d) / Math.max(distance, 1e-5)) : 128;
      const index = Math.floor(x / cell) + Math.floor(y / cell) * cells;
      return [
        direction(dx),
        direction(dy),
        Math.round(mask * 255),
        opts.sameTimes ? 7 : index * 60,
      ];
    };

  it('passes drops inside their cells with outward directions and their own times', () => {
    const result = checkRippleAtlas(makeImage(size, atlas()), size, cells);
    expect(result.failures).toEqual([]);
    expect(result.figures['time offsets']).toBe(4);
    expect(result.figures['mask on borders']).toBe(0);
  });

  it('names a cut ring, inward directions and shared times', () => {
    expect(checkRippleAtlas(makeImage(size, atlas({ reach: 12 })), size, cells).failures).toEqual([
      expect.stringMatching(/on a cell's border: a ring is cut/),
    ]);
    expect(checkRippleAtlas(makeImage(size, atlas({ flip: true })), size, cells).failures).toEqual([
      expect.stringMatching(/only 0.000 of a cell's ring texels point away/),
    ]);
    expect(
      checkRippleAtlas(makeImage(size, atlas({ sameTimes: true })), size, cells).failures
    ).toEqual([expect.stringMatching(/the 4 cells have only 1 time offsets/)]);
  });

  it('names an empty cell and a time that changes inside a cell', () => {
    const result = checkRippleAtlas(
      makeImage(size, (x, y) => (x < cell && y < cell ? [128, 128, 0, x] : atlas()(x, y))),
      size,
      cells
    );
    expect(result.failures).toEqual([
      expect.stringMatching(/a cell's mask peaks at 0.000: no drop in it/),
      expect.stringMatching(/texels' time offset isn't their cell's/),
    ]);
  });
});
