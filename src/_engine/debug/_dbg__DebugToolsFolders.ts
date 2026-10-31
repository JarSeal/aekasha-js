// The Debug tools tab's folders (p806 D11: out of _dbg__DebugTools.ts, each a builder): the scenes,
// the on-screen tools, the helpers, undo / redo, the file server and the logging actions. The
// Debug camera folder is _dbg__DebugCameraFolder.ts.
import { getRenderer, getRendererOptions } from '../kernel/render/Renderer';
import { DEBUGGER_SCENE_LOADER_ID, updateDebuggerTab, type DebuggerPaneItem } from './DebuggerGUI';
import { getCurrentSceneId, getGeneratedAppData, getRootScene } from '../kernel/scene/Scene';
import { getCurrentEnvironment, getEnvs } from '../kernel/config/Config';
import { isCurrentlyLoading, loadScene } from '../kernel/scene/SceneLoader';
import { llog } from '../utils/Logger';
import {
  createAxesHelper,
  createGridHelper,
  createPolarGridHelper,
  toggleAxesHelperVisibility,
  toggleGridHelperVisibility,
  togglePolarGridHelperVisibility,
} from './_dbg__SceneHelpers';
import type { SceneAsset } from '../schemas/SceneSchema';
import type { DebugToolsState } from './DebugTools';
import { getUndoRedoSettings, setUndoRedoSettings } from './UndoRedo';
import { setAxesGizmoInMainCamera, setAxesGizmoVisible } from './AxesGizmo';
import { setEnvBallInMainCamera, setEnvBallRoughness, setEnvBallVisible } from './EnvBall';
import {
  getDevFilesSaveHistorySize,
  getDevFilesStatus,
  type DevFilesStatus,
  type DevFilesUnavailableReason,
} from './DevFiles';
import { getDebugKeyChordLabel } from './DefaultDebugKeyBindings';
import {
  _applyOnScreenToolsDisabled,
  _getDebugToolsState,
  DEBUG_TOOLS_TAB_ID,
} from './_dbg__DebugToolsState';

type Item = DebuggerPaneItem<DebugToolsState>;

/**
 * `text` with the debug key's chord after it, `[F9]`: the CONFIG.ts binding's, else the default's
 * (`getDebugKeyChordLabel`), so a rebound key shows; the text alone when the key has none.
 */
export const withDebugKeyHint = (text: string, debugKeyId: string) => {
  const chord = getDebugKeyChordLabel(debugKeyId);
  return chord ? `${text} [${chord}]` : text;
};

const getScenes = () => {
  const scenesObj = getGeneratedAppData().scenes as unknown as { [id: string]: SceneAsset };
  return Object.keys(scenesObj).map((id) => ({ value: id, text: scenesObj[id].name || `[${id}]` }));
};

/** "Change scene and debug start scene": the scene select (from `sceneId`, the current scene's) and
 * the start scene the first load picks. */
export const getScenesFolder = (sceneId: string): Item => {
  const scenes = getScenes();
  const sceneProxy = { sceneId };
  const isStartSceneOff = () => !_getDebugToolsState().scenesListing.useDebugStartScene;
  return {
    type: 'folder',
    id: 'scenes',
    title: 'Change scene and debug start scene',
    expanded: false,
    content: [
      {
        key: 'sceneId',
        target: sceneProxy,
        label: 'Change scene',
        options: scenes,
        onChange: (value) => {
          const id = String(value);
          if (id === getCurrentSceneId() || isCurrentlyLoading()) return;
          loadScene({ sceneId: id, loaderId: DEBUGGER_SCENE_LOADER_ID });
        },
      },
      {
        key: 'scenesListing.useDebugStartScene',
        label: 'Use debug start scene',
        // Re-evaluates the disabled state of the two below
        onChange: () => updateDebuggerTab(DEBUG_TOOLS_TAB_ID),
      },
      {
        key: 'scenesListing.debugStartScene',
        label: 'Start scene to load',
        options: [{ value: '', text: '---NOT-SET---' }, ...scenes],
        disabled: isStartSceneOff,
      },
      {
        key: 'scenesListing.useDebuggerSceneLoader',
        label: 'Load with debugger loader',
        disabled: isStartSceneOff,
      },
    ],
  };
};

/** "On-screen tools": their click-through and its opacity, and the top row in prod test mode. */
export const getOnScreenToolsFolder = (): Item => ({
  type: 'folder',
  id: 'onScreenTools',
  title: 'On-screen tools',
  expanded: false,
  content: [
    {
      key: 'onScreenTools.disableOnScreenTools',
      label: withDebugKeyHint('Disable on-screen tools', 'sc-toggle-on-screen-tools'),
      onChange: _applyOnScreenToolsDisabled,
    },
    {
      key: 'onScreenTools.disabledOnScreenToolsOpacity',
      label: 'Disabled on-screen tools opacity',
      min: 0,
      max: 1,
      step: 0.01,
      onChange: _applyOnScreenToolsDisabled,
    },
    {
      key: 'onScreenTools.showOnScreenToolsInProdTest',
      label: 'Show top tools in prod test',
    },
  ],
});

