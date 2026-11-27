// The cameras' debugger state (`AEK_debugCams`, per scene) and the refresh of their tab and edit
// windows: what the Cameras tab, the edit window and the debug camera share.
import type { ECSWorld } from '../../ecs/ECS';
import { getECSWorld } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import {
  getKindWindowId,
  updateDraggableWindow,
  updateDraggableWindowsOfKind,
} from '../../../ui/overlays/windows/DraggableWindow';
import { getCurrentSceneId } from '../../scene/Scene';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { DEFAULT_DEBUG_CAM_PROPS } from './_dbg__DebugCamera';
import {
  LS_KEY,
  readCameraDebugData,
  type CamDebugLSData,
  type CamEntityDebugState,
  type CamSceneDebugState,
  type DebugCamLSProps,
} from './CameraDebugStorage';
import { updateOnScreenTools } from '../../../debug/OnScreenTools';

// The saved state and its read moved out for the property loader (p150): the debugger's modules
// keep importing them from here
export { LS_KEY };
export type { CamDebugLSData, CamEntityDebugState, CamSceneDebugState, DebugCamLSProps };

/**
 * Returns a camera's saved debugger state.
 * @param sceneId the scene whose data to read, defaults to the current scene
 */
export const loadCameraDebugData = (appId?: string, sceneId: string | null = getCurrentSceneId()) =>
  readCameraDebugData(appId, sceneId);

/** The edit windows' kind: one window per camera, keyed by its app id */
export const EDIT_CAMERA_WIN_ID = 'cameraEditorWindow';
export const CAMERAS_TAB_ID = 'camerasControls';

/**
 * Refreshes the Cameras tab and the open camera edit windows.
 * @param only ('LIST' | 'WINDOW') optional, refreshes only the list or only the windows
 * @param appId (string) optional, rebuilds only this camera's window (default: every open one)
 */
export const updateCamerasDebuggerGUI = (only?: 'LIST' | 'WINDOW', appId?: string) => {
  if (only !== 'WINDOW') updateDebuggerTab(CAMERAS_TAB_ID);
  if (only === 'LIST') return;
  if (appId) {
    updateDraggableWindow(getKindWindowId(EDIT_CAMERA_WIN_ID, appId));
  } else {
    updateDraggableWindowsOfKind(EDIT_CAMERA_WIN_ID);
  }
};

/** Sets a camera's helper visibility and its saved preference (edit window and list toggle). */
export const setCameraHelperVisible = (entityId: number, world: ECSWorld, show: boolean) => {
  const helperComp = world.getComponent(entityId, ComponentType.DEBUG_CAMERA_HELPER);
  if (!helperComp) return;
  helperComp.value.visible = show;
  if (show) {
    const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
    if (objComp) objComp.value.updateMatrixWorld(true);
    helperComp.value.update();
  }
  saveCameraToLS(entityId, 'helperVisible', show);
  updateOnScreenTools('SWITCH');
};

export const isDefaultDebugCamProps = (props: CamSceneDebugState['debugCam']) =>
  JSON.stringify(props) === JSON.stringify(DEFAULT_DEBUG_CAM_PROPS);

/** Scene entries always carry both `cams` and `debugCam` together; once neither
 * holds anything meaningful, drop the entry so `hasData` checks (which only look
 * at key/field presence) don't report stale data forever. */
export const pruneEmptyCamScene = (data: CamDebugLSData, sceneId: string) => {
  const scene = data[sceneId];
  if (!scene) return;
  const camsEmpty = !scene.cams || Object.keys(scene.cams).length === 0;
  if (camsEmpty && isDefaultDebugCamProps(scene.debugCam)) delete data[sceneId];
};

export const writeCamLSOrRemove = (data: CamDebugLSData) => {
  if (Object.keys(data).length === 0) lsRemoveItem(LS_KEY);
  else lsSetItem(LS_KEY, data);
};

export const getDebugCamProps = (sceneId: string) => {
  const saved = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  const keys = Object.keys(saved);
  if (!keys.includes(sceneId)) {
    saved[sceneId] = { debugCam: { ...DEFAULT_DEBUG_CAM_PROPS }, cams: {} };
  }
  return saved[sceneId].debugCam;
};

/** The saved keys that are the debugger's own preferences, not creation props (the save source
 * leaves them out and keeps them) */
export const CAM_DEBUGGER_ONLY_KEYS: ReadonlySet<string> = new Set([
  'helperVisible',
  '_lensSettingsOpen',
]);

// p150
/**
 * The saved values of a camera in the current scene that override its creation props: its
 * saved keys but the debugger's own preferences (the helper, the folder).
 */
export const getCameraOverriddenKeys = (appId?: string): string[] =>
  Object.keys(loadCameraDebugData(appId) ?? {}).filter((key) => !CAM_DEBUGGER_ONLY_KEYS.has(key));

export const saveCameraToLS = <K extends keyof CamEntityDebugState>(
  entityId: number,
  key: K,
  value: CamEntityDebugState[K]
) => {
  const sceneId = getCurrentSceneId();
  const appIdComp = getECSWorld().getComponent(entityId, ComponentType.APP_ID);
  if (!sceneId || !appIdComp?.isFixed) return;
  const currentData = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  if (!currentData[sceneId]) currentData[sceneId] = { cams: {}, debugCam: DEFAULT_DEBUG_CAM_PROPS };
  const appId = appIdComp.id;
  if (!currentData[sceneId].cams[appId]) {
    currentData[sceneId].cams[appId] = { helperVisible: false };
  }
  currentData[sceneId].cams[appId][key] = value;
  lsSetItem(LS_KEY, currentData);
};

export const clearCameraFromLS = (appId: string) => {
  const sceneId = getCurrentSceneId();
  const currentData = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  if (!sceneId || !currentData[sceneId]?.cams?.[appId]) return;
  delete currentData[sceneId].cams[appId];
  lsSetItem(LS_KEY, currentData);
};

export const saveDebugCameraToLS = (debugCamProps: Partial<DebugCamLSProps>) => {
  const sceneId = getCurrentSceneId();
  if (!sceneId) return;
  const currentData = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  if (!currentData[sceneId]) currentData[sceneId] = { cams: {}, debugCam: DEFAULT_DEBUG_CAM_PROPS };
  currentData[sceneId].debugCam = { ...currentData[sceneId].debugCam, ...debugCamProps };
  lsSetItem(LS_KEY, currentData);
};
