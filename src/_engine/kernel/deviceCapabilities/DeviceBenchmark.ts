// The device capability check's benchmark (p240 §5 steps 2-4): the refresh rate, the GPU benchmark
// and the CPU benchmark, in that order, within one time budget. `import()`ed by
// `DeviceCapabilities.ts` only when it measures with the benchmark, so a stored result's boot (or a
// check with the benchmark off) never downloads it. Waits for a hidden page to be shown first (a
// hidden page's frames and timers are throttled), and marks a run the page was hidden during, or
// that took far over its budget, as stalled: its readings aren't stored.
import { lwarn } from '../../utils/Logger';
import { runCpuBenchmark } from './CpuBenchmark';
import type {
  DeviceBenchmarkMeasurements,
  DeviceCapabilityCheckPhase,
  DeviceCapabilityMeasurements,
  DeviceGpuBenchmark,
} from './DeviceCapabilitiesTypes';
import { type DeviceProbeEnv, type ProbeGpuAdapter, requestProbeAdapterAsync } from './DeviceProbe';
import { runGpuBenchmarkAsync } from './GpuBenchmark';

/**
 * What the benchmark reads from the browser, gathered at the call
 * ({@link readBrowserBenchmarkEnv}), so the tests hand it fakes.
 * @internal
 */
export type DeviceBenchmarkEnv = {
  /** The clock, ms. */
  now: () => number;
  /** `requestAnimationFrame`, null where there's none. */
  requestAnimationFrame: ((callback: (timeMs: number) => void) => void) | null;
  /** `document.hidden`. */
  isHidden: () => boolean;
  /** Calls `fn` on the page's `visibilitychange`; returns the remover. */
  onVisibilityChange: (fn: () => void) => () => void;
};

/**
 * The benchmark's results: the refresh rate and the CPU score go into the display's and the
 * CPU's measurements, the rest is the `benchmark` measurement.
 * @internal
 */
export type DeviceBenchmarkResult = {
  refreshHz: number | null;
  cpuScore: number;
  benchmark: DeviceBenchmarkMeasurements;
};

/** The frame intervals the refresh rate is the median of (at most: the budget may cut it). */
const REFRESH_INTERVALS = 30;
/** The fewest intervals a refresh rate is read from. */
const MIN_REFRESH_INTERVALS = 5;
/** The refresh rates a reading snaps to when within {@link REFRESH_SNAP_TOLERANCE} of one. */
const COMMON_REFRESH_HZ = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
const REFRESH_SNAP_TOLERANCE = 0.04;
/** A run this many times over its budget is stalled (a busy machine, a debugger's pause). */
const STALL_BUDGET_FACTOR = 2;

/** The check's progress at each step's end (the probe's 0-0.05 is `DeviceCapabilities.ts`'). */
const PROGRESS_REFRESH_END = 0.15;
const PROGRESS_GPU_END = 0.85;

/**
 * Reads the benchmark's inputs from the browser's globals. Call it only in a browser.
 * @internal
 */
export const readBrowserBenchmarkEnv = (): DeviceBenchmarkEnv => ({
  now: () => performance.now(),
  requestAnimationFrame:
    typeof requestAnimationFrame === 'function'
      ? (callback) => {
          requestAnimationFrame(callback);
        }
      : null,
  isHidden: () => document.hidden,
  onVisibilityChange: (fn) => {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
});

/**
 * The benchmark's budget split between its steps, ms: the refresh rate's sampling a quarter (500
 * at most), the CPU a tenth (50-150) with a fifth of that to warm up, the GPU the rest.
 * @internal
 */
export const splitBenchmarkBudget = (budgetMs: number) => {
  const refreshMs = Math.min(500, budgetMs * 0.25);
  const cpuMs = Math.min(150, Math.max(50, budgetMs * 0.1));
  const cpuWarmUpMs = cpuMs / 5;
  return {
    refreshMs,
    gpuMs: Math.max(0, budgetMs - refreshMs - cpuMs - cpuWarmUpMs),
    cpuMs,
    cpuWarmUpMs,
  };
};

/**
 * The refresh rate from frame timestamps: the median interval's rate, snapped to a common rate
 * within 4 % (frames jitter), else rounded.
 * @internal
 * @returns the rate, Hz, null from fewer than 5 intervals
 */
export const refreshHzFromFrameTimes = (times: number[]): number | null => {
  if (times.length < MIN_REFRESH_INTERVALS + 1) return null;
  const intervals = times
    .slice(1)
    .map((time, i) => time - times[i])
    .sort((a, b) => a - b);
  const mid = intervals.length >> 1;
  const median = intervals.length % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2;
  if (!(median > 0)) return null;
  const hz = 1000 / median;
  const common = COMMON_REFRESH_HZ.find(
    (rate) => Math.abs(hz - rate) <= rate * REFRESH_SNAP_TOLERANCE
  );
  return common ?? Math.round(hz);
};

/**
 * Samples the display's refresh rate from `requestAnimationFrame`'s timestamps, for
 * {@link REFRESH_INTERVALS} intervals or `maxMs`, whichever ends first.
 * @internal
 * @returns the rate (see {@link refreshHzFromFrameTimes}), null when too few frames came
 */
export const sampleRefreshRateAsync = (env: DeviceBenchmarkEnv, maxMs: number) =>
  new Promise<number | null>((resolve) => {
    const raf = env.requestAnimationFrame;
    if (!raf) {
      resolve(null);
      return;
    }
    const times: number[] = [];
    const startedAt = env.now();
    let isDone = false;
    const finish = () => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeout);
      resolve(refreshHzFromFrameTimes(times));
    };
    // The frames may stop coming (the page hidden meanwhile)
    const timeout = setTimeout(finish, maxMs + 100);
    const onFrame = (timeMs: number) => {
      if (isDone) return;
      times.push(timeMs);
      if (times.length > REFRESH_INTERVALS || env.now() - startedAt >= maxMs) finish();
      else raf(onFrame);
    };
    raf(onFrame);
  });

