// The device capability check's scoring (p240 §3.1, §5 step 5): the measurements rated into
// device levels, checked against the targets, and turned into suggested settings. Pure functions:
// a stored result is scored again on every read, so new targets need no new measuring.
import { deepMerge } from '../../utils/DeepMerge';
import { compareQualityLevels, minQualityLevel, type QualityLevel } from '../../utils/QualityLevel';
import type {
  DeviceCapabilityCheck,
  DeviceCapabilityChecks,
  DeviceCapabilityMeasurements,
  DeviceCapabilityRecommendations,
  DeviceCapabilityTargets,
  DeviceCapabilityVerdict,
  DeviceCheckResult,
  DeviceGpuBenchmark,
  DeviceLevelBands,
  DeviceLevelCategory,
  DeviceLevels,
  DeviceLevelThresholds,
  ResolvedDeviceCapabilityTargets,
  ResolvedDeviceLevelThresholds,
} from './DeviceCapabilitiesTypes';

/**
 * The most `navigator.deviceMemory` reported, GB, before Chrome reported more: a reading of it may
 * be capped (the device may have more), so it doesn't lower the overall level, and a higher memory
 * target is checked as `UNKNOWN` against it.
 * @internal
 */
export const DEVICE_MEMORY_CAP_GB = 8;

/**
 * The pixel ratios the solver tries, down from the device's own (none over it).
 * @internal
 */
export const PIXEL_RATIO_STEPS = [2, 1.75, 1.5, 1.25, 1, 0.75, 0.5];

/**
 * The engine's targets, under `AppConfig.deviceCapabilities.targets` and a check's own.
 * @internal
 */
export const DEFAULT_DEVICE_TARGETS: ResolvedDeviceCapabilityTargets = {
  fps: 60,
  resolution: 'CANVAS',
  // Fitted to the example app's game-like scenes (the gym, the terrain showcase, the large world:
  // p240 Phase 2's calibration table), within 25 % of their GPU time from 540p to 1080p
  referenceFrame: { fixedMPixOps: 16, fullscreenPasses: 18, trianglesPerFrame: 500_000 },
  minDeviceMemoryGB: 4,
  minGPUMemoryMB: 2048,
  minCpuCores: 4,
  requireWebGPU: false,
  requiredGPUFeatures: [],
  minLevels: {},
  unknownIs: 'PASS',
};

/**
 * The engine's level thresholds (p240 §3.1), under `AppConfig.deviceCapabilities.levelThresholds`.
 * @internal
 */
export const DEFAULT_DEVICE_LEVEL_THRESHOLDS: ResolvedDeviceLevelThresholds = {
  // The reference frame is fitted to scenes of HIGH shadows and the AO PostFX, so holding it at
  // the target is HIGH; ULTRA at twice it keeps a desktop discrete GPU ULTRA up to 4K (p240
  // Phase 2's calibration)
  gpuHeadroom: { MEDIUM: 0.5, HIGH: 1, ULTRA: 2 },
  cpuCores: { MEDIUM: 4, HIGH: 6, ULTRA: 12 },
  // One main-thread core: a 2022+ desktop or Apple silicon core scores 25-27k
  cpuBenchScore: { MEDIUM: 6000, HIGH: 12000, ULTRA: 20000 },
  deviceMemoryGB: { MEDIUM: 4, HIGH: 8, ULTRA: 16 },
  gpuMemoryMB: { MEDIUM: 1024, HIGH: 2048, ULTRA: 4096 },
};

/**
 * The targets with each layer merged over the engine's, in order (the config's, then a check's):
 * objects key by key, a list (`requiredGPUFeatures`) replaced whole.
 * @internal
 */
export const resolveDeviceTargets = (
  ...layers: (DeviceCapabilityTargets | undefined)[]
): ResolvedDeviceCapabilityTargets =>
  layers.reduce<ResolvedDeviceCapabilityTargets>(
    (resolved, layer) => deepMerge(resolved, layer),
    deepMerge(DEFAULT_DEVICE_TARGETS, undefined)
  );

/**
 * The level thresholds with each layer merged over the engine's, band by band.
 * @internal
 */
export const resolveDeviceLevelThresholds = (
  ...layers: (DeviceLevelThresholds | undefined)[]
): ResolvedDeviceLevelThresholds =>
  layers.reduce<ResolvedDeviceLevelThresholds>(
    (resolved, layer) => deepMerge(resolved, layer),
    deepMerge(DEFAULT_DEVICE_LEVEL_THRESHOLDS, undefined)
  );

