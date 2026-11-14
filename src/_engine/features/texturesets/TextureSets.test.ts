import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { FeatureContext } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import type {
  MaterialInputContext,
  MaterialInputResolver,
} from '../../kernel/assets/MaterialInputResolvers';
import type { TextureSetDef } from '../../schemas/TextureSetSchema';
import {
  getTextureSet,
  getTextureSetPackingTextures,
  installTextureSets,
  loadTextureSetAsync,
} from './TextureSets';
import { textureSets } from './TextureSetsFeature';
import type { TextureSetInputRef } from './TextureSetRefs';

// The texture registry, the loads, the declarations and the app's data are stand-ins
const fns = vi.hoisted(() => ({
  registered: new Map<string, unknown>(),
  declarations: new Map<string, { id: string; fileName: string }>(),
  loadTextureAsync: vi.fn(),
  retagAssetOwner: vi.fn(),
  json: { scenes: {} } as { scenes: Record<string, unknown>; [section: string]: unknown },
}));
vi.mock(import('../../kernel/assets/Texture'), () => ({
  getTexture: (id: string) => fns.registered.get(id) as never,
  loadTextureAsync: fns.loadTextureAsync,
}));
vi.mock(import('../../kernel/assets/MaterialDependencies'), () => ({
  findTextureDeclaration: (id: string) => fns.declarations.get(id),
}));
vi.mock(import('../../kernel/assets/AssetOwners'), () => ({
  retagAssetOwner: fns.retagAssetOwner,
  getAssetOwnerScope: () => 'codeScope',
}));
vi.mock(import('../../kernel/scene/Scene'), () => ({
  getGeneratedAppData: () => fns.json,
}));
// The set arrays' scene builds (p303 D4): the hooks `import()` the module
const arrays = vi.hoisted(() => ({ builds: [] as unknown[], release: () => {} }));
vi.mock(import('./TextureSetArrays'), () => ({
  buildSceneTextureSetArraysAsync: ((sceneData: unknown) => {
    arrays.builds.push(sceneData);
    return new Promise<void>((resolve) => {
      arrays.release = resolve;
    });
  }) as never,
}));

// The procedural sets' bakes (p304 D3): the hooks and the load `import()` the module; a bake
// registers its slot textures
const bakes = vi.hoisted(() => ({
  scenes: [] as unknown[],
  sets: [] as string[],
  scopes: [] as string[],
  release: () => {},
}));
vi.mock(import('./TextureSetBakes'), () => ({
  bakeSceneProceduralTextureSetsAsync: ((sceneData: unknown) => {
    bakes.scenes.push(sceneData);
    return new Promise<void>((resolve) => {
      bakes.release = resolve;
    });
  }) as never,
  loadProceduralTextureSetAsync: (async (set: TextureSetDef, scope: string) => {
    bakes.sets.push(set.id);
    bakes.scopes.push(scope);
    const slots = Object.entries(set.packings[set.defaultPacking] ?? {});
    return Object.fromEntries(slots.map(([slot, id]) => [slot, { id }]));
  }) as never,
}));

const SURFACE: TextureSetDef['surface'] = {
  tint: '#ff0000',
  normalStrength: 1,
  roughnessScale: 0.9,
  aoStrength: 1,
  heightContrast: 1,
  porosity: 0.85,
  wetDarkening: 0.55,
  wetRoughness: 0.4,
};

const makeSet = (id: string, extra: Partial<TextureSetDef> = {}): TextureSetDef => ({
  id,
  category: 'SAND',
  physicalSize: [3, 2],
  heightScale: 0.03,
  defaultPacking: 'LITE',
  packings: {
    LITE: { albedoRough: `${id}_albedoRough`, normalHeight: `${id}_normalHeight` },
    MINIMAL: { albedoHeight: `${id}_albedoHeight` },
  },
  surface: SURFACE,
  ...extra,
});

/** The resolver the feature's install registers */
const getResolver = () => {
  const registered: MaterialInputResolver[] = [];
  installTextureSets({
    registerMaterialInputResolver: (resolver: MaterialInputResolver) => registered.push(resolver),
    addSceneHooks: () => () => {},
  } as unknown as FeatureContext);
  expect(registered).toHaveLength(1);
  return registered[0] as MaterialInputResolver<TextureSetInputRef>;
};

