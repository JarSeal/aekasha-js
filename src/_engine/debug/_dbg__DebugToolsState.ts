// The Debug tools tab's state (p806 D11: out of _dbg__DebugTools.ts, so the tab and its folders
// both import it, neither the other): its ids, the state and its 5.x LS migration, and what applies
// it outside the tab (the on-screen tools' click-through, the debugger theme).
import { lsGetItem, lsSetItem } from '../utils/LocalAndSessionStorage';
import { persistDebuggerTabValue, updateDebuggerTab } from './DebuggerGUI';
import { getConfig, IS_DEBUG_ENV } from '../kernel/config/Config';
import { setDebuggerTheme } from '../ui/overlays/DebuggerRoot';
import type { DebugToolsState } from './DebugTools';
import { DEFAULT_SAVE_HISTORY_SIZE } from './DevFiles';

export const DEBUG_TOOLS_LS_KEY = 'AEK_debugTools';
export const DEBUG_TOOLS_TAB_ID = 'debugToolsControls';

let isTabRegistered = false;
let debugToolsState: DebugToolsState = {
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
  // Saved only once changed here, so until then a CONFIG change applies
  devFiles: {
    saveHistorySize: getConfig().devFiles?.saveHistorySize ?? DEFAULT_SAVE_HISTORY_SIZE,
  },
  // Saved only once changed here, as devFiles
  appearance: {
    theme: getConfig().debugDrawer?.theme ?? 'dark',
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

type LegacyDebugToolsLS = Partial<DebugToolsState> & {
  prodTestMode?: { showOnScreenToolsInProdTest?: boolean };
};

/**
 * Shallow-merges the LS state over debugToolsState. The old `prodTestMode` key is migrated to
 * `onScreenTools` and written back right away: the tab's persist writes only keep the
 * persistKeys already in LS, so any later write would otherwise drop the migrated value.
 */
const loadDebugToolsStateFromLS = () => {
  let saved = lsGetItem(DEBUG_TOOLS_LS_KEY, {}) as LegacyDebugToolsLS | null;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
  if (saved.prodTestMode && !saved.onScreenTools) {
    const { prodTestMode, ...rest } = saved;
    saved = {
      ...rest,
      onScreenTools: {
        ...debugToolsState.onScreenTools,
        showOnScreenToolsInProdTest: prodTestMode.showOnScreenToolsInProdTest !== false,
      },
    };
    lsSetItem(DEBUG_TOOLS_LS_KEY, saved);
  }
  debugToolsState = { ...debugToolsState, ...saved };
};

/**
 * Getter for the debugToolsState object
 * @param loadFromLS (boolean) optional flag to get the debugToolsState from the LS
 * @returns debugToolsState {@link debugToolsState}
 */
export const _getDebugToolsState = (loadFromLS?: boolean) => {
  if (!isTabRegistered && loadFromLS) loadDebugToolsStateFromLS();
  return debugToolsState;
};

/** The tab is registered: it hydrated the state from LS, so the state isn't read from LS again. */
export const markDebugToolsTabRegistered = () => {
  isTabRegistered = true;
};

/**
 * Applies the "Debugger theme" setting (p806 D8) to the debugger's roots: the saved one, else
 * `AppConfig.debugDrawer.theme`. The boot's, once the state is read (debug env and prod test mode).
 */
export const _applyDebuggerTheme = () => setDebuggerTheme(debugToolsState.appearance.theme);

const ON_SCREEN_TOOLS_DISABLED_BODY_CLASS = 'aekOnScreenToolsDisabled';
const ON_SCREEN_TOOLS_OPACITY_CSS_VAR = '--aek-disabled-on-screen-tools-opacity';

/**
 * Applies the "Disable on-screen tools" option: a body class (see OnScreenTools.module.scss) and
 * the opacity CSS variable, so rebuilt tool groups keep it. Idempotent. Debug env only.
 */
export const _applyOnScreenToolsDisabled = () => {
  if (!IS_DEBUG_ENV) return;
  const { disableOnScreenTools, disabledOnScreenToolsOpacity } = debugToolsState.onScreenTools;
  document.body.classList.toggle(ON_SCREEN_TOOLS_DISABLED_BODY_CLASS, disableOnScreenTools);
  document.body.style.setProperty(
    ON_SCREEN_TOOLS_OPACITY_CSS_VAR,
    String(disabledOnScreenToolsOpacity)
  );
};

/** Persists a value a shortcut changed, and refreshes the tab. Before the tab is registered (the
 * key bindings are, during the first scene load) it is written to LS directly, or the tab's
 * hydration would restore the old value over this one. */
export const persistShortcutValue = (key: 'onScreenTools' | 'axesGizmo' | 'envBall') => {
  if (isTabRegistered) {
    persistDebuggerTabValue(DEBUG_TOOLS_TAB_ID, key);
    updateDebuggerTab(DEBUG_TOOLS_TAB_ID);
    return;
  }
  lsSetItem(DEBUG_TOOLS_LS_KEY, {
    ...(lsGetItem(DEBUG_TOOLS_LS_KEY, {}) as object),
    [key]: debugToolsState[key],
  });
};
