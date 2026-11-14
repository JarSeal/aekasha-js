import { describe, expect, it } from 'vitest';
import { getBakeSize, getBakedTextureMemoryBytes, getMipChainTexels } from './TextureBakeMemory';

describe('getMipChainTexels', () => {
  it('counts level 0 alone without mips', () => {
    expect(getMipChainTexels(256, 128, false)).toBe(256 * 128);
  });

  it('sums every level down to 1 × 1', () => {
    // 4×4 + 2×2 + 1×1
    expect(getMipChainTexels(4, 4, true)).toBe(21);
    // 8×2 + 4×1 + 2×1 + 1×1: the short side stays at 1
    expect(getMipChainTexels(8, 2, true)).toBe(23);
    // non power of two: 5×3 + 2×1 + 1×1
    expect(getMipChainTexels(5, 3, true)).toBe(18);
    expect(getMipChainTexels(1, 1, true)).toBe(1);
  });
});

describe('getBakedTextureMemoryBytes', () => {
  it('gives the plan figure for a 1K RGBA8 bake with mips (about 5.6 MB)', () => {
    const bytes = getBakedTextureMemoryBytes({ size: 1024, outputs: [{}] });
    expect(bytes).toBe(4 * 1398101);
    expect(bytes / 1e6).toBeCloseTo(5.59, 2);
  });

  it('doubles for HALF_FLOAT and adds up the outputs and layers', () => {
    const one = getBakedTextureMemoryBytes({ size: 64, outputs: [{}], mipmaps: false });
    expect(one).toBe(64 * 64 * 4);
    expect(
      getBakedTextureMemoryBytes({ size: 64, outputs: [{ type: 'HALF_FLOAT' }], mipmaps: false })
    ).toBe(2 * one);
    expect(
      getBakedTextureMemoryBytes({
        size: [64, 64],
        outputs: [{}, { type: 'UNSIGNED_BYTE' }, { type: 'HALF_FLOAT' }],
        layers: 4,
        mipmaps: false,
      })
    ).toBe(4 * (one + one + 2 * one));
  });

  it('is 0 without outputs', () => {
    expect(getBakedTextureMemoryBytes({ size: 16, outputs: [] })).toBe(0);
  });
});

describe('getBakeSize', () => {
  it('takes a number as a square and a pair as width and height', () => {
    expect(getBakeSize(32, 'test')).toEqual({ width: 32, height: 32 });
    expect(getBakeSize([64, 16], 'test')).toEqual({ width: 64, height: 16 });
  });

  it('refuses a side that is not a whole number of at least 1', () => {
    expect(() => getBakeSize(0, 'bakeTexture')).toThrow(/bakeTexture: size/);
    expect(() => getBakeSize([64, 1.5], 'bakeTexture')).toThrow(/whole numbers/);
    expect(() => getBakeSize(Number.NaN, 'bakeTexture')).toThrow();
  });
});
