import { beforeEach, describe, expect, it, vi } from 'vitest';
import { color, int, normalWorldGeometry, texture, uniform, uniformArray } from 'three/tsl';
import { MeshStandardNodeMaterial, Texture, Vector2, Vector4, type Node } from 'three/webgpu';
import type { MatProps, TslMaterialFns } from 'aekasha';
import type { TextureSetArrayInput, TextureSetInput } from 'aekasha/texturesets';
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

/** A `{ textureSetArray }` bundle of the packing's slot arrays, its params and layer count */
const makeArrayBundle = (count: number, packing: Packing = 'LITE') =>
  ({
    ...Object.fromEntries(PACKING_SLOTS[packing].map((slot) => [slot, texture(new Texture())])),
    layerParams: uniformArray(
      Array.from({ length: count * 4 }, () => new Vector4(3, 3, 0.05, 1)),
      'vec4'
    ),
    layerCount: int(count),
  }) as unknown as TextureSetArrayInput;

/** The kernel's TSL path in short: the registered setup over the props' inputs as bundles */
const stubs = vi.hoisted(() => ({
  registered: new Map<string, unknown>(),
  created: [] as { props: unknown; material: unknown }[],
  materials: new Map<string, MeshStandardNodeMaterial>(),
  variants: [] as { id: string; overrides: unknown }[],
  warnings: [] as string[],
  renderer: null as unknown,
  sets: {} as Record<string, { defaultPacking: string }>,
}));

vi.mock('aekasha/texturesets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha/texturesets')>()),
  getTextureSet: (id: string) => stubs.sets[id],
}));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  IS_DEBUG_ENV: true,
  getRenderer: () => stubs.renderer,
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
        key === 'layers'
          ? makeArrayBundle(
              (tsl.inputs.layers as { textureSetArray: string[] }).textureSetArray.length
            )
          : key.startsWith('layer')
            ? makeBundle()
            : texture(new Texture()),
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
    ).toThrow(/Input "macro" has no use/);
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
    expect(() => build({ layers: [{}], colorMap: {} })).toThrow(/has no field "colorMap"/);
    expect(() => build(undefined)).toThrow(/Missing static define "terrain"/);
  });
});

