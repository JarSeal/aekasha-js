// The device capability check's calibration (p240 Phase 2, section 3; debug env): the current
// scene's frame interval and GPU time (`onGpuFrameTime`, the mean of a number of frames after a
// warm-up) at three renderer pixel ratios, its triangles and draw calls, next to what the check
// predicts for the reference frame at the same pixels, and the reference frame fitted to it: the
// frame's time less its triangles' is a line over the pixels, whose slope is the fill passes and
// whose intercept the fixed work. Run it from the browser's console in `yarn dev`
// (`?isDebug=true`) with the scene running:
//   (await import('/_engine/kernel/deviceCapabilities/debug/_dbg__DeviceCalibration.ts'))
//     .measureDeviceCalibrationAsync()
// Only a GPU-bound sample is fitted (its frame rate under the refresh rate, the GPU busy): the
// benchmark measures a GPU clocked up by its repeats, and a GPU at a light load runs at a lower
// clock (a 7900 XT's scenes at 144 Hz took the time of its idle clock), so a light load's time
// doesn't compare with it. The frame interval is its time, not the GPU time: WebGPU's summed pass
// times overcount a frame of several passes on a tile-based GPU (an M2 summed 60-80 ms in scenes
// holding 60 fps). On a display without variable refresh a frame waits for the next refresh, so a
// GPU-bound frame interval can be over the GPU's time: the fit errs high (conservative).
import { onGpuFrameTime } from '../../../debug/GPUFrameTime';
import { llog } from '../../../utils/Logger';
import { getRenderer, isWebGPURenderer } from '../../render/Renderer';
import { getCurrentSceneId } from '../../scene/Scene';
import { getConfig } from '../../config/Config';
import { getReadOnlyLoopState, toggleMainPlay } from '../../loop/MainLoop';
import { runDeviceCapabilityCheckAsync } from '../DeviceCapabilities';
import type { DeviceGpuBenchmark } from '../DeviceCapabilitiesTypes';
import { readBrowserProbeEnv, requestProbeAdapterAsync } from '../DeviceProbe';
import { estimateFps, resolveDeviceTargets } from '../DeviceScoring';
import { type GpuBenchmarkBatch, runGpuBenchmarkAsync } from '../GpuBenchmark';

const DEFAULT_WARM_UP_FRAMES = 30;
const DEFAULT_SAMPLE_FRAMES = 120;
/** The pixel ratios sampled, as shares of the renderer's own */
const PIXEL_RATIO_SCALES = [1, 0.7, 0.5];
/** How long a sample waits for its first frame time, and for all of them, ms */
const FIRST_FRAME_TIMEOUT_MS = 4000;
const SAMPLE_TIMEOUT_MS = 30000;

/** How far a sample's GPU time may pass its frame interval before it's marked as overcounted */
const GPU_OVER_FRAME_TOLERANCE = 1.1;
/** How far a sample's frame interval must pass the refresh interval to be under the refresh rate */
const UNDER_REFRESH_TOLERANCE = 1.1;
/** The share of the frame interval under which a trusted GPU time leaves the frame CPU-bound */
const CPU_BOUND_GPU_SHARE = 0.7;

/**
 * What held a sample's frame rate: the refresh rate (`REFRESH`: the GPU idles between frames, at
 * a lower clock), the CPU (`CPU`: under the refresh rate, the GPU time well under the interval) or
 * the GPU (`GPU`: under the refresh rate otherwise, an overcounted GPU time included); null without
 * a refresh rate.
 */
export const classifyCalibrationSample = (
  sample: { gpuMs: number; frameMs: number },
  refreshHz: number | null
): 'GPU' | 'CPU' | 'REFRESH' | null => {
  if (!refreshHz) return null;
  if (sample.frameMs <= (1000 / refreshHz) * UNDER_REFRESH_TOLERANCE) return 'REFRESH';
  return sample.gpuMs < sample.frameMs * CPU_BOUND_GPU_SHARE ? 'CPU' : 'GPU';
};

/** A frame sample: the mean GPU ms, frame interval ms, triangles and draw calls of its frames */
export type CalibrationFrameSample = {
  gpuMs: number;
  frameMs: number;
  triangles: number;
  drawCalls: number;
};

/** One pixel ratio's sample, with the reference frame's prediction at its pixels */
export type CalibrationSizeSample = CalibrationFrameSample & {
  pixelRatio: number;
  /** The drawing buffer, pixels */
  width: number;
  height: number;
  predictedMs: number | null;
  /** What held the frame rate ({@link classifyCalibrationSample}): only `GPU` is fitted */
  limitedBy: ReturnType<typeof classifyCalibrationSample>;
  /** The frame interval ÷ predicted for a GPU-bound sample (1 is a perfect prediction), else null:
   * a frame held by the refresh rate or the CPU doesn't show the GPU's time */
  observedOverPredicted: number | null;
  /** The GPU time is over the frame interval, so it isn't the frame's GPU time (summed passes
   * overcounting on a tile-based GPU) */
  isGpuTimeOverFrame: boolean;
};

