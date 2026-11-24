import { describe, expect, it } from 'vitest';
import type { DeviceCapabilityMeasurements } from './DeviceCapabilitiesTypes';
import {
  DEFAULT_DEVICE_LEVEL_THRESHOLDS,
  DEFAULT_DEVICE_TARGETS,
  estimateFps,
  rateDeviceLevels,
  rateGpuHeuristic,
  rateLevel,
  resolveDeviceLevelThresholds,
  resolveDeviceTargets,
  resolveTargetPixelSize,
  scoreDeviceCapabilities,
  solvePixelRatio,
} from './DeviceScoring';

type MeasurementOverrides = {
  [K in Exclude<keyof DeviceCapabilityMeasurements, 'benchmark'>]?: Partial<
    DeviceCapabilityMeasurements[K]
  >;
} & { benchmark?: DeviceCapabilityMeasurements['benchmark'] };

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
  cpu: { cores: 8, benchScore: null, ...overrides.cpu },
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
  benchmark: overrides.benchmark ?? null,
});

// The canvas, CSS pixels: 2560 × 1440 pixels at the fixture's pixel ratio of 2
const CANVAS = { width: 1280, height: 720 };

// The tests' own reference frame, so a calibration of the defaults changes none of them
const TEST_FRAME = { fixedMPixOps: 0, fullscreenPasses: 6, trianglesPerFrame: 1e6 };

const score = (
  overrides: MeasurementOverrides = {},
  targets: Parameters<typeof resolveDeviceTargets>[0] = undefined,
  thresholds: Parameters<typeof resolveDeviceLevelThresholds>[0] = undefined
) =>
  scoreDeviceCapabilities(
    createMeasurements(overrides),
    resolveDeviceTargets({ referenceFrame: TEST_FRAME }, targets),
    resolveDeviceLevelThresholds(thresholds),
    CANVAS
  );

