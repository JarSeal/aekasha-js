import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

let debugGUI: DebugModuleRef<typeof import('../kernel/assets/debug/_dbg__Assets')> | null = null;

/** Creates the Assets debugger tab (loaded textures and geometries, incl. imported ones). The
 * implementation is only loaded in debug builds. */
export const createAssetsDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('../kernel/assets/debug/_dbg__Assets'));
  useDebug(debugGUI)?._createAssetsDebugGUI();
};