/** {@link measureDeviceCalibrationAsync}'s result: one machine's row of the calibration table */
export type DeviceCalibration = {
  machine: string;
  api: 'WEBGPU' | 'WEBGL2';
  sceneId: string | null;
  refreshHz: number | null;
  cpuScore: number | null;
  /** The benchmark's throughputs */
  fillRateMPixOpsPerMs: number;
  trianglesPerMs: number;
  samples: CalibrationSizeSample[];
  /** The reference frame that fits the GPU-bound samples (the scene's own triangles); null when
   * none is */
  fit: ReturnType<typeof fitReferenceFrame> | null;
};

/**
 * The reference frame that fits samples of one scene at several sizes: the frame's time less the
 * triangles' (at the benchmark's rate) as a least-squares line over the megapixels, its slope × the
 * fill rate the fill passes, its intercept × the fill rate the fixed work (each 0 at least), and
 * the samples' mean triangles. One sample (or one size) can't tell the two apart: it keeps
 * `fixedMPixOps` (default 0) and fits the passes.
 */
export const fitReferenceFrame = (
  benchmark: Pick<DeviceGpuBenchmark, 'fillRateMPixOpsPerMs' | 'trianglesPerMs'>,
  samples: { pixels: number; ms: number; triangles: number }[],
  fixedMPixOps = 0
) => {
  const points = samples.map((sample) => ({
    x: sample.pixels / 1e6,
    y: sample.ms - sample.triangles / benchmark.trianglesPerMs,
  }));
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  const varX = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  let slope: number;
  let intercept: number;
  if (varX > 0) {
    slope = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / varX;
    intercept = meanY - slope * meanX;
  } else {
    intercept = fixedMPixOps / benchmark.fillRateMPixOpsPerMs;
    slope = (meanY - intercept) / meanX;
  }
  const round1 = (value: number) => Math.round(Math.max(0, value) * 10) / 10;
  return {
    fixedMPixOps: round1(intercept * benchmark.fillRateMPixOpsPerMs),
    fullscreenPasses: round1(slope * benchmark.fillRateMPixOpsPerMs),
    trianglesPerFrame: Math.round(samples.reduce((sum, s) => sum + s.triangles, 0) / n),
  };
};

/** The mean GPU ms, triangles and draw calls of `frames` frames after `warmUpFrames`, and the mean
 * frame interval over them (animation frames, which every rendered frame is); null when no frame
 * time comes (no timer queries, a paused loop) */
const sampleFramesAsync = (warmUpFrames: number, frames: number) =>
  new Promise<CalibrationFrameSample | null>((resolve) => {
    let seen = 0;
    const sum = { gpuMs: 0, triangles: 0, drawCalls: 0 };
    // The animation frames from the first sampled frame time on
    let intervalStartedAt: number | null = null;
    let animationFrames = 0;
    let rafId = 0;
    const countFrame = () => {
      animationFrames++;
      rafId = requestAnimationFrame(countFrame);
    };
    const end = (sample: CalibrationFrameSample | null) => {
      clearTimeout(firstFrameTimer);
      clearTimeout(sampleTimer);
      cancelAnimationFrame(rafId);
      stop();
      resolve(sample);
    };
    const stop = onGpuFrameTime((gpuMs) => {
      if (seen++ === 0) clearTimeout(firstFrameTimer);
      if (seen <= warmUpFrames) return;
      if (intervalStartedAt === null) {
        intervalStartedAt = performance.now();
        rafId = requestAnimationFrame(countFrame);
      }
      // The renderer's counts are the last rendered frame's: alike while the scene doesn't change
      const info = getRenderer()?.info.render;
      sum.gpuMs += gpuMs;
      sum.triangles += info?.triangles ?? 0;
      sum.drawCalls += info?.drawCalls ?? 0;
      const count = seen - warmUpFrames;
      if (count < frames) return;
      end({
        gpuMs: sum.gpuMs / count,
        frameMs: (performance.now() - intervalStartedAt) / Math.max(1, animationFrames),
        triangles: Math.round(sum.triangles / count),
        drawCalls: Math.round(sum.drawCalls / count),
      });
    });
    const firstFrameTimer = setTimeout(() => end(null), FIRST_FRAME_TIMEOUT_MS);
    const sampleTimer = setTimeout(() => end(null), SAMPLE_TIMEOUT_MS);
  });

