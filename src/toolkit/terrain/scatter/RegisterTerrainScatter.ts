import { registerScatterGenerator, type ScatterGeneratorInput } from 'aekasha/instancing';

/** The generator's code, loaded with the first scatter that uses it */
const loadTerrainScatterAsync = () => import('./TerrainScatter');

/**
 * Registers the toolkit's terrain scatter generator (p308 D4), `terrainScatter`, which a
 * `*.scatter.json`'s `"source": { "type": "PROCEDURAL", "generator": "terrainScatter" }` names.
 * Call it once, from an install (an app's `appECSPlugins`), never at module load; its code loads
 * with the first scatter that uses it.
 *
 * It takes Poisson-disk candidates `minSpacing` apart over the target's square (a terrain block's,
 * inset by half the spacing so neighbouring blocks keep it across the seam), keeps each by
 * `density` × its mask, and places it on the block's mesh: its height and normal read from the
 * mesh's grid (a `TRIMESH` block's overhangs throw; a target without an entity is a flat square at
 * its height), a random yaw, tilted toward the normal by `alignToNormal`, sized in `scale`, its
 * bounding box's bottom on the surface and `sink` of its height under it, darkened by up to
 * `tint`. Every draw comes from the scatter's seed (the world seed, the block's grid place and the
 * scatter's id): the same block always gets the same instances, whatever the load order.
 *
 * Params (all optional):
 * - `minSpacing`: metres between any two instances (default 0.5).
 * - `density`: the share of candidates kept where the mask is 1, 0..1 (default 1).
 * - `mask`: what thins them out, multiplied together:
 *   - `layers`: `{ "<layer index>": factor }`, the block's terrain material's layer weights
 *     (its blend evaluated as the material does: its vertex colours, splat maps and rules; normalized,
 *     without the height blend) × each factor, summed (an unnamed layer counts 0). A material that
 *     isn't a terrain material is layer 0 everywhere.
 *   - `slope`, `height`: `{ min?, max?, softness? }`, degrees and metres, as a terrain rule's
 *     ranges (whole inside, faded over `softness` past each end: default 5° and 2 m).
 *   - `noise`: `{ scale, amount?, seed? }`, clusters: a seeded simplex over the world's (x, z) /
 *     `scale` metres (not p304's GPU noise: none of it runs on the CPU), `1 − amount × (1 − noise)`
 *     (amount default 1). Seeded by the scatter's id, the world seed and `seed`, not the block,
 *     so clusters continue across blocks.
 * - `scale`: a number, or `[min, max]` (default 1).
 * - `alignToNormal`: 0 upright, 1 along the surface's normal (default 0).
 * - `sink`: the share of an item's bounding height under the surface, 0..1 (default 0).
 * - `tint`: the most an instance is darkened (its colour `1 − tint × random`), 0..1 (default 0:
 *   no colours).
 * - `splatMaps`: the block's splat maps' texture ids (`splat0`, `splat1`), which a splat material's
 *   layer mask reads back from the GPU (a material doesn't keep its inputs).
 * - `noiseTexture`: the texture its rules' noise reads (default `macroNoise`).
 * @throws when `instancing()` isn't installed, or a generator has the id already
 * @example
 * ```ts
 * import type { EngineFeature } from 'aekasha';
 * import { registerTerrainScatter } from 'aekasha/toolkit/terrain';
 *
 * export const appECSPlugins: EngineFeature = {
 *   id: 'app',
 *   install: () => {
 *     registerTerrainScatter();
 *   },
 * };
 * ```
 * ```json
 * {
 *   "items": [{ "geometry": "pebble", "material": "pebbleStone" }],
 *   "source": {
 *     "type": "PROCEDURAL",
 *     "generator": "terrainScatter",
 *     "params": {
 *       "minSpacing": 0.4,
 *       "density": 0.6,
 *       "mask": { "layers": { "1": 1 }, "slope": { "max": 35 } },
 *       "scale": [0.6, 1.4],
 *       "alignToNormal": 0.7,
 *       "sink": 0.15,
 *       "tint": 0.08
 *     },
 *     "seed": 3
 *   }
 * }
 * ```
 */
export const registerTerrainScatter = () => {
  registerScatterGenerator('terrainScatter', async (input: ScatterGeneratorInput) =>
    (await loadTerrainScatterAsync()).generateTerrainScatterAsync(input)
  );
};
