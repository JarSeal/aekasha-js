import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BATCH_TIMEOUT_MS,
  createNoiseTexels,
  NOISE_TEXTURE_SIZE,
  pickBatchTiming,
  withBatchTimeoutAsync,
} from './GpuBenchmarkWorkloads';

afterEach(() => {
  vi.useRealTimers();
});

describe('createNoiseTexels', () => {
  it('is the same noise on every call, RGBA at the texture size', () => {
    const texels = createNoiseTexels();
    expect(texels).toHaveLength(NOISE_TEXTURE_SIZE * NOISE_TEXTURE_SIZE * 4);
    expect(createNoiseTexels()).toEqual(texels);
    expect(new Set(texels).size).toBeGreaterThan(200);
  });
});

describe('pickBatchTiming', () => {
  it("keeps a timer query's reading within the wall time", () => {
    expect(pickBatchTiming(10, 8)).toEqual({ ms: 8, usedTimestampQuery: true });
  });

  it('falls back to the wall time without a reading, or a zero or broken one', () => {
    const wall = { ms: 10, usedTimestampQuery: false };
    expect(pickBatchTiming(10, null)).toEqual(wall);
    expect(pickBatchTiming(10, 0)).toEqual(wall);
    expect(pickBatchTiming(10, -3)).toEqual(wall);
    expect(pickBatchTiming(10, 500)).toEqual(wall);
  });
});

describe('withBatchTimeoutAsync', () => {
  it("resolves with the promise's value, and rejects one that never settles", async () => {
    expect(await withBatchTimeoutAsync(Promise.resolve(3), 'a batch')).toBe(3);

    vi.useFakeTimers();
    const hung = withBatchTimeoutAsync(new Promise(() => undefined), 'a batch');
    vi.advanceTimersByTime(BATCH_TIMEOUT_MS);
    await expect(hung).rejects.toThrow('a batch took over');
  });
});
