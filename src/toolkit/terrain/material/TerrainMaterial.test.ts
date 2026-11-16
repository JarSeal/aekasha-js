import { beforeEach, describe, expect, it, vi } from 'vitest';
import { color, texture, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, Texture, Vector2 } from 'three/webgpu';
import type { MatProps, TslMaterialFns } from 'aekasha';
import type { TextureSetInput } from 'aekasha/texturesets';
import {
  createTerrainMaterial,
  getTerrainMaterialProps,
  setupTerrainMaterial,
  TERRAIN_TSL_MATERIAL_ID,
} from './TerrainMaterial';

type Packing = 'LITE' | 'FULL' | 'MINIMAL';

const PACKING_SLOTS: Record<Packing, string[]> = {
  LITE: ['albedoRough', 'normalHeight'],
  FULL: ['albedoHeight', 'normal', 'orm'],
  MINIMAL: ['albedoHeight'],
};

/** A `{ textureSet }` bundle of the packing's slots and the set's uniforms */
const makeBundle = (packing: Packing = 'LITE') =>
  ({
    ...Object.fromEntries(PACKING_SLOTS[packing].map((slot) => [slot, texture(new Texture())])),
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
  }) as unknown as TextureSetInput;

/** The kernel's TSL path in short: the registered setup over the props' inputs as bundles */
const stubs = vi.hoisted(() => ({
  registered: new Map<string, unknown>(),
  created: [] as { props: unknown; material: unknown }[],
}));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  registerTslMaterial: (id: string, fns: unknown) => {
    if (!stubs.registered.has(id)) stubs.registered.set(id, fns);
  },
  createMaterial: (props: MatProps) => {
    const fns = stubs.registered.get(props.tslMaterialId ?? '') as TslMaterialFns;
    const material = new MeshStandardNodeMaterial();
    material.userData.uniforms = {};
    const tsl = props as MatProps & { inputs: Record<string, unknown> };
    const inputs = Object.fromEntries(Object.keys(tsl.inputs).map((key) => [key, makeBundle()]));
    fns.setup?.(
      inputs,
      material,
      (tsl as { staticDefines: Record<string, unknown> }).staticDefines
    );
    stubs.created.push({ props, material });
    return material;
  },
}));

const build = (terrain: unknown, inputs: Record<string, unknown> = { layer0: makeBundle() }) => {
  const material = new MeshStandardNodeMaterial();
  setupTerrainMaterial(inputs, material, { terrain });
  return material;
};

describe('setupTerrainMaterial', () => {
  it('sets the colour and metalness of one layer in each packing', () => {
    for (const packing of ['LITE', 'FULL', 'MINIMAL'] as const) {
      const material = build({ layers: [{}] }, { layer0: makeBundle(packing) });
      expect(material.colorNode).toBeTruthy();
      expect(material.metalnessNode).toBeTruthy();
    }
  });

  it("keeps a layer's uniforms, the rotation only when given", () => {
    const plain = build({ layers: [{ tiling: 2, tint: '#ff0000' }] });
    const uniforms = plain.userData.uniforms as Record<string, { value: unknown }>;
    expect(Object.keys(uniforms).sort()).toEqual(['terrain_l0_tiling', 'terrain_l0_tint']);
    expect(uniforms.terrain_l0_tiling.value).toBe(2);
    const turned = build({ layers: [{ rotation: 30 }] });
    expect(
      (turned.userData.uniforms as Record<string, { value: unknown }>).terrain_l0_rotation.value
    ).toBe(30);
  });

  it('tiles at the mesh UV with MESH_UV', () => {
    expect(build({ layers: [{}], uv: 'MESH_UV' }).colorNode).toBeTruthy();
  });

  it('names a missing or extra layer input and a wrong define', () => {
    expect(() => build({ layers: [{}] }, {})).toThrow(/Missing input "layer0"/);
    expect(() => build({ layers: [{}] }, { layer0: makeBundle(), layer1: makeBundle() })).toThrow(
      /Input "layer1" has no layer/
    );
    expect(() => build({ layers: [{}], antiTiling: {} })).toThrow(/has no field "antiTiling"/);
    expect(() => build(undefined)).toThrow(/Missing static define "terrain"/);
  });
});

describe('getTerrainMaterialProps', () => {
  it('puts the sets in the inputs and the rest in the define', () => {
    expect(
      getTerrainMaterialProps({
        id: 'meadow',
        layers: [{ set: 'grass01', tiling: 2 }],
        packing: 'FULL',
        uv: 'MESH_UV',
      })
    ).toEqual({
      id: 'meadow',
      type: 'STANDARDNODEMATERIAL',
      tslMaterialId: TERRAIN_TSL_MATERIAL_ID,
      staticDefines: { terrain: { layers: [{ tiling: 2 }], uv: 'MESH_UV' } },
      inputs: { layer0: { textureSet: 'grass01', packing: 'FULL' } },
    });
    expect(getTerrainMaterialProps({ id: 'a', layers: [{ set: 'sand01' }] }).inputs).toEqual({
      layer0: { textureSet: 'sand01' },
    });
  });
});

describe('createTerrainMaterial', () => {
  beforeEach(() => {
    stubs.created.length = 0;
  });

  it('registers aek.terrain and builds the graph a JSON material gets', () => {
    const material = createTerrainMaterial({ id: 'meadow', layers: [{ set: 'grass01' }] });
    expect(stubs.registered.get(TERRAIN_TSL_MATERIAL_ID)).toEqual({
      setup: setupTerrainMaterial,
    });
    expect(stubs.created).toHaveLength(1);
    expect(material.colorNode).toBeTruthy();
    // The JSON route's material (terrain.material.json) runs the same setup on the same define
    const json = build({ layers: [{}] });
    expect(Object.keys(json.userData.uniforms as object)).toEqual(
      Object.keys(material.userData.uniforms as object)
    );
  });
});
