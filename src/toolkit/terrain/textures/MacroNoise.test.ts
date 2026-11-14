import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uniform, uv, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BakedTexture, BakeTextureOpts } from 'aekasha';
import { bakeMacroNoise, buildMacroNoise } from './MacroNoise';

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

type CallNode = {
  isShaderCallNodeInternal: true;
  shaderNode: { layout: { name: string } };
};

/** The layout function calls in a graph, each call once */
const callNames = (node: unknown): string[] => {
  const names: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if ((value as CallNode).isShaderCallNodeInternal) {
      names.push((value as CallNode).shaderNode.layout.name);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'shaderNode' || key === 'parents') continue;
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(node);
  return names;
};

const at = uv() as unknown as Node<'vec2'>;

beforeEach(() => {
  stubs.calls.length = 0;
  stubs.built.length = 0;
});

describe('bakeMacroNoise', () => {
  it('bakes one linear output, 512² under the id macroNoise by default', async () => {
    const bake = await bakeMacroNoise();
    expect(bake.id).toBe('macroNoise');
    const [opts] = stubs.calls;
    expect(opts.size).toBe(512);
    expect(opts.outputs).toEqual([{ name: 'data', colorSpace: 'LINEAR' }]);
    // The baker's defaults: mips, REPEAT
    expect(opts.mipmaps).toBeUndefined();
    expect(opts.wrap).toBeUndefined();
    expect(Object.keys(stubs.built[0])).toEqual(['data']);
  });

  it('passes the id, the size, the filtering and the ownership on', async () => {
    await bakeMacroNoise({ id: 'myMacro', size: 256, anisotropy: 'MAX', isPersistent: true });
    expect(stubs.calls[0]).toMatchObject({
      id: 'myMacro',
      size: 256,
      anisotropy: 'MAX',
      isPersistent: true,
    });
  });

  it("rejects a size or a seed that isn't a whole number, before any bake", async () => {
    await expect(bakeMacroNoise({ size: 100.5 })).rejects.toThrow(/the size 100.5 isn't a whole/);
    await expect(bakeMacroNoise({ size: 2 })).rejects.toThrow(/the size 2 isn't/);
    await expect(bakeMacroNoise({ seed: 1.5 })).rejects.toThrow(/the seed 1.5 isn't a whole/);
    await expect(bakeMacroNoise({ seed: -1 })).rejects.toThrow(/the seed -1 isn't/);
    expect(stubs.calls).toHaveLength(0);
  });
});

describe('buildMacroNoise', () => {
  it('builds only periodic noise: every channel tiles', () => {
    const names = new Set(callNames(buildMacroNoise(at, { size: 512, seed: 0 })));
    // The hash wraps its cell before the call (`hash12`'s period), the others in their function
    names.delete('aekHashCell');
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/Periodic$/);
  });

  it('writes a vec4', () => {
    expect(buildMacroNoise(at, { size: 64, seed: 3 }).nodeType).toBe('vec4');
  });
});
