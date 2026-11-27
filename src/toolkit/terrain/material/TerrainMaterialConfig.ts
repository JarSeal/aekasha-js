// The terrain material's config (p305 D1), as Zod schemas and the types inferred from them: the
// code route's `TerrainMaterialConfig` (`createTerrainMaterial`) and the JSON route's static define
// (`staticDefines.terrain`, `TerrainMaterialDefine`), which is the config without the material's
// id and the layers' sets: the sets are the material's inputs (`layer<i>`), which the gather's
// texture closure reads and a variant swaps per block without another shader. The graph
// (`TerrainMaterial.ts`) imports only types from here, so a build that uses the generator carries
// no zod: it checks the define's values by hand as it reads them (the tests keep both in step).
// Each phase of p305 adds its fields: a key the schema doesn't know is refused. Over 800 lines:
// every field is documented twice (its JSDoc for the API docs, its `.describe()` for the JSON
// schema), and both schemas' refinements are here.
import { z } from 'zod';
import { TERRAIN_RULE_NOISE_CHANNELS } from 'aekasha/toolkit/geometry';

/**
 * What a layer samples: `TEXTURE` its texture set's maps; `PROCEDURAL_LIVE` its procedural set's
 * generator run live in the material (p305 Phase 8: no repetition, no texture memory, the whole
 * graph per pixel).
 */
export const TERRAIN_LAYER_SOURCES = ['TEXTURE', 'PROCEDURAL_LIVE'] as const;
/**
 * A live layer's normal where its generator gives none: `BUMP` (default) its height bumped, `TAPS`
 * a bake's central differences (4 more evaluations of the height a pixel).
 */
export const TERRAIN_LIVE_NORMALS = ['BUMP', 'TAPS'] as const;
/**
 * A live layer's AO where its generator gives none: `NONE` (default), or `CAVITY` a bake's cavity
 * (8 more evaluations of the height a pixel).
 */
export const TERRAIN_LIVE_AOS = ['NONE', 'CAVITY'] as const;
/**
 * The space the material samples in (p305 D8): `WORLD` (default) the world's position and normal,
 * seamless across pieces; `OBJECT` the mesh's own (scaled back to metres), so the texture sticks to
 * a piece that moves or turns (an `InstancedMesh`'s instances share its space).
 */
export const TERRAIN_SPACES = ['WORLD', 'OBJECT'] as const;
/** The tiling coordinates: `WORLD` (the world's `(x, −z)`, seen from above) or `MESH_UV`. */
export const TERRAIN_UV_MODES = ['WORLD', 'MESH_UV'] as const;
/**
 * Where the layers' weights come from (p305 D4): `SINGLE` one layer everywhere, `VERTEX_COLOR` the
 * mesh's colour attribute, `SPLAT_MAP` one or two RGBA textures at the mesh's UV, `RULES` the base
 * layer under procedural rules (slope, height, facing, noise), and `VERTEX_COLOR_AND_RULES` and
 * `SPLAT_MAP_AND_RULES` the painted weights under rules.
 */
export const TERRAIN_BLEND_SOURCES = [
  'SINGLE',
  'VERTEX_COLOR',
  'SPLAT_MAP',
  'RULES',
  'VERTEX_COLOR_AND_RULES',
  'SPLAT_MAP_AND_RULES',
] as const;
/**
 * How painted weights blend the layers: `HEIGHT` (default) by each layer's height (Mishkinis), so
 * the higher surface (pebbles, a rock's top) shows through a border; `LINEAR` by the weights alone.
 */
export const TERRAIN_BLEND_MODES = ['HEIGHT', 'LINEAR'] as const;
/**
 * The vertex colour's channels (p301 §4.4): `RGB_AO` R, G and B weigh layers 1-3 and A is a baked
 * AO; `RGBA` the four weigh layers 1-4. Layer 0 takes what the channels leave (1 − their sum).
 */
export const TERRAIN_VERTEX_COLOR_LAYOUTS = ['RGB_AO', 'RGBA'] as const;
/**
 * The layers each blend source takes, `[min, max]`: `SINGLE` one; a vertex colour the base and one
 * per weight channel (`RGB_AO` 3, `RGBA` 4); splat maps the base and four per map (two maps at
 * most); the rules and the combos up to 16, the painted source's own count painted (from layer 0)
 * and each layer past them a rule's.
 */
export const TERRAIN_BLEND_LAYER_COUNTS = {
  SINGLE: [1, 1],
  VERTEX_COLOR_RGB_AO: [2, 4],
  VERTEX_COLOR_RGBA: [2, 5],
  SPLAT_MAP: [2, 9],
  RULES: [2, 16],
  VERTEX_COLOR_AND_RULES: [2, 16],
  SPLAT_MAP_AND_RULES: [2, 16],
} as const;
/** The texture set packings a terrain material samples (p303 D2). */
export const TERRAIN_PACKINGS = ['FULL', 'LITE', 'MINIMAL'] as const;
/**
 * How the code route binds the layers' textures (p305 D9): `AUTO` (default) `SEPARATE` while that
 * fits the texture budget and nothing samples the layers in slots (`sparse`, `HEX`'s `DOMINANT`),
 * else `ARRAY`; `SEPARATE` each layer's packing slots (`{ textureSet }` inputs `layer<i>`); `ARRAY`
 * one array texture per slot for every layer (a `{ textureSetArray }` input `layers`).
 */
export const TERRAIN_STORAGES = ['AUTO', 'SEPARATE', 'ARRAY'] as const;
/** The quality tiers a terrain material's `quality` table overrides (p240's scale). */
export const TERRAIN_QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;
/**
 * The debug views (debug env only): `TEXEL_DENSITY` a 1 m checker in bands of texels per metre,
 * `NORMALS` the shaded normal in world space, `WEIGHTS` each layer's false colour by its weight,
 * `PROJECTION` the planes' weights (X red, Y green, Z blue) with the slope gates' bands striped,
 * `TAPS` the material's own texture fetches at the pixel in bands, `LAYER_COUNT` how many layers
 * weigh in at the pixel, striped where sparse sampling drops one, `WETNESS` the wet response's
 * masks (R the pores, G the film; needs `wet`).
 */
export const TERRAIN_DEBUG_VIEWS = [
  'TEXEL_DENSITY',
  'NORMALS',
  'WEIGHTS',
  'PROJECTION',
  'TAPS',
  'LAYER_COUNT',
  'WETNESS',
] as const;
/**
 * The wet response's quality (p307 D2): `FULL` the relief and the cavities shape the wetness and
 * the film flattens the normal, `SIMPLE` the layers' response and the sky exposure only.
 */
export const TERRAIN_WET_QUALITIES = ['FULL', 'SIMPLE'] as const;
/**
 * What keeps the rain off a surface (p307 T6, T12): `NORMAL_Y` its facing alone (overhangs and
 * undersides), `MAP` also the `rainOcclusion()` feature's map (roofs, trees, bridges).
 */
export const TERRAIN_WET_RAIN_OCCLUSIONS = ['NORMAL_Y', 'MAP'] as const;

/**
 * The splat channels a regional wetness reads (p307 T7): the first splat map's A.
 * @internal
 */
export const TERRAIN_WET_SPLAT_CHANNELS = ['A'] as const;
/**
 * What a far surface shows past `distance.fade`'s end, where the layers aren't sampled (p305 D7):
 * `NONE` (default) the layers at every distance, `AVERAGE_COLOR` each layer's set's average colour
 * by its weight (no layer fetch), `COLOR_MAP` the colour map (one fetch).
 */
export const TERRAIN_FAR_MODES = ['NONE', 'AVERAGE_COLOR', 'COLOR_MAP'] as const;
/**
 * How a colour map (a texture at the mesh's UV) colours the surface (p305 D7): `DETAIL` it gives
 * the albedo and the layers their detail (each one's albedo over its set's average colour);
 * `FAR_ONLY` it's only the far surface's colour (`distance.far: 'COLOR_MAP'`).
 */
export const TERRAIN_COLOR_MAP_MODES = ['DETAIL', 'FAR_ONLY'] as const;
/** The most layers a terrain material blends. */
export const TERRAIN_MAX_LAYERS = 16;
/** The most rules a terrain material's blend takes. */
export const TERRAIN_MAX_RULES = 16;
/**
 * The anti-tiling modes (p305 D3): `NONE` plain tiling (1 tap), `DUAL_SCALE` a second, larger and
 * turned tap mixed in by distance and the macro texture's patches (2), `HEX` Mikkelsen's hex
 * tiling (3).
 */
export const TERRAIN_ANTI_TILING_MODES = ['NONE', 'DUAL_SCALE', 'HEX'] as const;
/**
 * Which layers `HEX` samples (p305 D3): `ALL` (default) every layer; `DOMINANT` the layer weighing
 * most at the pixel, the others `DUAL_SCALE`. `DOMINANT` sorts the layers by weight at the pixel
 * (the slot path, as `sparse` does), so it needs `ARRAY` storage.
 */
export const TERRAIN_ANTI_TILING_APPLIES = ['ALL', 'DOMINANT'] as const;
/** The most layers sparse sampling keeps at a pixel, and the fewest (p305 D6). */
export const TERRAIN_SPARSE_MAX_LAYERS = [2, 4] as const;
/**
 * How a layer's texture meets the surface (p305 D5): `PLANAR` the tiling's coordinates alone (the
 * world's `(x, −z)` or the mesh's UV; 1 tap per slot), `BIPLANAR` the world projected along the two
 * axes the surface faces most (Quilez; 2), `TRIPLANAR` along all three (3).
 */
export const TERRAIN_PROJECTION_MODES = ['PLANAR', 'BIPLANAR', 'TRIPLANAR'] as const;
/**
 * How a projected plane's normal map meets the geometry's normal (Golus, "Normal Mapping for a
 * Triplanar Shader"): `WHITEOUT` (default) the slopes added and the Z's multiplied, `UDN` the
 * slopes added (cheaper, flatter), `RNM` reoriented (the most faithful, the most ALU).
 */
export const TERRAIN_NORMAL_BLENDS = ['WHITEOUT', 'UDN', 'RNM'] as const;

const srgbColor = (description: string) =>
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'an sRGB colour, "#rrggbb"')
    .describe(description);

/** A `[from, to]` range of metres, `from` under `to` */
const metreRange = (description: string) =>
  z
    .tuple([z.number().min(0), z.number().min(0)])
    .refine(([from, to]) => from < to, 'the first value under the second')
    .describe(description);

/** `DUAL_SCALE`'s numbers, which `HEX` with `apply: 'DOMINANT'` gives its other layers too */
const dualScaleFields = (of: string) => ({
  /** The second tap's scale of the UV, under 1 (default 0.23: tiles 4.3 × as large). */
  farScale: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      `${of}The second tap's scale of the UV, under 1 (default 0.23: tiles 4.3 × as large).`
    ),
  /**
   * The view distances in metres over which the second tap's share grows from the near share to
   * the far one (default `[6, 40]`).
   */
  distance: metreRange(
    `${of}The view distances in metres over which the second tap's share grows (default [6, 40]).`
  ).optional(),
});

// p305 D3
/**
 * How a layer breaks its tiling's repetition, by `mode`: `NONE`, `DUAL_SCALE` or `HEX`,
 * each with its own fields. The numbers are uniforms (`terrain_l<i>_<name>`), the mode a build-time
 * branch.
 */
