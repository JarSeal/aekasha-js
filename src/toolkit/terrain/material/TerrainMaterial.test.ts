import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  color,
  int,
  modelWorldMatrix,
  normalWorldGeometry,
  positionLocal,
  positionWorld,
  texture,
  uniform,
  uniformArray,
} from 'three/tsl';
import { MeshStandardNodeMaterial, Texture, Vector2, Vector4, type Node } from 'three/webgpu';
import type { MatProps, TslMaterialFns } from 'aekasha';
import type { TextureSetArrayInput, TextureSetInput } from 'aekasha/texturesets';
import { defineSurfaceGenerator } from '../procedural/SurfaceGenerator';
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

/**
 * A `{ textureSet }` bundle of the packing's slots and the set's uniforms (with `averageColor`, its
 * average colour's)
 */
const makeBundle = (packing: Packing = 'LITE', { averageColor = false } = {}) =>
  ({
    ...(averageColor ? { averageColor: uniform(color(0.4, 0.3, 0.2)) } : {}),
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
    puddleResponse: uniform(0.5),
    dryingSpeed: uniform(1),
  }) as unknown as TextureSetInput;

/** A `{ textureSetArray }` bundle of the packing's slot arrays, its params and layer count */
const makeArrayBundle = (count: number, packing: Packing = 'LITE') =>
  ({
    ...Object.fromEntries(PACKING_SLOTS[packing].map((slot) => [slot, texture(new Texture())])),
    layerParams: uniformArray(
      Array.from({ length: count * 5 }, () => new Vector4(3, 3, 0.05, 1)),
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
  logs: [] as string[],
  renderer: null as unknown,
  sets: {} as Record<string, { defaultPacking: string }>,
  // A live layer's bundle's set, and the loaded generators (p305 Phase 8)
  setsOfInputs: new Map<object, unknown>(),
  generators: new Map<string, unknown>(),
  // The surface conditions' uniforms (p307), null without the feature
  conditions: null as unknown,
}));

vi.mock('aekasha/surface', () => ({
  getSurfaceConditionNodes: () => stubs.conditions,
}));