const textureFor = (id: string) => {
  const tex = new THREE.Texture();
  tex.name = id;
  return tex;
};

const inputContext = (): MaterialInputContext => ({
  materialId: 'ground',
  group: 'setup',
  key: 'sand',
  material: new THREE.MeshStandardNodeMaterial(),
  getTexture: (id) => textureFor(id),
});

beforeEach(() => {
  vi.clearAllMocks();
  fns.registered.clear();
  fns.declarations.clear();
  fns.loadTextureAsync.mockImplementation((props: { id: string }) =>
    Promise.resolve(textureFor(props.id))
  );
  fns.json = { scenes: {} };
});

describe('getTextureSet', () => {
  test('the development section first, then the first scene that has it', () => {
    const dev = makeSet('sand01', { heightScale: 1 });
    const inScene = makeSet('sand01');
    const mud = makeSet('mud01');
    fns.json = {
      textureSets: { sand01: dev },
      scenes: { a: { id: 'a' }, b: { id: 'b', textureSets: [inScene, mud] } },
    };
    expect(getTextureSet('sand01')).toBe(dev);
    expect(getTextureSet('mud01')).toBe(mud);
    expect(getTextureSet('snow01')).toBeUndefined();
  });

  test('a production build’s data: the scenes only', () => {
    const sand = makeSet('sand01');
    fns.json = { scenes: { a: { id: 'a', textureSets: [sand] } } };
    expect(getTextureSet('sand01')).toBe(sand);
  });
});

describe('loadTextureSetAsync', () => {
  beforeEach(() => {
    fns.json = { scenes: { a: { id: 'a', textureSets: [makeSet('sand01')] } } };
  });

  test('the default packing by slot: a registered texture re-tagged, the other loaded', async () => {
    const albedo = textureFor('sand01_albedoRough');
    fns.registered.set('sand01_albedoRough', albedo);
    fns.declarations.set('sand01_normalHeight', {
      id: 'sand01_normalHeight',
      fileName: 'normalHeight.png',
    });
    const textures = await loadTextureSetAsync('sand01');
    expect(Object.keys(textures)).toEqual(['albedoRough', 'normalHeight']);
    expect(textures).toMatchObject({ albedoRough: albedo });
    expect(fns.retagAssetOwner).toHaveBeenCalledWith(albedo);
    expect(fns.loadTextureAsync).toHaveBeenCalledExactlyOnceWith({
      id: 'sand01_normalHeight',
      fileName: 'normalHeight.png',
      throwOnError: true,
    });
  });

  test('another packing', async () => {
    fns.declarations.set('sand01_albedoHeight', {
      id: 'sand01_albedoHeight',
      fileName: 'albedoHeight.png',
    });
    const textures = await loadTextureSetAsync('sand01', { packing: 'MINIMAL' });
    expect(Object.keys(textures)).toEqual(['albedoHeight']);
  });

  test('rejects for an unknown set, a packing it lacks and an undeclared texture', async () => {
    await expect(loadTextureSetAsync('snow01')).rejects.toThrow(
      'no data has the texture set "snow01"'
    );
    await expect(loadTextureSetAsync('sand01', { packing: 'FULL' })).rejects.toThrow(
      'the texture set "sand01" has no packing "FULL" (packings: LITE, MINIMAL)'
    );
    await expect(loadTextureSetAsync('sand01')).rejects.toThrow(
      'no data declares the texture "sand01_albedoRough" of the texture set "sand01"'
    );
  });
});

