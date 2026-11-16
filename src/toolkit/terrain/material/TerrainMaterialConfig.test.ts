import { describe, expect, it } from 'vitest';
import { TerrainMaterialConfigSchema } from './TerrainMaterialConfig';

/** The code route's config of `count` grass layers and these fields */
const configOf = (count: number, fields: object = {}) => ({
  id: 'valley',
  layers: Array.from({ length: count }, () => ({ set: 'grass01' })),
  ...fields,
});

const issuesOf = (config: unknown) => {
  const result = TerrainMaterialConfigSchema.safeParse(config);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

const noisyRule = { layer: 1, slope: { min: 30 }, noise: { scale: 40, amount: 0.5 } };

describe('TerrainMaterialConfigSchema', () => {
  it("wants a splat map id per four painted layers, the combo's rule-only layers aside", () => {
    expect(
      issuesOf(configOf(6, { blend: { source: 'SPLAT_MAP' }, splatMaps: ['a', 'b'] }))
    ).toEqual([]);
    expect(issuesOf(configOf(6, { blend: { source: 'SPLAT_MAP' }, splatMaps: ['a'] }))).toEqual([
      'splatMaps',
    ]);
    const combo = (rules: object[]) => ({
      source: 'SPLAT_MAP_AND_RULES',
      rules,
    });
    const cliffs = { layer: 9, slope: { min: 50 } };
    expect(issuesOf(configOf(10, { blend: combo([cliffs]), splatMaps: ['a', 'b'] }))).toEqual([]);
    expect(issuesOf(configOf(10, { blend: combo([cliffs]) }))).toEqual(['splatMaps']);
    expect(
      issuesOf(configOf(2, { blend: { source: 'RULES', rules: [cliffs] }, splatMaps: ['a'] }))
    ).toContain('splatMaps');
    // Three painted layers: one map, the rule-only layers past them
    const painted = {
      source: 'SPLAT_MAP_AND_RULES',
      paintedLayers: 3,
      rules: [
        { layer: 3, slope: { min: 20 } },
        { layer: 4, slope: { min: 50 } },
      ],
    };
    expect(issuesOf(configOf(5, { blend: painted, splatMaps: ['a'] }))).toEqual([]);
    expect(issuesOf(configOf(5, { blend: painted, splatMaps: ['a', 'b'] }))).toEqual(['splatMaps']);
  });

  it('takes a noiseTexture only for rule noise without a macro', () => {
    const blend = { source: 'RULES', rules: [noisyRule] };
    expect(issuesOf(configOf(2, { blend, noiseTexture: 'noise' }))).toEqual([]);
    expect(issuesOf(configOf(1, { noiseTexture: 'noise' }))).toEqual(['noiseTexture']);
    const macro = { texture: 'macroNoise', scale: 80 };
    expect(issuesOf(configOf(2, { blend, macro, noiseTexture: 'noise' }))).toEqual([
      'noiseTexture',
    ]);
    const tierNoise = {
      blend: { source: 'RULES', rules: [{ layer: 1, slope: { min: 30 } }] },
      quality: { HIGH: { blend } },
      noiseTexture: 'noise',
    };
    expect(issuesOf(configOf(2, tierNoise))).toEqual([]);
  });

  it('refuses SEPARATE storage where the layers sample in slots, its own or a tier', () => {
    const painted = { blend: { source: 'VERTEX_COLOR' } };
    const sparse = { sparse: { maxLayers: 2 } };
    expect(issuesOf(configOf(3, { ...painted, ...sparse, storage: 'ARRAY' }))).toEqual([]);
    expect(issuesOf(configOf(3, { ...painted, ...sparse }))).toEqual([]);
    expect(issuesOf(configOf(3, { ...painted, ...sparse, storage: 'SEPARATE' }))).toEqual([
      'storage',
    ]);
    const tiered = { ...painted, quality: { LOW: sparse }, storage: 'SEPARATE' };
    expect(issuesOf(configOf(3, tiered))).toEqual(['storage']);
    // Keeping every layer: no slots
    expect(issuesOf(configOf(2, { ...painted, ...sparse, storage: 'SEPARATE' }))).toEqual([]);
    const dominant = { antiTiling: { mode: 'HEX', apply: 'DOMINANT' } };
    expect(issuesOf(configOf(2, { ...painted, ...dominant, storage: 'SEPARATE' }))).toEqual([
      'storage',
    ]);
  });

  it("names a tier's layer entry where it's given, once for a setting layers share", () => {
    const painted = { blend: { source: 'VERTEX_COLOR' } };
    const tier = {
      sparse: { maxLayers: 2 },
      layers: [{}, { antiTiling: { mode: 'HEX' } }],
    };
    expect(issuesOf(configOf(3, { ...painted, quality: { LOW: tier } }))).toEqual([
      'quality.LOW.layers.1.antiTiling',
    ]);
    // The material's HEX against layer 0's own: reported once, not per layer
    const own = {
      ...painted,
      sparse: { maxLayers: 2 },
      antiTiling: { mode: 'HEX' },
      layers: [{ set: 'grass01', antiTiling: { mode: 'NONE' } }, { set: 'a' }, { set: 'b' }],
    };
    expect(issuesOf(configOf(3, own))).toEqual(['antiTiling']);
    expect(issuesOf(configOf(1, { quality: { HIGH: { layers: [{}, {}] } } }))).toEqual([
      'quality.HIGH.layers',
    ]);
  });

  it("names the rule's path in a tier", () => {
    const blend = { source: 'RULES', rules: [{ layer: 3, slope: { min: 30 } }] };
    expect(issuesOf(configOf(2, { quality: { LOW: { blend } } }))).toContain(
      'quality.LOW.blend.rules.0.layer'
    );
  });

  it('wants a colour map for far COLOR_MAP and a COLOR_MAP far mode for FAR_ONLY', () => {
    const colorMap = { mode: 'DETAIL', texture: 'valley.colorMap' };
    const far = { fade: [30, 90], far: 'COLOR_MAP' };
    expect(issuesOf(configOf(1, { colorMap, distance: far }))).toEqual([]);
    expect(issuesOf(configOf(1, { distance: far }))).toEqual(['distance.far']);
    expect(issuesOf(configOf(1, { quality: { LOW: { distance: far } } }))).toEqual([
      'quality.LOW.distance.far',
    ]);
    const farOnly = { mode: 'FAR_ONLY', texture: 'valley.colorMap' };
    expect(issuesOf(configOf(1, { colorMap: farOnly }))).toEqual(['colorMap.mode']);
    expect(
      issuesOf(configOf(1, { colorMap: farOnly, quality: { LOW: { distance: far } } }))
    ).toEqual([]);
    expect(issuesOf(configOf(1, { colorMap: { mode: 'DETAIL' } }))).toEqual(['colorMap.texture']);
    expect(issuesOf(configOf(1, { distance: { fade: [30, 90], farBlend: 2 } }))).toEqual([
      'distance.farBlend',
    ]);
  });
});
