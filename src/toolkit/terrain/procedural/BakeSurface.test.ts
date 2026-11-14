import { beforeEach, describe, expect, it, vi } from 'vitest';
import { float, uniform, uv, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakedTexture, BakeTextureOpts } from 'aekasha';
import { bakeSurfaceGenerator } from './BakeSurface';
import { defineSurfaceGenerator } from './SurfaceGenerator';

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

const generator = defineSurfaceGenerator({
  id: 'flatTest',
  category: 'CONCRETE',
  physicalSize: [2, 2],
  heightScale: 0.02,
  params: { grey: { default: 0.5, min: 0, max: 1 } },
  build: (_ctx, params) => ({
    albedo: params.grey.mul(1) as unknown as Node<'vec3'>,
    height: float(0.5) as unknown as Node<'float'>,
    roughness: float(0.7) as unknown as Node<'float'>,
  }),
});

beforeEach(() => {
  stubs.calls.length = 0;
  stubs.bakes.clear();
});

describe('bakeSurfaceGenerator', () => {
  it("bakes the packing's slots as outputs, LITE and 1024² by default", async () => {
    const surface = await bakeSurfaceGenerator({ id: 'a', generator });
    expect(surface.packing).toBe('LITE');
    expect(stubs.calls[0].size).toBe(1024);
    expect(stubs.calls[0].outputs).toEqual([
      { name: 'albedoRough', colorSpace: 'SRGB' },
      { name: 'normalHeight', colorSpace: 'LINEAR' },
    ]);
    await bakeSurfaceGenerator({ id: 'b', generator, packing: 'FULL', size: 256 });
    expect(stubs.calls[1].outputs.map((output) => output.name)).toEqual([
      'albedoHeight',
      'normal',
      'orm',
    ]);
  });

  it('sets the params and the seed for the next rebake', async () => {
    const surface = await bakeSurfaceGenerator({
      id: 'seeded',
      generator,
      seed: 3,
      params: { grey: 0.2 },
    });
    expect(surface.getSeed()).toBe(3);
    expect(surface.getParams()).toEqual({ grey: 0.2 });
    surface.setParams({ grey: 0.9 });
    surface.setSeed(-1);
    expect(surface.getParams().grey).toBe(0.9);
    expect(surface.getSeed()).toBe(0xffffffff);
    expect(() => surface.setSeed(0.5)).toThrow(/the seed 0.5 of "seeded" isn't a whole number/);
  });

  it('returns the surface of an id while its bake is alive, a new one after its dispose', async () => {
    const [first, second] = await Promise.all([
      bakeSurfaceGenerator({ id: 'shared', generator }),
      bakeSurfaceGenerator({ id: 'shared', generator, packing: 'FULL' }),
    ]);
    expect(second).toBe(first);
    expect(stubs.calls).toHaveLength(1);
    first.bake.dispose();
    const third = await bakeSurfaceGenerator({ id: 'shared', generator });
    expect(third).not.toBe(first);
    expect(stubs.calls).toHaveLength(2);
  });

  it("refuses the id of a bake that isn't a surface's", async () => {
    const ready = Promise.resolve({ isDisposed: () => false } as BakedTexture);
    stubs.bakes.set('other', { disposed: false, ready });
    await expect(bakeSurfaceGenerator({ id: 'other', generator })).rejects.toThrow(
      /"other" is the id of a bake that isn't a surface's/
    );
  });

  it("rejects a param the generator doesn't have, and bakes the id again later", async () => {
    await expect(
      bakeSurfaceGenerator({ id: 'c', generator, params: { depth: 1 } as never })
    ).rejects.toThrow(/\[flatTest\] has no param "depth"/);
    await expect(bakeSurfaceGenerator({ id: 'c', generator })).resolves.toBeDefined();
  });
});
