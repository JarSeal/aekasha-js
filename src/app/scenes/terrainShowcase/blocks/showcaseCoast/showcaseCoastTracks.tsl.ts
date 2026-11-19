import { setupDecalMaterial } from 'aekasha/toolkit/terrain';

/**
 * The coast's tinted tyre-track material (`showcaseCoastTracks.material.json`): the toolkit's decal
 * material, as an app material JSON needs a TSL file of its own. Asset code: the material's
 * generated loader imports it.
 * @internal
 */
export const setup = setupDecalMaterial;
