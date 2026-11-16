import { describe, expect, it } from 'vitest';
import { float, texture, uniform, vec2, vec3 } from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  Texture,
  Vector2,
  type Node,
  type TextureNode,
} from 'three/webgpu';
import { applyTerrainDebugView, type TerrainDebugViewContext } from './_dbg__DebugViews';

const makeLayer = () => ({
  tileSize: uniform(new Vector2(3, 3)) as unknown as Node<'vec2'>,
  colorTexture: texture(new Texture()) as unknown as TextureNode,
});

const ctx: TerrainDebugViewContext = {
  coords: vec2(1, 2) as unknown as Node<'vec2'>,
  layers: [makeLayer()],
  weights: null,
  normal: vec3(0, 1, 0) as unknown as Node<'vec3'>,
};

/** How many of a view's nodes run a method, each node once */
const countMethod = (root: unknown, method: string) => {
  const nodes = new Set<Node>();
  const stack = [root] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return [...nodes].filter((node) => (node as unknown as { method?: string }).method === method)
    .length;
};

describe('applyTerrainDebugView', () => {
  it('replaces the shading with an unlit view', () => {
    for (const view of ['TEXEL_DENSITY', 'NORMALS', 'WEIGHTS'] as const) {
      const material = new MeshStandardNodeMaterial();
      material.aoNode = vec3(1) as never;
      applyTerrainDebugView(material, view, ctx);
      expect(material.emissiveNode, view).toBeTruthy();
      expect(material.colorNode).toBeTruthy();
      expect(material.roughnessNode).toBeTruthy();
      expect(material.aoNode).toBeNull();
    }
  });

  it("reads every layer's density and weight", () => {
    const weights = [float(0.25), float(0.75)] as unknown as Node<'float'>[];
    const blended = { ...ctx, layers: [makeLayer(), makeLayer()], weights };
    const density = new MeshStandardNodeMaterial();
    applyTerrainDebugView(density, 'TEXEL_DENSITY', blended);
    expect(countMethod(density.emissiveNode, 'log2')).toBe(2);
    const weightView = new MeshStandardNodeMaterial();
    applyTerrainDebugView(weightView, 'WEIGHTS', blended);
    const reached = new Set<unknown>();
    const stack = [weightView.emissiveNode] as (Node | null)[];
    while (stack.length) {
      const node = stack.pop();
      if (!node || reached.has(node)) continue;
      reached.add(node);
      for (const child of node.getChildren()) stack.push(child as Node);
    }
    for (const weight of weights) expect(reached.has(weight)).toBe(true);
  });
});
