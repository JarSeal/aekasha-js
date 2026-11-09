import { describe, expect, test } from 'vitest';
import { createInstanceRanges } from './InstanceRanges';

// p354 Phase 5 step 1: an instance set's ranges, the live ones and the free list (D1).

/** Every index's owner: the live range's start, or -1 free. Checks no two ranges overlap. */
const ownersOf = (ranges: ReturnType<typeof createInstanceRanges>, capacity: number) => {
  const owners = new Array<number>(capacity).fill(-1);
  ranges.forEachLive((start, count) => {
    for (let i = start; i < start + count; i++) {
      expect(owners[i], `index ${i} in two live ranges`).toBe(-1);
      owners[i] = start;
    }
  });
  return owners;
};

describe('createInstanceRanges', () => {
  test('appends at the end, up to the capacity', () => {
    const ranges = createInstanceRanges(10);
    expect(ranges.take(4)).toBe(0);
    expect(ranges.take(3)).toBe(4);
    expect(ranges.end).toBe(7);
    expect(ranges.count).toBe(7);
    expect(ranges.take(4)).toBe(-1);
    expect(ranges.take(3)).toBe(7);
    expect(ranges.end).toBe(10);
    expect(ranges.take(1)).toBe(-1);
  });

  test('a removed range is taken again by an add of its size or smaller, first fit', () => {
    const ranges = createInstanceRanges(100);
    const a = ranges.take(10);
    ranges.take(10);
    const c = ranges.take(5);
    ranges.take(10);
    expect(ranges.release(a, 10)).toBe(true);
    expect(ranges.release(c, 5)).toBe(true);
    expect(ranges.getFree()).toEqual([
      { start: 0, count: 10 },
      { start: 20, count: 5 },
    ]);
    // Too large for either: the end
    expect(ranges.take(11)).toBe(35);
    // The first that fits: the lowest
    expect(ranges.take(4)).toBe(0);
    expect(ranges.getFree()).toEqual([
      { start: 4, count: 6 },
      { start: 20, count: 5 },
    ]);
    expect(ranges.take(6)).toBe(4);
    expect(ranges.take(5)).toBe(20);
    expect(ranges.getFree()).toEqual([]);
    expect(ranges.count).toBe(46);
  });

  test('a removed range merges with the free ranges next to it', () => {
    const ranges = createInstanceRanges(100);
    const starts = [0, 1, 2, 3, 4].map(() => ranges.take(10));
    ranges.release(starts[1], 10);
    ranges.release(starts[3], 10);
    expect(ranges.getFree()).toEqual([
      { start: 10, count: 10 },
      { start: 30, count: 10 },
    ]);
    // Between two free ones: one run
    ranges.release(starts[2], 10);
    expect(ranges.getFree()).toEqual([{ start: 10, count: 30 }]);
    ranges.release(starts[0], 10);
    expect(ranges.getFree()).toEqual([{ start: 0, count: 40 }]);
    expect(ranges.take(35)).toBe(0);
  });

  test('a removed range at the end lowers it, with the free ranges it then touches', () => {
    const ranges = createInstanceRanges(100);
    const starts = [0, 1, 2, 3].map(() => ranges.take(10));
    ranges.release(starts[2], 10);
    expect(ranges.end).toBe(40);
    ranges.release(starts[3], 10);
    expect(ranges.end).toBe(20);
    expect(ranges.getFree()).toEqual([]);
    ranges.release(starts[0], 10);
    ranges.release(starts[1], 10);
    expect(ranges.end).toBe(0);
    expect(ranges.count).toBe(0);
    expect(ranges.getFree()).toEqual([]);
  });

  test('frees only a live range, exactly as it was taken', () => {
    const ranges = createInstanceRanges(100);
    const a = ranges.take(10);
    ranges.take(10);
    expect(ranges.release(a, 5)).toBe(false);
    expect(ranges.release(a + 1, 9)).toBe(false);
    expect(ranges.release(50, 10)).toBe(false);
    expect(ranges.release(a, 10)).toBe(true);
    expect(ranges.release(a, 10)).toBe(false);
    expect(ranges.count).toBe(10);
  });

  test('cells loading and unloading in turns: no overlap, and no growth past the first lap', () => {
    const capacity = 1000;
    const ranges = createInstanceRanges(capacity);
    // Cells of different sizes, about a third loaded at once, the same cells lap after lap
    const sizes = Array.from({ length: 30 }, (_, i) => 5 + ((i * 7) % 11));
    const loaded = new Map<number, number>();
    let firstLapEnd = 0;
    for (let lap = 0; lap < 5; lap++) {
      for (let cell = 0; cell < sizes.length; cell++) {
        const start = ranges.take(sizes[cell]);
        expect(start).toBeGreaterThanOrEqual(0);
        loaded.set(cell, start);
        const leaving = (cell + sizes.length - 10) % sizes.length;
        if (loaded.has(leaving) && (lap > 0 || cell >= 10)) {
          expect(ranges.release(loaded.get(leaving)!, sizes[leaving])).toBe(true);
          loaded.delete(leaving);
        }
        const owners = ownersOf(ranges, capacity);
        // Every live index is below the end, and the end is a live range's
        expect(owners.slice(ranges.end).every((owner) => owner === -1)).toBe(true);
        if (ranges.end > 0) expect(owners[ranges.end - 1]).not.toBe(-1);
      }
      if (lap === 0) firstLapEnd = ranges.end;
      else expect(ranges.end).toBeLessThanOrEqual(firstLapEnd + Math.max(...sizes));
    }
    expect(ranges.count).toBe([...loaded.keys()].reduce((sum, cell) => sum + sizes[cell], 0));
  });
});