/** The adapter as one line: its vendor, architecture and description, and WebGL's renderer */
const describeMachine = (gpu: {
  vendor: string | null;
  architecture: string | null;
  description: string | null;
  webgl2: { unmaskedRenderer: string | null } | null;
}) =>
  [gpu.vendor, gpu.architecture, gpu.description, gpu.webgl2?.unmaskedRenderer]
    .filter(Boolean)
    .join(' / ') || 'unknown';

/**
 * Measures the running scene against the device capability check's prediction: benchmarks first
 * when the last report has no GPU benchmark or `rebenchmark` asks (the main loop paused meanwhile),
 * then samples the scene's GPU frame time and frame interval at the renderer's pixel ratio, 0.7 ×
 * it and 0.5 × it (put back after), fits the reference frame to the GPU-bound samples' frame
 * intervals (with one size, the passes alone at the reference frame's fixed work), and logs and
 * returns the calibration row. A scene that holds the refresh rate at every ratio fits nothing: a
 * higher pixel ratio, or a heavier scene, makes it GPU-bound.
 * @param opts.warmUpFrames frames let pass first at each ratio (default 30)
 * @param opts.frames frames averaged at each ratio (default 120)
 * @param opts.rebenchmark measure the benchmark again now and store it, not the stored one (default
 * false). Right after the scene, a GPU still clocked up can read above a cold check (an M2 up to
 * 1.4×): the boot's reading is the one the check rates with
 * @throws when there's no renderer, no GPU benchmark or no frame time (no timer queries)
 */
export const measureDeviceCalibrationAsync = async (
  opts: { warmUpFrames?: number; frames?: number; rebenchmark?: boolean } = {}
): Promise<DeviceCalibration> => {
  const renderer = getRenderer();
  if (!renderer) throw new Error('Device calibration: no renderer.');
  // A stored benchmarked result serves unless asked; one without a benchmark is measured again
  const report = await runDeviceCapabilityCheckAsync({
    benchmark: true,
    force: opts.rebenchmark ?? false,
  });
  const benchmark = report.measurements.benchmark?.gpu;
  if (!benchmark)
    throw new Error('Device calibration: the GPU benchmark failed (see the warning).');
  const { referenceFrame } = resolveDeviceTargets(getConfig().deviceCapabilities?.targets);
  const { refreshHz } = report.measurements.display;

  const ownPixelRatio = renderer.getPixelRatio();
  const samples: CalibrationSizeSample[] = [];
  try {
    for (const scale of PIXEL_RATIO_SCALES) {
      renderer.setPixelRatio(ownPixelRatio * scale);
      const sample = await sampleFramesAsync(
        opts.warmUpFrames ?? DEFAULT_WARM_UP_FRAMES,
        opts.frames ?? DEFAULT_SAMPLE_FRAMES
      );
      if (!sample) {
        throw new Error(
          'Device calibration: no GPU frame time came (the GPU needs timer queries, and the loop must run).'
        );
      }
      const { width, height } = renderer.domElement;
      const predictedFps = estimateFps(benchmark, width * height, referenceFrame);
      const predictedMs = predictedFps ? 1000 / predictedFps : null;
      const limitedBy = classifyCalibrationSample(sample, refreshHz);
      samples.push({
        pixelRatio: renderer.getPixelRatio(),
        width,
        height,
        gpuMs: Math.round(sample.gpuMs * 1000) / 1000,
        frameMs: Math.round(sample.frameMs * 1000) / 1000,
        triangles: sample.triangles,
        drawCalls: sample.drawCalls,
        predictedMs: predictedMs !== null ? Math.round(predictedMs * 1000) / 1000 : null,
        limitedBy,
        observedOverPredicted:
          predictedMs !== null && limitedBy === 'GPU'
            ? Math.round((sample.frameMs / predictedMs) * 100) / 100
            : null,
        isGpuTimeOverFrame: sample.gpuMs > sample.frameMs * GPU_OVER_FRAME_TOLERANCE,
      });
    }
  } finally {
    renderer.setPixelRatio(ownPixelRatio);
  }

  const fitted = samples.filter((s) => s.limitedBy === 'GPU');
  if (fitted.length < samples.length) {
    const reasons = samples
      .filter((s) => s.limitedBy !== 'GPU')
      .map((s) => `ratio ${s.pixelRatio.toFixed(2)}: ${s.limitedBy ?? 'no refresh rate'}`)
      .join(', ');
    llog(
      `Device calibration: ${samples.length - fitted.length} of ${samples.length} samples aren't GPU-bound, left out of the fit (${reasons}).`
    );
  }
  const calibration: DeviceCalibration = {
    machine: describeMachine(report.measurements.gpu),
    api: isWebGPURenderer() ? 'WEBGPU' : 'WEBGL2',
    sceneId: getCurrentSceneId() ?? null,
    refreshHz,
    cpuScore: report.measurements.cpu.benchScore,
    fillRateMPixOpsPerMs: Math.round(benchmark.fillRateMPixOpsPerMs * 100) / 100,
    trianglesPerMs: benchmark.trianglesPerMs,
    samples,
    fit: fitted.length
      ? fitReferenceFrame(
          benchmark,
          fitted.map((s) => ({
            pixels: s.width * s.height,
            ms: s.frameMs,
            triangles: s.triangles,
          })),
          referenceFrame.fixedMPixOps
        )
      : null,
  };
  if (calibration.api !== benchmark.api) {
    llog(
      `Device calibration: the renderer is on ${calibration.api}, the benchmark measured ${benchmark.api}.`
    );
  }
  llog('Device calibration:', JSON.stringify(calibration, null, 2));
  return calibration;
};

