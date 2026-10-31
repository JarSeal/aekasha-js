import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../kernel/config/Config';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';
import type { DebuggerTheme } from '../ui/overlays/DebuggerRoot';

type LightGUIModule = typeof import('./_dbg__DebugTools');
let debugGUI: DebugModuleRef<LightGUIModule> | null = null;
/**
 * The debug camera's app id: the camera module's, the camera rig's and the Debug tools tab's.
 * @internal
 */
export const DEBUG_CAMERA_ID = '_debugCamera';

/**
 * A tab of the Debug key shortcuts dialog: the app's keys, or the engine's.
 * @internal
 */
export type DebugKeyShortcutsTab = 'APP' | 'AEKASHA';

/**
 * The Debug tools tab's state: the tab's, the dev files' and the scene loader's.
 * @internal
 */
export type DebugToolsState = {
  /** The "Scenes" folder */
  scenesListing: {
    /** The folder is open */
    scenesFolderExpanded: boolean;
    /** The first load picks `debugStartScene` over the app's start scene (also in prodTest) */
    useDebugStartScene: boolean;
    /** The scene id `useDebugStartScene` picks */
    debugStartScene: string;
    /** The first load goes through the debugger's scene loader */
    useDebuggerSceneLoader: boolean;
  };
  /** The "Logging" folder */
  loggingActions: {
    /** The folder is open */
    loggingFolderExpanded: boolean;
  };
  /** The "Undo / redo" folder */
  undoRedo: {
    /** The folder is open */
    undoRedoFolderExpanded: boolean;
  };
  /** Replaces the old `prodTestMode` key (migrated on LS load, see _dbg__DebugToolsState.ts). */
  onScreenTools: {
    showOnScreenToolsInProdTest: boolean;
    /** Makes the on-screen tools, the drawer handle, the stats panel and the axes gizmo
     * click-through and dims them (debug env only). */
    disableOnScreenTools: boolean;
    /** Their opacity while disabled, 0-1 */
    disabledOnScreenToolsOpacity: number;
  };
  /** The "Debug camera" folder is open */
  debugCameraFolderExpanded: boolean;
  /** Top-level (not in helpers): hydration replaces a persisted key whole, so a new field
   * inside an existing key would be undefined for anyone with saved state. */
  axesGizmo: {
    /** Shown while the debug camera is active (F10) */
    show: boolean;
    /** Shown while the main camera is active too */
    showInMainCamera: boolean;
  };
  /** Top-level, as axesGizmo. */
  envBall: {
    /** Shown while the debug camera is active (F9) */
    show: boolean;
    /** Shown while the main camera is active too */
    showInMainCamera: boolean;
    /** The roughness it samples the environment at, 0-1 */
    roughness: number;
  };
  /** The "File server" folder (p342). Top-level, as axesGizmo. Its default is
   * `AppConfig.devFiles`, and it's saved only once changed in the tab. */
  devFiles: {
    /** See `AppConfig.devFiles.saveHistorySize` (-1 = all, 0 = saving off) */
    saveHistorySize: number;
  };
  /** The debugger's look (p806 D8). Top-level, as axesGizmo. Its default is
   * `AppConfig.debugDrawer.theme`, and it's saved only once changed in the tab. */
  appearance: {
    /** The debugger's roots' theme (`ui/overlays/DebuggerRoot.ts`) */
    theme: DebuggerTheme;
  };
  /** The "Helpers" folder: three's axes, grid and polar grid helpers in the root scene */
  helpers: {
    /** The folder is open */
    helpersFolderExpanded: boolean;
    /** The axes helper is shown */
    showAxesHelper: boolean;
    /** Its axes' length */
    axesHelperSize: number;
    /** The grid helper is shown */
    showGridHelper: boolean;
    /** Its width and depth */
    gridSize: number;
    /** Its divisions per side */
    gridDivisionsSize: number;
    /** Its centre lines' colour */
    gridColorCenterLine: number;
    /** Its other lines' colour */
    gridColorGrid: number;
    /** The polar grid helper is shown */
    showPolarGridHelper: boolean;
    /** Its radius */
    polarGridRadius: number;
    /** Its radial lines */
    polarGridSectors: number;
    /** Its circles */
    polarGridRings: number;
    /** Each circle's line segments */
    polarGridDivisions: number;
  };
};

