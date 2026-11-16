import { beforeEach, describe, expect, it, vi } from 'vitest';
import { color, texture, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, Texture, Vector2, type Node } from 'three/webgpu';
import type { MatProps, TslMaterialFns } from 'aekasha';
import type { TextureSetInput } from 'aekasha/texturesets';
import { loadTerrainDebugViewsAsync } from './TerrainDebugViews';
import {
  createTerrainMaterial,
  getTerrainMaterialProps,
  getTerrainMaterialVariant,
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
  materials: new Map<string, MeshStandardNodeMaterial>(),
  variants: [] as { id: string; overrides: unknown }[],
  warnings: [] as string[],
}));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  IS_DEBUG_ENV: true,
  lwarn: (message: string) => stubs.warnings.push(message),
  getMaterial: (id: string) => stubs.materials.get(id),
  getMaterialVariant: (id: string, overrides: unknown) => {
    stubs.variants.push({ id, overrides });
    return new MeshStandardNodeMaterial();
  },
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
    if (props.id) stubs.materials.set(props.id, material);
    return material;
  },
}));

const build = (terrain: unknown, inputs: Record<string, unknown> = { layer0: makeBundle() }) => {
  const material = new MeshStandardNodeMaterial();
  setupTerrainMaterial(inputs, material, { terrain });
  return material;
};

/** The nodes a material's sockets reach */
const collectNodes = (material: MeshStandardNodeMaterial) => {
  const nodes = new Set<Node>();
  for (const root of [
    material.colorNode,
    material.normalNode,
    material.roughnessNode,
    material.metalnessNode,
    material.aoNode,
    material.emissiveNode,
  ]) {
    (root as Node | null)?.traverse((node) => nodes.add(node));
  }
  return [...nodes];
};

/** How many of the sockets' math nodes run a method (`dFdx`, `cos`, …) */
const countMethod = (material: MeshStandardNodeMaterial, method: string) =>
  collectNodes(material).filter(
    (node) => (node as unknown as { method?: string }).method === method
  ).length;

const getUniformKeys = (material: MeshStandardNodeMaterial) =>
  Object.keys(material.userData.uniforms as object).sort();

const LAYER_UNIFORMS = [
  'terrain_l0_normalStrength',
  'terrain_l0_roughnessScale',
  'terrain_l0_tiling',
  'terrain_l0_tint',
];

