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
export { generateTerrain } from './generate/Terrain';
export type {
  GeneratedTerrain,
  TerrainNoiseOctave,
  TerrainNormalSource,
  TerrainOptions,
  TerrainVertexColorOptions,
} from './generate/Terrain';
export type { TerrainAoOptions } from './generate/TerrainAo';
export {
  evaluateTerrainRulesCPU,
  getTerrainRuleCoverageCPU,
  TERRAIN_RULE_DEFAULTS,
  TERRAIN_RULE_NOISE_CHANNELS,
} from './generate/TerrainRules';
export type {
  TerrainRule,
  TerrainRuleAspect,
  TerrainRuleNoise,
  TerrainRuleNoiseTexels,
  TerrainRulePoint,
  TerrainRuleRange,
} from './generate/TerrainRules';
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
