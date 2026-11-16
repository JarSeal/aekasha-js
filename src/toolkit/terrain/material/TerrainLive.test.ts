import { beforeEach, describe, expect, it, vi } from 'vitest';
import { float, uniform, uv as meshUv, vec2, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial, Vector2, type Node } from 'three/webgpu';
import type { TextureSetDef, TextureSetInput } from 'aekasha/texturesets';
import { defineSurfaceGenerator } from '../procedural/SurfaceGenerator';
import { createLiveLayer, createLiveSampler, readLiveSource, type LiveLayer } from './TerrainLive';

// The engine's lookups: each bundle's set, and the loaded generators
const stubs = vi.hoisted(() => ({
  sets: new Map<object, unknown>(),
  generators: new Map<string, unknown>(),
}));
vi.mock('aekasha/texturesets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha/texturesets')>()),
  getTextureSetOfInput: (bundle: object) => stubs.sets.get(bundle),
  getTextureSetGenerator: (id: string) => stubs.generators.get(id),
}));

/** The points the generator was built at */
const builds: unknown[] = [];

const dunes = defineSurfaceGenerator({
  id: 'testLiveDunes',
  category: 'SAND',
  physicalSize: [4, 4],
  heightScale: 0.08,
  params: {
    gain: { default: 0.5, min: 0, max: 1 },
    tint: { type: 'color', default: '#c0a080' },
    octaves: { default: 3, min: 1, max: 6, isStatic: true, isInteger: true },
  },
  build: (ctx, params) => {
    builds.push(ctx.uv);
    return {
      albedo: params.tint,
      height: ctx.uv.x.mul(params.gain) as Node<'float'>,
      roughness: float(0.9) as unknown as Node<'float'>,
    };
  },
});

const makeSet = (procedural = true): TextureSetDef => ({
  id: 'liveDunes',
  category: 'SAND',
  physicalSize: [3, 3],
  heightScale: 0.05,
  defaultPacking: 'LITE',
  packings: {
    LITE: { albedoRough: 'liveDunes.albedoRough', normalHeight: 'liveDunes.normalHeight' },
  },
  surface: {} as TextureSetDef['surface'],
  ...(procedural
    ? {
        procedural: {
          generator: dunes.id,
          params: { gain: 0.25 },
          seed: 9,
          size: 256,
          packing: 'LITE',
        },
      }
    : {}),
});

const makeBundle = (set: TextureSetDef | null = makeSet()) => {
  const bundle = { physicalSize: uniform(new Vector2(3, 3)) } as unknown as TextureSetInput;
  if (set) stubs.sets.set(bundle, set);
  return bundle;
};

const makeLayer = (settings: Partial<LiveLayer['settings']> = {}) => {
  const material = new MeshStandardNodeMaterial();
  const layer = createLiveLayer(material, 1, readLiveSource(makeBundle(), 'layer1'), {
    normal: 'BUMP',
    ao: 'NONE',
    ...settings,
  });
  return { material, layer };
};

const samplerOpts = {
  tileSize: uniform(new Vector2(3, 3)) as unknown as Node<'vec2'>,
  heightScale: uniform(0.05) as unknown as Node<'float'>,
  isInBranch: false,
};
const at = () => meshUv() as unknown as Node<'vec2'>;
const grad = {
  dx: vec2(0.001, 0) as unknown as Node<'vec2'>,
  dy: vec2(0, 0.001) as unknown as Node<'vec2'>,
};

beforeEach(() => {
  stubs.sets = new Map();
  stubs.generators = new Map([[dunes.id, dunes]]);
  builds.length = 0;
});

describe('readLiveSource', () => {
  it("returns the bundle's procedural set and its loaded generator", () => {
    const source = readLiveSource(makeBundle(), 'layer1');
    expect(source.set.id).toBe('liveDunes');
    expect(source.generator).toBe(dunes);
  });

  it('refuses an unresolved input, a set that isn’t procedural, a generator not loaded or not a toolkit one', () => {
    expect(() => readLiveSource(makeBundle(null), 'layer1')).toThrow(
      '[terrain] Input "layer1" (a live layer, source PROCEDURAL_LIVE) isn\'t a { "textureSet": id } input'
    );
    expect(() => readLiveSource(makeBundle(makeSet(false)), 'layer1')).toThrow(
      'the texture set "liveDunes" isn\'t procedural'
    );
    stubs.generators.clear();
    expect(() => readLiveSource(makeBundle(), 'layer1')).toThrow(
      'the generator "testLiveDunes" of the texture set "liveDunes" isn\'t loaded'
    );
    stubs.generators.set(dunes.id, { id: dunes.id, buildPacking: () => ({}) });
    expect(() => readLiveSource(makeBundle(), 'layer1')).toThrow(
      'the generator "testLiveDunes" has no build'
    );
  });
});

