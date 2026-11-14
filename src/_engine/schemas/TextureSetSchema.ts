import { z } from 'zod';
import { ColorJSONSchema, DebugDataSchema, type ColorJSON } from './_HelperSchemas';
import { JsonSchemaRefSchema, SourcePathSchema } from './_SaveDataSchema';

// The texture set asset (p303 D1, D2): a named group of packed PBR maps (each a texture asset)
// with the physical facts of the surface, and the TSL input form that names one. The
// `textureSets()` feature's runtime reads the gathered form (`TextureSetDef`), which the gatherer
// writes into each scene that uses the set; its scene field is the feature's own
// (`features/texturesets/TextureSetsSchema.ts`). Here, not in the feature: the material schema
// checks the input form, and a schema imports no feature (the layout check).

/** A texture set's surface category (`TEXTURE_SET_CATEGORIES`), which the terrain tools read for
 * their defaults and grouping. */
export const TEXTURE_SET_CATEGORIES = [
  'SAND',
  'MUD',
  'ROCKS',
  'CLIFF',
  'SNOW',
  'ICE',
  'GRASS',
  'CONCRETE',
  'OTHER',
] as const;

/** A texture set's surface category: `SAND`, `MUD`, `ROCKS`, `CLIFF`, `SNOW`, `ICE`, `GRASS`,
 * `CONCRETE` or `OTHER`. */
export type TextureSetCategory = (typeof TEXTURE_SET_CATEGORIES)[number];

/**
 * Each packing's slots (p303 D2), in their order: a packing's textures are listed (and loaded) in
 * this order. A slot whose name starts with `albedo` holds colour (sRGB in RGB); the others hold
 * linear data.
 */
export const TEXTURE_SET_PACKINGS = {
  FULL: ['albedoHeight', 'normal', 'orm'],
  LITE: ['albedoRough', 'normalHeight'],
  MINIMAL: ['albedoHeight'],
} as const satisfies Record<string, readonly string[]>;

/** A texture set packing's name: `FULL`, `LITE` or `MINIMAL`. */
export type TextureSetPacking = keyof typeof TEXTURE_SET_PACKINGS;

/** A texture set packing's slot names, in their order. */
export type TextureSetSlot = (typeof TEXTURE_SET_PACKINGS)[TextureSetPacking][number];

/** The packings in the order a set's default is chosen when its JSON names none: `LITE` (the
 * terrain default, p303 D2) when the set has it, else `FULL`, else `MINIMAL`. */
export const TEXTURE_SET_PACKING_PREFERENCE = [
  'LITE',
  'FULL',
  'MINIMAL',
] as const satisfies readonly TextureSetPacking[];

/** Whether a packing slot holds colour (sRGB RGB), not linear data. */
export const isTextureSetColorSlot = (slot: string) => slot.startsWith('albedo');

const slotTexture = (description: string) =>
  z.string().min(1).describe(`${description} The id of a texture asset (*.texture.json).`);

/** The `FULL` packing's textures: albedo + height, normal, ORM. */
const FullPackingSchema = z
  .object({
    /** RGB albedo (sRGB), A height (linear). */
    albedoHeight: slotTexture('RGB albedo (sRGB), A height (linear).'),
    /** RGB the tangent-space normal (OpenGL, +Y). */
    normal: slotTexture('RGB the tangent-space normal (OpenGL, +Y).'),
    /** R ambient occlusion, G roughness, B metalness. */
    orm: slotTexture('R ambient occlusion, G roughness, B metalness.'),
  })
  .strict()
  .describe('Three textures: albedo + height, normal, ORM. Best quality, every feature.');

