/**
 * The gathered scene and mesh schemas with every engine feature's fields (p607 D10): the gatherer
 * validates any app's data, whichever features its `InitEngine` lists (the scene manifest and
 * `InitEngine`'s check catch a scene that needs one it doesn't).
 */
import type { z } from 'zod';
import {
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
