export { generateAsteroid } from './generate/Asteroid';
export type { AsteroidOptions, GeneratedAsteroid } from './generate/Asteroid';
export { generateBushGeometry, generateTreeGeometry } from './generate/Foliage';
export type {
  BushGeometryOptions,
  GeneratedTreeGeometry,
  TreeGeometryOptions,
} from './generate/Foliage';
export { generateTerrain } from './generate/Terrain';
export type { GeneratedTerrain, TerrainOptions } from './generate/Terrain';
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
/** @deprecated Import `createSeededRandom` from `aekasha` (removed in toolkit 3.0.0). */
export { createSeededRandom } from 'aekasha';
