import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { TextureSetDef } from '../../schemas/TextureSetSchema';
import type { SceneData } from '../../kernel/scene/Scene';
import {
  bakeProceduralTextureSetAsync,
  bakeSceneProceduralTextureSetsAsync,
  loadProceduralTextureSetAsync,
} from './TextureSetBakes';

// The baker, the texture registry, the owners, the generated generator loaders and the log are
// stand-ins: a bake registers its slot textures at its call, as `bakeTexture` does
const fns = vi.hoisted(() => ({
  registered: new Map<string, object>(),
  bakes: [] as { opts: Record<string, unknown>; scope: unknown; release: () => void }[],
  built: [] as unknown[],
  retagged: [] as unknown[],
  scope: undefined as unknown,
  loads: [] as string[],
  generatorFiles: {} as Record<string, () => Promise<Record<string, unknown>>>,
  error: vi.fn(),
}));
vi.mock(import('../../kernel/render/TextureBaker'), () => ({
  bakeTexture: ((opts: {
    id: string;
    outputs: { name: string }[];
    build: (ctx: unknown) => unknown;
  }) => {
    fns.built.push(opts.build({ uv: 'uv' }));
    for (const { name } of opts.outputs) fns.registered.set(`${opts.id}.${name}`, { name });
    return new Promise((resolve) => {
      fns.bakes.push({
        opts: opts as never,
        scope: fns.scope,
        release: () => resolve({ id: opts.id }),
      });
    });
  }) as never,
}));
vi.mock(import('../../kernel/assets/Texture'), () => ({
  getTexture: ((id: string) => fns.registered.get(id)) as never,
}));
vi.mock(import('../../kernel/assets/AssetOwners'), () => ({
  getAssetOwnerScope: () => fns.scope as never,
  retagAssetOwner: (asset: object) => void fns.retagged.push(asset),
  runInAssetOwnerScope: ((owner: unknown, fn: () => unknown) => {
    const prev = fns.scope;
    fns.scope = owner;
    try {
      return fn();
    } finally {
      fns.scope = prev;
    }
  }) as never,
}));
vi.mock(import('../../kernel/scene/AppData'), () => ({
  getAppData: (() => ({ textureSetGeneratorFiles: fns.generatorFiles })) as never,
}));
vi.mock(import('../../utils/Logger'), () => ({ lerror: fns.error }));

/** A generator module whose `buildPacking` returns what it was given */
const generatorModule = (id: string, refuse?: string) => async () => {
  fns.loads.push(id);
  return {
    generator: {
      id,
      category: 'SAND',
      buildPacking: (ctx: unknown, opts: unknown) => {
        if (refuse) throw new Error(refuse);
        return { ctx, opts };
      },
    },
  };
};

const makeSet = (id: string, generator: string, packing: 'LITE' | 'FULL' = 'LITE') =>
  ({
    id,
    category: 'SAND',
    physicalSize: [2, 3],
    heightScale: 0.02,
    defaultPacking: packing,
    packings:
      packing === 'LITE'
        ? { LITE: { albedoRough: `${id}.albedoRough`, normalHeight: `${id}.normalHeight` } }
        : {
            FULL: {
              albedoHeight: `${id}.albedoHeight`,
              normal: `${id}.normal`,
              orm: `${id}.orm`,
            },
          },
    procedural: { generator, params: { wavelength: 0.12 }, seed: 7, size: 256, packing },
    surface: {} as never,
  }) satisfies TextureSetDef;

/** Lets the pending imports and awaits run */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fns.registered.clear();
  fns.bakes.length = 0;
  fns.built.length = 0;
  fns.retagged.length = 0;
  fns.loads.length = 0;
  fns.scope = undefined;
  fns.generatorFiles = {
    sandRipples: generatorModule('sandRipples'),
    mudCracked: generatorModule('mudCracked'),
    wrongId: generatorModule('sandFlat'),
    refusing: generatorModule('refusing', 'the param "depth" isn’t one of its params'),
  };
  fns.error.mockClear();
});

