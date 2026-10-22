import { describe, expect, it } from 'vitest';
import { layoutAtlasCells } from './textureAtlases';

// p619 D14: the atlas layout (p299 D3): explicit rects checked, the rest shelf-packed on the
// alignment grid, and the mip levels the padding keeps apart

const cell = (
  label: string,
  contentSize: [number, number],
  rect?: [number, number, number, number]
) => ({
  label,
  contentSize,
  ...(rect ? { rect } : {}),
});

describe('layoutAtlasCells', () => {
  it('packs the cells tallest first on shelves, padded and on the grid', () => {
    // padding 4: level 2 kept apart, grid 4·2² = 16
    const { rects, levels, errors, warnings } = layoutAtlasCells([128, 128], 4, [
      cell('a', [40, 20]),
      cell('b', [20, 40]),
      cell('c', [100, 8]),
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(levels).toBe(3);
    // b (28×48 padded, 32×48 on the grid) first, a (48×28 → 48×32) beside it, then c
    // (108×16 → 112×16) on the next shelf
    expect(rects).toEqual([
      [32, 0, 48, 32],
      [0, 0, 32, 48],
      [0, 48, 112, 16],
    ]);
  });

  it('keeps an explicit rect where it is and packs around it', () => {
    const { rects, errors } = layoutAtlasCells([64, 64], 2, [
      cell('fixed', [12, 12], [0, 0, 16, 16]),
      cell('packed', [4, 4]),
    ]);
    expect(errors).toEqual([]);
    expect(rects).toEqual([
      [0, 0, 16, 16],
      [16, 0, 8, 8],
    ]);
  });

  it('names each cell with a problem', () => {
    const { rects, errors } = layoutAtlasCells([64, 64], 2, [
      cell('offGrid', [10, 10], [2, 0, 16, 16]),
      cell('outside', [10, 10], [56, 0, 16, 16]),
      cell('noRoom', [0, 0], [0, 0, 4, 4]),
      cell('first', [12, 12], [16, 16, 16, 16]),
      cell('overlap', [12, 12], [16, 16, 16, 16]),
      cell('huge', [100, 100]),
    ]);
    expect(errors).toEqual([
      expect.stringMatching(/^offGrid: rect \[2, 0, 16, 16\] isn't on the 4 px block grid/),
      expect.stringMatching(/^outside: rect .* reaches out of the 64×64 atlas/),
      expect.stringMatching(/^noRoom: .* has no room for content inside its padding/),
      expect.stringMatching(/^overlap: .* overlaps first's/),
      expect.stringMatching(/^huge: 104×104 px .* doesn't fit in the 64×64 atlas/),
    ]);
    expect(rects.map((rect) => !!rect)).toEqual([false, false, false, true, false, false]);
  });

  it('shortens the chain to what the size and the rects are aligned to, with a warning', () => {
    const { levels, warnings } = layoutAtlasCells([96, 96], 8, [cell('a', [8, 8])]);
    // padding 8 keeps 0-3 apart; 96 is aligned to 32 px (level 5), the grid to 32: level 3 stands
    expect(levels).toBe(4);
    expect(warnings).toEqual([]);
    const misaligned = layoutAtlasCells([64, 64], 8, [cell('a', [8, 8], [4, 4, 28, 28])]);
    expect(misaligned.levels).toBe(1);
    expect(misaligned.warnings).toEqual([
      expect.stringMatching(/^the mip chain stops at level 0 .* a's rect \[4, 4, 28, 28\]/),
    ]);
    const fullChain = layoutAtlasCells([64, 64], 8, [cell('a', [8, 8], [4, 4, 28, 28])], {
      mipChain: 'FULL',
    });
    expect(fullChain.warnings).toEqual([]);
  });
});
