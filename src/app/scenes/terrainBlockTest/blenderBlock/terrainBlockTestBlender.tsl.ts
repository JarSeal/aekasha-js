import { setupTerrainMaterial } from 'aekasha/toolkit/terrain';

/**
 * The orientation blocks' terrain materials (`terrainBlockTestBlenderVertex.material.json`,
 * `terrainBlockTestBlenderSplat.material.json`): the toolkit's terrain material through its JSON
 * route, as an app material JSON needs a TSL file of its own. Asset code: the materials' generated
 * loaders import it.
 * @internal
 */
export const setup = setupTerrainMaterial;
