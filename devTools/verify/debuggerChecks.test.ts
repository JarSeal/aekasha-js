import { describe, expect, it } from 'vitest';
import {
  findAxeFailures,
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

describe('findAxeFailures', () => {
  it('fails every violation, a line per rule on a root', () => {
    expect(
      findAxeFailures({
        'drawer.stats': { label: 2, 'color-contrast': 1 },
        'window.about': {},
      })
    ).toEqual(['axe drawer.stats: label ×2', 'axe drawer.stats: color-contrast ×1']);
  });

  it('passes roots without violations', () => {
    expect(findAxeFailures({ 'window.about': {}, 'drawer.loop': { label: 0 } })).toEqual([]);
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
