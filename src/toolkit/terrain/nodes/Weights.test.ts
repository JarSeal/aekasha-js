import { describe, expect, it } from 'vitest';
import { texture } from 'three/tsl';
import { Texture, type Node, type TextureNode } from 'three/webgpu';
import { getSplatMapWeights, getVertexColorWeights } from './Weights';

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
  return [...nodes];
};

const isVertexColor = (node: Node) =>
  Boolean((node as unknown as { isVertexColorNode?: boolean }).isVertexColorNode);

/** A node's swizzle, when it's one (three keeps it as `xyzw`) */
const getComponents = (node: Node) => (node as unknown as { components?: string }).components;

describe('getVertexColorWeights', () => {
  it("weighs a layer per channel past the base, RGB_AO's A the AO", () => {
    const rgbAo = getVertexColorWeights(4, 'RGB_AO');
    expect(rgbAo.weights).toHaveLength(4);
    expect(getComponents(rgbAo.vertexAo as Node)).toBe('w');
    expect(rgbAo.weights.slice(1).map(getComponents)).toEqual(['x', 'y', 'z']);
    expect(collectNodes(rgbAo.weights).some(isVertexColor)).toBe(true);
    const rgba = getVertexColorWeights(5, 'RGBA');
    expect(rgba.weights.slice(1).map(getComponents)).toEqual(['x', 'y', 'z', 'w']);
    expect(rgba.vertexAo).toBeNull();
  });

  it('reads only the channels of the layers there', () => {
    const { weights } = getVertexColorWeights(2, 'RGBA');
    expect(weights.slice(1).map(getComponents)).toEqual(['x']);
    // The base reads the one channel too
    const swizzles = collectNodes([weights[0]]).map(getComponents).filter(Boolean);
    expect(swizzles).toEqual(['x']);
  });
});

describe('getSplatMapWeights', () => {
  const makeMap = () => texture(new Texture()) as unknown as TextureNode;
  /** The samples of the maps the weights reach (not the maps' own reference nodes) */
  const getSamples = (weights: Node[], maps: TextureNode[]) =>
    collectNodes(weights).filter(
      (node) =>
        (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
        !maps.includes(node as unknown as TextureNode)
    );

  it('samples each map once, its RGBA four layers past the base', () => {
    const maps = [makeMap(), makeMap()];
    const { weights, vertexAo } = getSplatMapWeights(9, maps);
    expect(weights).toHaveLength(9);
    expect(vertexAo).toBeNull();
    expect(getSamples(weights, maps)).toHaveLength(2);
    expect(weights.slice(1).map(getComponents)).toEqual(['x', 'y', 'z', 'w', 'x', 'y', 'z', 'w']);
  });

  it("reads only the second map's channels of the layers there", () => {
    const maps = [makeMap(), makeMap()];
    const { weights } = getSplatMapWeights(6, maps);
    expect(weights).toHaveLength(6);
    expect(weights.slice(1).map(getComponents)).toEqual(['x', 'y', 'z', 'w', 'x']);
  });
});
