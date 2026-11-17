import { registerTerrainGenerator, type TerrainGeneratorOpts } from 'aekasha/terrain';

/** The generators' code, loaded with the first block that uses one */
const loadGeneratorsAsync = () => import('./TerrainBlockGenerators');

/**
 * Registers the toolkit's terrain block generators (p306 D4), which a `*.terrainBlock.json`'s
 * `geometry.generator` names. Call it once, from an install (an app's `appECSPlugins`), never at
 * module load; their code loads with the first block that uses one, and they generate on the
 * toolkit's terrain worker (`generateTerrainAsync`).
 *
 * - **`noiseTerrain`**: seeded simplex octaves sampled at the block's world place (its `grid`
 *   × `size`), the block's seed as it is, so neighbouring blocks of one seed continue each other.
 *   Params: `maxHeight` (metres, default 8), `octaves` (`[frequency, amplitude]` pairs, default
 *   `generateTerrain`'s two), `normals` (`HEIGHT_FN` default: seamless across blocks, or
 *   `GEOMETRY`), `skirt` (metres, default 0).
 * - **`rulesTerrain`**: `noiseTerrain`'s heights, plus the terrain material's rules evaluated per
 *   vertex into the vertex colours, for a material blending `VERTEX_COLOR`. Params: the noise's,
 *   `rules` (1 to 16, the terrain material's `TerrainRule`s), `layout` (`RGB_AO` default or
 *   `RGBA`), `ao` (`{ radius, strength?, steps? }`: the horizon AO in `RGB_AO`'s A) and
 *   `noiseTexture` (the texture a rule's noise reads, default `macroNoise`, which the scene lists).
 *
 * Both give the block's `HEIGHTFIELD` collider its shape from their own grid.
 * @throws when `terrain()` isn't installed, or a generator has one of the ids already
 * @example
 * ```ts
 * import type { EngineFeature } from 'aekasha';
 * import { registerTerrainGenerators } from 'aekasha/toolkit/terrain';
 *
 * export const appECSPlugins: EngineFeature = {
 *   id: 'app',
 *   install: () => {
 *     registerTerrainGenerators();
 *   },
 * };
 * ```
 * ```json
 * {
 *   "geometry": {
 *     "generator": "noiseTerrain",
 *     "params": { "maxHeight": 6, "octaves": [[0.02, 1], [0.08, 0.3]] },
 *     "seed": 11
 *   },
 *   "material": "terrainHills",
 *   "grid": { "x": 0, "z": 0, "size": 64, "resolution": 129 }
 * }
 * ```
 */
export const registerTerrainGenerators = () => {
  registerTerrainGenerator('noiseTerrain', async (opts: TerrainGeneratorOpts) =>
    (await loadGeneratorsAsync()).generateNoiseTerrainBlockAsync(opts)
  );
  registerTerrainGenerator('rulesTerrain', async (opts: TerrainGeneratorOpts) =>
    (await loadGeneratorsAsync()).generateRulesTerrainBlockAsync(opts)
  );
};
