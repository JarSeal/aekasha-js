import { z } from 'zod';
import { DebugDataSchema, UserDataSchema } from './_HelperSchemas';
import { JsonSchemaRefSchema, SourcePathSchema } from './_SaveDataSchema';
import {
  GeneratedAssetFieldsSchema,
  isJsonRelativeFileName,
  TextureArrayOptimizeSchema,
} from './AssetsConfigSchema';
import { TexOptsSchema } from './TextureSchema';

/** Whether a texture array's layer names a source file (`./`, `../` or a `src/public` URL path),
 * not a texture asset's id. */
export const isTextureArrayLayerFile = (layer: string) =>
  isJsonRelativeFileName(layer) || layer.startsWith('/');

/**
 * A texture array JSON (`*.textureArray.json`), built by the asset pipeline: its layers resized to
 * one size and encoded as one KTX2 array. The runtime loads it like any texture
 * (`loadTextureAsync` returns a `CompressedArrayTexture`); a scene lists it in its `textures`.
 */
export const TextureArrayAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** The registry id, which scenes and materials name the array by. Default: the file's name. */
  id: z
    .string()
    .optional()
    .describe("The registry id scenes and materials name it by. Default: the file's name."),
  /** The layers in layer index order: texture asset ids or source images. */
  layers: z
    .array(
      z
        .string()
        .min(1)
        .describe(
          'A texture asset\'s id (its source file or pack, not its output), or a source image relative to this JSON ("./source/moss.png") or served from src/public ("/textures/moss.png").'
        )
    )
    .min(1)
    .describe('The layers, in layer index order.'),
  /** The width and height every layer is resized to. Default: the layers' own (which must
   * agree). */
  size: z
    .tuple([z.number().int().min(1), z.number().int().min(1)])
    .optional()
    .describe(
      "Width and height every layer is resized to (default: the layers' size, which must then agree). The optimize step fits it into its maxSize."
    ),
  /** The array's sampler state and colour space (`colorSpace` decides how the layers are read). */
  texOpts: TexOptsSchema.optional(),
  /** Build time only: the asset pipeline's settings, for every layer. */
  optimize: TextureArrayOptimizeSchema.optional(),
  /** Fails the load when the file can't load. Default: logs and uses an empty stand-in. */
  throwOnError: z
    .boolean()
    .optional()
    .describe("Fails the load when the file can't load. Default: logs and uses an empty stand-in."),
  /** The texture's `userData` (the engine adds `id`). */
  userData: UserDataSchema.optional(),
  /** What the debug tools show for the array. */
  debugData: DebugDataSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Set by the gatherer: each layer's name (a texture's id, a file's name without its
   * extension), by layer index. */
  __layers: z
    .array(z.string())
    .optional()
    .describe("Set by the gatherer: each layer's name, by layer index."),
  ...GeneratedAssetFieldsSchema.omit({ __lodChain: true, __sourceUrl: true }).shape,
});

/** A texture array JSON (`*.textureArray.json`), as {@link TextureArrayAssetSchema} validates it. */
export type TextureArrayAsset = z.infer<typeof TextureArrayAssetSchema>;
