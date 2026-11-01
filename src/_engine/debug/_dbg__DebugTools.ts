// The Debug tools tab: its registration and top rows, and the key shortcuts that change its state.
// Its state is _dbg__DebugToolsState.ts, its folders _dbg__DebugToolsFolders.ts and
// _dbg__DebugCameraFolder.ts (p806 D11).
import { getRenderer } from '../kernel/render/Renderer';
import { addDebugToast, createDebuggerTab, type DebuggerPaneItem } from './DebuggerGUI';
import { getCurrentSceneId } from '../kernel/scene/Scene';
import { IS_DEBUG_ENV } from '../kernel/config/Config';
import { lerror } from '../utils/Logger';
import { fitAllDraggableWindowsToScreen } from '../ui/overlays/windows/DraggableWindow';
import { DEBUGGER_THEMES, setDebuggerTheme, type DebuggerTheme } from '../ui/overlays/DebuggerRoot';
import {
  toggleAxesHelperVisibility,
  toggleGridHelperVisibility,
  togglePolarGridHelperVisibility,
} from './_dbg__SceneHelpers';
import type { DebugToolsState } from './DebugTools';
import { isDebugCameraActive } from '../kernel/camera/Camera';
import { setDebugCameraPanelRefresh } from '../kernel/camera/debug/_dbg__DebugCamera';
import { initAxesGizmo, setAxesGizmoInMainCamera, setAxesGizmoVisible } from './AxesGizmo';
import { openDebugKeyShortcutsDialog } from './_dbg__DebugKeyShortcuts';
import { initEnvBall, setEnvBallInMainCamera, setEnvBallVisible } from './EnvBall';
import {
  _applyOnScreenToolsDisabled,
  _getDebugToolsState,
  DEBUG_TOOLS_LS_KEY,
  DEBUG_TOOLS_TAB_ID,
  markDebugToolsTabRegistered,
  persistShortcutValue,
} from './_dbg__DebugToolsState';
import {
  getDebugCameraFolder,
  refreshDebugCameraFolderFromViewport,
} from './_dbg__DebugCameraFolder';
import {
  getFileServerFolder,
  getHelpersFolder,
  getLoggingFolder,
  getOnScreenToolsFolder,
  getScenesFolder,
  getUndoRedoFolder,
  refreshDevFilesRow,
  withDebugKeyHint,
} from './_dbg__DebugToolsFolders';

// What the thin module (DebugTools.ts) calls
export {
  _applyDebuggerTheme,
  _applyOnScreenToolsDisabled,
  _getDebugToolsState,
} from './_dbg__DebugToolsState';
export { openDebugKeyShortcutsDialog as _openDebugKeyShortcutsDialog };

/**
 * Initializes the debug tools (only for debug environments).
 */
export const _initDebugTools = () => {
  if (!IS_DEBUG_ENV) return;
  createDebugToolsDebugGUI();
};

const createDebugToolsDebugGUI = () => {
  const renderer = getRenderer();
  if (!renderer) {
    const msg = 'Renderer not found in createDebugToolsDebugGUI';
    lerror(msg);
    throw new Error(msg);
  }

  createDebuggerTab({
    id: DEBUG_TOOLS_TAB_ID,
    title: 'Debug tools controls',
    icon: 'tools',
    lsKey: DEBUG_TOOLS_LS_KEY,
    state: _getDebugToolsState(),
    // The nested objects are persisted whole (the same LS shape as before). The *FolderExpanded
    // fields in them are no longer used: folder states are in `${LS_KEY}UI`.
    persistKeys: [
      'scenesListing',
      'onScreenTools',
      'helpers',
      'axesGizmo',
      'envBall',
      'devFiles',
      'appearance',
    ],
    // Live-refresh the Debug camera folder from the viewport (dragging the debug camera with
    // OrbitControls). Unregistered on unmount, so a stale callback never runs against a removed
    // grid. The File server folder's status row asks the dev server again on every mount.
    onOpen: () => {
      setDebugCameraPanelRefresh(refreshDebugCameraFolderFromViewport);
      refreshDevFilesRow();
      return () => setDebugCameraPanelRefresh(null);
    },
    content: () => [{ pane: true, content: buildDebugToolsItems() }],
  });
  // Hydrated at registration
  markDebugToolsTabRegistered();

  const state = _getDebugToolsState();
  toggleAxesHelperVisibility(state.helpers.showAxesHelper);
  toggleGridHelperVisibility(state.helpers.showGridHelper);
  togglePolarGridHelperVisibility(state.helpers.showPolarGridHelper);
  initAxesGizmo(state.axesGizmo);
  initEnvBall(state.envBall);
};

