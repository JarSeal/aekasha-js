import { setupTerrainMaterial } from 'aekasha/toolkit/terrain';

/**
 * The terrain gallery's patch material (`terrainGalleryPatch.material.json`): the toolkit's terrain
 * material through its JSON route, as an app material JSON needs a TSL file of its own.
 * Asset code: the material's generated loader imports it.
 * @internal
 */
export const setup = setupTerrainMaterial;