/** The `LITE` packing's textures: albedo × AO + roughness, normal XY + height. */
const LitePackingSchema = z
  .object({
    /** RGB albedo × AO (sRGB), A roughness (linear). */
    albedoRough: slotTexture('RGB albedo × AO (sRGB), A roughness (linear).'),
    /** RG the normal's X and Y (OpenGL, Z reconstructed), B height. */
    normalHeight: slotTexture("RG the normal's X and Y (OpenGL, Z reconstructed), B height."),
  })
  .strict()
  .describe('Two textures: albedo × AO + roughness, normal XY + height. The terrain default.');

/** The `MINIMAL` packing's texture: albedo × AO + height. */
const MinimalPackingSchema = z
  .object({
    /** RGB albedo × AO (sRGB), A height (linear). */
    albedoHeight: slotTexture('RGB albedo × AO (sRGB), A height (linear).'),
  })
  .strict()
  .describe('One texture: albedo × AO + height; the normal from height derivatives, or flat.');

/** The default of each `surface` field: what the gatherer writes for one a set doesn't give. The
 * wet response's (`porosity`, `wetDarkening`, `wetRoughness`) are provisional (p307 sets them per
 * category). */
export const TEXTURE_SET_SURFACE_DEFAULTS = {
  tint: '#ffffff',
  normalStrength: 1,
  roughnessScale: 1,
  aoStrength: 1,
  heightContrast: 1,
  porosity: 0.5,
  wetDarkening: 0.5,
  wetRoughness: 0.3,
} as const satisfies Record<string, ColorJSON | number>;

/** A procedural set's defaults (p304 D3): what the gatherer writes for a `procedural` field the
 * JSON doesn't give. */
export const TEXTURE_SET_PROCEDURAL_DEFAULTS = {
  packing: 'LITE',
  size: 1024,
  seed: 0,
} as const satisfies { packing: TextureSetPacking; size: number; seed: number };

const PackingEnumSchema = z.enum(
  Object.keys(TEXTURE_SET_PACKINGS) as [TextureSetPacking, ...TextureSetPacking[]]
);

const bakeSide = z.number().int().min(1).max(8192);

/** A procedural set's generator and how it's baked (p304 D3), in place of `packings`. */
const TextureSetProceduralSchema = z
  .object({
    /** The generator's id: a `<id>.generator.ts` module exporting `generator` (the toolkit's in
     * `aekasha/toolkit/terrain`, or an app's). */
    generator: z
      .string()
      .min(1)
      .describe(
        "The generator's id: a <id>.generator.ts module exporting generator (the toolkit's, or an app's)."
      ),
    /** The generator's params by name: a number, a colour (sRGB `#rrggbb`) or a toggle. A param
     * left out takes the generator's default. */
    params: z
      .record(
        z.string(),
        z.union([
          z.number(),
          z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour param is sRGB "#rrggbb".'),
          z.boolean(),
        ])
      )
      .optional()
      .describe(
        'The generator\'s params by name: a number, a colour (sRGB "#rrggbb") or a toggle. A param left out takes its default.'
      ),
    /** The seed every noise of the surface derives from, a whole number. Default 0. */
    seed: z
      .number()
      .int()
      .optional()
      .describe('The seed every noise of the surface derives from, a whole number. Default 0.'),
    /** The baked textures' width and height in texels, one number for a square. Default 1024. */
    size: z
      .union([bakeSide, z.tuple([bakeSide, bakeSide])])
      .optional()
      .describe(
        "The baked textures' width and height in texels (1-8192), one number for a square. Default 1024."
      ),
    /** The packing baked: the set's only (and default) packing. Default `LITE`. */
    packing: PackingEnumSchema.optional().describe(
      "The packing baked (FULL, LITE, MINIMAL): the set's only and default packing. Default LITE."
    ),
  })
  .strict()
  .describe(
    "A procedural set: baked on load by its generator into one packing's textures (uncompressed RGBA8), in place of packings. Needs the generator's module in the gathered code."
  );

/** A procedural set's `procedural` field as its JSON gives it. */
export type TextureSetProcedural = z.infer<typeof TextureSetProceduralSchema>;

