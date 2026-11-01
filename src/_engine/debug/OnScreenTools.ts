import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

/**
 * The on-screen tools' groups, as {@link updateOnScreenTools} takes them.
 * @internal
 */
export type ToolTypes = 'SWITCH' | 'PLAY' | 'UNDO' | 'VIEW';

type OnScreenToolsGUIModule = typeof import('./_dbg__OnScreenTools');
let debugGUI: DebugModuleRef<OnScreenToolsGUIModule> | null = null;

/**
 * Loads the on-screen tools (debug env and prod test mode): the boot's.
 * @internal
 */
export const registerOnScreenTools = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./_dbg__OnScreenTools'), true);
};

/**
 * Builds the on-screen tools: the main loop's debug start.
 * @internal
 */
export const InitOnScreenTools = () => {
  useDebug(debugGUI, true)?._InitOnScreenTools();
};

/**
 * Refreshes the on-screen tools' groups (all of them by default) after a state they show changed:
 * the debug keys', the views' and the debug modules'.
 * @internal
 */
export const updateOnScreenTools = (tools?: ToolTypes[] | ToolTypes) => {
  useDebug(debugGUI, true)?._updateOnScreenTools(tools);
};

/**
 * Disables every on-screen tool during a scene load, or enables them again (p806 D7): each
 * control `aria-disabled` with the tooltip "Loading the scene…", an open drop-down closed. Debug
 * environment only. `disableDebugger`'s.
 * @internal
 */
export const setOnScreenToolsDisabled = (disable: boolean) => {
  useDebug(debugGUI)?._setOnScreenToolsDisabled(disable);
};

/**
 * Toggles between the debug camera and the app camera (F1, the on-screen debug camera button)
 * and shows a toast of the camera that is now active. Debug environment only. The debug keys'.
 * @internal
 */
export const toggleDebugCameraWithToast = () => {
  useDebug(debugGUI)?._toggleDebugCameraWithToast();
};

/**
 * The on-screen dropdowns: the camera and the scene selector. The on-screen tools' and the debug
 * keys'.
 * @internal
 */
export type OnScreenDropDownKey = 'CAMERA' | 'SCENE';

/**
 * Opens an on-screen dropdown's list on its current option, or closes it (the o and p
 * shortcuts). Debug env only. The debug keys'.
 * @internal
 */
export const toggleOnScreenDropDown = (key: OnScreenDropDownKey) => {
  useDebug(debugGUI)?._toggleOnScreenDropDown(key);
};

/**
 * Reloads the app in production test mode (the on-screen play button, F5). The debug keys' and the
 * on-screen tools'.
 * @internal
 */
export const playInProdTestMode = () => {
  useDebug(debugGUI, true)?._playInProdTestMode();
};

/**
 * Reloads the app in debug mode (the on-screen stop button in production test mode, F5). The prod
 * test keys' and the on-screen tools'.
 * @internal
 */
export const stopProdTestMode = () => {
  useDebug(debugGUI, true)?._stopProdTestMode();
};
