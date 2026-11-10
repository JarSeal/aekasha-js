import { describe, expect, test } from 'vitest';
import {
  advanceLodFade,
  getLodFadeDelta,
  isLodChangeFaded,
  isLodCulledAt,
  LOD_LEVEL_CULLED,
  LOD_LEVEL_NONE,
  type LodInstanceState,
  selectLodLevel,
  selectLodTarget,
  stepLodInstanceState,
} from './LodRules';

// Level 0 from screen size 0.5, level 1 from 0.2, level 2 below (its own screenSize isn't read)
const LEVELS = [{ screenSize: 0.5 }, { screenSize: 0.2 }, { screenSize: 0.05 }];
const CULL = 0.01;
const H = 0.1;
const DT = 1 / 60;

describe('selectLodLevel', () => {
  test('picks the finest level whose screenSize the size reaches on a first selection', () => {
    expect(selectLodLevel(LEVELS, 0.6, LOD_LEVEL_NONE, H)).toBe(0);
    expect(selectLodLevel(LEVELS, 0.5, LOD_LEVEL_NONE, H)).toBe(0);
    expect(selectLodLevel(LEVELS, 0.3, LOD_LEVEL_NONE, H)).toBe(1);
    expect(selectLodLevel(LEVELS, 0.01, LOD_LEVEL_NONE, H)).toBe(2);
  });

  test('moves to a finer level at its screenSize', () => {
    expect(selectLodLevel(LEVELS, 0.2, 2, H)).toBe(1);
    expect(selectLodLevel(LEVELS, 0.5, 2, H)).toBe(0);
  });

  test('moves to a coarser level only below screenSize × (1 - hysteresis)', () => {
    expect(selectLodLevel(LEVELS, 0.46, 0, H)).toBe(0);
    expect(selectLodLevel(LEVELS, 0.44, 0, H)).toBe(1);
    expect(selectLodLevel(LEVELS, 0.19, 1, H)).toBe(1);
    expect(selectLodLevel(LEVELS, 0.17, 1, H)).toBe(2);
  });

  test('skips levels on a large drop, holding the first one the band keeps', () => {
    expect(selectLodLevel(LEVELS, 0.1, 0, H)).toBe(2);
    // Below level 0's band but inside level 1's
    expect(selectLodLevel(LEVELS, 0.19, 0, H)).toBe(1);
  });

  test('without hysteresis, is the raw selection', () => {
    for (const s of [0.6, 0.49, 0.3, 0.19, 0.01]) {
      expect(selectLodLevel(LEVELS, s, 0, 0)).toBe(selectLodLevel(LEVELS, s, LOD_LEVEL_NONE, 0));
    }
  });

  test('a single level is always selected', () => {
    expect(selectLodLevel([{ screenSize: 0.5 }], 0.01, LOD_LEVEL_NONE, H)).toBe(0);
    expect(selectLodLevel([{ screenSize: 0.5 }], 0.9, 0, H)).toBe(0);
  });
});

describe('isLodCulledAt', () => {
  test('a shown instance is culled only below cullScreenSize × (1 - hysteresis)', () => {
    expect(isLodCulledAt(0.0095, CULL, H, false)).toBe(false);
    expect(isLodCulledAt(0.0089, CULL, H, false)).toBe(true);
  });

  test('a culled instance comes back at cullScreenSize itself', () => {
    expect(isLodCulledAt(0.0095, CULL, H, true)).toBe(true);
    expect(isLodCulledAt(0.01, CULL, H, true)).toBe(false);
  });

  test('never without a cullScreenSize', () => {
    expect(isLodCulledAt(0, 0, H, false)).toBe(false);
    expect(isLodCulledAt(0, 0, H, true)).toBe(false);
  });
});

describe('selectLodTarget', () => {
  test('a first selection takes no hysteresis, the cull included', () => {
    expect(selectLodTarget(LEVELS, 0.44, LOD_LEVEL_NONE, CULL, H)).toBe(1);
    expect(selectLodTarget(LEVELS, 0.0095, LOD_LEVEL_NONE, CULL, H)).toBe(2);
    expect(selectLodTarget(LEVELS, 0.0089, LOD_LEVEL_NONE, CULL, H)).toBe(LOD_LEVEL_CULLED);
  });

  test('culls from any level below the cull band', () => {
    expect(selectLodTarget(LEVELS, 0.005, 0, CULL, H)).toBe(LOD_LEVEL_CULLED);
    expect(selectLodTarget(LEVELS, 0.0095, 2, CULL, H)).toBe(2);
  });

  test('coming back from culled, it comes from beyond the last level', () => {
    expect(selectLodTarget(LEVELS, 0.0095, LOD_LEVEL_CULLED, CULL, H)).toBe(LOD_LEVEL_CULLED);
    expect(selectLodTarget(LEVELS, 0.01, LOD_LEVEL_CULLED, CULL, H)).toBe(2);
    // A finer level at its own screenSize, as from the last level
    expect(selectLodTarget(LEVELS, 0.19, LOD_LEVEL_CULLED, CULL, H)).toBe(2);
    expect(selectLodTarget(LEVELS, 0.2, LOD_LEVEL_CULLED, CULL, H)).toBe(1);
    expect(selectLodTarget(LEVELS, 0.6, LOD_LEVEL_CULLED, CULL, H)).toBe(0);
  });

  test('is the level selection without a cullScreenSize', () => {
    expect(selectLodTarget(LEVELS, 0, 0, 0, H)).toBe(2);
  });
});

