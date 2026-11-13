import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { ColorSpaceSchema, DebugDataSchema, UserDataSchema } from './_HelperSchemas';
import {
  AssetFileNameSchema,
  GeneratedAssetFieldsSchema,
  PublicFileNameSchema,
  TextureOptimizeSchema,
  TexturePackSchema,
} from './AssetsConfigSchema';

/**
 * three's texture constants a texture JSON names (p302 D1): per `texOpts` field, each name and
 * its number. A JSON gives either (`"wrapS": "REPEAT"` or `"wrapS": 1000`); the schema maps a
 * name to its number, so the gathered data and the runtime see three's constants only.
 * `TextureSchema.test.ts` checks the numbers against three's.
 * @internal
 */
export const TEXTURE_CONSTANTS = {
  mapping: {
    UV: 300,
    CUBE_REFLECTION: 301,
    CUBE_REFRACTION: 302,
    EQUIRECTANGULAR_REFLECTION: 303,
    EQUIRECTANGULAR_REFRACTION: 304,
  },
  wrapping: { REPEAT: 1000, CLAMP_TO_EDGE: 1001, MIRRORED_REPEAT: 1002 },
  magFilter: { NEAREST: 1003, LINEAR: 1006 },
  minFilter: {
    NEAREST: 1003,
    NEAREST_MIPMAP_NEAREST: 1004,
    NEAREST_MIPMAP_LINEAR: 1005,
    LINEAR: 1006,
    LINEAR_MIPMAP_NEAREST: 1007,
    LINEAR_MIPMAP_LINEAR: 1008,
  },
  type: {
    UNSIGNED_BYTE: 1009,
    BYTE: 1010,
    SHORT: 1011,
    UNSIGNED_SHORT: 1012,
    INT: 1013,
    UNSIGNED_INT: 1014,
    FLOAT: 1015,
    HALF_FLOAT: 1016,
    UNSIGNED_SHORT_4444: 1017,
    UNSIGNED_SHORT_5551: 1018,
    UNSIGNED_INT_248: 1020,
    UNSIGNED_INT_5999: 35902,
    UNSIGNED_INT_101111: 35899,
  },
  format: {
    ALPHA: 1021,
    RGB: 1022,
    RGBA: 1023,
    DEPTH: 1026,
    DEPTH_STENCIL: 1027,
    RED: 1028,
    RED_INTEGER: 1029,
    RG: 1030,
    RG_INTEGER: 1031,
    RGB_INTEGER: 1032,
    RGBA_INTEGER: 1033,
  },
} as const;

/** One of {@link TEXTURE_CONSTANTS}' fields as a schema: a name or a number, parsed to the number
 * (the JSON Schema writer writes a transform as its input, `writeJsonSchemas`). */
const createTextureConstantSchema = <T extends Record<string, number>>(
  table: T,
  description: string
) => {
  const names = Object.keys(table) as [keyof T & string, ...(keyof T & string)[]];
  const values = Object.values(table) as T[keyof T][];
  return z
    .union([z.enum(names), z.literal(values)])
    .transform((value): T[keyof T] => (typeof value === 'string' ? table[value] : value))
    .describe(description);
};

/** A 2D vector as `[x, y]`. */
const Vec2TupleSchema = z.tuple([z.number(), z.number()]);

/**
 * A texture's `texOpts` in a JSON: three's sampler state, UV transform and upload settings, and
 * the colour space. three's constants by name or number (`TEXTURE_CONSTANTS`), parsed to the
 * number. The runtime's `TexOpts` also takes an `image`. The texture, texture array, atlas,
 * import and merge material schemas use it.
 * @internal
 */
