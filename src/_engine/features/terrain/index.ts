export { getDecalSet, spawnDecalSet } from './DecalSets';
export type { DecalSet, SpawnDecalSetOpts } from './DecalSets';
export { getTerrainBlock, spawnTerrainBlock } from './TerrainBlocks';
export type { SpawnTerrainBlockOpts, TerrainBlock } from './TerrainBlocks';
export {
  getTerrainGenerator,
  registerTerrainGenerator,
  unregisterTerrainGenerator,
} from './TerrainGenerators';
export type {
  TerrainGenerator,
  TerrainGeneratorOpts,
  TerrainGeneratorResult,
} from './TerrainGenerators';
export type { DecalSetDef } from './DecalSetSchema';
export type {
  TerrainBlockColliderType,
  TerrainBlockDef,
  TerrainBlockGeometry,
} from './TerrainBlockSchema';
export { terrain } from './TerrainFeature';
