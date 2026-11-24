// The device capability check's types (p240): its config, the measurements it stores, and the
// verdict scored from them. Types only, so the config and the entry name them without loading the
// check.
import type { PhysicsWorkerTarget } from '../../features/physics/types/PhysicsConfigTypes';
import type { QualityLevel } from '../../utils/QualityLevel';

/** A device level's category: the GPU, the CPU, the system memory and the GPU memory. */
export type DeviceLevelCategory = 'gpu' | 'cpu' | 'memory' | 'gpuMemory';

/** A target check's result: `UNKNOWN` when the browser doesn't tell (`targets.unknownIs` counts it). */
export type DeviceCheckResult = 'PASS' | 'FAIL' | 'UNKNOWN';

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
  /** The resolution the frame rate is held at: `'CANVAS'` is the canvas's size (`getCanvasSize`)
   * × `devicePixelRatio`. Default `'CANVAS'`. */
  resolution?: 'CANVAS' | { width: number; height: number };
  /** The least system memory, GB (`navigator.deviceMemory`, Chromium only). The browser reports 8 at
   * most, so a higher target is clamped to 8, with a warning. Default 4. */
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

/** {@link DeviceCapabilityTargets} with every default filled in: what a verdict was scored against. */
export type ResolvedDeviceCapabilityTargets = Required<DeviceCapabilityTargets>;

/** The least value for each level above `LOW`: a reading under `MEDIUM`'s is `LOW`, and a level
 * without a value is never given. */
export type DeviceLevelBands = Partial<Record<Exclude<QualityLevel, 'LOW'>, number>>;

/**
 * The values the device levels are rated by, per input (p240 §3.1): a category gets the highest
 * level whose value its reading meets. Each is merged over the engine's.
 */
export type DeviceLevelThresholds = {
  /** CPU logical cores. Default `{ MEDIUM: 4, HIGH: 6, ULTRA: 12 }`. */
  cpuCores?: DeviceLevelBands;
  /** System memory, GB. The browser reports 8 at most, so no `ULTRA` by default. Default
   * `{ MEDIUM: 4, HIGH: 8 }`. */
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
  /** What the device should manage ({@link DeviceCapabilityTargets}), over the engine's defaults. */
  targets?: DeviceCapabilityTargets;
  /** The device levels' thresholds ({@link DeviceLevelThresholds}), over the engine's. */
  levelThresholds?: DeviceLevelThresholds;
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
  };
  /** The display. */
  display: {
    /** The screen's width, CSS pixels. */
    width: number;
    /** The screen's height, CSS pixels. */
    height: number;
    /** `window.devicePixelRatio` when measured. */
    devicePixelRatio: number;
    /** The display's refresh rate, Hz, null when not measured. */
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
  /** The lowest of the known categories' levels (the weakest part is the bottleneck); a capped 8 GB
   * memory reading doesn't lower it. */
  overall: QualityLevel;
  /** The GPU's level: from the adapter when not benchmarked, never `ULTRA` then. */
  gpu: QualityLevel;
  /** The CPU's level: from the cores when not benchmarked. */
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
  /** The renderer's pixel ratio (`createRenderer`'s `devicePixelRatio`). */
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
  /** The frame rate predicted at the target resolution, null when not benchmarked. */
  estimatedFps: number | null;
  /** The frame rate the `fps` check asks for: the lower of `targets.fps` and the refresh rate. */
  effectiveFpsTarget: number;
  /** Every check passed (an `UNKNOWN` one as `targets.unknownIs` says). */
  meetsTargets: boolean;
  /** The checks that didn't pass, by name. */
  failedTargets: (keyof DeviceCapabilityChecks)[];
  /** The device's levels. */
  levels: DeviceLevels;
  /** Each category's reading as 0-100 of its highest threshold, null when there's no reading (a
   * GPU rated from the adapter alone has none). */
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
  /** What was measured. */
  measurements: DeviceCapabilityMeasurements;
  /** The measurements scored against the targets. */
  verdict: DeviceCapabilityVerdict;
};