export const TexOptsSchema = z
  .object({
    /** three's mapping: `UV` (300, its default), `CUBE_REFLECTION` (301), `CUBE_REFRACTION`
     * (302), `EQUIRECTANGULAR_REFLECTION` (303), `EQUIRECTANGULAR_REFRACTION` (304). */
    mapping: createTextureConstantSchema(
      TEXTURE_CONSTANTS.mapping,
      'three\'s mapping: "UV" (300, default), "CUBE_REFLECTION" (301), "CUBE_REFRACTION" (302), "EQUIRECTANGULAR_REFLECTION" (303), "EQUIRECTANGULAR_REFRACTION" (304).'
    ).optional(),
    /** three's horizontal wrapping: `REPEAT` (1000), `CLAMP_TO_EDGE` (1001, its default),
     * `MIRRORED_REPEAT` (1002). */
    wrapS: createTextureConstantSchema(
      TEXTURE_CONSTANTS.wrapping,
      'Horizontal wrapping: "REPEAT" (1000), "CLAMP_TO_EDGE" (1001, default), "MIRRORED_REPEAT" (1002).'
    ).optional(),
    /** three's vertical wrapping, as `wrapS`. */
    wrapT: createTextureConstantSchema(
      TEXTURE_CONSTANTS.wrapping,
      'Vertical wrapping: "REPEAT" (1000), "CLAMP_TO_EDGE" (1001, default), "MIRRORED_REPEAT" (1002).'
    ).optional(),
    /** three's magnification filter: `NEAREST` (1003), `LINEAR` (1006, its default). */
    magFilter: createTextureConstantSchema(
      TEXTURE_CONSTANTS.magFilter,
      'Magnification filter: "NEAREST" (1003), "LINEAR" (1006, default).'
    ).optional(),
    /** three's minification filter: `NEAREST` (1003), `NEAREST_MIPMAP_NEAREST` (1004),
     * `NEAREST_MIPMAP_LINEAR` (1005), `LINEAR` (1006), `LINEAR_MIPMAP_NEAREST` (1007),
     * `LINEAR_MIPMAP_LINEAR` (1008, its default). */
    minFilter: createTextureConstantSchema(
      TEXTURE_CONSTANTS.minFilter,
      'Minification filter: "NEAREST" (1003), "NEAREST_MIPMAP_NEAREST" (1004), "NEAREST_MIPMAP_LINEAR" (1005), "LINEAR" (1006), "LINEAR_MIPMAP_NEAREST" (1007), "LINEAR_MIPMAP_LINEAR" (1008, default).'
    ).optional(),
    /** three's texel data type (`UNSIGNED_BYTE`, 1009, its default; `FLOAT`, 1015; `HALF_FLOAT`,
     * 1016; …). Set by the loader: rarely overridden. */
    type: createTextureConstantSchema(
      TEXTURE_CONSTANTS.type,
      'Texel type: "UNSIGNED_BYTE" (1009, default), "FLOAT" (1015), "HALF_FLOAT" (1016), … Set by the loader: rarely overridden.'
    ).optional(),
    /** three's pixel format (`RGBA`, 1023, its default; `RED`, 1028; `RG`, 1030; …). Set by the
     * loader: rarely overridden. */
    format: createTextureConstantSchema(
      TEXTURE_CONSTANTS.format,
      'Pixel format: "RGBA" (1023, default), "RED" (1028), "RG" (1030), … Set by the loader: rarely overridden.'
    ).optional(),
    /** The anisotropic filtering samples (three's default 1: off), or `"MAX"` for the device's
     * most (the renderer's `getMaxAnisotropy()`). Only with linear filters. */
    anisotropy: z
      .union([z.number().int().min(1), z.literal('MAX')])
      .optional()
      .describe(
        'Anisotropic filtering samples (default 1: off), or "MAX" for the device\'s most. Only with linear filters.'
      ),
    /** How often the texture repeats over the UVs, `[x, y]` (three's default `[1, 1]`); past 1
     * needs `REPEAT` wrapping. */
    repeat: Vec2TupleSchema.optional().describe(
      'How often it repeats over the UVs, [x, y] (default [1, 1]); past 1 needs "REPEAT" wrapping.'
    ),
    /** The UV offset, `[x, y]` (three's default `[0, 0]`). */
    offset: Vec2TupleSchema.optional().describe('The UV offset, [x, y] (default [0, 0]).'),
    /** The UV rotation in radians around `center` (three's default 0). */
    rotation: z
      .number()
      .optional()
      .describe('The UV rotation in radians around center (default 0).'),
    /** The rotation's centre in UV space, `[x, y]` (three's default `[0, 0]`; `[0.5, 0.5]` is the
     * middle). */
    center: Vec2TupleSchema.optional().describe(
      'The rotation centre in UV space, [x, y] (default [0, 0]; [0.5, 0.5] is the middle).'
    ),
    /** Flips the image vertically on upload (three's default true; a glTF's textures load with
     * false). A KTX2 output of the asset pipeline and an image the assets worker decodes have it
     * baked in. */
    flipY: z
      .boolean()
      .optional()
      .describe(
        "Flips the image vertically (default true; a glTF's textures false). Baked into a KTX2 output and an image the assets worker decodes."
      ),
    /** Generates the mip chain on upload (three's default true). A KTX2 output has its own. */
    generateMipmaps: z
      .boolean()
      .optional()
      .describe('Generates the mip chain on upload (default true). A KTX2 output has its own.'),
    /** Premultiplies the colour by the alpha on upload (three's default false). Not for a KTX2
     * output. */
    premultiplyAlpha: z
      .boolean()
      .optional()
      .describe('Premultiplies the colour by the alpha on upload (default false). Not for KTX2.'),
    /** `srgb` for a colour map, `srgb-linear` or `''` for data; decides how the pipeline reads
     * the source too. */
    colorSpace: ColorSpaceSchema.optional(),
  })
  .describe(
    "The sampler state, UV transform and upload settings over the loader's, and the colour space."
  );

