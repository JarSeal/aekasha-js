import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three/webgpu';
import type { GeneratedTerrain, TerrainOptions } from './Terrain';
import type { TerrainWorkerRequest } from './TerrainWorkerProtocol';

// The worker, in this thread: each message structured-cloned both ways (the response with its
// transfers), the handler the real worker runs. `mode` makes it fail to start or crash on a request.
const bridge = vi.hoisted(() => ({
  mode: 'OK' as 'OK' | 'NO_START' | 'CRASH',
  requests: [] as TerrainWorkerRequest[],
  workers: [] as { terminated: boolean }[],
  lwarn: vi.fn(),
}));

vi.mock('./TerrainWorker?worker', async () => {
  const { handleTerrainWorkerRequest } = await import('./TerrainWorkerProtocol');
  class InProcessWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    terminated = false;
    cache = { noises: new Map(), heightmaps: new Map() };
    constructor() {
      if (bridge.mode === 'NO_START') throw new Error('Worker is not defined');
      bridge.workers.push(this);
      setTimeout(() => this.onmessage?.({ data: { status: 'INIT_READY' } }));
    }
    postMessage(message: TerrainWorkerRequest) {
      const request = structuredClone(message);
      bridge.requests.push(request);
      setTimeout(() => {
        if (this.terminated) return;
        if (bridge.mode === 'CRASH') return this.onerror?.({ message: 'out of memory' });
        const { response, transfer } = handleTerrainWorkerRequest(request, this.cache);
        this.onmessage?.({ data: structuredClone(response, { transfer }) });
      });
    }
    terminate() {
      this.terminated = true;
    }
  }
  return { default: InProcessWorker };
});

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  lwarn: bridge.lwarn,
}));

/** A fresh client (no worker started) and the generator it falls back to */
const importAsync = async () => {
  vi.resetModules();
  const { generateTerrainAsync } = await import('./TerrainAsync');
  const { generateTerrain } = await import('./Terrain');
  return { generateTerrainAsync, generateTerrain };
};

/** 4 × 4 noise texels, every byte different */
const NOISE = {
  data: Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256),
  width: 4,
  height: 4,
};

/** A block with everything the worker takes: its normals, AO, rules with noise, skirt, collider */
const BLOCK: TerrainOptions = {
  width: 32,
  depth: 32,
  widthSegments: 16,
  depthSegments: 16,
  maxHeight: 8,
  seed: 5,
  center: [32, -32],
  normals: 'HEIGHT_FN',
  ao: { radius: 6 },
  vertexColors: {
    layout: 'RGB_AO',
    rules: [
      { layer: 1, slope: { min: 15 }, noise: { scale: 10, amount: 0.4 } },
      { layer: 2, height: { min: 2 } },
    ],
    noise: NOISE,
  },
  skirt: 1,
  collider: true,
};

/** The two terrains' geometry, bounds, heights, AO, heightfield and heights read back */
const expectSameTerrain = (actual: GeneratedTerrain, expected: GeneratedTerrain) => {
  const arrays = (geometry: THREE.BufferGeometry) =>
    Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array])
    );
  expect(arrays(actual.geometry)).toEqual(arrays(expected.geometry));
  expect(actual.geometry.getIndex()!.array).toEqual(expected.geometry.getIndex()!.array);
  expect(actual.geometry.boundingBox).toEqual(expected.geometry.boundingBox);
  expect(actual.geometry.boundingSphere).toEqual(expected.geometry.boundingSphere);
  expect(actual.heights).toEqual(expected.heights);
  expect(actual.ao).toEqual(expected.ao);
  expect(actual.heightfield).toEqual(expected.heightfield);
  expect(actual.getHeightAt(3.3, -7.1)).toBe(expected.getHeightAt(3.3, -7.1));
};

beforeEach(() => {
  bridge.mode = 'OK';
  bridge.requests = [];
  bridge.workers = [];
  bridge.lwarn.mockClear();
});

