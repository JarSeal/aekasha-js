import { describe, expect, it } from 'vitest';
import { uniform } from 'three/tsl';
import { Vector2, type Node } from 'three/webgpu';
import { resolveNoisePeriod } from './Period';

describe('resolveNoisePeriod', () => {
  it('reads 0 and none as no period, a number or pair as a constant, a node as it is', () => {
    expect(resolveNoisePeriod(undefined, 'test')).toBeNull();
    expect(resolveNoisePeriod(0, 'test')).toBeNull();
    expect(resolveNoisePeriod([0, 0], 'test')).toBeNull();
    expect(resolveNoisePeriod(8, 'test')?.constant).toEqual([8, 8]);
    expect(resolveNoisePeriod([4, 2], 'test')?.constant).toEqual([4, 2]);
    const node = uniform(new Vector2(4, 4)) as unknown as Node<'vec2'>;
    const resolved = resolveNoisePeriod(node, 'test');
    expect(resolved?.node).toBe(node);
    expect(resolved?.constant).toBeNull();
  });

  it('refuses a period that would leave a seam', () => {
    expect(() => resolveNoisePeriod(2.5, 'test')).toThrow(/isn't a whole number of cells/);
    expect(() => resolveNoisePeriod(-4, 'test')).toThrow(/isn't a whole number of cells/);
    expect(() => resolveNoisePeriod([4, 0], 'test')).toThrow(/isn't a whole number of cells/);
  });
});
