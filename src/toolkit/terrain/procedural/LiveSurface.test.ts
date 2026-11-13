import { describe, expect, it } from 'vitest';
import { float, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { fbm } from '../nodes/noise/Noise';
import { createLiveSurface } from './LiveSurface';
import { defineSurfaceGenerator, type SurfaceBuildContext } from './SurfaceGenerator';

type CallNode = { isShaderCallNodeInternal?: true; shaderNode: { layout?: { name: string } } };

/** How many layout function calls named `aekSurfaceHeight_…` a graph holds */
const countHeightCalls = (node: unknown) => {
  let count = 0;
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const call = value as CallNode;
    if (
      call.isShaderCallNodeInternal &&
      call.shaderNode.layout?.name.startsWith('aekSurfaceHeight_')
    ) {
      count++;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'shaderNode' || key === 'parents') continue;
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(node);
  return count;
};

const makeGenerator = (outputs: { normal?: boolean; ao?: boolean } = {}) => {
  const builds: SurfaceBuildContext[] = [];
  const periods: unknown[] = [];
  const generator = defineSurfaceGenerator({
    id: 'liveDunes',
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
      periods.push(period);
      const height = fbm(p, { period, octaves: 3, gain: params.gain, seed: ctx.seed(1) })
        .mul(0.5)
        .add(0.5) as Node<'float'>;
      return {
        albedo: params.tint,
        height,
        roughness: float(0.9) as unknown as Node<'float'>,
        ...(outputs.normal ? { normal: vec3(0, 0, 1) as unknown as Node<'vec3'> } : {}),
        ...(outputs.ao ? { ao: float(0.5) as unknown as Node<'float'> } : {}),
      };
    },
  });
  return { generator, builds, periods };
};

describe('createLiveSurface', () => {
  it('builds the surface once, live and without periods, at the world point by default', () => {
    const { generator, builds, periods } = makeGenerator();
    const live = createLiveSurface(generator);
    expect(builds).toHaveLength(1);
    expect(builds[0].isLive).toBe(true);
    expect(builds[0].uv).toBe(live.uv);
    expect(periods).toEqual([0]);
    expect(live.generator).toBe(generator);
    expect(live.physicalSize).toEqual([4, 2]);
    expect(live.heightScale).toBe(0.08);
    expect(live.albedo && live.height && live.roughness).toBeTruthy();
    // No taps: the caller bumps the height, and there's no AO
    expect(live.normalTS).toBeNull();
    expect(live.ao).toBeNull();
    expect(live.isAoBaked).toBe(false);
  });

  it('takes the point and the physical facts given', () => {
    const { generator, builds } = makeGenerator();
    const uv = vec2(3.5, -12.25) as unknown as Node<'vec2'>;
    const live = createLiveSurface(generator, { uv, physicalSize: [8, 8], heightScale: 0.2 });
    expect(live.uv).toBe(uv);
    expect(builds[0].uv).toBe(uv);
    expect(live.physicalSize).toEqual([8, 8]);
    expect(live.heightScale).toBe(0.2);
    expect(() => createLiveSurface(generator, { physicalSize: [0, 1] })).toThrow(
      /physicalSize \[0,1\] takes two sizes above 0/
    );
  });

  it("takes a bake's taps only when asked: 4 for the normal, 8 for the cavity", () => {
    const { generator, builds } = makeGenerator();
    const tapped = createLiveSurface(generator, { normal: 'TAPS' });
    expect(tapped.normalTS).not.toBeNull();
    expect(tapped.ao).toBeNull();
    expect(countHeightCalls(tapped.normalTS)).toBe(4);
    const occluded = createLiveSurface(generator, { ao: 'CAVITY' });
    expect(occluded.normalTS).toBeNull();
    expect(countHeightCalls(occluded.ao)).toBe(8);
    // The surface itself is still built once per call: the taps are calls of one function
    expect(builds).toHaveLength(2);
  });

  it("keeps the generator's own normal and AO, without taps", () => {
    const { generator } = makeGenerator({ normal: true, ao: true });
    const live = createLiveSurface(generator, { normal: 'TAPS', ao: 'CAVITY' });
    expect(countHeightCalls(live.normalTS)).toBe(0);
    expect(countHeightCalls(live.ao)).toBe(0);
    expect(live.normalTS).not.toBeNull();
    expect(live.ao).not.toBeNull();
  });

  it('sets the uniform params and the seed, and refuses the rest', () => {
    const { generator } = makeGenerator();
    const live = createLiveSurface(generator, { seed: 7, params: { gain: 0.25 } });
    expect(live.getSeed()).toBe(7);
    expect(live.getParams()).toEqual({ scale: 6, gain: 0.25, tint: '#c0a080' });
    live.setParams({ gain: 0.75, tint: '#ffffff' });
    expect(live.getParams()).toEqual({ scale: 6, gain: 0.75, tint: '#ffffff' });
    live.setSeed(11);
    expect(live.getSeed()).toBe(11);
    expect(() => live.setSeed(1.5)).toThrow(/\[liveDunes\] The live surface's seed 1.5/);
    expect(() => live.setParams({ scale: 8 })).toThrow(/"scale" is fixed when the graph is built/);
    expect(() => live.setParams({ gain: 2 })).toThrow(/"gain": 2 is above its max 1/);
    expect(() => createLiveSurface(generator, { seed: 0.5 })).toThrow(/The seed 0.5/);
    expect(() => createLiveSurface(generator, { params: { depth: 1 } as never })).toThrow(
      /\[liveDunes\] has no param "depth"/
    );
  });

  it('gives each call its own uniforms', () => {
    const { generator } = makeGenerator();
    const a = createLiveSurface(generator, { seed: 1 });
    const b = createLiveSurface(generator, { seed: 2 });
    a.setSeed(9);
    expect(b.getSeed()).toBe(2);
  });
});
