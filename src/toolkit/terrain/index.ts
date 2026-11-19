export { hash12, hash22 } from './nodes/noise/Hash';
export type { HashOptions, NoiseSeed } from './nodes/noise/Hash';
export { heightToCavity, heightToNormal } from './nodes/noise/HeightMaps';
export type {
  HeightFunction,
  HeightToCavityOptions,
  HeightToNormalOptions,
} from './nodes/noise/HeightMaps';
export { domainWarp, fbm, gradientNoise, valueNoise } from './nodes/noise/Noise';
export type { DomainWarpOptions, FbmOptions, NoiseOptions } from './nodes/noise/Noise';
export type { NoisePeriod } from './nodes/noise/Period';
export { worley } from './nodes/noise/Worley';
export type { WorleyOptions, WorleySample } from './nodes/noise/Worley';
export { bakeSurfaceGenerator } from './procedural/BakeSurface';
export { generator as cliffStrata } from './procedural/cliffStrata/cliffStrata.generator';
export { generator as concretePores } from './procedural/concretePores/concretePores.generator';
export { generator as grassGround } from './procedural/grassGround/grassGround.generator';
export { generator as iceSheet } from './procedural/iceSheet/iceSheet.generator';
export { generator as mudCracked } from './procedural/mudCracked/mudCracked.generator';
export { generator as mudSmooth } from './procedural/mudSmooth/mudSmooth.generator';
export { generator as rockyGround } from './procedural/rockyGround/rockyGround.generator';
export { generator as sandFlat } from './procedural/sandFlat/sandFlat.generator';
export { generator as sandRipples } from './procedural/sandRipples/sandRipples.generator';
export { generator as snowDrift } from './procedural/snowDrift/snowDrift.generator';
export type { BakedSurface, BakeSurfaceGeneratorOpts } from './procedural/BakeSurface';
export { createLiveSurface } from './procedural/LiveSurface';
export type { LiveSurface, LiveSurfaceOpts } from './procedural/LiveSurface';
export {
  doesPackingStoreNormal,
  getSurfacePackingOutputs,
  packSurfaceOutputs,
} from './procedural/PackSurface';
export type { PackableSurface } from './procedural/PackSurface';
export { defineSurfaceGenerator } from './procedural/SurfaceGenerator';
export type {
  SurfaceBuildContext,
  SurfaceCellCount,
  SurfaceCells,
  SurfaceGenerator,
  SurfaceGeneratorDef,
  SurfaceOutputs,
} from './procedural/SurfaceGenerator';
export type {
  SurfaceChoiceParam,
  SurfaceColorParam,
  SurfaceNumberParam,
  SurfaceParamNode,
  SurfaceParamNodes,
  SurfaceParamSpec,
  SurfaceParamSpecs,
  SurfaceParamValues,
  SurfaceToggleParam,
} from './procedural/SurfaceParams';
export { registerTerrainGenerators } from './blocks/RegisterTerrainGenerators';
export { registerTerrainScatter } from './scatter/RegisterTerrainScatter';
export { bakeMacroNoise } from './textures/MacroNoise';
export type { BakeMacroNoiseOpts } from './textures/MacroNoise';
export { bakeRippleAtlas, decodeRippleAtlas } from './textures/RippleAtlas';
export { readTextureTexelsAsync } from './textures/ReadTexels';
export type {
  BakeRippleAtlasOpts,
  DecodeRippleAtlasOpts,
  RippleRings,
} from './textures/RippleAtlas';
export {
  bumpNormalView,
  sampleTextureSet,
  transformTangentNormalToView,
} from './nodes/SampleTextureSet';
export type { SampleTextureSetOptions, TextureSetSample } from './nodes/SampleTextureSet';
export {
  createTerrainMaterial,
  getTerrainMaterialProps,
  getTerrainMaterialVariant,
  setupTerrainMaterial,
  TERRAIN_TSL_MATERIAL_ID,
} from './material/TerrainMaterial';
export type { TerrainQualityLevel } from './material/TerrainMaterial';
export { bakeTerrainColorMap } from './material/TerrainColorMapBake';
export type { BakeTerrainColorMapOpts } from './material/TerrainColorMapBake';
export { createStructureMaterial, getStructureMaterialConfig } from './material/StructureMaterial';
export type { StructureMaterialOpts } from './material/StructureMaterial';
export { bakeDecalGenerator } from './decals/BakeDecal';
export type { BakeDecalGeneratorOpts, BakedDecal } from './decals/BakeDecal';
export { defineDecalGenerator } from './decals/DecalGenerator';
export type {
  DecalBuildContext,
  DecalGenerator,
  DecalGeneratorDef,
  DecalOutputs,
} from './decals/DecalGenerator';
export { setupDecalMaterial } from './decals/DecalMaterial';
export { decalCracks } from './decals/generators/DecalCracks';
export { decalFootprint } from './decals/generators/DecalFootprint';
export { decalFormwork } from './decals/generators/DecalFormwork';
export { decalIceCrack } from './decals/generators/DecalIceCrack';
export { decalLeafPatch } from './decals/generators/DecalLeafPatch';
export { decalMudSplatter } from './decals/generators/DecalMudSplatter';
export { decalScorch } from './decals/generators/DecalScorch';
export { decalStain } from './decals/generators/DecalStain';
export { decalWetPatch } from './decals/generators/DecalWetPatch';
export type { DecalMaterialInputs } from './decals/DecalMaterial';
export { createDecalTrail, spawnRibbonDecal } from './decals/DecalRibbons';
export type { CreateDecalTrailOpts, DecalTrail, SpawnRibbonDecalOpts } from './decals/DecalRibbons';
export { spawnMeshDecalAsync } from './decals/MeshDecals';
export type { SpawnMeshDecalOpts } from './decals/MeshDecals';
export { createDecalPool, spawnDecal } from './decals/RuntimeDecals';
export type { CreateDecalPoolOpts, DecalPool, SpawnDecalOpts } from './decals/RuntimeDecals';
export { setupRockMaterial } from './material/RockMaterial';
export type { RockMaterialInputs } from './material/RockMaterial';
export { getTerrainQualityPreset } from './material/TerrainQualityPreset';
export type { TerrainQualityPresetOpts } from './material/TerrainQualityPreset';
export { loadTerrainDebugViewsAsync } from './material/TerrainDebugViews';
export { applySurfaceWetness } from './nodes/Wet';
export type {
  ApplySurfaceWetnessOpts,
  SurfacePuddleOpts,
  SurfaceRippleOpts,
  SurfaceFrostOpts,
  SurfaceShorelineOpts,
  SurfaceSnowOpts,
  SurfaceSparkleOpts,
  SurfaceStreakOpts,
  SurfaceWetnessMasks,
  SurfaceWetResponse,
  WetSurface,
  WetSurfaceInput,
} from './nodes/Wet';
export {
  TerrainAntiTilingSchema,
  TerrainBlendSchema,
  TerrainColorMapSchema,
  TerrainColorMapSettingsSchema,
  TerrainLayerSchema,
  TerrainLayerSettingsSchema,
  TerrainLiveSchema,
  TerrainMacroSchema,
  TerrainMacroSettingsSchema,
  TerrainMaterialConfigSchema,
  TerrainMaterialDefineSchema,
  TerrainProjectionSchema,
  TerrainQualityOverridesSchema,
} from './material/TerrainMaterialConfig';
export type {
  TerrainAntiTiling,
  TerrainBlend,
  TerrainColorMap,
  TerrainColorMapSettings,
  TerrainLayer,
  TerrainLayerSettings,
  TerrainLive,
  TerrainMacro,
  TerrainMacroSettings,
  TerrainMaterialConfig,
  TerrainMaterialDefine,
  TerrainProjection,
  TerrainQualityOverrides,
} from './material/TerrainMaterialConfig';
