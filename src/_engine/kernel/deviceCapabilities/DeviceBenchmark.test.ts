import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceBenchmarkEnv } from './DeviceBenchmark';
import type { DeviceCapabilityMeasurements, DeviceGpuBenchmark } from './DeviceCapabilitiesTypes';
import type { GpuBenchmarkOpts } from './GpuBenchmark';
import type { DeviceProbeEnv } from './DeviceProbe';

// The GPU and CPU benchmarks: their calls, and what they give or throw
const benchmarks = vi.hoisted(() => ({
  gpuCalls: [] as GpuBenchmarkOpts[],
  gpuError: null as Error | null,
  // Called while the GPU benchmark "runs"
  duringGpu: null as (() => void) | null,
  cpuCalls: [] as { durationMs: number; warmUpMs: number }[],
}));
vi.mock(import('./GpuBenchmark'), () => ({
  runGpuBenchmarkAsync: async (opts: GpuBenchmarkOpts): Promise<DeviceGpuBenchmark | null> => {
    benchmarks.gpuCalls.push(opts);
    benchmarks.duringGpu?.();
    if (benchmarks.gpuError) throw benchmarks.gpuError;
    opts.onProgress?.(1);
    return {
      api: opts.api,
      width: opts.width,
      height: opts.height,
      fillRateMPixOpsPerMs: 10,
      trianglesPerMs: 1e6,
      usedTimestampQuery: false,
    };
  },
}));
vi.mock(import('./CpuBenchmark'), () => ({
  runCpuBenchmark: (opts: { durationMs: number; warmUpMs: number }) => {
    benchmarks.cpuCalls.push(opts);
    return 4000;
  },
}));

const {
  refreshHzFromFrameTimes,
  runDeviceBenchmarkAsync,
  sampleRefreshRateAsync,
  splitBenchmarkBudget,
  waitUntilVisibleAsync,
} = await import('./DeviceBenchmark');

/** A browser whose frames come every `frameMs` on a clock they advance; its visibility set by
 * `setHidden`. */
const createEnv = (frameMs = 1000 / 60) => {
  let hidden = false;
  const visibilityListeners = new Set<() => void>();
  const env = {
    time: 0,
    frames: 0,
    now: () => env.time,
    requestAnimationFrame: (callback: (timeMs: number) => void) => {
      env.frames++;
      queueMicrotask(() => {
        env.time += frameMs;
        callback(env.time);
      });
    },
    isHidden: () => hidden,
    onVisibilityChange: (fn: () => void) => {
      visibilityListeners.add(fn);
      return () => visibilityListeners.delete(fn);
    },
    setHidden: (value: boolean) => {
      hidden = value;
      for (const fn of [...visibilityListeners]) fn();
    },
    visibilityListeners,
  };
  return env satisfies DeviceBenchmarkEnv;
};

const createGpu = (
  overrides: Partial<DeviceCapabilityMeasurements['gpu']> = {}
): DeviceCapabilityMeasurements['gpu'] => ({
  api: 'WEBGPU',
  vendor: null,
  architecture: null,
  device: null,
  description: null,
  isFallbackAdapter: false,
  isUnifiedMemory: null,
  isIntegrated: null,
  features: [],
  limits: {},
  preferredCanvasFormat: null,
  webgl2: {
    maxTextureSize: 4096,
    maxSamples: 4,
    extensions: [],
    unmaskedVendor: null,
    unmaskedRenderer: null,
  },
  ...overrides,
});

const runAsync = (
  env: ReturnType<typeof createEnv>,
  overrides: Partial<Parameters<typeof runDeviceBenchmarkAsync>[0]> = {}
) =>
  runDeviceBenchmarkAsync({
    probeEnv: { createWebGL2Context: null } as unknown as DeviceProbeEnv,
    adapter: null,
    gpu: createGpu(),
    width: 1920,
    height: 1080,
    budgetMs: 1500,
    env,
    ...overrides,
  });