export const TerrainAntiTilingSchema = z
  .discriminatedUnion('mode', [
    z
      .object({
        /** Plain tiling: one tap. */
        mode: z.literal('NONE').describe('Plain tiling: one tap.'),
      })
      .strict(),
    z
      .object({
        /**
         * A second tap at the UV × `farScale`, turned 37°, mixed in with the distance and (with a
         * `macro` texture) its patches: 2 taps.
         */
        mode: z
          .literal('DUAL_SCALE')
          .describe(
            "A second tap at the UV × farScale, turned 37°, mixed in with the distance and the macro texture's patches: 2 taps."
          ),
        ...dualScaleFields(''),
      })
      .strict(),
    z
      .object({
        /**
         * Mikkelsen's practical hex tiling: 3 taps on a hex lattice, each offset and turned at
         * random, sampled with the UV's own gradients (no mip seams), weighted by height.
         */
        mode: z
          .literal('HEX')
          .describe(
            "Mikkelsen's practical hex tiling: 3 taps on a hex lattice, each offset and turned at random, weighted by height."
          ),
        /**
         * The taps' blend contrast, 0.05..0.95 (Mikkelsen's gain, default 0.5): over 0.5 sharper
         * borders between the hexes, under softer.
         */
        hexContrast: z
          .number()
          .min(0.05)
          .max(0.95)
          .optional()
          .describe(
            "The taps' blend contrast, 0.05..0.95 (default 0.5): over 0.5 sharper borders between the hexes, under softer."
          ),
        /**
         * How far a tap may turn, 0..1 of a full turn either way (default 1): lower for a
         * directional texture (ripples, strata), 0 for none.
         */
        hexRotation: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'How far a tap may turn, 0..1 of a full turn either way (default 1): lower for a directional texture, 0 for none.'
          ),
        /**
         * Which layers sample `HEX` (default `ALL`): `DOMINANT` the one weighing most at the pixel,
         * the others `DUAL_SCALE` (`farScale`, `distance`): 3 taps for it, 2 for each other. Needs
         * `ARRAY` storage, every layer's anti-tiling alike.
         */
        apply: z
          .enum(TERRAIN_ANTI_TILING_APPLIES)
          .optional()
          .describe(
            'Which layers sample HEX (default ALL): DOMINANT the one weighing most at the pixel, the others DUAL_SCALE. Needs ARRAY storage.'
          ),
        ...dualScaleFields("With apply DOMINANT, the other layers' DUAL_SCALE: "),
      })
      .strict(),
  ])
  .describe("How a layer breaks its tiling's repetition: NONE, DUAL_SCALE or HEX.");

// p305 D3
/** How a layer breaks its tiling's repetition: `NONE`, `DUAL_SCALE` or `HEX`. */
export type TerrainAntiTiling = z.infer<typeof TerrainAntiTilingSchema>;

/** The fields both projecting modes take, their sharpness's default the mode's */
const projectedFields = (
  mode: 'BIPLANAR' | 'TRIPLANAR',
  description: string,
  sharpness: string
) => ({
  mode: z.literal(mode).describe(description),
  /** The facing weights' sharpness, 1..32: higher narrows the bands where planes blend. */
  sharpness: z
    .number()
    .min(1)
    .max(32)
    .optional()
    .describe(`The facing weights' sharpness, 1..32 (${sharpness}): higher narrows the blends.`),
  /**
   * The slopes in degrees (`[from, to]`, 0..90) over which the projection fades in over `PLANAR`:
   * under `from` the layer is planar (1 tap), past `to` projected, between both mixed. A dynamic
   * branch, so only the pixels past `from` pay for the projection's taps.
   */
  slopeGate: z
    .tuple([z.number().min(0).max(90), z.number().min(0).max(90)])
    .refine(([from, to]) => from < to, 'the first value under the second')
    .optional()
    .describe(
      'The slopes in degrees ([from, to], 0..90) over which the projection fades in over PLANAR: under from planar (1 tap), past to projected.'
    ),
  /** How each plane's normal map meets the geometry's normal (default `WHITEOUT`). */
  normalBlend: z
    .enum(TERRAIN_NORMAL_BLENDS)
    .optional()
    .describe(
      "How each plane's normal map meets the geometry's normal: WHITEOUT (default), UDN or RNM."
    ),
});

// p305 D5
/**
 * How a layer's texture meets the surface, by `mode`: `PLANAR`, `BIPLANAR` or
 * `TRIPLANAR`, the projecting modes with their sharpness, slope gate and normal blend. The numbers
 * are uniforms (`terrain_l<i>_<name>`), the mode, the gate's presence and the normal blend
 * build-time branches. The projecting modes need `uv: 'WORLD'`.
 */
export const TerrainProjectionSchema = z
  .discriminatedUnion('mode', [
    z
      .object({
        /** The tiling's coordinates alone (the world's `(x, −z)` or the mesh's UV): 1 tap. */
        mode: z
          .literal('PLANAR')
          .describe(
            "The tiling's coordinates alone (the world's (x, -z) or the mesh's UV): 1 tap."
          ),
      })
      .strict(),
    z
      .object(
        projectedFields(
          'BIPLANAR',
          'The world projected along the two axes the surface faces most (Quilez): 2 taps, with gradients.',
          "default 8, Quilez's k"
        )
      )
      .strict(),
    z
      .object(
        projectedFields(
          'TRIPLANAR',
          'The world projected along all three axes, weighted by the facing: 3 taps.',
          'default 4, the exponent on the facing'
        )
      )
      .strict(),
  ])
  .describe("How a layer's texture meets the surface: PLANAR, BIPLANAR or TRIPLANAR.");

// p305 D5
/** How a layer's texture meets the surface: `PLANAR`, `BIPLANAR` or `TRIPLANAR`. */
export type TerrainProjection = z.infer<typeof TerrainProjectionSchema>;

/** What a layer samples: {@link TERRAIN_LAYER_SOURCES}' */
const layerSourceField = z
  .enum(TERRAIN_LAYER_SOURCES)
  .optional()
  .describe(
    "What the layer samples: TEXTURE (default), its texture set's maps; PROCEDURAL_LIVE, its procedural set's generator run live (no repetition, no texture memory, the whole graph per pixel)."
  );

/**
 * A live layer's taps (`source: 'PROCEDURAL_LIVE'`): what its normal and AO take where its
 * generator gives none.
 */
export const TerrainLiveSchema = z
  .object({
    /** The normal: `BUMP` (default) its height bumped; `TAPS` 4 more height evaluations. */
    normal: z
      .enum(TERRAIN_LIVE_NORMALS)
      .optional()
      .describe('The normal: BUMP (default) its height bumped; TAPS 4 more height evaluations.'),
    /** The AO: `NONE` (default); `CAVITY` 8 more height evaluations. */
    ao: z
      .enum(TERRAIN_LIVE_AOS)
      .optional()
      .describe('The AO: NONE (default); CAVITY 8 more height evaluations.'),
  })
  .strict()
  .describe("A live layer's taps: what its normal and AO take where its generator gives none.");

/** A live layer's taps: what its normal and AO take where its generator gives none. */
export type TerrainLive = z.infer<typeof TerrainLiveSchema>;

/**
 * A layer's settings, without its set: the static define's layer. Each tunable becomes a uniform
 * (`terrain_l<i>_<name>` in the material's `userData.uniforms`), so the material editor and code
 * edit it live; a multiplier applies over the set's own `surface` field of that name.
 */
export const TerrainLayerSettingsSchema = z
  .object({
    /**
     * What the layer samples: `TEXTURE` (default), its texture set's maps; `PROCEDURAL_LIVE`, its
     * procedural set's generator run live (its set baked too, for a tier that samples the bake).
     * A live layer takes no anti-tiling (its surface never repeats), and it's sampled beside the
     * slots of sparse sampling and `DOMINANT`, not in them.
     */
    source: layerSourceField,
    /** A live layer's taps for its normal and AO (a layer some context samples live only). */
    live: TerrainLiveSchema.optional(),
    /** × the set's `physicalSize` (default 1): 2 tiles twice as large. */
    tiling: z
      .number()
      .positive()
      .optional()
      .describe("× the set's physicalSize (default 1): 2 tiles twice as large."),
    /**
     * Degrees the tiling turns (counter-clockwise from above), breaking the alignment of layers
     * that share a tile size; compiled only when given.
     */
    rotation: z
      .number()
      .optional()
      .describe(
        'Degrees the tiling turns (counter-clockwise from above), breaking the alignment of layers; compiled only when given.'
      ),
    /** × the set's `tint` (default white), an sRGB `#rrggbb`. */
    tint: srgbColor('× the set\'s tint (default white), an sRGB "#rrggbb".').optional(),
    /** × the set's `normalStrength` (default 1): the normal's slope, or `MINIMAL`'s bump. */
    normalStrength: z
      .number()
      .min(0)
      .optional()
      .describe("× the set's normalStrength (default 1): the normal's slope, or MINIMAL's bump."),
    /** × the set's `roughnessScale` (default 1); the roughness is capped at 1. */
    roughnessScale: z
      .number()
      .min(0)
      .optional()
      .describe("× the set's roughnessScale (default 1); the roughness is capped at 1."),
    /**
     * × the set's `heightContrast` (default 1): the height's contrast about its middle (0.5) for
     * the height blend, over 1 sharper borders, under softer. Read with `blend.mode: 'HEIGHT'`.
     */
    heightContrast: z
      .number()
      .min(0)
      .optional()
      .describe(
        "× the set's heightContrast (default 1): the height's contrast about 0.5 for the height blend. Read with blend.mode HEIGHT."
      ),
    /**
     * Added to the height for the height blend, −1..1 (default 0): over 0 the layer rises through
     * its neighbours' borders, under 0 it sinks. Read with `blend.mode: 'HEIGHT'`.
     */
    heightOffset: z
      .number()
      .min(-1)
      .max(1)
      .optional()
      .describe(
        "Added to the height for the height blend, -1..1 (default 0): over 0 the layer rises through its neighbours' borders. Read with blend.mode HEIGHT."
      ),
    /** The layer's own anti-tiling, in place of the material's (its whole object). */
    antiTiling: TerrainAntiTilingSchema.optional(),
    /** The layer's own projection, in place of the material's (its whole object): eg. cliffs. */
    projection: TerrainProjectionSchema.optional(),
  })
  .strict()
  .describe("A terrain layer's settings, without its set (the static define's layer).");

/** A terrain layer's settings without its set: the JSON route's `staticDefines.terrain.layers[i]`. */
export type TerrainLayerSettings = z.infer<typeof TerrainLayerSettingsSchema>;

/** A terrain layer of the code route: its texture set and its settings. */
export const TerrainLayerSchema = TerrainLayerSettingsSchema.extend({
  /** The texture set's id (a `*.textureSet.json`). */
  set: z.string().min(1).describe("The texture set's id (a *.textureSet.json)."),
})
  .strict()
  .describe('A terrain layer: its texture set and its settings.');

/** A terrain layer of {@link createTerrainMaterial}'s config: its texture set and its settings. */
export type TerrainLayer = z.infer<typeof TerrainLayerSchema>;

/** The fields both painted sources take: how their weights blend the layers */
const paintedBlendFields = {
  /** `HEIGHT` (default) by the layers' heights, `LINEAR` by the weights alone. */
  mode: z
    .enum(TERRAIN_BLEND_MODES)
    .optional()
    .describe("HEIGHT (default) by the layers' heights, LINEAR by the weights alone."),
  /**
   * The height blend's transition, 0.02..0.5 of the heights' range (default 0.2): smaller is a
   * sharper border. A uniform (`terrain_heightBlendDepth`); `HEIGHT` only.
   */
  heightBlendDepth: z
    .number()
    .min(0.02)
    .max(0.5)
    .optional()
    .describe(
      "The height blend's transition, 0.02..0.5 of the heights' range (default 0.2): smaller is a sharper border. HEIGHT only."
    ),
};

