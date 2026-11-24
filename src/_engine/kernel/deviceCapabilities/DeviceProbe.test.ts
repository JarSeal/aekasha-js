import { describe, expect, it, vi } from 'vitest';
import {
  classifyGpu,
  estimateGpuMemoryMB,
  probeDeviceAsync,
  probeWebGL2,
  readDeviceFingerprintInputAsync,
  type DeviceProbeEnv,
  type ProbeGpuAdapter,
} from './DeviceProbe';

// A fake WebGL2 context: getParameter answers from a table by the constant's number
const createFakeGL = (params: Record<number, unknown>, extensions: string[] = []) => {
  const loseContext = vi.fn();
  const getExtension = vi.fn((name: string) =>
    name === 'WEBGL_lose_context' ? { loseContext } : {}
  );
  const gl = {
    getParameter: (key: number) => params[key] ?? null,
    getSupportedExtensions: () => extensions,
    getExtension,
  } as unknown as WebGL2RenderingContext;
  return { gl, loseContext, getExtension };
};

const CHROME_MASKED = {
  0x1f00: 'WebKit',
  0x1f01: 'WebKit WebGL',
  0x0d33: 16384,
  0x8d57: 8,
  0x9245: 'Google Inc. (NVIDIA)',
  0x9246: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
};

const createAdapter = (
  info: ProbeGpuAdapter['info'],
  features: string[] = []
): ProbeGpuAdapter => ({
  features: new Set(features),
  limits: { maxTextureDimension2D: 16384, maxBindGroups: 4, notALimit: 'x' },
  info,
});

const createEnv = (overrides: Partial<DeviceProbeEnv> = {}): DeviceProbeEnv => ({
  navigator: { userAgent: 'TestAgent/1.0', hardwareConcurrency: 8, deviceMemory: 8 },
  devicePixelRatio: 2,
  screen: { width: 1920, height: 1080 },
  matchMedia: (query) => query === '(color-gamut: p3)',
  crossOriginIsolated: true,
  hasOffscreenCanvas: true,
  jsHeapSizeLimit: 4096 * 1024 * 1024,
  createWebGL2Context: () => createFakeGL(CHROME_MASKED, ['WEBGL_debug_renderer_info']).gl,
  ...overrides,
});

describe('classifyGpu', () => {
  const classify = (description: string, vendor: string | null = null) =>
    classifyGpu({ vendor, architecture: null, device: null, description });

  it('knows unified memory, integrated and discrete GPUs by name', () => {
    expect(
      classify('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)')
    ).toEqual({ isSoftware: false, isUnifiedMemory: true, isIntegrated: true });
    expect(classify('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)').isIntegrated).toBe(true);
    expect(classify('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)').isIntegrated).toBe(
      false
    );
    expect(classify(CHROME_MASKED[0x9246]).isIntegrated).toBe(false);
    expect(classify('ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11)').isIntegrated).toBe(false);
    expect(classify('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)').isIntegrated).toBe(true);
    expect(classify('Adreno (TM) 640').isIntegrated).toBe(true);
    expect(classify('Mali-G78', 'ARM').isIntegrated).toBe(true);
  });

  it('knows software renderers', () => {
    expect(classify('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))').isSoftware).toBe(
      true
    );
    expect(classify('llvmpipe (LLVM 15.0.7, 256 bits)').isSoftware).toBe(true);
  });

  it("is unknown when the browser hides the names, or doesn't know them", () => {
    expect(
      classifyGpu({ vendor: null, architecture: null, device: null, description: null })
    ).toEqual({ isSoftware: null, isUnifiedMemory: null, isIntegrated: null });
    expect(classify('Some Future GPU 9000')).toEqual({
      isSoftware: false,
      isUnifiedMemory: null,
      isIntegrated: null,
    });
  });
});

