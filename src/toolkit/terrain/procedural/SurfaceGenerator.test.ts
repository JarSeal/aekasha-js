import { describe, expect, it } from 'vitest';
import { float, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakeBuildContext } from 'aekasha';
import { fbm } from '../nodes/noise/Noise';
import {
  buildSurfacePacking,
  createSurfaceContext,
  defineSurfaceGenerator,
  type SurfaceBuildContext,
} from './SurfaceGenerator';

type CallNode = {
  isShaderCallNodeInternal: true;
  shaderNode: { layout: { name: string; inputs: { name: string; type: string }[] } };
  rawInputs: unknown[];
};

/** Every layout function call in a graph whose name starts with `prefix` */
const findCalls = (node: unknown, prefix: string): CallNode[] => {
  const calls: CallNode[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const call = value as CallNode;
    if (call.isShaderCallNodeInternal && call.shaderNode.layout?.name.startsWith(prefix)) {
      calls.push(call);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'shaderNode' || key === 'parents') continue;
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(node);
  return calls;
};

const heightCalls = (nodes: Record<string, unknown>) =>
  findCalls(Object.values(nodes), 'aekSurfaceHeight_');

const bakeCtx: BakeBuildContext = {
  uv: uv() as unknown as Node<'vec2'>,
  layer: uniform(0, 'int') as unknown as Node<'int'>,
  texel: vec2(1 / 256, 1 / 256) as unknown as Node<'vec2'>,
};

const makeGenerator = (outputs: { normal?: boolean; ao?: boolean } = {}) => {
  const builds: SurfaceBuildContext[] = [];
  const generator = defineSurfaceGenerator({
    id: 'testDunes',
    category: 'SAND',
    physicalSize: [4, 2],
    heightScale: 0.08,
    params: {
      scale: { default: 6, min: 1, max: 32, isStatic: true, isInteger: true },
      gain: { default: 0.5, min: 0, max: 1 },
      tint: { type: 'color', default: '#c0a080' },
    },
    build: (ctx, params) => {
      builds.push(ctx);
      const { p, period } = ctx.cells(params.scale);
      const height = fbm(p, { period, octaves: 3, gain: params.gain, seed: ctx.seed(1) })
        .mul(0.5)
        .add(0.5) as Node<'float'>;
      return {
        albedo: params.tint,
        height,
        roughness: float(0.9) as unknown as Node<'float'>,
        ...(outputs.normal ? { normal: vec3(0, 0, 1) as unknown as Node<'vec3'> } : {}),
        ...(outputs.ao ? { ao: float(1) as unknown as Node<'float'> } : {}),
      };
    },
  });
  return { generator, builds };
};

describe('defineSurfaceGenerator', () => {
  it('fills in the description and the cavity, and refuses a bad default or fact', () => {
    const { generator } = makeGenerator();
    expect(generator.description).toBe('');
    expect(generator.cavity).toEqual({ radius: 0.03, strength: 4 });
    const def = {
      id: 'bad',
      category: 'SAND' as const,
      physicalSize: [1, 1] as [number, number],
      heightScale: 0.1,
      params: { size: { default: 3, max: 2 } },
      build: () => {
        throw new Error('unused');
      },
    };
    expect(() => defineSurfaceGenerator(def)).toThrow(/"size"'s default: 3 is above its max 2/);
    expect(() => defineSurfaceGenerator({ ...def, params: {}, physicalSize: [0, 1] })).toThrow(
      /physicalSize \[0,1\] takes two sizes above 0/
    );
  });

  it("builds a packing's slots for the engine (buildPacking)", () => {
    const { generator } = makeGenerator();
    const opts = { physicalSize: [4, 2] as [number, number], heightScale: 0.08 };
    expect(Object.keys(generator.buildPacking(bakeCtx, { ...opts, packing: 'FULL' }))).toEqual([
      'albedoHeight',
      'normal',
      'orm',
    ]);
    expect(Object.keys(generator.buildPacking(bakeCtx, { ...opts, packing: 'LITE' }))).toEqual([
      'albedoRough',
      'normalHeight',
    ]);
    expect(() =>
      generator.buildPacking(bakeCtx, { ...opts, packing: 'LITE', params: { depth: 2 } })
    ).toThrow(/\[testDunes\] has no param "depth"/);
  });
});

describe('createSurfaceContext', () => {
  const seed = uniform(5, 'uint') as unknown as Node<'uint'>;
  const point = vec2(0.25, 0.5) as unknown as Node<'vec2'>;
  const tileSize = vec2(2, 2) as unknown as Node<'vec2'>;
  const baked = createSurfaceContext({
    generatorId: 'g',
    uv: point,
    isLive: false,
    tileSize,
    seed,
  });
  const live = createSurfaceContext({ generatorId: 'g', uv: point, isLive: true, tileSize, seed });

  it('gives a baked whole count as the period, and refuses a fraction', () => {
    expect(baked.cells(8).period).toEqual([8, 8]);
    expect(baked.cells([6, 2]).period).toEqual([6, 2]);
    expect(() => baked.cells([6, 1.5])).toThrow(/cells\(\[6,1.5\]\): a baked surface/);
    expect(() => baked.cells(2.5)).toThrow(/cells\(2.5\): a baked surface tiles over a whole/);
    expect(() => baked.cells(0)).toThrow(/takes numbers above 0/);
  });

  it('rounds a node count into a node period when baked, none when live', () => {
    const count = uniform(6.4) as unknown as Node<'float'>;
    expect(typeof baked.cells(count).period).toBe('object');
    expect(live.cells(count).period).toBe(0);
    expect(live.cells(2.5).period).toBe(0);
  });

  it('derives other seeds from the surface one', () => {
    expect(baked.seed()).toBe(seed);
    expect(baked.seed(0)).toBe(seed);
    expect(baked.seed(1)).not.toBe(seed);
    expect(() => baked.seed(-1)).toThrow(/seed index -1 isn't a whole number/);
  });
});

describe('buildSurfacePacking', () => {
  it('builds the default normal (4 taps) and AO (8 taps) through one height function', () => {
    const { generator, builds } = makeGenerator();
    const { nodes } = buildSurfacePacking(generator, bakeCtx, { packing: 'LITE' });
    // The point's own surface, once; the taps call the height function, built at compile
    expect(builds).toHaveLength(1);
    const calls = heightCalls(nodes);
    expect(calls).toHaveLength(12);
    expect(new Set(calls.map((call) => call.shaderNode))).toHaveProperty('size', 1);
    // The uniforms are the function's inputs: the seed, then the float and colour params
    expect(calls[0].shaderNode.layout.inputs.map(({ name, type }) => `${name}:${type}`)).toEqual([
      'uv:vec2',
      'seed:uint',
      'p_gain:float',
      'p_tint:vec3',
    ]);
  });

  it('builds no normal for MINIMAL, and no taps when the generator gives both', () => {
    const minimal = buildSurfacePacking(makeGenerator().generator, bakeCtx, { packing: 'MINIMAL' });
    expect(heightCalls(minimal.nodes)).toHaveLength(8);
    const given = makeGenerator({ normal: true, ao: true }).generator;
    expect(heightCalls(buildSurfacePacking(given, bakeCtx, { packing: 'FULL' }).nodes)).toEqual([]);
  });

  it('names each height function apart, so two in one shader never clash', () => {
    const { generator } = makeGenerator();
    const names = [1, 2].map(
      () =>
        heightCalls(buildSurfacePacking(generator, bakeCtx, { packing: 'LITE' }).nodes)[0]
          .shaderNode.layout.name
    );
    expect(names[0]).toMatch(/^aekSurfaceHeight_testDunes_\d+$/);
    expect(names[0]).not.toBe(names[1]);
  });

  it('keeps the seed and params as uniforms, and checks the facts and the seed', () => {
    const { generator } = makeGenerator();
    const build = buildSurfacePacking(generator, bakeCtx, { packing: 'LITE', seed: 7 });
    expect(build.seed.value).toBe(7);
    build.params.set({ gain: 0.7 });
    expect(build.params.values.gain).toBe(0.7);
    expect(() => buildSurfacePacking(generator, bakeCtx, { packing: 'LITE', seed: 1.5 })).toThrow(
      /The seed 1.5 isn't a whole number/
    );
    expect(() =>
      buildSurfacePacking(generator, bakeCtx, { packing: 'LITE', heightScale: -1 })
    ).toThrow(/heightScale -1 takes 0 or more/);
  });
});
