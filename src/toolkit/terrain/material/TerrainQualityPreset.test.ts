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
});
