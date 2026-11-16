import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { TERRAIN_RULE_NOISE_CHANNELS, type TerrainRule } from 'aekasha/toolkit/geometry';
import { readTerrainDefine, TERRAIN_DEFINE_VALUES } from './TerrainDefine';
import {
  TERRAIN_ANTI_TILING_MODES,
  TERRAIN_BLEND_LAYER_COUNTS,
  TERRAIN_BLEND_MODES,
  TERRAIN_BLEND_SOURCES,
  TERRAIN_DEBUG_VIEWS,
  TERRAIN_QUALITY_LEVELS,
  TERRAIN_LAYER_SOURCES,
  TERRAIN_MAX_LAYERS,
  TERRAIN_MAX_RULES,
  TERRAIN_UV_MODES,
  TERRAIN_VERTEX_COLOR_LAYOUTS,
  TerrainAntiTilingSchema,
  TerrainBlendSchema,
  TerrainLayerSettingsSchema,
  TerrainMacroSettingsSchema,
  TerrainMaterialDefineSchema,
  TerrainQualityOverridesSchema,
  TerrainRuleSchema,
} from './TerrainMaterialConfig';

const read = (terrain: unknown) => readTerrainDefine({ terrain });

/** `count` layers of no settings */
const layersOf = (count: number) => Array.from({ length: count }, () => ({}));