/**
 * The highest level whose band `value` meets; `LOW` under every band.
 * @internal
 */
export const rateLevel = (value: number, bands: DeviceLevelBands): QualityLevel => {
  if (bands.ULTRA !== undefined && value >= bands.ULTRA) return 'ULTRA';
  if (bands.HIGH !== undefined && value >= bands.HIGH) return 'HIGH';
  if (bands.MEDIUM !== undefined && value >= bands.MEDIUM) return 'MEDIUM';
  return 'LOW';
};

/** A reading as 0-100 of its highest band, null without a reading or a band. */
const scoreReading = (value: number | null, bands: DeviceLevelBands) => {
  const top = bands.ULTRA ?? bands.HIGH ?? bands.MEDIUM;
  if (value === null || !top) return null;
  return Math.round(Math.min(100, (value / top) * 100));
};

/** The lower of two scores, either missing. */
const minScore = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);

/**
 * The canvas the check scores for: its size in CSS pixels (`getCanvasSize`, or a fallback when it
 * has none) and the device's pixel ratio.
 * @internal
 */
export type DeviceScoringCanvas = { width: number; height: number };

/**
 * The target resolution in pixels: `'CANVAS'` is the canvas's size × `devicePixelRatio`, rounded.
 * @internal
 */
export const resolveTargetPixelSize = (
  resolution: ResolvedDeviceCapabilityTargets['resolution'],
  canvas: DeviceScoringCanvas,
  devicePixelRatio: number
) =>
  resolution === 'CANVAS'
    ? {
        width: Math.round(canvas.width * devicePixelRatio),
        height: Math.round(canvas.height * devicePixelRatio),
      }
    : { width: resolution.width, height: resolution.height };

/**
 * The reference frame's predicted GPU time over `pixels`, ms: its fixed work and its fill at the
 * benchmark's fill rate plus its triangles at the triangle rate (p240 §1.2).
 * @internal
 * @returns the time, null without throughputs to predict from
 */
export const predictFrameMs = (
  benchmark: DeviceGpuBenchmark,
  pixels: number,
  frame: ResolvedDeviceCapabilityTargets['referenceFrame']
) => {
  if (!(benchmark.fillRateMPixOpsPerMs > 0) || !(benchmark.trianglesPerMs > 0)) return null;
  const fillMs =
    (frame.fixedMPixOps + (frame.fullscreenPasses * pixels) / 1e6) / benchmark.fillRateMPixOpsPerMs;
  const geometryMs = frame.trianglesPerFrame / benchmark.trianglesPerMs;
  const frameMs = fillMs + geometryMs;
  return frameMs > 0 ? frameMs : null;
};

/**
 * The frame rate predicted for the reference frame over `pixels` (`predictFrameMs`), rounded
 * to 0.1.
 * @internal
 * @returns the frame rate, null without throughputs to predict from
 */
export const estimateFps = (
  benchmark: DeviceGpuBenchmark,
  pixels: number,
  frame: ResolvedDeviceCapabilityTargets['referenceFrame']
) => {
  const frameMs = predictFrameMs(benchmark, pixels, frame);
  return frameMs === null ? null : Math.round((1000 / frameMs) * 10) / 10;
};

/**
 * The largest pixel ratio, from the device's own down {@link PIXEL_RATIO_STEPS}, at which the
 * reference frame's predicted frame rate over the canvas holds `fps`; the smallest step when none
 * does.
 * @internal
 */
export const solvePixelRatio = (
  benchmark: DeviceGpuBenchmark,
  canvas: DeviceScoringCanvas,
  devicePixelRatio: number,
  frame: ResolvedDeviceCapabilityTargets['referenceFrame'],
  fps: number
) => {
  const ratios = [devicePixelRatio, ...PIXEL_RATIO_STEPS.filter((r) => r < devicePixelRatio)];
  for (const ratio of ratios) {
    const pixels = canvas.width * ratio * canvas.height * ratio;
    const estimated = estimateFps(benchmark, pixels, frame);
    if (estimated !== null && estimated >= fps) return ratio;
  }
  return ratios[ratios.length - 1];
};

/**
 * The GPU's level from its adapter alone (p240 §3.1, the benchmark off): `LOW` for software or no
 * GPU API, `MEDIUM` for WebGL2 only or an integrated GPU, `HIGH` for a discrete or unified-memory
 * one, `MEDIUM` when it can't be told. Never `ULTRA`: only a benchmark can rate that.
 * @internal
 */