/** "Helpers": the environment ball, the axes gizmo and helper, the grid and the polar grid. */
export const getHelpersFolder = (): Item => {
  const helpers = _getDebugToolsState().helpers;
  const recreateGridHelper = () =>
    createGridHelper(
      helpers.gridSize,
      helpers.gridDivisionsSize,
      helpers.gridColorCenterLine,
      helpers.gridColorGrid
    );
  const recreatePolarGridHelper = () =>
    createPolarGridHelper(
      helpers.polarGridRadius,
      helpers.polarGridSectors,
      helpers.polarGridRings,
      helpers.polarGridDivisions
    );
  return {
    type: 'folder',
    id: 'helpers',
    title: 'Helpers',
    expanded: false,
    content: [
      {
        key: 'envBall.show',
        label: withDebugKeyHint('Show environment ball', 'sc-toggle-env-ball'),
        onChange: (value) => setEnvBallVisible(Boolean(value)),
      },
      {
        key: 'envBall.showInMainCamera',
        label: 'Show env ball in main camera',
        onChange: (value) => setEnvBallInMainCamera(Boolean(value)),
      },
      {
        key: 'envBall.roughness',
        label: 'Env ball roughness',
        min: 0,
        max: 1,
        step: 0.01,
        onChange: (value) => setEnvBallRoughness(Number(value)),
      },
      { type: 'separator' },
      {
        key: 'axesGizmo.show',
        label: withDebugKeyHint('Show axes gizmo', 'sc-toggle-axes-gizmo'),
        onChange: (value) => setAxesGizmoVisible(Boolean(value)),
      },
      {
        key: 'axesGizmo.showInMainCamera',
        label: 'Show gizmo in main camera',
        onChange: (value) => setAxesGizmoInMainCamera(Boolean(value)),
      },
      {
        key: 'helpers.showAxesHelper',
        label: 'Show axes helper',
        onChange: (value) => toggleAxesHelperVisibility(Boolean(value)),
      },
      {
        key: 'helpers.axesHelperSize',
        label: 'Axes helper size',
        min: 0.1,
        step: 0.1,
        onChange: (value) => createAxesHelper(Number(value)),
      },
      { type: 'separator' },
      {
        key: 'helpers.showGridHelper',
        label: 'Show grid helper',
        onChange: (value) => toggleGridHelperVisibility(Boolean(value)),
      },
      {
        key: 'helpers.gridSize',
        label: 'Grid size',
        min: 0.01,
        step: 0.01,
        onChange: recreateGridHelper,
      },
      {
        key: 'helpers.gridDivisionsSize',
        label: "Grid division's size",
        min: 0.01,
        step: 0.01,
        onChange: recreateGridHelper,
      },
      {
        key: 'helpers.gridColorCenterLine',
        label: "Grid's center line color",
        kind: 'color',
        onChange: recreateGridHelper,
      },
      {
        key: 'helpers.gridColorGrid',
        label: "Grid's color",
        kind: 'color',
        onChange: recreateGridHelper,
      },
      { type: 'separator' },
      {
        key: 'helpers.showPolarGridHelper',
        label: 'Show polar grid helper',
        onChange: (value) => togglePolarGridHelperVisibility(Boolean(value)),
      },
      {
        key: 'helpers.polarGridRadius',
        label: 'Polar grid radius',
        min: 0.01,
        step: 0.01,
        onChange: recreatePolarGridHelper,
      },
      {
        key: 'helpers.polarGridSectors',
        label: 'Polar grid sectors',
        min: 1,
        step: 1,
        onChange: recreatePolarGridHelper,
      },
      {
        key: 'helpers.polarGridRings',
        label: 'Polar grid rings',
        min: 0,
        step: 1,
        onChange: recreatePolarGridHelper,
      },
      {
        key: 'helpers.polarGridDivisions',
        label: 'Polar grid divisions',
        min: 0,
        step: 1,
        onChange: recreatePolarGridHelper,
      },
    ],
  };
};

