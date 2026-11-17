import { describe, expect, it } from 'vitest';
import {
  modelScale,
  modelWorldMatrix,
  normalLocal,
  normalWorldGeometry,
  positionLocal,
  positionWorld,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { getSurfaceSpace } from './SurfaceSpace';

/** The nodes the root reaches, each once */
const collectNodes = (root: unknown) => {
  const nodes = new Set<Node>();
  const stack = [root] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return nodes;
};

describe('getSurfaceSpace', () => {
  it("is the world's position and geometry normal, its normal already in world space", () => {
    const world = getSurfaceSpace('WORLD');
    expect(world.position).toBe(positionWorld);
    expect(world.normal).toBe(normalWorldGeometry);
    const normal = vec3(0, 1, 0) as unknown as Node<'vec3'>;
    expect(world.toWorld(normal)).toBe(normal);
    // The default, and made once
    expect(getSurfaceSpace()).toBe(world);
  });

  it("is the mesh's own scaled to metres, its normal into world space through the model", () => {
    const object = getSurfaceSpace('OBJECT');
    expect(getSurfaceSpace('OBJECT')).toBe(object);
    const position = collectNodes(object.position);
    expect(position.has(positionLocal as unknown as Node)).toBe(true);
    expect(position.has(modelScale as unknown as Node)).toBe(true);
    expect(position.has(positionWorld as unknown as Node)).toBe(false);
    expect(collectNodes(object.normal).has(normalLocal as unknown as Node)).toBe(true);
    const toWorld = collectNodes(object.toWorld(vec3(0, 1, 0) as unknown as Node<'vec3'>));
    expect(toWorld.has(modelWorldMatrix as unknown as Node)).toBe(true);
    expect(toWorld.has(modelScale as unknown as Node)).toBe(true);
  });
});