describe('createLiveLayer', () => {
  it("keeps the set's seed and the params' uniforms, the static ones the graph's", () => {
    const { material, layer } = makeLayer();
    const uniforms = material.userData.uniforms as Record<string, { value: unknown }>;
    expect(Object.keys(uniforms).sort()).toEqual([
      'terrain_l1_live_gain',
      'terrain_l1_live_seed',
      'terrain_l1_live_tint',
    ]);
    expect(uniforms.terrain_l1_live_seed.value).toBe(9);
    expect(uniforms.terrain_l1_live_gain.value).toBe(0.25);
    // The set's facts, not the generator's
    expect(layer.prepared.physicalSize).toEqual([3, 3]);
    expect(layer.prepared.heightScale).toBe(0.05);
  });
});

describe('createLiveSampler', () => {
  it('builds the whole graph at each point it samples', () => {
    const sampler = createLiveSampler(makeLayer().layer, { ...samplerOpts, packing: 'LITE' });
    const [a, b] = [at(), at().mul(2) as Node<'vec2'>];
    sampler.sample(a);
    sampler.sample(b);
    expect(builds).toEqual([a, b]);
  });

  it("shapes the sample as the packing: FULL's AO apart, the others' in the albedo", () => {
    const full = createLiveSampler(makeLayer().layer, { ...samplerOpts, packing: 'FULL' });
    const fullSample = full.sample(at());
    expect(fullSample).toMatchObject({ packing: 'FULL', isAoBaked: false, normalTS: null });
    expect(fullSample.ao).toBeTruthy();
    const lite = createLiveSampler(makeLayer({ ao: 'CAVITY' }).layer, {
      ...samplerOpts,
      packing: 'LITE',
    });
    const liteSample = lite.sample(at());
    expect(liteSample).toMatchObject({ packing: 'LITE', isAoBaked: true, ao: null });
    // The cavity multiplies the albedo
    expect((liteSample.albedo as unknown as { op?: string }).op).toBe('*');
  });

  it('bumps by default, takes TAPS, and in a branch two taps at the gradients; MINIMAL bumps', () => {
    const sampleOf = (
      settings: Partial<LiveLayer['settings']>,
      packing: 'LITE' | 'MINIMAL',
      isInBranch = false
    ) =>
      createLiveSampler(makeLayer(settings).layer, { ...samplerOpts, packing, isInBranch }).sample(
        at(),
        isInBranch ? grad : undefined
      );
    expect(sampleOf({}, 'LITE').normalTS).toBeNull();
    expect(sampleOf({ normal: 'TAPS' }, 'LITE').normalTS).toBeTruthy();
    expect(sampleOf({}, 'LITE', true).normalTS).toBeTruthy();
    expect(sampleOf({ normal: 'TAPS' }, 'MINIMAL').normalTS).toBeNull();
    expect(sampleOf({}, 'MINIMAL', true).normalTS).toBeNull();
    const branch = createLiveSampler(makeLayer().layer, {
      ...samplerOpts,
      packing: 'LITE',
      isInBranch: true,
    });
    expect(() => branch.sample(at())).toThrow('A live layer in a branch samples with gradients.');
  });

  it("takes the generator's own normal and AO over the taps", () => {
    const shaded = defineSurfaceGenerator({
      ...dunes,
      id: 'testLiveShaded',
      build: () => ({
        albedo: vec3(1, 1, 1) as unknown as Node<'vec3'>,
        height: float(0.5) as unknown as Node<'float'>,
        roughness: float(0.5) as unknown as Node<'float'>,
        normal: vec3(0, 0, 1) as unknown as Node<'vec3'>,
        ao: float(0.7) as unknown as Node<'float'>,
      }),
    });
    stubs.generators.set(dunes.id, shaded);
    const sample = createLiveSampler(makeLayer({ ao: 'CAVITY' }).layer, {
      ...samplerOpts,
      packing: 'FULL',
    }).sample(at());
    expect(sample.normalTS).toBeTruthy();
    expect((sample.ao as unknown as { value?: number }).value).toBe(0.7);
  });
});
