import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GpuBatchTiming, GpuBenchmarkBackend } from './GpuBenchmarkWorkloads';

// The backends: a fake one per test (no GPU in Node)
const backends = vi.hoisted(() => ({
  webgpu: null as GpuBenchmarkBackend | null,
  webgl2: null as GpuBenchmarkBackend | null,
}));
vi.mock(import('./GpuBenchmarkWebGPU'), () => ({
  createWebGPUBenchmarkBackendAsync: async () => backends.webgpu,
}));
vi.mock(import('./GpuBenchmarkWebGL2'), () => ({
  createWebGL2BenchmarkBackend: () => backends.webgl2,
}));

const { clampBenchmarkSize, measureThroughputAsync, runGpuBenchmarkAsync } = await import(
  './GpuBenchmark'
);

/** A clock the fake batches advance by their time. */
const createClock = () => {
  const clock = { time: 0, now: () => clock.time };
  return clock;
};

/** A batch costing `msPerUnit` per unit, on `clock`. */
const createRun =
  (clock: { time: number }, msPerUnit: number, usedTimestampQuery = true) =>
  async (count: number): Promise<GpuBatchTiming> => {
    const ms = count * msPerUnit;
    clock.time += ms;
    return { ms, usedTimestampQuery };
  };

/** A fake backend: fill 0.5 ms a pass, geometry 1 µs a triangle, at 100×100. */
const createBackend = (clock: { time: number }, api: 'WEBGPU' | 'WEBGL2' = 'WEBGPU') => ({
  api,
  width: 100,
  height: 100,
  runFillAsync: vi.fn(createRun(clock, 0.5)),
  runGeometryAsync: vi.fn(createRun(clock, 0.001)),
  destroy: vi.fn(),
});

afterEach(() => {
  backends.webgpu = null;
  backends.webgl2 = null;
});

describe('measureThroughputAsync', () => {
  it('grows the batch until it takes 8 ms, by up to 16× a step', async () => {
    const clock = createClock();
    const run = vi.fn(createRun(clock, 0.01));
    const result = await measureThroughputAsync(run, {
      start: 1,
      max: 1e6,
      deadline: 1e6,
      now: clock.now,
    });
    expect(run.mock.calls.map(([count]) => count)).toEqual([1, 16, 256, 1024]);
    expect(result).toEqual({ count: 1024, ms: 10.24, usedTimestampQuery: true });
  });

  it('stops at max, and before a batch that would end past the deadline', async () => {
    const clock = createClock();
    const atMax = await measureThroughputAsync(createRun(clock, 0.001), {
      start: 1,
      max: 64,
      deadline: 1e6,
      now: clock.now,
    });
    expect(atMax.count).toBe(64);

    clock.time = 0;
    const run = vi.fn(createRun(clock, 1));
    const atDeadline = await measureThroughputAsync(run, {
      start: 2,
      max: 1e6,
      deadline: 5,
      now: clock.now,
    });
    // 2 ms done; the next (4 ms) would end at 6
    expect(atDeadline.count).toBe(2);
    expect(run).toHaveBeenCalledOnce();
  });

  it('runs one batch even past the deadline, and reports its progress', async () => {
    const clock = createClock();
    clock.time = 10;
    const onBatch = vi.fn();
    const result = await measureThroughputAsync(createRun(clock, 1), {
      start: 1,
      max: 1e6,
      deadline: 5,
      now: clock.now,
      onBatch,
    });
    expect(result.count).toBe(1);
    expect(onBatch).toHaveBeenCalledWith(1);
  });
});

describe('clampBenchmarkSize', () => {
  it("keeps a size up to 3840×2160's pixels, and scales a larger one down, aspect kept", () => {
    expect(clampBenchmarkSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(clampBenchmarkSize(7680, 4320)).toEqual({ width: 3840, height: 2160 });
    expect(clampBenchmarkSize(1170 * 3, 2532 * 3).width).toBeLessThan(3840);
    expect(clampBenchmarkSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('runGpuBenchmarkAsync', () => {
  const baseOpts = (clock: { now: () => number }) => ({
    adapter: null,
    requestAdapterAsync: async () => ({ features: [], limits: {} }),
    createWebGL2Context: null,
    width: 100,
    height: 100,
    deadline: 1000,
    now: clock.now,
  });

  it('warms up, measures both workloads and destroys the device', async () => {
    const clock = createClock();
    const backend = createBackend(clock);
    backends.webgpu = backend;
    const result = await runGpuBenchmarkAsync({ ...baseOpts(clock), api: 'WEBGPU' });
    // The warm-up's batches first
    expect(backend.runFillAsync.mock.calls[0][0]).toBe(1);
    expect(backend.runGeometryAsync.mock.calls[0][0]).toBe(1 << 15);
    expect(result).toEqual({
      api: 'WEBGPU',
      width: 100,
      height: 100,
      // 100×100 pixels per 0.5 ms
      fillRateMPixOpsPerMs: 0.02,
      trianglesPerMs: 1000,
      usedTimestampQuery: true,
    });
    expect(backend.destroy).toHaveBeenCalledOnce();
  });

  it('uses the WebGL2 backend for WebGL2, and is null without a device', async () => {
    const clock = createClock();
    backends.webgl2 = createBackend(clock, 'WEBGL2');
    expect((await runGpuBenchmarkAsync({ ...baseOpts(clock), api: 'WEBGL2' }))?.api).toBe('WEBGL2');
    backends.webgl2 = null;
    expect(await runGpuBenchmarkAsync({ ...baseOpts(clock), api: 'WEBGL2' })).toBeNull();
  });

  it('destroys the device when a batch fails', async () => {
    const clock = createClock();
    const backend = createBackend(clock);
    backend.runGeometryAsync.mockRejectedValue(new Error('lost'));
    backends.webgpu = backend;
    await expect(runGpuBenchmarkAsync({ ...baseOpts(clock), api: 'WEBGPU' })).rejects.toThrow(
      'lost'
    );
    expect(backend.destroy).toHaveBeenCalledOnce();
  });

  it("reports no timer query when a batch's timing wasn't one", async () => {
    const clock = createClock();
    const backend = createBackend(clock);
    backend.runFillAsync.mockImplementation(createRun(clock, 0.5, false));
    backends.webgpu = backend;
    const result = await runGpuBenchmarkAsync({ ...baseOpts(clock), api: 'WEBGPU' });
    expect(result?.usedTimestampQuery).toBe(false);
  });
});
