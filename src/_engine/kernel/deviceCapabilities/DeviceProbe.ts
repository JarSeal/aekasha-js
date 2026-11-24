// The device capability check's static probe (p240 §5 step 1): what the browser tells about the
// GPU, memory, CPU, display and page, without running anything on the GPU. The browser's globals
// come in as a `DeviceProbeEnv`, read when the probe runs (`readBrowserProbeEnv`), so the tests
// hand it fakes and nothing is read at module load. The repo has no WebGPU typings (TypeScript
// 5.4), so the adapter's few fields are typed here.
import type {
  DeviceCapabilityMeasurements,
  DeviceGpuMeasurements,
  DeviceGpuMemorySource,
} from './DeviceCapabilitiesTypes';

/**
 * The adapter info the probe reads (`GPUAdapterInfo`). A browser may leave any field empty.
 * @internal
 */
export type ProbeGpuAdapterInfo = {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
};

/**
 * The adapter fields the probe reads (`GPUAdapter`): `info` since Chrome 127, `requestAdapterInfo()`
 * and `isFallbackAdapter` before it.
 * @internal
 */
export type ProbeGpuAdapter = {
  features: Iterable<string>;
  limits: Record<string, unknown>;
  info?: ProbeGpuAdapterInfo;
  requestAdapterInfo?: () => Promise<ProbeGpuAdapterInfo>;
  isFallbackAdapter?: boolean;
  /** The benchmark's device (`GpuBenchmarkWebGPU.ts` types what it gives). */
  requestDevice?: (descriptor?: object) => Promise<unknown>;
};

/**
 * The `navigator.gpu` fields the probe reads.
 * @internal
 */
export type ProbeGpu = {
  requestAdapter: (options?: { powerPreference?: string }) => Promise<ProbeGpuAdapter | null>;
  getPreferredCanvasFormat?: () => string;
};

/**
 * What the probe reads from the browser, gathered at the call ({@link readBrowserProbeEnv}).
 * @internal
 */
export type DeviceProbeEnv = {
  /** The `navigator` fields read (non-standard ones included). */
  navigator: {
    userAgent?: string;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
    gpu?: ProbeGpu;
  };
  /** `window.devicePixelRatio`. */
  devicePixelRatio: number;
  /** `screen`'s size, CSS pixels. */
  screen: { width: number; height: number } | null;
  /** Whether a media query matches, null without `matchMedia`. */
  matchMedia: ((query: string) => boolean) | null;
  /** `crossOriginIsolated`. */
  crossOriginIsolated: boolean;
  /** `OffscreenCanvas` exists. */
  hasOffscreenCanvas: boolean;
  /** `performance.memory.jsHeapSizeLimit` (Chromium only), bytes. */
  jsHeapSizeLimit: number | null;
  /** Creates a small, throwaway WebGL2 context (with `attributes`), null when there's none. */
  createWebGL2Context:
    | ((attributes?: WebGLContextAttributes) => WebGL2RenderingContext | null)
    | null;
};

/**
 * The adapter's identity strings (vendor, architecture, device, description): the device
 * fingerprint's GPU part, and what the GPU heuristics read.
 * @internal
 */
export type GpuIdentity = Pick<
  DeviceGpuMeasurements,
  'vendor' | 'architecture' | 'device' | 'description'
>;

// The WebGL constants read (numbers, so a test's fake context needs none of its own)
const GL_VENDOR = 0x1f00;
const GL_RENDERER = 0x1f01;
const GL_MAX_TEXTURE_SIZE = 0x0d33;
const GL_MAX_SAMPLES = 0x8d57;
const GL_UNMASKED_VENDOR = 0x9245;
const GL_UNMASKED_RENDERER = 0x9246;

/** The WebGPU limits that bound a renderer, kept in the measurements. */
const GPU_LIMIT_KEYS = [
  'maxTextureDimension2D',
  'maxTextureArrayLayers',
  'maxBindGroups',
  'maxSampledTexturesPerShaderStage',
  'maxSamplersPerShaderStage',
  'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxUniformBuffersPerShaderStage',
  'maxUniformBufferBindingSize',
  'maxStorageBufferBindingSize',
  'maxBufferSize',
  'maxVertexBuffers',
  'maxVertexAttributes',
  'maxColorAttachments',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupsPerDimension',
];

/** The share of the system memory a unified-memory GPU is counted to have (Apple silicon lets the
 * GPU take most of it; half leaves the app and the OS theirs). */
