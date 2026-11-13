import { describe, expect, it } from 'vitest';
import { color, texture, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, Texture, Vector2 } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { setup } from './textureSetSurface.tsl';

type Slot = 'albedoHeight' | 'normal' | 'orm' | 'albedoRough' | 'normalHeight';

const PACKINGS: Record<string, Slot[]> = {
  LITE: ['albedoRough', 'normalHeight'],
  FULL: ['albedoHeight', 'normal', 'orm'],
  MINIMAL: ['albedoHeight'],
};

/** A `{ textureSet }` bundle of the packing's slots and the set's uniforms */
const makeBundle = (packing: keyof typeof PACKINGS) =>
  ({
    ...Object.fromEntries(PACKINGS[packing].map((slot) => [slot, texture(new Texture())])),
    physicalSize: uniform(new Vector2(3, 3)),
    heightScale: uniform(0.05),
    tint: color(1, 1, 1),
    normalStrength: uniform(1),
    roughnessScale: uniform(2.5),
    aoStrength: uniform(1),
    heightContrast: uniform(1),
    porosity: uniform(0.5),
    wetDarkening: uniform(0.5),
    wetRoughness: uniform(0.3),
  }) as unknown as TextureSetInput;

const build = (packing: keyof typeof PACKINGS, defines?: Record<string, unknown>) => {
  const material = new MeshStandardNodeMaterial();
  setup({ surface: makeBundle(packing) }, material, defines);
  return material;
};

describe('textureSetSurface setup', () => {
  it('sets the colour, roughness, metalness and normal; AO only for FULL', () => {
    for (const packing of ['LITE', 'FULL'] as const) {
      const material = build(packing);
      expect(material.colorNode).toBeTruthy();
      expect(material.roughnessNode).toBeTruthy();
      expect(material.metalnessNode).toBeTruthy();
      expect(material.normalNode).toBeTruthy();
      expect(Boolean(material.aoNode)).toBe(packing === 'FULL');
    }
  });

  it("bumps MINIMAL's normal from its height, or leaves the mesh's with FLAT", () => {
    expect(build('MINIMAL').normalNode).toBeTruthy();
    expect(build('MINIMAL', { minimalNormal: 'FLAT' }).normalNode).toBeNull();
  });

  it('tiles at the mesh UV with UV', () => {
    expect(build('LITE', { tiling: 'UV' }).colorNode).toBeTruthy();
  });

  it('names a missing surface and a bad static define', () => {
    expect(() => setup({}, new MeshStandardNodeMaterial())).toThrow(/Missing input "surface"/);
    expect(() => build('LITE', { tiling: 'XZ' })).toThrow(
      /Static define "tiling" is "XZ": use "WORLD_XZ" or "UV"/
    );
    expect(() => build('LITE', { minimalNormal: true })).toThrow(/"minimalNormal" is true/);
  });
});
