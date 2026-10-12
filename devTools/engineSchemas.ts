/**
 * The gathered scene and mesh schemas with every engine feature's fields (p607 D10): the gatherer
 * validates any app's data, whichever features its `InitEngine` lists (the scene manifest and
 * `InitEngine`'s check catch a scene that needs one it doesn't).
 */
import type { z } from 'zod';
import {
  type FeatureSchemaPart,
  createMeshAssetSchema,
  createSceneAssetSchema,
  lodSchemaPart,
  postFxSchemaPart,
  skyBoxSchemaPart,
  spatialSchemaPart,
} from '../src/_engine/schemas';

/** Every engine feature's schema part. The order is the JSON Schemas' property order in
 * `.schemas/` (the fields' order before p607), not the install order. */
export const ENGINE_SCHEMA_PARTS = [
  skyBoxSchemaPart,
  postFxSchemaPart,
  spatialSchemaPart,
  lodSchemaPart,
] as const;

export const SceneAssetSchema = createSceneAssetSchema(ENGINE_SCHEMA_PARTS);
export type SceneAsset = z.infer<typeof SceneAssetSchema>;

export const MeshAssetSchema = createMeshAssetSchema(ENGINE_SCHEMA_PARTS);
export type MeshAsset = z.infer<typeof MeshAssetSchema>;

/** Whether a field counts as used: given, and not an empty list */
const isFieldUsed = (value: unknown) =>
  value !== undefined && value !== null && !(Array.isArray(value) && !value.length);

/**
 * The scene manifest (p607 D10): the features a gathered scene's data needs, in part order. A
 * part's feature is needed when the scene uses one of its `scene` fields, or one of the scene's
 * meshes (resolved: `{ props }`) one of its `mesh` fields. `InitEngine` checks the ids against
 * its `features`.
 */
export const getSceneFeatureIds = (
  scene: Record<string, unknown>,
  parts: readonly FeatureSchemaPart[] = ENGINE_SCHEMA_PARTS
): string[] => {
  const meshProps = (Array.isArray(scene.meshes) ? scene.meshes : [])
    .map((mesh: unknown) =>
      mesh && typeof mesh === 'object' && 'props' in mesh ? mesh.props : undefined
    )
    .filter((props): props is Record<string, unknown> => !!props && typeof props === 'object');
  return parts
    .filter(
      (part) =>
        Object.keys(part.scene ?? {}).some((field) => isFieldUsed(scene[field])) ||
        Object.keys(part.mesh ?? {}).some((field) =>
          meshProps.some((props) => isFieldUsed(props[field]))
        )
    )
    .map((part) => part.feature);
};
