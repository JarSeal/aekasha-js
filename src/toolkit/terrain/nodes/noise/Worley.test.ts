import { describe, expect, it } from 'vitest';
import { vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { worley } from './Worley';

type CallNode = {
  isShaderCallNodeInternal: true;
  shaderNode: { layout: { name: string } };
};

/** The layout function calls in a graph */
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

/** The node a swizzle reads (`SplitNode.node`) */
const swizzled = (node: unknown) => (node as { node: unknown }).node;

const p = vec2(2.5, 3.25) as unknown as Node<'vec2'>;

describe('worley', () => {
  it('reads f1, f2 and the cell id from one search, stored once', () => {
    const { f1, f2, cellId } = worley(p, { seed: 2 });
    expect(swizzled(f1)).toBe(swizzled(f2));
    expect(swizzled(f2)).toBe(swizzled(cellId));
    expect((swizzled(f1) as { isVarNode?: boolean }).isVarNode).toBe(true);
    expect(callNames(f1)).toEqual(['aekWorley']);
  });

  it('calls the periodic search with a period', () => {
    expect(callNames(worley(p, { period: 6 }).f1)).toEqual(['aekWorleyPeriodic']);
  });

  it('refuses a jitter outside 0..1 and a period that would leave a seam', () => {
    expect(() => worley(p, { jitter: 1.5 })).toThrow(/jitter is 1.5/);
    expect(() => worley(p, { jitter: -0.1 })).toThrow(/jitter is -0.1/);
    expect(() => worley(p, { period: 3.5 })).toThrow(/isn't a whole number of cells/);
  });
});