/** A rule's range of one measure, its ends within `bounds` when it has some */
const ruleRange = (unit: string, bounds: [number, number] | null, description: string) => {
  const end = () => (bounds ? z.number().min(bounds[0]).max(bounds[1]) : z.number());
  return z
    .object({
      /** The lowest value at which the rule is whole; none: no lower end. */
      min: end()
        .optional()
        .describe(`The lowest ${unit} at which the rule is whole; none: no lower end.`),
      /** The highest value at which the rule is whole; none: no upper end. */
      max: end()
        .optional()
        .describe(`The highest ${unit} at which the rule is whole; none: no upper end.`),
      /** How far past each end the rule fades out to 0, in the range's units (≥ 0). */
      softness: z
        .number()
        .min(0)
        .optional()
        .describe(`The ${unit} past each end over which the rule fades out to 0.`),
    })
    .strict()
    .refine((range) => range.min !== undefined || range.max !== undefined, 'give min, max or both')
    .refine(
      (range) => range.min === undefined || range.max === undefined || range.min <= range.max,
      'min at most max'
    )
    .describe(description);
};

/**
 * A procedural rule (p305 D4; the type is `aekasha/toolkit/geometry`'s `TerrainRule`, which the
 * CPU evaluation shares): where the slope, height and facing are in its ranges, its layer covers
 * the layers under it, the coverage moved by a macro noise channel and × its strength. Its
 * numbers are uniforms (`terrain_r<i>_<name>`), its tests build-time branches.
 */
export const TerrainRuleSchema = z
  .object({
    /** The layer this rule lays down, by its index in the material's layers. */
    layer: z
      .number()
      .int()
      .min(0)
      .max(TERRAIN_MAX_LAYERS - 1)
      .describe("The layer this rule lays down, by its index in the material's layers."),
    /** The slope in degrees (0 flat, 90 a vertical face; default softness 5). */
    slope: ruleRange(
      'slope in degrees',
      [0, 90],
      'The slope in degrees (0 flat, 90 a vertical face; default softness 5).'
    ).optional(),
    /** The world height in metres (default softness 2). */
    height: ruleRange(
      'height in metres',
      null,
      'The world height in metres (default softness 2).'
    ).optional(),
    /**
     * The surface's facing: its downhill direction within `range` degrees of `direction`; flat
     * ground passes.
     */
    aspect: z
      .object({
        /** The facing, a horizontal world direction `[x, z]` (its length doesn't matter, not 0). */
        direction: z
          .tuple([z.number(), z.number()])
          .refine(([x, z]) => x !== 0 || z !== 0, 'a direction, not [0, 0]')
          .describe('The facing, a horizontal world direction [x, z] (not [0, 0]).'),
        /** Degrees either side of `direction` at which the rule is whole, 0..180. */
        range: z
          .number()
          .min(0)
          .max(180)
          .describe('Degrees either side of direction at which the rule is whole, 0..180.'),
        /** Degrees past `range` over which the rule fades out, 0..180 (default 15). */
        softness: z
          .number()
          .min(0)
          .max(180)
          .optional()
          .describe('Degrees past range over which the rule fades out, 0..180 (default 15).'),
      })
      .strict()
      .optional()
      .describe("The surface's facing: its downhill direction within range degrees of direction."),
    /**
     * A macro noise channel at the world's `(x, −z) / scale` that raises and lowers the coverage
     * by up to `amount`: the material's macro texture (the input `macro`), one fetch per rule.
     */
    noise: z
      .object({
        /** The metres one tile of the noise texture covers. */
        scale: z.number().positive().describe('The metres one tile of the noise texture covers.'),
        /** How far the noise moves the coverage either way, 0..1. */
        amount: z
          .number()
          .min(0)
          .max(1)
          .describe('How far the noise moves the coverage either way, 0..1.'),
        /** The macro noise texture's channel (default `R`). */
        channel: z
          .enum(TERRAIN_RULE_NOISE_CHANNELS)
          .optional()
          .describe("The macro noise texture's channel (default R)."),
      })
      .strict()
      .optional()
      .describe(
        'A macro noise channel that raises and lowers the coverage by up to amount (the input macro).'
      ),
    /** The coverage's scale, 0..1 (default 1): under 1 the layers under it show through. */
    strength: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('The coverage scale, 0..1 (default 1): under 1 the layers under it show through.'),
  })
  .strict()
  .refine(
    (rule) => Boolean(rule.slope || rule.height || rule.aspect || rule.noise),
    'give slope, height, aspect or noise'
  )
  .describe('A procedural rule: its layer covers the others where the surface is in its ranges.');

/** The rules' list of a blend source that takes them */
const rulesField = {
  /**
   * The rules, 1 to 16, in order: each composites its layer over the weights so far
   * (`w = mix(w, onehot(layer), coverage)`).
   */
  rules: z
    .array(TerrainRuleSchema)
    .min(1)
    .max(TERRAIN_MAX_RULES)
    .describe('The rules, 1 to 16, in order: each composites its layer over the weights so far.'),
};

/** A combo's painted layers: the paint weighs layers 0 to this − 1, the rules the rest */
const paintedLayersField = {
  /**
   * The layers the paint weighs, from layer 0 (2 or more; default and most: the painted
   * source's, 4 for `RGB_AO`, 5 for `RGBA`, 9 for splat maps, or the layer count): a layer past
   * them is a rule's. Fewer painted layers read fewer channels (or splat maps).
   */
  paintedLayers: z
    .number()
    .int()
    .min(2)
    .max(TERRAIN_BLEND_LAYER_COUNTS.SPLAT_MAP[1])
    .optional()
    .describe(
      "The layers the paint weighs, from layer 0 (2 or more; default and most: the painted source's, 4 RGB_AO, 5 RGBA, 9 splat maps): a layer past them is a rule's."
    ),
};

/** The vertex colour's channels field of the vertex colour sources */
const vertexColorField = {
  /** The colour's channels (default `{ layout: 'RGB_AO' }`). */
  vertexColor: z
    .object({
      /** `RGB_AO`: R, G, B weigh layers 1-3, A a baked AO; `RGBA`: layers 1-4. */
      layout: z
        .enum(TERRAIN_VERTEX_COLOR_LAYOUTS)
        .describe('RGB_AO: R, G, B weigh layers 1-3, A a baked AO; RGBA: layers 1-4.'),
    })
    .strict()
    .optional()
    .describe("The colour's channels (default RGB_AO)."),
};

// p305 D4
/**
 * How the layers' weights are made, by `source`: `SINGLE`, `VERTEX_COLOR`,
 * `SPLAT_MAP`, `RULES`, `VERTEX_COLOR_AND_RULES` or `SPLAT_MAP_AND_RULES`, each with its own
 * fields. The layer count must suit the source ({@link TERRAIN_BLEND_LAYER_COUNTS}).
 */
export const TerrainBlendSchema = z
  .discriminatedUnion('source', [
    z
      .object({
        /** One layer everywhere (the default). */
        source: z.literal('SINGLE').describe('One layer everywhere (the default).'),
      })
      .strict(),
    z
      .object({
        /**
         * The mesh's vertex colour (`COLOR_0`, linear) weighs the layers: layer 0 takes what the
         * weight channels leave. No texture fetch; the borders follow the mesh's vertices.
         */
        source: z
          .literal('VERTEX_COLOR')
          .describe(
            "The mesh's vertex colour weighs the layers; layer 0 takes what the weight channels leave."
          ),
        ...vertexColorField,
        ...paintedBlendFields,
      })
      .strict(),
    z
      .object({
        /**
         * One or two RGBA splat maps at the mesh's UV weigh the layers (the inputs `splat0`,
         * layers 1-4, and `splat1`, layers 5-8, as many as the layers need): layer 0 takes what
         * they leave.
         */
        source: z
          .literal('SPLAT_MAP')
          .describe(
            "Splat maps at the mesh's UV weigh the layers (inputs splat0: layers 1-4, splat1: 5-8); layer 0 takes what they leave."
          ),
        ...paintedBlendFields,
      })
      .strict(),
    z
      .object({
        /**
         * The base layer (0) everywhere, under the rules: each lays its layer over the weights so
         * far where the surface is in its ranges. No texture fetch but the rules' noise.
         */
        source: z
          .literal('RULES')
          .describe(
            'The base layer (0) everywhere, under the rules, which lay their layers in order.'
          ),
        ...rulesField,
        ...paintedBlendFields,
      })
      .strict(),
    z
      .object({
        /**
         * The vertex colour's weights (as `VERTEX_COLOR`) under the rules: paint where it matters,
         * rules everywhere. The colour weighs `paintedLayers` from layer 0 (default: as many as
         * its layout does); a layer past those is a rule's.
         */
        source: z
          .literal('VERTEX_COLOR_AND_RULES')
          .describe("The vertex colour's weights (as VERTEX_COLOR) under the rules."),
        ...vertexColorField,
        ...paintedLayersField,
        ...rulesField,
        ...paintedBlendFields,
      })
      .strict(),
    z
      .object({
        /**
         * The splat maps' weights (as `SPLAT_MAP`) under the rules. The maps weigh `paintedLayers`
         * from layer 0 (default: up to 9; one map per four past the base); a layer past those is a
         * rule's.
         */
        source: z
          .literal('SPLAT_MAP_AND_RULES')
          .describe("The splat maps' weights (as SPLAT_MAP) under the rules."),
        ...paintedLayersField,
        ...rulesField,
        ...paintedBlendFields,
      })
      .strict(),
  ])
  .describe(
    "How the layers' weights are made: SINGLE, VERTEX_COLOR, SPLAT_MAP, RULES, VERTEX_COLOR_AND_RULES or SPLAT_MAP_AND_RULES."
  );

// p305 D4
/**
 * How a terrain material's layers are weighed: `SINGLE`, `VERTEX_COLOR`, `SPLAT_MAP`,
 * `RULES`, `VERTEX_COLOR_AND_RULES` or `SPLAT_MAP_AND_RULES`.
 */
export type TerrainBlend = z.infer<typeof TerrainBlendSchema>;

/** Where the ambient occlusion goes: `aoNode`, which darkens indirect light only. */
const TerrainAoSchema = z
  .object({
    /**
     * The texture AO's influence, 0..1 (default 1), × each set's `aoStrength`: a `FULL` layer's
     * map, to `aoNode`. `LITE` and `MINIMAL` have their AO baked into the albedo, which lights it
     * all; this doesn't reach it.
     */
    textureInfluence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "The texture AO's influence, 0..1 (default 1), × each set's aoStrength: a FULL layer's map, to aoNode. LITE and MINIMAL have it baked into the albedo."
      ),
    /**
     * The vertex colour's A as a baked AO, to `aoNode` (large-scale occlusion: hollows, a wall's
     * foot). `blend.source` `VERTEX_COLOR` or `VERTEX_COLOR_AND_RULES` with the `RGB_AO` layout
     * only.
     */
    vertex: z
      .boolean()
      .optional()
      .describe(
        "The vertex colour's A as a baked AO, to aoNode. blend.source VERTEX_COLOR or VERTEX_COLOR_AND_RULES with the RGB_AO layout only."
      ),
    /**
     * The vertex AO's influence, 0..1 (default 0.5), where the layers' albedo has its own AO baked
     * in (`LITE`, `MINIMAL`): that AO darkens all light already, so the vertex AO is lowered. A
     * `FULL` material applies the vertex AO whole.
     */
    bakedAlbedoInfluence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "The vertex AO's influence, 0..1 (default 0.5), where the albedo has its own AO baked in (LITE, MINIMAL). FULL applies it whole."
      ),
  })
  .strict()
  .describe('Where the ambient occlusion goes: aoNode, which darkens indirect light only.');

