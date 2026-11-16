import { describe, expect, it } from 'vitest';
import { float, texture, uniform, vec3 } from 'three/tsl';
import { Texture, Vector2, type Node, type TextureNode } from 'three/webgpu';
import { applyColorMapDetail, getLayerDetail, sampleColorMap } from './ColorMap';

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

const isTexture = (node: Node) => Boolean((node as { isTextureNode?: boolean }).isTextureNode);

describe('sampleColorMap', () => {
  it("samples the texture once at the mesh's UV", () => {
    const map = texture(new Texture()) as unknown as TextureNode;
    const samples = [...collectNodes([sampleColorMap(map)])].filter(
      (node) =>
        isTexture(node) &&
        node !== (map as unknown as Node) &&
        (node as unknown as { value: unknown }).value === map.value
    );
    expect(samples).toHaveLength(1);
    const { uvNode } = samples[0] as unknown as {
      uvNode: { getAttributeName: (builder?: unknown) => string };
    };
    expect(uvNode.getAttributeName()).toBe('uv');
  });
});

describe('getLayerDetail', () => {
  it("divides the albedo's luminance by the set's average colour's, floored: a grey detail", () => {
    const albedo = vec3(0.2, 0.3, 0.4) as unknown as Node<'vec3'>;
    const average = uniform(vec3(0.5)) as unknown as Node<'vec3'>;
    const detail = getLayerDetail(albedo, average);
    const nodes = collectNodes([detail]);
    expect(nodes.has(albedo)).toBe(true);
    expect(nodes.has(average)).toBe(true);
    expect([...nodes].some((node) => (node as { op?: string }).op === '/')).toBe(true);
    expect([...nodes].some((node) => (node as { method?: string }).method === 'max')).toBe(true);
    // Luminance: a dot with the channels' weights each, then one ratio for all three
    expect(
      [...nodes].filter((node) => (node as { method?: string }).method === 'dot')
    ).toHaveLength(2);
  });
});

describe('applyColorMapDetail', () => {
  const colorMap = vec3(0.5, 0.4, 0.3) as unknown as Node<'vec3'>;
  const detail = vec3(1.1, 0.9, 1) as unknown as Node<'vec3'>;

  it('multiplies the colour map by the detail', () => {
    const albedo = applyColorMapDetail(colorMap, detail, null);
    expect((albedo as unknown as { op?: string }).op).toBe('*');
    const nodes = collectNodes([albedo]);
    expect(nodes.has(colorMap) && nodes.has(detail)).toBe(true);
    expect([...nodes].some((node) => (node as { method?: string }).method === 'smoothstep')).toBe(
      false
    );
  });

  it('fades the detail to 1 over the range by the view distance', () => {
    const range = uniform(new Vector2(20, 60)) as unknown as Node<'vec2'>;
    const viewDistance = float(30) as unknown as Node<'float'>;
    const nodes = collectNodes([applyColorMapDetail(colorMap, detail, { range, viewDistance })]);
    expect(nodes.has(range) && nodes.has(viewDistance) && nodes.has(detail)).toBe(true);
    const methods = [...nodes].map((node) => (node as { method?: string }).method);
    expect(methods).toEqual(expect.arrayContaining(['mix', 'smoothstep']));
  });
});
