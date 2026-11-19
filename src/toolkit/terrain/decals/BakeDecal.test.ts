import { beforeEach, describe, expect, it, vi } from 'vitest';
import { float, uniform, uv, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakedTexture, BakeTextureOpts } from 'aekasha';
import { bakeDecalGenerator } from './BakeDecal';
import { defineDecalGenerator } from './DecalGenerator';

const stubs = vi.hoisted(() => ({
  calls: [] as BakeTextureOpts[],
  /** Each id's bake, as `bakeTexture` keeps them: a live one is returned again, unbuilt */
  bakes: new Map<string, { disposed: boolean; ready: Promise<BakedTexture> }>(),
}));

// `bakeTexture` as the engine runs it: the graph built before it returns, the same bake for an id
// that's alive
vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  bakeTexture: (opts: BakeTextureOpts) => {
    const alive = stubs.bakes.get(opts.id);
    if (alive && !alive.disposed) return alive.ready;
    stubs.calls.push(opts);
    opts.build?.({
      uv: uv() as unknown as Node<'vec2'>,
      layer: uniform(0, 'int') as unknown as Node<'int'>,
      texel: vec2(1 / 64, 1 / 64) as unknown as Node<'vec2'>,
    });
    const state = { disposed: false, ready: undefined as unknown as Promise<BakedTexture> };
    state.ready = Promise.resolve({
      id: opts.id,
      textures: {},
      memoryBytes: 0,
      rebake: async () => {},
      isDisposed: () => state.disposed,
      dispose: () => {
        state.disposed = true;
      },
    });
    stubs.bakes.set(opts.id, state);
    return state.ready;
  },
}));

const generator = defineDecalGenerator({
  id: 'dotTest',
  physicalSize: [0.4, 0.4],
  heightScale: 0.005,
  params: { density: { default: 0.5, min: 0, max: 1 } },
  build: (_ctx, params) => ({
    albedo: params.density.mul(1) as unknown as Node<'vec3'>,
    opacity: params.density,
    height: float(0.5) as unknown as Node<'float'>,
    roughness: float(0.7) as unknown as Node<'float'>,
  }),
});

beforeEach(() => {
  stubs.calls.length = 0;
  stubs.bakes.clear();
});

describe('bakeDecalGenerator (p309 D5)', () => {
  it('bakes the DECAL slots, albedoAlpha sRGB and normalRough linear, 512² by default', async () => {
    const decal = await bakeDecalGenerator({ id: 'a', generator });
    expect(decal.generator).toBe(generator);
    expect(stubs.calls[0].size).toBe(512);
    expect(stubs.calls[0].outputs).toEqual([
      { name: 'albedoAlpha', colorSpace: 'SRGB' },
      { name: 'normalRough', colorSpace: 'LINEAR' },
    ]);
    await bakeDecalGenerator({ id: 'b', generator, size: 480, mipmaps: false });
    expect(stubs.calls[1]).toMatchObject({ size: 480, mipmaps: false });
  });

  it('sets the params and the seed for the next rebake', async () => {
    const decal = await bakeDecalGenerator({
      id: 'seeded',
      generator,
      seed: 4,
      params: { density: 0.2 },
    });
    expect(decal.getSeed()).toBe(4);
    expect(decal.getParams()).toEqual({ density: 0.2 });
    decal.setParams({ density: 0.9 });
    decal.setSeed(12);
    expect(decal.getParams().density).toBe(0.9);
    expect(decal.getSeed()).toBe(12);
    expect(() => decal.setSeed(1.5)).toThrow(
      /bakeDecalGenerator: the seed 1.5 of "seeded" isn't a whole number/
    );
  });

  it('returns the decal of an id while its bake is alive, a new one after its dispose', async () => {
    const [first, second] = await Promise.all([
      bakeDecalGenerator({ id: 'shared', generator }),
      bakeDecalGenerator({ id: 'shared', generator, seed: 2 }),
    ]);
    expect(second).toBe(first);
    expect(stubs.calls).toHaveLength(1);
    first.bake.dispose();
    const third = await bakeDecalGenerator({ id: 'shared', generator });
    expect(third).not.toBe(first);
    expect(stubs.calls).toHaveLength(2);
  });

  it("refuses the id of a bake that isn't a decal's", async () => {
    const ready = Promise.resolve({ isDisposed: () => false } as BakedTexture);
    stubs.bakes.set('other', { disposed: false, ready });
    await expect(bakeDecalGenerator({ id: 'other', generator })).rejects.toThrow(
      /bakeDecalGenerator: "other" is the id of a bake that isn't a decal's/
    );
  });

  it("rejects a param the generator doesn't have, and bakes the id again later", async () => {
    await expect(
      bakeDecalGenerator({ id: 'c', generator, params: { depth: 1 } as never })
    ).rejects.toThrow(/\[dotTest\] has no param "depth"/);
    await expect(bakeDecalGenerator({ id: 'c', generator })).resolves.toBeDefined();
  });
});
