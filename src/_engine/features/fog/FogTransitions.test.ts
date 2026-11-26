import { describe, expect, it } from 'vitest';
import {
  createFogTransitions,
  FOG_CHANNEL,
  FOG_CHANNEL_COUNT,
  snapFogTransitions,
  startFogTransitions,
  stepFogTransitions,
} from './FogTransitions';

/** Every channel at `value`, but `overrides`' channels. */
const targetsOf = (value: number, overrides: Record<number, number> = {}) => {
  const targets = new Array<number>(FOG_CHANNEL_COUNT).fill(value);
  for (const [i, v] of Object.entries(overrides)) targets[Number(i)] = v;
  return targets;
};

const { NEAR, FAR, COLOR_R } = FOG_CHANNEL;

describe('the fog transitions', () => {
  it('snap every channel to its target, nothing moving', () => {
    const tr = createFogTransitions();
    snapFogTransitions(tr, targetsOf(3));
    expect([...tr.values]).toEqual(targetsOf(3));
    expect(stepFogTransitions(tr, 1)).toBe(false);
  });

  it('move a changed channel linearly and end on its target', () => {
    const tr = createFogTransitions();
    snapFogTransitions(tr, targetsOf(0));
    startFogTransitions(tr, targetsOf(0, { [NEAR]: 10 }), 2);
    expect(tr.values[NEAR]).toBe(0);
    expect(stepFogTransitions(tr, 0.5)).toBe(true);
    expect(tr.values[NEAR]).toBe(2.5);
    stepFogTransitions(tr, 1);
    expect(tr.values[NEAR]).toBe(7.5);
    stepFogTransitions(tr, 1);
    expect(tr.values[NEAR]).toBe(10);
    expect(stepFogTransitions(tr, 1)).toBe(false);
    // The others never moved
    expect(tr.values[FAR]).toBe(0);
  });

  it('set at once without a time (0, negative, not finite)', () => {
    const tr = createFogTransitions();
    snapFogTransitions(tr, targetsOf(0));
    for (const sec of [0, -1, NaN, Infinity]) {
      startFogTransitions(tr, targetsOf(0, { [NEAR]: sec === 0 ? 1 : tr.values[NEAR] + 1 }), sec);
      expect(tr.isActive[NEAR]).toBe(0);
    }
    expect(tr.values[NEAR]).toBe(4);
  });

  it('let the latest call win per channel, from where it is', () => {
    const tr = createFogTransitions();
    snapFogTransitions(tr, targetsOf(0));
    startFogTransitions(tr, targetsOf(0, { [NEAR]: 10, [COLOR_R]: 1 }), 10);
    stepFogTransitions(tr, 5);
    // A new near over 1 s, from 5; the colour's target unchanged, so it keeps its 10 s
    startFogTransitions(tr, targetsOf(0, { [NEAR]: 0, [COLOR_R]: 1 }), 1);
    stepFogTransitions(tr, 0.5);
    expect(tr.values[NEAR]).toBeCloseTo(2.5);
    expect(tr.values[COLOR_R]).toBeCloseTo(0.55);
    stepFogTransitions(tr, 0.5);
    expect(tr.values[NEAR]).toBe(0);
    expect(tr.isActive[COLOR_R]).toBe(1);
    // A snap ends every transition
    snapFogTransitions(tr, tr.targets);
    expect(tr.values[COLOR_R]).toBe(1);
    expect(stepFogTransitions(tr, 1)).toBe(false);
  });

  it('step nothing on a zero or negative time', () => {
    const tr = createFogTransitions();
    snapFogTransitions(tr, targetsOf(0));
    startFogTransitions(tr, targetsOf(0, { [NEAR]: 10 }), 2);
    expect(stepFogTransitions(tr, 0)).toBe(false);
    expect(stepFogTransitions(tr, -1)).toBe(false);
    expect(tr.values[NEAR]).toBe(0);
  });
});
