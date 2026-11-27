// The device capability check's GPU benchmark (p240 §1.4, §5 step 3): two synthetic workloads on a
// short-lived device of its own (raw WebGPU, else WebGL2; no three.js), timed with vsync out of
// the picture. Fill: blended fullscreen triangles running a fixed-cost fragment shader (an ALU
// loop and two texture samples), in pixel ops per ms. Geometry: tiny triangles in scanline order,
// in triangles per ms. Each workload doubles (or more) until a batch takes `TARGET_BATCH_MS`, then
// repeats it for the rest of its budget, the fastest kept. The backends are `GpuBenchmarkWebGPU.ts` and `GpuBenchmarkWebGL2.ts`, the
// workloads' shared parts `GpuBenchmarkWorkloads.ts`; loaded with the benchmark, never by a stored
// result's boot.
import type { DeviceGpuBenchmark } from './DeviceCapabilitiesTypes';
import type { ProbeGpuAdapter } from './DeviceProbe';
import { createWebGPUBenchmarkBackendAsync } from './GpuBenchmarkWebGPU';
import { createWebGL2BenchmarkBackend } from './GpuBenchmarkWebGL2';
import type { GpuBatchTiming } from './GpuBenchmarkWorkloads';

/** The batch time a workload grows to, ms: long enough that the timer's quantization and the
 * submit's overhead are small next to it. */
const TARGET_BATCH_MS = 8;
/** The most a batch grows in one step. */
const MAX_GROWTH = 16;
/** The most times a grown batch repeats. */
const MAX_REPEATS = 256;
/** The fill workload's first batch and the most it draws (passes over the target). */
const FILL_START = 1;
const FILL_MAX = 4096;
/** The geometry workload's first batch and the most it draws (triangles). */
const GEOMETRY_START = 1 << 15;
const GEOMETRY_MAX = 1 << 26;
/** The share of the GPU budget the fill workload gets; the geometry's is the rest. */
const FILL_BUDGET_SHARE = 0.6;
/** The benchmark target's most pixels: 3840×2160. */
const MAX_TARGET_PIXELS = 3840 * 2160;

/**
 * {@link measureThroughputAsync}'s options.
 * @internal
 */
export type ThroughputOpts = {
  /** The first batch's count. */
  start: number;
  /** The most a batch draws. */
  max: number;
  /** The time on the clock by which the last batch must end. */
  deadline: number;
  /** The clock, ms. */
  now: () => number;
  /** Called after each batch with the share of the time to the deadline used, 0-1. */
  onBatch?: (progress01: number) => void;
};

// p240 Phase 2
/**
 * Grows a workload until a batch takes `TARGET_BATCH_MS` or reaches `max`, then repeats that batch
 * until the next one would end past the deadline (`MAX_REPEATS` at most), and keeps the fastest:
 * a GPU that idles at a low clock (Apple silicon's) ramps up under the repeats, as
 * it does under a game's frames. At least one batch runs, whatever the deadline.
 * @internal
 * @returns the fastest grown batch (the last one when none grew in time): its count and timing
 */
export const measureThroughputAsync = async (
  run: (count: number) => Promise<GpuBatchTiming>,
  { start, max, deadline, now, onBatch }: ThroughputOpts
) => {
  const startedAt = now();
  let count = start;
  let fastest: (GpuBatchTiming & { count: number }) | null = null;
  for (let repeats = 0; ; ) {
    const timing = await run(count);
    const t = now();
    onBatch?.(Math.min(1, (t - startedAt) / Math.max(1, deadline - startedAt)));
    if (timing.ms >= TARGET_BATCH_MS || count >= max) {
      // By the time a unit takes: a repeat that a faster clock brings under the target grows again
      if (!fastest || timing.ms / count < fastest.ms / fastest.count) {
        fastest = { count, ...timing };
      }
      if (++repeats >= MAX_REPEATS || t + timing.ms > deadline) return fastest;
      continue;
    }
    const growth = Math.min(
      MAX_GROWTH,
      Math.max(2, Math.ceil(TARGET_BATCH_MS / Math.max(timing.ms, 0.05)))
    );
    const next = Math.min(max, count * growth);
    // The next batch's time, guessed from this one's (a batch's overhead makes it a high guess)
    if (t + timing.ms * (next / count) > deadline) return { count, ...timing };
    count = next;
  }
};

/**
 * The benchmark target's size for a resolution: its aspect kept, scaled down to 3840×2160's pixels
 * at most, and whole pixels, at least 1.
 * @internal
 */
export const clampBenchmarkSize = (width: number, height: number) => {
  const pixels = width * height;
  const scale = pixels > MAX_TARGET_PIXELS ? Math.sqrt(MAX_TARGET_PIXELS / pixels) : 1;
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
};

