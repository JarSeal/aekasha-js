import { describe, expect, it } from 'vitest';
import { color, int, texture, uniform, uniformArray, vec2 } from 'three/tsl';
import { DataArrayTexture, Texture, Vector2, Vector4 } from 'three/webgpu';
import type { Node, TextureNode } from 'three/webgpu';
import type { TextureSetArrayInput, TextureSetInput } from 'aekasha/texturesets';
import { bumpNormalView, sampleTextureSet, transformTangentNormalToView } from './SampleTextureSet';

type Slot = 'albedoHeight' | 'normal' | 'orm' | 'albedoRough' | 'normalHeight';

/** A `{ textureSet }` bundle of the slots, each its own texture, and the set's uniforms */
const makeBundle = (slots: Slot[]) => {
  const textures = Object.fromEntries(slots.map((slot) => [slot, new Texture()]));
  const nodes = Object.fromEntries(slots.map((slot) => [slot, texture(textures[slot])]));
  const bundle = {
    ...nodes,
    physicalSize: uniform(new Vector2(3, 3)),
    heightScale: uniform(0.05),
    tint: color(1, 1, 1),
    normalStrength: uniform(1),
    roughnessScale: uniform(1),
    aoStrength: uniform(1),
    heightContrast: uniform(1),
    porosity: uniform(0.5),
    wetDarkening: uniform(0.5),
    wetRoughness: uniform(0.3),
  } as unknown as TextureSetInput;
  return { bundle, textures };
};

/** A `{ textureSetArray }` bundle of the slots, each an array texture */
const makeArrayBundle = (slots: Slot[]) => {
  const textures = Object.fromEntries(slots.map((slot) => [slot, new DataArrayTexture()]));
  const nodes = Object.fromEntries(slots.map((slot) => [slot, texture(textures[slot])]));
  const bundle = {
    ...nodes,
    layerParams: uniformArray([new Vector4()], 'vec4'),
    layerCount: int(2),
  } as unknown as TextureSetArrayInput;
  return { bundle, textures };
};

/** The texture sample a decoded value reads (through its swizzles and maths), or undefined */
const findSample = (node: unknown): TextureNode | undefined => {
  const seen = new Set<unknown>();
  const walk = (value: unknown): TextureNode | undefined => {
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    if ((value as TextureNode).isTextureNode) return value as TextureNode;
    for (const child of Object.values(value)) {
      const found = Array.isArray(child) ? child.map(walk).find(Boolean) : walk(child as unknown);
      if (found) return found;
    }
    return undefined;
  };
  return walk(node);
};

const sampledTexture = (node: unknown) => findSample(node)?.value;

describe('sampleTextureSet', () => {
  const uv = vec2(0.25, 0.75) as unknown as Node<'vec2'>;

  it('decodes LITE: albedo × AO and roughness from albedoRough, the normal and height from normalHeight', () => {
    const { bundle, textures } = makeBundle(['albedoRough', 'normalHeight']);
    const sample = sampleTextureSet(bundle, uv);
    expect(sample.packing).toBe('LITE');
    expect(sampledTexture(sample.albedo)).toBe(textures.albedoRough);
    expect(sampledTexture(sample.roughness)).toBe(textures.albedoRough);
    expect(sampledTexture(sample.normalTS)).toBe(textures.normalHeight);
    expect(sampledTexture(sample.height)).toBe(textures.normalHeight);
    expect(sample.ao).toBeNull();
    expect(sample.isAoBaked).toBe(true);
    expect(findSample(sample.albedo)?.uvNode).toBe(uv);
  });

  it('decodes FULL: its own AO, the normal map, height in the albedo alpha', () => {
    const { bundle, textures } = makeBundle(['albedoHeight', 'normal', 'orm']);
    const sample = sampleTextureSet(bundle, uv);
    expect(sample.packing).toBe('FULL');
    expect(sampledTexture(sample.albedo)).toBe(textures.albedoHeight);
    expect(sampledTexture(sample.height)).toBe(textures.albedoHeight);
    expect(sampledTexture(sample.normalTS)).toBe(textures.normal);
    expect(sampledTexture(sample.roughness)).toBe(textures.orm);
    expect(sampledTexture(sample.ao)).toBe(textures.orm);
    expect(sample.isAoBaked).toBe(false);
  });

  it('decodes MINIMAL: albedo × AO and height, no normal or roughness', () => {
    const { bundle, textures } = makeBundle(['albedoHeight']);
    const sample = sampleTextureSet(bundle, uv);
    expect(sample.packing).toBe('MINIMAL');
    expect(sampledTexture(sample.albedo)).toBe(textures.albedoHeight);
    expect(sampledTexture(sample.height)).toBe(textures.albedoHeight);
    expect(sample.normalTS).toBeNull();
    expect(sample.roughness).toBeNull();
    expect(sample.ao).toBeNull();
    expect(sample.isAoBaked).toBe(true);
  });

  it('samples an array bundle at the layer, an index or a node', () => {
    const { bundle, textures } = makeArrayBundle(['albedoRough', 'normalHeight']);
    const byIndex = sampleTextureSet(bundle, uv, { layer: 2 });
    expect(sampledTexture(byIndex.albedo)).toBe(textures.albedoRough);
    expect(findSample(byIndex.albedo)?.depthNode).toBeTruthy();
    const layer = int(1) as unknown as Node<'int'>;
    const byNode = sampleTextureSet(bundle, uv, { layer });
    expect(findSample(byNode.height)?.depthNode).toBe(layer);
  });

  it('refuses an array bundle without a layer, and a layer for a set bundle', () => {
    const { bundle: arrayBundle } = makeArrayBundle(['albedoRough', 'normalHeight']);
    expect(() => sampleTextureSet(arrayBundle, uv)).toThrow(/needs options\.layer/);
    const { bundle } = makeBundle(['albedoRough', 'normalHeight']);
    expect(() => sampleTextureSet(bundle, uv, { layer: 0 })).toThrow(
      /is for a \{ textureSetArray \}/
    );
  });

  it('samples with the gradients given', () => {
    const { bundle } = makeBundle(['albedoRough', 'normalHeight']);
    const dx = vec2(0.01, 0) as unknown as Node<'vec2'>;
    const dy = vec2(0, 0.01) as unknown as Node<'vec2'>;
    const sample = sampleTextureSet(bundle, uv, { grad: { dx, dy } });
    expect(findSample(sample.albedo)?.gradNode).toEqual([dx, dy]);
    expect(findSample(sampleTextureSet(bundle, uv).albedo)?.gradNode).toBeNull();
  });

  it('refuses a bundle without a complete packing', () => {
    const { bundle } = makeBundle(['albedoRough', 'orm']);
    expect(() => sampleTextureSet(bundle, uv)).toThrow(/holds no complete packing/);
  });
});

describe('the normal helpers', () => {
  it('build a view-space normal node from a tangent normal at a UV, and from a height', () => {
    const { bundle } = makeBundle(['albedoRough', 'normalHeight']);
    const uv = vec2(0.5, 0.5) as unknown as Node<'vec2'>;
    const sample = sampleTextureSet(bundle, uv);
    const normal = sample.normalTS as Node<'vec3'>;
    expect(transformTangentNormalToView(normal, uv).isNode).toBe(true);
    expect(bumpNormalView(sample.height.mul(bundle.heightScale) as Node<'float'>).isNode).toBe(
      true
    );
  });
});
