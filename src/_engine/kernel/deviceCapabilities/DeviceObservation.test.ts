import { describe, expect, it } from 'vitest';
import type { DeviceObservation } from './DeviceCapabilitiesTypes';
import {
  classifyObservation,
  MAX_OBSERVED_SCENES,
  mergeObservation,
  readComparedIntervalMs,
  summarizeObservationFrames,
} from './DeviceObservation';

const createFrames = (intervals: number[], cpuTimes: number[], marks = 0, busy = 0) => ({
  intervals: Float64Array.from([...intervals, 999]), // a slot past `count` isn't read
  cpuTimes: Float64Array.from([...cpuTimes, 999]),
  count: intervals.length,
  marks,
  busy,
});

describe('a window summarized', () => {
  it('takes the nearest-rank percentiles of its own frames', () => {
    const intervals = Array.from({ length: 20 }, (_, i) => i + 1); // 1-20, shuffled below
    const stats = summarizeObservationFrames(
      createFrames([...intervals].reverse(), [3, 1, 2, ...Array<number>(17).fill(5)], 8, 6)
    );
    expect(stats).toEqual({
      frames: 20,
      p50FrameMs: 10,
      p95FrameMs: 19,
      p50CpuMs: 5,
      gpuBusyShare: 0.75,
    });
  });

  it('has no GPU-busy share without a mark', () => {
    expect(summarizeObservationFrames(createFrames([16.7], [2])).gpuBusyShare).toBeNull();
  });
});

describe('the interval a window is compared with', () => {
  it("is the display's refresh interval, or the max FPS limiter's when longer", () => {
    expect(readComparedIntervalMs(60, 0)).toBe(16.667);
    // A 30 FPS cap on a 144 Hz display holds 33 ms frames
    expect(readComparedIntervalMs(144, 1000 / 30)).toBe(33.333);
    expect(readComparedIntervalMs(30, 1000 / 60)).toBe(33.333);
  });

  it('is the limiter alone without a refresh rate, else nothing', () => {
    expect(readComparedIntervalMs(null, 20)).toBe(20);
    expect(readComparedIntervalMs(null, 0)).toBeNull();
  });
});

describe('what held a window', () => {
  const at60 = 1000 / 60;

  it('is the refresh rate up to 1.1 × the compared interval', () => {
    expect(classifyObservation({ p50FrameMs: 18, p50CpuMs: 15, gpuBusyShare: 1 }, at60)).toBe(
      'REFRESH'
    );
  });

  it('is the GPU below it when half the checked frames began with the GPU busy', () => {
    expect(classifyObservation({ p50FrameMs: 33, p50CpuMs: 20, gpuBusyShare: 0.5 }, at60)).toBe(
      'GPU'
    );
  });

  it('is the CPU when the GPU was free and the main loop takes half the interval', () => {
    expect(classifyObservation({ p50FrameMs: 33, p50CpuMs: 17, gpuBusyShare: 0.25 }, at60)).toBe(
      'CPU'
    );
  });

  it('is a cap when neither is busy (eg. the browser throttling the frames to 30)', () => {
    expect(classifyObservation({ p50FrameMs: 33.3, p50CpuMs: 3, gpuBusyShare: 0 }, at60)).toBe(
      'CAPPED'
    );
  });

  it('is never the GPU without marks', () => {
    expect(classifyObservation({ p50FrameMs: 33, p50CpuMs: 3, gpuBusyShare: null }, at60)).toBe(
      'CAPPED'
    );
  });
});

describe('the kept windows', () => {
  const createWindow = (sceneId: string, p50FrameMs: number, at = 0): DeviceObservation => ({
    sceneId,
    at,
    frames: 300,
    p50FrameMs,
    p95FrameMs: p50FrameMs * 1.5,
    p50CpuMs: 2,
    gpuBusyShare: 1,
    comparedIntervalMs: 16.667,
    pixelWidth: 1920,
    pixelHeight: 1080,
    limitedBy: 'GPU',
  });
  // The ratio: the frame time over a 10 ms prediction
  const readRatio = (o: DeviceObservation) => o.p50FrameMs / 10;

  it("keeps each scene's slowest GPU window, the newest last", () => {
    const gym = createWindow('gym', 20, 1);
    const world = createWindow('world', 30, 2);
    let kept = mergeObservation([], gym, readRatio) ?? [];
    kept = mergeObservation(kept, world, readRatio) ?? [];
    expect(kept).toEqual([gym, world]);
    // Faster than the kept one (the app lowered its settings): nothing changes
    expect(mergeObservation(kept, createWindow('gym', 15, 3), readRatio)).toBeNull();
    const slowerGym = createWindow('gym', 25, 4);
    expect(mergeObservation(kept, slowerGym, readRatio)).toEqual([world, slowerGym]);
  });

  it('keeps no window another limit held, nor one without a ratio', () => {
    expect(
      mergeObservation([], { ...createWindow('gym', 20), limitedBy: 'REFRESH' }, readRatio)
    ).toBeNull();
    expect(mergeObservation([], createWindow('gym', 20), () => null)).toBeNull();
  });

  it('drops the oldest scene past the most it keeps', () => {
    let kept: DeviceObservation[] = [];
    for (let i = 0; i <= MAX_OBSERVED_SCENES; i++) {
      kept = mergeObservation(kept, createWindow(`scene${i}`, 20, i), readRatio) ?? kept;
    }
    expect(kept).toHaveLength(MAX_OBSERVED_SCENES);
    expect(kept[0].sceneId).toBe('scene1');
  });
});
