export type { ColorJSON, CoreEntityOpts, DebugData, ShadowQuality } from './_HelperSchemas';
export { CoreEntityOptsSchema } from './_HelperSchemas';
export { MetaSchema } from './_SaveDataSchema';
export {
  AssetsConfigSchema,
  isJsonRelativeFileName,
  NON_COVERAGE_SLOTS,
  OptimizeObjectSchema,
  PACK_TARGETS,
  TEXTURE_SLOTS,
} from './AssetsConfigSchema';
export type {
  AssetOptimize,
  AssetsConfig,
  GeneratedAssetFields,
  MeshSettings,
  OptimizeLevel,
  TextureCodec,
  TexturePack,
  TextureSettings,
  TextureSlot,
} from './AssetsConfigSchema';
export { CameraAssetSchema, CameraProps } from './CameraSchema';
export type { FeatureSchemaPart, FeatureSchemaShape, UnionToIntersection } from './FeatureSchemas';
export type { CameraAsset } from './CameraSchema';
export { GeoAssetSchema } from './GeometrySchema';
export type { GeoAsset } from './GeometrySchema';
export { ImportedAssetSchema } from './ImportedAssetSchema';
export type { ImportedAsset } from './ImportedAssetSchema';
export { ImpostorAssetSchema } from '../features/lod/impostors/ImpostorSchema';
export type { ImpostorAsset, ImpostorDef } from '../features/lod/impostors/ImpostorSchema';
export { LightAssetSchema } from './LightSchema';
export { lodSchemaPart } from '../features/lod/LodSchema';
export type { LightAsset } from './LightSchema';
export { MaterialAssetSchema } from './MaterialSchema';
export type { MaterialAsset, PerType } from './MaterialSchema';
export { createMeshAssetSchema } from './MeshSchema';
export type { MeshAsset } from './MeshSchema';
export { PostFxAssetSchema } from './PostFxSchema';
export type { PostFxAsset, PostFxParamMeta } from './PostFxSchema';
export { postFxSchemaPart } from '../features/postfx/PostFXSchema';
export { createSceneAssetSchema } from './SceneSchema';
export type { SceneAsset } from './SceneSchema';
export { spatialSchemaPart } from '../features/spatial/SpatialSchema';
export {
  applySkyBoxSaveEntry,
  SkyBoxAssetSchema,
  SkyBoxDefSchema,
  skyBoxSchemaPart,
} from '../features/skybox/SkyBoxSchema';
export type { SkyBoxAsset } from '../features/skybox/SkyBoxSchema';
export { TextureArrayAssetSchema, isTextureArrayLayerFile } from './TextureArraySchema';
export type { TextureArrayAsset } from './TextureArraySchema';
export {
  ATLAS_MIP_CHAINS,
  DEFAULT_ATLAS_PADDING,
  getAtlasSlotTextureId,
  getFullMipLevelCount,
  TextureAtlasAssetSchema,
} from './TextureAtlasSchema';
export type {
  AtlasMipChain,
  TextureAtlasAsset,
  TextureAtlasCellInfo,
  TextureAtlasSlot,
  TextureAtlasSlotInfo,
  TextureAtlasSlotTexture,
} from './TextureAtlasSchema';
export { TextureAssetSchema } from './TextureSchema';
export type { TextureAsset } from './TextureSchema';
export type { SceneSpatialDomainEntry } from './SpatialDomainSchema';