export const rateGpuHeuristic = (gpu: DeviceCapabilityMeasurements['gpu']): QualityLevel => {
  if (gpu.api === 'NONE' || gpu.isFallbackAdapter) return 'LOW';
  if (gpu.api === 'WEBGL2') return 'MEDIUM';
  if (gpu.isUnifiedMemory || gpu.isIntegrated === false) return 'HIGH';
  return 'MEDIUM';
};

/**
 * The device's levels per category and overall (p240 §3.1): the GPU's from its benchmark headroom
 * (`gpuHeadroom`, null when not benchmarked: from the adapter then). The overall level is the
 * lowest of the categories that were measured: an unknown one is skipped, and so is a memory
 * reading of 8 GB (an older browser's cap: it may be more).
 * @internal
 */
export const rateDeviceLevels = (
  measurements: DeviceCapabilityMeasurements,
  thresholds: ResolvedDeviceLevelThresholds,
  gpuHeadroom: number | null = null
): DeviceLevels => {
  const { cores, benchScore } = measurements.cpu;
  const { deviceMemoryGB } = measurements.memory;
  const gpuMemoryMB = measurements.gpuMemoryMB.value;

  const gpu =
    gpuHeadroom !== null
      ? rateLevel(gpuHeadroom, thresholds.gpuHeadroom)
      : rateGpuHeuristic(measurements.gpu);
  // The lower of the cores' and the score's. Neither known rates MEDIUM, the level of the common
  // case, and doesn't count toward the overall
  const isCpuKnown = cores !== null || benchScore !== null;
  const cpu = isCpuKnown
    ? (minQualityLevel(
        cores !== null ? rateLevel(cores, thresholds.cpuCores) : null,
        benchScore !== null ? rateLevel(benchScore, thresholds.cpuBenchScore) : null
      ) as QualityLevel)
    : 'MEDIUM';
  const memory =
    deviceMemoryGB !== null ? rateLevel(deviceMemoryGB, thresholds.deviceMemoryGB) : null;
  const gpuMemory = gpuMemoryMB !== null ? rateLevel(gpuMemoryMB, thresholds.gpuMemoryMB) : null;
  const isMemoryCapped = deviceMemoryGB === DEVICE_MEMORY_CAP_GB;

  const overall = minQualityLevel(
    gpu,
    isCpuKnown ? cpu : null,
    isMemoryCapped ? null : memory,
    gpuMemory
  ) as QualityLevel; // the GPU's level is always set

  return {
    overall,
    gpu,
    cpu,
    memory,
    gpuMemory,
    sources: {
      gpu: gpuHeadroom !== null ? 'BENCHMARK' : 'HEURISTIC',
      cpu: benchScore !== null ? 'BENCHMARK' : cores !== null ? 'API' : 'UNKNOWN',
      memory: memory !== null ? 'API' : 'UNKNOWN',
      gpuMemory: gpuMemory !== null ? 'HEURISTIC' : 'UNKNOWN',
    },
    forced: false,
  };
};

/**
 * The debug tab's forced levels (p240 Phase 3), by category and overall; a category left out keeps
 * the device's level.
 * @internal
 */
export type ForcedDeviceLevels = Partial<Record<DeviceLevelCategory | 'overall', QualityLevel>>;

/**
 * The levels with the forced ones in place (`forced: true` when any is): a forced category takes
 * its level; a forced `overall` sets every category not forced on its own (an unknown one stays
 * unknown), so the recommendations follow it. The overall level is then the lowest again, a forced
 * category counted even where the device's wouldn't be (an unknown CPU, a memory reading of 8 GB).
 * The sources stay the device's.
 * @internal
 */
export const applyForcedDeviceLevels = (
  levels: DeviceLevels,
  forced: ForcedDeviceLevels,
  measurements: DeviceCapabilityMeasurements
): DeviceLevels => {
  if (!Object.values(forced).some(Boolean)) return levels;
  const { overall } = forced;
  const gpu = forced.gpu ?? overall ?? levels.gpu;
  const cpu = forced.cpu ?? overall ?? levels.cpu;
  const memory = forced.memory ?? (levels.memory === null ? null : overall ?? levels.memory);
  const gpuMemory =
    forced.gpuMemory ?? (levels.gpuMemory === null ? null : overall ?? levels.gpuMemory);
  const isCpuCounted = Boolean(forced.cpu ?? overall) || levels.sources.cpu !== 'UNKNOWN';
  const isMemoryCounted =
    Boolean(forced.memory ?? overall) ||
    measurements.memory.deviceMemoryGB !== DEVICE_MEMORY_CAP_GB;
  return {
    overall: minQualityLevel(
      gpu,
      isCpuCounted ? cpu : null,
      isMemoryCounted ? memory : null,
      gpuMemory
    ) as QualityLevel, // the GPU's level is always set
    gpu,
    cpu,
    memory,
    gpuMemory,
    sources: levels.sources,
    forced: true,
  };
};