/** A GPU benchmark's measurements: `fill` MPix-ops per ms, a million triangles per ms. */
const benchmarked = (fill: number, cpuScore = 20000): MeasurementOverrides => ({
  cpu: { benchScore: cpuScore },
  benchmark: {
    gpu: {
      api: 'WEBGPU',
      width: 2560,
      height: 1440,
      fillRateMPixOpsPerMs: fill,
      trianglesPerMs: 1e6,
      usedTimestampQuery: true,
    },
    durationMs: 500,
    isStalled: false,
  },
});

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
    // A reading under the cap does count, and so does one over it (a browser that reports more)
    expect(rate({ memory: { deviceMemoryGB: 2 } }).overall).toBe('LOW');
    const over = rateDeviceLevels(
      createMeasurements({ memory: { deviceMemoryGB: 16 } }),
      resolveDeviceLevelThresholds({ deviceMemoryGB: { ULTRA: 32 } })
    );
    expect(over).toMatchObject({ memory: 'HIGH', overall: 'HIGH' });
    expect(rate({ memory: { deviceMemoryGB: 32 } }).memory).toBe('ULTRA');
  });

  it('rates the GPU by its benchmark headroom, ULTRA included', () => {
    const thresholds = DEFAULT_DEVICE_LEVEL_THRESHOLDS;
    const at = (headroom: number) =>
      rateDeviceLevels(createMeasurements({ cpu: { cores: 16 } }), thresholds, headroom);
    expect(at(0.9).gpu).toBe('LOW');
    expect(at(1).gpu).toBe('MEDIUM');
    expect(at(3).gpu).toBe('HIGH');
    expect(at(4)).toMatchObject({ gpu: 'ULTRA', overall: 'ULTRA' });
    expect(at(4).sources.gpu).toBe('BENCHMARK');
  });

  it("rates the CPU by the lower of its cores' and its benchmark score's levels", () => {
    expect(rate({ cpu: { cores: 16, benchScore: 9000 } })).toMatchObject({
      cpu: 'MEDIUM',
      sources: { cpu: 'BENCHMARK' },
    });
    expect(rate({ cpu: { cores: 4, benchScore: 30000 } }).cpu).toBe('MEDIUM');
    expect(rate({ cpu: { cores: 16, benchScore: 30000 } }).cpu).toBe('ULTRA');
    // The score alone when the cores are unknown, and it counts toward the overall
    expect(rate({ cpu: { cores: null, benchScore: 3000 } })).toMatchObject({
      cpu: 'LOW',
      overall: 'LOW',
    });
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
    expect(verdict.scores).toEqual({ gpu: null, cpu: 67, memory: 50, gpuMemory: null });
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

  it('checks a memory target over 8 GB as unknown against a reading of 8 (maybe capped)', () => {
    expect(score({}, { minDeviceMemoryGB: 16 }).checks.deviceMemory).toEqual({
      result: 'UNKNOWN',
      measured: 8,
      required: 16,
    });
    const reported = { memory: { deviceMemoryGB: 32 } };
    expect(score(reported, { minDeviceMemoryGB: 16 }).checks.deviceMemory.result).toBe('PASS');
    expect(
      score({ memory: { deviceMemoryGB: 4 } }, { minDeviceMemoryGB: 16 }).failedTargets
    ).toEqual(['deviceMemory']);
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

describe('the frame rate prediction', () => {
  const frame = { fixedMPixOps: 0, fullscreenPasses: 6, trianglesPerFrame: 1e6 };
  const bench = benchmarked(6).benchmark?.gpu ?? null;

  it("adds the reference frame's fill and geometry times", () => {
    // 6 passes over a million pixels at 6 MPix-ops/ms (1 ms), a million triangles (1 ms)
    expect(estimateFps(bench!, 1e6, frame)).toBe(500);
    expect(estimateFps(bench!, 3e6, frame)).toBe(250);
    expect(estimateFps({ ...bench!, fillRateMPixOpsPerMs: 0 }, 1e6, frame)).toBeNull();
    // 12 fixed MPix-ops: 2 ms more at any size
    expect(estimateFps(bench!, 1e6, { ...frame, fixedMPixOps: 12 })).toBe(250);
  });

  it('resolves the target resolution from the canvas × the pixel ratio, or as given', () => {
    expect(resolveTargetPixelSize('CANVAS', { width: 1280, height: 720 }, 1.5)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(resolveTargetPixelSize({ width: 800, height: 600 }, CANVAS, 2)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("solves the largest pixel ratio, up to the device's, that holds the frame rate", () => {
    const canvas = { width: 1000, height: 1000 };
    // 1 ms of geometry, 1 ms of fill per million pixels: 500 fps at 1, 200 at 2
    expect(solvePixelRatio(bench!, canvas, 2, frame, 200)).toBe(2);
    expect(solvePixelRatio(bench!, canvas, 3, frame, 200)).toBe(2);
    expect(solvePixelRatio(bench!, canvas, 2, frame, 300)).toBe(1.5);
    expect(solvePixelRatio(bench!, canvas, 2, frame, 500)).toBe(1);
    // An odd device ratio is tried first, and the smallest step is the answer when none holds
    expect(solvePixelRatio(bench!, canvas, 1.1, frame, 400)).toBe(1.1);
    expect(solvePixelRatio(bench!, canvas, 1.1, frame, 460)).toBe(1);
    expect(solvePixelRatio(bench!, canvas, 2, frame, 2000)).toBe(0.5);
  });
});

describe('scoreDeviceCapabilities with a benchmark', () => {
  it('predicts the frame rate at the target resolution and rates the GPU by its headroom', () => {
    // 2560 × 1440 pixels × 6 passes at 10 MPix-ops/ms (2.21 ms), a million triangles (1 ms)
    const verdict = score(benchmarked(10));
    expect(verdict.estimatedFps).toBe(311.3);
    expect(verdict.checks.fps).toEqual({ result: 'PASS', measured: 311.3, required: 60 });
    expect(verdict.levels).toMatchObject({ gpu: 'ULTRA', sources: { gpu: 'BENCHMARK' } });
    expect(verdict.scores.gpu).toBe(100);
    expect(verdict.recommendations.pixelRatio).toBe(2);
    expect(verdict.recommendations.antialias).toBe(true);
  });

  it('fails the fps check on a slow GPU, and lowers the pixel ratio to hold the target', () => {
    // 0.5 MPix-ops/ms: 45 ms at 2560 × 1440, about 22 fps
    const verdict = score(benchmarked(0.5));
    expect(verdict.checks.fps.result).toBe('FAIL');
    expect(verdict.failedTargets).toContain('fps');
    expect(verdict.levels.gpu).toBe('LOW');
    // 83 fps at a pixel ratio of 1, 55 at 1.25
    expect(verdict.recommendations).toMatchObject({ pixelRatio: 1, antialias: false });
    // A 30 Hz display asks for 30: 39 fps at 1.5
    expect(
      score({ ...benchmarked(0.5), display: { refreshHz: 30 } }).recommendations.pixelRatio
    ).toBe(1.5);
  });

  it('scores another resolution, reference frame and headroom bands without measuring', () => {
    const at1080 = score(benchmarked(10), { resolution: { width: 1920, height: 1080 } });
    expect(at1080.estimatedFps).toBeGreaterThan(311.3);
    const heavy = score(benchmarked(10), { referenceFrame: { fullscreenPasses: 60 } });
    expect(heavy.estimatedFps).toBeCloseTo(1000 / (22.1184 + 1), 1);
    // The default triangles kept under a partial reference frame
    expect(heavy.targets.referenceFrame).toEqual({
      fixedMPixOps: 0,
      fullscreenPasses: 60,
      trianglesPerFrame: 1e6,
    });
    expect(score(benchmarked(10), undefined, { gpuHeadroom: { ULTRA: 10 } }).levels.gpu).toBe(
      'HIGH'
    );
  });

  it('rates the GPU by its adapter when the GPU benchmark failed', () => {
    const failed = benchmarked(10);
    failed.benchmark = { gpu: null, durationMs: 500, isStalled: false };
    const verdict = score(failed);
    expect(verdict.estimatedFps).toBeNull();
    expect(verdict.levels.sources.gpu).toBe('HEURISTIC');
    expect(verdict.checks.fps.result).toBe('UNKNOWN');
  });
});
