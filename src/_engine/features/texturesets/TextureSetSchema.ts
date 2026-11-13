import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import { ColorJSONSchema, DebugDataSchema, type ColorJSON } from '../../schemas/_HelperSchemas';
import { JsonSchemaRefSchema, SourcePathSchema } from '../../schemas/_SaveDataSchema';

// The texture set asset (p303 D1, D2): a named group of packed PBR maps (each a texture asset)
// with the physical facts of the surface. The `textureSets()` feature's runtime reads the
// gathered form (`TextureSetDef`), which the gatherer writes into each scene that uses the set.

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
 * (`{ "textureSet": "sand01" }`). Needs the `textureSets()` feature.
 */
export const TextureSetAssetSchema = z.object({
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
   * `FULL`, else `MINIMAL`. */
  defaultPacking: z
    .enum(Object.keys(TEXTURE_SET_PACKINGS) as [TextureSetPacking, ...TextureSetPacking[]])
    .optional()
    .describe(
      'The packing a scene listing the set loads. Default: LITE when the set has it, else FULL, else MINIMAL.'
    ),
  /** The set's textures by packing and slot: at least one packing. */
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
    .describe("The set's textures by packing (FULL, LITE, MINIMAL) and slot: at least one."),
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
 * data's section): its id, `defaultPacking` and every `surface` field filled in, the build-time
 * fields dropped.
 */
export type TextureSetDef = Omit<
  TextureSetAsset,
  '$schema' | '__sourcePath' | 'id' | 'defaultPacking' | 'surface'
> & {
  /** The set's id. */
  id: string;
  /** The packing a scene listing the set loads. */
  defaultPacking: TextureSetPacking;
  /** The surface's defaults, every field given. */
  surface: TextureSetSurface;
};

/** The texture sets feature's scene field (p303 D1): `textureSets`, the ids of the
 * `*.textureSet.json` sets code uses (each loads its default packing). */
export const textureSetsSchemaPart = {
  feature: 'texturesets',
  scene: {
    /** Texture set ids (`*.textureSet.json`) the scene's code uses: each loads its default
     * packing's textures. The gather adds the sets its materials' inputs name. */
    textureSets: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Texture set ids (*.textureSet.json) the scene's code uses: each loads its default packing's textures. The gather adds the sets its materials' inputs name."
      ),
  },
} satisfies FeatureSchemaPart;