/**
 * The settings suggested for the levels (a debug override's levels too): the pixel ratio solved
 * against the frame rate (`solvedPixelRatio`; without one, by the GPU's level), the antialias and
 * PostFX by the GPU's level, the shadow quality the lower of the GPU's and the GPU
 * memory's, the backend and the physics target by the device.
 * @internal
 */
export const recommendDeviceSettings = (
  levels: DeviceLevels,
  measurements: DeviceCapabilityMeasurements,
  solvedPixelRatio: number | null = null
): DeviceCapabilityRecommendations => {
  const { gpu } = measurements;
  const dpr = measurements.display.devicePixelRatio || 1;
  const maxPixelRatio = { LOW: 1, MEDIUM: 1.5, HIGH: 2, ULTRA: 2 }[levels.gpu];
  return {
    pixelRatio: solvedPixelRatio ?? Math.min(dpr, maxPixelRatio),
    antialias: compareQualityLevels(levels.gpu, 'HIGH') >= 0,
    shadowQuality: minQualityLevel(levels.gpu, levels.gpuMemory) as QualityLevel,
    postFx: compareQualityLevels(levels.gpu, 'MEDIUM') >= 0,
    renderBackend: gpu.api === 'WEBGPU' && !gpu.isFallbackAdapter ? 'WEBGPU' : 'WEBGL2',
    // A worker needs a core of its own: a LOW CPU (under 4 cores) steps on the main thread
    physicsWorkerTarget: levels.cpu === 'LOW' ? 'MAIN_THREAD' : 'WORKER_THREAD',
  };
};

/** The memory check: a reading of 8 GB (maybe an older browser's cap) is `UNKNOWN` against a
 * higher target. */
const checkDeviceMemory = (measured: number | null, required: number) =>
  measured === DEVICE_MEMORY_CAP_GB && required > DEVICE_MEMORY_CAP_GB
    ? { result: 'UNKNOWN' as const, measured, required }
    : checkAtLeast(measured, required);

/** A numeric check: `UNKNOWN` without a reading. */
const checkAtLeast = (measured: number | null, required: number): DeviceCapabilityCheck => ({
  result: measured === null ? 'UNKNOWN' : measured >= required ? 'PASS' : 'FAIL',
  measured,
  required,
});

/** The `minLevels` check: `FAIL` on a known level under its minimum, else `UNKNOWN` on an unknown
 * one, else `PASS`. Its values list the levels checked, eg. `"overall: HIGH, gpu: HIGH"`. */
const checkMinLevels = (
  levels: DeviceLevels,
  minLevels: ResolvedDeviceCapabilityTargets['minLevels']
): DeviceCapabilityCheck => {
  let result: DeviceCheckResult = 'PASS';
  const measured: string[] = [];
  const required: string[] = [];
  for (const key of Object.keys(minLevels) as (DeviceLevelCategory | 'overall')[]) {
    const min = minLevels[key];
    if (!min) continue;
    const level = levels[key];
    measured.push(`${key}: ${level ?? 'UNKNOWN'}`);
    required.push(`${key}: ${min}`);
    if (level === null) {
      if (result === 'PASS') result = 'UNKNOWN';
    } else if (compareQualityLevels(level, min) < 0) {
      result = 'FAIL';
    }
  }
  return { result, measured: measured.join(', '), required: required.join(', ') };
};

/**
 * The frame rate the `fps` check asks for: the lower of the target and the display's refresh rate
 * (a 60 Hz display never shows more).
 * @internal
 */
export const readEffectiveFpsTarget = (
  measurements: DeviceCapabilityMeasurements,
  targets: ResolvedDeviceCapabilityTargets
) => {
  const refreshHz = measurements.display.refreshHz;
  return refreshHz ? Math.min(targets.fps, refreshHz) : targets.fps;
};

/**
 * Each target's check (p240 §1.1). The `fps` check is `UNKNOWN` without a predicted frame rate (not
 * benchmarked); a memory reading of 8 GB is `UNKNOWN` against a higher target (an older browser's
 * cap).
 * @internal
 */
