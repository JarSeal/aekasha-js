import { IS_DEBUG_ENV } from '../kernel/config/Config';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

type MaterialEditorModule = typeof import('./editors/material/_dbg__MaterialEditor');
let materialEditor: DebugModuleRef<MaterialEditorModule> | null = null;

/**
 * Loads the material editor and registers its editor view, "Material editor" (debug environments
 * only). Call it before the saved view is restored (the boot's debug steps).
 */
export const registerMaterialEditor = async () => {
  if (!IS_DEBUG_ENV) return;
  materialEditor = await loadDebugModuleAsync(
    () => import('./editors/material/_dbg__MaterialEditor')
  );
  useDebug(materialEditor)?._registerMaterialEditorView();
};
