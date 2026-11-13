import { describe, expect, it } from 'vitest';
import { uniform, uv, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakeBuildContext } from 'aekasha';
import {
  cliffStrata,
  concretePores,
  grassGround,
  iceSheet,
  mudCracked,
  mudSmooth,
  rockyGround,
  sandFlat,
  sandRipples,
  snowDrift,
} from '../index';
import { createSurfaceContext, type SurfaceGenerator } from './SurfaceGenerator';
import { buildSurfaceParams } from './SurfaceParams';

const GENERATORS: SurfaceGenerator[] = [
  sandRipples,
  sandFlat,
  mudCracked,
  mudSmooth,
  rockyGround,
  cliffStrata,
  snowDrift,
  iceSheet,
  grassGround,
  concretePores,
] as unknown as SurfaceGenerator[];

const bakeCtx: BakeBuildContext = {
  uv: uv() as unknown as Node<'vec2'>,
  layer: uniform(0, 'int') as unknown as Node<'int'>,
  texel: vec2(1 / 256, 1 / 256) as unknown as Node<'vec2'>,
};

describe("the toolkit's surface generators (p304 D3)", () => {
  it('are ten, one per D3 row, each module file named by its id', () => {
    expect(GENERATORS.map((generator) => generator.id)).toEqual([
      'sandRipples',
      'sandFlat',
      'mudCracked',
      'mudSmooth',
      'rockyGround',
      'cliffStrata',
      'snowDrift',
      'iceSheet',
      'grassGround',
      'concretePores',
    ]);
    expect(new Set(GENERATORS.map((generator) => generator.category)).size).toBe(8);
  });

  it('build every packing with their defaults and physical facts', () => {
    for (const generator of GENERATORS) {
      for (const packing of ['FULL', 'LITE', 'MINIMAL'] as const) {
        const nodes = generator.buildPacking(bakeCtx, {
          packing,
          physicalSize: generator.physicalSize,
          heightScale: generator.heightScale,
          seed: 3,
        });
        expect(Object.keys(nodes).length, `${generator.id} ${packing}`).toBeGreaterThan(0);
      }
    }
  });

  it('build live too (no periods), every output given', () => {
    for (const generator of GENERATORS) {
      const ctx = createSurfaceContext({
        generatorId: generator.id,
        uv: vec2(1.3, -7.2) as unknown as Node<'vec2'>,
        isLive: true,
        tileSize: vec2(...generator.physicalSize) as unknown as Node<'vec2'>,
        seed: uniform(0, 'uint') as unknown as Node<'uint'>,
      });
      const surface = generator.build(
        ctx,
        buildSurfaceParams(generator.id, generator.params).nodes
      );
      expect(surface.albedo, generator.id).toBeDefined();
      expect(surface.height, generator.id).toBeDefined();
      expect(surface.roughness, generator.id).toBeDefined();
    }
  });

  it('build with the seams on (a toggle) and other static values', () => {
    const nodes = concretePores.buildPacking(bakeCtx, {
      packing: 'LITE',
      physicalSize: [2, 2],
      heightScale: 0.004,
      params: { seams: true, seamCount: 3 },
    });
    expect(Object.keys(nodes)).toEqual(['albedoRough', 'normalHeight']);
    expect(() =>
      cliffStrata.buildPacking(bakeCtx, {
        packing: 'LITE',
        physicalSize: [4, 4],
        heightScale: 0.15,
        params: { strata: 7.5 },
      })
    ).toThrow(/"strata": 7.5 isn't a whole number/);
  });
});
