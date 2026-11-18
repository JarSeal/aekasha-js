import { beforeEach, describe, expect, it, vi } from 'vitest';
import { color, positionGeometry, texture, uniform } from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  Texture,
  Vector2,
  type Node,
  type TextureNode,
} from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { setupRockMaterial, type RockMaterialInputs } from './RockMaterial';

const stubs = vi.hoisted(() => ({
  warnings: [] as string[],
  // The surface conditions' uniforms (p307), null without the feature
  conditions: null as unknown,
  // The rain occlusion map's node (p307 T12), null without its feature
  rainOcclusion: null as unknown,
}));

vi.mock('aekasha/surface', () => ({
  getSurfaceConditionNodes: () => stubs.conditions,
  getRainOcclusionNode: () => stubs.rainOcclusion,
}));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  lwarn: (message: string) => stubs.warnings.push(message),
}));

type Packing = 'LITE' | 'FULL' | 'MINIMAL';
const PACKINGS: Record<Packing, string[]> = {
  LITE: ['albedoRough', 'normalHeight'],
  FULL: ['albedoHeight', 'normal', 'orm'],
  MINIMAL: ['albedoHeight'],
};

/** A `{ textureSet }` bundle of the packing's slots and the set's uniforms */
const makeBundle = (packing: Packing = 'LITE', withAverage = true) =>
  ({
    ...Object.fromEntries(PACKINGS[packing].map((slot) => [slot, texture(new Texture())])),
    physicalSize: uniform(new Vector2(2, 2)),
    heightScale: uniform(0.02),
    ...(withAverage ? { averageColor: color(0.4, 0.38, 0.35) } : {}),
    tint: color(1, 1, 1),
    normalStrength: uniform(1),
    roughnessScale: uniform(1),
    aoStrength: uniform(1),
    heightContrast: uniform(1),
    porosity: uniform(0.4),
    wetDarkening: uniform(0.35),
    wetRoughness: uniform(0.2),
    puddleResponse: uniform(0.3),
    dryingSpeed: uniform(1),
  }) as unknown as TextureSetInput;

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

const build = (
  defines?: Record<string, unknown>,
  inputs: RockMaterialInputs = { surface: makeBundle() }
) => {
  const material = new MeshStandardNodeMaterial();
  setupRockMaterial(inputs, material, defines);
  return material;
};

/** The nodes the roots reach, each once */
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

const collectNodes = (material: MeshStandardNodeMaterial) =>
  collectNodesFrom([
    material.colorNode,
    material.normalNode,
    material.roughnessNode,
    material.metalnessNode,
    material.aoNode,
  ]);

const reaches = (root: unknown, target: unknown) =>
  collectNodesFrom([root]).includes(target as Node);

