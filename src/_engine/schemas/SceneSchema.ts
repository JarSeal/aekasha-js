import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { CameraAssetSchema } from './CameraSchema';
import { LightAssetSchema } from './LightSchema';
import { GeoPropsSchema } from './GeometrySchema';
import { InlineTextureSchema } from './TextureSchema';
import { MaterialAssetSchema } from './MaterialSchema';
import { createMeshAssetSchema } from './MeshSchema';
import { InlineImportedAssetSchema } from './ImportedAssetSchema';
import { ColorJSONSchema, DebugDataSchema } from './_HelperSchemas';
import {
  type FeatureSchemaPart,
  type FeatureSchemaShape,
  mergeFeatureSchemaShapes,
} from './FeatureSchemas';

// The kernel's scene fields, with the inline mesh composed from the scene's parts; the features'
// fields follow them (createSceneAssetSchema)
const createKernelSceneShape = <M extends z.ZodType>(InlineMeshSchema: M) => ({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** A save entry's: when it was saved, and the versions then. */
  __meta: MetaSchema.optional(),
  /** A scene only the debug env lists (its loaders aren't in a production build). */
  isDebugScene: z
    .boolean()
    .optional()
    .describe('A scene only the debug env lists; a production build leaves it out.'),
  /** The name the debugger and the scene loader show. */
  name: z.string().optional().describe('The name the debugger and the scene loader show.'),
  /** A description for the debugger. */
  description: z.string().optional().describe('A description for the debugger.'),
  /** Notes for whoever edits the JSON (the gatherer drops them). */
  comments: DebugDataSchema.shape.comments,
  /** Open items for whoever edits the JSON (the gatherer drops them). */
  todo: DebugDataSchema.shape.todo,
  /** The root scene's background colour while the scene is current. */
  backgroundColor: ColorJSONSchema.optional(),
  /** The id of a texture the scene lists in `textures`, for the root scene's background (over
   * `backgroundColor`). */
  backgroundTexture: z
    .string()
    .optional()
    .describe('The id of a texture the scene lists, for the background (over backgroundColor).'),
  /** The cameras the loader creates before the assets: camera JSON ids, or inline cameras. A
   * scene without one gets a perspective camera. */
  cameras: z
    .array(z.union([z.string(), CameraAssetSchema]))
    .optional()
    .describe('Camera ids, or inline cameras. Without one, the scene gets a perspective camera.'),
  /** The lights the loader creates after the scene code: light JSON ids, or inline lights. */
  lights: z
    .array(z.union([z.string(), LightAssetSchema]))
    .optional()
    .describe('Light ids, or inline lights, created after the scene code.'),
  /** The geometries the loader registers: geometry JSON ids, or inline props. */
  geometries: z
    .array(z.union([z.string(), GeoPropsSchema]))
    .optional()
    .describe('Geometry ids, or inline geometry props, registered with the assets.'),
  /** The textures the loader loads: texture, array or atlas ids (an atlas id for every slot), or
   * inline textures of `src/public` files. */
  textures: z
    .array(z.union([z.string(), InlineTextureSchema]))
    .optional()
    .describe('Texture, texture array or atlas ids, or inline textures of src/public files.'),
  /** The materials the loader creates, after the textures they name: material ids, or inline. */
  materials: z
    .array(z.union([z.string(), MaterialAssetSchema]))
    .optional()
    .describe('Material ids, or inline materials, created after the textures.'),
  /** The meshes the loader creates after the scene code: mesh JSON ids, or inline meshes. */
  meshes: z
    .array(z.union([z.string(), InlineMeshSchema]))
    .optional()
    .describe('Mesh ids, or inline meshes ({ props, entityOpts }), created after the scene code.'),
  /** The glTF imports the loader runs with the assets: import ids, or inline imports of
   * `src/public` files. */
  importedAssets: z
    .array(z.union([z.string(), InlineImportedAssetSchema]))
    .optional()
    .describe('Imported asset ids, or inline imports of src/public files.'),
});

/**
 * The scene schema (`*.scene.json`) with the features' fields: the kernel's fields,
 * then each part's `scene` fields in part order (the JSON Schema's property order), all of them
 * allowed in the scene's save entries too. The gatherer composes it with every engine feature's
 * part. Throws on a field two parts give.
 * @example
 * ```ts
 * import { createSceneAssetSchema, lodSchemaPart, skyBoxSchemaPart } from 'aekasha/schemas';
 *
 * const SceneSchema = createSceneAssetSchema([skyBoxSchemaPart, lodSchemaPart]);
 * const isValid = SceneSchema.safeParse({ id: 'myScene', sceneFile: 'myScene.ts' }).success;
 * ```
 */
export const createSceneAssetSchema = <const P extends readonly FeatureSchemaPart[]>(parts: P) => {
  // An inline mesh is a mesh JSON's props and entity options, with the same parts' mesh fields
  const kernelShape = createKernelSceneShape(
    createMeshAssetSchema(parts).pick({ props: true, entityOpts: true })
  );
  const SceneOverridesSchema = z.object(
    mergeFeatureSchemaShapes(kernelShape, parts, 'scene') as typeof kernelShape &
      FeatureSchemaShape<P, 'scene'>
  );
  return SceneOverridesSchema.omit({ __meta: true }).extend({
    /** The scene id: it keys the scene's save data, its LS state and `?startScene=`. */
    id: z
      .string({ error: "A scene needs an 'id'." })
      .describe("The scene id: it keys the scene's save data, its saved state and ?startScene=."),
    /** The scene's code module, relative to `src/app/`. */
    sceneFile: z
      .string({ error: "A scene needs a 'sceneFile': its code module, relative to src/app/." })
      .describe("The scene's code module, relative to src/app/."),
    /** Set by the gatherer: the file it came from. */
    __sourcePath: SourcePathSchema.optional(),
    /** Per scene id (its own), its save entries over the scene's fields (the first applies). */
    __saveData: createSaveDataSchema(SceneOverridesSchema),
  });
};

/** A scene JSON's kernel fields (the features' are typed by `createSceneAssetSchema` with their
 * parts). */
export type SceneAsset = z.infer<ReturnType<typeof createSceneAssetSchema<[]>>>;
