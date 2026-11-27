import { setupTerrainMaterial } from 'aekasha/toolkit/terrain';

/**
 * The fog showcase's ground (`fogShowcaseGround.material.json`): the toolkit's terrain material
 * through its JSON route; an app material JSON needs a TSL file of its own. Asset code: the
 * material's generated loader imports it.
 * @internal
 */
export const setup = setupTerrainMaterial;
