import { describe, expect, it } from 'vitest';
import { readTerrainDefine, TERRAIN_DEFINE_VALUES } from './TerrainDefine';
import {
  TERRAIN_BLEND_SOURCES,
  TERRAIN_DEBUG_VIEWS,
  TERRAIN_QUALITY_LEVELS,
  TERRAIN_LAYER_SOURCES,
  TERRAIN_MAX_LAYERS,
  TERRAIN_UV_MODES,
  TerrainLayerSettingsSchema,
  TerrainMaterialDefineSchema,
  TerrainQualityOverridesSchema,
} from './TerrainMaterialConfig';

const read = (terrain: unknown) => readTerrainDefine({ terrain });

/** Defines both must take, and ones both must refuse */
const ACCEPTED: unknown[] = [
  { layers: [{}] },
  { layers: [{ tiling: 2, rotation: -30, tint: '#a0B0c0' }], uv: 'MESH_UV' },
  { layers: [{ source: 'TEXTURE', normalStrength: 0, roughnessScale: 1.5 }], uv: 'WORLD' },
  { layers: [{}], blend: { source: 'SINGLE' } },
  { layers: [{}], ao: { textureInfluence: 0 } },
  { layers: [{}], ao: {} },
  { layers: [{}], quality: { LOW: { ao: { textureInfluence: 0 } }, ULTRA: {} } },
  { layers: [{}], quality: { HIGH: { uv: 'MESH_UV' } }, qualityLevel: 'HIGH' },
  { layers: [{}], qualityLevel: 'MEDIUM' },
  { layers: [{}], debugView: 'TEXEL_DENSITY' },
  { layers: [{}], debugView: 'NORMALS' },
];
const REFUSED: unknown[] = [
  {},
  { layers: [] },
  { layers: [{}, {}] },
  { layers: Array.from({ length: TERRAIN_MAX_LAYERS + 1 }, () => ({})) },
  { layers: [{ tiling: 0 }] },
  { layers: [{ normalStrength: -1 }] },
  { layers: [{ tint: 'red' }] },
  { layers: [{ tint: '#fff' }] },
  { layers: [{ source: 'PROCEDURAL_LIVE' }] },
  { layers: [{ set: 'grass01' }] },
  { layers: [{}], uv: 'XZ' },
  { layers: [{}], antiTiling: { mode: 'HEX' } },
  { layers: [{}], blend: { source: 'SPLAT_MAP' } },
  { layers: [{}], blend: { source: 'SINGLE', mode: 'HEIGHT' } },
  [{}],
  { layers: [{}], ao: { textureInfluence: 1.5 } },
  { layers: [{}], ao: { vertex: true } },
  { layers: [{}], quality: { EPIC: {} } },
  { layers: [{}], quality: { LOW: { layers: [] } } },
  { layers: [{}], quality: { LOW: { debugView: 'NORMALS' } } },
  { layers: [{}], quality: { LOW: { uv: 'XZ' } }, qualityLevel: 'LOW' },
  { layers: [{}], quality: { LOW: { blend: { source: 'SINGLE' } } }, qualityLevel: 'low' },
  { layers: [{}], debugView: 'WEIGHTS' },
];

describe('readTerrainDefine', () => {
  it('fills the defaults', () => {
    expect(read({ layers: [{}] })).toEqual({
      layers: [
        {
          source: 'TEXTURE',
          tiling: 1,
          rotation: null,
          tint: '#ffffff',
          normalStrength: 1,
          roughnessScale: 1,
        },
      ],
      uv: 'WORLD',
      blendSource: 'SINGLE',
      aoTextureInfluence: 1,
      qualityLevel: null,
      debugView: null,
    });
    expect(read({ layers: [{ rotation: 0 }] }).layers[0].rotation).toBe(0);
  });

  it('takes and refuses what the schema does', () => {
    for (const define of ACCEPTED) {
      expect(TerrainMaterialDefineSchema.safeParse(define).success, JSON.stringify(define)).toBe(
        true
      );
      expect(() => read(define)).not.toThrow();
    }
    for (const define of REFUSED) {
      expect(TerrainMaterialDefineSchema.safeParse(define).success, JSON.stringify(define)).toBe(
        false
      );
      expect(() => read(define), JSON.stringify(define)).toThrow(/^\[terrain\]/);
    }
  });

  it("applies the tier's overrides over the material's fields, shallowly", () => {
    const define = {
      layers: [{}],
      uv: 'MESH_UV',
      ao: { textureInfluence: 0.5 },
      quality: { LOW: { ao: {} }, HIGH: { uv: 'WORLD' } },
    };
    expect(read(define)).toMatchObject({ uv: 'MESH_UV', aoTextureInfluence: 0.5 });
    expect(read({ ...define, qualityLevel: 'LOW' })).toMatchObject({
      uv: 'MESH_UV',
      aoTextureInfluence: 1,
      qualityLevel: 'LOW',
    });
    expect(read({ ...define, qualityLevel: 'HIGH' })).toMatchObject({
      uv: 'WORLD',
      aoTextureInfluence: 0.5,
    });
    // A tier the table doesn't have: the material's own fields
    expect(read({ ...define, qualityLevel: 'ULTRA' })).toMatchObject({ uv: 'MESH_UV' });
    expect(() => read({ ...define, quality: { LOW: { uv: 'XZ' } }, qualityLevel: 'LOW' })).toThrow(
      'staticDefines.terrain.quality.LOW.uv: is "XZ"'
    );
  });

  it("knows the schema's keys and values", () => {
    const values = TERRAIN_DEFINE_VALUES;
    expect(values.defineKeys.sort()).toEqual(Object.keys(TerrainMaterialDefineSchema.shape).sort());
    expect(values.layerKeys.sort()).toEqual(Object.keys(TerrainLayerSettingsSchema.shape).sort());
    const { ao, blend } = TerrainMaterialDefineSchema.shape;
    expect(values.aoKeys.sort()).toEqual(Object.keys(ao.unwrap().shape).sort());
    expect(values.blendKeys.sort()).toEqual(Object.keys(blend.unwrap().shape).sort());
    expect(values.overrideKeys.sort()).toEqual(
      Object.keys(TerrainQualityOverridesSchema.shape).sort()
    );
    expect(values.qualityLevels).toEqual(TERRAIN_QUALITY_LEVELS);
    expect(values.debugViews).toEqual(TERRAIN_DEBUG_VIEWS);
    expect(values.layerSources).toEqual(TERRAIN_LAYER_SOURCES);
    expect(values.uvModes).toEqual(TERRAIN_UV_MODES);
    expect(values.blendSources).toEqual(TERRAIN_BLEND_SOURCES);
    expect(values.maxLayers).toBe(TERRAIN_MAX_LAYERS);
  });

  it('names the field', () => {
    expect(() => readTerrainDefine({})).toThrow(/Missing static define "terrain"/);
    expect(() => read({ layers: [{ tiling: -1 }] })).toThrow(
      'staticDefines.terrain.layers[0].tiling: is -1'
    );
    expect(() => read({ layers: [{}], projection: {} })).toThrow(
      'staticDefines.terrain: has no field "projection"'
    );
    expect(() => read({ layers: [{}], uv: 'XZ' })).toThrow(
      'staticDefines.terrain.uv: is "XZ": use WORLD, MESH_UV.'
    );
  });
});
