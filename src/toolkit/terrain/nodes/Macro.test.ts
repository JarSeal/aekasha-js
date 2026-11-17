import { describe, expect, it } from 'vitest';
import { float, texture, uniform, vec3 } from 'three/tsl';
import { Texture, type Node, type TextureNode } from 'three/webgpu';
import { applyMacroVariation, sampleMacroTexture, type MacroNodes } from './Macro';

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

const makeNodes = (): MacroNodes => ({
  scale: uniform(120) as unknown as Node<'float'>,
  brightness: uniform(0.2) as unknown as Node<'float'>,
  hue: uniform(8) as unknown as Node<'float'>,
  roughness: uniform(0.15) as unknown as Node<'float'>,
});

describe('macro variation', () => {
  it('samples the macro texture at the world over its scale', () => {
    const nodes = makeNodes();
    const source = texture(new Texture()) as unknown as TextureNode;
    const sample = sampleMacroTexture(source, nodes.scale) as unknown as {
      isTextureNode: boolean;
      uvNode: Node;
    };
    expect(sample.isTextureNode).toBe(true);
    expect(sample).not.toBe(source);
    expect(collectNodes([sample.uvNode]).has(nodes.scale as unknown as Node)).toBe(true);
  });

  it('varies the albedo by brightness and hue, the roughness by its own amount, capped', () => {
    const nodes = makeNodes();
    const macro = texture(new Texture()).sample(vec3(0).xy) as unknown as Node<'vec4'>;
    const surface = {
      albedo: vec3(0.5) as unknown as Node<'vec3'>,
      roughness: float(0.7) as unknown as Node<'float'>,
    };
    const varied = applyMacroVariation(surface, macro, nodes);
    const albedoNodes = collectNodes([varied.albedo]);
    const roughnessNodes = collectNodes([varied.roughness]);
    expect(albedoNodes.has(nodes.brightness as unknown as Node)).toBe(true);
    expect(albedoNodes.has(nodes.hue as unknown as Node)).toBe(true);
    expect(albedoNodes.has(nodes.roughness as unknown as Node)).toBe(false);
    expect(roughnessNodes.has(nodes.roughness as unknown as Node)).toBe(true);
    expect(roughnessNodes.has(nodes.brightness as unknown as Node)).toBe(false);
    expect((varied.roughness as unknown as { method?: string }).method).toBe('min');
  });
});
