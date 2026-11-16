// The terrain material's config (p305 D1), as Zod schemas and the types inferred from them: the
// code route's `TerrainMaterialConfig` (`createTerrainMaterial`) and the JSON route's static define
// (`staticDefines.terrain`, `TerrainMaterialDefine`), which is the config without the material's
// id and the layers' sets: the sets are the material's inputs (`layer<i>`), which the gather's
// texture closure reads and a variant swaps per block without another shader. The graph
// (`TerrainMaterial.ts`) imports only types from here, so a build that uses the generator carries
// no zod: it checks the define's values by hand as it reads them (the tests keep both in step).
// Each phase of p305 adds its fields: a key the schema doesn't know is refused.
import { z } from 'zod';

/** The layer's sampled source: `TEXTURE`, a texture set's maps. */
export const TERRAIN_LAYER_SOURCES = ['TEXTURE'] as const;
/** The tiling coordinates: `WORLD` (the world's `(x, −z)`, seen from above) or `MESH_UV`. */
export const TERRAIN_UV_MODES = ['WORLD', 'MESH_UV'] as const;
/**
 * Where the layers' weights come from (p305 D4): `SINGLE` one layer everywhere, `VERTEX_COLOR` the
 * mesh's colour attribute, `SPLAT_MAP` one or two RGBA textures at the mesh's UV.
 */
export const TERRAIN_BLEND_SOURCES = ['SINGLE', 'VERTEX_COLOR', 'SPLAT_MAP'] as const;
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
 * per weight channel (`RGB_AO` 3, `RGBA` 4); splat maps the base and four per map (two maps at most).
 */
export const TERRAIN_BLEND_LAYER_COUNTS = {
  SINGLE: [1, 1],
  VERTEX_COLOR_RGB_AO: [2, 4],
  VERTEX_COLOR_RGBA: [2, 5],
  SPLAT_MAP: [2, 9],
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
 * `NORMALS` the shaded normal in world space.
 */
export const TERRAIN_DEBUG_VIEWS = ['TEXEL_DENSITY', 'NORMALS'] as const;
/** The most layers a terrain material blends. */
export const TERRAIN_MAX_LAYERS = 16;
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

/**
 * How the layers' weights are made (p305 D4), by `source`: `SINGLE`, `VERTEX_COLOR` or
 * `SPLAT_MAP`, each with its own fields. The layer count must suit the source
 * ({@link TERRAIN_BLEND_LAYER_COUNTS}).
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
  ])
  .describe("How the layers' weights are made: SINGLE, VERTEX_COLOR or SPLAT_MAP.");

/** How a terrain material's layers are weighed (p305 D4): `SINGLE`, `VERTEX_COLOR` or `SPLAT_MAP`. */
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
     * foot). `blend.source: 'VERTEX_COLOR'` with the `RGB_AO` layout only.
     */
    vertex: z
      .boolean()
      .optional()
      .describe(
        "The vertex colour's A as a baked AO, to aoNode. blend.source VERTEX_COLOR with the RGB_AO layout only."
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
   * `loadTerrainDebugViewsAsync`): `TEXEL_DENSITY` or `NORMALS`.
   */
  debugView: z
    .enum(TERRAIN_DEBUG_VIEWS)
    .optional()
    .describe(
      'A debug view in place of the surface (debug env only; its code loads with loadTerrainDebugViewsAsync): TEXEL_DENSITY or NORMALS.'
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

/** The splat maps `count` layers take: one per four layers past the base */
const getSplatMapCount = (layerCount: number) => Math.ceil((layerCount - 1) / 4);

type BlendFields = { blend?: TerrainBlend; ao?: z.infer<typeof TerrainAoSchema> };

/**
 * The blend and the AO of the material's fields and of each tier's (a tier's over the material's):
 * the layer count suits the source, a depth only with the height blend, the vertex AO only with
 * `RGB_AO` vertex colours. The refinement both schemas share.
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
    if (blend && blend.source !== 'SINGLE' && blend.mode === 'LINEAR' && blend.heightBlendDepth) {
      issue([...path, 'blend', 'heightBlendDepth'], 'is for blend.mode HEIGHT, not LINEAR.');
    }
    const isRgbAo = blend?.source === 'VERTEX_COLOR' && blend.vertexColor?.layout !== 'RGBA';
    if (ao?.vertex && !isRgbAo) {
      issue([...path, 'ao', 'vertex'], 'needs blend.source VERTEX_COLOR with the RGB_AO layout.');
    }
  }
};

/**
 * The code route's splat maps: one texture id per map the layers need, with `SPLAT_MAP` only
 */
const checkSplatMaps = (
  value: { layers: unknown[]; blend?: TerrainBlend; splatMaps?: string[] },
  ctx: z.RefinementCtx
) => {
  const isSplat = value.blend?.source === 'SPLAT_MAP';
  const count = isSplat ? getSplatMapCount(value.layers.length) : 0;
  if (!isSplat && value.splatMaps) {
    ctx.addIssue({
      code: 'custom',
      path: ['splatMaps'],
      message: 'is for blend.source SPLAT_MAP.',
    });
  } else if (isSplat && value.splatMaps?.length !== count) {
    ctx.addIssue({
      code: 'custom',
      path: ['splatMaps'],
      message: `${value.layers.length} layers take ${count} splat map${count === 1 ? '' : 's'}: give their texture ids.`,
    });
  }
};

/**
 * The JSON route's static define, `staticDefines.terrain` of a material whose TSL functions are
 * the terrain material's (`terrain.material.json`, or `tslMaterialId: 'aek.terrain'`): the config
 * without the material's id, the layers without their sets (the inputs `layer0`, `layer1`, … give
 * them, `{ "textureSet": id, "packing"? }`, all in one packing).
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
    /** The macro variation: one fetch of a macro texture that varies every layer. */
    macro: TerrainMacroSchema.optional(),
    /**
     * With `blend.source: 'SPLAT_MAP'`, the splat maps' texture ids (`data` slot textures, linear):
     * the first weighs layers 1-4 (RGBA), the second 5-8, one per four layers past the base. They
     * become the inputs `splat0` and `splat1`, which a block's variant swaps.
     */
    splatMaps: z
      .array(z.string().min(1))
      .min(1)
      .max(2)
      .optional()
      .describe(
        "With blend.source SPLAT_MAP, the splat maps' texture ids: the first weighs layers 1-4, the second 5-8 (inputs splat0, splat1)."
      ),
    /**
     * How the layers' textures bind (default `AUTO`: `SEPARATE` while it fits the texture budget,
     * else `ARRAY`). An `ARRAY` material's set array must be built before it's created
     * (`buildTextureSetArray({ sets, packing })`, or a scene's `textureSetArrays`).
     */
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
  .superRefine(checkSplatMaps)
  .describe("The terrain material's config (createTerrainMaterial).");

/**
 * The terrain material's config (p305 D1), {@link createTerrainMaterial}'s argument: the layers'
 * texture sets and settings, and the techniques it compiles. Only what the config enables is in
 * the shader: every field is a build-time branch, its tunables uniforms.
 */
export type TerrainMaterialConfig = z.infer<typeof TerrainMaterialConfigSchema>;