const DEBUGGER_THEME_TEXTS: Record<DebuggerTheme, string> = {
  dark: 'Dark',
  light: 'Light',
  app: "The app's",
};

/** The tab's rows: the dialogs and windows, the theme, then a folder per area. */
const buildDebugToolsItems = (): DebuggerPaneItem<DebugToolsState>[] => {
  const currentSceneId = getCurrentSceneId();
  if (!currentSceneId) return [];
  return [
    {
      type: 'button',
      title: withDebugKeyHint('Debug key shortcuts', 'sc-open-engine-key-shortcuts'),
      onClick: () => openDebugKeyShortcutsDialog('AEKASHA'),
    },
    {
      type: 'button',
      title: withDebugKeyHint('App key shortcuts (current scene)', 'sc-open-app-key-shortcuts'),
      onClick: () => openDebugKeyShortcutsDialog('APP'),
    },
    {
      type: 'button',
      title: 'Center and fit all windows',
      onClick: () => {
        if (!fitAllDraggableWindowsToScreen()) addDebugToast({ title: 'No open windows' });
      },
    },
    {
      key: 'appearance.theme',
      label: 'Debugger theme',
      options: DEBUGGER_THEMES.map((value) => ({ value, text: DEBUGGER_THEME_TEXTS[value] })),
      onChange: (value) => setDebuggerTheme(value as DebuggerTheme),
    },
    { type: 'separator' },
    getScenesFolder(currentSceneId),
    getOnScreenToolsFolder(),
    getDebugCameraFolder(currentSceneId),
    getHelpersFolder(),
    getUndoRedoFolder(),
    getFileServerFolder(),
    getLoggingFolder(),
  ];
};

const ON_SCREEN_TOOLS_TOAST_SHOWING_TIME_MS = 2000;

/**
 * The on-screen tools shortcut (§): flips the "Disable on-screen tools" option and shows a toast.
 * @param keyHint (string) optional readable chord that was pressed, for the toast
 */
export const _toggleOnScreenToolsDisabled = (keyHint?: string) => {
  const onScreenTools = _getDebugToolsState().onScreenTools;
  onScreenTools.disableOnScreenTools = !onScreenTools.disableOnScreenTools;
  _applyOnScreenToolsDisabled();
  persistShortcutValue('onScreenTools');
  addDebugToast({
    title: 'On-screen tools',
    message: onScreenTools.disableOnScreenTools
      ? `Disabled (click-through).${keyHint ? ` Press ${keyHint} to enable.` : ''}`
      : 'Enabled',
    showingTime: ON_SCREEN_TOOLS_TOAST_SHOWING_TIME_MS,
  });
};

type GizmoKey = 'axesGizmo' | 'envBall';

const GIZMO_SHORTCUTS: Record<
  GizmoKey,
  { name: string; setVisible: (show: boolean) => void; setInMainCamera: (show: boolean) => void }
> = {
  axesGizmo: {
    name: 'Axes gizmo',
    setVisible: setAxesGizmoVisible,
    setInMainCamera: setAxesGizmoInMainCamera,
  },
  envBall: {
    name: 'Environment ball',
    setVisible: setEnvBallVisible,
    setInMainCamera: setEnvBallInMainCamera,
  },
};

/** A gizmo shortcut: hides a shown gizmo, and shows a hidden one. With the main camera active,
 * showing it also turns on its "in main camera" option, so it appears right away. */
const toggleGizmoFromShortcut = (key: GizmoKey) => {
  const opts = _getDebugToolsState()[key];
  const { name, setVisible, setInMainCamera } = GIZMO_SHORTCUTS[key];
  const isMainCamera = !isDebugCameraActive();
  const isShown = opts.show && (!isMainCamera || opts.showInMainCamera);
  if (isShown) {
    opts.show = false;
  } else {
    opts.show = true;
    if (isMainCamera) opts.showInMainCamera = true;
  }
  setVisible(opts.show);
  setInMainCamera(opts.showInMainCamera);
  persistShortcutValue(key);

  let title = `${name} hidden`;
  if (opts.show && isMainCamera) title = `${name} visible and showing in main camera`;
  else if (opts.show) title = `${name} visible`;
  addDebugToast({ title });
};

/** The axes gizmo shortcut (F10), see toggleGizmoFromShortcut. */
export const _toggleAxesGizmo = () => toggleGizmoFromShortcut('axesGizmo');

/** The environment ball shortcut (F9), see toggleGizmoFromShortcut. */
export const _toggleEnvBall = () => toggleGizmoFromShortcut('envBall');
