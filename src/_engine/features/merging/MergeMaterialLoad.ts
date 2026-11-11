import type { SceneData } from '../../kernel/scene/Scene';
import type { SceneMergeMaterial } from './MergeMaterialSchema';

// A scene's merge materials (docs/plans/p374_multi-material-merging.md Phase 2): merging()'s
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
 * A merge material made from palette data the caller gives, over the slot arrays its `__slots`
 * name (loaded already), neither it nor its table registered. Its user is the `mergeMaterials`
 * verification scene, which draws a copy of its palette's data with `missing: 'SKIP'` slots (a
 * scene's list takes a palette as its JSON is). The caller registers both (`saveTexture` under
 * `tableId`, `saveMaterial`), so the loading scene owns them. Loads the material code first.
 * @internal
 * @param palette a palette of the scene's data (`SceneData.mergeMaterials`), or a copy of one
 * @param tableId the registry id the caller saves the table under (kept in the material's info)
 * @returns the material and its table texture
 * @throws (rejects) when a slot's array didn't load and the palette has `throwOnError`
 */
export const createMergeMaterialAsync = async (palette: SceneMergeMaterial, tableId: string) => {
  const { createMergeMaterialFromData } = await loadMergeMaterialModuleAsync();
  return createMergeMaterialFromData(palette, tableId);
};
