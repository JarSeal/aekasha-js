import { z } from 'zod';
import { createSaveDataSchema, MetaSchema } from './_SaveDataSchema';
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
  $schema: z.string().optional(),
  __meta: MetaSchema.optional(),

  isDebugScene: z.boolean().optional(),

  // Optional Metadata (Stripped during production bundling)
  name: z.string().optional(),
  description: z.string().optional(),
  comments: DebugDataSchema.shape.comments,
  todo: DebugDataSchema.shape.todo,

  backgroundColor: ColorJSONSchema.optional(),
  /** The id of a texture the scene lists in `textures`, for the root scene's background */
  backgroundTexture: z.string().optional(),

  // Scene Asset Registries Map arrays
  cameras: z.array(z.union([z.string(), CameraAssetSchema])).optional(),
  lights: z.array(z.union([z.string(), LightAssetSchema])).optional(),
  geometries: z.array(z.union([z.string(), GeoPropsSchema])).optional(),
  textures: z.array(z.union([z.string(), InlineTextureSchema])).optional(),
  materials: z.array(z.union([z.string(), MaterialAssetSchema])).optional(),
  meshes: z.array(z.union([z.string(), InlineMeshSchema])).optional(),
  importedAssets: z.array(z.union([z.string(), InlineImportedAssetSchema])).optional(),
});

/**
 * The scene schema (`*.scene.json`) with the features' fields (p607 D10): the kernel's fields,
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
    id: z.string({
      error: "Scene 'id' is required for index parsing.",
    }),
    sceneFile: z.string({
      error: "Property 'sceneFile' is required to route your stage execution script.",
    }),
    __sourcePath: z.string().optional(),
    __saveData: createSaveDataSchema(SceneOverridesSchema),
  });
};

/** A scene JSON's kernel fields (the features' are typed by `createSceneAssetSchema` with their
 * parts). */
export type SceneAsset = z.infer<ReturnType<typeof createSceneAssetSchema<[]>>>;
