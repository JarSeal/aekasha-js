import type * as THREE from 'three/webgpu';
import type { HeightFieldData } from '../physics/types/PhysicsColliderTypes';
import type { TerrainBlockDef } from './TerrainBlockSchema';
import { assertTerrainInstalled } from './TerrainState';

/** What a terrain generator gets: the block's id, its JSON's `params` and `seed`, and its grid. */
export type TerrainGeneratorOpts = {
  /** The block's id (for messages) */
  blockId: string;
  /** The block's `geometry.params` (`{}` when its JSON gives none): the generator checks them */
  params: Record<string, unknown>;
  /** The block's `geometry.seed` (default 0). A height noise continuous across blocks uses it as it
   * is, sampled at the block's world place (`grid.x` / `grid.z` × `size`); a block's own
   * randomness (scattered props) combines it with `grid.x` / `grid.z` (p301 §7). Never draw from a
   * named stream (`getRandomStream` restarts with each scene load and depends on the draw order). */
  seed: number;
  /** The block's place and grid: the geometry is centred on the block's origin (y = 0 its base),
   * `size` metres wide and deep, with `resolution` vertices per side */
  grid: TerrainBlockDef['grid'];
};

/** What a terrain generator makes: the block's geometry and, for a `HEIGHTFIELD` collider, its
 * params when the generator has the grid at hand. */
export type TerrainGeneratorResult = {
  /** The geometry, in the block's local space (centred, y = 0 its base). `spawnTerrainBlock`
   * registers it, owned by the scene, and it's disposed with its last mesh. */
  geometry: THREE.BufferGeometry;
  /** The `HEIGHTFIELD` collider's shape (`toHeightfieldColliderParams` on `aekasha/physics`, from
   * the generator's row-major heights). Without it, the collider is read from the geometry's
   * vertices. */
  heightfield?: HeightFieldData & { type: 'HEIGHTFIELD' };
};

/**
 * A terrain block geometry generator: what a `*.terrainBlock.json`'s
 * `"geometry": { "generator": id, "params": …, "seed": … }` runs when the block spawns. May be
 * async.
 */
export type TerrainGenerator = (
  opts: TerrainGeneratorOpts
) => TerrainGeneratorResult | Promise<TerrainGeneratorResult>;

const generators = new Map<string, TerrainGenerator>();

/**
 * Registers a terrain block geometry generator under an id, which a `*.terrainBlock.json`'s
 * `geometry.generator` names. Register from an install (an app's `appECSPlugins`, a feature's),
 * never at module load. The toolkit's generators (`noiseTerrain`, `rulesTerrain`) register with
 * the toolkit's `registerTerrainGenerators()`.
 * @param generator makes a block's geometry (and its heightfield) from its params, seed and grid
 * @throws when `terrain()` isn't installed, or another generator has the id
 * @example
 * ```ts
 * import { registerTerrainGenerator } from 'aekasha/terrain';
 * import { generateTerrain } from 'aekasha/toolkit/geometry';
 *
 * registerTerrainGenerator('flatNoise', ({ params, seed, grid }) => {
 *   const segments = grid.resolution - 1;
 *   const { geometry } = generateTerrain({
 *     width: grid.size,
 *     depth: grid.size,
 *     widthSegments: segments,
 *     depthSegments: segments,
 *     maxHeight: Number(params.maxHeight ?? 4),
 *     seed: seed + grid.x * 7919 + grid.z * 104729,
 *   });
 *   return { geometry };
 * });
 * ```
 */
export const registerTerrainGenerator = (id: string, generator: TerrainGenerator) => {
  assertTerrainInstalled('registerTerrainGenerator');
  if (generators.has(id)) {
    throw new Error(
      `registerTerrainGenerator: a terrain generator has the id "${id}" already (unregisterTerrainGenerator it first).`
    );
  }
  generators.set(id, generator);
};

/**
 * Removes a terrain generator's registration. The blocks it made stay.
 * @returns whether a generator had the id
 */
export const unregisterTerrainGenerator = (id: string) => generators.delete(id);

/**
 * The terrain generator registered under an id, or undefined.
 */
export const getTerrainGenerator = (id: string): TerrainGenerator | undefined => generators.get(id);

/**
 * The registered generators' ids, in registration order (for messages and the debug tools).
 * @internal
 */
export const getTerrainGeneratorIds = () => [...generators.keys()];
