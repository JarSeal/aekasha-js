import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { DebugDataSchema } from './_HelperSchemas';
import { TexOptsSchema } from './TextureSchema';
import { LodChainSchema } from './LodChainSchema';
import {
  AssetFileNameSchema,
  GeneratedAssetFieldsSchema,
  ImportedAssetOptimizeSchema,
  PublicFileNameSchema,
} from './AssetsConfigSchema';

// An import's fields a save entry also takes
const ImportedAssetOverridesSchema = z.object({
  /** When the entry was saved, and the versions then. */
  __meta: MetaSchema.optional(),
  /** The import id, also the prefix of its geometry and texture ids (`<id>/<nodeName>`). Default:
   * the file's name. */
  id: z
    .string()
    .optional()
    .describe(
      "The import id, also its geometries' and textures' id prefix. Default: the file's name."
    ),
  /** The .glb or .gltf: relative to this JSON (optimized by the asset pipeline) or a `src/public`
   * URL path. */
  fileName: AssetFileNameSchema.optional(),
  /** Also registers the textures of the glTF material slots (`<id>/<textureName>`), with these
   * `texOpts` and `isPersistent` when an object. Default false (glTF materials are disposed). */
  importTextures: z
    .union([
      z.boolean(),
      z.object({
        /** Over GLTFLoader's settings, for every imported texture. */
        texOpts: TexOptsSchema.optional(),
        /** The textures' own; default: the import's. */
        isPersistent: z.boolean().optional().describe("The textures' own. Default: the import's."),
      }),
    ])
    .optional()
    .describe(
      "Also registers the glTF material slots' textures (<id>/<textureName>); an object sets their texOpts and isPersistent. Default false."
    ),
  /** Only imports one node and its children: a child index of the glTF root, or an index path
   * (`[2, 0]`: the third child's first child). */
  meshIndex: z
    .union([z.number(), z.array(z.number())])
    .optional()
    .describe("Only imports one node: a root child's index, or an index path ([2, 0])."),
  /** Registers the geometries as persistent: kept when their scene and refs release them. */
  isPersistent: z
    .boolean()
    .optional()
    .describe('Registers the geometries as persistent (kept when their scene releases them).'),
  /** Generates a LOD chain for each rendered geometry after the import. */
  lodChain: LodChainSchema.optional(),
  /** Fails the load when the file can't import. Default: logs and resolves nothing. */
  throwOnError: z
    .boolean()
    .optional()
    .describe("Fails the load when the file can't import. Default: logs it."),
  /** What the debug tools show for the import (the Assets tab). */
  debugData: DebugDataSchema.optional(),
});

/**
 * An imported asset JSON (`*.importedAsset.json`): a glTF or GLB the scene imports (the runtime's
 * `ImportAssetParams` for `importAssetAsync`). Only assets are registered, its geometries and the
 * textures it opts into, no entities: a scene's meshes name the geometries by id
 * (`<id>/<nodeName>`).
 */
export const ImportedAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  ...ImportedAssetOverridesSchema.omit({ __meta: true }).shape,
  /** The .glb or .gltf: relative to this JSON or a `src/public` URL path. */
  fileName: AssetFileNameSchema,
  /** Build time only: the asset pipeline's settings (not per scene, never read by the runtime). */
  optimize: ImportedAssetOptimizeSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Set by the gatherer: bytes on disk of the .glb or .gltf (not a .gltf's external buffers). */
  __fileSize: z
    .number()
    .optional()
    .describe("Set by the gatherer: the file's bytes on disk (not a .gltf's external buffers)."),
  ...GeneratedAssetFieldsSchema.omit({ __codec: true }).shape,
  /** Per scene id, its save entries over the import (the first applies). */
  __saveData: createSaveDataSchema(ImportedAssetOverridesSchema),
});

/** An imported asset JSON (`*.importedAsset.json`), as {@link ImportedAssetSchema} validates it. */
export type ImportedAsset = z.infer<typeof ImportedAssetSchema>;

/**
 * An import declared inline in a scene JSON: the asset pipeline only reads `*.importedAsset.json`s.
 * A scene's inline `importedAssets` (`createSceneAssetSchema`).
 * @internal
 */
export const InlineImportedAssetSchema = ImportedAssetSchema.omit({
  optimize: true,
  __url: true,
  __sourceUrl: true,
  __bytes: true,
  __vramBytes: true,
  __lodChain: true,
}).extend({
  fileName: PublicFileNameSchema,
});
