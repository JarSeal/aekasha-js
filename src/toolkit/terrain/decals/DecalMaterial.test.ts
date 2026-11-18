import { beforeEach, describe, expect, it, vi } from 'vitest';
import { texture, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial, Texture, Vector2, type Node } from 'three/webgpu';
import { getDecalEdgeFade, readDecalDefine, setupDecalMaterial } from './DecalMaterial';

const stubs = vi.hoisted(() => ({ warnings: [] as string[], conditions: null as unknown }));

vi.mock('aekasha/surface', () => ({
  getSurfaceConditionNodes: () => stubs.conditions,
  getRainOcclusionNode: () => null,
}));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  lwarn: (message: string) => stubs.warnings.push(message),
}));

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

const makeInputs = (extra: Record<string, unknown> = {}) => ({
  albedoAlpha: texture(new Texture()) as never,
  normalRough: texture(new Texture()) as never,
  ...extra,
});

const build = (
  defines?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  params: Partial<MeshStandardNodeMaterial> = {}
) => {
  const material = new MeshStandardNodeMaterial();
  Object.assign(material, params);
  setupDecalMaterial(makeInputs(extra), material, defines);
  return material;
};

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
  return [...nodes];
};

const readsAttribute = (root: unknown, name: string) =>
  collectNodes([root]).some(
    (node) => (node as unknown as { getAttributeName?: () => string }).getAttributeName?.() === name
  );

describe('decal setup', () => {
  beforeEach(() => {
    stubs.conditions = null;
    stubs.warnings.length = 0;
  });

  it('BLEND: transparent without depth writes, offset toward the camera', () => {
    const material = build({ wet: 'NONE' });
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.alphaToCoverage).toBe(false);
    expect([
      material.polygonOffset,
      material.polygonOffsetFactor,
      material.polygonOffsetUnits,
    ]).toEqual([true, -1, -4]);
  });

  it("CUTOUT: opaque, alpha-tested with alpha to coverage; the params' numbers win", () => {
    const material = build({ mode: 'CUTOUT', wet: 'NONE' });
    expect([material.transparent, material.depthWrite]).toEqual([false, true]);
    expect([material.alphaTest, material.alphaToCoverage]).toEqual([0.5, true]);
    expect(material.polygonOffset).toBe(true);
    const tuned = build(
      { mode: 'CUTOUT', wet: 'NONE' },
      {},
      { alphaTest: 0.3, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }
    );
    expect([tuned.alphaTest, tuned.polygonOffsetFactor, tuned.polygonOffsetUnits]).toEqual([
      0.3, -2, -8,
    ]);
  });

  it('fades the opacity by the second UV set only with edgeFade UV1', () => {
    expect(readsAttribute(build({ wet: 'NONE', edgeFade: 'UV1' }).opacityNode, 'uv1')).toBe(true);
    expect(readsAttribute(build({ wet: 'NONE' }).opacityNode, 'uv1')).toBe(false);
  });

  it('keeps its numbers and colours as uniforms, an input in place of its default', () => {
    const opacity = uniform(0.4);
    const material = build({ wet: 'NONE', edgeFade: 'UV1' }, { opacity });
    const uniforms = material.userData.uniforms as Record<string, unknown>;
    expect(Object.keys(uniforms).sort()).toEqual([
      'decal_edgeFade',
      'decal_normalStrength',
      'decal_opacity',
      'decal_roughnessScale',
      'decal_tint',
    ]);
    expect(uniforms.decal_opacity).toBe(opacity);
  });

  it('wets by the conditions; FULL fills the puddle mask first, SIMPLE has no puddles', () => {
    const conditions = makeConditions();
    stubs.conditions = conditions;
    const full = build();
    const uniforms = full.userData.uniforms as Record<string, unknown>;
    const fullNodes = collectNodes([full.colorNode, full.roughnessNode]);
    expect(fullNodes).toContain(conditions.wetness);
    expect(fullNodes).toContain(conditions.puddleLevel);
    expect(fullNodes).toContain(uniforms.decal_puddleDepth);
    const simple = build({ wet: 'SIMPLE' });
    const simpleNodes = collectNodes([simple.colorNode, simple.roughnessNode]);
    expect(simpleNodes).toContain(conditions.wetness);
    expect(simpleNodes).not.toContain(conditions.puddleLevel);
  });

  it('samples the ripple atlas only with FULL and the input', () => {
    stubs.conditions = makeConditions();
    const atlas = texture(new Texture());
    // The ripples' branch is one Fn call more on the normal (Wet.test.ts)
    const countCalls = (material: MeshStandardNodeMaterial) =>
      collectNodes([material.normalNode]).filter(
        (node) => (node as unknown as { shaderNode?: unknown }).shaderNode
      ).length;
    expect(countCalls(build({}, { ripples: atlas }))).toBe(countCalls(build()) + 1);
    expect(countCalls(build({ wet: 'SIMPLE' }, { ripples: atlas }))).toBe(
      countCalls(build({ wet: 'SIMPLE' }))
    );
  });

  it('builds dry without the surface conditions feature, warned once', () => {
    const material = build();
    expect(material.colorNode).toBeTruthy();
    build();
    expect(stubs.warnings).toHaveLength(1);
    expect(stubs.warnings[0]).toContain('surfaceConditions()');
  });

  it('names a missing texture and a static define it refuses', () => {
    expect(() => setupDecalMaterial({}, new MeshStandardNodeMaterial())).toThrow(
      /Input "albedoAlpha" must be a texture/
    );
    expect(() =>
      setupDecalMaterial(
        makeInputs({ normalRough: uniform(0) }) as never,
        new MeshStandardNodeMaterial()
      )
    ).toThrow(/Input "normalRough"/);
    expect(() => readDecalDefine({ mode: 'ADD' })).toThrow(/"mode" is "ADD"/);
    expect(() => readDecalDefine({ frost: 'yes' })).toThrow(/"frost" is "yes"/);
    expect(() => readDecalDefine({ quality: 'LOW' })).toThrow(/Unknown static define "quality"/);
    expect(readDecalDefine()).toEqual({
      mode: 'BLEND',
      edgeFade: 'NONE',
      wet: 'FULL',
      frost: true,
      rainOcclusion: 'NORMAL_Y',
    });
  });

  it('fades by both axes of the second UV set', () => {
    const decalUv = uniform(new Vector2(0.5, 0.5));
    const widths = uniform(new Vector2(0.1, 0));
    const fade = getDecalEdgeFade(decalUv as never, widths as never);
    expect(collectNodes([fade])).toEqual(expect.arrayContaining([decalUv, widths]));
  });
});