describe('loadTextureSetAsync of a procedural set (p304 D3)', () => {
  const dunes = makeSet('dunes', {
    packings: { LITE: { albedoRough: 'dunes.albedoRough', normalHeight: 'dunes.normalHeight' } },
    procedural: { generator: 'sandRipples', params: {}, seed: 0, size: 256, packing: 'LITE' },
  });

  test('bakes it in the caller’s owner scope instead of loading textures', async () => {
    fns.json = { scenes: {}, textureSets: { dunes } };
    bakes.sets.length = 0;
    bakes.scopes.length = 0;
    const textures = await loadTextureSetAsync('dunes');
    expect(bakes.sets).toEqual(['dunes']);
    expect(bakes.scopes).toEqual(['codeScope']);
    expect(textures).toEqual({
      albedoRough: { id: 'dunes.albedoRough' },
      normalHeight: { id: 'dunes.normalHeight' },
    });
    expect(fns.loadTextureAsync).not.toHaveBeenCalled();
    await expect(loadTextureSetAsync('dunes', { packing: 'FULL' })).rejects.toThrow(
      'has no packing "FULL" (packings: LITE)'
    );
  });
});

describe('getTextureSetPackingTextures', () => {
  beforeEach(() => {
    fns.json = { scenes: { a: { id: 'a', textureSets: [makeSet('sand01')] } } };
  });

  test('the registered textures by slot, or undefined when one isn’t', () => {
    const albedo = textureFor('sand01_albedoRough');
    const normal = textureFor('sand01_normalHeight');
    fns.registered.set('sand01_albedoRough', albedo);
    expect(getTextureSetPackingTextures('sand01')).toBeUndefined();
    fns.registered.set('sand01_normalHeight', normal);
    expect(getTextureSetPackingTextures('sand01')).toEqual({
      albedoRough: albedo,
      normalHeight: normal,
    });
  });

  test('undefined for an unknown set or a packing it lacks', () => {
    expect(getTextureSetPackingTextures('snow01')).toBeUndefined();
    expect(getTextureSetPackingTextures('sand01', { packing: 'FULL' })).toBeUndefined();
  });
});

describe('the { textureSet } resolver', () => {
  beforeEach(() => {
    fns.json = { scenes: { a: { id: 'a', textureSets: [makeSet('sand01')] } } };
  });

  test('textureSets() installs it', () => {
    const registered: MaterialInputResolver[] = [];
    void textureSets().install({
      registerMaterialInputResolver: (resolver: MaterialInputResolver) => registered.push(resolver),
      addSceneHooks: () => () => {},
    } as unknown as FeatureContext);
    expect(registered.map((resolver) => resolver.kind)).toEqual(['textureSet']);
  });

  test('matches the form only', () => {
    const resolver = getResolver();
    expect(resolver.match({ textureSet: 'sand01' })).toBe(true);
    expect(resolver.match({ texture: 'sand01' })).toBe(false);
    expect(resolver.match('sand01')).toBe(false);
  });

  test('the default packing’s textures and the set’s uniforms, flat in one bundle', () => {
    const bundle = getResolver().resolve(
      { textureSet: 'sand01' },
      inputContext()
    ) as unknown as Record<string, { value: unknown }>;
    expect(Object.keys(bundle)).toEqual([
      'albedoRough',
      'normalHeight',
      'physicalSize',
      'heightScale',
      ...Object.keys(SURFACE),
    ]);
    expect((bundle.albedoRough.value as THREE.Texture).name).toBe('sand01_albedoRough');
    expect(bundle.physicalSize.value).toEqual(new THREE.Vector2(3, 2));
    expect(bundle.heightScale.value).toBe(0.03);
    expect(bundle.roughnessScale.value).toBe(0.9);
    // The JSON's sRGB tint, as a linear colour
    expect(bundle.tint.value).toEqual(new THREE.Color('#ff0000'));
  });

  test('a { r, g, b } tint is sRGB 0-255', () => {
    fns.json = {
      scenes: {
        a: {
          id: 'a',
          textureSets: [
            makeSet('sand01', { surface: { ...SURFACE, tint: { r: 128, g: 0, b: 0 } } }),
          ],
        },
      },
    };
    const bundle = getResolver().resolve(
      { textureSet: 'sand01' },
      inputContext()
    ) as unknown as Record<string, { value: unknown }>;
    expect(bundle.tint.value).toEqual(
      new THREE.Color().setRGB(128 / 255, 0, 0, THREE.SRGBColorSpace)
    );
  });

  test('another packing’s textures', () => {
    const bundle = getResolver().resolve(
      { textureSet: 'sand01', packing: 'MINIMAL' },
      inputContext()
    );
    expect(Object.keys(bundle).slice(0, 2)).toEqual(['albedoHeight', 'physicalSize']);
  });

  test('throws naming the input for an unknown set and a packing it lacks', () => {
    const resolver = getResolver();
    expect(() => resolver.resolve({ textureSet: 'snow01' }, inputContext())).toThrow(
      'The texture set "snow01" of input "sand" (setup) in material "ground" isn\'t in the app\'s data'
    );
    expect(() =>
      resolver.resolve({ textureSet: 'sand01', packing: 'FULL' }, inputContext())
    ).toThrow('has no packing "FULL" (packings: LITE, MINIMAL)');
  });

  test('its dependencies read the app data: the packing’s textures', () => {
    const { dependencies } = getResolver();
    expect(dependencies?.({ textureSet: 'sand01' })).toEqual([
      { type: 'texture', id: 'sand01_albedoRough' },
      { type: 'texture', id: 'sand01_normalHeight' },
    ]);
    expect(dependencies?.({ textureSet: 'sand01', packing: 'MINIMAL' })).toEqual([
      { type: 'texture', id: 'sand01_albedoHeight' },
    ]);
    expect(dependencies?.({ textureSet: 'snow01' })).toEqual([]);
  });
});