/** The texture samples the sockets reach: texture nodes that aren't the inputs' own */
const countSamples = (material: MeshStandardNodeMaterial, inputs: RockMaterialInputs) => {
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

describe('setupRockMaterial', () => {
  beforeEach(() => {
    stubs.conditions = null;
    stubs.rainOcclusion = null;
    stubs.warnings.length = 0;
  });

  it("samples three planes of the rock's own position, two taps a plane with DUAL_SCALE", () => {
    const inputs = { surface: makeBundle() };
    const material = build({ wet: 'NONE' }, inputs);
    // LITE: two slots a tap
    expect(countSamples(material, inputs)).toBe(3 * 2 * 2);
    expect(reaches(material.colorNode, positionGeometry)).toBe(true);
    expect(countSamples(build({ wet: 'NONE', antiTiling: 'NONE' }, inputs), inputs)).toBe(3 * 2);
    expect(material.colorNode).toBeTruthy();
    expect(material.roughnessNode).toBeTruthy();
    expect(material.normalNode).toBeTruthy();
    expect(material.metalnessNode).toBeTruthy();
    expect(material.aoNode).toBeNull();
  });

  it("samples an imported rock's own maps once at the mesh's UV, with FULL's AO", () => {
    const inputs = { surface: makeBundle('FULL') };
    const material = build({ tiling: 'UV', wet: 'NONE' }, inputs);
    expect(countSamples(material, inputs)).toBe(3);
    expect(material.aoNode).toBeTruthy();
    expect(reaches(material.colorNode, positionGeometry)).toBe(false);
    const attributes = collectNodes(material).map((node) =>
      (node as unknown as { getAttributeName?: () => string }).getAttributeName?.()
    );
    expect(attributes).toContain('uv');
  });

  it('bumps MINIMAL from its height', () => {
    const inputs = { surface: makeBundle('MINIMAL') };
    const material = build({ wet: 'NONE', antiTiling: 'NONE' }, inputs);
    expect(countSamples(material, inputs)).toBe(3);
    expect(material.normalNode).toBeTruthy();
  });

  it('tints by the macro texture with the input, dusts toward the dust colour or the average', () => {
    const surface = makeBundle();
    const macro = texture(new Texture()) as unknown as TextureNode;
    const withMacro = { surface, macro };
    expect(countSamples(build({ wet: 'NONE' }, withMacro), withMacro)).toBe(13);
    const average = surface.averageColor;
    expect(reaches(build({ wet: 'NONE' }, { surface }).colorNode, average)).toBe(true);
    const dustColor = color(0.5, 0.4, 0.3);
    const dusted = build({ wet: 'NONE' }, { surface, dustColor });
    expect(reaches(dusted.colorNode, dustColor)).toBe(true);
    expect(reaches(dusted.colorNode, average)).toBe(false);
    const bare = build({ wet: 'NONE' }, { surface: makeBundle('LITE', false) });
    expect(Object.keys(bare.userData.uniforms as object)).not.toContain('rock_dustAmount');
  });

  it('keeps its numbers as uniforms, an input given in place of its default', () => {
    const sharpness = uniform(8);
    const material = build({ wet: 'NONE' }, { surface: makeBundle(), sharpness });
    const uniforms = material.userData.uniforms as Record<string, unknown>;
    expect(Object.keys(uniforms).sort()).toEqual([
      'rock_antiTilingDistance',
      'rock_dustAmount',
      'rock_dustFacing',
      'rock_farScale',
      'rock_sharpness',
    ]);
    expect(uniforms.rock_sharpness).toBe(sharpness);
  });

  it('wets the albedo, the roughness and (FULL) the normal by the conditions, with frost', () => {
    const conditions = makeConditions();
    stubs.conditions = conditions;
    const material = build();
    expect(reaches(material.colorNode, conditions.wetness)).toBe(true);
    expect(reaches(material.roughnessNode, conditions.wetness)).toBe(true);
    expect(reaches(material.normalNode, conditions.wetness)).toBe(true);
    expect(reaches(material.colorNode, conditions.temperature)).toBe(true);
    const simple = build({ wet: 'SIMPLE', frost: false });
    expect(reaches(simple.colorNode, conditions.wetness)).toBe(true);
    expect(reaches(simple.normalNode, conditions.wetness)).toBe(false);
    expect(reaches(simple.colorNode, conditions.temperature)).toBe(false);
    expect(reaches(build({ wet: 'NONE' }).colorNode, conditions.wetness)).toBe(false);
  });

  it('reads the rain occlusion map with MAP, and builds dry without the features, warned once', () => {
    const conditions = makeConditions();
    stubs.conditions = conditions;
    const occlusion = uniform(0.5);
    stubs.rainOcclusion = occlusion;
    expect(reaches(build({ rainOcclusion: 'MAP' }).colorNode, occlusion)).toBe(true);
    expect(reaches(build().colorNode, occlusion)).toBe(false);
    stubs.rainOcclusion = null;
    build({ rainOcclusion: 'MAP' });
    build({ rainOcclusion: 'MAP' });
    stubs.conditions = null;
    expect(reaches(build().colorNode, conditions.wetness)).toBe(false);
    build();
    expect(stubs.warnings).toHaveLength(2);
    expect(stubs.warnings[0]).toMatch(/rain occlusion feature isn't installed/);
    expect(stubs.warnings[1]).toMatch(/surface conditions feature isn't installed/);
  });

  it('names a missing set and a static define it refuses', () => {
    expect(() => setupRockMaterial({}, new MeshStandardNodeMaterial())).toThrow(
      /Missing input "surface"/
    );
    expect(() => build({ tilling: 'UV' })).toThrow(/Unknown static define "tilling"/);
    expect(() => build({ tiling: 'XZ' })).toThrow(/"tiling" is "XZ": use "TRIPLANAR", "UV"/);
    expect(() => build({ tiling: 'UV', antiTiling: 'DUAL_SCALE' })).toThrow(/take no anti-tiling/);
    expect(() => build({ frost: 'yes' })).toThrow(/"frost" is "yes": use a boolean/);
    expect(() => build({ wet: 'WET' })).toThrow(/"wet" is "WET"/);
  });
});