describe('setupTerrainMaterial: projection', () => {
  it("keeps a projected layer's sharpness, a planar one's none", () => {
    expect(getUniformKeys(build({ layers: [{}], projection: { mode: 'PLANAR' } }))).toEqual(
      LAYER_UNIFORMS
    );
    for (const [mode, sharpness] of [
      ['BIPLANAR', 8],
      ['TRIPLANAR', 4],
    ] as const) {
      const material = build({ layers: [{}], projection: { mode } });
      expect(getUniformKeys(material)).toEqual(
        [...LAYER_UNIFORMS, 'terrain_l0_projectionSharpness'].sort()
      );
      expect(getUniforms(material).terrain_l0_projectionSharpness.value).toBe(sharpness);
    }
  });

  it("samples each plane's slots, a layer's own projection over the material's", () => {
    const inputs = layerInputs(2);
    const define = { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' } };
    expect(countSamples(build(define, inputs), inputs)).toBe(2 * 2);
    const triplanar = { ...define, projection: { mode: 'TRIPLANAR' } };
    expect(countSamples(build(triplanar, inputs), inputs)).toBe(2 * 2 * 3);
    const cliffsOnly = { ...triplanar, layers: [{ projection: { mode: 'PLANAR' } }, {}] };
    expect(countSamples(build(cliffsOnly, inputs), inputs)).toBe(2 + 2 * 3);
    const biplanar = { ...define, layers: [{}, { projection: { mode: 'BIPLANAR' } }] };
    expect(countSamples(build(biplanar, inputs), inputs)).toBe(2 + 2 * 2);
  });

  it('keeps a slope gate as a uniform, sampling the planar tap outside its branch', () => {
    const inputs = layerInputs(1);
    const gated = build(
      { layers: [{}], projection: { mode: 'TRIPLANAR', slopeGate: [35, 55] } },
      inputs
    );
    expect(getUniformKeys(gated)).toEqual(
      [...LAYER_UNIFORMS, 'terrain_l0_projectionSharpness', 'terrain_l0_slopeGate'].sort()
    );
    expect(getUniforms(gated).terrain_l0_slopeGate.value).toEqual(new Vector2(35, 55));
    // The sockets read the gate's var: its branch builds with the shader (SlopeGate.test.ts)
    expect(countSamples(gated, inputs)).toBe(0);
    expect(getUniformKeys(build({ layers: [{}], projection: { mode: 'BIPLANAR' } }))).not.toContain(
      'terrain_l0_slopeGate'
    );
  });

  it('builds the normal from the planes, a planar frame for none of them', () => {
    // Planar world tiling's frame takes no derivative; the projection takes the position's two
    expect(countMethod(build({ layers: [{}] }), 'dFdx')).toBe(0);
    const material = build({ layers: [{}], projection: { mode: 'TRIPLANAR' } });
    expect(countMethod(material, 'dFdx')).toBe(1);
    expect(countMethod(material, 'dFdy')).toBe(1);
    // MINIMAL bumps the planes' blended height: its own two derivatives besides
    const inputs = { layer0: makeBundle('MINIMAL') };
    const minimal = build({ layers: [{}], projection: { mode: 'TRIPLANAR' } }, inputs);
    expect(countSamples(minimal, inputs)).toBe(3);
    expect(countMethod(minimal, 'dFdx')).toBe(3);
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
    const inputs = {
      layers: makeArrayBundle(9),
      splat0: texture(new Texture()),
      splat1: texture(new Texture()),
    };
    const material = build({ layers: layersOf(9), blend: { source: 'SPLAT_MAP' } }, inputs);
    expect(countSamples(material, inputs)).toBe(9 * 2 + 2);
    expect(() =>
      build(
        { layers: layersOf(9), blend: { source: 'SPLAT_MAP' } },
        { layers: makeArrayBundle(9), splat0: texture(new Texture()) }
      )
    ).toThrow(/Missing input "splat1": a splat map's texture .* for layers 5-8/);
    expect(() =>
      build(
        { layers: layersOf(5), blend: { source: 'SPLAT_MAP' } },
        layerInputs(5, 'LITE', { splat0: texture(new Texture()), splat1: texture(new Texture()) })
      )
    ).toThrow(/Input "splat1" has no splat map: 5 painted layers take 1/);
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

describe('setupTerrainMaterial: rules', () => {
  const rocks = { layer: 1, slope: { min: 35 } };
  const snow = { layer: 2, height: { min: 40 }, aspect: { direction: [0, -1], range: 60 } };
  const isSampleOf = (map: unknown) => (node: Node) =>
    (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
    (node as unknown as { value: unknown }).value === (map as { value: unknown }).value &&
    node !== map;

  it('lays the rules over the base layer, their uniforms per rule, nothing painted read', () => {
    const inputs = layerInputs(3);
    const material = build(
      {
        layers: layersOf(3),
        blend: { source: 'RULES', rules: [rocks, { ...snow, strength: 0.8 }] },
      },
      inputs
    );
    expect(countSamples(material, inputs)).toBe(3 * 2);
    expect(reachesVertexColor(material.colorNode)).toBe(false);
    const keys = getUniformKeys(material).filter((key) => key.startsWith('terrain_r'));
    expect(keys).toEqual([
      'terrain_r0_slopeMin',
      'terrain_r0_slopeSoftness',
      'terrain_r0_strength',
      'terrain_r1_aspectDirection',
      'terrain_r1_aspectRange',
      'terrain_r1_aspectSoftness',
      'terrain_r1_heightMin',
      'terrain_r1_heightSoftness',
      'terrain_r1_strength',
    ]);
    const uniforms = getUniforms(material);
    expect(uniforms.terrain_r0_slopeMin.value).toBe(35);
    expect(uniforms.terrain_r0_slopeSoftness.value).toBe(5);
    expect(uniforms.terrain_r1_strength.value).toBe(0.8);
    // The height blend by default
    expect(getUniformKeys(material)).toContain('terrain_heightBlendDepth');
    // The colour, normal and roughness all follow the rules' weights
    for (const socket of [material.colorNode, material.normalNode, material.roughnessNode]) {
      expect(collectNodesFrom([socket]).includes(uniforms.terrain_r0_slopeMin as never)).toBe(true);
    }
  });

  it("reads the paint's channels for its layers only, a rule's layer past them", () => {
    const define = {
      layers: layersOf(6),
      blend: {
        source: 'VERTEX_COLOR_AND_RULES',
        vertexColor: { layout: 'RGBA' },
        rules: [{ layer: 5, slope: { min: 50 } }],
      },
    };
    const material = build(define, { layers: makeArrayBundle(6) });
    expect(reachesVertexColor(material.colorNode)).toBe(true);
    const swizzles = collectNodes(material)
      .filter((node) =>
        node
          .getChildren()
          .some((child) => (child as unknown as { isVertexColorNode?: boolean }).isVertexColorNode)
      )
      .map((node) => (node as unknown as { components?: string }).components)
      .filter(Boolean)
      .sort();
    // RGBA weighs layers 1-4; layer 5 is the rule's
    expect(swizzles).toEqual(['w', 'x', 'y', 'z']);
    const splat = {
      layers: layersOf(10),
      blend: { source: 'SPLAT_MAP_AND_RULES', rules: [{ layer: 9, slope: { min: 50 } }] },
    };
    const splatInputs = {
      layers: makeArrayBundle(10),
      splat0: texture(new Texture()),
      splat1: texture(new Texture()),
    };
    expect(countSamples(build(splat, splatInputs), splatInputs)).toBe(10 * 2 + 2);
    // Three painted layers: one map, the other three layers the rules'
    const fewer = {
      layers: layersOf(6),
      blend: {
        source: 'SPLAT_MAP_AND_RULES',
        paintedLayers: 3,
        rules: [3, 4, 5].map((layer) => ({ layer, slope: { min: layer * 10 } })),
      },
    };
    const fewerInputs = { layers: makeArrayBundle(6), splat0: texture(new Texture()) };
    expect(countSamples(build(fewer, fewerInputs), fewerInputs)).toBe(6 * 2 + 1);
  });

  it("samples the macro input once per rule with noise, besides the macro's own fetch", () => {
    const macroTexture = texture(new Texture());
    const noisy = { ...rocks, noise: { scale: 30, amount: 0.4, channel: 'A' } };
    const rules = {
      source: 'RULES',
      rules: [noisy, { ...snow, noise: { scale: 90, amount: 0.2 } }],
    };
    const material = build(
      { layers: layersOf(3), blend: rules },
      layerInputs(3, 'LITE', { macro: macroTexture })
    );
    expect(collectNodes(material).filter(isSampleOf(macroTexture))).toHaveLength(2);
    expect(getUniforms(material).terrain_r0_noiseScale.value).toBe(30);
    const withMacro = build(
      { layers: layersOf(3), blend: rules, macro: { scale: 120 } },
      layerInputs(3, 'LITE', { macro: macroTexture })
    );
    expect(collectNodes(withMacro).filter(isSampleOf(macroTexture))).toHaveLength(3);
    expect(() => build({ layers: layersOf(3), blend: rules }, layerInputs(3))).toThrow(
      /Missing input "macro"/
    );
  });

  it("takes a tier's rules, and keeps the macro input a tier's noise needs", () => {
    const macroTexture = texture(new Texture());
    const noisy = { ...rocks, noise: { scale: 30, amount: 0.4 } };
    const define = {
      layers: layersOf(2),
      blend: { source: 'RULES', rules: [rocks] },
      quality: { ULTRA: { blend: { source: 'RULES', rules: [noisy] } } },
    };
    const inputs = layerInputs(2, 'LITE', { macro: macroTexture });
    const base = build(define, inputs);
    expect(collectNodes(base).filter(isSampleOf(macroTexture))).toHaveLength(0);
    const ultra = build({ ...define, qualityLevel: 'ULTRA' }, inputs);
    expect(collectNodes(ultra).filter(isSampleOf(macroTexture))).toHaveLength(1);
  });

  it('counts the noise texture in the budget', () => {
    stubs.renderer = null;
    const rules = { source: 'RULES', rules: [{ ...rocks, noise: { scale: 30, amount: 0.4 } }] };
    // FULL: 3 slots a layer, 3 layers = 9 + the noise texture = 10, the budget 16 - 6
    const define = {
      layers: layersOf(3),
      blend: { ...rules, rules: [...rules.rules, { layer: 2, slope: { max: 5 } }] },
    };
    expect(() =>
      build(define, layerInputs(3, 'FULL', { macro: texture(new Texture()) }))
    ).not.toThrow();
    expect(() =>
      build(
        { ...define, reservedTextures: 7 },
        layerInputs(3, 'FULL', { macro: texture(new Texture()) })
      )
    ).toThrow(/macro/);
  });
});

describe('setupTerrainMaterial: storage', () => {
  beforeEach(() => {
    stubs.renderer = null;
  });

  /** The sockets' samples of an array's slots, each with its layer (`.depth()`) */
  const getArraySamples = (material: MeshStandardNodeMaterial, bundle: TextureSetArrayInput) => {
    const arrays = new Set(Object.values(bundle));
    return collectNodes(material).filter(
      (node) =>
        (node as unknown as { isTextureNode?: boolean }).isTextureNode && !arrays.has(node as never)
    ) as unknown as { depthNode: { value: number } | null }[];
  };

  it('samples every layer from the one set array, each at its layer, with the same uniforms', () => {
    const bundle = makeArrayBundle(3);
    const define = { layers: layersOf(3), blend: { source: 'VERTEX_COLOR' } };
    const material = build(define, { layers: bundle });
    const samples = getArraySamples(material, bundle);
    expect(samples).toHaveLength(3 * 2);
    expect(samples.map((sample) => sample.depthNode?.value).sort()).toEqual([0, 0, 1, 1, 2, 2]);
    expect(getUniformKeys(material)).toEqual(getUniformKeys(build(define, layerInputs(3))));
    // The array's params, not a set's uniforms: they read its uniform array
    const params = (bundle as unknown as { layerParams: Node }).layerParams;
    expect(collectNodesFrom([material.colorNode]).includes(params)).toBe(true);
  });

  it('takes anti-tiling taps from the array at the layer', () => {
    const bundle = makeArrayBundle(2);
    const material = build(
      { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' }, antiTiling: { mode: 'HEX' } },
      { layers: bundle }
    );
    const samples = getArraySamples(material, bundle);
    expect(samples).toHaveLength(2 * 2 * 3);
    expect(samples.every((sample) => sample.depthNode)).toBe(true);
  });

  it("takes a projection's planes from the array at the layer", () => {
    const bundle = makeArrayBundle(2);
    const material = build(
      {
        layers: [{}, { projection: { mode: 'TRIPLANAR' } }],
        blend: { source: 'VERTEX_COLOR' },
      },
      { layers: bundle }
    );
    const samples = getArraySamples(material, bundle);
    expect(samples).toHaveLength(2 + 2 * 3);
    expect(samples.filter((sample) => sample.depthNode?.value === 1)).toHaveLength(2 * 3);
  });

  it('refuses both storages at once, a non-array layers input and another layer count', () => {
    const define = { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' } };
    expect(() => build(define, { layers: makeArrayBundle(2), layer0: makeBundle() })).toThrow(
      /Inputs "layers" .* and "layer0" .* are both given/
    );
    expect(() => build(define, { layers: makeBundle() })).toThrow(
      /Input "layers" isn't a texture set array/
    );
    expect(() => build(define, { layers: makeArrayBundle(3) })).toThrow(
      /Input "layers" has 3 layers, staticDefines.terrain.layers 2/
    );
  });

  it("throws over the texture budget, naming what's bound, by the renderer's limit", () => {
    const define = { layers: layersOf(4), blend: { source: 'VERTEX_COLOR' } };
    // 4 FULL layers: 12 textures, over 16 less 6
    expect(() => build(define, layerInputs(4, 'FULL'))).toThrow(
      '[terrain] The material binds 12 textures, over its budget of 10 (16 a stage less 6 reserved): layer0-layer3 (albedoHeight, normal, orm each): 12. Try ARRAY storage'
    );
    expect(() => build({ ...define, reservedTextures: 4 }, layerInputs(4, 'FULL'))).not.toThrow();
    stubs.renderer = {
      backend: {
        isWebGPUBackend: true,
        device: { limits: { maxSampledTexturesPerShaderStage: 32, maxSamplersPerShaderStage: 20 } },
      },
    };
    expect(() => build(define, layerInputs(4, 'FULL'))).not.toThrow();
    stubs.renderer = null;
    // An array binds its slots, then the splat maps and the macro texture count
    const splat = { layers: layersOf(9), blend: { source: 'SPLAT_MAP' }, macro: { scale: 50 } };
    const inputs = {
      layers: makeArrayBundle(9, 'FULL'),
      splat0: texture(new Texture()),
      splat1: texture(new Texture()),
      macro: texture(new Texture()),
    };
    expect(() => build({ ...splat, reservedTextures: 11 }, inputs)).toThrow(
      'binds 6 textures, over its budget of 5 (16 a stage less 11 reserved): layers (arrays albedoHeight, normal, orm): 3; splat maps: 2; macro: 1. Try fewer splat maps'
    );
    expect(() => build({ ...splat, reservedTextures: 10 }, inputs)).not.toThrow();
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

  it("binds ARRAY storage as one set array input, its packing given or the sets' default", () => {
    stubs.sets = { grass01: { defaultPacking: 'LITE' }, rocks01: { defaultPacking: 'LITE' } };
    const layers = [{ set: 'grass01' }, { set: 'rocks01' }];
    const config = { id: 'a', layers, blend: { source: 'VERTEX_COLOR' as const } };
    const arrayProps = getTerrainMaterialProps({ ...config, storage: 'ARRAY' });
    expect(arrayProps.inputs).toEqual({
      layers: { textureSetArray: ['grass01', 'rocks01'], packing: 'LITE' },
    });
    expect(arrayProps.staticDefines).toEqual({
      terrain: { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' } },
    });
    expect(
      getTerrainMaterialProps({ ...config, storage: 'ARRAY', packing: 'FULL' }).inputs
    ).toEqual({ layers: { textureSetArray: ['grass01', 'rocks01'], packing: 'FULL' } });
    expect(getTerrainMaterialProps({ ...config, storage: 'SEPARATE' }).inputs).toEqual({
      layer0: { textureSet: 'grass01' },
      layer1: { textureSet: 'rocks01' },
    });
    stubs.sets.rocks01 = { defaultPacking: 'FULL' };
    expect(() => getTerrainMaterialProps({ ...config, storage: 'ARRAY' })).toThrow(
      /default packings differ \(grass01: LITE, rocks01: FULL\)/
    );
    expect(() =>
      getTerrainMaterialProps({
        ...config,
        layers: [{ set: 'nothing' }, ...layers],
        storage: 'ARRAY',
      })
    ).toThrow(/no data has the texture set "nothing"/);
  });

  it('chooses ARRAY for AUTO only over the budget', () => {
    stubs.renderer = null;
    stubs.sets = { grass01: { defaultPacking: 'LITE' } };
    const of = (count: number) => Array.from({ length: count }, () => ({ set: 'grass01' }));
    const config = (count: number, extra = {}) => ({
      id: 'auto',
      layers: of(count),
      blend: { source: 'SPLAT_MAP' as const },
      splatMaps: count > 5 ? ['s0', 's1'] : ['s0'],
      ...extra,
    });
    // 5 LITE layers and a splat map: 11 textures, over 10
    expect(getTerrainMaterialProps(config(4)).inputs).toHaveProperty('layer3');
    expect(getTerrainMaterialProps(config(5)).inputs).toHaveProperty('layers');
    expect(getTerrainMaterialProps(config(5, { reservedTextures: 5 })).inputs).toHaveProperty(
      'layer4'
    );
    expect(getTerrainMaterialProps(config(5, { packing: 'MINIMAL' })).inputs).toHaveProperty(
      'layer4'
    );
  });

  it('chooses ARRAY for AUTO where the layers sample in slots, its own or a tier', () => {
    stubs.renderer = null;
    stubs.sets = { grass01: { defaultPacking: 'LITE' } };
    const config = (fields = {}) => ({
      id: 'slots',
      layers: Array.from({ length: 3 }, () => ({ set: 'grass01' })),
      blend: { source: 'VERTEX_COLOR' as const },
      ...fields,
    });
    expect(getTerrainMaterialProps(config()).inputs).toHaveProperty('layer2');
    const sparse = { sparse: { maxLayers: 2 } };
    expect(getTerrainMaterialProps(config(sparse)).inputs).toHaveProperty('layers');
    // Keeping every layer: no slots
    expect(getTerrainMaterialProps(config({ sparse: { maxLayers: 3 } })).inputs).toHaveProperty(
      'layer2'
    );
    expect(getTerrainMaterialProps(config({ quality: { LOW: sparse } })).inputs).toHaveProperty(
      'layers'
    );
    const dominant = { antiTiling: { mode: 'HEX' as const, apply: 'DOMINANT' as const } };
    expect(getTerrainMaterialProps(config(dominant)).inputs).toHaveProperty('layers');
  });

  it('puts the splat maps in the inputs splat<i>, none in the define', () => {
    const props = getTerrainMaterialProps({
      id: 'valley',
      layers: Array.from({ length: 6 }, () => ({ set: 'grass01' })),
      blend: { source: 'SPLAT_MAP' },
      splatMaps: ['valley.splat0', 'valley.splat1'],
      storage: 'SEPARATE',
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

  it("gives rule noise the macro's texture, else noiseTexture or macroNoise, and none without noise", () => {
    const layers = [{ set: 'grass01' }, { set: 'snow01' }];
    const noisy = { layer: 1, height: { min: 4 }, noise: { scale: 40, amount: 0.4 } };
    const rules = (rule: object) => ({ source: 'RULES' as const, rules: [rule] as never });
    const inputsOf = (config: object) =>
      getTerrainMaterialProps({ id: 'ridge', layers, storage: 'SEPARATE', ...config }).inputs;
    expect(inputsOf({ blend: rules({ layer: 1, height: { min: 4 } }) })).not.toHaveProperty(
      'macro'
    );
    expect(inputsOf({ blend: rules(noisy) })).toHaveProperty('macro', { texture: 'macroNoise' });
    expect(inputsOf({ blend: rules(noisy), noiseTexture: 'ridge.noise' })).toHaveProperty('macro', {
      texture: 'ridge.noise',
    });
    expect(
      inputsOf({ blend: rules(noisy), macro: { texture: 'macroNoise.data', scale: 90 } })
    ).toHaveProperty('macro', { texture: 'macroNoise.data' });
    // A tier's noise: the tier's variant shares the material's inputs
    const tiered = inputsOf({
      blend: rules({ layer: 1, height: { min: 4 } }),
      quality: { ULTRA: { blend: rules(noisy) } },
    });
    expect(tiered).toHaveProperty('macro', { texture: 'macroNoise' });
    expect(
      getTerrainMaterialProps({ id: 'ridge', layers, blend: rules(noisy), noiseTexture: 'x' })
        .staticDefines
    ).toEqual({ terrain: { layers: [{}, {}], blend: rules(noisy) } });
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
    for (const debugView of ['TEXEL_DENSITY', 'NORMALS', 'WEIGHTS']) {
      const material = build({ layers: [{}], debugView }, { layer0: makeBundle('FULL') });
      expect(material.emissiveNode, debugView).toBeTruthy();
      expect(material.aoNode).toBeNull();
    }
    expect(countMethod(build({ layers: [{}], debugView: 'TEXEL_DENSITY' }), 'log2')).toBe(1);
    // Blended: each layer's density, and the final weights' false colours
    const blended = { layers: layersOf(3), blend: { source: 'VERTEX_COLOR' } };
    const density = build({ ...blended, debugView: 'TEXEL_DENSITY' }, layerInputs(3));
    expect(countMethod(density, 'log2')).toBe(3);
    const weights = build({ ...blended, debugView: 'WEIGHTS' }, layerInputs(3));
    expect(reachesVertexColor(weights.emissiveNode)).toBe(true);
    const arrayWeights = build(
      { ...blended, debugView: 'WEIGHTS' },
      { layers: makeArrayBundle(3) }
    );
    expect(arrayWeights.emissiveNode).toBeTruthy();
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
