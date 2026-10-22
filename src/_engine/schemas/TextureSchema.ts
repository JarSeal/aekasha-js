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
 * A texture's `texOpts` in a JSON: three's sampler constants as numbers, and the colour space. The
 * runtime's `TexOpts` also takes an `image`. The texture, texture array, atlas and import schemas
 * use it.
 * @internal
 */
export const TexOptsSchema = z
  .object({
    /** three's mapping constant (300 UV, 301 cube reflection, 303 equirectangular reflection). */
    mapping: z
      .number()
      .optional()
      .describe("three's mapping: 300 UV, 301 cube reflection, 303 equirectangular reflection."),
    /** three's horizontal wrapping (1000 repeat, 1001 clamp to edge, 1002 mirrored repeat). */
    wrapS: z
      .number()
      .optional()
      .describe("three's horizontal wrapping: 1000 repeat, 1001 clamp to edge, 1002 mirrored."),
    /** three's vertical wrapping, as `wrapS`. */
    wrapT: z
      .number()
      .optional()
      .describe("three's vertical wrapping: 1000 repeat, 1001 clamp to edge, 1002 mirrored."),
    /** three's magnification filter (1003 nearest, 1006 linear). */
    magFilter: z
      .number()
      .optional()
      .describe("three's magnification filter: 1003 nearest, 1006 linear."),
    /** three's minification filter (1003 nearest, 1006 linear, 1008 linear mipmap linear, …). */
    minFilter: z
      .number()
      .optional()
      .describe("three's minification filter: 1003 nearest, 1006 linear, 1008 trilinear."),
    /** three's texel data type (1009 unsigned byte, 1015 float, 1016 half float). */
    type: z
      .number()
      .optional()
      .describe("three's texel type: 1009 unsigned byte, 1015 float, 1016 half float."),
    /** The anisotropic filtering samples (1: off; the device caps it). */
    anisotropy: z
      .number()
      .optional()
      .describe('Anisotropic filtering samples (1: off; the device caps it).'),
    /** `srgb` for a colour map, `srgb-linear` or `''` for data; decides how the pipeline reads
     * the source too. */
    colorSpace: ColorSpaceSchema.optional(),
  })
  .describe("The sampler state over the loader's, and the colour space.");

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
  /** Its sampler state and colour space, over the loader's. */
  texOpts: TexOptsSchema.optional(),
  /** Fails the load when the file can't load. Default: logs and uses an empty stand-in. */
  throwOnError: z
    .boolean()
    .optional()
    .describe("Fails the load when the file can't load. Default: logs and uses an empty stand-in."),
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
