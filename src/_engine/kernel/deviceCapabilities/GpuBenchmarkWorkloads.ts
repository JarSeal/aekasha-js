// The GPU benchmark's workloads as both backends draw them (p240 §5 step 3): the shared constants,
// the noise texture's texels, the backend's shape and the timing guard. Apart from
// `GpuBenchmark.ts`, which imports the backends, so the backends import no module that imports them.
import type { DeviceGpuBenchmark } from './DeviceCapabilitiesTypes';

/**
 * The fill shader's ALU loop length, the same in both backends' shaders: what one "pixel op" of
 * the fill rate costs, and so what `referenceFrame.fullscreenPasses` counts in.
 * @internal
 */
export const FILL_ALU_ITERATIONS = 16;

/**
 * The geometry workload's triangles' size, pixels a side: small enough that rasterizing them
 * costs little next to their vertices.
 * @internal
 */
export const GEOMETRY_TRIANGLE_PX = 2;

/**
 * The fill shader's texture's size, texels a side.
 * @internal
 */
export const NOISE_TEXTURE_SIZE = 64;

/**
 * How long one batch may take before the benchmark gives up on the device, ms: far past any
 * batch's time, short of a driver's watchdog.
 * @internal
 */
export const BATCH_TIMEOUT_MS = 2000;

/**
 * One timed batch: its GPU time, ms, and whether a timer query measured it (else the wall time
 * around the submit and its completion).
 * @internal
 */
export type GpuBatchTiming = { ms: number; usedTimestampQuery: boolean };

/**
 * A GPU benchmark backend: a device with the two workloads' pipelines and a render target ready.
 * @internal
 */
export type GpuBenchmarkBackend = {
  api: DeviceGpuBenchmark['api'];
  /** The render target's size, pixels: the size asked for, clamped to the device's limits. */
  width: number;
  height: number;
  /** Draws `passes` blended fullscreen triangles of the fill shader over the target, timed. */
  runFillAsync: (passes: number) => Promise<GpuBatchTiming>;
  /** Draws `triangles` tiny triangles, timed. */
  runGeometryAsync: (triangles: number) => Promise<GpuBatchTiming>;
  /** Frees the device and everything on it. Once; the backend isn't used after it. */
  destroy: () => void;
};

/**
 * The fill shader's texture: RGBA8 noise from a fixed integer hash, the same on every run.
 * @internal
 */
export const createNoiseTexels = () => {
  const texels = new Uint8Array(NOISE_TEXTURE_SIZE * NOISE_TEXTURE_SIZE * 4);
  for (let i = 0; i < texels.length; i++) {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    texels[i] = Math.imul(h, 0xc2b2ae35) >>> 24;
  }
  return texels;
};

/**
 * A timing within the backends' bounds: a timer query's reading is kept when it's positive and
 * not far over the wall time it was taken within (a broken or disjoint timer), else the wall time.
 * @internal
 */
export const pickBatchTiming = (wallMs: number, queryMs: number | null): GpuBatchTiming =>
  queryMs !== null && queryMs > 0 && queryMs <= wallMs * 1.5 + 1
    ? { ms: queryMs, usedTimestampQuery: true }
    : { ms: wallMs, usedTimestampQuery: false };

/**
 * `promise`, or a rejection after {@link BATCH_TIMEOUT_MS}: a lost or hung device's completion
 * never comes on some drivers.
 * @internal
 */
export const withBatchTimeoutAsync = <T>(promise: Promise<T>, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`GPU benchmark: ${what} took over ${BATCH_TIMEOUT_MS} ms.`)),
      BATCH_TIMEOUT_MS
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
