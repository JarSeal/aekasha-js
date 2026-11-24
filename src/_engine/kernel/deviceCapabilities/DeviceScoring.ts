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
  DeviceLevelBands,
  DeviceLevelCategory,
  DeviceLevels,
  DeviceLevelThresholds,
  ResolvedDeviceCapabilityTargets,
  ResolvedDeviceLevelThresholds,
} from './DeviceCapabilitiesTypes';

/**
 * The most `navigator.deviceMemory` reports, GB: a reading of it is capped (the device may have
 * more), so it doesn't lower the overall level, and a higher memory target is clamped to it.
 * @internal
 */
export const DEVICE_MEMORY_CAP_GB = 8;

/**
 * The engine's targets, under `AppConfig.deviceCapabilities.targets` and a check's own.
 * @internal
 */
export const DEFAULT_DEVICE_TARGETS: ResolvedDeviceCapabilityTargets = {
  fps: 60,
  resolution: 'CANVAS',
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
  cpuCores: { MEDIUM: 4, HIGH: 6, ULTRA: 12 },
  deviceMemoryGB: { MEDIUM: 4, HIGH: 8 },
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
 * The device's levels per category and overall (p240 §3.1). The overall level is the lowest of
 * the categories that were measured: an unknown one is skipped, and so is a capped memory reading
 * (8 GB may be more).
 * @internal
 */
export const rateDeviceLevels = (
  measurements: DeviceCapabilityMeasurements,
  thresholds: ResolvedDeviceLevelThresholds
): DeviceLevels => {
  const { cores } = measurements.cpu;
  const { deviceMemoryGB } = measurements.memory;
  const gpuMemoryMB = measurements.gpuMemoryMB.value;

  const gpu = rateGpuHeuristic(measurements.gpu);
  // Unknown cores rate MEDIUM, the level of the common case, and don't count toward the overall
  const cpu = cores !== null ? rateLevel(cores, thresholds.cpuCores) : 'MEDIUM';
  const memory =
    deviceMemoryGB !== null ? rateLevel(deviceMemoryGB, thresholds.deviceMemoryGB) : null;
  const gpuMemory = gpuMemoryMB !== null ? rateLevel(gpuMemoryMB, thresholds.gpuMemoryMB) : null;
  const isMemoryCapped = deviceMemoryGB !== null && deviceMemoryGB >= DEVICE_MEMORY_CAP_GB;

  const overall = minQualityLevel(
    gpu,
    cores !== null ? cpu : null,
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
      gpu: 'HEURISTIC',
      cpu: cores !== null ? 'API' : 'UNKNOWN',
      memory: memory !== null ? 'API' : 'UNKNOWN',
      gpuMemory: gpuMemory !== null ? 'HEURISTIC' : 'UNKNOWN',
    },
    forced: false,
  };
};

/**
 * The settings suggested for the levels (a debug override's levels too): the pixel ratio, the
 * antialias and PostFX by the GPU's level, the shadow quality the lower of the GPU's and the GPU
 * memory's, the backend and the physics target by the device.
 * @internal
 */
export const recommendDeviceSettings = (
  levels: DeviceLevels,
  measurements: DeviceCapabilityMeasurements
): DeviceCapabilityRecommendations => {
  const { gpu } = measurements;
  const dpr = measurements.display.devicePixelRatio || 1;
  const maxPixelRatio = { LOW: 1, MEDIUM: 1.5, HIGH: 2, ULTRA: 2 }[levels.gpu];
  return {
    pixelRatio: Math.min(dpr, maxPixelRatio),
    antialias: compareQualityLevels(levels.gpu, 'HIGH') >= 0,
    shadowQuality: minQualityLevel(levels.gpu, levels.gpuMemory) as QualityLevel,
    postFx: compareQualityLevels(levels.gpu, 'MEDIUM') >= 0,
    renderBackend: gpu.api === 'WEBGPU' && !gpu.isFallbackAdapter ? 'WEBGPU' : 'WEBGL2',
    // A worker needs a core of its own: a LOW CPU (under 4 cores) steps on the main thread
    physicsWorkerTarget: levels.cpu === 'LOW' ? 'MAIN_THREAD' : 'WORKER_THREAD',
  };
};

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
 * Each target's check (p240 §1.1). The `fps` check is `UNKNOWN` until the benchmark predicts a
 * frame rate; a memory target over the browser's cap is checked against the cap.
 * @internal
 */
export const checkDeviceTargets = (
  measurements: DeviceCapabilityMeasurements,
  levels: DeviceLevels,
  targets: ResolvedDeviceCapabilityTargets
) => {
  const { gpu } = measurements;
  const refreshHz = measurements.display.refreshHz;
  const effectiveFpsTarget = refreshHz ? Math.min(targets.fps, refreshHz) : targets.fps;
  const estimatedFps: number | null = null;

  const hasWebGPU = gpu.api === 'WEBGPU';
  const presentFeatures = targets.requiredGPUFeatures.filter((f) => gpu.features.includes(f));

  const checks: DeviceCapabilityChecks = {
    fps: checkAtLeast(estimatedFps, effectiveFpsTarget),
    deviceMemory: checkAtLeast(
      measurements.memory.deviceMemoryGB,
      Math.min(targets.minDeviceMemoryGB, DEVICE_MEMORY_CAP_GB)
    ),
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
  return { checks, effectiveFpsTarget, estimatedFps };
};

/**
 * The verdict: the measurements rated, checked against the targets and turned into suggested
 * settings. An `UNKNOWN` check counts as `targets.unknownIs` says.
 * @internal
 */
export const scoreDeviceCapabilities = (
  measurements: DeviceCapabilityMeasurements,
  targets: ResolvedDeviceCapabilityTargets,
  thresholds: ResolvedDeviceLevelThresholds
): DeviceCapabilityVerdict => {
  const levels = rateDeviceLevels(measurements, thresholds);
  const { checks, effectiveFpsTarget, estimatedFps } = checkDeviceTargets(
    measurements,
    levels,
    targets
  );
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
      gpu: null,
      cpu: scoreReading(measurements.cpu.cores, thresholds.cpuCores),
      memory: scoreReading(measurements.memory.deviceMemoryGB, thresholds.deviceMemoryGB),
      gpuMemory: scoreReading(measurements.gpuMemoryMB.value, thresholds.gpuMemoryMB),
    },
    recommendations: recommendDeviceSettings(levels, measurements),
  };
};
