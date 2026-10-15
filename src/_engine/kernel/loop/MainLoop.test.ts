import { describe, expect, test, vi } from 'vitest';
import type { ElapsedClock } from './MainLoop';

// The loop requests frames through the browser's requestAnimationFrame: counted, never run
const { requestAnimationFrame } = vi.hoisted(() => ({ requestAnimationFrame: vi.fn() }));
vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

const { advanceElapsedClock, nextMaxFPSReference, requestMainLoopFrame, toggleMainPlay } =
  await import('./MainLoop');

describe('the max FPS limiter', () => {
  /** Runs the limiter over `frames` display frames `displayMs` apart; returns the rendered count */
  const countRendered = (frames: number, displayMs: number, intervalMs: number) => {
    let reference = 0;
    let rendered = 0;
    for (let i = 1; i <= frames; i++) {
      const next = nextMaxFPSReference(i * displayMs, reference, intervalMs);
      if (next === -1) continue;
      reference = next;
      rendered++;
    }
    return rendered;
  };

  test('a 30 FPS cap on a 60 Hz display renders every other frame', () => {
    // 300 of 600, give or take the one frame that lands a float's width under the interval
    const rendered = countRendered(600, 1000 / 60, 1000 / 30);
    expect(rendered).toBeGreaterThanOrEqual(299);
    expect(rendered).toBeLessThanOrEqual(300);
  });

  test('a 50 FPS cap on a 60 Hz display carries lateness over instead of dropping to 30', () => {
    expect(countRendered(600, 1000 / 60, 1000 / 50)).toBeGreaterThanOrEqual(495);
  });

  test('a frame under the interval is skipped; after a hitch the reference re-anchors', () => {
    expect(nextMaxFPSReference(10, 0, 20)).toBe(-1);
    expect(nextMaxFPSReference(25, 0, 20)).toBe(20);
    expect(nextMaxFPSReference(500, 0, 20)).toBe(500);
  });
});

describe('the elapsed time', () => {
  test('drops the first delta, and the first after each pause', () => {
    const clock: ElapsedClock = { elapsed: 0, discardNext: true };
    advanceElapsedClock(clock, 5, true); // the time since module load
    advanceElapsedClock(clock, 0.5, true);
    advanceElapsedClock(clock, 0.5, true);
    expect(clock.elapsed).toBe(1);

    advanceElapsedClock(clock, 0.5, false);
    advanceElapsedClock(clock, 30, true); // spans the pause
    advanceElapsedClock(clock, 0.25, true);
    expect(clock.elapsed).toBe(1.25);
  });
});

describe('frame requests', () => {
  test('one frame chain: a second request before the frame runs adds none', () => {
    requestAnimationFrame.mockClear();
    toggleMainPlay(false);
    toggleMainPlay(true);
    requestMainLoopFrame();
    toggleMainPlay(true);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