/** The view distance's effects on the surface. */
const TerrainDistanceSchema = z
  .object({
    /**
     * The view distances in metres over which the layers' detail normals fade to the geometry's
     * (`[from, to]`): past `to` the surface's relief is the mesh's alone.
     */
    fade: metreRange(
      "The view distances in metres over which the layers' detail normals fade to the geometry's."
    ),
    /**
     * The far surface past `fade`'s end (default `NONE`): `AVERAGE_COLOR` the layers' sets'
     * average colours by weight (not with a `DETAIL` colour map), `COLOR_MAP` the colour map
     * (needs `colorMap`). The layers aren't sampled there (a dynamic branch), so far ground costs
     * its weights and 0 or 1 fetch.
     */
    far: z
      .enum(TERRAIN_FAR_MODES)
      .optional()
      .describe(
        "The far surface past fade's end (default NONE): AVERAGE_COLOR the sets' average colours by weight, COLOR_MAP the colour map. The layers aren't sampled there."
      ),
    /**
     * The metres past `fade`'s end over which the near surface gives way to the far one, ≥ 0
     * (default 4; 0 a hard switch): the band samples both, so the switch has no edge that moves
     * with the camera. With a `far` mode only.
     */
    farBlend: z
      .number()
      .min(0)
      .optional()
      .describe(
        "The metres past fade's end over which the near surface gives way to the far one (default 4; 0 a hard switch). With a far mode only."
      ),
  })
  .strict()
  .describe("The view distance's effects on the surface.");

/**
 * The puddles (p307 T3): water standing where the surface conditions' `puddleLevel` × the layers'
 * `puddleResponse` is over their blended relief, on flat ground.
 */
const TerrainPuddlesSchema = z
  .object({
    /** The steepest ground a puddle stands on, degrees from flat, over 0 to 45 (default 15): full
     * puddles up to half of it. */
    maxSlope: z
      .number()
      .gt(0)
      .max(45)
      .optional()
      .describe(
        'The steepest ground a puddle stands on, degrees from flat, over 0 to 45 (default 15): full puddles up to half of it.'
      ),
    /** The relief height over which a puddle's rim fades in, over 0 to 1 (default 0.05). */
    edge: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .describe(
        "The relief height over which a puddle's rim fades in, over 0 to 1 (default 0.05)."
      ),
    /**
     * Patches where the puddles fill ahead or behind: the macro texture's B (its Worley patches,
     * 5 a tile) at the world's XZ over `scale` metres a tile, one fetch of the macro texture (the
     * code route's `macro.texture`, else `noiseTexture`, default `macroNoise`; the JSON route's
     * input `macro`).
     */
    patches: z
      .object({
        /** The metres a macro texture tile covers here (a patch is a fifth of it). */
        scale: z
          .number()
          .gt(0)
          .describe('The metres a macro texture tile covers here (a patch is a fifth of it).'),
        /** How far the patches move the waterline, 0..1 (default 0.75): 1 keeps the lowest dry. */
        amount: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'How far the patches move the waterline, 0..1 (default 0.75): 1 keeps the lowest patches dry.'
          ),
      })
      .strict()
      .optional()
      .describe(
        "Patches where the puddles fill ahead or behind: the macro texture's B at the world's XZ over scale metres a tile (one fetch)."
      ),
  })
  .strict()
  .describe(
    "The puddles: water where the puddle level × the layers' puddleResponse is over their relief, on flat ground. FULL only."
  );

/**
 * The rain ripples (p307 T4): rings where water stands while it rains, a ripple atlas sampled
 * twice in a dynamic branch on the rain.
 */
const TerrainRipplesSchema = z
  .object({
    /** The metres one ripple atlas tile covers, over 0 (default 1.5: 16 drops in 1.5 m). */
    scale: z
      .number()
      .gt(0)
      .optional()
      .describe('The metres one ripple atlas tile covers, over 0 (default 1.5).'),
    /** The seconds a ring lives, over 0 (default 0.7). */
    lifetime: z
      .number()
      .gt(0)
      .optional()
      .describe('The seconds a ring lives, over 0 (default 0.7).'),
    /** How far the rings tilt the normal, 0 or more (default 0.5). */
    strength: z
      .number()
      .min(0)
      .optional()
      .describe('How far the rings tilt the normal, 0 or more (default 0.5).'),
    /**
     * The view distances over which the ripples fade out, `[from, to]` metres (default
     * `[10, 30]`): none sampled past `to` (the atlas is close-up detail).
     */
    distance: z
      .tuple([z.number().min(0), z.number().min(0)])
      .refine(([from, to]) => from < to, 'the first value under the second')
      .optional()
      .describe(
        'The view distances over which the ripples fade out, [from, to] metres (default [10, 30]): none sampled past to.'
      ),
  })
  .strict()
  .describe(
    "Rain ripples (p307 T4): rings where water stands (the puddles, a film on the flat) while the surface conditions' rain is over 0, two fetches of a ripple atlas (the code route's rippleTexture, default rippleAtlas; the JSON route's input ripples) in a dynamic branch. FULL only."
  );

/**
 * The rain streaks (p307 T5): rivulets down steep faces, damp while it's wet and running while it
 * rains, one fetch of the macro texture's R stretched down the face, in a dynamic branch.
 */
const TerrainStreaksSchema = z
  .object({
    /** The gentlest face that streaks, degrees from flat, over 0 to 90 (default 60). */
    minSlope: z
      .number()
      .gt(0)
      .max(90)
      .optional()
      .describe('The gentlest face that streaks, degrees from flat, over 0 to 90 (default 60).'),
    /** The metres one macro texture tile covers across the face, over 0 (default 4). */
    scale: z
      .number()
      .gt(0)
      .optional()
      .describe('The metres one macro texture tile covers across the face, over 0 (default 4).'),
    /** How many times longer a tile is down the face than across, over 0 (default 8). */
    length: z
      .number()
      .gt(0)
      .optional()
      .describe('How many times longer a tile is down the face than across, over 0 (default 8).'),
    /** How fast the running water's pulses move down, metres a second, 0 or more (default 1). */
    speed: z
      .number()
      .min(0)
      .optional()
      .describe(
        "How fast the running water's pulses move down, metres a second, 0 or more (default 1)."
      ),
  })
  .strict()
  .describe(
    "Rain streaks (p307 T5): rivulets down faces steeper than minSlope that the rain reaches, damp while the surface conditions' wetness is over 0 and running while their rain is, one fetch of the macro texture's R (the code route's macro.texture, else noiseTexture, default macroNoise; the JSON route's input macro) in a dynamic branch."
  );

/**
 * The shoreline (p307 T8): the ground along the surface conditions' water level, washed by the
 * waves, saturated where they reach and damp above, arithmetic only.
 */
const TerrainShorelineSchema = z
  .object({
    /** The metres above the water level that stay damp, over 0. */
    band: z.number().gt(0).describe('The metres above the water level that stay damp, over 0.'),
    /** The metres the waterline wanders up and down along the shore, 0 or more (default 0.3). */
    noise: z
      .number()
      .min(0)
      .optional()
      .describe(
        'The metres the waterline wanders up and down along the shore, 0 or more (default 0.3).'
      ),
    /**
     * Waves washing up the shore and back on the surface clock; default none (a still water
     * line).
     */
    runUp: z
      .object({
        /** The metres the waves reach above the water level, over 0 (default 0.5). */
        height: z
          .number()
          .gt(0)
          .optional()
          .describe('The metres the waves reach above the water level, over 0 (default 0.5).'),
        /** The seconds between waves, over 0 (default 6). */
        period: z
          .number()
          .gt(0)
          .optional()
          .describe('The seconds between waves, over 0 (default 6).'),
      })
      .strict()
      .optional()
      .describe('Waves washing up the shore and back on the surface clock; default none.'),
  })
  .strict()
  .describe(
    "The shoreline (p307 T8): along the surface conditions' waterLevel, the waves' wash (standing water), the saturated sand they reach (a film) and a damp band above (a regional wetness); full under the water, none without a water level. Arithmetic only, both qualities."
  );

/**
 * The snow cover (p307 T10): a texture set over the layers by the surface conditions' snow cover,
 * sampled top-down in a dynamic branch.
 */
const TerrainSnowSchema = z
  .object({
    /** The steepest slope the snow rests on, degrees from flat, over 0 to 90 (default 55). */
    maxSlope: z
      .number()
      .gt(0)
      .max(90)
      .optional()
      .describe(
        'The steepest slope the snow rests on, degrees from flat, over 0 to 90 (default 55).'
      ),
    /** The drift noise's cell, metres, over 0 (default 3): where the snow gathers first. */
    noiseScale: z
      .number()
      .gt(0)
      .optional()
      .describe(
        "The drift noise's cell, metres, over 0 (default 3): where the snow gathers first."
      ),
    /** The share of the cover over which the snow's edge fades in, over 0 to 1 (default 0.08). */
    edge: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .describe(
        "The share of the cover over which the snow's edge fades in, over 0 to 1 (default 0.08)."
      ),
    /** The snow set's tiling, over 0 (default 1): its tile is its `physicalSize` × this. */
    tiling: z
      .number()
      .gt(0)
      .optional()
      .describe("The snow set's tiling, over 0 (default 1): its tile is its physicalSize × this."),
  })
  .strict()
  .describe(
    "Snow cover (p307 T10): a texture set (the code route's snowSet, default snow01; the JSON route's input snow) over the layers by the surface conditions' snowCoverage, flat ground first, nothing past maxSlope; frozen dry below 0 °C, slush above, its meltwater wetting the ground around. Its packing's taps in a dynamic branch on the cover; past a far mode's band its average colour. Both qualities."
  );

/**
 * The frost (p307 T11): below freezing the layers whiten a little and roughen, each by 1 − its
 * set's porosity; its sparkle glints.
 */
const TerrainFrostSchema = z
  .object({
    /**
     * The temperatures where frost starts and where it's full, °C, `[from, to]` with `from` the
     * warmer (default `[0, -5]`).
     */
    temperature: z
      .tuple([z.number(), z.number()])
      .refine(([from, to]) => from > to, 'the first value over the second')
      .optional()
      .describe(
        "The temperatures where frost starts and where it's full, °C, [from, to], from the warmer (default [0, -5])."
      ),
    /** The frost's strength, 0..1 (default 1). */
    strength: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("The frost's strength, 0..1 (default 1)."),
    /** Ice crystals glinting toward the camera (`FULL` only); default none. */
    sparkle: z
      .object({
        /** The crystals a metre, over 0 (default 50). */
        density: z.number().gt(0).optional().describe('The crystals a metre, over 0 (default 50).'),
        /** How bright a glint is, added to the albedo, 0 or more (default 3). */
        strength: z
          .number()
          .min(0)
          .optional()
          .describe('How bright a glint is, added to the albedo, 0 or more (default 3).'),
        /**
         * The view distances over which the sparkle fades out, `[from, to]` metres (default
         * `[4, 10]`): none computed past `to`.
         */
        distance: z
          .tuple([z.number().min(0), z.number().min(0)])
          .refine(([from, to]) => from < to, 'the first value under the second')
          .optional()
          .describe(
            'The view distances over which the sparkle fades out, [from, to] metres (default [4, 10]).'
          ),
      })
      .strict()
      .optional()
      .describe(
        'Ice crystals glinting toward the camera on the frost and on frozen snow, in a dynamic branch. FULL only.'
      ),
  })
  .strict()
  .describe(
    "Frost (p307 T11): below the surface conditions' temperature range the layers whiten a little and roughen (never smoother), each by 1 - its set's porosity, an underside half; after the wetness. Arithmetic, both qualities; its sparkle FULL only."
  );

/**
 * The regional wetness (p307 T7): an authored wetness, 0..1, the least the surface shows and the
 * least puddle level, in any weather: a float vertex attribute (default `_wetness`, glTF's
 * `_WETNESS`), or the first splat map's A.
 */
