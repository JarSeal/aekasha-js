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
export type { ImportedAsset, ImportedAssetMerge } from './ImportedAssetSchema';
export { ImpostorAssetSchema } from '../features/lod/impostors/ImpostorSchema';
export type { ImpostorAsset, ImpostorDef } from '../features/lod/impostors/ImpostorSchema';
export { LightAssetSchema } from './LightSchema';
export { lodSchemaPart } from '../features/lod/LodSchema';
export type { LightAsset } from './LightSchema';
export {
  AtlasCellInputSchema,
  MaterialAssetSchema,
  TextureArrayInputSchema,
  TextureInputRefSchema,
} from './MaterialSchema';
export {
  getMergeMaterialSlotTextureId,
  MAX_MERGE_MATERIAL_ENTRIES,
  MERGE_MATERIAL_SLOTS,
  MergeMaterialAssetSchema,
  ORM_SOURCE_MAP_KEYS,
} from '../features/merging/MergeMaterialSchema';
export type {
  MergeMaterialAsset,
  MergeMaterialEntry,
  MergeMaterialSlot,
  MergeMaterialSlotDef,
  MergeMaterialSlotInfo,
  MergeMaterialSlotTexture,
  SceneMergeMaterial,
} from '../features/merging/MergeMaterialSchema';
export { mergingSchemaPart } from '../features/merging/MergingSchema';
export type { MaterialAsset, PerType } from './MaterialSchema';
export { createMeshAssetSchema } from './MeshSchema';
export type { MeshAsset } from './MeshSchema';
export { PostFxAssetSchema } from './PostFxSchema';
export type { PostFxAsset, PostFxParamMeta } from './PostFxSchema';
export { physicsSchemaPart, SceneWorldBoundsSchema } from '../features/physics/PhysicsSchema';
export type { SceneWorldBounds } from '../features/physics/PhysicsSchema';
export { postFxSchemaPart } from '../features/postfx/PostFXSchema';
export { createSceneAssetSchema } from './SceneSchema';
export type { SceneAsset } from './SceneSchema';
export { spatialSchemaPart } from '../features/spatial/SpatialSchema';
export {
  instancingSchemaPart,
  SCATTER_COLLIDER_TYPES,
  SCATTER_DEFAULTS,
  SCATTER_SOURCE_TYPES,
  ScatterAssetSchema,
} from '../features/instancing/ScatterSchema';
export { SCATTER_COLLIDER_WARNING } from '../features/instancing/ScatterLimits';
export type {
  ScatterAsset,
  ScatterColliderType,
  ScatterDef,
  ScatterItemDef,
  ScatterPlacementDef,
  ScatterSourceDef,
} from '../features/instancing/ScatterSchema';
export {
  TERRAIN_BLOCK_COLLIDER_TYPES,
  TERRAIN_BLOCK_DEFAULTS,
  TerrainBlockAssetSchema,
  terrainSchemaPart,
} from '../features/terrain/TerrainBlockSchema';
export { DECAL_SET_DEFAULTS, DecalSetAssetSchema } from '../features/terrain/DecalSetSchema';
export type { DecalSetAsset, DecalSetDef } from '../features/terrain/DecalSetSchema';
export {
  SceneSurfaceConditionsSchema,
  surfaceConditionsSchemaPart,
} from '../features/surface/SurfaceConditionsSchema';
export type { SceneSurfaceConditions } from '../features/surface/SurfaceConditionsSchema';
export type {
  TerrainBlockAsset,
  TerrainBlockColliderType,
  TerrainBlockDef,
  TerrainBlockGeometry,
} from '../features/terrain/TerrainBlockSchema';
export {
  SceneStreamingSchema,
  StreamingRingsSchema,
  streamingSchemaPart,
} from '../features/streaming/StreamingSchema';
export type {
  StreamingFarInstance,
  StreamingFarMesh,
  StreamingManifest,
  StreamingManifestCell,
  StreamingManifestLayer,
} from '../features/streaming/StreamingManifest';
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
export {
  isTextureSetColorSlot,
  TEXTURE_SET_CATEGORIES,
  TEXTURE_SET_PACKING_PREFERENCE,
  TEXTURE_SET_PACKINGS,
  TEXTURE_SET_PROCEDURAL_DEFAULTS,
  TEXTURE_SET_SURFACE_DEFAULTS,
  TEXTURE_SET_WET_RESPONSES,
  SceneTextureSetArraySchema,
  TextureSetArrayInputSchema,
  TextureSetAssetSchema,
  TextureSetInputSchema,
} from './TextureSetSchema';
export { textureSetsSchemaPart } from '../features/texturesets/TextureSetsSchema';
export type {
  SceneTextureSetArrayEntry,
  TextureSetAsset,
  TextureSetCategory,
  TextureSetDef,
  TextureSetPacking,
  TextureSetProcedural,
  TextureSetProceduralDef,
  TextureSetSlot,
  TextureSetSurface,
  TextureSetWetResponse,
} from './TextureSetSchema';
export { TextureAssetSchema } from './TextureSchema';
export type { TextureAsset } from './TextureSchema';
export type { SceneSpatialDomainEntry } from './SpatialDomainSchema';