/**
 * {@link runGpuBenchmarkAsync}'s options.
 * @internal
 */
export type GpuBenchmarkOpts = {
  /** The API to measure: the one the renderer would use (`recommendations.renderBackend`). */
  api: DeviceGpuBenchmark['api'];
  /** The probe's adapter, for a WebGPU device (one is requested when it's missing). */
  adapter: ProbeGpuAdapter | null;
  /** `navigator.gpu`'s adapter request, when there's no adapter. */
  requestAdapterAsync: () => Promise<ProbeGpuAdapter | null>;
  /** Creates a throwaway WebGL2 context (the WebGL2 backend's). */
  createWebGL2Context:
    | ((attributes?: WebGLContextAttributes) => WebGL2RenderingContext | null)
    | null;
  /** The target resolution, pixels (clamped with {@link clampBenchmarkSize}). */
  width: number;
  height: number;
  /** The time on the clock by which the benchmark should end. */
  deadline: number;
  /** The clock, ms. */
  now: () => number;
  /** Called as the batches run, with the share of the time to the deadline used, 0-1. */
  onProgress?: (progress01: number) => void;
  /** Called with each batch's timing, the warm-ups' included (the calibration's trace). */
  onBatchTiming?: (batch: GpuBenchmarkBatch) => void;
};

/**
 * One batch the benchmark ran: its workload, whether it was the warm-up, its count (passes or
 * triangles) and its timing.
 * @internal
 */
export type GpuBenchmarkBatch = GpuBatchTiming & {
  workload: 'FILL' | 'GEOMETRY';
  isWarmUp: boolean;
  count: number;
};

/** A backend for the API: WebGPU's device, else WebGL2's context; null when neither comes. */
const createBackendAsync = async (
  opts: GpuBenchmarkOpts,
  size: { width: number; height: number }
) => {
  if (opts.api === 'WEBGPU') {
    const adapter = opts.adapter ?? (await opts.requestAdapterAsync());
    if (adapter) return createWebGPUBenchmarkBackendAsync(adapter, size, opts.now);
    return null;
  }
  return createWebGL2BenchmarkBackend(opts.createWebGL2Context, size, opts.now);
};

/**
 * The GPU benchmark: creates a device (or a WebGL2 context) of its own, warms both workloads up
 * (their pipelines' compile excluded), measures them, and destroys the device.
 * @internal
 * @returns the throughputs, null when no device came
 * @throws when the device fails or is lost on the way (its resources are freed first)
 */
export const runGpuBenchmarkAsync = async (
  opts: GpuBenchmarkOpts
): Promise<DeviceGpuBenchmark | null> => {
  const backend = await createBackendAsync(opts, clampBenchmarkSize(opts.width, opts.height));
  if (!backend) return null;
  try {
    const { now, deadline, onProgress, onBatchTiming } = opts;
    const timed =
      (
        workload: GpuBenchmarkBatch['workload'],
        run: (count: number) => Promise<GpuBatchTiming>,
        isWarmUp = false
      ) =>
      async (count: number) => {
        const timing = await run(count);
        onBatchTiming?.({ ...timing, workload, isWarmUp, count });
        return timing;
      };
    const runFillAsync = timed('FILL', backend.runFillAsync);
    const runGeometryAsync = timed('GEOMETRY', backend.runGeometryAsync);
    // The warm-up: the first submit of each pipeline pays its driver-side setup
    await timed('FILL', backend.runFillAsync, true)(FILL_START);
    await timed('GEOMETRY', backend.runGeometryAsync, true)(GEOMETRY_START);

    const startedAt = now();
    const fillDeadline = startedAt + (deadline - startedAt) * FILL_BUDGET_SHARE;
    const fill = await measureThroughputAsync(runFillAsync, {
      start: FILL_START,
      max: FILL_MAX,
      deadline: fillDeadline,
      now,
      onBatch: (p) => onProgress?.(p * FILL_BUDGET_SHARE),
    });
    const geometry = await measureThroughputAsync(runGeometryAsync, {
      start: GEOMETRY_START,
      max: GEOMETRY_MAX,
      deadline,
      now,
      onBatch: (p) => onProgress?.(FILL_BUDGET_SHARE + p * (1 - FILL_BUDGET_SHARE)),
    });

    const pixels = backend.width * backend.height;
    return {
      api: backend.api,
      width: backend.width,
      height: backend.height,
      fillRateMPixOpsPerMs: (fill.count * pixels) / 1e6 / Math.max(fill.ms, 0.001),
      trianglesPerMs: Math.round(geometry.count / Math.max(geometry.ms, 0.001)),
      usedTimestampQuery: fill.usedTimestampQuery && geometry.usedTimestampQuery,
    };
  } finally {
    backend.destroy();
  }
};