describe('bakeProceduralTextureSetAsync (p304 D3)', () => {
  test('bakes the packing’s slots through the generator, in the caller’s owner scope', async () => {
    fns.scope = 'sceneA';
    const done = bakeProceduralTextureSetAsync(makeSet('dunes', 'sandRipples', 'FULL'));
    fns.scope = undefined;
    await vi.waitFor(() => expect(fns.bakes).toHaveLength(1));
    const [bake] = fns.bakes;
    expect(bake.scope).toBe('sceneA');
    expect(bake.opts).toMatchObject({
      id: 'dunes',
      size: 256,
      outputs: [
        { name: 'albedoHeight', colorSpace: 'SRGB' },
        { name: 'normal', colorSpace: 'LINEAR' },
        { name: 'orm', colorSpace: 'LINEAR' },
      ],
    });
    expect(fns.built[0]).toEqual({
      ctx: { uv: 'uv' },
      opts: {
        packing: 'FULL',
        params: { wavelength: 0.12 },
        seed: 7,
        physicalSize: [2, 3],
        heightScale: 0.02,
      },
    });
    let isDone = false;
    void done.then(() => (isDone = true));
    await flush();
    expect(isDone).toBe(false);
    bake.release();
    await done;
    expect([...fns.registered.keys()]).toEqual(['dunes.albedoHeight', 'dunes.normal', 'dunes.orm']);
  });

  test('loads a generator once: a later bake of it starts synchronously', async () => {
    // The loaded generators are the module's for the page: the earlier test loaded sandRipples
    const first = bakeProceduralTextureSetAsync(makeSet('a', 'mudCracked'));
    await vi.waitFor(() => expect(fns.bakes).toHaveLength(1));
    fns.bakes[0].release();
    await first;

    const second = bakeProceduralTextureSetAsync(makeSet('b', 'mudCracked'));
    expect(fns.bakes).toHaveLength(2);
    expect(fns.registered.has('b.albedoRough')).toBe(true);
    fns.bakes[1].release();
    await second;
    expect(fns.loads).toEqual(['mudCracked']);
  });

  test('re-tags a baked set’s textures and shares a running bake', async () => {
    const set = makeSet('dunes', 'sandRipples');
    const first = bakeProceduralTextureSetAsync(set);
    const second = bakeProceduralTextureSetAsync(set);
    await vi.waitFor(() => expect(fns.bakes).toHaveLength(1));
    fns.bakes[0].release();
    await Promise.all([first, second]);
    fns.retagged.length = 0;

    await bakeProceduralTextureSetAsync(set);
    expect(fns.bakes).toHaveLength(1);
    expect(fns.retagged).toEqual([
      fns.registered.get('dunes.albedoRough'),
      fns.registered.get('dunes.normalHeight'),
    ]);
  });

  test('rejects naming the set: an unknown generator, a wrong export, a refused param', async () => {
    await expect(bakeProceduralTextureSetAsync(makeSet('s1', 'nope'))).rejects.toThrow(
      'The procedural texture set "s1" (generator "nope"): the gathered code has no generator "nope"'
    );
    await expect(bakeProceduralTextureSetAsync(makeSet('s2', 'wrongId'))).rejects.toThrow(
      'the module of the generator "wrongId" doesn’t export it'.replace('’', "'")
    );
    await expect(bakeProceduralTextureSetAsync(makeSet('s3', 'refusing'))).rejects.toThrow(
      'The procedural texture set "s3" (generator "refusing"): the param "depth"'
    );
    expect(fns.bakes).toHaveLength(0);
  });
});

describe('loadProceduralTextureSetAsync (p304 D3)', () => {
  test('bakes in the scope given and returns the textures by slot', async () => {
    const done = loadProceduralTextureSetAsync(makeSet('loaded', 'sandRipples'), 'codeScope');
    expect(fns.bakes.map((bake) => bake.scope)).toEqual(['codeScope']);
    fns.bakes[0].release();
    expect(await done).toEqual({
      albedoRough: fns.registered.get('loaded.albedoRough'),
      normalHeight: fns.registered.get('loaded.normalHeight'),
    });
  });

  test('rejects when the bake was disposed before it ended', async () => {
    const done = loadProceduralTextureSetAsync(makeSet('gone', 'sandRipples'), undefined);
    fns.registered.delete('gone.normalHeight');
    fns.bakes[0].release();
    await expect(done).rejects.toThrow('"gone" was disposed while it baked');
  });
});

describe('bakeSceneProceduralTextureSetsAsync (p304 D3)', () => {
  test('bakes the scene’s procedural sets, logs a failed one and goes on', async () => {
    const imported = { ...makeSet('rock', 'x'), procedural: undefined };
    const scene = {
      id: 'beach',
      textureSets: [makeSet('dunes', 'sandRipples'), imported, makeSet('bad', 'nope')],
    } as unknown as SceneData;
    const done = bakeSceneProceduralTextureSetsAsync(scene);
    await vi.waitFor(() => expect(fns.bakes).toHaveLength(1));
    fns.bakes[0].release();
    await done;
    expect(fns.bakes.map((bake) => bake.opts.id)).toEqual(['dunes']);
    expect(fns.error).toHaveBeenCalledOnce();
    expect(fns.error.mock.calls[0][0]).toBe(
      'Scene "beach": The procedural texture set "bad" (generator "nope"): the gathered code has no generator "nope" (a <id>.generator.ts module the gatherer found; run the gather). Its materials sample white.'
    );
  });

  test('gives nothing to await for a scene without a procedural set', () => {
    const imported = { ...makeSet('rock', 'x'), procedural: undefined };
    expect(
      bakeSceneProceduralTextureSetsAsync({ id: 's', textureSets: [imported] } as never)
    ).toBeUndefined();
    expect(bakeSceneProceduralTextureSetsAsync({ id: 's' } as never)).toBeUndefined();
  });
});
