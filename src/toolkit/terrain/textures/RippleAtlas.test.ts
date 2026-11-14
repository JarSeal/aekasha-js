import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uniform, uv, vec2, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakedTexture, BakeTextureOpts } from 'aekasha';
import { bakeRippleAtlas, buildRippleAtlas, decodeRippleAtlas } from './RippleAtlas';

const stubs = vi.hoisted(() => ({
  calls: [] as BakeTextureOpts[],
  built: [] as Record<string, unknown>[],
}));

// `bakeTexture` as the engine runs it: the graph built before it returns
vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  bakeTexture: (opts: BakeTextureOpts) => {
    stubs.calls.push(opts);
    const nodes = opts.build?.({
      uv: uv() as unknown as Node<'vec2'>,
      layer: uniform(0, 'int') as unknown as Node<'int'>,
      texel: vec2(1 / 64, 1 / 64) as unknown as Node<'vec2'>,
    });
    stubs.built.push(nodes ?? {});
    return Promise.resolve({ id: opts.id } as BakedTexture);
  },
}));

const at = uv() as unknown as Node<'vec2'>;

beforeEach(() => {
  stubs.calls.length = 0;
  stubs.built.length = 0;
});

describe('bakeRippleAtlas', () => {
  it('bakes one linear output, 256² under the id rippleAtlas by default', async () => {
    const bake = await bakeRippleAtlas();
    expect(bake.id).toBe('rippleAtlas');
    const [opts] = stubs.calls;
    expect(opts.size).toBe(256);
    expect(opts.outputs).toEqual([{ name: 'data', colorSpace: 'LINEAR' }]);
    expect(opts.mipmaps).toBeUndefined();
    expect(opts.wrap).toBeUndefined();
    expect(Object.keys(stubs.built[0])).toEqual(['data']);
  });

  it('passes the id, the size, the filtering and the ownership on', async () => {
    await bakeRippleAtlas({ id: 'rain', size: 512, cells: 8, anisotropy: 4, isPersistent: true });
    expect(stubs.calls[0]).toMatchObject({
      id: 'rain',
      size: 512,
      anisotropy: 4,
      isPersistent: true,
    });
  });

  it('rejects a size, cell count or seed out of range, before any bake', async () => {
    await expect(bakeRippleAtlas({ size: 0 })).rejects.toThrow(/the size 0 isn't a whole number/);
    await expect(bakeRippleAtlas({ cells: 2.5 })).rejects.toThrow(/the cells 2.5 isn't/);
    await expect(bakeRippleAtlas({ cells: 17 })).rejects.toThrow(/the cells 17 isn't/);
    await expect(bakeRippleAtlas({ seed: -3 })).rejects.toThrow(/the seed -3 isn't/);
    await expect(bakeRippleAtlas({ size: 64, cells: 16 })).rejects.toThrow(
      /16 cells across 64 texels leave a drop under 8 texels/
    );
    expect(stubs.calls).toHaveLength(0);
  });
});

describe('buildRippleAtlas', () => {
  it('writes a vec4', () => {
    expect(buildRippleAtlas(at, { cells: 4, seed: 0 }).nodeType).toBe('vec4');
  });
});

describe('decodeRippleAtlas', () => {
  const sample = vec4(0.5, 0.5, 0, 0) as unknown as Node<'vec4'>;

  it('gives the normal offset and the strength, from a number or a node of time', () => {
    const rings = decodeRippleAtlas(sample, 0.25);
    expect(rings.normalXY).toBeDefined();
    expect(rings.mask).toBeDefined();
    const time = uniform(0) as unknown as Node<'float'>;
    expect(decodeRippleAtlas(sample, time, { width: 0.15, halfWaves: 1 }).mask).toBeDefined();
  });

  it('refuses a wave train without a width or a wave', () => {
    expect(() => decodeRippleAtlas(sample, 0, { width: 0 })).toThrow(/width \(0\)/);
    expect(() => decodeRippleAtlas(sample, 0, { halfWaves: -1 })).toThrow(/halfWaves \(-1\)/);
  });
});