/** One run of {@link traceGpuBenchmarkAsync}: the benchmark's result and every batch it ran */
export type GpuBenchmarkTraceRun = {
  result: DeviceGpuBenchmark | null;
  batches: GpuBenchmarkBatch[];
};

/**
 * Runs the GPU benchmark `runs` times back to back (each on a device of its own, the main loop
 * paused meanwhile when it plays) at the renderer's drawing buffer size, after `idleMs` with the
 * GPU idle (as the check's refresh rate sampling leaves it), and logs every batch: its workload,
 * count, wall time, timer query reading, the time kept and its rate. What a reading that repeats
 * to the digit, or rates a GPU far below its scenes, is made of: a timer snapping to a clock's
 * steps (Dawn's 2^16 ns), a GPU clocked down when idle, or the workload itself. Nothing is stored.
 * @param opts.runs benchmark runs (default 2)
 * @param opts.budgetMs each run's GPU budget, ms (default 1000, about the check's)
 * @param opts.idleMs the idle time before the first run, ms (default 500)
 * @param opts.api the API to measure (default WebGPU when there's an adapter, else WebGL2)
 */
export const traceGpuBenchmarkAsync = async (
  opts: {
    runs?: number;
    budgetMs?: number;
    idleMs?: number;
    api?: DeviceGpuBenchmark['api'];
  } = {}
): Promise<GpuBenchmarkTraceRun[]> => {
  const probeEnv = readBrowserProbeEnv();
  const adapter = await requestProbeAdapterAsync(probeEnv);
  const api = opts.api ?? (adapter ? 'WEBGPU' : 'WEBGL2');
  const canvas = getRenderer()?.domElement;
  const width = canvas?.width || Math.round(window.innerWidth * window.devicePixelRatio);
  const height = canvas?.height || Math.round(window.innerHeight * window.devicePixelRatio);
  const now = () => performance.now();

  const { masterPlay, isMasterPlaying } = getReadOnlyLoopState();
  const wasPlaying = masterPlay && isMasterPlaying;
  if (wasPlaying) toggleMainPlay(false);
  const runs: GpuBenchmarkTraceRun[] = [];
  try {
    await new Promise((resolve) => setTimeout(resolve, opts.idleMs ?? 500));
    for (let i = 0; i < (opts.runs ?? 2); i++) {
      const batches: GpuBenchmarkBatch[] = [];
      const result = await runGpuBenchmarkAsync({
        api,
        // An adapter makes one device: each run requests its own (the first, the one above)
        adapter: api === 'WEBGPU' && i === 0 ? adapter : null,
        requestAdapterAsync: () => requestProbeAdapterAsync(probeEnv),
        createWebGL2Context: probeEnv.createWebGL2Context,
        width,
        height,
        deadline: now() + (opts.budgetMs ?? 1000),
        now,
        onBatchTiming: (batch) => batches.push(batch),
      });
      runs.push({ result, batches });
    }
  } finally {
    if (wasPlaying && !getReadOnlyLoopState().masterPlay) toggleMainPlay(true);
  }

  const round3 = (value: number | null) =>
    value === null ? null : Math.round(value * 1000) / 1000;
  runs.forEach((run, i) => {
    llog(
      `GPU benchmark trace, run ${i + 1} (${api}, ${width}×${height}):`,
      JSON.stringify(run.result)
    );
    // The benchmark's own (clamped) target size
    const pixels = run.result ? run.result.width * run.result.height : width * height;
    // eslint-disable-next-line no-console -- a debug tool's table, read in the console
    console.table(
      run.batches.map((b) => ({
        workload: b.workload + (b.isWarmUp ? ' (warm-up)' : ''),
        count: b.count,
        wallMs: round3(b.wallMs),
        queryMs: round3(b.queryMs),
        keptMs: round3(b.ms),
        kept: b.usedTimestampQuery ? 'query' : 'wall',
        // MPix-ops/ms, or thousands of triangles/ms
        rate: round3(
          b.workload === 'FILL' ? (b.count * pixels) / 1e6 / b.ms : b.count / 1000 / b.ms
        ),
      }))
    );
  });
  return runs;
};
