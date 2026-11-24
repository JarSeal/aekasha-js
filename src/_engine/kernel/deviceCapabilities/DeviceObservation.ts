// The device capability check's observed windows (p240 Phase 4, D4-D5): a window of a running
// scene's frames summarized, what held its frame rate, and how its frame time compares with the
// reference frame's prediction. Pure functions: the observer (`DeviceObserver.ts`) samples the
// frames, the scoring reads the windows.
//
// Production has no GPU timer, so what held a window is told from the frame interval, the main
// loop's CPU time and the GPU-busy marks (whether the previous frame's GPU work was still running
// when a frame began). The interval alone can't tell a slow GPU from a cap: the max FPS limiter, or
// the browser throttling the page's frames (iOS Low Power Mode, battery saver, an embed's iframe),
// so a window is `GPU` only on the marks.
import { predictFrameMs } from './DeviceScoring';
import type {
  DeviceGpuBenchmark,
  DeviceObservationLimit,
  ResolvedDeviceCapabilityTargets,
} from './DeviceCapabilitiesTypes';

/**
 * How far over the compared interval a window's median interval must be to be under the refresh
 * rate (the calibration tool's tolerance).
 * @internal
 */
export const UNDER_REFRESH_TOLERANCE = 1.1;

/**
 * The least share of a window's checked frames that began with the GPU busy for it to be `GPU`.
 * @internal
 */
export const GPU_BUSY_SHARE = 0.5;

/**
 * The share of a window's median interval its median CPU time takes from which, the GPU not busy,
 * it's `CPU`.
 * @internal
 */
export const CPU_BOUND_SHARE = 0.5;

/**
 * A window's frames as the observer collected them: `count` intervals and CPU times, and the
 * GPU-busy marks read (`marks`), `busy` of them still busy.
 * @internal
 */
export type DeviceObservationFrames = {
  intervals: Float64Array;
  cpuTimes: Float64Array;
  count: number;
  marks: number;
  busy: number;
};

/**
 * A window's statistics, before what held it is told.
 * @internal
 */
export type DeviceObservationStats = {
  frames: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p50CpuMs: number;
  gpuBusyShare: number | null;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The nearest-rank percentile `p` (0-1) of ascending `sorted`. */
const percentile = (sorted: Float64Array, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

/**
 * A window's median and 95th percentile interval, its median CPU time (each rounded to µs) and its
 * GPU-busy share (null without a mark). Sorts copies: called once a window, not per frame.
 * @internal
 */
export const summarizeObservationFrames = (
  frames: DeviceObservationFrames
): DeviceObservationStats => {
  const intervals = frames.intervals.slice(0, frames.count).sort();
  const cpuTimes = frames.cpuTimes.slice(0, frames.count).sort();
  return {
    frames: frames.count,
    p50FrameMs: round3(percentile(intervals, 0.5)),
    p95FrameMs: round3(percentile(intervals, 0.95)),
    p50CpuMs: round3(percentile(cpuTimes, 0.5)),
    gpuBusyShare: frames.marks > 0 ? round3(frames.busy / frames.marks) : null,
  };
};

/**
 * The interval a window is compared with, ms: the longer of the display's refresh interval and the
 * max FPS limiter's (a 30 FPS cap on a 144 Hz display holds 33 ms frames, not 7); null without a
 * refresh rate or a limiter.
 * @internal
 * @param refreshHz the display's measured refresh rate
 * @param maxFPSInterval the limiter's interval, ms, 0 when it's off
 */
export const readComparedIntervalMs = (refreshHz: number | null, maxFPSInterval: number) => {
  const refreshMs = refreshHz && refreshHz > 0 ? 1000 / refreshHz : 0;
  const compared = Math.max(refreshMs, maxFPSInterval > 0 ? maxFPSInterval : 0);
  return compared > 0 ? round3(compared) : null;
};

/**
 * What held a window's frame rate (p240 D4): `REFRESH` at the compared interval, else `GPU` when at
 * least half its checked frames began with the GPU busy, else `CPU` when its CPU time takes half
 * its interval, else `CAPPED`. Without marks (the GPU's queue can't be checked) a window under the
 * compared interval is never `GPU`: only lowering needs the evidence.
 * @internal
 */
export const classifyObservation = (
  stats: Pick<DeviceObservationStats, 'p50FrameMs' | 'p50CpuMs' | 'gpuBusyShare'>,
  comparedIntervalMs: number
): DeviceObservationLimit => {
  if (stats.p50FrameMs <= comparedIntervalMs * UNDER_REFRESH_TOLERANCE) return 'REFRESH';
  if (stats.gpuBusyShare !== null && stats.gpuBusyShare >= GPU_BUSY_SHARE) return 'GPU';
  if (stats.p50CpuMs >= stats.p50FrameMs * CPU_BOUND_SHARE) return 'CPU';
  return 'CAPPED';
};

/**
 * A window's median interval over the reference frame's predicted time at its drawing buffer's
 * pixels (p240 D5), from the measured benchmark: 1 is the prediction, 2 twice as slow. Meaningful
 * for a `GPU` window only.
 * @internal
 * @returns the ratio, rounded to 0.01; null without a prediction
 */
export const readObservedOverPredicted = (
  observation: { p50FrameMs: number; pixelWidth: number; pixelHeight: number },
  benchmark: DeviceGpuBenchmark,
  frame: ResolvedDeviceCapabilityTargets['referenceFrame']
) => {
  const predictedMs = predictFrameMs(
    benchmark,
    observation.pixelWidth * observation.pixelHeight,
    frame
  );
  return predictedMs === null
    ? null
    : Math.round((observation.p50FrameMs / predictedMs) * 100) / 100;
};