describe('the set arrays\u2019 and procedural sets\u2019 scene hooks (p303 D4, p304 D3)', () => {
  /** The scene hooks the install adds */
  const getHooks = () => {
    let hooks: SceneHooks = {};
    installTextureSets({
      registerMaterialInputResolver: () => {},
      addSceneHooks: (added: SceneHooks) => {
        hooks = added;
        return () => {};
      },
    } as unknown as FeatureContext);
    return hooks;
  };
  const world = {} as never;

  test('build a scene\u2019s set arrays from the cleared world, awaited before its assets', async () => {
    const hooks = getHooks();
    const scene = { id: 'b', textureSetArrays: [{ sets: ['sand01'], packing: 'LITE' }] };
    arrays.builds.length = 0;

    hooks.worldCleared?.(world, 'a', scene as never);
    const before = hooks.beforeAssets?.();
    let isDone = false;
    void Promise.resolve(before).then(() => (isDone = true));
    await vi.waitFor(() => expect(arrays.builds).toEqual([scene]));
    expect(isDone).toBe(false);
    arrays.release();
    await before;
    expect(isDone).toBe(true);

    // Once loaded, the next scene's builds start in the hook itself (re-tags before the release)
    hooks.worldCleared?.(world, 'b', scene as never);
    expect(arrays.builds).toHaveLength(2);
    arrays.release();
    await hooks.beforeAssets?.();
  });

  test('bake a scene’s procedural sets (p304 D3) next to its set arrays, both awaited', async () => {
    const hooks = getHooks();
    const dunes = makeSet('dunes', {
      procedural: { generator: 'sandRipples', params: {}, seed: 0, size: 256, packing: 'LITE' },
    });
    const scene = {
      id: 'b',
      textureSets: [makeSet('rock'), dunes],
      textureSetArrays: [{ sets: ['rock'], packing: 'LITE' }],
    };
    arrays.builds.length = 0;
    bakes.scenes.length = 0;

    hooks.worldCleared?.(world, 'a', scene as never);
    const before = hooks.beforeAssets?.();
    let isDone = false;
    void Promise.resolve(before).then(() => (isDone = true));
    await vi.waitFor(() => expect(bakes.scenes).toEqual([scene]));
    arrays.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isDone).toBe(false);
    bakes.release();
    await before;
    expect(isDone).toBe(true);

    // Once loaded, the next scene's bakes start in the hook itself (re-tags before the release)
    hooks.worldCleared?.(world, 'b', { id: 'c', textureSets: [dunes] } as never);
    expect(bakes.scenes).toHaveLength(2);
    bakes.release();
    await hooks.beforeAssets?.();
  });

  test('a scene without set arrays awaits nothing', () => {
    const hooks = getHooks();
    arrays.builds.length = 0;

    hooks.worldCleared?.(world, 'a', { id: 'b', textureSetArrays: [] } as never);

    expect(hooks.beforeAssets?.()).toBeUndefined();
    expect(arrays.builds).toHaveLength(0);
  });
});
