import { describe, expect, it } from 'vitest';
import { readTerrainDefine } from './TerrainDefine';
import { TerrainMaterialDefineSchema } from './TerrainMaterialConfig';
import { getTerrainQualityPreset } from './TerrainQualityPreset';

/** A painted define of `count` layers, its layer 3 (when there) projected, and the table */
const defineOf = (count: number, quality: object) => ({
  layers: Array.from({ length: count }, (_, i) =>
    i === 3 ? { projection: { mode: 'TRIPLANAR', slopeGate: [35, 50] } } : {}
  ),
  blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
  quality,
});

describe('getTerrainQualityPreset', () => {
  it("gives every tier its anti-tiling and sparse sampling, the cliffs' projection per tier", () => {
    const preset = getTerrainQualityPreset({ cliffLayers: [3], cliffGate: [30, 45] });
    expect(preset.LOW).toEqual({
      antiTiling: { mode: 'NONE' },
      sparse: { maxLayers: 2 },
      layers: [{}, {}, {}, { projection: { mode: 'BIPLANAR', slopeGate: [30, 45] } }],
    });
    expect(preset.HIGH.antiTiling).toEqual({ mode: 'HEX', apply: 'DOMINANT' });
    expect(preset.ULTRA.layers?.[3]).toEqual({ projection: { mode: 'TRIPLANAR' } });
    // Without cliffs, no layer entries
    expect(getTerrainQualityPreset().MEDIUM).toEqual({
      antiTiling: { mode: 'DUAL_SCALE' },
      sparse: { maxLayers: 3 },
    });
    expect(() => getTerrainQualityPreset({ cliffLayers: [1.5] })).toThrow(/isn't a layer index/);
  });

  it('gives the tiers their far surface when asked, ULTRA none', () => {
    const preset = getTerrainQualityPreset({ far: 'AVERAGE_COLOR' });
    expect(preset.LOW.distance).toEqual({ fade: [30, 60], far: 'AVERAGE_COLOR' });
    expect(preset.MEDIUM.distance).toEqual({ fade: [60, 120], far: 'AVERAGE_COLOR' });
    expect(preset.HIGH.distance).toEqual({ fade: [100, 200], far: 'AVERAGE_COLOR' });
    expect(preset.ULTRA.distance).toEqual({ fade: [100, 200] });
    expect(getTerrainQualityPreset().LOW.distance).toBeUndefined();
    const define = { ...defineOf(4, preset), layers: [{}, {}, {}, {}] };
    expect(TerrainMaterialDefineSchema.safeParse(define).success).toBe(true);
    expect(readTerrainDefine({ terrain: { ...define, qualityLevel: 'LOW' } }).far).toEqual({
      mode: 'AVERAGE_COLOR',
      blend: 4,
    });
    // COLOR_MAP needs the material's colour map
    const colorMapped = { ...define, quality: getTerrainQualityPreset({ far: 'COLOR_MAP' }) };
    expect(TerrainMaterialDefineSchema.safeParse(colorMapped).success).toBe(false);
    const withMap = { ...colorMapped, colorMap: { mode: 'FAR_ONLY' } };
    expect(TerrainMaterialDefineSchema.safeParse(withMap).success).toBe(true);
  });

  it('makes a define both readers take, each tier sampling in slots past its layers', () => {
    const quality = getTerrainQualityPreset({ cliffLayers: [3] });
    for (const count of [4, 5]) {
      const define = defineOf(count, quality);
      expect(TerrainMaterialDefineSchema.safeParse(define).success).toBe(true);
      const slots = (['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const).map(
        (qualityLevel) => readTerrainDefine({ terrain: { ...define, qualityLevel } }).slotCount
      );
      // HIGH's DOMINANT keeps 3 of them, ULTRA's 4 keeps every one of 4 (no slots)
      expect(slots).toEqual(count === 4 ? [2, 3, 3, null] : [2, 3, 3, 4]);
    }
    const single = { layers: [{}], quality: getTerrainQualityPreset() };
    expect(
      readTerrainDefine({ terrain: { ...single, qualityLevel: 'HIGH' } }).slotCount
    ).toBeNull();
  });

  it("samples the live layers' bake on LOW and MEDIUM, runs them live on HIGH and ULTRA", () => {
    const preset = getTerrainQualityPreset({ cliffLayers: [1], liveLayers: [3] });
    const sources = (['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const).map(
      (level) => preset[level].layers?.[3]
    );
    expect(sources).toEqual([
      { source: 'TEXTURE' },
      { source: 'TEXTURE' },
      { source: 'PROCEDURAL_LIVE' },
      { source: 'PROCEDURAL_LIVE' },
    ]);
    expect(preset.LOW.layers?.[1]).toEqual({
      projection: { mode: 'BIPLANAR', slopeGate: [35, 50] },
    });
    // Both readers take it over a live layer: its bake gets the tier's anti-tiling
    const define = {
      layers: [{}, {}, {}, { source: 'PROCEDURAL_LIVE' }],
      blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
      quality: getTerrainQualityPreset({ liveLayers: [3] }),
    };
    expect(TerrainMaterialDefineSchema.safeParse(define).success).toBe(true);
    const medium = readTerrainDefine({ terrain: { ...define, qualityLevel: 'MEDIUM' } });
    expect(medium.layers[3]).toMatchObject({ source: 'TEXTURE', live: null });
    expect(medium.layers[3].antiTiling.mode).toBe('DUAL_SCALE');
    const high = readTerrainDefine({ terrain: { ...define, qualityLevel: 'HIGH' } });
    expect(high.layers[3]).toMatchObject({
      source: 'PROCEDURAL_LIVE',
      antiTiling: { mode: 'NONE' },
    });
    expect(() => getTerrainQualityPreset({ liveLayers: [-1] })).toThrow(
      /live layer -1 isn't a layer index/
    );
  });
});