const TerrainWetRegionalSchema = z
  .union([
    z
      .object({
        /** The float vertex attribute (default `_wetness`: glTF's `_WETNESS`, as GLTFLoader names
         * it). A mesh without it reads 0, warned by three. */
        attribute: z
          .string()
          .min(1)
          .optional()
          .describe(
            "The float vertex attribute (default _wetness: glTF's _WETNESS, as GLTFLoader names it)."
          ),
      })
      .strict(),
    z
      .object({
        /** The first splat map's A: a splat source painting at most 4 layers (so it weighs none). */
        splatChannel: z
          .enum(TERRAIN_WET_SPLAT_CHANNELS)
          .describe(
            "The first splat map's A: blend.source SPLAT_MAP or SPLAT_MAP_AND_RULES painting at most 4 layers."
          ),
      })
      .strict(),
  ])
  .describe(
    'The regional wetness: an authored 0..1, the least wetness and puddle level shown, from a float vertex attribute ({ attribute? }) or the first splat map\'s A ({ splatChannel: "A" }).'
  );

/**
 * The wet response (p307 D2): the surface conditions' wetness (`aekasha/surface`) on the layers,
 * each by its set's `porosity`, `wetDarkening` and `wetRoughness`, blended by weight.
 */
const TerrainWetSchema = z
  .object({
    /**
     * `FULL` (default) the relief (the layers' blended height) and the cavities (the AO) shape the
     * local wetness and the film flattens the detail normal; `SIMPLE` the response and the sky
     * exposure only (a low tier).
     */
    quality: z
      .enum(TERRAIN_WET_QUALITIES)
      .optional()
      .describe(
        'FULL (default) the relief and the cavities shape the wetness and the film flattens the normal; SIMPLE the response and the sky exposure only.'
      ),
    /**
     * How far the relief shifts the wetness, ≥ 0 (default 0.5): the low points wet that much ahead
     * of the overall wetness, the peaks behind. `FULL` only.
     */
    heightInfluence: z
      .number()
      .min(0)
      .optional()
      .describe(
        'How far the relief shifts the wetness, 0 or more (default 0.5): the low points wet ahead of the overall wetness, the peaks behind. FULL only.'
      ),
    /**
     * How much wetter a full cavity (1 − the AO: a `FULL` layer's map, the vertex AO) is, ≥ 0
     * (default 0.5), × the wetness. `FULL` only.
     */
    cavityInfluence: z
      .number()
      .min(0)
      .optional()
      .describe(
        'How much wetter a full cavity (1 - the AO) is, 0 or more (default 0.5), × the wetness. FULL only.'
      ),
    /**
     * The geometry's angles from straight up in degrees, `[from, to]` within 0..180 (default
     * `[60, 120]`), over which the rain's reach fades out: fully wet up to `from`, dry past `to`
     * (overhangs, undersides).
     */
    shelter: z
      .tuple([z.number().min(0).max(180), z.number().min(0).max(180)])
      .refine(([from, to]) => from < to, 'the first value under the second')
      .optional()
      .describe(
        "The geometry's angles from straight up in degrees, [from, to] within 0..180 (default [60, 120]), over which the rain's reach fades out: wet up to from, dry past to."
      ),
    /** The puddles (`FULL` only); default none. */
    puddles: TerrainPuddlesSchema.optional(),
    /** The regional wetness's source; default none. */
    regional: TerrainWetRegionalSchema.optional(),
    /** The rain ripples (`FULL` only); default none. */
    ripples: TerrainRipplesSchema.optional(),
    /** The rain streaks; default none. */
    streaks: TerrainStreaksSchema.optional(),
    /** The shoreline along the water level; default none. */
    shoreline: TerrainShorelineSchema.optional(),
    /** The snow cover; default none. */
    snow: TerrainSnowSchema.optional(),
    /** The frost; default none. */
    frost: TerrainFrostSchema.optional(),
    /**
     * What keeps the rain off the surface: `NORMAL_Y` (default) its facing alone; `MAP` also the
     * rain occlusion map (`rainOcclusion()` from `aekasha/surface`: roofs, trees, bridges), one
     * fetch, which keeps the wetness, the puddles, the ripples and the snow out from under them.
     * Without the feature, `MAP` builds as `NORMAL_Y`, warned once.
     */
    rainOcclusion: z
      .enum(TERRAIN_WET_RAIN_OCCLUSIONS)
      .optional()
      .describe(
        "What keeps the rain off the surface: NORMAL_Y (default) its facing alone; MAP also the rain occlusion map (rainOcclusion() from 'aekasha/surface': roofs, trees, bridges), one fetch, keeping the wetness, puddles, ripples and snow out from under them."
      ),
  })
  .strict()
  .superRefine((wet, ctx) => {
    if (wet.quality === 'SIMPLE' && wet.puddles) {
      ctx.addIssue({
        code: 'custom',
        path: ['puddles'],
        message: 'is for quality FULL: SIMPLE reads no relief to fill.',
      });
    }
    if (wet.quality === 'SIMPLE' && wet.ripples) {
      ctx.addIssue({
        code: 'custom',
        path: ['ripples'],
        message: 'is for quality FULL: SIMPLE leaves the normal alone.',
      });
    }
    if (wet.quality === 'SIMPLE' && wet.frost?.sparkle) {
      ctx.addIssue({
        code: 'custom',
        path: ['frost', 'sparkle'],
        message: 'is for quality FULL: SIMPLE is the frost alone.',
      });
    }
  })
  .describe(
    "The wet response: the surface conditions' wetness on the layers, each by its set's porosity, wetDarkening and wetRoughness."
  );

/** The colour map's settings of each mode, with its texture's id for the code route */
const colorMapOptions = <T extends z.ZodRawShape>(texture: T) =>
  [
    z
      .object({
        /**
         * The colour map gives the albedo, the layers their detail: each layer's albedo over its
         * set's average colour (about 1 on average), its normal and roughness.
         */
        mode: z
          .literal('DETAIL')
          .describe(
            "The colour map gives the albedo, the layers their detail (each one's albedo over its set's average colour), normal and roughness."
          ),
        /**
         * The view distances in metres over which the detail fades out (`[from, to]`): past `to`
         * the colour map alone. None: the detail at every distance.
         */
        detailDistance: metreRange(
          'The view distances in metres over which the detail fades out: past the second, the colour map alone.'
        ).optional(),
        ...texture,
      })
      .strict(),
    z
      .object({
        /** The colour map is only the far surface's colour (`distance.far: 'COLOR_MAP'`). */
        mode: z
          .literal('FAR_ONLY')
          .describe("The colour map is only the far surface's colour (distance.far COLOR_MAP)."),
        ...texture,
      })
      .strict(),
  ] as const;

// p305 D7
/**
 * A colour map's settings, without its texture (the static define's `colorMap`): a
 * texture at the mesh's UV (a block's own, unique colour), by `mode`: `DETAIL` or `FAR_ONLY`. Its
 * texture is the input `colorMap` (`{ "texture": id }`).
 */
export const TerrainColorMapSettingsSchema = z
  .discriminatedUnion('mode', colorMapOptions({}))
  .describe("A colour map at the mesh's UV, without its texture (the input colorMap gives it).");

/** A colour map's settings without its texture: the static define's `colorMap`. */
export type TerrainColorMapSettings = z.infer<typeof TerrainColorMapSettingsSchema>;

/** The code route's colour map: its texture and its settings. */
export const TerrainColorMapSchema = z
  .discriminatedUnion(
    'mode',
    colorMapOptions({
      /**
       * The colour map's texture id: a block's own colour at its UV (an sRGB `color` slot
       * texture, mipmapped), eg. a `bakeTerrainColorMap`'s exported and encoded.
       */
      texture: z
        .string()
        .min(1)
        .describe("The colour map's texture id: a block's own colour at its UV (sRGB)."),
    })
  )
  .describe("A colour map at the mesh's UV: its texture and its settings.");

/** {@link createTerrainMaterial}'s colour map: its texture and its settings. */
export type TerrainColorMap = z.infer<typeof TerrainColorMapSchema>;

/**
 * Sparse sampling (p305 D6): at each pixel only the layers weighing most are sampled, sorted by
 * weight, their weights renormalized. Needs `ARRAY` storage (each kept layer read at a per-pixel
 * index) and every layer's anti-tiling alike, the projected layers' projection alike (planar ones
 * mix in). No effect on a material of no more layers than it keeps.
 */
const TerrainSparseSchema = z
  .object({
    /**
     * The layers sampled at a pixel, 2..4: a layer past them where more weigh in is dropped (its
     * weight shared out), so 3 hides most of the popping where a third crosses the cut.
     */
    maxLayers: z
      .number()
      .int()
      .min(TERRAIN_SPARSE_MAX_LAYERS[0])
      .max(TERRAIN_SPARSE_MAX_LAYERS[1])
      .describe(
        'The layers sampled at a pixel, 2..4: a layer past them where more weigh in is dropped (its weight shared out).'
      ),
  })
  .strict()
  .describe(
    'Sparse sampling: only the layers weighing most at a pixel are sampled. Needs ARRAY storage and every layer sampled alike.'
  );

/**
 * The macro variation's settings, without its texture (the static define's `macro`): one fetch of
 * a macro noise texture (the toolkit's `macroNoise`: R brightness, G hue and roughness, B patches)
 * at the world's XZ, which varies every layer. Each number is a uniform (`terrain_macro<Name>`).
 */
export const TerrainMacroSettingsSchema = z
  .object({
    /** The metres one tile of the macro texture covers (40 to 300 suit `macroNoise`). */
    scale: z
      .number()
      .positive()
      .describe('The metres one tile of the macro texture covers (40 to 300 suit macroNoise).'),
    /** How far R lightens and darkens the albedo, 0..1 (default 0.2: ±20 %). */
    brightness: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('How far R lightens and darkens the albedo, 0..1 (default 0.2: ±20 %).'),
    /** How far G turns the albedo's hue, 0..180 degrees either way (default 8). */
    hue: z
      .number()
      .min(0)
      .max(180)
      .optional()
      .describe("How far G turns the albedo's hue, 0..180 degrees either way (default 8)."),
    /** How far G scales the roughness, 0..1 (default 0.15: ±15 %). */
    roughness: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('How far G scales the roughness, 0..1 (default 0.15: ±15 %).'),
  })
  .strict()
  .describe("The macro variation's settings, without its texture (the input macro gives it).");

/** The macro variation's settings without its texture: the static define's `macro`. */
export type TerrainMacroSettings = z.infer<typeof TerrainMacroSettingsSchema>;

/** The code route's macro variation: its texture and its settings. */
export const TerrainMacroSchema = TerrainMacroSettingsSchema.extend({
  /**
   * The macro texture's id: `macroNoise` (the toolkit's KTX2 copy) or a bake's (`macroNoise.data`,
   * `bakeMacroNoise`).
   */
  texture: z
    .string()
    .min(1)
    .describe("The macro texture's id: macroNoise, or a bake's (macroNoise.data)."),
})
  .strict()
  .describe('The macro variation: its texture and its settings.');

/** {@link createTerrainMaterial}'s macro variation: its texture and its settings. */
export type TerrainMacro = z.infer<typeof TerrainMacroSchema>;

/** The space field the code route's config and the static define share (not a tier's) */
const spaceFields = {
  /**
   * The space the material samples in (default `WORLD`): `OBJECT` the mesh's own (its position ×
   * its scale, its normal), for structures that move or turn: the coordinates, projections, rules
   * (height and facing: the mesh's) and macro all follow the mesh. Not a tier override.
   */
  space: z
    .enum(TERRAIN_SPACES)
    .optional()
    .describe(
      "The space the material samples in (default WORLD): OBJECT the mesh's own (scaled to metres), for structures that move or turn. Not a tier override."
    ),
};

