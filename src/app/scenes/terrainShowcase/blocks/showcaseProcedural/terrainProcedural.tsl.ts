import { setupTerrainMaterial } from 'aekasha/toolkit/terrain';

/**
 * terrainShowcase's procedural block's material (`terrainProcedural.material.json`): the toolkit's
 * terrain material through its JSON route, as an app material JSON needs a TSL file of its own.
 * Asset code: the material's generated loader imports it.
 * @internal
 */
export const setup = setupTerrainMaterial;
