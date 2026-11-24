import { describe, expect, it } from 'vitest';
import type { DeviceGpuBenchmark } from './DeviceCapabilitiesTypes';
import {
  classifyObservation,
  readComparedIntervalMs,
  readObservedOverPredicted,
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

describe('the observed frame time over the prediction', () => {
  const benchmark: DeviceGpuBenchmark = {
    api: 'WEBGPU',
    width: 1920,
    height: 1080,
    fillRateMPixOpsPerMs: 4,
    trianglesPerMs: 500_000,
    usedTimestampQuery: true,
  };
  const frame = { fixedMPixOps: 16, fullscreenPasses: 18, trianglesPerFrame: 500_000 };

  it("divides the window's median interval by the reference frame's time at its pixels", () => {
    // 1 MP: (16 + 18) / 4 + 500k / 500k = 9.5 ms
    const observation = { p50FrameMs: 19, pixelWidth: 1000, pixelHeight: 1000 };
    expect(readObservedOverPredicted(observation, benchmark, frame)).toBe(2);
  });

  it('is null without throughputs', () => {
    const observation = { p50FrameMs: 19, pixelWidth: 1000, pixelHeight: 1000 };
    expect(
      readObservedOverPredicted(observation, { ...benchmark, trianglesPerMs: 0 }, frame)
    ).toBeNull();
  });
});
