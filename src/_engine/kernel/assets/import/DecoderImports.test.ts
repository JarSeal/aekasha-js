import { describe, expect, it, vi } from 'vitest';

// Each import fails until `failing` is cleared: a chunk that didn't load (a flaky network)
const failing = vi.hoisted(() => ({ meshopt: true, ktx2: true }));
const renderer = vi.hoisted(() => ({}));

vi.mock('three/addons/libs/meshopt_decoder.module.js', () => {
  if (failing.meshopt) throw new Error('chunk failed to load');
  return { MeshoptDecoder: { name: 'meshopt' } };
});

vi.mock('three/addons/loaders/KTX2Loader.js', () => {
  if (failing.ktx2) throw new Error('chunk failed to load');
  class KTX2Loader {
    setTranscoderPath() {
      return this;
    }
    detectSupport() {
      return this;
    }
    dispose() {}
  }
  return { KTX2Loader };
});

vi.mock('../../render/Renderer', () => ({ getRenderer: () => renderer }));
vi.mock('../AssetUrl', () => ({ getAppBaseUrl: () => 'http://localhost/' }));

describe('decoder imports', () => {
  it('tries the meshopt decoder again after a failed import', async () => {
    const { getMeshoptDecoder } = await import('./MeshoptDecoder');
    await expect(getMeshoptDecoder()).rejects.toThrow();
    failing.meshopt = false;
    await expect(getMeshoptDecoder()).resolves.toEqual({ name: 'meshopt' });
    // Cached once it has loaded
    expect(getMeshoptDecoder()).toBe(getMeshoptDecoder());
  });

  it('tries the KTX2 loader again after a failed import', async () => {
    const { getKTX2Loader } = await import('./KTX2');
    await expect(getKTX2Loader()).rejects.toThrow();
    failing.ktx2 = false;
    const loader = await getKTX2Loader();
    expect(loader).toBeDefined();
    expect(await getKTX2Loader()).toBe(loader);
  });
});