const UNIFIED_MEMORY_SHARE = 0.5;
/** The share of the system memory an integrated GPU is counted to have (its shared memory is
 * capped lower than a unified one's). */
const INTEGRATED_MEMORY_SHARE = 0.25;

/**
 * Reads the probe's inputs from the browser's globals. Call it only in a browser.
 * @internal
 */
export const readBrowserProbeEnv = (): DeviceProbeEnv => {
  const perf = performance as Performance & { memory?: { jsHeapSizeLimit?: number } };
  return {
    navigator: navigator as DeviceProbeEnv['navigator'],
    devicePixelRatio: window.devicePixelRatio || 1,
    screen: typeof screen !== 'undefined' ? { width: screen.width, height: screen.height } : null,
    matchMedia:
      typeof window.matchMedia === 'function' ? (query) => window.matchMedia(query).matches : null,
    crossOriginIsolated: window.crossOriginIsolated === true,
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    jsHeapSizeLimit: perf.memory?.jsHeapSizeLimit ?? null,
    createWebGL2Context: (attributes) => {
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(1, 1)
          : document.createElement('canvas');
      return canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null;
    },
  };
};

/** An empty string (a browser's hidden field) as null. */
const orNull = (value: string | undefined | null) => (value ? value : null);

/**
 * Requests a WebGPU adapter (high performance), null without WebGPU or when none comes (a browser
 * with WebGPU off, a blocked GPU) or the request throws.
 * @internal
 */
export const requestProbeAdapterAsync = async (env: DeviceProbeEnv) => {
  const gpu = env.navigator.gpu;
  if (!gpu) return null;
  try {
    return await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return null;
  }
};

/**
 * The adapter's info: `adapter.info`, or the older `requestAdapterInfo()`; empty when neither
 * gives it.
 * @internal
 */
export const readAdapterInfoAsync = async (
  adapter: ProbeGpuAdapter
): Promise<ProbeGpuAdapterInfo> => {
  if (adapter.info) return adapter.info;
  try {
    return (await adapter.requestAdapterInfo?.()) ?? {};
  } catch {
    return {};
  }
};

/**
 * Reads a WebGL2 context's limits and renderer, then loses the context. The renderer is
 * `RENDERER` itself where the browser gives the real one there (Firefox), else
 * `WEBGL_debug_renderer_info`'s (Chromium masks `RENDERER` as "WebKit WebGL"), so the deprecated
 * extension is asked only where it's needed.
 * @internal
 * @returns the WebGL2 fields, null without a WebGL2 context
 */
