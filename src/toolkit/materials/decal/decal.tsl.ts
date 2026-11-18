import { setupDecalMaterial } from 'aekasha/toolkit/terrain';

/**
 * The decal material (p309 D2): the terrain category's `setupDecalMaterial` as a TSL file's
 * `setup`, so the toolkit's decal material JSONs in this folder (an atlas and a mode each) and an
 * app's own over its atlas build it. Asset code: the materials' generated loaders import it.
 * @internal
 */
export const setup = setupDecalMaterial;
