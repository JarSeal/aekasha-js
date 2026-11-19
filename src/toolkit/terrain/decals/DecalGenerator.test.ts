import { describe, expect, it } from 'vitest';
import { uniform, uv, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakeBuildContext } from 'aekasha';
import { fbm } from '../nodes/noise/Noise';
import {
  buildDecalPacking,
  defineDecalGenerator,
  type DecalBuildContext,
  type DecalOutputs,
} from './DecalGenerator';

type CallNode = {
  isShaderCallNodeInternal: true;
  shaderNode: { layout: { name: string } };
};

/** Every node reachable from `root` (a graph's inputs, not its users) */
const collect = (root: unknown) => {
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'shaderNode' || key === 'parents') continue;
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(root);
  return seen;
};

const heightCalls = (root: unknown) =>
  [...collect(root)].filter((value) => {
    const call = value as CallNode;
    return (
      call.isShaderCallNodeInternal && call.shaderNode.layout?.name.startsWith('aekSurfaceHeight_')
    );
  });

const bakeCtx: BakeBuildContext = {
  uv: uv() as unknown as Node<'vec2'>,
  layer: uniform(0, 'int') as unknown as Node<'int'>,
  texel: vec2(1 / 480, 1 / 480) as unknown as Node<'vec2'>,
};

/** A decal whose outputs are marker uniforms, to find where each is packed */
const makeGenerator = (outputs: { normal?: boolean; puddle?: boolean } = {}) => {
  const builds: DecalBuildContext[] = [];
  const markers = {
    opacity: uniform(0.25) as unknown as Node<'float'>,
    roughness: uniform(0.75) as unknown as Node<'float'>,
    puddle: uniform(0.5) as unknown as Node<'float'>,
  };
  const generator = defineDecalGenerator({
    id: 'testBlot',
    physicalSize: [0.5, 0.5],
    heightScale: 0.01,
    params: {
      grain: { default: 4, min: 1, max: 16, isStatic: true, isInteger: true },
      tint: { type: 'color', default: '#404040' },
    },
    build: (ctx, params): DecalOutputs => {
      builds.push(ctx);
      const { p, period } = ctx.cells(params.grain);
      return {
        albedo: params.tint,
        opacity: markers.opacity,
        height: fbm(p, { period, octaves: 2, seed: ctx.seed(1) }) as Node<'float'>,
        roughness: markers.roughness,
        ...(outputs.puddle ? { puddle: markers.puddle } : {}),
        ...(outputs.normal ? { normal: vec3(0, 0, 1) as unknown as Node<'vec3'> } : {}),
      };
    },
  });
  return { generator, builds, markers };
};

describe('defineDecalGenerator (p309 D5)', () => {
  it('fills in the description, and refuses no id, a bad default or a bad fact', () => {
    expect(makeGenerator().generator.description).toBe('');
    const def = {
      id: 'bad',
      physicalSize: [1, 1] as [number, number],
      heightScale: 0.01,
      params: { size: { default: 3, max: 2 } },
      build: (): DecalOutputs => {
        throw new Error('unused');
      },
    };
    expect(() => defineDecalGenerator({ ...def, id: '' })).toThrow(/needs an id/);
    expect(() => defineDecalGenerator(def)).toThrow(/"size"'s default: 3 is above its max 2/);
    expect(() => defineDecalGenerator({ ...def, params: {}, physicalSize: [1, 0] })).toThrow(
      /physicalSize \[1,0\] takes two sizes above 0/
    );
  });
});

describe('buildDecalPacking', () => {
  it('packs the opacity with the albedo, and the roughness and puddle mask with the normal', () => {
    const { generator, markers } = makeGenerator({ puddle: true });
    const { nodes } = buildDecalPacking(generator, bakeCtx);
    expect(Object.keys(nodes)).toEqual(['albedoAlpha', 'normalRough']);
    const albedoAlpha = collect(nodes.albedoAlpha);
    const normalRough = collect(nodes.normalRough);
    expect(albedoAlpha.has(markers.opacity)).toBe(true);
    expect(normalRough.has(markers.opacity)).toBe(false);
    expect(normalRough.has(markers.roughness)).toBe(true);
    expect(normalRough.has(markers.puddle)).toBe(true);
    expect(albedoAlpha.has(markers.puddle)).toBe(false);
  });

  it('builds the default normal through the height function, 4 taps, and none when given', () => {
    const { generator, builds, markers } = makeGenerator();
    const { nodes } = buildDecalPacking(generator, bakeCtx);
    expect(builds).toHaveLength(1);
    expect(heightCalls(nodes.normalRough)).toHaveLength(4);
    expect(heightCalls(nodes.albedoAlpha)).toEqual([]);
    // No puddle mask given: none packed
    expect(collect(nodes.normalRough).has(markers.puddle)).toBe(false);
    const given = buildDecalPacking(makeGenerator({ normal: true }).generator, bakeCtx);
    expect(heightCalls(given.nodes.normalRough)).toEqual([]);
  });

  it("gives build the bake's uv and the decal's size, the generator's or the bake's", () => {
    const { generator, builds } = makeGenerator();
    /** The constants a context's tileSize is made of */
    const sizeOf = (ctx: DecalBuildContext) =>
      [...collect(ctx.tileSize)]
        .filter((value) => (value as { isConstNode?: boolean }).isConstNode)
        .map((value) => (value as { value: { x: number; y: number } }).value)
        .map(({ x, y }) => [x, y]);
    buildDecalPacking(generator, bakeCtx);
    expect(builds[0].uv).toBe(bakeCtx.uv);
    expect(builds[0].cells(4).period).toEqual([4, 4]);
    expect(sizeOf(builds[0])).toEqual([[0.5, 0.5]]);
    buildDecalPacking(generator, bakeCtx, { physicalSize: [0.3, 0.2] });
    expect(sizeOf(builds[1])).toEqual([[0.3, 0.2]]);
  });

  it('keeps the seed and params as uniforms, and checks them and the facts', () => {
    const { generator } = makeGenerator();
    const build = buildDecalPacking(generator, bakeCtx, { seed: 9, params: { tint: '#ff0000' } });
    expect(build.seed.value).toBe(9);
    expect(build.params.values.tint).toBe('#ff0000');
    build.params.set({ tint: '#00ff00' });
    expect(build.params.values.tint).toBe('#00ff00');
    expect(() => build.params.set({ grain: 8 })).toThrow(/"grain" is fixed when the graph/);
    expect(() => buildDecalPacking(generator, bakeCtx, { seed: -0.5 })).toThrow(
      /The seed -0.5 isn't a whole number/
    );
    expect(() => buildDecalPacking(generator, bakeCtx, { heightScale: -1 })).toThrow(
      /heightScale -1 takes 0 or more/
    );
    expect(() => buildDecalPacking(generator, bakeCtx, { params: { depth: 1 } as never })).toThrow(
      /\[testBlot\] has no param "depth"/
    );
  });
});