/**
 * Resolves when the page is visible: at once, or on the `visibilitychange` that shows it.
 * @internal
 */
export const waitUntilVisibleAsync = (env: DeviceBenchmarkEnv) =>
  new Promise<void>((resolve) => {
    if (!env.isHidden()) {
      resolve();
      return;
    }
    const remove = env.onVisibilityChange(() => {
      if (env.isHidden()) return;
      remove();
      resolve();
    });
  });

/**
 * {@link runDeviceBenchmarkAsync}'s options.
 * @internal
 */
export type DeviceBenchmarkOpts = {
  /** The probe's inputs (the WebGL2 context, an adapter request). */
  probeEnv: DeviceProbeEnv;
  /** The probe's adapter, for the WebGPU benchmark's device. */
  adapter: ProbeGpuAdapter | null;
  /** The probe's GPU measurements: which API the renderer would use. */
  gpu: DeviceCapabilityMeasurements['gpu'];
  /** The target resolution, pixels. */
  width: number;
  height: number;
  /** The whole benchmark's budget, ms. */
  budgetMs: number;
  /** The check's progress (`DeviceCapabilityCheckOpts.onProgress`). */
  onProgress?: (phase: DeviceCapabilityCheckPhase, progress01: number) => void;
  /** The browser's inputs. Default {@link readBrowserBenchmarkEnv}'s. */
  env?: DeviceBenchmarkEnv;
};

/** The API the renderer would use, which the GPU benchmark measures; null without one. */
const pickBenchmarkApi = (
  gpu: DeviceCapabilityMeasurements['gpu']
): DeviceGpuBenchmark['api'] | null => {
  if (gpu.api === 'WEBGPU' && !gpu.isFallbackAdapter) return 'WEBGPU';
  return gpu.webgl2 ? 'WEBGL2' : null;
};

/**
 * The benchmark: once the page is visible, samples the refresh rate, runs the GPU benchmark (on
 * the API the renderer would use) and the CPU benchmark, within `budgetMs` (a slow device's first
 * GPU batches may run over it). A failed GPU benchmark is warned and leaves its result null.
 * @internal
 */
export const runDeviceBenchmarkAsync = async ({
  probeEnv,
  adapter,
  gpu,
  width,
  height,
  budgetMs,
  onProgress,
  env = readBrowserBenchmarkEnv(),
}: DeviceBenchmarkOpts): Promise<DeviceBenchmarkResult> => {
  await waitUntilVisibleAsync(env);
  const startedAt = env.now();
  let wasHidden = false;
  const stopWatching = env.onVisibilityChange(() => {
    if (env.isHidden()) wasHidden = true;
  });

  try {
    const budget = splitBenchmarkBudget(budgetMs);
    const refreshHz = await sampleRefreshRateAsync(env, budget.refreshMs);
    onProgress?.('PROBE', PROGRESS_REFRESH_END);

    let gpuResult: DeviceGpuBenchmark | null = null;
    const api = pickBenchmarkApi(gpu);
    if (api) {
      try {
        gpuResult = await runGpuBenchmarkAsync({
          api,
          adapter,
          requestAdapterAsync: () => requestProbeAdapterAsync(probeEnv),
          createWebGL2Context: probeEnv.createWebGL2Context,
          width,
          height,
          deadline: env.now() + budget.gpuMs,
          now: env.now,
          onProgress: (progress01) =>
            onProgress?.(
              'GPU',
              PROGRESS_REFRESH_END + progress01 * (PROGRESS_GPU_END - PROGRESS_REFRESH_END)
            ),
        });
      } catch (err) {
        lwarn(
          'Device capabilities: the GPU benchmark failed (the GPU is rated by its adapter).',
          err
        );
      }
    }

    onProgress?.('CPU', PROGRESS_GPU_END);
    const cpuScore = runCpuBenchmark({
      durationMs: budget.cpuMs,
      warmUpMs: budget.cpuWarmUpMs,
      now: env.now,
    });

    const durationMs = env.now() - startedAt;
    return {
      refreshHz,
      cpuScore,
      benchmark: {
        gpu: gpuResult,
        durationMs: Math.round(durationMs),
        isStalled: wasHidden || env.isHidden() || durationMs > budgetMs * STALL_BUDGET_FACTOR,
      },
    };
  } finally {
    stopWatching();
  }
};