describe('setupTerrainMaterial', () => {
  it('sets every socket of one layer in each packing, the AO for FULL only', () => {
    for (const packing of ['LITE', 'FULL', 'MINIMAL'] as const) {
      const material = build({ layers: [{}] }, { layer0: makeBundle(packing) });
      expect(material.colorNode).toBeTruthy();
      expect(material.normalNode).toBeTruthy();
      expect(material.roughnessNode).toBeTruthy();
      expect(material.metalnessNode).toBeTruthy();
      expect(Boolean(material.aoNode)).toBe(packing === 'FULL');
      expect(getUniformKeys(material)).toEqual(
        packing === 'FULL' ? ['terrain_aoTextureInfluence', ...LAYER_UNIFORMS] : LAYER_UNIFORMS
      );
    }
  });

  it('samples each slot once for all the sockets', () => {
    for (const packing of ['LITE', 'FULL', 'MINIMAL'] as const) {
      const bundle = makeBundle(packing);
      const slotNodes = new Set(
        PACKING_SLOTS[packing].map((slot) => bundle[slot as 'albedoHeight'])
      );
      const material = build({ layers: [{}] }, { layer0: bundle });
      // The bundle's slot nodes are each sample's reference, not samples
      const samples = collectNodes(material).filter(
        (node) =>
          (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
          !slotNodes.has(node as never)
      );
      expect(samples, packing).toHaveLength(PACKING_SLOTS[packing].length);
    }
  });

  it("builds planar world tiling's frame without derivatives, a mesh UV's and a bump with them", () => {
    expect(countMethod(build({ layers: [{}] }), 'dFdx')).toBe(0);
    expect(countMethod(build({ layers: [{}] }, { layer0: makeBundle('FULL') }), 'dFdx')).toBe(0);
    expect(countMethod(build({ layers: [{}], uv: 'MESH_UV' }), 'dFdx')).toBeGreaterThan(0);
    expect(
      countMethod(build({ layers: [{}] }, { layer0: makeBundle('MINIMAL') }), 'dFdx')
    ).toBeGreaterThan(0);
  });

  it("keeps a layer's uniforms, the rotation only when given", () => {
    const plain = build({ layers: [{ tiling: 2, tint: '#ff0000', roughnessScale: 0.5 }] });
    const uniforms = plain.userData.uniforms as Record<string, { value: unknown }>;
    expect(getUniformKeys(plain)).toEqual(LAYER_UNIFORMS);
    expect(uniforms.terrain_l0_tiling.value).toBe(2);
    expect(uniforms.terrain_l0_roughnessScale.value).toBe(0.5);
    expect(countMethod(plain, 'cos')).toBe(0);
    const turned = build({ layers: [{ rotation: 30 }] });
    expect(
      (turned.userData.uniforms as Record<string, { value: unknown }>).terrain_l0_rotation.value
    ).toBe(30);
    expect(countMethod(turned, 'cos')).toBeGreaterThan(0);
  });

  it("starts the AO influence at the define's", () => {
    const material = build(
      { layers: [{}], ao: { textureInfluence: 0.25 } },
      { layer0: makeBundle('FULL') }
    );
    const uniforms = material.userData.uniforms as Record<string, { value: unknown }>;
    expect(uniforms.terrain_aoTextureInfluence.value).toBe(0.25);
  });

  it('names a missing or extra layer input and a wrong define', () => {
    expect(() => build({ layers: [{}] }, {})).toThrow(/Missing input "layer0"/);
    expect(() => build({ layers: [{}] }, { layer0: makeBundle(), layer1: makeBundle() })).toThrow(
      /Input "layer1" has no layer/
    );
    expect(() => build({ layers: [{}], projection: {} })).toThrow(/has no field "projection"/);
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

  it('puts the macro texture in the input macro and its settings in the define', () => {
    const props = getTerrainMaterialProps({
      id: 'meadow',
      layers: [{ set: 'grass01', antiTiling: { mode: 'HEX' } }],
      macro: { texture: 'macroNoise', scale: 120, hue: 4 },
      antiTiling: { mode: 'DUAL_SCALE' },
      distance: { fade: [40, 120] },
    });
    expect(props.staticDefines).toEqual({
      terrain: {
        layers: [{ antiTiling: { mode: 'HEX' } }],
        macro: { scale: 120, hue: 4 },
        antiTiling: { mode: 'DUAL_SCALE' },
        distance: { fade: [40, 120] },
      },
    });
    expect(props.inputs).toEqual({
      layer0: { textureSet: 'grass01' },
      macro: { texture: 'macroNoise' },
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

describe('debug views', () => {
  it('builds without the view before the views load, warned, and with it after', async () => {
    stubs.warnings.length = 0;
    const early = build({ layers: [{}], debugView: 'NORMALS' });
    expect(early.emissiveNode).toBeNull();
    expect(stubs.warnings.join()).toMatch(/views aren't loaded/);
    expect(await loadTerrainDebugViewsAsync()).toBe(true);
    for (const debugView of ['TEXEL_DENSITY', 'NORMALS']) {
      const material = build({ layers: [{}], debugView }, { layer0: makeBundle('FULL') });
      expect(material.emissiveNode, debugView).toBeTruthy();
      expect(material.aoNode).toBeNull();
    }
    expect(countMethod(build({ layers: [{}], debugView: 'TEXEL_DENSITY' }), 'log2')).toBe(1);
    expect(build({ layers: [{}] }).emissiveNode).toBeNull();
  });
});

describe('getTerrainMaterialVariant', () => {
  it("asks for a variant with the material's own define at the tier", () => {
    stubs.variants.length = 0;
    const define = { layers: [{}], quality: { LOW: { ao: { textureInfluence: 0 } } } };
    const material = build(define, { layer0: makeBundle('FULL') });
    expect(material.userData.terrainDefine).toBe(define);
    stubs.materials.set('canyon', material);
    getTerrainMaterialVariant('canyon', 'LOW');
    expect(stubs.variants).toEqual([
      {
        id: 'canyon',
        overrides: { staticDefines: { terrain: { ...define, qualityLevel: 'LOW' } } },
      },
    ]);
  });

  it('refuses an unknown or non-terrain material', () => {
    expect(() => getTerrainMaterialVariant('nothing', 'LOW')).toThrow(/no material "nothing"/);
    stubs.materials.set('plain', new MeshStandardNodeMaterial());
    expect(() => getTerrainMaterialVariant('plain', 'LOW')).toThrow(/isn't a terrain material/);
  });
});
