import { describe, expect, it } from 'vitest';
import { type CheckpointStates, findCheckpointProblems } from './instanceStressLodTabChecks';

// Force off comes back from level 1: the hysteresis keeps some of level 2's at level 1
const forceOff = { levels: [960, 6_484, 12_556], fading: 0 };
const good: CheckpointStates = {
  settled: { levels: [960, 5_429, 13_611], fading: 0 },
  heldAt0: { levels: [960, 20_000, 13_611], fading: 14_571 },
  heldAtHalf: { levels: [960, 20_000, 13_611], fading: 14_571 },
  forcedLevel1: { levels: [0, 20_000, 0], fading: 0 },
  forceOff,
  frozenOrbit: forceOff,
};

describe('the LOD tab check (p354 Phase 2 step 3)', () => {
  it('passes the same states on both paths, each as its setting means', () => {
    expect(findCheckpointProblems(good, good)).toEqual([]);
  });

  it('names a checkpoint whose paths differ, and one a path never reached', () => {
    const set = { ...good, heldAtHalf: { levels: [960, 20_000, 13_611], fading: 14_570 } };
    delete set.frozenOrbit;
    expect(findCheckpointProblems(good, set)).toEqual([
      'heldAtHalf: the pools 960 / 20,000 / 13,611, 14,571 fading, the set 960 / 20,000 / 13,611, 14,570 fading',
      'frozenOrbit: not reached on the set path',
    ]);
  });

  it("names a forced level that didn't take, a freeze that didn't hold and a fade that never started", () => {
    const bad: CheckpointStates = {
      ...good,
      heldAt0: { levels: [0, 20_000, 0], fading: 0 },
      forcedLevel1: { levels: [100, 19_900, 0], fading: 0 },
      frozenOrbit: { levels: [900, 5_489, 13_611], fading: 0 },
    };
    expect(findCheckpointProblems(bad, bad)).toEqual([
      'forcedLevel1 (pools): not every instance at level 1 (100 / 19,900 / 0, 0 fading)',
      'frozenOrbit (pools): 900 / 5,489 / 13,611, 0 fading, before the freeze 960 / 6,484 / 12,556, 0 fading',
      'heldAt0 (pools): nothing fading',
      'forcedLevel1 (set): not every instance at level 1 (100 / 19,900 / 0, 0 fading)',
      'frozenOrbit (set): 900 / 5,489 / 13,611, 0 fading, before the freeze 960 / 6,484 / 12,556, 0 fading',
      'heldAt0 (set): nothing fading',
    ]);
  });
});