beforeEach(() => {
  benchmarks.gpuCalls = [];
  benchmarks.gpuError = null;
  benchmarks.duringGpu = null;
  benchmarks.cpuCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('refreshHzFromFrameTimes', () => {
  const framesAt = (intervalMs: number, count: number) =>
    Array.from({ length: count }, (_, i) => i * intervalMs);

  it("snaps the median interval's rate to a common rate", () => {
    expect(refreshHzFromFrameTimes(framesAt(16.9, 31))).toBe(60);
    expect(refreshHzFromFrameTimes(framesAt(1000 / 144, 31))).toBe(144);
    expect(refreshHzFromFrameTimes(framesAt(8.4, 31))).toBe(120);
  });

  it('ignores a few long frames, and rounds a rate that is no common one', () => {
    const times = framesAt(1000 / 60, 31);
    times[10] += 40;
    times[20] += 40;
    expect(refreshHzFromFrameTimes(times)).toBe(60);
    expect(refreshHzFromFrameTimes(framesAt(1000 / 85, 31))).toBe(85);
  });

  it('is null from fewer than 5 intervals', () => {
    expect(refreshHzFromFrameTimes(framesAt(16.7, 5))).toBeNull();
    expect(refreshHzFromFrameTimes(framesAt(16.7, 6))).toBe(60);
  });
});

describe('sampleRefreshRateAsync', () => {
  it('samples 30 intervals, or until the time is up', async () => {
    const env = createEnv(1000 / 120);
    expect(await sampleRefreshRateAsync(env, 500)).toBe(120);
    expect(env.frames).toBe(31);

    const short = createEnv(1000 / 60);
    expect(await sampleRefreshRateAsync(short, 100)).toBe(60);
    expect(short.frames).toBe(6);
  });

  it("is null when the frames don't come", async () => {
    vi.useFakeTimers();
    const env = { ...createEnv(), requestAnimationFrame: () => undefined };
    const sampled = sampleRefreshRateAsync(env, 100);
    vi.advanceTimersByTime(200);
    expect(await sampled).toBeNull();
    expect(await sampleRefreshRateAsync({ ...env, requestAnimationFrame: null }, 100)).toBeNull();
  });
});

describe('splitBenchmarkBudget', () => {
  it('gives the GPU what the refresh rate and the CPU leave', () => {
    expect(splitBenchmarkBudget(1500)).toEqual({
      refreshMs: 375,
      gpuMs: 945,
      cpuMs: 150,
      cpuWarmUpMs: 30,
    });
    expect(splitBenchmarkBudget(200)).toEqual({
      refreshMs: 50,
      gpuMs: 90,
      cpuMs: 50,
      cpuWarmUpMs: 10,
    });
    expect(splitBenchmarkBudget(0).gpuMs).toBe(0);
  });
});

describe('waitUntilVisibleAsync', () => {
  it('waits for a hidden page to be shown', async () => {
    const env = createEnv();
    env.setHidden(true);
    let isDone = false;
    const waiting = waitUntilVisibleAsync(env).then(() => (isDone = true));
    await Promise.resolve();
    env.setHidden(true);
    await Promise.resolve();
    expect(isDone).toBe(false);
    env.setHidden(false);
    await waiting;
    expect(env.visibilityListeners.size).toBe(0);
  });
});

describe('runDeviceBenchmarkAsync', () => {
  it('samples the refresh rate, runs the GPU and the CPU within the budget, and reports', async () => {
    const env = createEnv();
    const progress: [string, number][] = [];
    const result = await runAsync(env, { onProgress: (...args) => progress.push(args) });
    expect(result).toMatchObject({
      refreshHz: 60,
      cpuScore: 4000,
      benchmark: { gpu: { api: 'WEBGPU', width: 1920, height: 1080 }, isStalled: false },
    });
    expect(benchmarks.cpuCalls).toMatchObject([{ durationMs: 150, warmUpMs: 30 }]);
    // The GPU's deadline is its share of the budget from its start
    expect(benchmarks.gpuCalls[0].deadline).toBeCloseTo(env.time + 945);
    expect(progress).toEqual([
      ['PROBE', 0.15],
      ['GPU', 0.85],
      ['CPU', 0.85],
    ]);
    expect(env.visibilityListeners.size).toBe(0);
  });

  it('measures the API the renderer would use: WebGL2 on a fallback adapter, none without', async () => {
    await runAsync(createEnv(), { gpu: createGpu({ isFallbackAdapter: true }) });
    expect(benchmarks.gpuCalls[0].api).toBe('WEBGL2');

    const result = await runAsync(createEnv(), { gpu: createGpu({ api: 'NONE', webgl2: null }) });
    expect(benchmarks.gpuCalls).toHaveLength(1);
    expect(result.benchmark.gpu).toBeNull();
    expect(result.cpuScore).toBe(4000);
  });

  it('warns on a failed GPU benchmark and goes on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    benchmarks.gpuError = new Error('lost');
    const result = await runAsync(createEnv());
    expect(result.benchmark.gpu).toBeNull();
    expect(result.cpuScore).toBe(4000);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('is stalled when the page was hidden meanwhile, or it took over twice its budget', async () => {
    const env = createEnv();
    benchmarks.duringGpu = () => {
      env.setHidden(true);
      env.setHidden(false);
    };
    expect((await runAsync(env)).benchmark.isStalled).toBe(true);

    const slow = createEnv();
    benchmarks.duringGpu = () => (slow.time += 3100);
    expect((await runAsync(slow)).benchmark.isStalled).toBe(true);

    const onTime = createEnv();
    benchmarks.duringGpu = () => (onTime.time += 2000);
    expect((await runAsync(onTime)).benchmark).toMatchObject({ isStalled: false });
  });
});
