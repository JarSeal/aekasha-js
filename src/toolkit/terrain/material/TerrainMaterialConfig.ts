// The terrain material's config (p305 D1), as Zod schemas and the types inferred from them: the
// code route's `TerrainMaterialConfig` (`createTerrainMaterial`) and the JSON route's static define
// (`staticDefines.terrain`, `TerrainMaterialDefine`), which is the config without the material's
// id and the layers' sets: the sets are the material's inputs (`layer<i>`), which the gather's
// texture closure reads and a variant swaps per block without another shader. The graph
// (`TerrainMaterial.ts`) imports only types from here, so a build that uses the generator carries
// no zod: it checks the define's values by hand as it reads them (the tests keep both in step).
// Each phase of p305 adds its fields: a key the schema doesn't know is refused.
import { z } from 'zod';
import { TERRAIN_RULE_NOISE_CHANNELS } from 'aekasha/toolkit/geometry';

/** The layer's sampled source: `TEXTURE`, a texture set's maps. */
export const TERRAIN_LAYER_SOURCES = ['TEXTURE'] as const;
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
 * fits the texture budget, else `ARRAY`; `SEPARATE` each layer's packing slots (`{ textureSet }`
 * inputs `layer<i>`); `ARRAY` one array texture per slot for every layer (a `{ textureSetArray }`
 * input `layers`).
 */
export const TERRAIN_STORAGES = ['AUTO', 'SEPARATE', 'ARRAY'] as const;
/** The quality tiers a terrain material's `quality` table overrides (p240's scale). */
export const TERRAIN_QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;
/**
 * The debug views (debug env only): `TEXEL_DENSITY` a 1 m checker in bands of texels per metre,
 * `NORMALS` the shaded normal in world space, `WEIGHTS` each layer's false colour by its weight.
 */
export const TERRAIN_DEBUG_VIEWS = ['TEXEL_DENSITY', 'NORMALS', 'WEIGHTS'] as const;
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

/**
 * How a layer breaks its tiling's repetition (p305 D3), by `mode`: `NONE`, `DUAL_SCALE` or `HEX`,
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
        /** The second tap's scale of the UV, under 1 (default 0.23: tiles 4.3 × as large). */
        farScale: z
          .number()
          .gt(0)
          .lt(1)
          .optional()
          .describe(
            "The second tap's scale of the UV, under 1 (default 0.23: tiles 4.3 × as large)."
          ),
        /**
         * The view distances in metres over which the second tap's share grows from the near
         * share to the far one (default `[6, 40]`).
         */
        distance: metreRange(
          "The view distances in metres over which the second tap's share grows (default [6, 40])."
        ).optional(),
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
      })
      .strict(),
  ])
  .describe("How a layer breaks its tiling's repetition: NONE, DUAL_SCALE or HEX.");

/** How a layer breaks its tiling's repetition (p305 D3): `NONE`, `DUAL_SCALE` or `HEX`. */
export type TerrainAntiTiling = z.infer<typeof TerrainAntiTilingSchema>;

/**
 * A layer's settings, without its set: the static define's layer. Each tunable becomes a uniform
 * (`terrain_l<i>_<name>` in the material's `userData.uniforms`), so the material editor and code
 * edit it live; a multiplier applies over the set's own `surface` field of that name.
 */
export const TerrainLayerSettingsSchema = z
  .object({
    /** What the layer samples: `TEXTURE` (default), its texture set's maps. */
    source: z
      .enum(TERRAIN_LAYER_SOURCES)
      .optional()
      .describe("What the layer samples: TEXTURE (default), its texture set's maps."),
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

/**
 * How the layers' weights are made (p305 D4), by `source`: `SINGLE`, `VERTEX_COLOR`,
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

/**
 * How a terrain material's layers are weighed (p305 D4): `SINGLE`, `VERTEX_COLOR`, `SPLAT_MAP`,
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
  })
  .strict()
  .describe("The view distance's effects on the surface.");

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
  /** The view distance's effects: the detail normals' fade. */
  distance: TerrainDistanceSchema.optional(),
};

/**
 * A quality tier's overrides: material-wide fields over the material's own (shallowly, a field's
 * object replacing the material's whole), for the tier's variant (`getTerrainMaterialVariant`).
 */
export const TerrainQualityOverridesSchema = z
  .object(sharedFields)
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
   * `loadTerrainDebugViewsAsync`): `TEXEL_DENSITY`, `NORMALS` or `WEIGHTS`.
   */
  debugView: z
    .enum(TERRAIN_DEBUG_VIEWS)
    .optional()
    .describe(
      'A debug view in place of the surface (debug env only; its code loads with loadTerrainDebugViewsAsync): TEXEL_DENSITY, NORMALS or WEIGHTS.'
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

/** Whether a rule of the material's blend or of a tier's reads the noise texture */
const hasRuleNoise = (value: {
  blend?: TerrainBlend;
  quality?: Partial<Record<string, { blend?: TerrainBlend } | undefined>>;
}) =>
  [value.blend, ...Object.values(value.quality ?? {}).map((tier) => tier?.blend)].some((blend) =>
    getRules(blend).some((rule) => rule.noise)
  );

type BlendFields = { blend?: TerrainBlend; ao?: z.infer<typeof TerrainAoSchema> };

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
  }));
  for (const { path, blend, ao } of [{ path: [], blend: value.blend, ao: value.ao }, ...tiers]) {
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
  }
};

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
    quality?: Partial<Record<string, { blend?: TerrainBlend } | undefined>>;
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
  if (value.noiseTexture !== undefined && !hasRuleNoise(value)) {
    issue(
      'noiseTexture',
      "is for rules with noise (blend.rules[i].noise, the material's or a tier's)."
    );
  } else if (value.noiseTexture !== undefined && value.macro) {
    issue('noiseTexture', "is macro.texture's with a macro: the rules' noise reads it.");
  }
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
    ...budgetFields,
    ...sharedFields,
    ...variantFields,
  })
  .strict()
  .superRefine(checkBlend)
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
     * How the layers' textures bind (default `AUTO`: `SEPARATE` while it fits the texture budget,
     * else `ARRAY`). An `ARRAY` material's set array must be built before it's created
     * (`buildTextureSetArray({ sets, packing })`, or a scene's `textureSetArrays`).
     */
    /**
     * The macro noise texture the rules' noise reads (the input `macro`), for a material with
     * rule noise and no `macro`, whose texture they read otherwise (default `macroNoise`, the
     * toolkit's).
     */
    noiseTexture: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The macro noise texture the rules' noise reads, without a macro (whose texture it reads otherwise; default macroNoise)."
      ),
    storage: z
      .enum(TERRAIN_STORAGES)
      .optional()
      .describe(
        "How the layers' textures bind (default AUTO: SEPARATE while it fits the texture budget, else ARRAY, one array per packing slot)."
      ),
    ...budgetFields,
    ...sharedFields,
    ...variantFields,
  })
  .strict()
  .superRefine(checkBlend)
  .superRefine(checkTextureIds)
  .describe("The terrain material's config (createTerrainMaterial).");

/**
 * The terrain material's config (p305 D1), {@link createTerrainMaterial}'s argument: the layers'
 * texture sets and settings, and the techniques it compiles. Only what the config enables is in
 * the shader: every field is a build-time branch, its tunables uniforms.
 */
export type TerrainMaterialConfig = z.infer<typeof TerrainMaterialConfigSchema>;
