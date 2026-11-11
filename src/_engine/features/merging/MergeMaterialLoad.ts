import type { SceneData } from '../../kernel/scene/Scene';
import type { SceneMergeMaterial } from './MergeMaterialSchema';

// A scene's merge materials (docs/plans/_DONE_p374_multi-material-merging.md Phase 2): merging()'s
// `assetsLoaded` scene hook makes the merge material of each palette the loading scene lists,
// once its slot arrays have loaded with the scene's textures and before its scene code runs, and
// registers it under the palette's id. Only this guard is in the first download: the
// registration (`MergeMaterialRegister.ts`) and the material code (`MergeMaterial.ts`) load with
// the first scene that lists a palette.

type MergeMaterialRegisterModule = typeof import('./MergeMaterialRegister');

let moduleLoad: Promise<MergeMaterialRegisterModule> | undefined;

/** The registration and material code, loaded once (again after a failed load) */
const loadMergeMaterialModuleAsync = () =>
  (moduleLoad ??= import('./MergeMaterialRegister').catch((error: unknown) => {
    moduleLoad = undefined;
    throw error;
  }));

/**
 * The `assetsLoaded` scene hook: the merge material of each palette the loading scene lists
 * (`SceneData.mergeMaterials`), registered under the palette's id and owned by the scene, with
 * its table as the texture `<paletteId>.table`. A palette another scene made already is re-tagged
 * (its arrays are the same loaded ones), so the scene shares it. Loads the material code first,
 * once, when the scene lists any.
 * @internal
 * @throws (rejects, failing the load) when a material that isn't the palette's merge material has
 * the palette's id, or a slot's array didn't load and the palette has `throwOnError`
 */
export const createSceneMergeMaterialsAsync = async (sceneData: SceneData) => {
  const palettes = sceneData.mergeMaterials;
  if (!palettes?.length) return;
  const { registerMergeMaterial } = await loadMergeMaterialModuleAsync();
  for (const palette of palettes) registerMergeMaterial(palette);
};

/**
 * Makes a merge material from palette data you give, over the slot arrays its `__slots` name
 * (loaded already: a scene that lists the palette loads them), and registers neither it nor its
 * table. A scene's `mergeMaterials` registers each listed palette's merge material by itself;
 * this is for a variant of one, such as a copy of its data with another slot's `missing`, without
 * a second palette JSON (which would build the same layers into arrays of its own). Register both
 * yourself (`saveTexture` under `tableId`, then `saveMaterial`), so the loading scene owns them.
 * Loads the merge material's code first, once.
 * @param palette a palette of the scene's data (`getGeneratedSceneData(id).mergeMaterials`), or
 * a copy of one
 * @param tableId the registry id you save the table under (the material's info keeps it)
 * @returns the material and its table texture
 * @throws (rejects) when a slot's array didn't load and the palette has `throwOnError`
 * @remarks Groups find a palette's merge material by the palette's id: a variant registered under
 * another id draws only meshes you give it, never a palette group.
 * @example
 * ```ts
 * import { existsOrThrow, getGeneratedSceneData, saveMaterial, saveTexture } from 'aekasha';
 * import { createMergeMaterialAsync } from 'aekasha/merging';
 *
 * const palette = existsOrThrow(
 *   getGeneratedSceneData('ruins')?.mergeMaterials?.find((p) => p.id === 'ruinsPalette'),
 *   'The scene lists no ruinsPalette.'
 * );
 * // The same arrays, the normal map sampled only for the members that have one
 * const normalMap = existsOrThrow(palette.__slots.normalMap, 'No normalMap slot.');
 * const { material, table } = await createMergeMaterialAsync(
 *   {
 *     ...palette,
 *     id: 'ruinsPaletteSkip',
 *     __slots: { ...palette.__slots, normalMap: { ...normalMap, missing: 'SKIP' } },
 *   },
 *   'ruinsPaletteSkip.table'
 * );
 * saveTexture(table, 'ruinsPaletteSkip.table');
 * saveMaterial(material, 'ruinsPaletteSkip');
 * ```
 */
export const createMergeMaterialAsync = async (palette: SceneMergeMaterial, tableId: string) => {
  const { createMergeMaterialFromData } = await loadMergeMaterialModuleAsync();
  return createMergeMaterialFromData(palette, tableId);
};