describe('estimateGpuMemoryMB', () => {
  it('guesses only for a GPU that shares the system memory', () => {
    expect(estimateGpuMemoryMB({ isUnifiedMemory: true, isIntegrated: true }, 8)).toEqual({
      value: 4096,
      source: 'HEURISTIC_UNIFIED',
    });
    expect(estimateGpuMemoryMB({ isUnifiedMemory: false, isIntegrated: true }, 8)).toEqual({
      value: 2048,
      source: 'HEURISTIC_INTEGRATED',
    });
    expect(estimateGpuMemoryMB({ isUnifiedMemory: false, isIntegrated: false }, 8).source).toBe(
      'UNKNOWN'
    );
    expect(estimateGpuMemoryMB({ isUnifiedMemory: true, isIntegrated: true }, null)).toEqual({
      value: null,
      source: 'UNKNOWN',
    });
  });
});

describe('probeWebGL2', () => {
  it("unmasks Chromium's renderer through the extension and loses the context", () => {
    const fake = createFakeGL(CHROME_MASKED, ['WEBGL_lose_context', 'WEBGL_debug_renderer_info']);
    const webgl2 = probeWebGL2(createEnv({ createWebGL2Context: () => fake.gl }));
    expect(webgl2).toEqual({
      maxTextureSize: 16384,
      maxSamples: 8,
      extensions: ['WEBGL_debug_renderer_info', 'WEBGL_lose_context'],
      unmaskedVendor: 'Google Inc. (NVIDIA)',
      unmaskedRenderer: CHROME_MASKED[0x9246],
    });
    expect(fake.loseContext).toHaveBeenCalledOnce();
  });

  it("reads RENDERER itself where it's real, without the deprecated extension", () => {
    const fake = createFakeGL(
      { 0x1f00: 'Mozilla', 0x1f01: 'NVIDIA GeForce GTX 980, or similar', 0x0d33: 8192 },
      ['WEBGL_debug_renderer_info']
    );
    const webgl2 = probeWebGL2(createEnv({ createWebGL2Context: () => fake.gl }));
    expect(webgl2?.unmaskedRenderer).toBe('NVIDIA GeForce GTX 980, or similar');
    expect(fake.getExtension).not.toHaveBeenCalledWith('WEBGL_debug_renderer_info');
  });

  it('keeps a masked renderer null, and gives null without a context', () => {
    const masked = createFakeGL({ 0x1f00: 'WebKit', 0x1f01: 'WebKit WebGL' });
    expect(probeWebGL2(createEnv({ createWebGL2Context: () => masked.gl }))).toMatchObject({
      unmaskedVendor: null,
      unmaskedRenderer: null,
    });
    expect(probeWebGL2(createEnv({ createWebGL2Context: () => null }))).toBeNull();
    expect(
      probeWebGL2(
        createEnv({
          createWebGL2Context: () => {
            throw new Error('no GL');
          },
        })
      )
    ).toBeNull();
  });
});