/** A procedural set's `procedural` field as the gatherer writes it: every field given (`params`
 * as the JSON's, the generator's defaults filling the rest at the bake). */
export type TextureSetProceduralDef = {
  [K in keyof TextureSetProcedural]-?: NonNullable<TextureSetProcedural[K]>;
};

const nonNegative = (description: string) => z.number().min(0).optional().describe(description);
const unit = (description: string) => z.number().min(0).max(1).optional().describe(description);

/** The surface's defaults, which a terrain material copies into uniforms (each layer may
 * override any of them). */
const TextureSetSurfaceSchema = z
  .object({
    /** A colour multiplied into the albedo (sRGB). Default white. */
    tint: ColorJSONSchema.optional().describe(
      'A colour multiplied into the albedo (sRGB: "#ff8800" or { r, g, b } in 0-255). Default white.'
    ),
    /** Scales the normal's XY. Default 1. */
    normalStrength: nonNegative("Scales the normal's XY. Default 1."),
    /** Scales the roughness. Default 1. */
    roughnessScale: nonNegative('Scales the roughness. Default 1.'),
    /** How much of the ambient occlusion applies (0 none, 1 all). Default 1. */
    aoStrength: unit('How much of the ambient occlusion applies (0 none, 1 all). Default 1.'),
    /** Sharpens (> 1) or softens (< 1) the height for height blending. Default 1. */
    heightContrast: nonNegative(
      'Sharpens (> 1) or softens (< 1) the height for height blending. Default 1.'
    ),
    /** How much water the surface soaks up (0 none, 1 all). Default 0.5. */
    porosity: unit('How much water the surface soaks up (0 none, 1 all). Default 0.5.'),
    /** How much wetness darkens the albedo (0 none, 1 black). Default 0.5. */
    wetDarkening: unit('How much wetness darkens the albedo (0 none, 1 black). Default 0.5.'),
    /** The roughness of the fully wet surface. Default 0.3. */
    wetRoughness: unit('The roughness of the fully wet surface. Default 0.3.'),
  })
  .strict()
  .describe(
    'The surface defaults a terrain material copies into uniforms (each layer may override any).'
  );

/**
 * A texture set JSON (`*.textureSet.json`, p303 D1): a named group of packed PBR maps (each slot a
 * texture asset's id) and the physical facts of the surface. A scene lists it in its `textureSets`
 * (its default packing's textures load), or a TSL material names it in an input
 * (`{ "textureSet": "sand01" }`). A procedural set (p304 D3) gives `procedural` (a generator, baked
 * on load into one packing) in place of `packings`. Needs the `textureSets()` feature.
 */