/** "Undo / redo": its settings, which persist in the undo / redo module's own LS key. */
export const getUndoRedoFolder = (): Item => {
  const settings = getUndoRedoSettings();
  return {
    type: 'folder',
    id: 'undoRedo',
    title: 'Undo / redo',
    expanded: false,
    content: settings
      ? [
          {
            key: 'historySize',
            target: settings,
            label: 'History size (per scene)',
            min: 1,
            max: 500,
            step: 1,
            // Applied at the gesture's end only: shrinking trims (deletes) history, so a slider
            // drag passing through a small value must not already drop entries
            onChange: (value, e) => {
              if (e.last) setUndoRedoSettings({ historySize: Number(value) });
            },
          },
          {
            key: 'showToasts',
            target: settings,
            label: 'Show undo/redo toasts',
            onChange: (value) => setUndoRedoSettings({ showToasts: Boolean(value) }),
          },
        ]
      : [],
  };
};

/** The "File server" folder's rows (p342): `status` is what getDevFilesStatus said at the tab's
 * last mount (it changes only with a dev server restart, which reloads the page), `saving` what
 * the save history size means. */
const fileServerRows = { status: 'Checking…', saving: '' };

const describeSaveHistorySize = () => {
  const size = getDevFilesSaveHistorySize();
  if (size === -1) return 'On, keeps every entry';
  if (size === 0) return 'Off';
  return `On, keeps the latest ${size}`;
};

const DEV_FILES_UNAVAILABLE_TEXTS: Record<DevFilesUnavailableReason, string> = {
  NOT_DEBUG_ENV: 'Unavailable (not debug env)',
  NO_DEV_SERVER: 'Unavailable (no dev server)',
  UNREACHABLE: 'Unavailable (no answer)',
  NOT_ENABLED: 'Off (AEK_DEV_FILES)',
  NOT_LOCAL: 'Unavailable (LAN device)',
  NO_TOKEN: 'Unavailable (reload page)',
};

const describeDevFilesStatus = (status: DevFilesStatus) => {
  if (status.available) {
    return status.server.writesFromLAN ? 'On (LAN too)' : 'On (localhost only)';
  }
  return DEV_FILES_UNAVAILABLE_TEXTS[status.reason];
};

/** Asks the dev server for the File server folder's status row, and refreshes the tab with it:
 * the tab's `onOpen`, on every mount. */
export const refreshDevFilesRow = () => {
  getDevFilesStatus()
    .then(describeDevFilesStatus, () => 'Unavailable (failed to load)')
    .then((text) => {
      fileServerRows.status = text;
      updateDebuggerTab(DEBUG_TOOLS_TAB_ID);
    });
};

/** "File server": the debug tools writing files into the repo (p342, debug/DevFiles.ts). */
export const getFileServerFolder = (): Item => {
  fileServerRows.saving = describeSaveHistorySize();
  return {
    type: 'folder',
    id: 'fileServer',
    title: 'File server',
    expanded: false,
    content: [
      {
        key: 'status',
        target: fileServerRows,
        label: 'Dev files',
        readonly: true,
        interval: 0,
      },
      {
        // How many __saveData entries a save keeps per scene (-1 = all, 0 = saving off)
        key: 'devFiles.saveHistorySize',
        label: 'Save history size (per scene)',
        min: -1,
        step: 1,
        onChange: () => {
          fileServerRows.saving = describeSaveHistorySize();
          updateDebuggerTab(DEBUG_TOOLS_TAB_ID);
        },
      },
      {
        key: 'saving',
        target: fileServerRows,
        label: 'Saving into __saveData',
        readonly: true,
        interval: 0,
      },
    ],
  };
};

const getLogActionList = () => ({
  environmentVariables: [
    'ENV VARIABLES:********\n',
    `Current environment: ${getCurrentEnvironment()}`,
    getEnvs(),
    '**********************',
  ],
  renderer: [
    'RENDER OPTIONS:*******',
    getRendererOptions(),
    '**********************\n',
    'RENDERER:*******',
    getRenderer(),
    '**********************',
  ],
  rootScene: ['ROOT SCENE:***********', getRootScene(), '**********************'],
});

type LogAction = keyof ReturnType<typeof getLogActionList>;

const LOG_ACTION_TITLES: Record<LogAction, string> = {
  environmentVariables: 'Log the environment variables',
  renderer: 'Log the renderer',
  rootScene: 'Log the root scene',
};

/** "Logging actions": each one logs its objects to the console, read at the click. */
export const getLoggingFolder = (): Item => ({
  type: 'folder',
  id: 'logging',
  title: 'Logging actions',
  expanded: false,
  content: [
    {
      type: 'button',
      title: 'Log all',
      onClick: () => {
        const list = getLogActionList();
        const keys = Object.keys(list) as LogAction[];
        for (let i = 0; i < keys.length; i++) llog(...list[keys[i]]);
      },
    },
    ...(Object.keys(LOG_ACTION_TITLES) as LogAction[]).map(
      (key): Item => ({
        type: 'button',
        title: LOG_ACTION_TITLES[key],
        onClick: () => llog(...getLogActionList()[key]),
      })
    ),
  ],
});
