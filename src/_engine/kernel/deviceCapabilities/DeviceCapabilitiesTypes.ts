// The device capability check's types (p240): its config, the measurements it stores, and the
// verdict scored from them. Types only, so the config and the entry name them without loading the
// check.
import type { PhysicsWorkerTarget } from '../../features/physics/types/PhysicsConfigTypes';
import type { QualityLevel } from '../../utils/QualityLevel';

/** A device level's category: the GPU, the CPU, the system memory and the GPU memory. */
export type DeviceLevelCategory = 'gpu' | 'cpu' | 'memory' | 'gpuMemory';

/** A target check's result: `UNKNOWN` when the browser doesn't tell (`targets.unknownIs` counts it). */
export type DeviceCheckResult = 'PASS' | 'FAIL' | 'UNKNOWN';

/** A device capability check's phase, as its `onProgress` reports it: the probe (the refresh
 * rate's sampling included), the GPU benchmark, the CPU benchmark, and done. */
export type DeviceCapabilityCheckPhase = 'PROBE' | 'GPU' | 'CPU' | 'DONE';

/** How a device level was decided: measured, guessed from the adapter, read from an API, or not at all. */
export type DeviceLevelSource = 'BENCHMARK' | 'HEURISTIC' | 'API' | 'UNKNOWN';

/**
 * What the device should manage: the check rates its measurements against these. Every key has an
 * engine default; `AppConfig.deviceCapabilities.targets` and a check's own `targets` are merged
 * over it, in that order.
 */
export type DeviceCapabilityTargets = {
  /** The frame rate to hold; the check uses the lower of it and the display's refresh rate. Default 60. */
  fps?: number;
  /** The resolution the frame rate is held at, pixels: `'CANVAS'` is the canvas's size
   * (`getCanvasSize`: the window, or a mounted engine's container) × `devicePixelRatio`. Default
   * `'CANVAS'`. */
  resolution?: 'CANVAS' | { width: number; height: number };
  /** The frame the frame rate is predicted for, in the GPU benchmark's units: a stand-in for the
   * app's scenes ({@link DeviceReferenceFrame}). The default stands for the example app's
   * game-like scenes; an app with lighter or heavier ones tunes it. */
  referenceFrame?: DeviceReferenceFrame;
  /** The least system memory, GB (`navigator.deviceMemory`, Chromium only, bucketed). Older
   * browsers report 8 at most: a reading of 8 checks a higher target as `UNKNOWN`. Default 4. */
  minDeviceMemoryGB?: number;
  /** The least GPU memory, MB: only ever a guess (no browser tells it), `UNKNOWN` on most discrete
   * GPUs. Default 2048. */
  minGPUMemoryMB?: number;
  /** The least logical CPU cores (`navigator.hardwareConcurrency`). Default 4. */
  minCpuCores?: number;
  /** Fail a device without WebGPU (one that would run on WebGL2). Default false. */
  requireWebGPU?: boolean;
  /** The WebGPU features the adapter must have (`'timestamp-query'`, `'float32-filterable'`, …).
   * Default `[]`. */
  requiredGPUFeatures?: string[];
  /** The least device levels, by category and overall, eg. `{ overall: 'MEDIUM', gpu: 'HIGH' }`.
   * Default `{}`. */
  minLevels?: Partial<Record<DeviceLevelCategory | 'overall', QualityLevel>>;
  /** How an `UNKNOWN` check counts toward `meetsTargets`. Default `'PASS'` (a browser that doesn't
   * report memory doesn't fail the memory targets). */
  unknownIs?: 'PASS' | 'FAIL';
};

/**
 * The frame the frame rate is predicted for: its work in the GPU benchmark's units, so its time is
 * (`fixedMPixOps` + `fullscreenPasses` × the target's megapixels) ÷ the fill rate +
 * `trianglesPerFrame` ÷ the triangle rate. Tune it so the prediction matches the app's own scenes'
 * GPU time (`_dbg__DeviceCalibration.ts` measures a scene and fits it).
 */
export type DeviceReferenceFrame = {
  /** The work that doesn't grow with the resolution (the passes' setup, shadow maps, the small
   * targets of a bloom), in millions of the fill shader's pixel ops: in the fill rate's units, so
   * it takes longer on a slower GPU. Default 16. */
  fixedMPixOps?: number;
  /** The fill: passes over every pixel of the benchmark's fragment shader (an ALU loop and two
   * texture samples, blended), standing for the scene, its shadows and its PostFX. Default 18. */
  fullscreenPasses?: number;
  /** The geometry: small triangles drawn, shadow passes included. Default 500 000. */
  trianglesPerFrame?: number;
};

