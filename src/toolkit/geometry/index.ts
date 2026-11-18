export { generateAsteroid } from './generate/Asteroid';
export type {
  AsteroidCraterOptions,
  AsteroidNoiseOptions,
  AsteroidOptions,
  GeneratedAsteroid,
} from './generate/Asteroid';
export { generateBushGeometry, generateTreeGeometry } from './generate/Foliage';
export type {
  BushGeometryOptions,
  GeneratedTreeGeometry,
  TreeGeometryOptions,
} from './generate/Foliage';
export { generateLeafCard, LEAF_CARD_GEOMETRY_ID, saveLeafCardGeometry } from './generate/LeafCard';
export type { LeafCardOptions } from './generate/LeafCard';
export { generateRock, ROCK_TRIANGLE_BUDGETS, saveRockGeometries } from './generate/Rock';
export type { GeneratedRock, RockKind, RockOptions } from './generate/Rock';
export { generateTerrain } from './generate/terrain/Terrain';
export { generateTerrainAsync } from './generate/terrain/TerrainAsync';
export type { TerrainAsyncOptions } from './generate/terrain/TerrainAsync';
export type {
  GeneratedTerrain,
  TerrainNoiseOctave,
  TerrainNormalSource,
  TerrainOptions,
  TerrainVertexColorOptions,
} from './generate/terrain/Terrain';
export type { TerrainAoOptions } from './generate/terrain/TerrainAo';
export { loadTerrainHeightmapAsync } from './generate/terrain/TerrainHeightmap';
export type {
  TerrainHeightmap,
  TerrainHeightmapFormat,
  TerrainHeightmapOptions,
} from './generate/terrain/TerrainHeightmap';
export {
  evaluateTerrainRulesCPU,
  getTerrainRuleCoverageCPU,
  TERRAIN_RULE_DEFAULTS,
  TERRAIN_RULE_NOISE_CHANNELS,
} from './generate/terrain/TerrainRules';
export type {
  TerrainRule,
  TerrainRuleAspect,
  TerrainRuleNoise,
  TerrainRuleNoiseTexels,
  TerrainRulePoint,
  TerrainRuleRange,
} from './generate/terrain/TerrainRules';
export {
  bakeScatterToInstancedMesh,
  scatterOnSurface,
  spawnScatterAsMeshEntities,
} from './scatter/ScatterOnSurface';
export type {
  ScatterOptions,
  ScatterPlacement,
  SpawnScatterMeshOptions,
} from './scatter/ScatterOnSurface';
