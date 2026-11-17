import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerrainGenerator, TerrainGeneratorOpts } from 'aekasha/terrain';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import {
  generateNoiseTerrainBlockAsync,
  generateRulesTerrainBlockAsync,
} from './TerrainBlockGenerators';
import { registerTerrainGenerators } from './RegisterTerrainGenerators';

// The texture read back from the GPU: 1 × 1 texels, every channel 255
const readTexels = vi.hoisted(() =>
  vi.fn(async () => ({ data: [255, 255, 255, 255], width: 1, height: 1 }))
);
vi.mock('../textures/ReadTexels', () => ({ readTextureTexelsAsync: readTexels }));

// The generators run generateTerrainAsync: here generateTerrain's work on this thread (no module
// worker in Node; `TerrainAsync.test.ts` checks the two give the same terrain)
const asyncCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('aekasha/toolkit/geometry', async (importOriginal) => {
  const geometry = await importOriginal<typeof import('aekasha/toolkit/geometry')>();
  return {
    ...geometry,
    generateTerrainAsync: (opts: Parameters<typeof geometry.generateTerrainAsync>[0]) => {
      asyncCalls.count += 1;
      return geometry.generateTerrainAsync({ ...opts, workerTarget: 'MAIN_THREAD' });
    },
  };
});

const registered = vi.hoisted(() => new Map<string, unknown>());
vi.mock('aekasha/terrain', () => ({
  registerTerrainGenerator: (id: string, generator: unknown) => registered.set(id, generator),
}));

const blockAt = (
  x: number,
  z: number,
  params: Record<string, unknown> = {},
  seed = 11
): TerrainGeneratorOpts => ({
  blockId: `block_${x}_${z}`,
  params,
  seed,
  grid: { x, z, size: 32, resolution: 17 },
});

beforeEach(() => {
  readTexels.mockClear();
});

describe('noiseTerrain', () => {
  it("is generateTerrain at the block's world place, its seed as it is, with its heightfield", async () => {
    const block = await generateNoiseTerrainBlockAsync(blockAt(1, -2, { maxHeight: 5 }));
    const expected = generateTerrain({
      width: 32,
      depth: 32,
      widthSegments: 16,
      depthSegments: 16,
      maxHeight: 5,
      seed: 11,
      center: [32, -64],
      normals: 'HEIGHT_FN',
    });
    expect(block.geometry.getAttribute('position').array).toEqual(
      expected.geometry.getAttribute('position').array
    );
    expect(block.geometry.getAttribute('normal').array).toEqual(
      expected.geometry.getAttribute('normal').array
    );
    expect(block.heightfield?.nrows).toBe(16);
    expect(asyncCalls.count).toBeGreaterThan(0);
  });

  it('continues across neighbouring blocks of one seed', async () => {
    const left = (await generateNoiseTerrainBlockAsync(blockAt(0, 0))).geometry.getAttribute(
      'position'
    );
    const right = (await generateNoiseTerrainBlockAsync(blockAt(1, 0))).geometry.getAttribute(
      'position'
    );
    for (let row = 0; row < 17; row++) {
      expect(right.getY(row * 17)).toBe(left.getY(row * 17 + 16));
    }
  });

  it('takes octaves, normals and skirt, and refuses the rest naming the block', async () => {
    const block = await generateNoiseTerrainBlockAsync(
      blockAt(0, 0, { octaves: [[0.05, 1]], normals: 'GEOMETRY', skirt: 1 })
    );
    expect(block.geometry.getAttribute('position').count).toBe(17 * 17 + 64);
    await expect(generateNoiseTerrainBlockAsync(blockAt(0, 0, { maxHeight: -1 }))).rejects.toThrow(
      'noiseTerrain: block "block_0_0" params.maxHeight: is -1, not a number over 0.'
    );
    await expect(
      generateNoiseTerrainBlockAsync(blockAt(0, 0, { octaves: [[0, 1]] }))
    ).rejects.toThrow(/params\.octaves: is \[\[0,1\]\]/);
    await expect(
      generateNoiseTerrainBlockAsync(blockAt(0, 0, { normals: 'FLAT' }))
    ).rejects.toThrow(/params\.normals: is "FLAT": use HEIGHT_FN, GEOMETRY/);
    await expect(generateNoiseTerrainBlockAsync(blockAt(0, 0, { rules: [] }))).rejects.toThrow(
      /params\.rules: isn't a param here/
    );
  });
});

describe('rulesTerrain', () => {
  const steep = { layer: 1, slope: { min: 0, softness: 0 } };

  it('lays the rules into the vertex colours, reading the noise texture only for noise', async () => {
    const block = await generateRulesTerrainBlockAsync(blockAt(0, 0, { rules: [steep] }));
    const color = block.geometry.getAttribute('color');
    // Every vertex has a slope of 0 or more: rocks, and A the AO's 1 (no `ao`)
    expect(Array.from(color.array.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(readTexels).not.toHaveBeenCalled();
    expect(block.heightfield).toBeDefined();

    const noisy = { layer: 2, height: { max: -100 }, noise: { scale: 10, amount: 1 } };
    const withNoise = await generateRulesTerrainBlockAsync(
      blockAt(0, 0, { rules: [noisy], noiseTexture: 'myNoise', layout: 'RGBA' })
    );
    expect(readTexels).toHaveBeenCalledWith('myNoise');
    // Height out of range (0) moved up by the noise's whole amount: layer 2, G
    expect(Array.from(withNoise.geometry.getAttribute('color').array.slice(0, 4))).toEqual([
      0, 255, 0, 0,
    ]);
  });

  it('writes the AO into RGB_AO’s A', async () => {
    const block = await generateRulesTerrainBlockAsync(
      blockAt(0, 0, { rules: [steep], ao: { radius: 4, strength: 1 }, maxHeight: 6 })
    );
    const color = block.geometry.getAttribute('color').array;
    const alphas = Array.from({ length: 17 * 17 }, (_, i) => color[i * 4 + 3]);
    expect(Math.min(...alphas)).toBeLessThan(255);
  });

  it("checks the rules as the terrain material does, naming the block's param", async () => {
    await expect(generateRulesTerrainBlockAsync(blockAt(0, 0))).rejects.toThrow(
      'rulesTerrain: block "block_0_0" params.rules: is undefined: give 1 to 16 rules.'
    );
    await expect(
      generateRulesTerrainBlockAsync(blockAt(0, 0, { rules: [{ layer: 1, slope: {} }] }))
    ).rejects.toThrow('rulesTerrain: block "block_0_0" params.rules[0].slope: has no end');
    await expect(
      generateRulesTerrainBlockAsync(blockAt(0, 0, { rules: [{ layer: 4, height: { max: 1 } }] }))
    ).rejects.toThrow(/layer is 4: RGB_AO weighs layers 0 to 3/);
    await expect(
      generateRulesTerrainBlockAsync(blockAt(0, 0, { rules: [steep], ao: { radius: 2, far: 1 } }))
    ).rejects.toThrow(/params\.ao\.far: isn't a param here/);
  });
});

describe('registerTerrainGenerators', () => {
  it('registers both, loading their code on the first call', async () => {
    registered.clear();
    registerTerrainGenerators();
    expect([...registered.keys()]).toEqual(['noiseTerrain', 'rulesTerrain']);
    const noise = registered.get('noiseTerrain') as TerrainGenerator;
    const result = await noise(blockAt(0, 0));
    expect(result.geometry.getAttribute('position').count).toBe(17 * 17);
  });
});
