import { beforeEach, describe, expect, it, vi } from 'vitest';
import { color, normalWorldGeometry, texture, uniform } from 'three/tsl';
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
    // A layer's set as its bundle, the macro texture and the splat maps as texture nodes
    const inputs = Object.fromEntries(
      Object.keys(tsl.inputs).map((key) => [
        key,
        key.startsWith('layer') ? makeBundle() : texture(new Texture()),
      ])
    );
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

/**
 * The nodes the roots reach, each once (three's `traverse` walks a shared node once per path to
 * it, which a hex-tiled graph has exponentially many of)
 */
const collectNodesFrom = (roots: unknown[]) => {
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

/** The nodes a material's sockets reach, each once */
const collectNodes = (material: MeshStandardNodeMaterial) =>
  collectNodesFrom([
    material.colorNode,
    material.normalNode,
    material.roughnessNode,
    material.metalnessNode,
    material.aoNode,
    material.emissiveNode,
  ]);

/** How many of the sockets' math nodes run a method (`dFdx`, `cos`, …) */
const countMethod = (material: MeshStandardNodeMaterial, method: string) =>
  collectNodes(material).filter(
    (node) => (node as unknown as { method?: string }).method === method
  ).length;

const getUniformKeys = (material: MeshStandardNodeMaterial) =>
  Object.keys(material.userData.uniforms as object).sort();

const getUniforms = (material: MeshStandardNodeMaterial) =>
  material.userData.uniforms as Record<string, { value: unknown }>;

/** `count` layer bundles of the packing as the inputs `layer<i>`, plus the extra inputs */
const layerInputs = (
  count: number,
  packing: Packing = 'LITE',
  extra: Record<string, unknown> = {}
) => ({
  ...Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`layer${i}`, makeBundle(packing)])
  ),
  ...extra,
});

const layersOf = (count: number) => Array.from({ length: count }, () => ({}));

/** The texture samples the sockets reach: texture nodes that aren't the inputs' own references */
const countSamples = (material: MeshStandardNodeMaterial, inputs: Record<string, unknown>) => {
  const references = new Set<unknown>();
  for (const input of Object.values(inputs)) {
    if ((input as { isTextureNode?: boolean }).isTextureNode) references.add(input);
    else for (const value of Object.values(input as object)) references.add(value);
  }
  return collectNodes(material).filter(
    (node) =>
      (node as unknown as { isTextureNode?: boolean }).isTextureNode && !references.has(node)
  ).length;
};