export const probeWebGL2 = (env: DeviceProbeEnv): DeviceGpuMeasurements['webgl2'] => {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = env.createWebGL2Context?.() ?? null;
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const extensions = [...(gl.getSupportedExtensions() ?? [])].sort();
  let vendor = orNull(gl.getParameter(GL_VENDOR) as string | null);
  let renderer = orNull(gl.getParameter(GL_RENDERER) as string | null);
  if (
    (!renderer || /^webkit/i.test(renderer)) &&
    extensions.includes('WEBGL_debug_renderer_info')
  ) {
    gl.getExtension('WEBGL_debug_renderer_info');
    vendor = orNull(gl.getParameter(GL_UNMASKED_VENDOR) as string | null) ?? vendor;
    renderer = orNull(gl.getParameter(GL_UNMASKED_RENDERER) as string | null) ?? renderer;
  }
  const isMasked = (value: string | null) => !value || /^webkit/i.test(value);
  const result = {
    maxTextureSize: Number(gl.getParameter(GL_MAX_TEXTURE_SIZE)) || 0,
    maxSamples: Number(gl.getParameter(GL_MAX_SAMPLES)) || 0,
    extensions,
    unmaskedVendor: isMasked(vendor) ? null : vendor,
    unmaskedRenderer: isMasked(renderer) ? null : renderer,
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return result;
};

/**
 * What a GPU's identity strings tell about it: a software renderer, unified memory (Apple
 * silicon), an integrated GPU (Intel's but Arc, AMD's APUs, mobile GPUs). Each is null when the
 * strings don't tell (a browser that hides them, an unknown name); a discrete GPU is
 * `isIntegrated: false`.
 * @internal
 */
export const classifyGpu = ({ vendor, architecture, description }: GpuIdentity) => {
  const text = `${vendor ?? ''} ${architecture ?? ''} ${description ?? ''}`.toLowerCase();
  if (!text.trim()) return { isSoftware: null, isUnifiedMemory: null, isIntegrated: null };

  if (/swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render/.test(text)) {
    return { isSoftware: true, isUnifiedMemory: false, isIntegrated: null };
  }
  // Apple silicon (Chrome: vendor "apple", architecture "metal-3"; WebGL: "Apple M2"). An Intel
  // Mac's GPU isn't, and its vendor isn't "apple"
  if (/\bapple\b/.test(text) && !/intel|amd|radeon|nvidia/.test(text)) {
    return { isSoftware: false, isUnifiedMemory: true, isIntegrated: true };
  }
  // Mobile GPUs share the system memory
  if (/qualcomm|adreno|\barm\b|mali|imagination|powervr|samsung|xclipse/.test(text)) {
    return { isSoftware: false, isUnifiedMemory: false, isIntegrated: true };
  }
  if (/nvidia|geforce|quadro|\brtx\b/.test(text)) {
    return { isSoftware: false, isUnifiedMemory: false, isIntegrated: false };
  }
  if (/intel/.test(text)) {
    const isArc = /\barc\b|xe-hpg|alchemist|battlemage/.test(text);
    return { isSoftware: false, isUnifiedMemory: false, isIntegrated: !isArc };
  }
  if (/\bamd\b|\bati\b|radeon/.test(text)) {
    if (/\brx\b|radeon pro|\bfirepro\b/.test(text)) {
      return { isSoftware: false, isUnifiedMemory: false, isIntegrated: false };
    }
    // An APU: "AMD Radeon(TM) Graphics", "Radeon Vega 8 Graphics", "Radeon 780M"
    if (/radeon\s*(\(tm\))?\s*graphics|vega \d+ graphics|radeon \d{3}m\b/.test(text)) {
      return { isSoftware: false, isUnifiedMemory: false, isIntegrated: true };
    }
  }
  return { isSoftware: false, isUnifiedMemory: null, isIntegrated: null };
};

/**
 * The GPU memory guess (p240 §1.1): no browser tells it, so only a GPU that shares the system
 * memory gets one, a share of `navigator.deviceMemory`; a discrete GPU's is unknown.
 * @internal
 */
export const estimateGpuMemoryMB = (
  gpu: Pick<DeviceGpuMeasurements, 'isUnifiedMemory' | 'isIntegrated'>,
  deviceMemoryGB: number | null
): { value: number | null; source: DeviceGpuMemorySource } => {
  if (deviceMemoryGB === null) return { value: null, source: 'UNKNOWN' };
  if (gpu.isUnifiedMemory) {
    return {
      value: Math.round(deviceMemoryGB * 1024 * UNIFIED_MEMORY_SHARE),
      source: 'HEURISTIC_UNIFIED',
    };
  }
  if (gpu.isIntegrated) {
    return {
      value: Math.round(deviceMemoryGB * 1024 * INTEGRATED_MEMORY_SHARE),
      source: 'HEURISTIC_INTEGRATED',
    };
  }
  return { value: null, source: 'UNKNOWN' };
};

/** The adapter's limits in {@link GPU_LIMIT_KEYS} (read one by one: `GPUSupportedLimits` keeps them
 * as prototype getters, which `Object.keys` doesn't list). */
const readAdapterLimits = (adapter: ProbeGpuAdapter) => {
  const limits: Record<string, number> = {};
  for (const key of GPU_LIMIT_KEYS) {
    const value = adapter.limits[key];
    if (typeof value === 'number') limits[key] = value;
  }
  return limits;
};

/**
 * The GPU's measurements from its adapter (null without one) and the WebGL2 probe.
 * @internal
 */
export const probeGpuAsync = async (
  env: DeviceProbeEnv,
  adapter: ProbeGpuAdapter | null
): Promise<DeviceGpuMeasurements> => {
  const webgl2 = probeWebGL2(env);
  const info = adapter ? await readAdapterInfoAsync(adapter) : {};
  const identity: GpuIdentity = adapter
    ? {
        vendor: orNull(info.vendor),
        architecture: orNull(info.architecture),
        device: orNull(info.device),
        description: orNull(info.description),
      }
    : {
        vendor: webgl2?.unmaskedVendor ?? null,
        architecture: null,
        device: null,
        description: webgl2?.unmaskedRenderer ?? null,
      };
  // WebGPU's info is often coarse (vendor and architecture only): WebGL's renderer string adds
  // the model for the heuristics
  const classified = classifyGpu({
    ...identity,
    description: [identity.description, webgl2?.unmaskedRenderer].filter(Boolean).join(' ') || null,
  });
  // Software when either says so: the adapter's flag, or a renderer named like one (WebGL on
  // SwiftShader has no flag)
  const adapterFallback = adapter ? info.isFallbackAdapter ?? adapter.isFallbackAdapter : undefined;
  const isFallbackAdapter =
    adapterFallback === true || classified.isSoftware === true
      ? true
      : adapterFallback ?? classified.isSoftware;

  let preferredCanvasFormat: string | null = null;
  if (adapter) {
    try {
      preferredCanvasFormat = env.navigator.gpu?.getPreferredCanvasFormat?.() ?? null;
    } catch {
      preferredCanvasFormat = null;
    }
  }

  return {
    api: adapter ? 'WEBGPU' : webgl2 ? 'WEBGL2' : 'NONE',
    ...identity,
    isFallbackAdapter,
    isUnifiedMemory: classified.isUnifiedMemory,
    isIntegrated: classified.isIntegrated,
    features: adapter ? [...adapter.features].sort() : [],
    limits: adapter ? readAdapterLimits(adapter) : {},
    preferredCanvasFormat,
    webgl2,
  };
};

/** The user agent's mobile flag (`userAgentData.mobile`), else a guess from the UA string. */
const readIsMobile = (nav: DeviceProbeEnv['navigator']) => {
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  if (!nav.userAgent) return null;
  return /mobi|android|iphone|ipad|ipod/i.test(nav.userAgent);
};

/**
 * The static probe: everything the browser tells, without the benchmark (its fields null). `adapter` is the one
 * the caller already requested (the fingerprint's), else one is requested here.
 * @internal
 */
export const probeDeviceAsync = async (
  env: DeviceProbeEnv,
  adapter?: ProbeGpuAdapter | null
): Promise<DeviceCapabilityMeasurements> => {
  const nav = env.navigator;
  const gpu = await probeGpuAsync(
    env,
    adapter === undefined ? await requestProbeAdapterAsync(env) : adapter
  );
  const deviceMemoryGB =
    typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null;
  const matches = (query: string) => env.matchMedia?.(query) ?? false;

  return {
    gpu,
    gpuMemoryMB: estimateGpuMemoryMB(gpu, deviceMemoryGB),
    memory: {
      deviceMemoryGB,
      jsHeapLimitMB:
        env.jsHeapSizeLimit !== null ? Math.round(env.jsHeapSizeLimit / (1024 * 1024)) : null,
    },
    cpu: {
      cores:
        typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
          ? nav.hardwareConcurrency
          : null,
      benchScore: null,
    },
    display: {
      width: env.screen?.width ?? 0,
      height: env.screen?.height ?? 0,
      devicePixelRatio: env.devicePixelRatio,
      refreshHz: null,
      hdr: matches('(dynamic-range: high)'),
      wideGamut: matches('(color-gamut: p3)'),
    },
    env: {
      crossOriginIsolated: env.crossOriginIsolated,
      offscreenCanvas: env.hasOffscreenCanvas,
      isMobile: readIsMobile(nav),
      coarsePointer: matches('(pointer: coarse)'),
    },
    benchmark: null,
  };
};

/**
 * The device fingerprint's input (p240 §4): the user agent, the GPU's identity (the adapter's,
 * else WebGL's renderer), the screen's size and pixel ratio, and the cores. A stored result whose
 * fingerprint differs was measured on another device, browser, GPU or display. Costs an adapter
 * request (or a WebGL context without WebGPU), the whole cost of a stored result's boot.
 * @internal
 * @returns the text to hash, and the adapter requested, for the probe to reuse
 */
export const readDeviceFingerprintInputAsync = async (env: DeviceProbeEnv) => {
  const adapter = await requestProbeAdapterAsync(env);
  let gpuId: string;
  if (adapter) {
    const info = await readAdapterInfoAsync(adapter);
    gpuId = `WEBGPU|${info.vendor ?? ''}|${info.architecture ?? ''}|${info.device ?? ''}|${info.description ?? ''}`;
  } else {
    const webgl2 = probeWebGL2(env);
    gpuId = webgl2
      ? `WEBGL2|${webgl2.unmaskedVendor ?? ''}|${webgl2.unmaskedRenderer ?? ''}`
      : 'NONE';
  }
  const text = [
    env.navigator.userAgent ?? '',
    gpuId,
    `${env.screen?.width ?? 0}x${env.screen?.height ?? 0}@${env.devicePixelRatio}`,
    String(env.navigator.hardwareConcurrency ?? 0),
  ].join('#');
  return { text, adapter };
};