/** {@link DeviceCapabilityTargets} with every default filled in: what a verdict was scored against. */
export type ResolvedDeviceCapabilityTargets = Required<
  Omit<DeviceCapabilityTargets, 'referenceFrame'>
> & {
  /** The reference frame, every default filled in. */
  referenceFrame: Required<DeviceReferenceFrame>;
};

/** The least value for each level above `LOW`: a reading under `MEDIUM`'s is `LOW`, and a level
 * without a value is never given. */
export type DeviceLevelBands = Partial<Record<Exclude<QualityLevel, 'LOW'>, number>>;

// p240 §3.1
/**
 * The values the device levels are rated by, per input: a category gets the highest
 * level whose value its reading meets. Each is merged over the engine's.
 */
export type DeviceLevelThresholds = {
  /** The GPU's headroom: the predicted frame rate ÷ the frame rate the check asks for, at the
   * target resolution. Default `{ MEDIUM: 1, HIGH: 2, ULTRA: 4 }`. */
  gpuHeadroom?: DeviceLevelBands;
  /** CPU logical cores; the CPU's level is the lower of this one and the benchmark score's.
   * Default `{ MEDIUM: 4, HIGH: 6, ULTRA: 12 }`. */
  cpuCores?: DeviceLevelBands;
  /** The CPU benchmark's score (`cpu.benchScore`, matrix multiplies per ms on the main thread).
   * Default `{ MEDIUM: 8000, HIGH: 15000, ULTRA: 25000 }`. */
  cpuBenchScore?: DeviceLevelBands;
  /** System memory, GB. Older browsers report 8 at most (`ULTRA` needs one that reports more).
   * Default `{ MEDIUM: 4, HIGH: 8, ULTRA: 16 }`. */
  deviceMemoryGB?: DeviceLevelBands;
  /** GPU memory, MB (a guess). Default `{ MEDIUM: 1024, HIGH: 2048, ULTRA: 4096 }`. */
  gpuMemoryMB?: DeviceLevelBands;
};

/** {@link DeviceLevelThresholds} with the engine's values filled in. */
export type ResolvedDeviceLevelThresholds = Required<DeviceLevelThresholds>;

/** `AppConfig.deviceCapabilities`: the device capability check's settings. */
export type DeviceCapabilitiesConfig = {
  /** Run the check in the boot, before the app's `start`, so `getDeviceCapabilityReport()` has a
   * report there. Default false. */
  runAtInit?: boolean;
  /** Keep the measurements in localStorage (`AEK_deviceCapabilities`) and reuse them on later
   * boots while they're valid (same device, browser and display, not too old). Default true. */
  saveToLS?: boolean;
  /** Days before a stored result is measured again; 0 never expires it. Default 30. */
  maxAgeDays?: number;
  /** The GPU and CPU benchmark and the refresh rate's sampling, which the frame rate's prediction
   * and the benchmarked levels need. */
  benchmark?: {
    /** Run them; false probes only what the browser tells (the GPU's and the CPU's levels then
     * come from the adapter and the cores). Default true. */
    enabled?: boolean;
    /** How long they may take, ms: the first boot's (or a re-check's) delay. Default 1500. */
    budgetMs?: number;
  };
  /** What the device should manage ({@link DeviceCapabilityTargets}), over the engine's defaults. */
  targets?: DeviceCapabilityTargets;
  /** The device levels' thresholds ({@link DeviceLevelThresholds}), over the engine's. */
  levelThresholds?: DeviceLevelThresholds;
  /** Watching the app's own frames once a scene runs, against the benchmark's prediction
   * ({@link DeviceObserveConfig}). */
  observe?: DeviceObserveConfig;
};

// p240 Phase 4
/**
 * `AppConfig.deviceCapabilities.observe`: the observer, which samples the running scene's frames in
 * windows and tells which ones the GPU held. It starts once a check has a report
 * with a GPU benchmark, and its code is downloaded only when it's enabled.
 */