describe('generateTerrainAsync (p306 Phase 4)', () => {
  // The first import of the worker modules: about 1 s alone, past the 5 s default under the full
  // suite's load (and a timed-out run's late request then lands in the next test's)
  it("gives generateTerrain's terrain, generated on the worker", async () => {
    const { generateTerrainAsync, generateTerrain } = await importAsync();
    expectSameTerrain(await generateTerrainAsync(BLOCK), generateTerrain(BLOCK));
    expect(bridge.workers).toHaveLength(1);
    expect(bridge.requests).toHaveLength(1);
    // The seed went as its draws, the collider stays here
    const { options } = bridge.requests[0];
    expect(options.noiseDraws).toHaveLength(256);
    expect(Object.keys(options)).not.toContain('seed');
    expect(Object.keys(options)).not.toContain('collider');
    expect(bridge.lwarn).not.toHaveBeenCalled();
  }, 30_000);

  it("sends a noise's texels once, then its key", async () => {
    const { generateTerrainAsync } = await importAsync();
    await generateTerrainAsync(BLOCK);
    await generateTerrainAsync({ ...BLOCK, center: [0, 0] });
    const [first, second] = bridge.requests;
    expect(first.noise).toEqual(NOISE);
    expect(second.noise).toBeUndefined();
    expect(second.noiseKey).toBe(first.noiseKey);
    expect(first.options.vertexColors).not.toHaveProperty('noise');
    expect(bridge.workers).toHaveLength(1);
  });

  it('sends a heightmap once, then its key, and no noise draws', async () => {
    const { generateTerrainAsync, generateTerrain } = await importAsync();
    const heightmap = {
      heights: Float32Array.from({ length: 81 }, (_, i) => ((i * 13) % 17) * 0.5),
      cols: 9,
      rows: 9,
      width: 64,
      depth: 64,
      center: [16, -16] as [number, number],
    };
    const { maxHeight: _maxHeight, ...block } = BLOCK;
    const fromMap = { ...block, heightmap };
    expectSameTerrain(await generateTerrainAsync(fromMap), generateTerrain(fromMap));
    await generateTerrainAsync({ ...fromMap, center: [0, 0] });
    const [first, second] = bridge.requests;
    expect(first.heightmap).toEqual(heightmap);
    expect(second.heightmap).toBeUndefined();
    expect(second.heightmapKey).toBe(first.heightmapKey);
    // The noise texels have a key of their own
    expect(first.noiseKey).not.toBe(first.heightmapKey);
    expect(Object.keys(first.options)).not.toContain('heightmap');
    expect(first.options.noiseDraws).toBeUndefined();
  });

  it('refuses heightFn and heightModifier, naming them', async () => {
    const { generateTerrainAsync } = await importAsync();
    const withFunctions = {
      ...BLOCK,
      heightFn: () => 1,
      heightModifier: (_x: number, _z: number, h: number) => h,
    } as TerrainOptions;
    await expect(generateTerrainAsync(withFunctions)).rejects.toThrow(
      "heightFn and heightModifier can't go to a worker"
    );
    expect(bridge.workers).toHaveLength(0);
  });

  it("rejects with the core's error", async () => {
    const { generateTerrainAsync } = await importAsync();
    await expect(generateTerrainAsync({ ...BLOCK, skirt: -1 })).rejects.toThrow(
      'generateTerrain: skirt is -1, not 0 or more.'
    );
    // The worker keeps going
    await expect(generateTerrainAsync(BLOCK)).resolves.toBeDefined();
  });

  it('generates on this thread for MAIN_THREAD, without the worker', async () => {
    const { generateTerrainAsync, generateTerrain } = await importAsync();
    expectSameTerrain(
      await generateTerrainAsync({ ...BLOCK, workerTarget: 'MAIN_THREAD' }),
      generateTerrain(BLOCK)
    );
    expect(bridge.workers).toHaveLength(0);
  });

  it("generates on this thread when the worker can't start, warning once", async () => {
    bridge.mode = 'NO_START';
    const { generateTerrainAsync, generateTerrain } = await importAsync();
    expectSameTerrain(await generateTerrainAsync(BLOCK), generateTerrain(BLOCK));
    await generateTerrainAsync(BLOCK);
    expect(bridge.lwarn).toHaveBeenCalledTimes(1);
    expect(bridge.lwarn.mock.calls[0][0]).toContain("the terrain worker couldn't start");
  });

  it('rejects the requests of a worker that fails, then generates on this thread', async () => {
    bridge.mode = 'CRASH';
    const { generateTerrainAsync, generateTerrain } = await importAsync();
    await expect(generateTerrainAsync(BLOCK)).rejects.toThrow(
      'the terrain worker failed (out of memory)'
    );
    expect(bridge.workers[0].terminated).toBe(true);
    expectSameTerrain(await generateTerrainAsync(BLOCK), generateTerrain(BLOCK));
    expect(bridge.workers).toHaveLength(1);
    expect(bridge.lwarn).toHaveBeenCalledTimes(1);
  });
});