/**
 * `TexOptsSchema` for a texture whose KTX2 output is always stored flipped (a texture array, an
 * atlas slot): `flipY: false` can't apply to it, so it's refused.
 * @internal
 */
export const StoredFlippedTexOptsSchema = TexOptsSchema.refine(
  (texOpts) => texOpts.flipY !== false,
  {
    message:
      "flipY false isn't supported here: a texture array or atlas slot is stored flipped (its KTX2 output can't be flipped at load)",
    path: ['flipY'],
  }
);

// A texture's fields a save entry also takes
const TEXTURE_FIELDS = {
  /** The registry id, which scenes and materials name the texture by. Default: the file's name. */
  id: z
    .string()
    .optional()
    .describe("The registry id scenes and materials name it by. Default: the file's name."),
  /** The source image: relative to this JSON (optimized by the asset pipeline) or a `src/public`
   * URL path. */
  fileName: AssetFileNameSchema.optional(),
  /** A URL prefix of a `src/public` file name (a cube texture's folder); not with a `./` one. */
  path: z
    .string()
    .optional()
    .describe('A URL prefix of a src/public fileName (a cube texture\'s folder); not with "./".'),
  /** Loads an `.hdr` file as HDR data (a HalfFloat `DataTexture`). */
  useHDRLoader: z
    .boolean()
    .optional()
    .describe('Loads an .hdr file as HDR data (a HalfFloat DataTexture).'),
  /** Its sampler state, UV transform, upload settings and colour space, over the loader's. */
  texOpts: TexOptsSchema.optional(),
  /** Fails the load when the file can't load. Default: logs and uses an empty stand-in. */
  throwOnError: z
    .boolean()
    .optional()
    .describe("Fails the load when the file can't load. Default: logs and uses an empty stand-in."),
  /** Never released by its scene: only `deleteTexture` removes it. Default false. */
  isPersistent: z
    .boolean()
    .optional()
    .describe('Never released by its scene: only deleteTexture removes it. Default false.'),
  /** The texture's `userData` (the engine adds `id`). */
  userData: UserDataSchema.optional(),
  /** What the debug tools show for the texture. */
  debugData: DebugDataSchema.optional(),
};

const TextureOverridesSchema = z.object({
  /** When the entry was saved, and the versions then. */
  __meta: MetaSchema.optional(),
  ...TEXTURE_FIELDS,
});

/**
 * A texture JSON (`*.texture.json`): the runtime's `TextureProps` for `loadTextureAsync`, its
 * build-time `optimize` and `pack`, its per-scene save entries, and the fields the gatherer bakes
 * in from the asset pipeline's run.
 */
export const TextureAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  ...TEXTURE_FIELDS,
  /** Build time only: the asset pipeline's settings (not per scene, never read by the runtime). */
  optimize: TextureOptimizeSchema.optional(),
  /** Build time only: the texture packed from source images, in place of `fileName`. */
  pack: TexturePackSchema.optional(),
  /** Per scene id, its save entries over the texture (the first applies). */
  __saveData: createSaveDataSchema(TextureOverridesSchema),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Set by the gatherer: bytes on disk (all six faces for a cube texture). */
  __fileSize: z
    .number()
    .optional()
    .describe('Set by the gatherer: bytes on disk (all six faces for a cube texture).'),
  ...GeneratedAssetFieldsSchema.omit({ __lodChain: true }).shape,
});

/** A texture JSON (`*.texture.json`), as {@link TextureAssetSchema} validates it. */
export type TextureAsset = z.infer<typeof TextureAssetSchema>;

/**
 * A texture declared inline in a scene JSON: the asset pipeline only reads `*.texture.json`s. A
 * scene's inline `textures` (`createSceneAssetSchema`).
 * @internal
 */
export const InlineTextureSchema = TextureAssetSchema.omit({
  optimize: true,
  pack: true,
  __url: true,
  __sourceUrl: true,
  __bytes: true,
  __vramBytes: true,
  __codec: true,
}).extend({
  fileName: PublicFileNameSchema.optional(),
});