export type DeviceObserveConfig = {
  /** Observe the frames. Default false. */
  enabled?: boolean;
  /** How long after a scene's load the frames are left out, ms: its first frames compile
   * pipelines and stream assets. Default 5000. */
  warmUpMs?: number;
  /** Rendered frames a window, 30-2000. Default 300. */
  frames?: number;
  /** The scenes observed, by id; the others' frames are left out (a test or stress scene heavier
   * than the app's real ones). Default every scene. */
  sceneIds?: string[];
  /** How much slower than predicted a GPU-held window must be to correct the prediction: its
   * frame time ÷ the reference frame's predicted time at its pixels. Default 1.25. */
  slowerThan?: number;
};

/**
 * What held an observed window's frame rate: the display or the max FPS limiter (`REFRESH`: the
 * frames come as fast as allowed, which says nothing about how far above it the device is), the GPU
 * (`GPU`: below that, the GPU still busy when the next frame began), the main thread (`CPU`) or a
 * cap the engine doesn't know (`CAPPED`: neither busy, eg. the browser throttling the page's frames).
 */
export type DeviceObservationLimit = 'REFRESH' | 'GPU' | 'CPU' | 'CAPPED';

/** A window of a scene's frames, as the observer measured it. */
export type DeviceObservation = {
  /** The scene that ran. */
  sceneId: string;
  /** When the window ended, ms since the epoch. */
  at: number;
  /** The rendered frames in it. */
  frames: number;
  /** The median interval between two rendered frames, ms. */
  p50FrameMs: number;
  /** The 95th percentile interval, ms: the hitches. */
  p95FrameMs: number;
  /** The median main loop CPU time of a rendered frame (the frames the max FPS limiter skipped
   * before it included), ms. */
  p50CpuMs: number;
  /** The share of the checked frames that began with the previous frame's GPU work still running,
   * 0-1; null when the GPU's queue can't be checked. */
  gpuBusyShare: number | null;
  /** The interval the frames were compared with, ms: the longer of the display's refresh interval
   * and the max FPS limiter's. */
  comparedIntervalMs: number;
  /** The drawing buffer, pixels. */
  pixelWidth: number;
  /** The drawing buffer, pixels. */
  pixelHeight: number;
  /** What held the frame rate. */
  limitedBy: DeviceObservationLimit;
};

/** The GPU as the browser describes it. A field the browser hides is null. */
export type DeviceGpuMeasurements = {
  /** The API the engine would render with: WebGPU when an adapter comes, else WebGL2. */
  api: 'WEBGPU' | 'WEBGL2' | 'NONE';
  /** The adapter's vendor (`GPUAdapterInfo.vendor`, else WebGL's unmasked vendor). */
  vendor: string | null;
  /** The adapter's architecture (`GPUAdapterInfo.architecture`). */
  architecture: string | null;
  /** The adapter's device (`GPUAdapterInfo.device`). */
  device: string | null;
  /** The adapter's description (`GPUAdapterInfo.description`, else WebGL's unmasked renderer). */
  description: string | null;
  /** A software renderer, no real GPU: WebGPU's fallback adapter, or a renderer named like one
   * (SwiftShader, llvmpipe). Null when it can't be told. */
  isFallbackAdapter: boolean | null;
  /** The GPU shares the system memory (Apple silicon). Null when it can't be told. */
  isUnifiedMemory: boolean | null;
  /** An integrated GPU. Null when it can't be told. */
  isIntegrated: boolean | null;
  /** The adapter's WebGPU features, sorted. Empty without WebGPU. */
  features: string[];
  /** The adapter's WebGPU limits that bound a renderer (textures, bindings, buffers, workgroups). */
  limits: Record<string, number>;
  /** `navigator.gpu.getPreferredCanvasFormat()`. Null without WebGPU. */
  preferredCanvasFormat: string | null;
  /** The WebGL2 fallback's limits, null without WebGL2. */
  webgl2: {
    /** `MAX_TEXTURE_SIZE`. */
    maxTextureSize: number;
    /** `MAX_SAMPLES`: the most MSAA samples. */
    maxSamples: number;
    /** The supported extensions, sorted. */
    extensions: string[];
    /** `WEBGL_debug_renderer_info`'s vendor, null where the browser masks it. */
    unmaskedVendor: string | null;
    /** `WEBGL_debug_renderer_info`'s renderer, null where the browser masks it. */
    unmaskedRenderer: string | null;
  } | null;
};

/** Where the GPU memory guess comes from: a share of the system memory for a unified or an integrated GPU. */
export type DeviceGpuMemorySource = 'HEURISTIC_UNIFIED' | 'HEURISTIC_INTEGRATED' | 'UNKNOWN';

