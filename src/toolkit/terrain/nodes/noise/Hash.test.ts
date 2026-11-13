import { describe, expect, it } from 'vitest';
import { vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash12, hash22, toSeedNode } from './Hash';

type CallNode = { isShaderCallNodeInternal: true; shaderNode: { layout: { name: string } } };

/** The layout function calls a graph's top node makes (its own and its inputs') */
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

const p = vec2(0.25, 0.75) as unknown as Node<'vec2'>;

describe('the seed', () => {
  it('wraps a number to 32 bits, refuses a fraction', () => {
    expect((toSeedNode(-1) as unknown as { value: number }).value).toBe(0xffffffff);
    expect((toSeedNode(7) as unknown as { value: number }).value).toBe(7);
    expect(() => toSeedNode(1.5)).toThrow(/isn't a whole number/);
  });
});

describe('the hashes', () => {
  it('hash the cell through the layout functions', () => {
    expect(callNames(hash12(p))).toContain('aekHashCell');
    expect(callNames(hash22(p, { seed: 3 }))).toContain('aekHashCell');
  });
});

describe('a periodic hash', () => {
  it('wraps the cell by the period, refuses one that would leave a seam', () => {
    expect(callNames(hash12(p, { period: 8 }))).toContain('aekHashCell');
    expect(() => hash22(p, { period: 1.5 })).toThrow(/isn't a whole number of cells/);
  });
});
