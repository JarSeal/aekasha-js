import { setupRockMaterial } from 'aekasha/toolkit/terrain';

/**
 * The rock material (p308 D5): the terrain category's `setupRockMaterial` as a TSL file's `setup`,
 * so `rockScatter.material.json` (and an app's own JSON over another set, with a two-line TSL file
 * of its own) builds it. Asset code: the material's generated loader imports it.
 * @internal
 */
export const setup = setupRockMaterial;