/** What the check measured: the raw readings, which a stored result keeps and a verdict is scored from. */
export type DeviceCapabilityMeasurements = {
  /** The GPU ({@link DeviceGpuMeasurements}). */
  gpu: DeviceGpuMeasurements;
  /** The GPU memory: a guess, no browser tells it. */
  gpuMemoryMB: {
    /** The guess, MB, or null. */
    value: number | null;
    /** How it was guessed. */
    source: DeviceGpuMemorySource;
  };
  /** The system memory. */
  memory: {
    /** `navigator.deviceMemory` (Chromium only), GB, bucketed and 8 at most. */
    deviceMemoryGB: number | null;
    /** `performance.memory.jsHeapSizeLimit` (Chromium only), MB. */
    jsHeapLimitMB: number | null;
  };
  /** The CPU. */
  cpu: {
    /** `navigator.hardwareConcurrency`: logical cores. */
    cores: number | null;
    /** The CPU benchmark's score: 4×4 matrix multiplies per ms on the main thread. Null when not
     * benchmarked. */
    benchScore: number | null;
  };
  /** The display. */
  display: {
    /** The screen's width, CSS pixels. */
    width: number;
    /** The screen's height, CSS pixels. */
    height: number;
    /** `window.devicePixelRatio` when measured. */
    devicePixelRatio: number;
    /** The display's refresh rate, Hz (the median frame interval, snapped to a common rate),
     * null when not benchmarked or the frames didn't come. */
    refreshHz: number | null;
    /** The display is HDR (`dynamic-range: high`). */
    hdr: boolean;
    /** The display covers P3 (`color-gamut: p3`). */
    wideGamut: boolean;
  };
  /** The page and the device. */
  env: {
    /** The page is cross-origin isolated: physics' shared transform buffer works. */
    crossOriginIsolated: boolean;
    /** `OffscreenCanvas` exists. */
    offscreenCanvas: boolean;
    /** A mobile device (`navigator.userAgentData.mobile`, else from the user agent). */
    isMobile: boolean | null;
    /** The main pointer is coarse (touch). */
    coarsePointer: boolean;
  };
  /** The benchmark, null when it didn't run. */
  benchmark: DeviceBenchmarkMeasurements | null;
  /** The observer's GPU-held windows (`observe`), the slowest of each scene against the
   * prediction, 8 scenes at most: they correct the prediction when slower than it. None before
   * a scene ran, or without `observe`. */
  observed?: DeviceObservation[];
};

/** The GPU benchmark's throughputs: synthetic workloads on a device of its own, at the target
 * resolution (3840×2160's pixels at most). */
export type DeviceGpuBenchmark = {
  /** The API measured: the one the renderer would use. */
  api: 'WEBGPU' | 'WEBGL2';
  /** The benchmark's render target, pixels. */
  width: number;
  /** The benchmark's render target, pixels. */
  height: number;
  /** Fill rate: millions of pixels per ms of a fixed-cost fragment shader (an ALU loop and two
   * texture samples, blended), what `referenceFrame.fullscreenPasses` counts in. */
  fillRateMPixOpsPerMs: number;
  /** Geometry: tiny triangles per ms (non-indexed, a transform per vertex). */
  trianglesPerMs: number;
  /** A GPU timer query timed every batch; else the wall time to the batch's completion did. */
  usedTimestampQuery: boolean;
};

/** The benchmark's run. */
export type DeviceBenchmarkMeasurements = {
  /** The GPU benchmark, null when it failed (no device, a lost one). */
  gpu: DeviceGpuBenchmark | null;
  /** The whole benchmark's time, ms: the refresh rate's sampling, the GPU and the CPU. */
  durationMs: number;
  /** The page was hidden meanwhile, or it took over twice its budget: its readings are suspect,
   * so it isn't stored and the next check measures again. */
  isStalled: boolean;
};

/** One target check: its result, what was measured and what was required. */
export type DeviceCapabilityCheck = {
  /** The result. */
  result: DeviceCheckResult;
  /** What was measured, null when unknown. */
  measured: number | boolean | string | null;
  /** What the target asked for. */
  required: number | boolean | string;
};

/** The target checks, by name. */
export type DeviceCapabilityChecks = Record<
  'fps' | 'deviceMemory' | 'gpuMemory' | 'cpuCores' | 'webgpu' | 'gpuFeatures' | 'minLevels',
  DeviceCapabilityCheck
>;

/**
 * The device's levels per category and overall, on the shadow presets' scale, so a level can be
 * used as a light's `shadowPreset`.
 */