/** The material-wide fields the code route's config and the static define share. */
const sharedFields = {
  /**
   * The tiling coordinates: `WORLD` (default) the world's `(x, −z)` over the tile size, seen from
   * above in the source's orientation (a slope stretches by 1 / cos of its angle); `MESH_UV` the
   * mesh's UV in metres (walls, authored blocks).
   */
  uv: z
    .enum(TERRAIN_UV_MODES)
    .optional()
    .describe(
      "The tiling coordinates: WORLD (default), the world's (x, -z) over the tile size, seen from above; MESH_UV, the mesh's UV in metres."
    ),
  /** How the layers' weights are made (default `{ source: 'SINGLE' }`). */
  blend: TerrainBlendSchema.optional(),
  /** Where the ambient occlusion goes (the material's `aoNode`: indirect light only). */
  ao: TerrainAoSchema.optional(),
  /** Every layer's anti-tiling (default `NONE`); a layer's own replaces it. */
  antiTiling: TerrainAntiTilingSchema.optional(),
  /** Every layer's projection (default `PLANAR`); a layer's own replaces it. */
  projection: TerrainProjectionSchema.optional(),
  /** The view distance's effects: the detail normals' fade, and the far surface past it. */
  distance: TerrainDistanceSchema.optional(),
  /** Sparse sampling: only the layers weighing most at each pixel (default: every layer). */
  sparse: TerrainSparseSchema.optional(),
  /**
   * The wet response to the surface conditions (`aekasha/surface`'s `wetness`; needs the
   * `surfaceConditions()` feature, else the material builds dry, warned). Default none: dry.
   */
  wet: TerrainWetSchema.optional(),
};

/** A quality tier's overrides of one layer's own settings */
const TerrainLayerOverridesSchema = z
  .object({
    /**
     * What the layer samples in this tier, in place of its own: eg. a live layer's bake
     * (`TEXTURE`) on a low tier.
     */
    source: layerSourceField,
    /** The layer's anti-tiling in this tier, in place of its own and the material's. */
    antiTiling: TerrainAntiTilingSchema.optional(),
    /** The layer's projection in this tier, in place of its own and the material's: eg. cliffs. */
    projection: TerrainProjectionSchema.optional(),
  })
  .strict()
  .describe("A quality tier's overrides of one layer's own settings.");

/**
 * A quality tier's overrides: material-wide fields over the material's own (shallowly, a field's
 * object replacing the material's whole), for the tier's variant (`getTerrainMaterialVariant`). A
 * tier's material-wide `antiTiling` and `projection` don't reach a layer that has its own: its
 * `layers` entry does.
 */
export const TerrainQualityOverridesSchema = z
  .object({
    ...sharedFields,
    /**
     * Per layer, in the layers' order (at most one entry a layer; `{}` for none): its source,
     * anti-tiling and projection in this tier, over its own and the material's (eg. the cliff
     * layer's `BIPLANAR` on `LOW`, a live layer's bake).
     */
    layers: z
      .array(TerrainLayerOverridesSchema)
      .max(TERRAIN_MAX_LAYERS)
      .optional()
      .describe(
        "Per layer, in the layers' order ({} for none): its source, anti-tiling and projection in this tier, over its own and the material's."
      ),
  })
  .strict()
  .describe("A quality tier's material-wide fields over the material's own (shallowly).");

/** A quality tier's material-wide fields over the material's own (shallowly). */
export type TerrainQualityOverrides = z.infer<typeof TerrainQualityOverridesSchema>;

/** The texture budget's field the code route's config and the static define share */
const budgetFields = {
  /**
   * The sampled textures kept for the rest of the shader (shadow maps, the environment), 0..15
   * (default 6): the material's own may bind the renderer's limit (16) less these, or it throws
   * listing what it binds.
   */
  reservedTextures: z
    .number()
    .int()
    .min(0)
    .max(15)
    .optional()
    .describe(
      "The sampled textures kept for the rest of the shader (shadow maps, the environment), 0..15 (default 6): the material's own bind the renderer's limit less these."
    ),
};

/** The tier and debug fields the code route's config and the static define share */
const variantFields = {
  /** Each quality tier's overrides (`LOW`, `MEDIUM`, `HIGH`, `ULTRA`; any of them). */
  quality: z
    .object(
      Object.fromEntries(
        TERRAIN_QUALITY_LEVELS.map((level) => [level, TerrainQualityOverridesSchema.optional()])
      ) as Record<
        (typeof TERRAIN_QUALITY_LEVELS)[number],
        z.ZodOptional<typeof TerrainQualityOverridesSchema>
      >
    )
    .strict()
    .optional()
    .describe("Each quality tier's overrides (LOW, MEDIUM, HIGH, ULTRA; any of them)."),
  /**
   * The tier this material compiles: its `quality` overrides apply (none: the material's own
   * fields). `getTerrainMaterialVariant` sets it.
   */
  qualityLevel: z
    .enum(TERRAIN_QUALITY_LEVELS)
    .optional()
    .describe(
      "The tier this material compiles: its quality overrides apply (none: the material's own fields)."
    ),
  /**
   * A debug view in place of the surface (debug env only, ignored elsewhere; its code loads with
   * `loadTerrainDebugViewsAsync`): `TEXEL_DENSITY`, `NORMALS`, `WEIGHTS`, `PROJECTION`, `TAPS`,
   * `LAYER_COUNT` or `WETNESS` (with `wet`, the material's or a tier's).
   */
  debugView: z
    .enum(TERRAIN_DEBUG_VIEWS)
    .optional()
    .describe(
      'A debug view in place of the surface (debug env only; its code loads with loadTerrainDebugViewsAsync): TEXEL_DENSITY, NORMALS, WEIGHTS, PROJECTION, TAPS, LAYER_COUNT or WETNESS (with wet).'
    ),
};

/** The layer counts a blend takes, `[min, max]`, and its name for an error */
const getBlendLayerCounts = (blend: TerrainBlend | undefined) => {
  if (blend?.source === 'VERTEX_COLOR') {
    const layout = blend.vertexColor?.layout ?? 'RGB_AO';
    return {
      counts: TERRAIN_BLEND_LAYER_COUNTS[`VERTEX_COLOR_${layout}`],
      name: `VERTEX_COLOR (${layout})`,
    };
  }
  const source = blend?.source ?? 'SINGLE';
  return { counts: TERRAIN_BLEND_LAYER_COUNTS[source], name: source };
};

/** The most layers a blend's paint weighs: its source's (a layout's), 1 (the base) without paint */
const getMaxPaintedLayers = (blend: TerrainBlend | undefined) => {
  const source = blend?.source ?? 'SINGLE';
  if (source === 'VERTEX_COLOR' || source === 'VERTEX_COLOR_AND_RULES') {
    const layout = (blend as { vertexColor?: { layout: string } }).vertexColor?.layout;
    return TERRAIN_BLEND_LAYER_COUNTS[`VERTEX_COLOR_${layout === 'RGBA' ? 'RGBA' : 'RGB_AO'}`][1];
  }
  if (source === 'SPLAT_MAP' || source === 'SPLAT_MAP_AND_RULES') {
    return TERRAIN_BLEND_LAYER_COUNTS.SPLAT_MAP[1];
  }
  return 1;
};

/**
 * The layers a blend's painted weights reach, from layer 0: a combo's `paintedLayers`, else its
 * painted source's most, fewer when there are fewer layers; 1 (the base) for `RULES` and `SINGLE`
 */
const getPaintedLayerCount = (blend: TerrainBlend | undefined, layerCount: number) => {
  const given = blend && 'paintedLayers' in blend ? blend.paintedLayers : undefined;
  return given ?? Math.min(layerCount, getMaxPaintedLayers(blend));
};

/** The splat maps a blend takes: one per four painted layers past the base, with splat maps only */
const getSplatMapCount = (blend: TerrainBlend | undefined, layerCount: number) =>
  blend?.source === 'SPLAT_MAP' || blend?.source === 'SPLAT_MAP_AND_RULES'
    ? Math.ceil((getPaintedLayerCount(blend, layerCount) - 1) / 4)
    : 0;

/** A blend's rules, none for a source without */
const getRules = (blend: TerrainBlend | undefined) =>
  blend && 'rules' in blend ? blend.rules : [];

type TerrainWet = z.infer<typeof TerrainWetSchema>;

/**
 * Whether the material's wet response or a tier's has puddle patches or streaks, which read the
 * noise texture
 */
const hasWetNoise = (value: {
  wet?: TerrainWet;
  quality?: Partial<Record<string, { wet?: TerrainWet } | undefined>>;
}) =>
  [value.wet, ...Object.values(value.quality ?? {}).map((tier) => tier?.wet)].some(
    (wet) => wet?.puddles?.patches !== undefined || wet?.streaks !== undefined
  );

/** Whether a rule of the material's blend or of a tier's reads the noise texture */
const hasRuleNoise = (value: {
  blend?: TerrainBlend;
  quality?: Partial<Record<string, { blend?: TerrainBlend } | undefined>>;
}) =>
  [value.blend, ...Object.values(value.quality ?? {}).map((tier) => tier?.blend)].some((blend) =>
    getRules(blend).some((rule) => rule.noise)
  );

type BlendFields = {
  blend?: TerrainBlend;
  ao?: z.infer<typeof TerrainAoSchema>;
  wet?: TerrainWet;
};

/**
 * The rules' layers: each one of the material's, and each layer past the painted ones some rule's
 * (nothing else weighs it)
 */
const checkRuleLayers = (
  blend: TerrainBlend | undefined,
  layerCount: number,
  issue: (at: (string | number)[], message: string) => void,
  path: (string | number)[]
) => {
  const rules = getRules(blend);
  if (!rules.length) return;
  const painted = blend && 'paintedLayers' in blend ? blend.paintedLayers : undefined;
  const most = Math.min(layerCount, getMaxPaintedLayers(blend));
  if (painted !== undefined && painted > most) {
    issue(
      [...path, 'blend', 'paintedLayers'],
      `is ${painted}: the paint weighs ${most} layers at most here.`
    );
  }
  rules.forEach((rule, i) => {
    if (rule.layer >= layerCount) {
      issue(
        [...path, 'blend', 'rules', i, 'layer'],
        `is ${rule.layer}: there are ${layerCount} layers.`
      );
    }
  });
  for (let layer = getPaintedLayerCount(blend, layerCount); layer < layerCount; layer++) {
    if (!rules.some((rule) => rule.layer === layer)) {
      issue(['layers', layer], `is neither painted nor a rule's layer: nothing weighs it.`);
    }
  }
};

/**
 * The blend and the AO of the material's fields and of each tier's (a tier's over the material's):
 * the layer count suits the source, the rules' layers are the material's and reach the layers the
 * paint doesn't, a depth only with the height blend, the vertex AO only with `RGB_AO` vertex
 * colours. The refinement both schemas share.
 */
const checkBlend = (
  value: BlendFields & {
    layers: unknown[];
    quality?: Partial<Record<string, BlendFields | undefined>>;
  },
  ctx: z.RefinementCtx
) => {
  const tiers = Object.entries(value.quality ?? {}).map(([level, tier]) => ({
    path: ['quality', level],
    blend: tier?.blend ?? value.blend,
    ao: tier?.ao ?? value.ao,
    wet: tier?.wet ?? value.wet,
  }));
  const own = { path: [], blend: value.blend, ao: value.ao, wet: value.wet };
  for (const { path, blend, ao, wet } of [own, ...tiers]) {
    const { counts, name } = getBlendLayerCounts(blend);
    const count = value.layers.length;
    const issue = (at: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path: at, message });
    };
    if (count < counts[0] || count > counts[1]) {
      issue(['layers'], `blend.source ${name} takes ${counts.join(' to ')} layers, not ${count}.`);
    }
    checkRuleLayers(blend, count, issue, path);
    if (blend && blend.source !== 'SINGLE' && blend.mode === 'LINEAR' && blend.heightBlendDepth) {
      issue([...path, 'blend', 'heightBlendDepth'], 'is for blend.mode HEIGHT, not LINEAR.');
    }
    const isRgbAo =
      (blend?.source === 'VERTEX_COLOR' || blend?.source === 'VERTEX_COLOR_AND_RULES') &&
      blend.vertexColor?.layout !== 'RGBA';
    if (ao?.vertex && !isRgbAo) {
      issue(
        [...path, 'ao', 'vertex'],
        'needs blend.source VERTEX_COLOR or VERTEX_COLOR_AND_RULES with the RGB_AO layout.'
      );
    }
    const isSplat = blend?.source === 'SPLAT_MAP' || blend?.source === 'SPLAT_MAP_AND_RULES';
    if (
      wet?.regional &&
      'splatChannel' in wet.regional &&
      !(isSplat && getPaintedLayerCount(blend, count) <= 4)
    ) {
      issue(
        [...path, 'wet', 'regional', 'splatChannel'],
        "is A: give blend.source SPLAT_MAP or SPLAT_MAP_AND_RULES painting at most 4 layers, so the first splat map's A weighs none."
      );
    }
  }
};