/** A `RULES` blend of these rules, over `count` layers */
const rulesOf = (count: number, ...rules: unknown[]) => ({
  layers: layersOf(count),
  blend: { source: 'RULES', rules },
});

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
  { layers: [{}], debugView: 'WEIGHTS' },
  { layers: [{}], antiTiling: { mode: 'NONE' } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE' } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', farScale: 0.31, distance: [0, 25] } },
  { layers: [{}], antiTiling: { mode: 'HEX', hexContrast: 0.05, hexRotation: 0 } },
  { layers: [{ antiTiling: { mode: 'HEX', hexContrast: 0.95 } }], antiTiling: { mode: 'NONE' } },
  { layers: [{}], macro: { scale: 120 } },
  { layers: [{}], macro: { scale: 40, brightness: 0, hue: 180, roughness: 1 } },
  { layers: [{}], distance: { fade: [30, 90] } },
  {
    layers: [{}],
    quality: { LOW: { antiTiling: { mode: 'NONE' }, distance: { fade: [10, 20] } } },
    qualityLevel: 'LOW',
  },
  { layers: [{ heightContrast: 0, heightOffset: 0.5 }] },
  { layers: [{}], reservedTextures: 0 },
  { layers: [{}], reservedTextures: 15 },
  { layers: [{}], ao: { vertex: false, bakedAlbedoInfluence: 1 } },
  { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' } },
  { layers: layersOf(4), blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGB_AO' } } },
  {
    layers: layersOf(5),
    blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' }, mode: 'LINEAR' },
  },
  {
    layers: layersOf(3),
    blend: { source: 'VERTEX_COLOR' },
    ao: { vertex: true, bakedAlbedoInfluence: 0 },
  },
  { layers: layersOf(9), blend: { source: 'SPLAT_MAP', heightBlendDepth: 0.02 } },
  {
    layers: [{ heightContrast: 2, heightOffset: -1 }, { heightOffset: 1 }],
    blend: { source: 'SPLAT_MAP', mode: 'HEIGHT', heightBlendDepth: 0.5 },
  },
  {
    layers: layersOf(2),
    blend: { source: 'SPLAT_MAP' },
    quality: { LOW: { blend: { source: 'SPLAT_MAP', mode: 'LINEAR' } } },
    qualityLevel: 'LOW',
  },
  rulesOf(2, { layer: 1, slope: { min: 30 } }),
  rulesOf(2, { layer: 1, slope: { min: 0, max: 90, softness: 0 } }),
  rulesOf(2, { layer: 1, slope: { min: 20, max: 20 } }),
  rulesOf(2, { layer: 1, height: { min: -40, softness: 10 }, strength: 0.5 }),
  rulesOf(2, { layer: 1, aspect: { direction: [0, -1], range: 45, softness: 0 } }),
  rulesOf(2, { layer: 1, noise: { scale: 30, amount: 1, channel: 'A' } }),
  rulesOf(
    3,
    { layer: 0, slope: { max: 10 } },
    { layer: 1, height: { max: 0 } },
    { layer: 2, height: { min: 5 } }
  ),
  rulesOf(
    3,
    {
      layer: 2,
      slope: { max: 30 },
      height: { min: 40, max: 400 },
      aspect: { direction: [1, 2], range: 180 },
      noise: { scale: 0.5, amount: 0 },
      strength: 0,
    },
    { layer: 1, slope: { min: 45 } }
  ),
  {
    ...rulesOf(2, { layer: 1, slope: { min: 30 } }),
    blend: { source: 'RULES', rules: [{ layer: 1, slope: { min: 30 } }], mode: 'LINEAR' },
  },
  {
    layers: layersOf(16),
    blend: {
      source: 'RULES',
      rules: Array.from({ length: 16 }, (_, i) => ({ layer: i, height: { min: i } })),
    },
  },
  {
    layers: layersOf(6),
    blend: {
      source: 'VERTEX_COLOR_AND_RULES',
      vertexColor: { layout: 'RGBA' },
      rules: [{ layer: 5, slope: { min: 50 } }],
      heightBlendDepth: 0.1,
    },
  },
  {
    layers: layersOf(3),
    blend: { source: 'VERTEX_COLOR_AND_RULES', rules: [{ layer: 1, height: { min: 2 } }] },
    ao: { vertex: true },
  },
  {
    layers: layersOf(10),
    blend: { source: 'SPLAT_MAP_AND_RULES', rules: [{ layer: 9, slope: { min: 50 } }] },
  },
  {
    layers: layersOf(6),
    blend: {
      source: 'SPLAT_MAP_AND_RULES',
      paintedLayers: 3,
      rules: [
        { layer: 3, slope: { min: 20 } },
        { layer: 4, height: { min: 9 } },
        { layer: 5, slope: { min: 50 } },
      ],
    },
  },
  {
    layers: layersOf(3),
    blend: {
      source: 'VERTEX_COLOR_AND_RULES',
      paintedLayers: 2,
      rules: [{ layer: 2, slope: { min: 50 } }],
    },
  },
  {
    layers: layersOf(2),
    blend: { source: 'SPLAT_MAP' },
    quality: {
      HIGH: { blend: { source: 'SPLAT_MAP_AND_RULES', rules: [{ layer: 1, slope: { min: 9 } }] } },
    },
    qualityLevel: 'HIGH',
  },
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
  { layers: [{}], projection: { mode: 'TRIPLANAR' } },
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
  { layers: [{}], debugView: 'LAYER_COUNT' },
  { layers: [{}], antiTiling: {} },
  { layers: [{}], antiTiling: { mode: 'STOCHASTIC' } },
  { layers: [{}], antiTiling: { mode: 'NONE', farScale: 0.2 } },
  { layers: [{}], antiTiling: { mode: 'HEX', farScale: 0.2 } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', hexContrast: 0.5 } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', farScale: 1 } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', farScale: 0 } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', distance: [40, 6] } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', distance: [6, 6] } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', distance: [-1, 6] } },
  { layers: [{}], antiTiling: { mode: 'DUAL_SCALE', distance: [6] } },
  { layers: [{}], antiTiling: { mode: 'HEX', hexContrast: 1 } },
  { layers: [{}], antiTiling: { mode: 'HEX', hexContrast: 0 } },
  { layers: [{}], antiTiling: { mode: 'HEX', hexRotation: 1.5 } },
  { layers: [{}], antiTiling: { mode: 'HEX', apply: 'DOMINANT' } },
  { layers: [{ antiTiling: { mode: 'HEX', hexRotation: -1 } }] },
  { layers: [{}], macro: {} },
  { layers: [{}], macro: { scale: 0 } },
  { layers: [{}], macro: { scale: 120, texture: 'macroNoise' } },
  { layers: [{}], macro: { scale: 120, brightness: 2 } },
  { layers: [{}], macro: { scale: 120, hue: 200 } },
  { layers: [{}], quality: { LOW: { macro: { scale: 50 } } } },
  { layers: [{}], distance: {} },
  { layers: [{}], distance: { fade: [90, 30] } },
  { layers: [{}], distance: { fade: [30, 90], far: 'AVERAGE_COLOR' } },
  { layers: [{ heightOffset: 2 }] },
  { layers: [{}], reservedTextures: 16 },
  { layers: [{}], reservedTextures: -1 },
  { layers: [{}], reservedTextures: 2.5 },
  { layers: [{}], storage: 'ARRAY' },
  { layers: [{}], quality: { LOW: { reservedTextures: 4 } } },
  { layers: [{ heightContrast: -1 }] },
  { layers: [{}], blend: {} },
  { layers: [{}], ao: { vertex: 'yes' } },
  { layers: [{}], ao: { bakedAlbedoInfluence: 2 } },
  { layers: layersOf(2), blend: { source: 'VERTEX_COLOR', vertexColor: {} } },
  { layers: layersOf(2), blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGB' } } },
  { layers: layersOf(5), blend: { source: 'VERTEX_COLOR' } },
  { layers: layersOf(6), blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } } },
  { layers: layersOf(10), blend: { source: 'SPLAT_MAP' } },
  { layers: layersOf(2), blend: { source: 'SPLAT_MAP', vertexColor: { layout: 'RGBA' } } },
  { layers: layersOf(2), blend: { source: 'SPLAT_MAP', mode: 'LINEAR', heightBlendDepth: 0.1 } },
  { layers: layersOf(2), blend: { source: 'SPLAT_MAP', heightBlendDepth: 0.01 } },
  { layers: layersOf(2), blend: { source: 'SPLAT_MAP', mode: 'SOFT' } },
  { layers: layersOf(2), blend: { source: 'SPLAT_MAP' }, ao: { vertex: true } },
  {
    layers: layersOf(2),
    blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
    ao: { vertex: true },
  },
  {
    layers: layersOf(2),
    blend: { source: 'SPLAT_MAP' },
    quality: { LOW: { blend: { source: 'SINGLE' } } },
    qualityLevel: 'LOW',
  },
  {
    layers: layersOf(2),
    blend: { source: 'VERTEX_COLOR' },
    ao: { vertex: true },
    quality: { HIGH: { blend: { source: 'SPLAT_MAP' } } },
    qualityLevel: 'HIGH',
  },
  { layers: layersOf(2), blend: { source: 'RULES' } },
  { layers: layersOf(2), blend: { source: 'RULES', rules: [] } },
  { layers: layersOf(2), blend: { source: 'RULES', rules: {} } },
  {
    layers: layersOf(2),
    blend: {
      source: 'RULES',
      rules: Array.from({ length: TERRAIN_MAX_RULES + 1 }, () => ({ layer: 1, slope: { min: 1 } })),
    },
  },
  rulesOf(1, { layer: 0, slope: { min: 30 } }),
  rulesOf(2, { layer: 1 }),
  rulesOf(2, { layer: 1, strength: 1 }),
  rulesOf(2, { layer: 2, slope: { min: 30 } }),
  rulesOf(2, { layer: -1, slope: { min: 30 } }),
  rulesOf(2, { layer: 0.5, slope: { min: 30 } }),
  rulesOf(2, { slope: { min: 30 } }),
  rulesOf(3, { layer: 1, slope: { min: 30 } }),
  rulesOf(2, { layer: 1, slope: { min: 30 }, set: 'snow01' }),
  rulesOf(2, { layer: 1, slope: {} }),
  rulesOf(2, { layer: 1, slope: { softness: 4 } }),
  rulesOf(2, { layer: 1, slope: { min: 40, max: 30 } }),
  rulesOf(2, { layer: 1, slope: { min: -5 } }),
  rulesOf(2, { layer: 1, slope: { max: 95 } }),
  rulesOf(2, { layer: 1, slope: { min: 30, softness: -1 } }),
  rulesOf(2, { layer: 1, slope: [0, 30] }),
  rulesOf(2, { layer: 1, height: { min: 10, max: 5 } }),
  rulesOf(2, { layer: 1, height: { min: 10, step: 1 } }),
  rulesOf(2, { layer: 1, aspect: { direction: [0, 0], range: 30 } }),
  rulesOf(2, { layer: 1, aspect: { direction: [0, 1, 0], range: 30 } }),
  rulesOf(2, { layer: 1, aspect: { direction: [0, 1] } }),
  rulesOf(2, { layer: 1, aspect: { direction: [0, 1], range: 200 } }),
  rulesOf(2, { layer: 1, aspect: { direction: [0, 1], range: 30, softness: 181 } }),
  rulesOf(2, { layer: 1, noise: { scale: 30 } }),
  rulesOf(2, { layer: 1, noise: { scale: 0, amount: 0.5 } }),
  rulesOf(2, { layer: 1, noise: { scale: 30, amount: 1.5 } }),
  rulesOf(2, { layer: 1, noise: { scale: 30, amount: 0.5, channel: 'X' } }),
  rulesOf(2, { layer: 1, slope: { min: 30 }, strength: 2 }),
  {
    layers: layersOf(2),
    blend: { source: 'VERTEX_COLOR', rules: [{ layer: 1, slope: { min: 30 } }] },
  },
  {
    layers: layersOf(2),
    blend: { source: 'SPLAT_MAP', rules: [{ layer: 1, slope: { min: 30 } }] },
  },
  {
    layers: layersOf(2),
    blend: {
      source: 'RULES',
      vertexColor: { layout: 'RGBA' },
      rules: [{ layer: 1, slope: { min: 30 } }],
    },
  },
  { ...rulesOf(2, { layer: 1, slope: { min: 30 } }), ao: { vertex: true } },
  {
    layers: layersOf(5),
    blend: { source: 'VERTEX_COLOR_AND_RULES', rules: [{ layer: 1, slope: { min: 30 } }] },
  },
  {
    layers: layersOf(3),
    blend: {
      source: 'VERTEX_COLOR_AND_RULES',
      vertexColor: { layout: 'RGBA' },
      rules: [{ layer: 1, slope: { min: 30 } }],
    },
    ao: { vertex: true },
  },
  {
    layers: layersOf(11),
    blend: { source: 'SPLAT_MAP_AND_RULES', rules: [{ layer: 9, slope: { min: 50 } }] },
  },
  { layers: layersOf(17), blend: { source: 'RULES', rules: [{ layer: 1, slope: { min: 1 } }] } },
  {
    layers: layersOf(3),
    blend: {
      source: 'SPLAT_MAP_AND_RULES',
      paintedLayers: 2,
      rules: [{ layer: 1, slope: { min: 9 } }],
    },
  },
  {
    layers: layersOf(3),
    blend: {
      source: 'SPLAT_MAP_AND_RULES',
      paintedLayers: 4,
      rules: [{ layer: 2, slope: { min: 9 } }],
    },
  },
  {
    layers: layersOf(6),
    blend: {
      source: 'VERTEX_COLOR_AND_RULES',
      paintedLayers: 5,
      rules: [{ layer: 5, slope: { min: 9 } }],
    },
  },
  {
    layers: layersOf(3),
    blend: {
      source: 'SPLAT_MAP_AND_RULES',
      paintedLayers: 1,
      rules: [
        { layer: 1, slope: { min: 9 } },
        { layer: 2, slope: { min: 19 } },
      ],
    },
  },
  {
    layers: layersOf(3),
    blend: {
      source: 'SPLAT_MAP_AND_RULES',
      paintedLayers: 2.5,
      rules: [{ layer: 2, slope: { min: 9 } }],
    },
  },
  {
    layers: layersOf(3),
    blend: { source: 'RULES', paintedLayers: 2, rules: [{ layer: 2, slope: { min: 9 } }] },
  },
  { layers: layersOf(3), blend: { source: 'SPLAT_MAP', paintedLayers: 2 } },
  {
    layers: layersOf(2),
    blend: { source: 'SPLAT_MAP' },
    quality: { HIGH: { blend: { source: 'RULES', rules: [{ layer: 2, slope: { min: 9 } }] } } },
    qualityLevel: 'HIGH',
  },
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
          heightContrast: 1,
          heightOffset: 0,
          antiTiling: { mode: 'NONE' },
        },
      ],
      uv: 'WORLD',
      blend: { source: 'SINGLE' },
      aoTextureInfluence: 1,
      aoVertex: false,
      aoBakedAlbedoInfluence: 0.5,
      reservedTextures: 6,
      macro: null,
      takesMacroTexture: false,
      distanceFade: null,
      qualityLevel: null,
      debugView: null,
    });
    expect(read({ layers: [{ rotation: 0 }] }).layers[0].rotation).toBe(0);
    expect(read({ layers: [{}], antiTiling: { mode: 'DUAL_SCALE' } }).layers[0].antiTiling).toEqual(
      { mode: 'DUAL_SCALE', farScale: 0.23, distance: [6, 40] }
    );
    expect(read({ layers: [{}], antiTiling: { mode: 'HEX' } }).layers[0].antiTiling).toEqual({
      mode: 'HEX',
      hexContrast: 0.5,
      hexRotation: 1,
    });
    expect(read({ layers: [{}], macro: { scale: 120 } }).macro).toEqual({
      scale: 120,
      brightness: 0.2,
      hue: 8,
      roughness: 0.15,
    });
    expect(read({ layers: [{}], distance: { fade: [30, 90] } }).distanceFade).toEqual([30, 90]);
    expect(read({ layers: layersOf(2), blend: { source: 'VERTEX_COLOR' } }).blend).toEqual({
      source: 'VERTEX_COLOR',
      layout: 'RGB_AO',
      heightBlend: 0.2,
      rules: [],
      paintedLayers: null,
    });
    expect(
      read({ layers: layersOf(2), blend: { source: 'SPLAT_MAP', mode: 'LINEAR' } }).blend
    ).toEqual({ source: 'SPLAT_MAP', heightBlend: null, rules: [], paintedLayers: null });
  });

  it("fills a rule's defaults, its tests not given null", () => {
    const rule = { layer: 1, slope: { min: 30 }, height: { max: 12 } };
    expect(read(rulesOf(2, rule)).blend).toEqual({
      source: 'RULES',
      heightBlend: 0.2,
      paintedLayers: null,
      rules: [
        {
          layer: 1,
          slope: { min: 30, max: null, softness: 5 },
          height: { min: null, max: 12, softness: 2 },
          aspect: null,
          noise: null,
          strength: 1,
        },
      ],
    });
    const facing = { layer: 1, aspect: { direction: [0, -2], range: 40 } };
    expect(read(rulesOf(2, facing)).blend).toMatchObject({
      rules: [{ aspect: { direction: [0, -2], range: 40, softness: 15 } }],
    });
    const noisy = { layer: 1, noise: { scale: 50, amount: 0.3 } };
    expect(read(rulesOf(2, noisy)).blend).toMatchObject({
      rules: [{ noise: { scale: 50, amount: 0.3, channel: 'R' } }],
    });
    const combo = read({
      layers: layersOf(2),
      blend: { source: 'VERTEX_COLOR_AND_RULES', rules: [rule], mode: 'LINEAR' },
    });
    expect(combo.blend).toMatchObject({ layout: 'RGB_AO', heightBlend: null });
  });

  it("takes the macro input with a macro or rule noise, a tier's included", () => {
    const noisy = { layer: 1, noise: { scale: 50, amount: 0.3 } };
    expect(read(rulesOf(2, { layer: 1, slope: { min: 9 } })).takesMacroTexture).toBe(false);
    expect(read(rulesOf(2, noisy)).takesMacroTexture).toBe(true);
    expect(read({ layers: [{}], macro: { scale: 50 } }).takesMacroTexture).toBe(true);
    const tierNoise = {
      layers: layersOf(2),
      blend: { source: 'SPLAT_MAP' },
      quality: { ULTRA: { blend: { source: 'SPLAT_MAP_AND_RULES', rules: [noisy] } } },
    };
    expect(read(tierNoise).takesMacroTexture).toBe(true);
    expect(read({ ...tierNoise, qualityLevel: 'LOW' }).takesMacroTexture).toBe(true);
  });

  it("gives a layer its own anti-tiling, else the material's (its tier's)", () => {
    const define = {
      layers: [{ antiTiling: { mode: 'NONE' } }],
      antiTiling: { mode: 'HEX' },
      quality: { LOW: { antiTiling: { mode: 'DUAL_SCALE', farScale: 0.5 } } },
    };
    expect(read(define).layers[0].antiTiling).toEqual({ mode: 'NONE' });
    const { antiTiling: _own, ...shared } = define.layers[0];
    const withShared = { ...define, layers: [shared] };
    expect(read(withShared).layers[0].antiTiling.mode).toBe('HEX');
    expect(read({ ...withShared, qualityLevel: 'LOW' }).layers[0].antiTiling).toEqual({
      mode: 'DUAL_SCALE',
      farScale: 0.5,
      distance: [6, 40],
    });
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
    const { ao, distance } = TerrainMaterialDefineSchema.shape;
    expect(values.aoKeys.sort()).toEqual(Object.keys(ao.unwrap().shape).sort());
    for (const option of TerrainBlendSchema.options) {
      const source = option.shape.source.value;
      expect(values.blendKeys[source].sort(), source).toEqual(Object.keys(option.shape).sort());
    }
    expect(TerrainBlendSchema.options.map((option) => option.shape.source.value)).toEqual([
      ...TERRAIN_BLEND_SOURCES,
    ]);
    const vertexColor = TerrainBlendSchema.options[1].shape.vertexColor.unwrap();
    expect(values.vertexColorKeys.sort()).toEqual(Object.keys(vertexColor.shape).sort());
    expect(values.blendModes).toEqual(TERRAIN_BLEND_MODES);
    expect(values.vertexColorLayouts).toEqual(TERRAIN_VERTEX_COLOR_LAYOUTS);
    expect(values.blendLayerCounts).toEqual(TERRAIN_BLEND_LAYER_COUNTS);
    expect(values.distanceKeys.sort()).toEqual(Object.keys(distance.unwrap().shape).sort());
    expect(values.macroKeys.sort()).toEqual(Object.keys(TerrainMacroSettingsSchema.shape).sort());
    for (const option of TerrainAntiTilingSchema.options) {
      const mode = option.shape.mode.value;
      expect(values.antiTilingKeys[mode].sort(), mode).toEqual(Object.keys(option.shape).sort());
    }
    expect(values.antiTilingModes).toEqual(TERRAIN_ANTI_TILING_MODES);
    expect(TerrainAntiTilingSchema.options.map((option) => option.shape.mode.value)).toEqual([
      ...TERRAIN_ANTI_TILING_MODES,
    ]);
    expect(values.overrideKeys.sort()).toEqual(
      Object.keys(TerrainQualityOverridesSchema.shape).sort()
    );
    expect(values.qualityLevels).toEqual(TERRAIN_QUALITY_LEVELS);
    expect(values.debugViews).toEqual(TERRAIN_DEBUG_VIEWS);
    expect(values.layerSources).toEqual(TERRAIN_LAYER_SOURCES);
    expect(values.uvModes).toEqual(TERRAIN_UV_MODES);
    expect(values.blendSources).toEqual(TERRAIN_BLEND_SOURCES);
    expect(values.maxLayers).toBe(TERRAIN_MAX_LAYERS);
    expect(values.maxRules).toBe(TERRAIN_MAX_RULES);
    const rule = TerrainRuleSchema.shape;
    expect(values.ruleKeys.sort()).toEqual(Object.keys(rule).sort());
    for (const range of [rule.slope, rule.height]) {
      const shape = range.unwrap().shape;
      expect(values.ruleRangeKeys.sort()).toEqual(Object.keys(shape).sort());
    }
    expect(values.ruleAspectKeys.sort()).toEqual(Object.keys(rule.aspect.unwrap().shape).sort());
    const noise = rule.noise.unwrap().shape;
    expect(values.ruleNoiseKeys.sort()).toEqual(Object.keys(noise).sort());
    expect(noise.channel.unwrap().options).toEqual([...TERRAIN_RULE_NOISE_CHANNELS]);
  });

  it("validates geometry's TerrainRule", () => {
    expectTypeOf<z.infer<typeof TerrainRuleSchema>>().toEqualTypeOf<TerrainRule>();
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
    expect(() => read({ layers: [{ antiTiling: { mode: 'HEX', hexContrast: 1 } }] })).toThrow(
      "staticDefines.terrain.layers[0].antiTiling.hexContrast: is 1: it's at least 0.05 and at most 0.95."
    );
    expect(() => read({ layers: [{}], antiTiling: { mode: 'NONE', farScale: 0.2 } })).toThrow(
      'staticDefines.terrain.antiTiling: has no field "farScale" (fields: mode).'
    );
    expect(() => read({ layers: layersOf(5), blend: { source: 'VERTEX_COLOR' } })).toThrow(
      'staticDefines.terrain.layers: blend.source VERTEX_COLOR (RGB_AO) takes 2 to 4 layers, not 5.'
    );
    expect(() =>
      read({
        layers: layersOf(2),
        blend: { source: 'SPLAT_MAP', mode: 'LINEAR', heightBlendDepth: 0.1 },
      })
    ).toThrow(
      'staticDefines.terrain.blend.heightBlendDepth: is for blend.mode HEIGHT, not LINEAR.'
    );
    expect(() => read({ layers: [{}], ao: { vertex: true } })).toThrow(
      'staticDefines.terrain.ao.vertex: needs blend.source VERTEX_COLOR or VERTEX_COLOR_AND_RULES with the RGB_AO layout.'
    );
    expect(() => read(rulesOf(3, { layer: 1, slope: { min: 30 } }))).toThrow(
      "staticDefines.terrain.layers[2]: is neither painted nor a rule's layer: nothing weighs it."
    );
    expect(() => read(rulesOf(2, { layer: 4, slope: { min: 30 } }))).toThrow(
      'staticDefines.terrain.blend.rules[0].layer: is 4: there are 2 layers.'
    );
    expect(() => read(rulesOf(2, { layer: 1, slope: { min: 40, max: 30 } }))).toThrow(
      'staticDefines.terrain.blend.rules[0].slope: has min 40 over max 30'
    );
    expect(() => read(rulesOf(2, { layer: 1 }))).toThrow(
      'staticDefines.terrain.blend.rules[0]: has no test: give slope, height, aspect or noise.'
    );
    expect(() => read({ layers: [{}], macro: {} })).toThrow(
      'staticDefines.terrain.macro.scale: is missing'
    );
    expect(() =>
      read({
        layers: [{}],
        quality: { HIGH: { distance: { fade: [5, 1] } } },
        qualityLevel: 'HIGH',
      })
    ).toThrow('staticDefines.terrain.quality.HIGH.distance.fade: is [5, 1]');
  });
});
