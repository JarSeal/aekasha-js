import { describe, expect, it } from 'vitest';
import type { DeviceCapabilityMeasurements } from './DeviceCapabilitiesTypes';
import {
  DEFAULT_DEVICE_LEVEL_THRESHOLDS,
  DEFAULT_DEVICE_TARGETS,
  rateDeviceLevels,
  rateGpuHeuristic,
  rateLevel,
  resolveDeviceLevelThresholds,
  resolveDeviceTargets,
  scoreDeviceCapabilities,
} from './DeviceScoring';

type MeasurementOverrides = {
  [K in keyof DeviceCapabilityMeasurements]?: Partial<DeviceCapabilityMeasurements[K]>;
};

// A discrete GPU on WebGPU, 8 cores, a capped 8 GB, unknown GPU memory
const createMeasurements = (
  overrides: MeasurementOverrides = {}
): DeviceCapabilityMeasurements => ({
  gpu: {
    api: 'WEBGPU',
    vendor: 'nvidia',
    architecture: 'ampere',
    device: null,
    description: null,
    isFallbackAdapter: false,
    isUnifiedMemory: false,
    isIntegrated: false,
    features: ['timestamp-query'],
    limits: {},
    preferredCanvasFormat: 'bgra8unorm',
    webgl2: null,
    ...overrides.gpu,
  },
  gpuMemoryMB: { value: null, source: 'UNKNOWN', ...overrides.gpuMemoryMB },
  memory: { deviceMemoryGB: 8, jsHeapLimitMB: 4096, ...overrides.memory },
  cpu: { cores: 8, ...overrides.cpu },
  display: {
    width: 2560,
    height: 1440,
    devicePixelRatio: 2,
    refreshHz: null,
    hdr: false,
    wideGamut: false,
    ...overrides.display,
  },
  env: {
    crossOriginIsolated: true,
    offscreenCanvas: true,
    isMobile: false,
    coarsePointer: false,
    ...overrides.env,
  },
});

const score = (
  overrides: MeasurementOverrides = {},
  targets: Parameters<typeof resolveDeviceTargets>[0] = undefined
) =>
  scoreDeviceCapabilities(
    createMeasurements(overrides),
    resolveDeviceTargets(targets),
    resolveDeviceLevelThresholds()
  );

describe('resolving the targets and thresholds', () => {
  it('merges each layer over the defaults without changing them', () => {
    const targets = resolveDeviceTargets(
      { fps: 120, minLevels: { overall: 'MEDIUM' }, requiredGPUFeatures: ['a', 'b'] },
      { minLevels: { gpu: 'HIGH' }, requiredGPUFeatures: ['c'] }
    );
    expect(targets).toMatchObject({
      fps: 120,
      minCpuCores: 4,
      minLevels: { overall: 'MEDIUM', gpu: 'HIGH' },
      requiredGPUFeatures: ['c'],
    });
    expect(DEFAULT_DEVICE_TARGETS.fps).toBe(60);
    expect(DEFAULT_DEVICE_TARGETS.minLevels).toEqual({});

    const thresholds = resolveDeviceLevelThresholds({ cpuCores: { ULTRA: 16 } });
    expect(thresholds.cpuCores).toEqual({ MEDIUM: 4, HIGH: 6, ULTRA: 16 });
    expect(DEFAULT_DEVICE_LEVEL_THRESHOLDS.cpuCores.ULTRA).toBe(12);
  });
});

describe('rateLevel', () => {
  it('gives the highest band met, and never a level without a band', () => {
    const bands = { MEDIUM: 4, HIGH: 8 };
    expect(rateLevel(2, bands)).toBe('LOW');
    expect(rateLevel(4, bands)).toBe('MEDIUM');
    expect(rateLevel(64, bands)).toBe('HIGH');
  });
});

describe('rateGpuHeuristic', () => {
  const gpu = (overrides: MeasurementOverrides['gpu']) =>
    createMeasurements({ gpu: overrides }).gpu;

  it('rates from the adapter, never ULTRA', () => {
    expect(rateGpuHeuristic(gpu({}))).toBe('HIGH');
    expect(rateGpuHeuristic(gpu({ isIntegrated: true, isUnifiedMemory: true }))).toBe('HIGH');
    expect(rateGpuHeuristic(gpu({ isIntegrated: true }))).toBe('MEDIUM');
    expect(rateGpuHeuristic(gpu({ isIntegrated: null }))).toBe('MEDIUM');
    expect(rateGpuHeuristic(gpu({ api: 'WEBGL2' }))).toBe('MEDIUM');
    expect(rateGpuHeuristic(gpu({ isFallbackAdapter: true }))).toBe('LOW');
    expect(rateGpuHeuristic(gpu({ api: 'NONE' }))).toBe('LOW');
  });
});

