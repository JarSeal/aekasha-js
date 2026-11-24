// The device capability check's calibration (p240 Phase 2, section 3; debug env): the current
// scene's real GPU frame time (`onGpuFrameTime`, the mean of a number of frames after a warm-up)
// at three renderer pixel ratios, its triangles and draw calls, next to what the check predicts
// for the reference frame at the same pixels, and the reference frame fitted to it: the GPU time
// less its triangles' is a line over the pixels, whose slope is the fill passes and whose
// intercept the fixed work. Run it from the browser's console in `yarn dev` (`?isDebug=true`)
// with the scene running:
//   (await import('/_engine/kernel/deviceCapabilities/debug/_dbg__DeviceCalibration.ts'))
//     .measureDeviceCalibrationAsync()
// GPU time, not frames per second: a frame rate is capped at the display's refresh rate, the GPU's
// time isn't. On WebGPU the passes' times are summed, which overestimates a frame of several
// dependent passes on a tile-based GPU (Apple silicon, mobile): say so with its figures.
import { onGpuFrameTime } from '../../../debug/GPUFrameTime';
import { llog } from '../../../utils/Logger';
import { getRenderer, isWebGPURenderer } from '../../render/Renderer';
import { getCurrentSceneId } from '../../scene/Scene';
import { getConfig } from '../../config/Config';
import { runDeviceCapabilityCheckAsync } from '../DeviceCapabilities';
import type { DeviceGpuBenchmark } from '../DeviceCapabilitiesTypes';
import { estimateFps, resolveDeviceTargets } from '../DeviceScoring';

const DEFAULT_WARM_UP_FRAMES = 30;
const DEFAULT_SAMPLE_FRAMES = 120;
/** The pixel ratios sampled, as shares of the renderer's own */
const PIXEL_RATIO_SCALES = [1, 0.7, 0.5];
/** How long a sample waits for its first frame time, and for all of them, ms */
const FIRST_FRAME_TIMEOUT_MS = 4000;
const SAMPLE_TIMEOUT_MS = 30000;

/** A frame sample: the mean GPU ms, triangles and draw calls of its frames */
export type CalibrationFrameSample = { gpuMs: number; triangles: number; drawCalls: number };

/** One pixel ratio's sample, with the reference frame's prediction at its pixels */
export type CalibrationSizeSample = CalibrationFrameSample & {
  pixelRatio: number;
  /** The drawing buffer, pixels */
  width: number;
  height: number;
  predictedMs: number | null;
  /** observed ÷ predicted: 1 is a perfect prediction */
  observedOverPredicted: number | null;
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
  /** The reference frame that fits the samples (the scene's own triangles) */
  fit: ReturnType<typeof fitReferenceFrame>;
};

/**
 * The reference frame that fits samples of one scene at several sizes: the GPU time less the
 * triangles' (at the benchmark's rate) as a least-squares line over the megapixels, its slope × the
 * fill rate the fill passes, its intercept × the fill rate the fixed work (each 0 at least), and
 * the samples' mean triangles. One sample (or one size) fits the passes alone, the fixed work 0.
 */
