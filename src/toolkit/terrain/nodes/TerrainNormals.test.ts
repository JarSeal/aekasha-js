import { describe, expect, it } from 'vitest';
import { float, uniform, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  bumpNormalWorld,
  getPlanarTangentFrame,
  getUvTangentFrame,
  transformTangentNormalToWorld,
  transformWorldNormalToView,
} from './TerrainNormals';

/** How many of a graph's math nodes run a method (`dFdx`, `cos`, …) */
const countMethod = (roots: Node[], method: string) => {
  const nodes = new Set<Node>();
  for (const root of roots) root.traverse((node) => nodes.add(node));
  return [...nodes].filter((node) => (node as unknown as { method?: string }).method === method)
    .length;
};

const frameNodes = (frame: ReturnType<typeof getPlanarTangentFrame>) => [
  frame.tangent,
  frame.bitangent,
  frame.normal,
];

describe('TerrainNormals', () => {
  it('builds the planar frame without derivatives, turning it only with a rotation', () => {
    const plain = getPlanarTangentFrame(null);
    expect(countMethod(frameNodes(plain), 'dFdx')).toBe(0);
    expect(countMethod(frameNodes(plain), 'cos')).toBe(0);
    const turned = getPlanarTangentFrame(uniform(0.5) as unknown as Node<'float'>);
    expect(countMethod(frameNodes(turned), 'cos')).toBe(1);
  });

  it("builds a UV's frame and a bump from screen-space derivatives", () => {
    const uv = vec2(0.5, 0.5) as unknown as Node<'vec2'>;
    expect(countMethod(frameNodes(getUvTangentFrame(uv)), 'dFdx')).toBeGreaterThan(0);
    expect(countMethod([bumpNormalWorld(float(0.1) as Node<'float'>)], 'dFdx')).toBeGreaterThan(0);
  });

  it('turns a tangent normal into world space and a world normal into view space', () => {
    const normalTS = vec3(0, 0, 1) as unknown as Node<'vec3'>;
    const world = transformTangentNormalToWorld(normalTS, getPlanarTangentFrame(null));
    expect(transformWorldNormalToView(world)).toBeTruthy();
  });
});