export const TextureSetAssetSchema = z
  .object({
    /** The JSON Schema an editor validates the file with. */
    $schema: JsonSchemaRefSchema.optional(),
    /** The registry id, which scenes and materials name the set by. Default: the file's name. */
    id: z
      .string()
      .optional()
      .describe("The registry id scenes and materials name it by. Default: the file's name."),
    /** The surface's category, which the terrain tools read for their defaults and grouping. */
    category: z
      .enum(TEXTURE_SET_CATEGORIES)
      .describe("The surface's category, for the terrain tools' defaults and grouping."),
    /** The metres one tile covers, `[width, height]`. */
    physicalSize: z
      .tuple([z.number().positive(), z.number().positive()])
      .describe('The metres one tile covers: [width, height].'),
    /** The metres of relief a height of 1 stands for (the height is packed to the full 0..1). */
    heightScale: z
      .number()
      .min(0)
      .describe('The metres of relief a height of 1 stands for (heights are packed to 0..1).'),
    /** The packing a scene listing the set loads. Default: `LITE` when the set has it, else
     * `FULL`, else `MINIMAL`; a procedural set's is its `procedural.packing`. */
    defaultPacking: PackingEnumSchema.optional().describe(
      "The packing a scene listing the set loads. Default: LITE when the set has it, else FULL, else MINIMAL; a procedural set's is its procedural.packing."
    ),
    /** The set's textures by packing and slot: at least one packing. Not with `procedural`. */
    packings: z
      .object({
        /** Three textures: albedo + height, normal, ORM. */
        FULL: FullPackingSchema.optional(),
        /** Two textures: albedo × AO + roughness, normal XY + height. */
        LITE: LitePackingSchema.optional(),
        /** One texture: albedo × AO + height. */
        MINIMAL: MinimalPackingSchema.optional(),
      })
      .strict()
      .refine((packings) => Object.keys(packings).length > 0, {
        message: 'A texture set needs at least one packing.',
      })
      .optional()
      .describe(
        "The set's textures by packing (FULL, LITE, MINIMAL) and slot: at least one. A procedural set gives procedural instead."
      ),
    /** A procedural set's generator, baked on load into one packing (p304 D3). Not with
     * `packings`. */
    procedural: TextureSetProceduralSchema.optional(),
    /** The surface's defaults, which a terrain material copies into uniforms. */
    surface: TextureSetSurfaceSchema.optional(),
    /** The albedo's average colour (sRGB). Default: the asset pipeline's, from the shipped map. */
    averageColor: ColorJSONSchema.optional().describe(
      "The albedo's average colour (sRGB). Default: the one the asset pipeline measures."
    ),
    /** What the debug tools show for the set. */
    debugData: DebugDataSchema.optional(),
    /** Set by the gatherer: the file it came from. */
    __sourcePath: SourcePathSchema.optional(),
  })
  .superRefine((set, issue) => {
    if (!set.packings === !set.procedural) {
      issue.addIssue({
        code: 'custom',
        path: set.packings ? ['procedural'] : ['packings'],
        message: set.packings
          ? 'A texture set gives either packings (imported textures) or procedural (a generator), not both.'
          : 'A texture set needs packings (imported textures) or procedural (a generator).',
      });
    }
    const baked =
      set.procedural && (set.procedural.packing ?? TEXTURE_SET_PROCEDURAL_DEFAULTS.packing);
    if (baked && set.defaultPacking && set.defaultPacking !== baked) {
      issue.addIssue({
        code: 'custom',
        path: ['defaultPacking'],
        message: `A procedural set has one packing, its procedural.packing (${baked}): leave defaultPacking out.`,
      });
    }
  });

/** A texture set JSON (`*.textureSet.json`), as {@link TextureSetAssetSchema} validates it. */
export type TextureSetAsset = z.infer<typeof TextureSetAssetSchema>;

/** A texture set's surface defaults, every field given (`TEXTURE_SET_SURFACE_DEFAULTS` for the
 * missing ones). */
export type TextureSetSurface = {
  [K in keyof typeof TEXTURE_SET_SURFACE_DEFAULTS]-?: K extends 'tint' ? ColorJSON : number;
};

/**
 * A texture set as the gatherer writes it into a scene's `textureSets` (and the development
 * data's section): its id, `defaultPacking` and every `surface` field filled in (a procedural
 * set's `procedural` too, and its packing's slots named), the build-time fields dropped.
 */
export type TextureSetDef = Omit<
  TextureSetAsset,
  '$schema' | '__sourcePath' | 'id' | 'defaultPacking' | 'surface' | 'packings' | 'procedural'
> & {
  /** The set's id. */
  id: string;
  /** The packing a scene listing the set loads. */
  defaultPacking: TextureSetPacking;
  /** The set's textures by packing and slot. A procedural set's one packing names the textures
   * its bake registers, `<id>.<slot>`. */
  packings: NonNullable<TextureSetAsset['packings']>;
  /** A procedural set's generator and bake, every field given (p304 D3). */
  procedural?: TextureSetProceduralDef;
  /** The surface's defaults, every field given. */
  surface: TextureSetSurface;
};