export const fitReferenceFrame = (
  benchmark: Pick<DeviceGpuBenchmark, 'fillRateMPixOpsPerMs' | 'trianglesPerMs'>,
  samples: { pixels: number; gpuMs: number; triangles: number }[]
) => {
  const points = samples.map((sample) => ({
    x: sample.pixels / 1e6,
    y: sample.gpuMs - sample.triangles / benchmark.trianglesPerMs,
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
    slope = meanY / meanX;
    intercept = 0;
  }
  const round1 = (value: number) => Math.round(Math.max(0, value) * 10) / 10;
  return {
    fixedMPixOps: round1(intercept * benchmark.fillRateMPixOpsPerMs),
    fullscreenPasses: round1(slope * benchmark.fillRateMPixOpsPerMs),
    trianglesPerFrame: Math.round(samples.reduce((sum, s) => sum + s.triangles, 0) / n),
  };
};

/** The mean GPU ms, triangles and draw calls of `frames` frames after `warmUpFrames`; null when
 * no frame time comes (no timer queries, a paused loop) */
const sampleFramesAsync = (warmUpFrames: number, frames: number) =>
  new Promise<CalibrationFrameSample | null>((resolve) => {
    let seen = 0;
    const sum = { gpuMs: 0, triangles: 0, drawCalls: 0 };
    const end = (sample: CalibrationFrameSample | null) => {
      clearTimeout(firstFrameTimer);
      clearTimeout(sampleTimer);
      stop();
      resolve(sample);
    };
    const stop = onGpuFrameTime((gpuMs) => {
      if (seen++ === 0) clearTimeout(firstFrameTimer);
      if (seen <= warmUpFrames) return;
      // The renderer's counts are the last rendered frame's: alike while the scene doesn't change
      const info = getRenderer()?.info.render;
      sum.gpuMs += gpuMs;
      sum.triangles += info?.triangles ?? 0;
      sum.drawCalls += info?.drawCalls ?? 0;
      const count = seen - warmUpFrames;
      if (count < frames) return;
      end({
        gpuMs: sum.gpuMs / count,
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
 * when the last report has no GPU benchmark (the main loop paused meanwhile), then samples the
 * scene's GPU frame time at the renderer's pixel ratio, 0.7 × it and 0.5 × it (put back after),
 * fits the reference frame to them, and logs and returns the calibration row.
 * @param opts.warmUpFrames frames let pass first at each ratio (default 30)
 * @param opts.frames frames averaged at each ratio (default 120)
 * @throws when there's no renderer, no GPU benchmark or no frame time (no timer queries)
 */
export const measureDeviceCalibrationAsync = async (
  opts: { warmUpFrames?: number; frames?: number } = {}
): Promise<DeviceCalibration> => {
  const renderer = getRenderer();
  if (!renderer) throw new Error('Device calibration: no renderer.');
  // A stored benchmarked result serves; one without a benchmark is measured again
  const report = await runDeviceCapabilityCheckAsync({ benchmark: true });
  const benchmark = report.measurements.benchmark?.gpu;
  if (!benchmark)
    throw new Error('Device calibration: the GPU benchmark failed (see the warning).');
  const { referenceFrame } = resolveDeviceTargets(getConfig().deviceCapabilities?.targets);

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
      samples.push({
        pixelRatio: renderer.getPixelRatio(),
        width,
        height,
        gpuMs: Math.round(sample.gpuMs * 1000) / 1000,
        triangles: sample.triangles,
        drawCalls: sample.drawCalls,
        predictedMs: predictedMs !== null ? Math.round(predictedMs * 1000) / 1000 : null,
        observedOverPredicted:
          predictedMs !== null ? Math.round((sample.gpuMs / predictedMs) * 100) / 100 : null,
      });
    }
  } finally {
    renderer.setPixelRatio(ownPixelRatio);
  }

  const calibration: DeviceCalibration = {
    machine: describeMachine(report.measurements.gpu),
    api: isWebGPURenderer() ? 'WEBGPU' : 'WEBGL2',
    sceneId: getCurrentSceneId() ?? null,
    refreshHz: report.measurements.display.refreshHz,
    cpuScore: report.measurements.cpu.benchScore,
    fillRateMPixOpsPerMs: Math.round(benchmark.fillRateMPixOpsPerMs * 100) / 100,
    trianglesPerMs: benchmark.trianglesPerMs,
    samples,
    fit: fitReferenceFrame(
      benchmark,
      samples.map((s) => ({ pixels: s.width * s.height, gpuMs: s.gpuMs, triangles: s.triangles }))
    ),
  };
  if (calibration.api !== benchmark.api) {
    llog(
      `Device calibration: the renderer is on ${calibration.api}, the benchmark measured ${benchmark.api}.`
    );
  }
  llog('Device calibration:', JSON.stringify(calibration, null, 2));
  return calibration;
};