const reachesVertexColor = (root: unknown) =>
  collectNodesFrom([root]).some(
    (node) => (node as unknown as { isVertexColorNode?: boolean }).isVertexColorNode
  );

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

  it("keeps the anti-tiling's uniforms of the layer's mode, the layer's own over the material's", () => {
    const dual = build({ layers: [{}], antiTiling: { mode: 'DUAL_SCALE', farScale: 0.3 } });
    const dualUniforms = dual.userData.uniforms as Record<string, { value: unknown }>;
    expect(getUniformKeys(dual)).toEqual(
      [...LAYER_UNIFORMS, 'terrain_l0_antiTilingDistance', 'terrain_l0_farScale'].sort()
    );
    expect(dualUniforms.terrain_l0_farScale.value).toBe(0.3);
    expect(dualUniforms.terrain_l0_antiTilingDistance.value).toEqual({ x: 6, y: 40 });
    const hex = build({
      layers: [{ antiTiling: { mode: 'HEX', hexRotation: 0.25 } }],
      antiTiling: { mode: 'DUAL_SCALE' },
    });
    expect(getUniformKeys(hex)).toEqual(
      [...LAYER_UNIFORMS, 'terrain_l0_hexContrast', 'terrain_l0_hexRotation'].sort()
    );
    expect(
      (hex.userData.uniforms as Record<string, { value: unknown }>).terrain_l0_hexRotation.value
    ).toBe(0.25);
    // HEX's taps take the UV's gradients; planar world tiling has no derivatives otherwise
    expect(countMethod(hex, 'dFdx')).toBeGreaterThan(0);
    expect(countMethod(dual, 'dFdx')).toBe(0);
  });

  it('fetches the macro texture once, varying the colour and roughness and feeding the patches', () => {
    const macroTexture = texture(new Texture());
    const isSampleOfMacro = (node: Node) =>
      (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
      (node as unknown as { value: unknown }).value === macroTexture.value &&
      node !== (macroTexture as unknown as Node);
    const withMacro = (antiTiling: unknown) =>
      build(
        { layers: [{}], macro: { scale: 120, brightness: 0.3 }, antiTiling },
        { layer0: makeBundle(), macro: macroTexture }
      );
    const material = withMacro({ mode: 'NONE' });
    expect(collectNodes(material).filter(isSampleOfMacro)).toHaveLength(1);
    const uniforms = material.userData.uniforms as Record<string, { value: unknown }>;
    expect(uniforms.terrain_macroScale.value).toBe(120);
    expect(uniforms.terrain_macroBrightness.value).toBe(0.3);
    expect(uniforms.terrain_macroHue.value).toBe(8);
    expect(uniforms.terrain_macroRoughness.value).toBe(0.15);
    // The colour and the roughness read it; the normal only through DUAL_SCALE's patches
    const reaches = (root: unknown) => collectNodesFrom([root]).some(isSampleOfMacro);
    expect(reaches(material.colorNode)).toBe(true);
    expect(reaches(material.roughnessNode)).toBe(true);
    expect(reaches(material.normalNode)).toBe(false);
    const dual = withMacro({ mode: 'DUAL_SCALE' });
    expect(reaches(dual.normalNode)).toBe(true);
    expect(collectNodes(dual).filter(isSampleOfMacro)).toHaveLength(1);
    // Without macro: no macro uniforms
    expect(getUniformKeys(build({ layers: [{}] })).some((key) => key.includes('macro'))).toBe(
      false
    );
  });

  it('wants the macro input with macro, and refuses it without', () => {
    expect(() => build({ layers: [{}], macro: { scale: 100 } })).toThrow(/Missing input "macro"/);
    expect(() =>
      build({ layers: [{}], macro: { scale: 100 } }, { layer0: makeBundle(), macro: makeBundle() })
    ).toThrow(/Missing input "macro"/);
    expect(() =>
      build({ layers: [{}] }, { layer0: makeBundle(), macro: texture(new Texture()) })
    ).toThrow(/Input "macro" has no macro/);
  });

  it('fades the normal only with distance, its range a uniform', () => {
    const geometryNormals = (material: MeshStandardNodeMaterial) =>
      collectNodesFrom([material.normalNode]).filter(
        (node) => node === (normalWorldGeometry as unknown as Node)
      ).length;
    const faded = build({ layers: [{}], distance: { fade: [40, 120] } });
    expect(
      (faded.userData.uniforms as Record<string, { value: unknown }>).terrain_distanceFade.value
    ).toEqual({ x: 40, y: 120 });
    // The planar frame reads the geometry normal; the fade reads it once more
    expect(geometryNormals(faded)).toBeGreaterThan(0);
    expect(countMethod(faded, 'smoothstep')).toBe(1);
    expect(countMethod(build({ layers: [{}] }), 'smoothstep')).toBe(0);
    expect(getUniformKeys(build({ layers: [{}] }))).not.toContain('terrain_distanceFade');
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

describe('setupTerrainMaterial: blending', () => {
  const vertexColor = (count: number, blend: Record<string, unknown> = {}) => ({
    layers: layersOf(count),
    blend: { source: 'VERTEX_COLOR', ...blend },
  });

  it('weighs the layers by the vertex colour, each slot sampled once, the height blend by default', () => {
    const inputs = layerInputs(5);
    const material = build(vertexColor(5, { vertexColor: { layout: 'RGBA' } }), inputs);
    expect(countSamples(material, inputs)).toBe(5 * 2);
    for (const socket of [material.colorNode, material.normalNode, material.roughnessNode]) {
      expect(reachesVertexColor(socket)).toBe(true);
    }
    const keys = getUniformKeys(material);
    expect(keys).toContain('terrain_heightBlendDepth');
    for (let i = 0; i < 5; i++) {
      expect(keys).toContain(`terrain_l${i}_heightContrast`);
      expect(keys).toContain(`terrain_l${i}_heightOffset`);
    }
    expect(getUniforms(material).terrain_heightBlendDepth.value).toBe(0.2);
    // RGBA has no vertex AO, LITE no texture AO
    expect(material.aoNode).toBeNull();
  });

  it('starts the height uniforms at the define, and builds none with LINEAR', () => {
    const define = {
      layers: [{ heightContrast: 2, heightOffset: -0.25 }, {}],
      blend: { source: 'SPLAT_MAP', heightBlendDepth: 0.05 },
    };
    const material = build(define, layerInputs(2, 'LITE', { splat0: texture(new Texture()) }));
    const uniforms = getUniforms(material);
    expect(uniforms.terrain_l0_heightContrast.value).toBe(2);
    expect(uniforms.terrain_l0_heightOffset.value).toBe(-0.25);
    expect(uniforms.terrain_heightBlendDepth.value).toBe(0.05);
    const linear = build(
      { ...define, blend: { source: 'SPLAT_MAP', mode: 'LINEAR' } },
      layerInputs(2, 'LITE', { splat0: texture(new Texture()) })
    );
    expect(getUniformKeys(linear).some((key) => key.includes('height'))).toBe(false);
    expect(reachesVertexColor(linear.colorNode)).toBe(false);
  });

  it('samples each splat map once at the mesh UV, as many as the layers take', () => {
    const inputs = layerInputs(9, 'LITE', {
      splat0: texture(new Texture()),
      splat1: texture(new Texture()),
    });
    const material = build({ layers: layersOf(9), blend: { source: 'SPLAT_MAP' } }, inputs);
    expect(countSamples(material, inputs)).toBe(9 * 2 + 2);
    expect(() =>
      build(
        { layers: layersOf(9), blend: { source: 'SPLAT_MAP' } },
        layerInputs(9, 'LITE', { splat0: texture(new Texture()) })
      )
    ).toThrow(/Missing input "splat1": a splat map's texture .* for layers 5-8/);
    expect(() =>
      build(
        { layers: layersOf(5), blend: { source: 'SPLAT_MAP' } },
        layerInputs(5, 'LITE', { splat0: texture(new Texture()), splat1: texture(new Texture()) })
      )
    ).toThrow(/Input "splat1" has no splat map: 5 layers take 1/);
    expect(() =>
      build(vertexColor(2), layerInputs(2, 'LITE', { splat0: texture(new Texture()) }))
    ).toThrow(/Input "splat0" has no splat map/);
    expect(() =>
      build(
        { layers: layersOf(2), blend: { source: 'SPLAT_MAP' } },
        layerInputs(2, 'LITE', { splat0: makeBundle() })
      )
    ).toThrow(/Missing input "splat0"/);
  });

  it("puts the vertex AO in aoNode, lowered on LITE's baked albedo, whole on FULL's", () => {
    const define = { ...vertexColor(2), ao: { vertex: true, bakedAlbedoInfluence: 0.3 } };
    const lite = build(define, layerInputs(2, 'LITE'));
    expect(reachesVertexColor(lite.aoNode)).toBe(true);
    expect(getUniforms(lite).terrain_aoVertexInfluence.value).toBe(0.3);
    expect(getUniformKeys(lite)).not.toContain('terrain_aoTextureInfluence');
    const full = build(define, layerInputs(2, 'FULL'));
    expect(getUniforms(full).terrain_aoVertexInfluence.value).toBe(1);
    expect(getUniformKeys(full)).toContain('terrain_aoTextureInfluence');
    // Without ao.vertex RGB_AO's A isn't AO: LITE has no aoNode
    const off = build(vertexColor(2), layerInputs(2, 'LITE'));
    expect(off.aoNode).toBeNull();
    expect(getUniformKeys(off)).not.toContain('terrain_aoVertexInfluence');
  });

  it('refuses layers in different packings', () => {
    expect(() =>
      build(vertexColor(2), { layer0: makeBundle('LITE'), layer1: makeBundle('FULL') })
    ).toThrow(/different packings \(layer0: LITE, layer1: FULL\)/);
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

  it('puts the splat maps in the inputs splat<i>, none in the define', () => {
    const props = getTerrainMaterialProps({
      id: 'valley',
      layers: Array.from({ length: 6 }, () => ({ set: 'grass01' })),
      blend: { source: 'SPLAT_MAP' },
      splatMaps: ['valley.splat0', 'valley.splat1'],
    });
    expect(props.staticDefines).toEqual({
      terrain: { layers: layersOf(6), blend: { source: 'SPLAT_MAP' } },
    });
    expect(props.inputs).toMatchObject({
      splat0: { texture: 'valley.splat0' },
      splat1: { texture: 'valley.splat1' },
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