type Path = (string | number)[];
/** A layer's settings a tier can override */
type LayerSampling = {
  source?: (typeof TERRAIN_LAYER_SOURCES)[number];
  antiTiling?: TerrainAntiTiling;
  projection?: TerrainProjection;
};
/** The material-wide fields the layers' sampling reads, the material's or a tier's */
type SamplingFields = LayerSampling & {
  uv?: (typeof TERRAIN_UV_MODES)[number];
  sparse?: { maxLayers: number };
};
type TierSampling = SamplingFields & { layers?: LayerSampling[] };
type SampledValue = SamplingFields & {
  layers: (LayerSampling & { live?: TerrainLive })[];
  quality?: Partial<Record<string, TierSampling | undefined>>;
};
/** A setting as a context resolves it, and the path it was given at (for an issue) */
type Given<T> = { value: T; path: Path };

/**
 * The material's own fields and each tier's over them, each layer's anti-tiling and projection
 * resolved: the tier's `layers` entry, else the layer's own, else the tier's, else the material's,
 * each with the path it was given at; and whether it's live (its source: the tier's entry, else
 * its own)
 */
const getSamplingContexts = (value: SampledValue) => {
  const tiers = Object.entries(value.quality ?? {}).map(([level, tier]) => ({
    path: ['quality', level],
    tier,
  }));
  return [{ path: [], tier: undefined }, ...tiers].map(({ path, tier }) => {
    const wide = <K extends keyof SamplingFields>(key: K): Given<SamplingFields[K]> =>
      tier?.[key] !== undefined
        ? { value: tier[key] as SamplingFields[K], path: [...path, key] }
        : { value: value[key], path: [key] };
    const resolve = <K extends keyof LayerSampling>(i: number, key: K): Given<LayerSampling[K]> => {
      const override = tier?.layers?.[i]?.[key];
      if (override !== undefined) return { value: override, path: [...path, 'layers', i, key] };
      const own = value.layers[i][key];
      return own !== undefined ? { value: own, path: ['layers', i, key] } : wide(key);
    };
    return {
      uv: wide('uv').value,
      sparse: wide('sparse').value,
      layers: value.layers.map((_, i) => ({
        isLive: (tier?.layers?.[i]?.source ?? value.layers[i].source) === 'PROCEDURAL_LIVE',
        antiTiling: resolve(i, 'antiTiling'),
        projection: resolve(i, 'projection'),
      })),
    };
  });
};

/** Reports an issue once per path: several layers can share the material's setting */
const createIssueReporter = (ctx: z.RefinementCtx) => {
  const reported = new Set<string>();
  return (path: Path, message: string) => {
    const key = path.join('.');
    if (reported.has(key)) return;
    reported.add(key);
    ctx.addIssue({ code: 'custom', path, message });
  };
};

/**
 * The projections against the tiling's coordinates, the material's and each tier's (a tier's `uv`
 * and projections over the material's): `BIPLANAR` and `TRIPLANAR` project the world, so a layer
 * that has one (as its context resolves it) needs `uv: 'WORLD'`. The refinement both schemas
 * share.
 */
const checkProjection = (value: SampledValue, ctx: z.RefinementCtx) => {
  const issue = createIssueReporter(ctx);
  for (const { uv, layers } of getSamplingContexts(value)) {
    if (uv !== 'MESH_UV') continue;
    for (const { projection } of layers) {
      const mode = projection.value?.mode ?? 'PLANAR';
      if (mode === 'PLANAR') continue;
      issue(
        [...projection.path, 'mode'],
        `is ${mode}: it projects the world, which needs uv WORLD (not MESH_UV).`
      );
    }
  }
};

/** A context's layer as the slots read it: live, its anti-tiling and projection where given */
type SampledLayer = {
  isLive: boolean;
  antiTiling: Given<TerrainAntiTiling | undefined>;
  projection: Given<TerrainProjection | undefined>;
};

/**
 * Whether a context samples the layers in slots sorted by weight at the pixel (p305 D6, the
 * `ARRAY` storage's per-pixel layer index): sparse sampling that keeps fewer layers than there
 * are, or `HEX` with `apply: 'DOMINANT'` over two layers or more; live layers are sampled beside
 * the slots, so they don't count
 */
const takesSlots = (sparse: SamplingFields['sparse'], layers: SampledLayer[]) => {
  const sampled = layers.filter((layer) => !layer.isLive);
  const isDominant = sampled.some(
    ({ antiTiling: { value } }) => value?.mode === 'HEX' && value.apply === 'DOMINANT'
  );
  return (
    (sparse !== undefined && sparse.maxLayers < sampled.length) ||
    (isDominant && sampled.length > 1)
  );
};

/** An anti-tiling as the slots compare it: its mode, and `HEX`'s `apply` */
const describeSlotAntiTiling = (antiTiling: TerrainAntiTiling | undefined) => {
  if (antiTiling?.mode !== 'HEX') return antiTiling?.mode ?? 'NONE';
  return `HEX ${antiTiling.apply ?? 'ALL'}`;
};

/** Every anti-tiling the value gives, with its path: the material's, the layers', the tiers' */
const getGivenAntiTilings = (value: SampledValue) => {
  const given: { antiTiling: TerrainAntiTiling | undefined; path: Path }[] = [
    { antiTiling: value.antiTiling, path: ['antiTiling'] },
    ...value.layers.map((layer, i) => ({
      antiTiling: layer.antiTiling,
      path: ['layers', i, 'antiTiling'],
    })),
  ];
  for (const [level, tier] of Object.entries(value.quality ?? {})) {
    given.push({ antiTiling: tier?.antiTiling, path: ['quality', level, 'antiTiling'] });
    tier?.layers?.forEach((layer, i) =>
      given.push({
        antiTiling: layer.antiTiling,
        path: ['quality', level, 'layers', i, 'antiTiling'],
      })
    );
  }
  return given;
};

/**
 * The slots' rules, the material's and each tier's: `HEX`'s `farScale` and `distance` only with
 * `apply: 'DOMINANT'`; a tier's `layers` no longer than the layers; and where the layers sample in
 * slots (sparse, `DOMINANT`), every layer's anti-tiling alike (its mode and `apply`; the numbers
 * may differ) and the projected layers' projection alike (its mode and normal blend; planar
 * layers mix in): a slot samples whichever layer weighs most there. The refinement both schemas
 * share.
 */
const checkSlots = (value: SampledValue, ctx: z.RefinementCtx) => {
  const issue = createIssueReporter(ctx);
  for (const { antiTiling, path } of getGivenAntiTilings(value)) {
    if (antiTiling?.mode !== 'HEX' || antiTiling.apply === 'DOMINANT') continue;
    for (const key of ['farScale', 'distance'] as const) {
      if (antiTiling[key] !== undefined) {
        issue([...path, key], "is for apply DOMINANT (the other layers' DUAL_SCALE).");
      }
    }
  }
  for (const [level, tier] of Object.entries(value.quality ?? {})) {
    const count = tier?.layers?.length ?? 0;
    if (count > value.layers.length) {
      issue(
        ['quality', level, 'layers'],
        `has ${count} entries: there are ${value.layers.length} layers.`
      );
    }
  }
  for (const { sparse, layers } of getSamplingContexts(value)) {
    if (!takesSlots(sparse, layers)) continue;
    // Live layers are sampled beside the slots, in their own way
    const sampled = layers.flatMap((layer, i) => (layer.isLive ? [] : [{ ...layer, i }]));
    const first = describeSlotAntiTiling(sampled[0].antiTiling.value);
    for (const { antiTiling } of sampled) {
      const own = describeSlotAntiTiling(antiTiling.value);
      if (own === first) continue;
      issue(
        antiTiling.path,
        `is ${own}, layer ${sampled[0].i}'s ${first}: sparse sampling and DOMINANT sample every layer alike, so the layers take one anti-tiling mode (their numbers may differ).`
      );
    }
    const projected = sampled
      .map(({ projection }) => projection)
      .filter((projection) => projection.value && projection.value.mode !== 'PLANAR');
    const describe = ({ value: projection }: Given<TerrainProjection | undefined>) =>
      `${projection?.mode} ${(projection?.mode !== 'PLANAR' && projection?.normalBlend) || 'WHITEOUT'}`;
    for (const projection of projected) {
      if (describe(projection) === describe(projected[0])) continue;
      issue(
        projection.path,
        `is ${describe(projection)}, the first projected layer's ${describe(projected[0])}: sparse sampling and DOMINANT project every projected layer alike, so they take one mode and normal blend (planar layers mix in).`
      );
    }
  }
};

/**
 * The live layers (p305 Phase 8), the material's and each tier's: a live layer takes no
 * anti-tiling (its surface never repeats), so one given at the layer (its own, or its tier's
 * entry) is refused where it's live (a material-wide one doesn't reach it); and a layer's `live`
 * taps only where some context samples it live. The refinement both schemas share.
 */
const checkLive = (value: SampledValue, ctx: z.RefinementCtx) => {
  const issue = createIssueReporter(ctx);
  const contexts = getSamplingContexts(value);
  for (const { layers } of contexts) {
    for (const { isLive, antiTiling } of layers) {
      const mode = antiTiling.value?.mode ?? 'NONE';
      if (!isLive || mode === 'NONE' || !antiTiling.path.includes('layers')) continue;
      issue(
        antiTiling.path,
        `is ${mode} on a live layer (source PROCEDURAL_LIVE): its surface never repeats, so it takes no anti-tiling.`
      );
    }
  }
  value.layers.forEach((layer, i) => {
    if (!layer.live || contexts.some((context) => context.layers[i].isLive)) return;
    issue(
      ['layers', i, 'live'],
      "is for a live layer: give source PROCEDURAL_LIVE (the layer's, or a tier's layers entry)."
    );
  });
};

type DistanceValue = { far?: string; farBlend?: number };
type FarValue = {
  colorMap?: { mode: string };
  distance?: DistanceValue;
  quality?: Partial<Record<string, { distance?: DistanceValue } | undefined>>;
};

/**
 * The far modes and the colour map, the material's and each tier's (a tier's `distance` over the
 * material's): `farBlend` only with a far mode, `far: 'COLOR_MAP'` only with a `colorMap`,
 * `AVERAGE_COLOR` not with a `DETAIL` colour map (whose far colour is the colour map's), and a
 * `FAR_ONLY` colour map only where some context's far mode is `COLOR_MAP` (else nothing reads
 * it). The refinement both schemas share.
 */
