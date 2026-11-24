import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GpuBenchmarkBatch } from './GpuBenchmark';
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
    return { ms, usedTimestampQuery, wallMs: ms, queryMs: usedTimestampQuery ? ms : null };
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
      deadline: 40,
      now: clock.now,
    });
    expect(run.mock.calls.slice(0, 4).map(([count]) => count)).toEqual([1, 16, 256, 1024]);
    expect(result).toMatchObject({ count: 1024, ms: 10.24, usedTimestampQuery: true });
  });

  it('repeats the grown batch until the deadline and keeps the fastest (a clock ramping up)', async () => {
    const clock = createClock();
    // 16 ms a batch, falling to 9 by the fourth, then slowing again
    const times = [16, 12, 10, 9, 11, 11, 11];
    let calls = 0;
    const run = vi.fn<(count: number) => Promise<GpuBatchTiming>>(async () => {
      const ms = times[calls++];
      clock.time += ms;
      return { ms, usedTimestampQuery: true, wallMs: ms, queryMs: ms };
    });
    const result = await measureThroughputAsync(run, {
      start: 8,
      max: 1e6,
      deadline: 70,
      now: clock.now,
    });
    // 69 ms done (six batches); the next (11 ms) would end at 80
    expect(run.mock.calls.map(([count]) => count)).toEqual([8, 8, 8, 8, 8, 8]);
    expect(result).toMatchObject({ count: 8, ms: 9 });
  });

  it('grows a repeat that a faster clock brings under 8 ms, and compares them per unit', async () => {
    const clock = createClock();
    // 3 units at 3 ms a unit (9 ms), then 1.5 (4.5 ms: grows to 6), then 1.6 (9.6 ms, at 23.1:
    // the next would end past 30)
    const msPerUnit = [3, 1.5, 1.6];
    let calls = 0;
    const run = vi.fn(async (count: number): Promise<GpuBatchTiming> => {
      const ms = count * msPerUnit[calls++];
      clock.time += ms;
      return { ms, usedTimestampQuery: true, wallMs: ms, queryMs: ms };
    });
    const result = await measureThroughputAsync(run, {
      start: 3,
      max: 1e6,
      deadline: 30,
      now: clock.now,
    });
    expect(run.mock.calls.map(([count]) => count)).toEqual([3, 3, 6]);
    // 6 units in 9.6 ms beats 3 in 9 ms, though it's the longer batch
    expect(result).toMatchObject({ count: 6, ms: expect.closeTo(9.6) });
  });

  it('repeats a grown batch 256 times at most', async () => {
    const clock = createClock();
    const run = vi.fn(createRun(clock, 1));
    await measureThroughputAsync(run, { start: 8, max: 1e6, deadline: 1e9, now: clock.now });
    expect(run).toHaveBeenCalledTimes(256);
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

  it('reports every batch to onBatchTiming, the warm-ups first', async () => {
    const clock = createClock();
    backends.webgpu = createBackend(clock);
    const batches: GpuBenchmarkBatch[] = [];
    await runGpuBenchmarkAsync({
      ...baseOpts(clock),
      api: 'WEBGPU',
      onBatchTiming: (batch) => batches.push(batch),
    });
    expect(batches.slice(0, 2)).toMatchObject([
      { workload: 'FILL', isWarmUp: true, count: 1, ms: 0.5, wallMs: 0.5, queryMs: 0.5 },
      { workload: 'GEOMETRY', isWarmUp: true, count: 1 << 15 },
    ]);
    const measured = batches.slice(2);
    expect(measured.some((b) => b.workload === 'FILL')).toBe(true);
    expect(measured.at(-1)).toMatchObject({ workload: 'GEOMETRY', isWarmUp: false });
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