/**
 * A TSL input's texture set (p303 D1): `{ "textureSet": "sand01" }` is a bundle of the set's default
 * packing's textures (`"packing"` picks another) and its surface uniforms (`TextureSetInputRef` on
 * `aekasha/texturesets`). Needs the `textureSets()` feature.
 */
export const TextureSetInputSchema = z
  .object({
    /** The texture set's id (a `*.textureSet.json`). */
    textureSet: z.string().describe("The texture set's id (a *.textureSet.json)."),
    /** The packing sampled. Default: the set's `defaultPacking`. */
    packing: z
      .enum(Object.keys(TEXTURE_SET_PACKINGS) as [TextureSetPacking, ...TextureSetPacking[]])
      .optional()
      .describe("The packing sampled (FULL, LITE, MINIMAL). Default: the set's defaultPacking."),
  })
  .strict()
  .describe(
    "A texture set: each slot's texture of its packing and its surface uniforms, by name. Needs the textureSets() feature."
  );

/**
 * A TSL input's texture set array (p303 D4): `{ "textureSetArray": ["sand01", "grass01"],
 * "packing": "LITE" }` is a bundle of the packing's array textures (layer `i` from the `i`th set)
 * and the layers' params (`TextureSetArrayInputRef` on `aekasha/texturesets`), or
 * `{ "textureSetArray": "gallery" }` a set array the scene lists with that `id`. The arrays are
 * built with the scene's load. Needs the `textureSets()` feature.
 */
export const TextureSetArrayInputSchema = z
  .union([
    z
      .object({
        /** The texture sets' ids, layer `i` from `textureSetArray[i]`. */
        textureSetArray: z
          .array(z.string().min(1))
          .min(1)
          .describe('The texture set ids (*.textureSet.json), layer i from the ith.'),
        /** The packing every layer is in: one array per slot. */
        packing: PackingEnumSchema.describe(
          'The packing every layer is in (FULL, LITE, MINIMAL): one array per slot.'
        ),
      })
      .strict(),
    z
      .object({
        /** The id of a set array the scene lists (its `textureSetArrays`' `id`). */
        textureSetArray: z
          .string()
          .min(1)
          .describe("The id of a set array the scene lists (its textureSetArrays' id)."),
      })
      .strict(),
  ])
  .describe(
    "A texture set array: the packing's array textures and the layers' params, by name. Needs the textureSets() feature."
  );

/**
 * A set array a scene builds with its load (p303 D4, the scene's `textureSetArrays`): what its
 * code and its materials' `{ textureSetArray }` inputs sample.
 */
export const SceneTextureSetArraySchema = z
  .object({
    /** The set array's id, which a material's `{ "textureSetArray": id }` and code name. Default:
     * derived from the packing and the sets, as `buildTextureSetArray` derives it. */
    id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The set array's id, which a material's { textureSetArray: id } and code name. Default: derived from the packing and the sets."
      ),
    /** The texture sets' ids, layer `i` from `sets[i]`. */
    sets: z
      .array(z.string().min(1))
      .min(1)
      .describe('The texture set ids (*.textureSet.json), layer i from the ith.'),
    /** The packing every layer is in: one array per slot. */
    packing: PackingEnumSchema.describe(
      'The packing every layer is in (FULL, LITE, MINIMAL): one array per slot.'
    ),
    /** Keeps the arrays' CPU copies, so code can swap a layer (`setTextureSetArrayLayer`).
     * Default false. */
    swappable: z
      .boolean()
      .optional()
      .describe(
        "Keeps the arrays' CPU copies, so code can swap a layer (setTextureSetArrayLayer). Default false."
      ),
  })
  .strict()
  .describe('A set array the scene builds with its load (the textureSets() feature).');

/** A set array a scene builds with its load (`textureSetArrays`), as its JSON lists it. */
export type SceneTextureSetArrayEntry = z.infer<typeof SceneTextureSetArraySchema>;