const checkFar = (value: FarValue, ctx: z.RefinementCtx) => {
  const issue = createIssueReporter(ctx);
  const contexts = [
    { path: ['distance'], distance: value.distance },
    ...Object.entries(value.quality ?? {}).map(([level, tier]) =>
      tier?.distance
        ? { path: ['quality', level, 'distance'], distance: tier.distance }
        : { path: ['distance'], distance: value.distance }
    ),
  ];
  for (const { path, distance } of contexts) {
    const far = distance?.far ?? 'NONE';
    if (distance?.farBlend !== undefined && far === 'NONE') {
      issue([...path, 'farBlend'], 'is for a far mode (distance.far AVERAGE_COLOR or COLOR_MAP).');
    }
    if (far === 'COLOR_MAP' && !value.colorMap) {
      issue([...path, 'far'], 'is COLOR_MAP: give a colorMap (its texture the input colorMap).');
    }
    if (far === 'AVERAGE_COLOR' && value.colorMap?.mode === 'DETAIL') {
      issue(
        [...path, 'far'],
        "is AVERAGE_COLOR with a DETAIL colour map, whose colour the layers' averages would drop far away: use COLOR_MAP."
      );
    }
  }
  const contextsFar = contexts.map(({ distance }) => distance?.far);
  if (value.colorMap?.mode === 'FAR_ONLY' && !contextsFar.includes('COLOR_MAP')) {
    issue(
      ['colorMap', 'mode'],
      "is FAR_ONLY: give distance.far COLOR_MAP (the material's or a tier's), else nothing reads it."
    );
  }
};

/**
 * The `WETNESS` debug view shows the wet response: the material's `wet` or a tier's must be there
 * (a tier's variant shares the material's define). The refinement both schemas share.
 */
const checkWetView = (
  value: {
    debugView?: string;
    wet?: unknown;
    quality?: Partial<Record<string, { wet?: unknown } | undefined>>;
  },
  ctx: z.RefinementCtx
) => {
  if (value.debugView !== 'WETNESS') return;
  if (value.wet || Object.values(value.quality ?? {}).some((tier) => tier?.wet)) return;
  ctx.addIssue({
    code: 'custom',
    path: ['debugView'],
    message: "is WETNESS: give wet (the material's or a tier's), else there's nothing to show.",
  });
};

/**
 * Whether the config (its own fields or a tier's) samples the layers in slots, which read the
 * layers at a per-pixel index: `ARRAY` storage
 */
const takesLayerArray = (value: SampledValue) =>
  getSamplingContexts(value).some(({ sparse, layers }) => takesSlots(sparse, layers));

/**
 * The code route's texture ids: the splat maps, one per map the painted layers need, with the
 * splat map sources only; the noise texture only for rules with noise and no `macro`
 */
const checkTextureIds = (
  value: {
    layers: unknown[];
    blend?: TerrainBlend;
    splatMaps?: string[];
    macro?: unknown;
    noiseTexture?: string;
    rippleTexture?: string;
    snowSet?: string;
    wet?: TerrainWet;
    quality?: Partial<Record<string, { blend?: TerrainBlend; wet?: TerrainWet } | undefined>>;
  },
  ctx: z.RefinementCtx
) => {
  const count = getSplatMapCount(value.blend, value.layers.length);
  const issue = (path: string, message: string) => {
    ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (!count && value.splatMaps) {
    issue('splatMaps', 'is for blend.source SPLAT_MAP or SPLAT_MAP_AND_RULES.');
  } else if (count && value.splatMaps?.length !== count) {
    const painted = getPaintedLayerCount(value.blend, value.layers.length);
    issue(
      'splatMaps',
      `${painted} painted layers take ${count} splat map${count === 1 ? '' : 's'}: give their texture ids.`
    );
  }
  if (value.noiseTexture !== undefined && !hasRuleNoise(value) && !hasWetNoise(value)) {
    issue(
      'noiseTexture',
      "is for rules with noise (blend.rules[i].noise), puddle patches (wet.puddles.patches) or streaks (wet.streaks), the material's or a tier's."
    );
  } else if (value.noiseTexture !== undefined && value.macro) {
    issue(
      'noiseTexture',
      "is macro.texture's with a macro: the rules' noise, the puddle patches and the streaks read it."
    );
  }
  const wets = [value.wet, ...Object.values(value.quality ?? {}).map((tier) => tier?.wet)];
  if (value.rippleTexture !== undefined && !wets.some((wet) => wet?.ripples)) {
    issue('rippleTexture', "is for rain ripples (wet.ripples, the material's or a tier's).");
  }
  if (value.snowSet !== undefined && !wets.some((wet) => wet?.snow)) {
    issue('snowSet', "is for the snow cover (wet.snow, the material's or a tier's).");
  }
};

/**
 * The code route's storage against the slots: sparse sampling and `DOMINANT` (the material's or a
 * tier's) read each layer at a per-pixel index, which `SEPARATE` can't
 */
const checkStorage = (value: SampledValue & { storage?: string }, ctx: z.RefinementCtx) => {
  if (value.storage !== 'SEPARATE' || !takesLayerArray(value)) return;
  ctx.addIssue({
    code: 'custom',
    path: ['storage'],
    message:
      "is SEPARATE: sparse sampling and HEX's apply DOMINANT (the material's or a tier's) read each layer at a per-pixel index, which needs ARRAY storage (or AUTO).",
  });
};

/**
 * The JSON route's static define, `staticDefines.terrain` of a material whose TSL functions are
 * the terrain material's (`terrain.material.json`, or `tslMaterialId: 'aek.terrain'`): the config
 * without the material's id, the layers without their sets (the inputs `layer0`, `layer1`, … give
 * them, `{ "textureSet": id, "packing"? }`, all in one packing). The input `macro`
 * (`{ "texture": id }`) is the texture the macro variation and the rules' noise read.
 */
export const TerrainMaterialDefineSchema = z
  .object({
    /** The layers' settings, in the inputs' order (`layer0`, …): 1 to 16. */
    layers: z
      .array(TerrainLayerSettingsSchema)
      .min(1)
      .max(TERRAIN_MAX_LAYERS)
      .describe("The layers' settings, in the inputs' order (layer0, …): 1 to 16."),
    /** The macro variation, its texture the input `macro` (`{ "texture": id }`). */
    macro: TerrainMacroSettingsSchema.optional(),
    /** The colour map, its texture the input `colorMap` (`{ "texture": id }`, at the mesh's UV). */
    colorMap: TerrainColorMapSettingsSchema.optional(),
    ...spaceFields,
    ...budgetFields,
    ...sharedFields,
    ...variantFields,
  })
  .strict()
  .superRefine(checkBlend)
  .superRefine(checkProjection)
  .superRefine(checkSlots)
  .superRefine(checkLive)
  .superRefine(checkFar)
  .superRefine(checkWetView)
  .describe("The terrain material's static define (staticDefines.terrain).");

/**
 * The terrain material's static define (`staticDefines.terrain`): {@link TerrainMaterialConfig}
 * without the id, its layers without their sets, which the material's inputs give.
 */
export type TerrainMaterialDefine = z.infer<typeof TerrainMaterialDefineSchema>;

/** The code route's config: {@link createTerrainMaterial}'s argument. */
export const TerrainMaterialConfigSchema = z
  .object({
    /** The material's registry id. */
    id: z.string().min(1).describe("The material's registry id."),
    /** The layers, each a texture set and its settings: 1 to 16. */
    layers: z
      .array(TerrainLayerSchema)
      .min(1)
      .max(TERRAIN_MAX_LAYERS)
      .describe('The layers, each a texture set and its settings: 1 to 16.'),
    /**
     * The packing every layer samples (each set must have it); default: each set's
     * `defaultPacking`, which must then agree.
     */
    packing: z
      .enum(TERRAIN_PACKINGS)
      .optional()
      .describe(
        "The packing every layer samples (each set must have it); default: each set's defaultPacking, which must then agree."
      ),
    /**
     * The macro variation: one fetch of a macro texture that varies every layer. The rules' noise
     * reads its texture too.
     */
    macro: TerrainMacroSchema.optional(),
    /**
     * A colour map at the mesh's UV (a block's own colour): `DETAIL` it gives the albedo and the
     * layers their detail, `FAR_ONLY` it's the far surface (`distance.far: 'COLOR_MAP'`). Its
     * texture becomes the input `colorMap`, which a block's variant swaps.
     */
    colorMap: TerrainColorMapSchema.optional(),
    /**
     * With `blend.source` `SPLAT_MAP` or `SPLAT_MAP_AND_RULES`, the splat maps' texture ids (`data`
     * slot textures, linear): the first weighs layers 1-4 (RGBA), the second 5-8, one per four
     * painted layers past the base. They become the inputs `splat0` and `splat1`, which a block's
     * variant swaps.
     */
    splatMaps: z
      .array(z.string().min(1))
      .min(1)
      .max(2)
      .optional()
      .describe(
        "With blend.source SPLAT_MAP or SPLAT_MAP_AND_RULES, the splat maps' texture ids: the first weighs layers 1-4, the second 5-8 (inputs splat0, splat1)."
      ),
    /**
     * The macro noise texture the rules' noise, the puddle patches (`wet.puddles.patches`) and the
     * streaks (`wet.streaks`) read (the input `macro`), for a material with any of them and no
     * `macro`, whose texture they read otherwise (default `macroNoise`, the toolkit's).
     */
    noiseTexture: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The macro noise texture the rules' noise, the puddle patches and the streaks read, without a macro (whose texture they read otherwise; default macroNoise)."
      ),
    /**
     * The ripple atlas the rain ripples read (the input `ripples`), for a material with
     * `wet.ripples` (its own or a tier's; default `rippleAtlas`, the toolkit's, or a bake's
     * `rippleAtlas.data`).
     */
    rippleTexture: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The ripple atlas the rain ripples read, for a material with wet.ripples (default rippleAtlas, or a bake's rippleAtlas.data)."
      ),
    /**
     * The texture set the snow cover is (the input `snow`, in its default packing), for a material
     * with `wet.snow` (its own or a tier's; default `snow01`, the toolkit's). With a far mode it
     * needs an `averageColor`, the snow past the band.
     */
    snowSet: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The texture set the snow cover is, for a material with wet.snow (default snow01); with a far mode it needs an averageColor.'
      ),
    /**
     * How the layers' textures bind (default `AUTO`: `SEPARATE` while it fits the texture budget
     * and nothing samples the layers in slots, else `ARRAY`). Sparse sampling and `HEX`'s
     * `apply: 'DOMINANT'` (the material's or a tier's) need `ARRAY`. A set array takes imported
     * sets: under `ARRAY` a procedural set's layer, and a layer live in the material or a tier,
     * keeps an input of its own beside it (sampled beside the slots). An `ARRAY` material's set
     * array must be built before it's created (`buildTextureSetArray({ sets, packing })`, or a
     * scene's `textureSetArrays`).
     */
    storage: z
      .enum(TERRAIN_STORAGES)
      .optional()
      .describe(
        "How the layers' textures bind (default AUTO: SEPARATE while it fits the texture budget and nothing samples the layers in slots, else ARRAY, one array per packing slot). Sparse sampling and DOMINANT need ARRAY."
      ),
    ...spaceFields,
    ...budgetFields,
    ...sharedFields,
    ...variantFields,
  })
  .strict()
  .superRefine(checkBlend)
  .superRefine(checkProjection)
  .superRefine(checkSlots)
  .superRefine(checkLive)
  .superRefine(checkFar)
  .superRefine(checkWetView)
  .superRefine(checkTextureIds)
  .superRefine(checkStorage)
  .describe("The terrain material's config (createTerrainMaterial).");

// p305 D1
/**
 * The terrain material's config, {@link createTerrainMaterial}'s argument: the layers'
 * texture sets and settings, and the techniques it compiles. Only what the config enables is in
 * the shader: every field is a build-time branch, its tunables uniforms.
 */
export type TerrainMaterialConfig = z.infer<typeof TerrainMaterialConfigSchema>;
