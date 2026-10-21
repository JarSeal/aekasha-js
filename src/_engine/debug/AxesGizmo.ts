import { IS_DEBUG_ENV } from '../kernel/config/Config';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

type AxesGizmoModule = typeof import('./_dbg__AxesGizmo');
let debugGizmo: DebugModuleRef<AxesGizmoModule> | null = null;

/**
 * Loads the axes gizmo module (debug environments only). The boot's.
 * @internal
 */
export const registerAxesGizmoModule = async () => {
  if (!IS_DEBUG_ENV) return;
  debugGizmo = await loadDebugModuleAsync(() => import('./_dbg__AxesGizmo'));
};

/**
 * Creates the axes gizmo: a Blender-style orientation gizmo in the top-right corner that
 * follows the active camera (debug environments only). The Debug tools tab's.
 * @internal
 * @param opts (object) { show: boolean; showInMainCamera: boolean }
 */
export const initAxesGizmo = (opts: { show: boolean; showInMainCamera: boolean }) => {
  useDebug(debugGizmo)?._initAxesGizmo(opts);
};

/**
 * Shows or hides the axes gizmo (it is only shown while the debug camera is active, unless
 * showInMainCamera is on). The Debug tools tab's.
 * @internal
 * @param show (boolean)
 */
export const setAxesGizmoVisible = (show: boolean) => {
  useDebug(debugGizmo)?._setAxesGizmoVisible(show);
};

/**
 * Sets whether the axes gizmo is also shown while the main (gameplay) camera is active. The Debug
 * tools tab's.
 * @internal
 * @param show (boolean)
 */
export const setAxesGizmoInMainCamera = (show: boolean) => {
  useDebug(debugGizmo)?._setAxesGizmoInMainCamera(show);
};
