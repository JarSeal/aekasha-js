import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTextureBudget, chooseTerrainStorage, getTextureBindingLimit } from './TerrainStorage';

const stubs = vi.hoisted(() => ({ renderer: null as unknown }));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  getRenderer: () => stubs.renderer,
}));

const webGpu = (sampled: number, samplers: number) => ({
  backend: {
    isWebGPUBackend: true,
    device: {
      limits: { maxSampledTexturesPerShaderStage: sampled, maxSamplersPerShaderStage: samplers },
    },
  },
});

describe('getTextureBindingLimit', () => {
  beforeEach(() => {
    stubs.renderer = null;
  });

  it("reads WebGPU's device limits (the lower of textures and samplers), WebGL2's units", () => {
    expect(getTextureBindingLimit()).toBe(16);
    stubs.renderer = webGpu(32, 24);
    expect(getTextureBindingLimit()).toBe(24);
    // A WebGPU backend before its device: the default
    stubs.renderer = { backend: { isWebGPUBackend: true } };
    expect(getTextureBindingLimit()).toBe(16);
    stubs.renderer = {
      backend: { gl: { MAX_TEXTURE_IMAGE_UNITS: 0x8872, getParameter: () => 32 } },
    };
    expect(getTextureBindingLimit()).toBe(32);
  });
});

describe('checkTextureBudget', () => {
  beforeEach(() => {
    stubs.renderer = null;
  });

  it('passes at the budget and throws past it', () => {
    const bindings = [
      { name: 'layer0-layer3', count: 8 },
      { name: 'macro', count: 1 },
    ];
    expect(() => checkTextureBudget(bindings, 7, false)).not.toThrow();
    expect(() => checkTextureBudget(bindings, 8, false)).toThrow(
      'binds 9 textures, over its budget of 8 (16 a stage less 8 reserved): layer0-layer3: 8; macro: 1. Try ARRAY storage'
    );
    expect(() => checkTextureBudget(bindings, 8, true)).toThrow(/Try fewer splat maps/);
  });
});

describe('chooseTerrainStorage', () => {
  it('stays SEPARATE while the layers and the rest fit', () => {
    stubs.renderer = null;
    expect(chooseTerrainStorage([2, 2, 2, 2], 2, 6)).toBe('SEPARATE');
    expect(chooseTerrainStorage([2, 2, 2, 2, 2], 1, 6)).toBe('ARRAY');
    stubs.renderer = webGpu(32, 32);
    expect(chooseTerrainStorage([2, 2, 2, 2, 2], 1, 6)).toBe('SEPARATE');
  });
});
