import { setupTerrainMaterial } from 'aekasha/toolkit/terrain';

/**
 * The terrain material's JSON route (p305): the toolkit's generator (`setupTerrainMaterial`,
 * `aekasha/toolkit/terrain`) as a TSL file's `setup`, so a `*.material.json` naming this file
 * builds the same graph `createTerrainMaterial` does. Its static define `terrain` is the config
 * without the id and the layers' sets; the inputs `layer0`, `layer1`, … give the sets
 * (`{ "textureSet": id, "packing"? }`, all in one packing), which a mesh's
 * `matOverrides.inputs` swaps per block without another shader.
 * Asset code: the material's generated loader imports it.
 * @internal
 */
export const setup = setupTerrainMaterial;
