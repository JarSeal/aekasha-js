import { describe, expect, it } from 'vitest';
import { uniform, uv, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakeBuildContext } from 'aekasha';
import {
  decalCracks,
  decalFootprint,
  decalFormwork,
  decalIceCrack,
  decalLeafPatch,
  decalMudSplatter,
  decalScorch,
  decalStain,
  decalWetPatch,
} from '../../index';
import { createSurfaceContext } from '../../procedural/SurfaceGenerator';
import { buildSurfaceParams } from '../../procedural/SurfaceParams';
import { buildDecalPacking, type DecalGenerator, type DecalOutputs } from '../DecalGenerator';

const GENERATORS = [
  decalCracks,
  decalStain,
  decalScorch,
  decalMudSplatter,
  decalFootprint,
  decalWetPatch,
  decalIceCrack,
  decalLeafPatch,
  decalFormwork,
] as unknown as DecalGenerator[];

const bakeCtx: BakeBuildContext = {
  uv: uv() as unknown as Node<'vec2'>,
  layer: uniform(0, 'int') as unknown as Node<'int'>,
  texel: vec2(1 / 480, 1 / 480) as unknown as Node<'vec2'>,
};

/** The layout functions called in a graph whose name starts with `prefix` */
const countCalls = (root: unknown, prefix: string) => {
  let count = 0;
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const call = value as { isShaderCallNodeInternal?: boolean; shaderNode?: unknown };
    const layout = (call.shaderNode as { layout?: { name: string } } | undefined)?.layout;
    if (call.isShaderCallNodeInternal && layout?.name.startsWith(prefix)) count++;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'shaderNode' || key === 'parents') continue;
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(root);
  return count;
};

/** A generator's outputs at the bake's uv, its params at their defaults or the given values */
const buildOutputs = (
  generator: DecalGenerator,
  values: Record<string, string | number | boolean> = {}
): DecalOutputs => {
  const params = buildSurfaceParams(generator.id, generator.params, values as never);
  const ctx = createSurfaceContext({
    generatorId: generator.id,
    uv: bakeCtx.uv,
    isLive: false,
    tileSize: vec2(...generator.physicalSize) as unknown as Node<'vec2'>,
    texel: bakeCtx.texel,
    seed: uniform(0, 'uint') as unknown as Node<'uint'>,
  });
  return generator.build(ctx, params.nodes);
};

describe("the toolkit's decal generators (p309 D5)", () => {
  it("are nine: D5's seven, the leaf patch and the formwork, each described", () => {
    expect(GENERATORS.map((generator) => generator.id)).toEqual([
      'decalCracks',
      'decalStain',
      'decalScorch',
      'decalMudSplatter',
      'decalFootprint',
      'decalWetPatch',
      'decalIceCrack',
      'decalLeafPatch',
      'decalFormwork',
    ]);
    for (const generator of GENERATORS) expect(generator.description).not.toBe('');
  });

  it("build both slots with their defaults, a flat one without the normal's taps", () => {
    const flat = ['decalStain', 'decalScorch', 'decalWetPatch'];
    for (const generator of GENERATORS) {
      const { nodes } = buildDecalPacking(generator, bakeCtx, { seed: 3 });
      expect(Object.keys(nodes), generator.id).toEqual(['albedoAlpha', 'normalRough']);
      const taps = countCalls(nodes.normalRough, 'aekSurfaceHeight_');
      expect(taps, generator.id).toBe(flat.includes(generator.id) ? 0 : 4);
    }
  });

  it('give a puddle mask where D5 does: the footprints, the wet patch, a crack by its param', () => {
    const withPuddle = GENERATORS.filter((generator) => 'puddle' in buildOutputs(generator));
    expect(withPuddle.map((generator) => generator.id)).toEqual([
      'decalCracks',
      'decalFootprint',
      'decalWetPatch',
    ]);
    expect(decalCracks.params.puddle.default).toBe(0);
  });

  it("build every footprint shape, a snow boot's without water", () => {
    const shapes = decalFootprint.params.shape.options;
    expect(shapes).toEqual(['BOOT', 'BARE', 'PAW', 'SNOW_BOOT']);
    for (const shape of shapes) {
      const footprint = decalFootprint as unknown as DecalGenerator;
      const outputs = buildOutputs(footprint, { shape });
      const puddle = outputs.puddle as unknown as { isConstNode?: boolean; value?: number };
      expect(puddle.isConstNode === true && puddle.value === 0, shape).toBe(shape === 'SNOW_BOOT');
      const { nodes } = buildDecalPacking(decalFootprint, bakeCtx, { params: { shape } });
      expect(countCalls(nodes.normalRough, 'aekSurfaceHeight_'), shape).toBe(4);
    }
    expect(() =>
      buildDecalPacking(decalFootprint, bakeCtx, { params: { shape: 'HOOF' as never } })
    ).toThrow(/"shape": "HOOF" isn't one of "BOOT", "BARE", "PAW", "SNOW_BOOT"/);
  });
});