vi.mock('aekasha/texturesets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha/texturesets')>()),
  getTextureSet: (id: string) => stubs.sets[id],
  getTextureSetOfInput: (bundle: object) => stubs.setsOfInputs.get(bundle),
  getTextureSetGenerator: (id: string) => stubs.generators.get(id),
}));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  IS_DEBUG_ENV: true,
  getRenderer: () => stubs.renderer,
  lwarn: (message: string) => stubs.warnings.push(message),
  llog: (message: string) => stubs.logs.push(message),
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

  it('wants the colour map input with a colour map, and refuses it without', () => {
    const colorMap = { mode: 'DETAIL' };
    const layer0 = makeBundle('LITE', { averageColor: true });
    expect(() => build({ layers: [{}], colorMap }, { layer0 })).toThrow(/Missing input "colorMap"/);
    expect(() => build({ layers: [{}], colorMap }, { layer0, colorMap: makeBundle() })).toThrow(
      /Missing input "colorMap"/
    );
    expect(() =>
      build({ layers: [{}] }, { layer0: makeBundle(), colorMap: texture(new Texture()) })
    ).toThrow(/Input "colorMap" has no use/);
    expect(() =>
      build({ layers: [{}], colorMap }, { layer0, colorMap: texture(new Texture()) })
    ).not.toThrow();
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
    expect(() => build({ layers: [{}], weather: {} })).toThrow(/has no field "weather"/);
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

describe('setupTerrainMaterial: colour map', () => {
  /** The colour map's samples among the nodes the roots reach */
  const colorMapSamples = (roots: unknown[], map: unknown) =>
    collectNodesFrom(roots).filter(
      (node) =>
        (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
        node !== map &&
        (node as unknown as { value: unknown }).value === (map as { value: unknown }).value
    );

  it("gives the albedo the colour map × the layers' detail over their average colours", () => {
    const map = texture(new Texture());
    const bundles = [0, 1].map(() => makeBundle('LITE', { averageColor: true }));
    const material = build(
      {
        layers: layersOf(2),
        blend: { source: 'VERTEX_COLOR' },
        colorMap: { mode: 'DETAIL' },
        macro: { scale: 100 },
      },
      { layer0: bundles[0], layer1: bundles[1], colorMap: map, macro: texture(new Texture()) }
    );
    expect(colorMapSamples([material.colorNode], map)).toHaveLength(1);
    expect(colorMapSamples([material.normalNode, material.roughnessNode], map)).toHaveLength(0);
    const colorNodes = collectNodesFrom([material.colorNode]);
    for (const bundle of bundles) {
      expect(colorNodes).toContain(bundle.averageColor);
      // The colour map carries the colour: no tint, the set's or the layer's
      expect(colorNodes).not.toContain(bundle.tint);
    }
    const uniforms = getUniforms(material);
    expect(colorNodes).not.toContain(uniforms.terrain_l0_tint);
    // The macro varies the roughness, not the colour map's colour (its variation is baked in)
    expect(colorNodes).not.toContain(uniforms.terrain_macroBrightness);
    expect(collectNodesFrom([material.roughnessNode])).toContain(uniforms.terrain_macroRoughness);
    expect(getUniformKeys(material)).not.toContain('terrain_detailDistance');
  });

  it('fades the detail out over detailDistance, a uniform', () => {
    const material = build(
      { layers: [{}], colorMap: { mode: 'DETAIL', detailDistance: [20, 60] } },
      { layer0: makeBundle('LITE', { averageColor: true }), colorMap: texture(new Texture()) }
    );
    const range = getUniforms(material).terrain_detailDistance;
    expect(range.value).toEqual(new Vector2(20, 60));
    expect(collectNodesFrom([material.colorNode])).toContain(range);
  });

  it("reads a set array layer's average colour, and refuses a set without one", () => {
    const define = {
      layers: layersOf(2),
      blend: { source: 'VERTEX_COLOR' },
      colorMap: { mode: 'DETAIL' },
    };
    const map = texture(new Texture());
    expect(() => build(define, { layers: makeArrayBundle(2), colorMap: map })).not.toThrow();
    expect(() =>
      build(define, {
        layer0: makeBundle('LITE', { averageColor: true }),
        layer1: makeBundle(),
        colorMap: map,
      })
    ).toThrow(
      /Input "layer1": its texture set has no averageColor, which the DETAIL colour map's detail reads/
    );
    // Without the detail, a set needs none
    expect(() => build({ ...define, colorMap: undefined }, layerInputs(2))).not.toThrow();
  });

  it("samples the colour map in slots too, each slot its layer's average colour", () => {
    const map = texture(new Texture());
    const material = build(
      {
        layers: layersOf(4),
        blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
        sparse: { maxLayers: 2 },
        colorMap: { mode: 'DETAIL' },
      },
      { layers: makeArrayBundle(4), colorMap: map }
    );
    expect(colorMapSamples([material.colorNode], map)).toHaveLength(1);
  });
});

describe('setupTerrainMaterial: space', () => {
  const reaches = (root: unknown, node: unknown) => collectNodesFrom([root]).includes(node as Node);

  it("samples in the mesh's own space with OBJECT, its normal into world space through the model", () => {
    const define = {
      layers: [{ projection: { mode: 'TRIPLANAR' } }],
      space: 'OBJECT',
      macro: { scale: 12 },
      distance: { fade: [20, 60] },
    };
    const material = build(define, { layer0: makeBundle(), macro: texture(new Texture()) });
    for (const socket of [material.colorNode, material.normalNode]) {
      expect(reaches(socket, positionLocal)).toBe(true);
      expect(reaches(socket, positionWorld)).toBe(false);
    }
    expect(reaches(material.normalNode, modelWorldMatrix)).toBe(true);
    // The world's: no conversion
    const world = build(
      { ...define, space: undefined },
      {
        layer0: makeBundle(),
        macro: texture(new Texture()),
      }
    );
    expect(reaches(world.colorNode, positionWorld)).toBe(true);
    expect(reaches(world.normalNode, modelWorldMatrix)).toBe(false);
  });

  it("measures the rules in the mesh's own space", () => {
    const define = {
      layers: layersOf(2),
      space: 'OBJECT',
      blend: { source: 'RULES', rules: [{ layer: 1, height: { min: 2 } }] },
    };
    const material = build(define, layerInputs(2));
    expect(reaches(material.colorNode, positionLocal)).toBe(true);
    expect(reaches(material.colorNode, positionWorld)).toBe(false);
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

  it('refuses a non-array layers input, another layer count, and an array no layer takes', () => {
    const define = { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' } };
    expect(() => build(define, { layers: makeBundle() })).toThrow(
      /Input "layers" isn't a texture set array/
    );
    expect(() => build(define, { layers: makeArrayBundle(3) })).toThrow(
      /Input "layers" has 3 layers, and 2 layers take theirs from it/
    );
    // A layer with its own input takes none of the array's (D9's mixed sources)
    expect(() => build(define, { layers: makeArrayBundle(2), layer0: makeBundle() })).toThrow(
      /Input "layers" has 2 layers, and 1 layers take theirs from it/
    );
    expect(() =>
      build(define, { layers: makeArrayBundle(1), layer0: makeBundle(), layer1: makeBundle() })
    ).toThrow(/Input "layers" has no layer to hold/);
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
    // The colour map counts too
    const colorMapped = { ...splat, colorMap: { mode: 'DETAIL' }, reservedTextures: 10 };
    expect(() => build(colorMapped, { ...inputs, colorMap: texture(new Texture()) })).toThrow(
      'macro: 1; colour map: 1. Try fewer splat maps, no macro texture or no colour map'
    );
  });
});

describe('setupTerrainMaterial: slots', () => {
  beforeEach(() => {
    stubs.renderer = null;
  });

  /** The sockets' samples of an array's slots, with their layer and gradients */
  const getSlotSamples = (material: MeshStandardNodeMaterial, bundle: TextureSetArrayInput) => {
    const arrays = new Set(Object.values(bundle));
    return collectNodes(material).filter(
      (node) =>
        (node as unknown as { isTextureNode?: boolean }).isTextureNode && !arrays.has(node as never)
    ) as unknown as { depthNode: { isVarNode?: boolean } | null; gradNode: unknown }[];
  };

  const painted = (count: number, fields: object = {}) => ({
    layers: layersOf(count),
    blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
    ...fields,
  });

  it("samples the kept slots only, each at its slot's layer with the coordinates' gradients", () => {
    const bundle = makeArrayBundle(4);
    const define = painted(4, { sparse: { maxLayers: 2 } });
    const material = build(define, { layers: bundle });
    const samples = getSlotSamples(material, bundle);
    expect(samples).toHaveLength(2 * 2);
    expect(samples.every((sample) => sample.depthNode?.isVarNode && sample.gradNode)).toBe(true);
    // Every layer's uniforms, which the slots pick from
    expect(getUniformKeys(material)).toEqual(
      getUniformKeys(build(painted(4), { layers: makeArrayBundle(4) }))
    );
  });

  it('refuses slots without the set array', () => {
    expect(() => build(painted(3, { sparse: { maxLayers: 2 } }), layerInputs(3))).toThrow(
      /needs ARRAY storage/
    );
  });

  it('samples HEX in the first slot and DUAL_SCALE in the others with DOMINANT', () => {
    const bundle = makeArrayBundle(3);
    const dominant = { mode: 'HEX', apply: 'DOMINANT' };
    const material = build(painted(3, { antiTiling: dominant }), { layers: bundle });
    // LITE: 3 HEX taps of 2 slots, then 2 DUAL_SCALE taps in each of 2 slots
    expect(getSlotSamples(material, bundle)).toHaveLength(3 * 2 + 2 * 2 * 2);
    expect(getUniformKeys(material)).toEqual(
      expect.arrayContaining(['terrain_l2_hexContrast', 'terrain_l2_farScale'])
    );
    const sparse = build(painted(3, { antiTiling: dominant, sparse: { maxLayers: 2 } }), {
      layers: bundle,
    });
    expect(getSlotSamples(sparse, bundle)).toHaveLength(3 * 2 + 2 * 2);
  });

  it("projects every slot as the projected layers do, a planar layer's gate closed", () => {
    const bundle = makeArrayBundle(3);
    const triplanar = { projection: { mode: 'TRIPLANAR' } };
    const projected = build(painted(3, { ...triplanar, sparse: { maxLayers: 2 } }), {
      layers: bundle,
    });
    expect(getSlotSamples(projected, bundle)).toHaveLength(2 * 3 * 2);
    // A planar layer among projected ones: every slot gated (its branch builds with the shader)
    const mixed = build(
      painted(3, {
        sparse: { maxLayers: 2 },
        layers: [{}, triplanar, { projection: { mode: 'TRIPLANAR', slopeGate: [30, 50] } }],
      }),
      { layers: bundle }
    );
    expect(getSlotSamples(mixed, bundle)).toHaveLength(0);
    expect(getUniformKeys(mixed)).toEqual(
      expect.arrayContaining(['terrain_l1_projectionSharpness', 'terrain_l2_slopeGate'])
    );
  });

  it("bumps MINIMAL's blended height once, not each slot's", () => {
    const bundle = makeArrayBundle(3, 'MINIMAL');
    const material = build(painted(3, { sparse: { maxLayers: 2 } }), { layers: bundle });
    // The coordinates' gradients, then the bump's position and height
    expect(countMethod(material, 'dFdx')).toBe(3);
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

  it('puts the colour map in the input colorMap, its settings in the define', () => {
    stubs.renderer = null;
    stubs.sets = { grass01: { defaultPacking: 'LITE' } };
    const props = getTerrainMaterialProps({
      id: 'block',
      layers: [{ set: 'grass01' }],
      colorMap: { mode: 'DETAIL', texture: 'block.colorMap', detailDistance: [20, 60] },
      distance: { fade: [30, 90], far: 'COLOR_MAP' },
    });
    expect(props.staticDefines).toEqual({
      terrain: {
        layers: [{}],
        colorMap: { mode: 'DETAIL', detailDistance: [20, 60] },
        distance: { fade: [30, 90], far: 'COLOR_MAP' },
      },
    });
    expect(props.inputs).toEqual({
      layer0: { textureSet: 'grass01' },
      colorMap: { texture: 'block.colorMap' },
    });
    // AUTO counts it: 5 LITE layers (10) are SEPARATE, with a colour map (11) ARRAY
    const layers = Array.from({ length: 5 }, () => ({ set: 'grass01' }));
    const painted = { id: 'p', layers, blend: { source: 'VERTEX_COLOR' as const } };
    const rgba = {
      ...painted,
      blend: { ...painted.blend, vertexColor: { layout: 'RGBA' as const } },
    };
    expect(getTerrainMaterialProps(rgba).inputs).toHaveProperty('layer4');
    const colorMap = { mode: 'DETAIL' as const, texture: 'p.colorMap' };
    expect(getTerrainMaterialProps({ ...rgba, colorMap }).inputs).toHaveProperty('layers');
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
    // p307's puddle patches read it the same way, a tier's too
    const patches = { puddles: { patches: { scale: 30 } } };
    expect(inputsOf({ wet: patches })).toHaveProperty('macro', { texture: 'macroNoise' });
    expect(inputsOf({ wet: patches, noiseTexture: 'ridge.noise' })).toHaveProperty('macro', {
      texture: 'ridge.noise',
    });
    expect(inputsOf({ quality: { HIGH: { wet: patches } } })).toHaveProperty('macro', {
      texture: 'macroNoise',
    });
    expect(inputsOf({ wet: { puddles: {} } })).not.toHaveProperty('macro');
    // And the streaks, in either quality
    expect(inputsOf({ wet: { quality: 'SIMPLE', streaks: {} } })).toHaveProperty('macro', {
      texture: 'macroNoise',
    });
    // p307's ripples: the ripple atlas, rippleTexture else rippleAtlas, a tier's too
    const blend = rules({ layer: 1, height: { min: 4 } });
    expect(inputsOf({ blend, wet: { ripples: {} } })).toHaveProperty('ripples', {
      texture: 'rippleAtlas',
    });
    expect(
      inputsOf({ blend, wet: { ripples: {} }, rippleTexture: 'rippleAtlas.data' })
    ).toHaveProperty('ripples', { texture: 'rippleAtlas.data' });
    expect(inputsOf({ blend, quality: { ULTRA: { wet: { ripples: {} } } } })).toHaveProperty(
      'ripples',
      { texture: 'rippleAtlas' }
    );
    expect(inputsOf({ blend, wet: {} })).not.toHaveProperty('ripples');
    expect(
      getTerrainMaterialProps({
        id: 'ridge',
        layers,
        blend,
        wet: { ripples: {} },
        rippleTexture: 'x',
      }).staticDefines
    ).toEqual({ terrain: { layers: [{}, {}], blend, wet: { ripples: {} } } });
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

describe('setupTerrainMaterial: wet (p307)', () => {
  /** The surface conditions' uniforms, as `getSurfaceConditionNodes()` makes them */
  const makeConditions = () => ({
    wetness: uniform(0.5),
    rain: uniform(0),
    puddleLevel: uniform(0),
    waterLevel: uniform(-1e9),
    snowCoverage: uniform(0),
    temperature: uniform(10),
    wind: uniform(new Vector2()),
    time: uniform(0),
  });
  let conditions = makeConditions();

  beforeEach(() => {
    conditions = makeConditions();
    stubs.conditions = conditions;
  });

  const reaches = (root: unknown, target: unknown) =>
    collectNodesFrom([root]).includes(target as Node);
  const WET_UNIFORMS = [
    'terrain_wetCavityInfluence',
    'terrain_wetHeightInfluence',
    'terrain_wetShelter',
  ];

  it('builds dry without wet: no wet uniform, nothing reads the conditions', () => {
    const material = build({ layers: [{}] });
    expect(getUniformKeys(material)).toEqual(LAYER_UNIFORMS);
    expect(reaches(material.colorNode, conditions.wetness)).toBe(false);
  });

  it("wets the albedo, the roughness and (FULL) the normal by the conditions' wetness", () => {
    const material = build({ layers: [{}], wet: {} });
    expect(getUniformKeys(material)).toEqual([...LAYER_UNIFORMS, ...WET_UNIFORMS].sort());
    expect(getUniforms(material).terrain_wetShelter.value).toEqual(new Vector2(60, 120));
    for (const socket of [material.colorNode, material.roughnessNode, material.normalNode]) {
      expect(reaches(socket, conditions.wetness)).toBe(true);
    }
    // A tier's SIMPLE: the response and the exposure, no relief and no normal
    const simple = build({ layers: [{}], wet: { quality: 'SIMPLE' } });
    expect(getUniformKeys(simple)).toEqual([...LAYER_UNIFORMS, 'terrain_wetShelter'].sort());
    expect(reaches(simple.colorNode, conditions.wetness)).toBe(true);
    expect(reaches(simple.normalNode, conditions.wetness)).toBe(false);
  });

  it("reads each layer's response, blended, and FULL's cavities from the AO", () => {
    const inputs = layerInputs(2, 'FULL');
    const material = build(
      { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' }, wet: {} },
      inputs
    );
    for (const key of ['layer0', 'layer1']) {
      const bundle = inputs[key as 'layer0'] as unknown as Record<string, unknown>;
      expect(reaches(material.colorNode, bundle.porosity), key).toBe(true);
      expect(reaches(material.colorNode, bundle.wetDarkening), key).toBe(true);
      expect(reaches(material.roughnessNode, bundle.wetRoughness), key).toBe(true);
      expect(reaches(material.colorNode, bundle.dryingSpeed), key).toBe(true);
      expect(reaches(material.roughnessNode, bundle.puddleResponse), key).toBe(true);
    }
    const aoInfluence = getUniforms(material).terrain_aoTextureInfluence;
    expect(reaches(material.colorNode, aoInfluence)).toBe(true);
    const simple = build(
      { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' }, wet: { quality: 'SIMPLE' } },
      layerInputs(2, 'FULL')
    );
    const simpleAo = getUniforms(simple).terrain_aoTextureInfluence;
    expect(reaches(simple.colorNode, simpleAo)).toBe(false);
    // A set array's layers: their params
    const array = build(
      { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' }, wet: {} },
      { layers: makeArrayBundle(2) }
    );
    expect(reaches(array.colorNode, conditions.wetness)).toBe(true);
  });

  it('wets past a far mode too', () => {
    const define = {
      layers: layersOf(2),
      blend: { source: 'VERTEX_COLOR' },
      distance: { fade: [30, 90], far: 'AVERAGE_COLOR' },
      wet: {},
    };
    const inputs = {
      layer0: makeBundle('LITE', { averageColor: true }),
      layer1: makeBundle('LITE', { averageColor: true }),
    };
    const material = build(define, inputs);
    expect(reaches(material.colorNode, conditions.wetness)).toBe(true);
    // (the branch's members: TerrainFar.test.ts) MINIMAL bumps after the branch: the film flattens its bump
    const minimal = build(
      { ...define, distance: { fade: [30, 90], far: 'AVERAGE_COLOR' } },
      {
        layer0: makeBundle('MINIMAL', { averageColor: true }),
        layer1: makeBundle('MINIMAL', { averageColor: true }),
      }
    );
    expect(reaches(minimal.normalNode, conditions.wetness)).toBe(true);
  });

  it('builds dry without the surface conditions feature, warned once a page load', () => {
    stubs.conditions = null;
    stubs.warnings.length = 0;
    const material = build({ layers: [{}], wet: {} });
    build({ layers: [{}], wet: {} });
    expect(getUniformKeys(material)).toEqual(LAYER_UNIFORMS);
    const warned = stubs.warnings.filter((message) => /builds dry/.test(message));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/surfaceConditions\(\)/);
  });

  it('stands puddles on the relief by the puddle level, their patches one fetch of the macro input', () => {
    const material = build({ layers: [{}], wet: { puddles: { maxSlope: 10 } } });
    const PUDDLE_UNIFORMS = ['terrain_wetPuddleEdge', 'terrain_wetPuddleMaxSlope'];
    expect(getUniformKeys(material)).toEqual(
      [...LAYER_UNIFORMS, ...WET_UNIFORMS, ...PUDDLE_UNIFORMS].sort()
    );
    expect(getUniforms(material).terrain_wetPuddleMaxSlope.value).toBe(10);
    expect(getUniforms(material).terrain_wetPuddleEdge.value).toBe(0.05);
    for (const socket of [material.colorNode, material.roughnessNode, material.normalNode]) {
      expect(reaches(socket, conditions.puddleLevel)).toBe(true);
    }
    const dry = build({ layers: [{}], wet: {} });
    expect(reaches(dry.colorNode, conditions.puddleLevel)).toBe(false);
    // Patches: the macro texture sampled once at their own scale, beside the macro variation's
    const macroTexture = texture(new Texture());
    const isSampleOfMacro = (node: Node) =>
      (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
      (node as unknown as { value: unknown }).value === macroTexture.value &&
      node !== (macroTexture as unknown as Node);
    const patches = { puddles: { patches: { scale: 30 } } };
    const patched = build(
      { layers: [{}], wet: patches },
      { layer0: makeBundle(), macro: macroTexture }
    );
    expect(getUniforms(patched).terrain_wetPuddlePatchScale.value).toBe(30);
    expect(getUniforms(patched).terrain_wetPuddlePatchAmount.value).toBe(0.75);
    expect(collectNodes(patched).filter(isSampleOfMacro)).toHaveLength(1);
    expect(collectNodesFrom([patched.colorNode]).some(isSampleOfMacro)).toBe(true);
    const both = build(
      { layers: [{}], macro: { scale: 120 }, wet: patches },
      { layer0: makeBundle(), macro: macroTexture }
    );
    expect(collectNodes(both).filter(isSampleOfMacro)).toHaveLength(2);
    expect(() => build({ layers: [{}], wet: patches })).toThrow(/Missing input "macro"/);
    // A tier's patches: the base takes the input, without fetching it
    const tiered = build(
      { layers: [{}], wet: {}, quality: { HIGH: { wet: patches } } },
      { layer0: makeBundle(), macro: macroTexture }
    );
    expect(collectNodes(tiered).filter(isSampleOfMacro)).toHaveLength(0);
    // SIMPLE has none (the reader refuses puddles there)
    expect(() => build({ layers: [{}], wet: { quality: 'SIMPLE', puddles: {} } })).toThrow(
      /is for quality FULL/
    );
  });

  it("keeps a regional wetness: a vertex attribute, or the first splat map's A", () => {
    const attributeOf = (material: MeshStandardNodeMaterial) =>
      collectNodes(material)
        .map((node) => (node as unknown as { _attributeName?: string })._attributeName)
        .filter((name) => name !== undefined && name !== 'color');
    expect(attributeOf(build({ layers: [{}], wet: { regional: {} } }))).toContain('_wetness');
    const named = build({ layers: [{}], wet: { regional: { attribute: 'swamp' } } });
    expect(attributeOf(named)).toContain('swamp');
    expect(attributeOf(build({ layers: [{}], wet: {} }))).not.toContain('_wetness');
    // With puddles, it raises their level too
    const puddled = build({ layers: [{}], wet: { regional: {}, puddles: {} } });
    expect(attributeOf(puddled).filter((name) => name === '_wetness').length).toBeGreaterThan(0);
    // The splat map's A: a channel of the one splat sample
    const splat = texture(new Texture());
    const material = build(
      {
        layers: layersOf(4),
        blend: { source: 'SPLAT_MAP' },
        wet: { regional: { splatChannel: 'A' } },
      },
      layerInputs(4, 'LITE', { splat0: splat })
    );
    const isSplatSample = (node: Node) =>
      (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
      (node as unknown as { value: unknown }).value === splat.value &&
      node !== (splat as unknown as Node);
    expect(collectNodes(material).filter(isSplatSample)).toHaveLength(1);
    const alpha = collectNodes(material).find(
      (node) =>
        (node as unknown as { components?: string }).components === 'w' &&
        isSplatSample((node as unknown as { node: Node }).node)
    );
    expect(alpha).toBeTruthy();
    expect(reaches(material.colorNode, alpha)).toBe(true);
  });

  it('ripples where water stands while it rains: the ripples input, its uniforms, its budget', () => {
    const atlas = texture(new Texture());
    const material = build(
      { layers: [{}], wet: { puddles: {}, ripples: { scale: 2, distance: [5, 20] } } },
      { layer0: makeBundle(), ripples: atlas }
    );
    const uniforms = getUniforms(material);
    expect(uniforms.terrain_wetRippleScale.value).toBe(2);
    expect(uniforms.terrain_wetRippleLifetime.value).toBe(0.7);
    expect(uniforms.terrain_wetRippleStrength.value).toBe(0.5);
    expect(uniforms.terrain_wetRippleDistance.value).toEqual(new Vector2(5, 20));
    // The roughness and the colour don't read the ripples; the normal adds their branch (a Fn
    // call, Ripples.test.ts), which the mask's weight gates by the rain
    const calls = (root: unknown) =>
      collectNodesFrom([root]).filter((node) => (node as { shaderNode?: unknown }).shaderNode)
        .length;
    const unrippled = build({ layers: [{}], wet: { puddles: {} } });
    expect(calls(material.normalNode)).toBe(calls(unrippled.normalNode) + 1);
    expect(reaches(material.roughnessNode, conditions.rain)).toBe(false);
    // The input: wanted with ripples, refused without, and counted in the budget
    expect(() => build({ layers: [{}], wet: { ripples: {} } })).toThrow(/Missing input "ripples"/);
    expect(() =>
      build({ layers: [{}], wet: {} }, { layer0: makeBundle(), ripples: atlas })
    ).toThrow(/Input "ripples" has no use/);
    expect(() =>
      build(
        { layers: [{}], wet: {}, quality: { HIGH: { wet: { ripples: {} } } } },
        { layer0: makeBundle(), ripples: atlas }
      )
    ).not.toThrow();
    expect(() =>
      build(
        { layers: [{}], wet: { ripples: {} }, reservedTextures: 14 },
        { layer0: makeBundle(), ripples: atlas }
      )
    ).toThrow(/ripple atlas: 1/);
    expect(() => build({ layers: [{}], wet: { quality: 'SIMPLE', ripples: {} } })).toThrow(
      /is for quality FULL/
    );
  });

  it('streaks steep faces in either quality: the macro input, its uniforms, one branch', () => {
    const macroTexture = texture(new Texture());
    const inputs = { layer0: makeBundle(), macro: macroTexture };
    const material = build({ layers: [{}], wet: { streaks: { minSlope: 70 } } }, inputs);
    const uniforms = getUniforms(material);
    expect(uniforms.terrain_wetStreakMinSlope.value).toBe(70);
    expect(uniforms.terrain_wetStreakScale.value).toBe(4);
    expect(uniforms.terrain_wetStreakLength.value).toBe(8);
    expect(uniforms.terrain_wetStreakSpeed.value).toBe(1);
    // The rivulets darken (the pores) and gloss (the film, while it rains): the colour and the
    // roughness add their branch (a Fn call; its body reads the rain and the clock,
    // Streaks.test.ts)
    const calls = (root: unknown) =>
      collectNodesFrom([root]).filter((node) => (node as { shaderNode?: unknown }).shaderNode)
        .length;
    const plain = build({ layers: [{}], wet: {} });
    for (const socket of ['colorNode', 'roughnessNode'] as const) {
      expect(calls(material[socket])).toBe(calls(plain[socket]) + 1);
    }
    // SIMPLE streaks too
    const simple = build({ layers: [{}], wet: { quality: 'SIMPLE', streaks: {} } }, inputs);
    const simplePlain = build({ layers: [{}], wet: { quality: 'SIMPLE' } });
    expect(calls(simple.roughnessNode)).toBe(calls(simplePlain.roughnessNode) + 1);
    // The input: wanted with streaks, a tier's taken without building them
    expect(() => build({ layers: [{}], wet: { streaks: {} } })).toThrow(/Missing input "macro"/);
    const tiered = build(
      { layers: [{}], wet: {}, quality: { LOW: { wet: { streaks: {} } } } },
      inputs
    );
    expect(calls(tiered.roughnessNode)).toBe(calls(plain.roughnessNode));
  });

  it('wets a shoreline along the water level in either quality: its uniforms, no input', () => {
    const material = build({
      layers: [{}],
      wet: { shoreline: { band: 1.5, runUp: { period: 4 } } },
    });
    const uniforms = getUniforms(material);
    expect(uniforms.terrain_wetShoreBand.value).toBe(1.5);
    expect(uniforms.terrain_wetShoreNoise.value).toBe(0.3);
    expect(uniforms.terrain_wetShoreRunUp.value).toEqual(new Vector2(0.5, 4));
    for (const socket of [material.colorNode, material.roughnessNode, material.normalNode]) {
      expect(reaches(socket, conditions.waterLevel)).toBe(true);
    }
    const still = build({ layers: [{}], wet: { shoreline: { band: 1 } } });
    expect(getUniforms(still).terrain_wetShoreRunUp).toBeUndefined();
    const simple = build({ layers: [{}], wet: { quality: 'SIMPLE', shoreline: { band: 1 } } });
    expect(reaches(simple.colorNode, conditions.waterLevel)).toBe(true);
    expect(reaches(simple.normalNode, conditions.waterLevel)).toBe(false);
    const dry = build({ layers: [{}], wet: {} });
    expect(reaches(dry.colorNode, conditions.waterLevel)).toBe(false);
  });

  it("counts the streaks' tap in TAPS where they run", async () => {
    expect(await loadTerrainDebugViewsAsync()).toBe(true);
    const material = build(
      { layers: [{}], wet: { streaks: {} }, debugView: 'TAPS' },
      { layer0: makeBundle(), macro: texture(new Texture()) }
    );
    // The gated tap's share is the streak mask: a steep face × the rain or the wetness
    expect(reaches(material.emissiveNode, conditions.rain)).toBe(true);
    const dry = build({ layers: [{}], wet: {}, debugView: 'TAPS' });
    expect(reaches(dry.emissiveNode, conditions.rain)).toBe(false);
  });

  it("counts the ripples' two taps in TAPS where they run", async () => {
    expect(await loadTerrainDebugViewsAsync()).toBe(true);
    const material = build(
      { layers: [{}], wet: { ripples: {} }, debugView: 'TAPS' },
      { layer0: makeBundle(), ripples: texture(new Texture()) }
    );
    expect(material.emissiveNode).toBeTruthy();
    // The gated taps' share is the ripple mask: the rain × the standing water × the fade
    expect(reaches(material.emissiveNode, conditions.rain)).toBe(true);
    const dry = build({ layers: [{}], wet: {}, debugView: 'TAPS' });
    expect(reaches(dry.emissiveNode, conditions.rain)).toBe(false);
  });

  it('shows the masks in the WETNESS view', async () => {
    expect(await loadTerrainDebugViewsAsync()).toBe(true);
    const material = build({ layers: [{}], wet: {}, debugView: 'WETNESS' });
    expect(reaches(material.emissiveNode, conditions.wetness)).toBe(true);
    expect(() => build({ layers: [{}], debugView: 'WETNESS' })).toThrow(/is WETNESS: give wet/);
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

describe('live layers (p305 Phase 8)', () => {
  /** The points the live generator was built at */
  const builds: unknown[] = [];
  const ripples = defineSurfaceGenerator({
    id: 'testMaterialRipples',
    category: 'SAND',
    physicalSize: [2, 2],
    heightScale: 0.04,
    params: { depth: { default: 0.5, min: 0, max: 1 } },
    build: (ctx, params) => {
      builds.push(ctx.uv);
      return {
        albedo: color(0.8, 0.7, 0.5) as unknown as Node<'vec3'>,
        height: ctx.uv.x.fract().mul(params.depth) as Node<'float'>,
        roughness: uniform(0.9) as unknown as Node<'float'>,
      };
    },
  });

  /** A `{ textureSet }` bundle of a procedural set of the ripples */
  const makeLiveBundle = (packing: Packing = 'LITE') => {
    const bundle = makeBundle(packing);
    stubs.setsOfInputs.set(bundle, {
      id: 'liveRipples',
      physicalSize: [3, 3],
      heightScale: 0.05,
      procedural: { generator: ripples.id, params: {}, seed: 4, size: 256, packing },
    });
    return bundle;
  };

  const painted = { blend: { source: 'VERTEX_COLOR' } };
  const live = { source: 'PROCEDURAL_LIVE' };

  beforeEach(() => {
    stubs.renderer = null;
    stubs.generators.set(ripples.id, ripples);
    builds.length = 0;
  });

  it("runs the generator: its uniforms, none of its set's textures sampled or bound", () => {
    const inputs = { layer0: makeBundle(), layer1: makeLiveBundle() };
    const material = build({ layers: [{}, live], ...painted }, inputs);
    expect(getUniformKeys(material)).toEqual(
      expect.arrayContaining(['terrain_l1_live_depth', 'terrain_l1_live_seed'])
    );
    expect(getUniforms(material).terrain_l1_live_seed.value).toBe(4);
    // Layer 0's two LITE slots; the generator built once (its normal the layer's bump)
    expect(countSamples(material, inputs)).toBe(2);
    expect(builds).toHaveLength(1);
    // Its bundle binds nothing: layer 0's two textures fit a budget of 3, both layers' wouldn't
    const tight = { layers: [{}, live], ...painted, reservedTextures: 13 };
    expect(() => build(tight, { layer0: makeBundle(), layer1: makeLiveBundle() })).not.toThrow();
    expect(() =>
      build({ ...tight, layers: [{}, {}] }, { layer0: makeBundle(), layer1: makeBundle() })
    ).toThrow(/binds 4 textures, over its budget of 3/);
  });

  it("builds the graph per projected plane, a gate's planar tap before its branch", () => {
    build(
      { layers: [{ ...live, projection: { mode: 'TRIPLANAR' } }] },
      {
        layer0: makeLiveBundle(),
      }
    );
    expect(builds).toHaveLength(3);
    builds.length = 0;
    const gated = { mode: 'TRIPLANAR', slopeGate: [30, 50] };
    build({ layers: [{ ...live, projection: gated }] }, { layer0: makeLiveBundle() });
    // The planar tap; the branch's two planes are built with the shader (its Fn's body)
    expect(builds).toHaveLength(1);
  });

  it('gives FULL its AO and bumps a MINIMAL live layer with the others', () => {
    const full = build(
      { layers: [{}, live], ...painted },
      {
        layer0: makeBundle('FULL'),
        layer1: makeLiveBundle('FULL'),
      }
    );
    expect(full.aoNode).toBeTruthy();
    builds.length = 0;
    const minimal = build(
      { layers: [{}, { ...live, live: { normal: 'TAPS' } }], ...painted },
      {
        layer0: makeBundle('MINIMAL'),
        layer1: makeLiveBundle('MINIMAL'),
      }
    );
    // MINIMAL has no normal maps: the layer bumps its height, no taps
    expect(builds).toHaveLength(1);
    expect(countMethod(minimal, 'dFdx')).toBeGreaterThan(0);
  });

  it("takes a live layer's own input beside a set array; refuses an unloaded generator", () => {
    const define = { layers: [{}, live], ...painted };
    expect(() => build(define, { layers: makeArrayBundle(2) })).toThrow(
      /Input "layers" has 2 layers, and 1 layers take theirs from it/
    );
    expect(() => build(define, { layers: makeArrayBundle(1) })).toThrow(/Missing input "layer1"/);
    build(define, { layers: makeArrayBundle(1), layer1: makeLiveBundle() });
    expect(builds).toHaveLength(1);
    stubs.generators.clear();
    expect(() =>
      build({ layers: [{}, live], ...painted }, { layer0: makeBundle(), layer1: makeLiveBundle() })
    ).toThrow(/the generator "testMaterialRipples" of the texture set "liveRipples" isn't loaded/);
  });
});

describe("mixed sources: a set array's layers and layers of their own inputs (p305 D9)", () => {
  const vertexRgba = { blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } } };

  beforeEach(() => {
    stubs.renderer = null;
  });

  it("samples the array's layers at their place in it and the others' own inputs", () => {
    const inputs = { layers: makeArrayBundle(3), layer1: makeBundle() };
    const material = build({ layers: layersOf(4), ...vertexRgba }, inputs);
    // Four layers of two LITE slots each, dense
    expect(countSamples(material, inputs)).toBe(8);
    // The budget counts the arrays and the own input's slots
    expect(() =>
      build(
        { layers: layersOf(4), ...vertexRgba, reservedTextures: 13 },
        { layers: makeArrayBundle(3), layer1: makeBundle() }
      )
    ).toThrow(
      'layers (arrays albedoRough, normalHeight): 2; layer1 (albedoRough, normalHeight each): 2'
    );
  });

  it("keeps the slots to the array's layers and samples the others beside them", () => {
    const sampled = (maxLayers: number, inputs: Record<string, unknown>) =>
      countSamples(
        build({ layers: layersOf(4), ...vertexRgba, sparse: { maxLayers } }, inputs),
        inputs
      );
    // Top-2 of the array's three, layer 3 beside them: three layers' samples
    expect(sampled(2, { layers: makeArrayBundle(3), layer3: makeBundle() })).toBe(6);
    // Top-3 keeps all three: every layer at its own index
    expect(sampled(3, { layers: makeArrayBundle(3), layer3: makeBundle() })).toBe(8);
    // DOMINANT samples the array's layers in slots however many it keeps
    const dominant = { mode: 'HEX', apply: 'DOMINANT' };
    const inputs = { layers: makeArrayBundle(3), layer0: makeBundle() };
    const material = build({ layers: layersOf(4), ...vertexRgba, antiTiling: dominant }, inputs);
    expect(getUniformKeys(material)).toContain('terrain_l1_farScale');
  });

  it('builds the debug views over the slots and the layers beside them', async () => {
    expect(await loadTerrainDebugViewsAsync()).toBe(true);
    for (const debugView of ['WEIGHTS', 'LAYER_COUNT', 'TAPS'] as const) {
      const material = build(
        { layers: layersOf(4), ...vertexRgba, sparse: { maxLayers: 2 }, debugView },
        { layers: makeArrayBundle(3), layer3: makeBundle() }
      );
      expect(material.emissiveNode, debugView).toBeTruthy();
    }
  });

  it("gives the code route's procedural sets and live layers their own inputs, logged", () => {
    stubs.logs.length = 0;
    stubs.sets = {
      grass01: { defaultPacking: 'LITE' },
      rocks01: { defaultPacking: 'LITE' },
      dunes: { defaultPacking: 'FULL', procedural: { generator: 'sandRipples' } },
    } as never;
    const config = {
      id: 'mixed',
      layers: [
        { set: 'grass01' },
        { set: 'dunes' },
        { set: 'rocks01' },
        { set: 'grass01', source: 'PROCEDURAL_LIVE' as const },
      ],
      blend: { source: 'VERTEX_COLOR' as const, vertexColor: { layout: 'RGBA' as const } },
      storage: 'ARRAY' as const,
    };
    expect(getTerrainMaterialProps(config).inputs).toEqual({
      layers: { textureSetArray: ['grass01', 'rocks01'], packing: 'LITE' },
      layer1: { textureSet: 'dunes' },
      layer3: { textureSet: 'grass01' },
    });
    expect(stubs.logs).toEqual([
      '[terrain] Material "mixed": a set array takes imported sets, so layer1 (dunes), layer3 (grass01) take their own inputs beside it (procedural sets, live layers).',
    ]);
    // A tier's live layer too: its variant shares the inputs
    const tiered = {
      ...config,
      layers: config.layers.slice(0, 3),
      quality: { ULTRA: { layers: [{}, {}, { source: 'PROCEDURAL_LIVE' as const }] } },
    };
    expect(getTerrainMaterialProps(tiered).inputs).toEqual({
      layers: { textureSetArray: ['grass01'], packing: 'LITE' },
      layer1: { textureSet: 'dunes' },
      layer2: { textureSet: 'rocks01' },
    });
  });
});
