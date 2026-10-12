import { z } from 'zod';
import { createSaveDataSchema, MetaSchema } from './_saveDataSchema';
import { CameraAssetSchema } from './cameraSchema';
import { LightAssetSchema } from './lightSchema';
import { GeoPropsSchema } from './geometrySchema';
import { InlineTextureOverridesSchema, InlineTextureSchema } from './textureSchema';
import { MaterialAssetSchema } from './materialSchema';
import { ColorJSONSchema } from './_helperSchemas';
import {
  type FeatureSchemaPart,
  type FeatureSchemaShape,
  mergeFeatureSchemaShapes,
} from './featureSchemas';

const AssetReferenceOrInline = z.union([z.string(), z.record(z.string(), z.unknown())]);

// The kernel's scene fields; the features' follow them (createSceneAssetSchema)
const KERNEL_SCENE_SHAPE = {
  $schema: z.string().optional(),
  __meta: MetaSchema.optional(),

  isDebugScene: z.boolean().optional(),

  // Optional Metadata (Stripped during production bundling)
  name: z.string().optional(),
  description: z.string().optional(),
  comments: z.any().optional(),
  todo: z.any().optional(),

  backgroundColor: ColorJSONSchema.optional(),
  backgroundTexture: z.union([InlineTextureOverridesSchema, z.string()]).optional(),

  // Scene Asset Registries Map arrays
  cameras: z.array(z.union([z.string(), CameraAssetSchema])).optional(),
  lights: z.array(z.union([z.string(), LightAssetSchema])).optional(),
  geometries: z.array(z.union([z.string(), GeoPropsSchema])).optional(),
  textures: z.array(z.union([z.string(), InlineTextureSchema])).optional(),
  materials: z.array(z.union([z.string(), MaterialAssetSchema])).optional(),
  meshes: z.array(AssetReferenceOrInline).optional(),
  importedAssets: z.array(AssetReferenceOrInline).optional(),
};

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
  const SceneOverridesSchema = z.object(
    mergeFeatureSchemaShapes(KERNEL_SCENE_SHAPE, parts, 'scene') as typeof KERNEL_SCENE_SHAPE &
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