const defaultDebugToolsState: DebugToolsState = {
  scenesListing: {
    scenesFolderExpanded: false,
    useDebugStartScene: false,
    debugStartScene: '',
    useDebuggerSceneLoader: false,
  },
  loggingActions: {
    loggingFolderExpanded: false,
  },
  undoRedo: {
    undoRedoFolderExpanded: false,
  },
  onScreenTools: {
    showOnScreenToolsInProdTest: true,
    disableOnScreenTools: false,
    disabledOnScreenToolsOpacity: 0.5,
  },
  debugCameraFolderExpanded: false,
  axesGizmo: {
    show: true,
    showInMainCamera: false,
  },
  envBall: {
    show: true,
    showInMainCamera: false,
    roughness: 0,
  },
  // Outside the debug env saving into `__saveData` is off
  devFiles: {
    saveHistorySize: 0,
  },
  appearance: {
    theme: 'dark',
  },
  helpers: {
    helpersFolderExpanded: false,
    showAxesHelper: false,
    axesHelperSize: 1,
    showGridHelper: false,
    gridSize: 100,
    gridDivisionsSize: 100,
    gridColorCenterLine: 0x888888,
    gridColorGrid: 0x444444,
    showPolarGridHelper: false,
    polarGridRadius: 10,
    polarGridSectors: 16,
    polarGridRings: 8,
    polarGridDivisions: 16,
  },
};

/**
 * Loads the Debug tools tab's module (debug env and prod test mode, for the start scene setting):
 * the boot's.
 * @internal
 */
export const registerDebugToolsModule = async () => {
  if (!IS_DEBUG_ENV && !IS_PROD_TEST_MODE) return;
  // includeInProdTestMode: true — so isProdTest mode can still read the persisted
  // "debug start scene" setting via getDebugToolsState() below (SceneLoader.ts's
  // scene-to-load decision), even though the debug tools UI panel itself
  // (initDebugTools()/_initDebugTools) stays IS_DEBUG_ENV-only and never renders here.
  debugGUI = await loadDebugModuleAsync(() => import('./_dbg__DebugTools'), true);
  // Applied here (before the first scene load), not when the tab is built, so the on-screen
  // tools never start out fully visible and clickable, nor in another theme first
  getDebugToolsState(true);
  useDebug(debugGUI, true)?._applyDebuggerTheme();
  if (IS_DEBUG_ENV) useDebug(debugGUI)?._applyOnScreenToolsDisabled();
};

/**
 * Initializes the debug tools (only for debug environments). The boot's and the main loop's.
 * @internal
 */
export const initDebugTools = () => {
  if (!IS_DEBUG_ENV) return;
  useDebug(debugGUI)?._initDebugTools();
};

/**
 * Getter for the debugToolsState object. Read by the boot, the scene loader, the dev files and the
 * debug modules.
 * @internal
 * @param loadFromLS read the state from LocalStorage first
 * @returns the Debug tools tab's state, or its defaults while the debug module isn't loaded
 */
export const getDebugToolsState = (loadFromLS?: boolean) =>
  useDebug(debugGUI, true)?._getDebugToolsState(loadFromLS) || defaultDebugToolsState;

/**
 * The axes gizmo shortcut (F10): hides it, or shows it (also in the main camera, when that is
 * active), with a toast. Persisted, and the Debug Tools tab is refreshed if open. The debug keys'.
 * @internal
 */
export const toggleAxesGizmo = () => {
  useDebug(debugGUI)?._toggleAxesGizmo();
};

/**
 * The environment ball shortcut (F9): hides it, or shows it (also in the main camera, when that
 * is active), with a toast. Persisted, and the Debug Tools tab is refreshed if open. The debug
 * keys'.
 * @internal
 */
export const toggleEnvBall = () => {
  useDebug(debugGUI)?._toggleEnvBall();
};

/**
 * Toggles the "Disable on-screen tools" option (the § shortcut): applied, persisted, the Debug
 * Tools tab is refreshed if open, and a toast is shown. Debug env only. The debug keys'.
 * @internal
 * @param keyHint the pressed chord as text, for the toast
 */
export const toggleOnScreenToolsDisabled = (keyHint?: string) => {
  useDebug(debugGUI)?._toggleOnScreenToolsDisabled(keyHint);
};

/**
 * Opens the Debug key shortcuts dialog on a tab, or switches the open dialog to it (the u and i
 * shortcuts, and the Debug Tools tab's buttons). Debug env only. The debug keys' and the Debug
 * tools tab's.
 * @internal
 */
export const openDebugKeyShortcutsDialog = (tab: DebugKeyShortcutsTab) => {
  useDebug(debugGUI)?._openDebugKeyShortcutsDialog(tab);
};