describe('probeDeviceAsync', () => {
  it('reads a WebGPU adapter, the memory, CPU, display and page', async () => {
    const adapter = createAdapter({ vendor: 'nvidia', architecture: 'ampere' }, [
      'timestamp-query',
      'float32-filterable',
    ]);
    const requestAdapter = vi.fn(async () => adapter);
    const env = createEnv({
      navigator: {
        userAgent: 'TestAgent/1.0',
        hardwareConcurrency: 12,
        deviceMemory: 8,
        userAgentData: { mobile: false },
        gpu: { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' },
      },
    });
    const m = await probeDeviceAsync(env);

    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
    expect(m.gpu).toMatchObject({
      api: 'WEBGPU',
      vendor: 'nvidia',
      architecture: 'ampere',
      device: null,
      description: null,
      // The WebGL renderer string tells the model the adapter info leaves out
      isIntegrated: false,
      isFallbackAdapter: false,
      features: ['float32-filterable', 'timestamp-query'],
      limits: { maxTextureDimension2D: 16384, maxBindGroups: 4 },
      preferredCanvasFormat: 'bgra8unorm',
    });
    expect(m.gpu.webgl2?.maxTextureSize).toBe(16384);
    expect(m.gpuMemoryMB).toEqual({ value: null, source: 'UNKNOWN' });
    expect(m.memory).toEqual({ deviceMemoryGB: 8, jsHeapLimitMB: 4096 });
    expect(m.cpu).toEqual({ cores: 12 });
    expect(m.display).toEqual({
      width: 1920,
      height: 1080,
      devicePixelRatio: 2,
      refreshHz: null,
      hdr: false,
      wideGamut: true,
    });
    expect(m.env).toEqual({
      crossOriginIsolated: true,
      offscreenCanvas: true,
      isMobile: false,
      coarsePointer: false,
    });
  });

  it('falls back to WebGL2 when no adapter comes, and to NONE without either', async () => {
    const env = createEnv({
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile', deviceMemory: 4 },
      createWebGL2Context: () =>
        createFakeGL({ 0x1f00: 'Qualcomm', 0x1f01: 'Adreno (TM) 740', 0x0d33: 4096 }).gl,
    });
    const m = await probeDeviceAsync(env);
    expect(m.gpu).toMatchObject({
      api: 'WEBGL2',
      vendor: 'Qualcomm',
      description: 'Adreno (TM) 740',
      isIntegrated: true,
      features: [],
      preferredCanvasFormat: null,
    });
    expect(m.gpuMemoryMB).toEqual({ value: 1024, source: 'HEURISTIC_INTEGRATED' });
    expect(m.cpu.cores).toBeNull();
    expect(m.env.isMobile).toBe(true);

    const none = await probeDeviceAsync(
      createEnv({
        navigator: { gpu: { requestAdapter: async () => null } },
        createWebGL2Context: null,
        jsHeapSizeLimit: null,
        matchMedia: null,
      })
    );
    expect(none.gpu.api).toBe('NONE');
    expect(none.memory).toEqual({ deviceMemoryGB: null, jsHeapLimitMB: null });
    expect(none.env.isMobile).toBeNull();
  });

  it('treats a throwing adapter request as no WebGPU, and flags a fallback adapter', async () => {
    const throwing = await probeDeviceAsync(
      createEnv({
        navigator: {
          gpu: {
            requestAdapter: async () => {
              throw new Error('blocked');
            },
          },
        },
      })
    );
    expect(throwing.gpu.api).toBe('WEBGL2');

    const fallback = createAdapter(undefined);
    fallback.isFallbackAdapter = true;
    fallback.requestAdapterInfo = async () => ({ vendor: 'google' });
    const m = await probeDeviceAsync(createEnv(), fallback);
    expect(m.gpu).toMatchObject({ api: 'WEBGPU', vendor: 'google', isFallbackAdapter: true });
  });
});

describe('readDeviceFingerprintInputAsync', () => {
  it('changes with the GPU, the display and the cores, and hands back the adapter', async () => {
    const adapter = createAdapter({ vendor: 'apple', architecture: 'metal-3' });
    const env = createEnv({
      navigator: {
        userAgent: 'TestAgent/1.0',
        hardwareConcurrency: 8,
        gpu: { requestAdapter: async () => adapter },
      },
    });
    const first = await readDeviceFingerprintInputAsync(env);
    expect(first.adapter).toBe(adapter);
    expect(first.text).toBe('TestAgent/1.0#WEBGPU|apple|metal-3||#1920x1080@2#8');

    expect((await readDeviceFingerprintInputAsync({ ...env, devicePixelRatio: 1 })).text).not.toBe(
      first.text
    );
    const webgl = await readDeviceFingerprintInputAsync(createEnv());
    expect(webgl.adapter).toBeNull();
    expect(webgl.text).toContain('WEBGL2|Google Inc. (NVIDIA)|ANGLE (NVIDIA');
  });
});
