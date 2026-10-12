import { describe, expect, it } from 'vitest';
import { diffSystemOrders } from './systemOrder';

describe('diffSystemOrders', () => {
  const baseline = { default: { MAIN: ['a@0', 'b@0'], APP_LOGIC: ['c@1', 'd@0'] } };

  it('finds nothing in the same order', () => {
    expect(diffSystemOrders(baseline, structuredClone(baseline))).toEqual([]);
  });

  it('names the first place a stage differs', () => {
    const current = { default: { MAIN: ['b@0', 'a@0'], APP_LOGIC: ['c@1', 'd@0'] } };
    expect(diffSystemOrders(baseline, current)).toEqual([
      'default MAIN: #1 is b@0, was a@0 (now b@0 → a@0)',
    ]);
  });

  it('names added and removed systems, stages and worlds', () => {
    const current = {
      default: { MAIN: ['a@0', 'e@0'], LATE_MAIN: ['f@0'] },
      other: { MAIN: ['a@0'] },
    };
    expect(diffSystemOrders(baseline, current)).toEqual([
      'default MAIN: added e@0; removed b@0',
      'default APP_LOGIC: removed c@1, d@0',
      'default LATE_MAIN: added f@0',
      'world "other" is new',
    ]);
  });
});