export type DeviceLevels = {
  /** The lowest of the known categories' levels (the weakest part is the bottleneck); a memory
   * reading of 8 GB (maybe an older browser's cap) doesn't lower it. */
  overall: QualityLevel;
  /** The GPU's level: from the benchmark's headroom at the target resolution, else from the
   * adapter (never `ULTRA` then). */
  gpu: QualityLevel;
  /** The CPU's level: the lower of the cores' and the benchmark score's, the cores' alone when not
   * benchmarked. */
  cpu: QualityLevel;
  /** The system memory's level, null when the browser doesn't tell. */
  memory: QualityLevel | null;
  /** The GPU memory's level, null when it can't be guessed (common). */
  gpuMemory: QualityLevel | null;
  /** How each category's level was decided. */
  sources: Record<DeviceLevelCategory, DeviceLevelSource>;
  /** The levels are a debug override's, not the device's. */
  forced: boolean;
};

/** Suggested settings for the device: advisory, the engine applies none of them. */
export type DeviceCapabilityRecommendations = {
  /** The renderer's pixel ratio (`createRenderer`'s `devicePixelRatio`): the largest of the
   * device's pixel ratio, 2, 1.75, 1.5, 1.25, 1, 0.75 and 0.5 (none over the device's) at which
   * the predicted frame rate holds at the canvas's size, 0.5 when none; from the GPU's level when
   * not benchmarked. */
  pixelRatio: number;
  /** The renderer's `antialias`. */
  antialias: boolean;
  /** A light's `shadowPreset`: the lower of the GPU's and the GPU memory's levels. */
  shadowQuality: QualityLevel;
  /** Whether to run PostFX (`setPostFxEnabled`). */
  postFx: boolean;
  /** The backend: WebGL2 where WebGPU is missing or a fallback adapter (`createRenderer`'s
   * `forceWebGL`). */
  renderBackend: 'WEBGPU' | 'WEBGL2';
  /** `AppConfig.physics.workerTarget`, read at `physics()`'s install: apply it on the next boot,
   * from the stored report. */
  physicsWorkerTarget: PhysicsWorkerTarget;
};

/** The measurements scored against the targets: recomputed for every read, never stored. */
export type DeviceCapabilityVerdict = {
  /** The targets it was scored against, every default filled in. */
  targets: ResolvedDeviceCapabilityTargets;
  /** Each target's check. */
  checks: DeviceCapabilityChecks;
  /** The frame rate predicted for the reference frame at the target resolution, null when not
   * benchmarked (or its GPU part failed). */
  estimatedFps: number | null;
  /** The frame rate the `fps` check asks for: the lower of `targets.fps` and the refresh rate. */
  effectiveFpsTarget: number;
  /** Every check passed (an `UNKNOWN` one as `targets.unknownIs` says). */
  meetsTargets: boolean;
  /** The checks that didn't pass, by name. */
  failedTargets: (keyof DeviceCapabilityChecks)[];
  /** The device's levels. */
  levels: DeviceLevels;
  /** How many times slower than predicted the app's scenes ran (the slowest of the observed
   * windows, `measurements.observed`): the GPU benchmark's throughputs were divided by it before
   * the frame rate, the GPU's level and the pixel ratio were worked out. Null when no window was
   * over `observe.slowerThan`. */
  observedCorrection: number | null;
  /** Each category's reading as 0-100 of its highest threshold (the GPU's headroom, the lower of
   * the CPU's cores and benchmark score), null when there's no reading (a GPU not benchmarked).
   */
  scores: Record<DeviceLevelCategory, number | null>;
  /** Suggested settings. */
  recommendations: DeviceCapabilityRecommendations;
};

/** The device capability check's result: what was measured, and the verdict for the current targets. */
export type DeviceCapabilityReport = {
  /** The measuring's version: a stored result of another version is measured again. */
  reportVersion: number;
  /** When it was measured, ms since the epoch. */
  measuredAt: number;
  /** The measurements came from localStorage, not this check. */
  fromCache: boolean;
  /** The observer found the app's scenes slower than predicted, and a level or a recommendation
   * went down with it: the report to offer lower settings on (the engine applies nothing). False
   * on every other report, a check's included. */
  isSuggestionLowered: boolean;
  /** What was measured. */
  measurements: DeviceCapabilityMeasurements;
  /** The measurements scored against the targets. */
  verdict: DeviceCapabilityVerdict;
};