describe('rateDeviceLevels', () => {
  const rate = (overrides: MeasurementOverrides) =>
    rateDeviceLevels(createMeasurements(overrides), resolveDeviceLevelThresholds());

  it('rates each category and takes the lowest known one overall', () => {
    const levels = rate({ cpu: { cores: 4 } });
    expect(levels).toMatchObject({
      gpu: 'HIGH',
      cpu: 'MEDIUM',
      memory: 'HIGH',
      gpuMemory: null,
      overall: 'MEDIUM',
      sources: { gpu: 'HEURISTIC', cpu: 'API', memory: 'API', gpuMemory: 'UNKNOWN' },
      forced: false,
    });
  });

  it("doesn't let a capped memory reading lower the overall level", () => {
    // An app that wants 16 GB for HIGH: the capped 8 GB rates MEDIUM, under the GPU's HIGH
    const thresholds = resolveDeviceLevelThresholds({ deviceMemoryGB: { HIGH: 16 } });
    const levels = rateDeviceLevels(createMeasurements({ cpu: { cores: 16 } }), thresholds);
    expect(levels.memory).toBe('MEDIUM');
    expect(levels.overall).toBe('HIGH');
    // A reading under the cap does count
    expect(rate({ memory: { deviceMemoryGB: 2 } }).overall).toBe('LOW');
  });

  it('skips the unknown categories', () => {
    const levels = rate({ cpu: { cores: null }, memory: { deviceMemoryGB: null } });
    expect(levels).toMatchObject({ cpu: 'MEDIUM', memory: null, overall: 'HIGH' });
    expect(levels.sources).toMatchObject({ cpu: 'UNKNOWN', memory: 'UNKNOWN' });
  });
});

describe('scoreDeviceCapabilities', () => {
  it('passes a strong device, the fps check unknown without a benchmark', () => {
    const verdict = score();
    expect(verdict.checks.fps).toEqual({ result: 'UNKNOWN', measured: null, required: 60 });
    expect(verdict.checks.gpuMemory.result).toBe('UNKNOWN');
    expect(verdict.checks.cpuCores).toEqual({ result: 'PASS', measured: 8, required: 4 });
    expect(verdict.meetsTargets).toBe(true);
    expect(verdict.failedTargets).toEqual([]);
    expect(verdict.estimatedFps).toBeNull();
    expect(verdict.effectiveFpsTarget).toBe(60);
    expect(verdict.scores).toEqual({ gpu: null, cpu: 67, memory: 100, gpuMemory: null });
  });

  it('counts the unknown checks as unknownIs says', () => {
    const verdict = score({}, { unknownIs: 'FAIL' });
    expect(verdict.meetsTargets).toBe(false);
    expect(verdict.failedTargets).toEqual(['fps', 'gpuMemory']);
  });

  it('caps the fps target at the refresh rate', () => {
    expect(score({ display: { refreshHz: 60 } }, { fps: 120 }).effectiveFpsTarget).toBe(60);
    expect(score({ display: { refreshHz: 144 } }, { fps: 120 }).effectiveFpsTarget).toBe(120);
  });

  it('clamps a memory target to what the browser can report', () => {
    expect(score({}, { minDeviceMemoryGB: 16 }).checks.deviceMemory).toEqual({
      result: 'PASS',
      measured: 8,
      required: 8,
    });
    expect(score({ memory: { deviceMemoryGB: 2 } }).failedTargets).toEqual(['deviceMemory']);
  });

  it('checks WebGPU and its features', () => {
    const webgl = score(
      { gpu: { api: 'WEBGL2', features: [] } },
      {
        requireWebGPU: true,
        requiredGPUFeatures: ['timestamp-query'],
      }
    );
    expect(webgl.checks.webgpu).toEqual({ result: 'FAIL', measured: false, required: true });
    expect(webgl.checks.gpuFeatures).toEqual({
      result: 'FAIL',
      measured: '',
      required: 'timestamp-query',
    });
    const webgpu = score({}, { requireWebGPU: true, requiredGPUFeatures: ['timestamp-query'] });
    expect(webgpu.checks.webgpu.result).toBe('PASS');
    expect(webgpu.checks.gpuFeatures.result).toBe('PASS');
  });

  it('checks the minimum levels', () => {
    const ultra = score({}, { minLevels: { overall: 'ULTRA' } });
    expect(ultra.checks.minLevels).toEqual({
      result: 'FAIL',
      measured: 'overall: HIGH',
      required: 'overall: ULTRA',
    });
    expect(score({}, { minLevels: { gpuMemory: 'LOW' } }).checks.minLevels.result).toBe('UNKNOWN');
    expect(score({}, { minLevels: { gpu: 'HIGH', cpu: 'MEDIUM' } }).checks.minLevels).toEqual({
      result: 'PASS',
      measured: 'gpu: HIGH, cpu: HIGH',
      required: 'gpu: HIGH, cpu: MEDIUM',
    });
  });

  it('recommends settings from the levels', () => {
    expect(score().recommendations).toEqual({
      pixelRatio: 2,
      antialias: true,
      shadowQuality: 'HIGH',
      postFx: true,
      renderBackend: 'WEBGPU',
      physicsWorkerTarget: 'WORKER_THREAD',
    });
    // An integrated GPU guessed at 1 GB: MEDIUM pixel ratio and antialias off, LOW shadows
    expect(
      score({
        gpu: { isIntegrated: true },
        gpuMemoryMB: { value: 512, source: 'HEURISTIC_INTEGRATED' },
        cpu: { cores: 2 },
      }).recommendations
    ).toEqual({
      pixelRatio: 1.5,
      antialias: false,
      shadowQuality: 'LOW',
      postFx: true,
      renderBackend: 'WEBGPU',
      physicsWorkerTarget: 'MAIN_THREAD',
    });
    expect(score({ gpu: { api: 'NONE' } }).recommendations).toMatchObject({
      pixelRatio: 1,
      postFx: false,
      renderBackend: 'WEBGL2',
    });
    expect(score({ gpu: { isFallbackAdapter: true } }).recommendations.renderBackend).toBe(
      'WEBGL2'
    );
  });
});
