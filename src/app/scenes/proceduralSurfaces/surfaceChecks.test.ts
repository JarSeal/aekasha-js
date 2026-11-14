import { describe, expect, it } from 'vitest';
import {
  checkLiveSurface,
  checkPeriodicity,
  checkSurfaceSlot,
  compareImages,
} from './surfaceChecks';

const SIZE = 8;

/** An RGBA8 image of SIZE² whose channel `c` at (x, y) is `value(x, y, c)` (a byte) */
const makeImage = (value: (x: number, y: number, c: number) => number) => {
  const bytes = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      for (let c = 0; c < 4; c++) bytes[(y * SIZE + x) * 4 + c] = value(x, y, c);
    }
  }
  return bytes;
};

/** A smooth periodic wave over the image: no seam */
const wave = (x: number, y: number) =>
  Math.round(128 + 60 * Math.sin((2 * Math.PI * x) / SIZE) * Math.cos((2 * Math.PI * y) / SIZE));

describe('checkSurfaceSlot', () => {
  it('passes a written LITE normalHeight: varying RG and height, A 1', () => {
    const image = makeImage((x, y, c) => (c === 3 ? 255 : wave(x + c, y)));
    expect(checkSurfaceSlot('normalHeight', image, SIZE).failures).toEqual([]);
  });

  it('fails a cleared slot (all zero), naming each channel', () => {
    const { failures } = checkSurfaceSlot(
      'normalHeight',
      makeImage(() => 0),
      SIZE
    );
    expect(failures).toEqual([
      "normalHeight.R doesn't vary (σ 0.000): not written, or flat",
      "normalHeight.G doesn't vary (σ 0.000): not written, or flat",
      "normalHeight.B doesn't vary (σ 0.000): not written, or flat",
      "normalHeight.A's mean 0.000 is outside 0.99–1",
    ]);
  });

  it("fails an ORM with metal, and a normal map that doesn't face out", () => {
    const orm = makeImage((x, y, c) => [wave(x, y), 200, 30, 255][c]);
    expect(checkSurfaceSlot('orm', orm, SIZE).failures).toEqual([
      "orm.B's mean 0.118 is outside 0–0.002",
    ]);
    const normal = makeImage((x, y, c) => [wave(x, y), wave(y, x), 128, 255][c]);
    expect(checkSurfaceSlot('normal', normal, SIZE).failures).toEqual([
      "normal.B's mean 0.502 is outside 0.75–1",
    ]);
  });

  it('fails a seam: a ramp that jumps back across the wrap', () => {
    const ramp = makeImage((x, _y, c) => (c === 3 ? 255 : x * 20 + c));
    const { failures } = checkSurfaceSlot('normalHeight', ramp, SIZE);
    expect(failures).toHaveLength(3);
    expect(failures[0]).toMatch(/^normalHeight.R has a seam: the wrap steps 0.549/);
  });

  it('refuses a slot no packing has', () => {
    expect(() =>
      checkSurfaceSlot(
        'albedo',
        makeImage(() => 0),
        SIZE
      )
    ).toThrow(/No rules/);
  });
});

describe('checkPeriodicity', () => {
  it('passes images within the tolerance, a few texels off allowed', () => {
    const texels = 2000;
    const bytes = new Uint8Array(texels * 4).fill(2);
    bytes[4 * 10] = 255;
    expect(checkPeriodicity([bytes], texels)).toEqual({ maxByte: 255, offTexels: 1, failures: [] });
  });

  it('fails when more than the share of the texels differ, counting a texel once', () => {
    const texels = 1000;
    const first = new Uint8Array(texels * 4);
    const second = new Uint8Array(texels * 4);
    for (let i = 0; i < 5; i++) {
      first[i * 4] = 50;
      second[i * 4 + 2] = 60;
    }
    const result = checkPeriodicity([first, second], texels);
    expect(result.offTexels).toBe(5);
    expect(result.failures[0]).toMatch(/^not periodic: 5 of 1000 texels differ .*\(up to 60 /);
  });
});

describe('compareImages', () => {
  it('finds equal readbacks equal, and counts a texel once for any channel off', () => {
    const image = makeImage(wave);
    expect(compareImages(image, image.slice())).toEqual({ maxByte: 0, offTexels: 0 });
    const other = image.slice();
    other[1] += 3;
    other[2] += 1;
    other[4 * 5 + 3] -= 2;
    expect(compareImages(image, other)).toEqual({ maxByte: 3, offTexels: 2 });
    expect(() => compareImages(image, image.slice(4))).toThrow('bytes against');
  });
});

describe('checkLiveSurface', () => {
  const surface = makeImage((x, y, c) => wave(x + c, y));
  const tapped = makeImage((x, y, c) => (c === 2 ? 240 : c === 3 ? 200 : wave(x + c, y)));

  it('passes a written surface that differs a tile away, its taps facing out', () => {
    const away = makeImage(() => 90);
    const result = checkLiveSurface({ surface, away, tapped }, SIZE);
    expect(result.awayShare).toBe(1);
    expect(result.normalZ).toBeCloseTo(240 / 255, 6);
    expect(result.failures).toEqual([]);
  });

  it('fails a surface that repeats, a flat one, and taps facing in or closed', () => {
    const same = makeImage(() => 0);
    const repeats = checkLiveSurface({ surface, away: same, tapped }, SIZE);
    expect(repeats.awayShare).toBe(0);
    expect(repeats.failures).toEqual([
      'live repeats: only 0 of 64 texels differ a whole tile away (a period left on?)',
    ]);
    const away = makeImage(() => 90);
    const flat = checkLiveSurface({ surface: same, away, tapped: same }, SIZE);
    expect(flat.failures).toEqual([
      "live albedo.R doesn't vary (σ 0.000)",
      "live albedo.G doesn't vary (σ 0.000)",
      "live albedo.B doesn't vary (σ 0.000)",
      "live height doesn't vary (σ 0.000)",
      "live taps' normal.R doesn't vary (σ 0.000)",
      "live taps' normal.G doesn't vary (σ 0.000)",
      "live taps' normal faces in: mean z 0.000",
      "live taps' AO is nearly closed: mean 0.000",
    ]);
  });
});