describe('the fade step', () => {
  /** Frames until a fade ends, from its start at 0 (the advance runs in its first frame too). */
  const countFadeFrames = (seconds: number, dt: number) => {
    let progress = 0;
    let frames = 0;
    while (progress < 1 && frames < 10_000) {
      progress = advanceLodFade(progress, getLodFadeDelta(dt, seconds));
      frames++;
    }
    return frames;
  };

  test('a 0.25 s fade at 1/60 s lasts 15 frames, a 1 s one 60', () => {
    expect(countFadeFrames(0.25, DT)).toBe(15);
    expect(countFadeFrames(1, DT)).toBe(60);
    // Why the epsilon: 15 steps of 1/15 sum to just under 1 in f64
    let sum = 0;
    for (let i = 0; i < 15; i++) sum += DT / 0.25;
    expect(sum).toBeLessThan(1);
  });

  test('an ended fade is exactly 1, a running one its sum', () => {
    expect(advanceLodFade(0.5, 0.25)).toBe(0.75);
    expect(advanceLodFade(0.9, 0.2)).toBe(1);
    expect(advanceLodFade(1 - 1e-6, 0)).toBe(1);
  });

  test('without seconds, a fade ends in one step; a step of 0 holds it', () => {
    expect(getLodFadeDelta(DT, 0)).toBe(1);
    expect(advanceLodFade(0.3, getLodFadeDelta(0, 0.25))).toBe(0.3);
  });

  test('only a change after a first selection fades, and only with seconds', () => {
    expect(isLodChangeFaded(false, 0.25)).toBe(false);
    expect(isLodChangeFaded(true, 0.25)).toBe(true);
    expect(isLodChangeFaded(true, 0)).toBe(false);
  });
});

describe('stepLodInstanceState', () => {
  const createState = (): LodInstanceState => ({
    level: LOD_LEVEL_NONE,
    outgoing: LOD_LEVEL_NONE,
    progress: 1,
  });

  test('a first selection never fades, a level or culled', () => {
    const state = createState();
    expect(stepLodInstanceState(state, 1, 0.25, DT)).toBe(true);
    expect(state).toEqual({ level: 1, outgoing: LOD_LEVEL_NONE, progress: 1 });

    const culled = createState();
    stepLodInstanceState(culled, LOD_LEVEL_CULLED, 0.25, DT);
    expect(culled).toEqual({ level: LOD_LEVEL_CULLED, outgoing: LOD_LEVEL_NONE, progress: 1 });
  });

  test('nothing changes without a change or a fade', () => {
    const state = createState();
    stepLodInstanceState(state, 0, 0.25, DT);
    expect(stepLodInstanceState(state, 0, 0.25, DT)).toBe(false);
    expect(state).toEqual({ level: 0, outgoing: LOD_LEVEL_NONE, progress: 1 });
  });

  test('a change fades from the level shown, drawn at one step in its first frame', () => {
    const state = createState();
    stepLodInstanceState(state, 0, 0.25, DT);
    stepLodInstanceState(state, 1, 0.25, DT);
    expect(state.level).toBe(1);
    expect(state.outgoing).toBe(0);
    expect(state.progress).toBeCloseTo(1 / 15, 12);
    // It ends at the 15th frame, its first included
    let frames = 1;
    while (state.outgoing !== LOD_LEVEL_NONE) {
      expect(stepLodInstanceState(state, 1, 0.25, DT)).toBe(true);
      frames++;
    }
    expect(frames).toBe(15);
    expect(state).toEqual({ level: 1, outgoing: LOD_LEVEL_NONE, progress: 1 });
  });

  test('a change mid-fade ends the running fade and fades from the level shown', () => {
    const state = createState();
    stepLodInstanceState(state, 0, 0.25, DT);
    stepLodInstanceState(state, 1, 0.25, DT);
    for (let i = 0; i < 5; i++) stepLodInstanceState(state, 1, 0.25, DT);
    stepLodInstanceState(state, 2, 0.25, DT);
    expect(state.level).toBe(2);
    expect(state.outgoing).toBe(1);
    expect(state.progress).toBeCloseTo(1 / 15, 12);
  });

  test('a fade to and from culled has culled as its other side', () => {
    const state = createState();
    stepLodInstanceState(state, 2, 0.25, DT);
    stepLodInstanceState(state, LOD_LEVEL_CULLED, 0.25, DT);
    expect(state.level).toBe(LOD_LEVEL_CULLED);
    expect(state.outgoing).toBe(2);
    stepLodInstanceState(state, 2, 0.25, DT);
    expect(state.level).toBe(2);
    expect(state.outgoing).toBe(LOD_LEVEL_CULLED);
  });

  test('culled since its first selection, it fades in when first shown', () => {
    const state = createState();
    stepLodInstanceState(state, LOD_LEVEL_CULLED, 0.25, DT);
    stepLodInstanceState(state, 2, 0.25, DT);
    expect(state.outgoing).toBe(LOD_LEVEL_CULLED);
    expect(state.progress).toBeCloseTo(1 / 15, 12);
  });

  test('without fade seconds a change is instant', () => {
    const state = createState();
    stepLodInstanceState(state, 0, 0, DT);
    stepLodInstanceState(state, 1, 0, DT);
    expect(state).toEqual({ level: 1, outgoing: LOD_LEVEL_NONE, progress: 1 });
  });

  test('a step of 0 holds a fade; fade seconds going to 0 end it', () => {
    const state = createState();
    stepLodInstanceState(state, 0, 0.25, DT);
    stepLodInstanceState(state, 1, 0.25, 0);
    expect(state.outgoing).toBe(0);
    expect(state.progress).toBe(0);
    stepLodInstanceState(state, 1, 0.25, 0);
    expect(state.progress).toBe(0);
    stepLodInstanceState(state, 1, 0, DT);
    expect(state).toEqual({ level: 1, outgoing: LOD_LEVEL_NONE, progress: 1 });
  });
});