export const checkDeviceTargets = (
  measurements: DeviceCapabilityMeasurements,
  levels: DeviceLevels,
  targets: ResolvedDeviceCapabilityTargets,
  estimatedFps: number | null = null
) => {
  const { gpu } = measurements;
  const effectiveFpsTarget = readEffectiveFpsTarget(measurements, targets);

  const hasWebGPU = gpu.api === 'WEBGPU';
  const presentFeatures = targets.requiredGPUFeatures.filter((f) => gpu.features.includes(f));

  const checks: DeviceCapabilityChecks = {
    fps: checkAtLeast(estimatedFps, effectiveFpsTarget),
    deviceMemory: checkDeviceMemory(measurements.memory.deviceMemoryGB, targets.minDeviceMemoryGB),
    gpuMemory: checkAtLeast(measurements.gpuMemoryMB.value, targets.minGPUMemoryMB),
    cpuCores: checkAtLeast(measurements.cpu.cores, targets.minCpuCores),
    webgpu: {
      result: !targets.requireWebGPU || hasWebGPU ? 'PASS' : 'FAIL',
      measured: hasWebGPU,
      required: targets.requireWebGPU,
    },
    gpuFeatures: {
      result: presentFeatures.length === targets.requiredGPUFeatures.length ? 'PASS' : 'FAIL',
      measured: presentFeatures.join(', '),
      required: targets.requiredGPUFeatures.join(', '),
    },
    minLevels: checkMinLevels(levels, targets.minLevels),
  };
  return { checks, effectiveFpsTarget };
};

/**
 * The verdict: the measurements rated, checked against the targets and turned into suggested
 * settings, the frame rate predicted at the target resolution (`canvas` for `'CANVAS'` and the
 * pixel ratio's solver). An `UNKNOWN` check counts as `targets.unknownIs` says. With `forced`
 * levels (the debug tab's) the `minLevels` check and the recommendations read them, and a forced
 * GPU level (or overall) suggests its level's pixel ratio, not the solved one.
 * @internal
 */
export const scoreDeviceCapabilities = (
  measurements: DeviceCapabilityMeasurements,
  targets: ResolvedDeviceCapabilityTargets,
  thresholds: ResolvedDeviceLevelThresholds,
  canvas: DeviceScoringCanvas,
  forced: ForcedDeviceLevels | null = null
): DeviceCapabilityVerdict => {
  const gpuBenchmark = measurements.benchmark?.gpu ?? null;
  const dpr = measurements.display.devicePixelRatio || 1;
  const effectiveFpsTarget = readEffectiveFpsTarget(measurements, targets);
  let estimatedFps: number | null = null;
  let solvedPixelRatio: number | null = null;
  if (gpuBenchmark) {
    const size = resolveTargetPixelSize(targets.resolution, canvas, dpr);
    estimatedFps = estimateFps(gpuBenchmark, size.width * size.height, targets.referenceFrame);
    solvedPixelRatio = solvePixelRatio(
      gpuBenchmark,
      canvas,
      dpr,
      targets.referenceFrame,
      effectiveFpsTarget
    );
  }
  const gpuHeadroom = estimatedFps !== null ? estimatedFps / effectiveFpsTarget : null;

  const measuredLevels = rateDeviceLevels(measurements, thresholds, gpuHeadroom);
  const levels = forced
    ? applyForcedDeviceLevels(measuredLevels, forced, measurements)
    : measuredLevels;
  if (forced?.gpu ?? forced?.overall) solvedPixelRatio = null;
  const { checks } = checkDeviceTargets(measurements, levels, targets, estimatedFps);
  const failedTargets = (Object.keys(checks) as (keyof DeviceCapabilityChecks)[]).filter(
    (name) =>
      checks[name].result === 'FAIL' ||
      (checks[name].result === 'UNKNOWN' && targets.unknownIs === 'FAIL')
  );
  return {
    targets,
    checks,
    estimatedFps,
    effectiveFpsTarget,
    meetsTargets: failedTargets.length === 0,
    failedTargets,
    levels,
    scores: {
      gpu: scoreReading(gpuHeadroom, thresholds.gpuHeadroom),
      cpu: minScore(
        scoreReading(measurements.cpu.cores, thresholds.cpuCores),
        scoreReading(measurements.cpu.benchScore, thresholds.cpuBenchScore)
      ),
      memory: scoreReading(measurements.memory.deviceMemoryGB, thresholds.deviceMemoryGB),
      gpuMemory: scoreReading(measurements.gpuMemoryMB.value, thresholds.gpuMemoryMB),
    },
    recommendations: recommendDeviceSettings(levels, measurements, solvedPixelRatio),
  };
};
