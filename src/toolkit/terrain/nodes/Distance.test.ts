import { describe, expect, it } from 'vitest';
import { float, normalWorldGeometry, uniform, vec3 } from 'three/tsl';
import { Vector2, type Node } from 'three/webgpu';
import { fadeDetailNormal } from './Distance';

/** The nodes the roots reach, each once */
const collectNodes = (roots: unknown[]) => {
  const nodes = new Set<Node>();
  const stack = [...roots] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return nodes;
};

describe('fadeDetailNormal', () => {
  it("mixes the normal towards the geometry's by the view distance over the fade range", () => {
    const normal = vec3(0, 1, 0) as unknown as Node<'vec3'>;
    const distance = float(50) as unknown as Node<'float'>;
    const fade = uniform(new Vector2(40, 120)) as unknown as Node<'vec2'>;
    const faded = fadeDetailNormal(normal, distance, fade);
    const nodes = collectNodes([faded]);
    for (const node of [normal, distance, fade, normalWorldGeometry]) {
      expect(nodes.has(node as unknown as Node)).toBe(true);
    }
    expect((faded as unknown as { method?: string }).method).toBe('normalize');
  });
});
