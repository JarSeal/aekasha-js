import type { SceneData } from '../../kernel/scene/Scene';

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
