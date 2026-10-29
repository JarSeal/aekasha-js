import { describe, expect, it } from 'vitest';
import {
  compareAxeCounts,
  debuggerShotFile,
  diffTabOrders,
  formatValue,
  isSameValue,
} from './debuggerChecks';

describe('diffTabOrders', () => {
  const base = { DRAWER: ['stats', 'loop', 'sky'], PROFILER: ['overview', 'settings'] };

  it('finds no change in the same order', () => {
    expect(diffTabOrders(base, structuredClone(base))).toEqual([]);
  });

  it('names an added and a removed tab per host', () => {
    expect(
      diffTabOrders(base, { DRAWER: ['stats', 'sky', 'boxes'], PROFILER: base.PROFILER })
    ).toEqual(['DRAWER: added boxes; removed loop']);
  });

  it('names a reorder with both orders', () => {
    expect(
      diffTabOrders(base, { DRAWER: ['loop', 'stats', 'sky'], PROFILER: base.PROFILER })
    ).toEqual(['DRAWER: reordered to loop, stats, sky (was stats, loop, sky)']);
  });
});

describe('compareAxeCounts', () => {
  it('fails a rule that grew on a root, and notes one that shrank', () => {
    const { failures, notes } = compareAxeCounts(
      { 'drawer.stats': { label: 10, 'color-contrast': 2 } },
      { 'drawer.stats': { label: 4, 'button-name': 1 } }
    );
    expect(failures).toEqual(['axe drawer.stats: button-name ×1, baseline ×0']);
    expect(notes).toEqual([
      'axe drawer.stats: label ×4, baseline ×10',
      'axe drawer.stats: color-contrast ×0, baseline ×2',
    ]);
  });

  it("notes a root without a baseline as `no baseline` (the run's NEW status)", () => {
    const { failures, notes } = compareAxeCounts({}, { 'window.about': {} });
    expect(failures).toEqual([]);
    expect(notes).toEqual(['no baseline axe counts for window.about (none)']);
    expect(compareAxeCounts(undefined, { x: { label: 1 } }).notes[0]).toMatch(/^no baseline/);
  });
});

describe('debuggerShotFile', () => {
  it('keeps a shot per scene, its name made file-safe', () => {
    expect(debuggerShotFile('space', 'window.day night/1')).toBe(
      'debugger/space/window.day-night-1.png'
    );
  });
});

describe('isSameValue / formatValue', () => {
  it('compares read values as JSON', () => {
    expect(isSameValue({ x: 1 }, { x: 1 })).toBe(true);
    expect(isSameValue(null, undefined)).toBe(false);
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue('x'.repeat(200))).toHaveLength(118);
  });
});
