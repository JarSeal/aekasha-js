// The Cameras tab: its list of the scene's cameras with their helper toggles, and the edit
// windows' kind. The module `Camera.ts` loads: the state and the edit window are in their own
// (`_dbg__CameraDebugState.ts`, `_dbg__CameraEditWindow.ts`).
import type { ECSWorld } from '../../ecs/ECS';
import { getECSWorld, getEntityIdByAppId } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import {
  createDebuggerTab,
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerListItem,
} from '../../../debug/DebuggerGUI';
import {
  closeDraggableWindow,
  getDraggableWindowsOfKind,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
  updateDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import { getCurrentSceneId } from '../../scene/Scene';
import { isCurrentlyLoading } from '../../scene/SceneLoader';
import { lsGetItem } from '../../../utils/LocalAndSessionStorage';
import {
  confirmClearScope,
  createClearListLSButton,
  createClearTabLSButton,
} from '../../../debug/_dbg__ClearLSButtons';
import { getActiveCameraId } from '../Camera';
import { DEFAULT_DEBUG_CAM_PROPS } from './_dbg__DebugCamera';
import {
  CAMERAS_TAB_ID,
  EDIT_CAMERA_WIN_ID,
  LS_KEY,
  isDefaultDebugCamProps,
  pruneEmptyCamScene,
  setCameraHelperVisible,
  updateCamerasDebuggerGUI,
  writeCamLSOrRemove,
  type CamDebugLSData,
  type CamSceneDebugState,
} from './_dbg__CameraDebugState';
import { createEditCameraContent } from './_dbg__CameraEditWindow';

// What `Camera.ts` reads of this module
export {
  getDebugCamProps,
  loadCameraDebugData,
  updateCamerasDebuggerGUI,
} from './_dbg__CameraDebugState';

/** Finds a list row's camera (the row id is the app id, or the entity id without one). */
const resolveCameraListItem = (itemId: string) => {
  const world = getECSWorld();
  const entityId =
    getEntityIdByAppId(itemId, world) ?? (/^\d+$/.test(itemId) ? Number(itemId) : undefined);
  return entityId !== undefined && world.isAlive(entityId) ? { world, entityId } : null;
};

/** List row click: opens the camera's window, brings it to the front, or closes it when on top. */
const openEditCameraWindow = (itemId: string) => {
  const target = resolveCameraListItem(itemId);
  if (!target) return;
  const appId = target.world.getComponent(target.entityId, ComponentType.APP_ID)?.id || itemId;
  toggleDraggableWindow({
    id: getKindWindowId(EDIT_CAMERA_WIN_ID, appId),
    kind: EDIT_CAMERA_WIN_ID,
    title: `Edit Camera: ${appId}`,
    isDebugWindow: true,
    data: { id: appId },
    closeOnSceneChange: true,
    saveToLS: true,
  });
};

/** List toggle: the same path as the edit window's Show helper field. */
const toggleCameraHelper = (itemId: string, next: boolean) => {
  const target = resolveCameraListItem(itemId);
  if (!target) return;
  setCameraHelperVisible(target.entityId, target.world, next);
  updateCamerasDebuggerGUI('WINDOW', itemId);
};

const getCamerasListData = (world: ECSWorld): DebuggerListItem[] => {
  const storage = world.getStorage(ComponentType.TAG_IS_CAMERA);
  const activeId = getActiveCameraId();
  const items: DebuggerListItem[] = [];
  for (const [entityId] of storage) {
    if (world.hasComponent(entityId, ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA)) continue;

    const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
    const debugData = world.getComponent(entityId, ComponentType.DEBUG_DATA);
    const isMainCam = world.getComponent(entityId, ComponentType.TAG_IS_MAIN_CAMERA);
    const helperComp = world.getComponent(entityId, ComponentType.DEBUG_CAMERA_HELPER);
    const itemId = appId || String(entityId);
    const badge = [activeId === entityId ? '*' : '', isMainCam ? '(Main)' : '']
      .filter(Boolean)
      .join(' ');
    items.push({
      itemId,
      title: debugData?.name || `[${itemId}]`,
      titlePlaceholder: !debugData?.name,
      subTitle: `[${appId}] [${entityId}]`,
      ...(badge ? { badge } : {}),
      toggleValues: [helperComp ? helperComp.value.visible : null],
    });
  }
  return items;
};

/** The tab's clear-LS buttons: the debug camera's saved states, and the cameras' saved values */
const createCamerasHeaderButtons = () => {
  /** Clears `clear`'s part of the scenes that have one, asking which when there are several */
  const clearScenes = (
    hasPart: (scene: CamSceneDebugState) => boolean,
    clear: (scene: CamSceneDebugState) => void
  ) => {
    const current = lsGetItem(LS_KEY, {}) as CamDebugLSData;
    const sceneIdsWithData = Object.keys(current).filter((id) => hasPart(current[id]));
    const applyClear = (sceneIds: string[]) => {
      for (const sceneId of sceneIds) {
        clear(current[sceneId]);
        pruneEmptyCamScene(current, sceneId);
      }
      writeCamLSOrRemove(current);
    };
    if (sceneIdsWithData.length > 1) {
      confirmClearScope({
        onClearAllScenes: () => applyClear(sceneIdsWithData),
        onClearThisScene: () => {
          const sceneId = getCurrentSceneId();
          if (sceneId) applyClear([sceneId]);
        },
      });
    } else {
      applyClear(sceneIdsWithData);
    }
  };
  const hasDebugCam = (scene: CamSceneDebugState) => !isDefaultDebugCamProps(scene.debugCam);
  const hasCams = (scene: CamSceneDebugState) =>
    Boolean(scene.cams) && Object.keys(scene.cams).length > 0;
  const readScenes = () => Object.values(lsGetItem(LS_KEY, {}) as CamDebugLSData);
  return [
    createClearTabLSButton({
      hasData: () => readScenes().some(hasDebugCam),
      watchKey: LS_KEY,
      onClear: () =>
        clearScenes(hasDebugCam, (scene) => (scene.debugCam = { ...DEFAULT_DEBUG_CAM_PROPS })),
    }),
    createClearListLSButton({
      hasData: () => readScenes().some(hasCams),
      watchKey: LS_KEY,
      onClear: () => clearScenes(hasCams, (scene) => (scene.cams = {})),
    }),
  ];
};

let cameraDebuggerGUIInitiated = false;
export const initCameraDebuggerGUI = () => {
  if (cameraDebuggerGUIInitiated) return;
  createDebuggerTab({
    id: CAMERAS_TAB_ID,
    title: 'Camera Controls',
    icon: 'camera',
    // A refresh re-reads what it shows: kept open on a scene change (p806 D5)
    keepOnSceneChange: true,
    // The tab's LS data is scene-scoped (module-owned), so both clear buttons are custom
    clearLSButton: false,
    headerButtons: createCamerasHeaderButtons,
    content: () => [
      debuggerListCMP({
        id: 'cameras',
        label: 'Cameras',
        data: () => getCamerasListData(getECSWorld()),
        selectedItemId: () =>
          getDraggableWindowsOfKind(EDIT_CAMERA_WIN_ID).map((win) => String(win.data?.id)),
        perItemConfig: {
          onClick: openEditCameraWindow,
          toggles: [{ icon: 'cameraReels', title: 'Show helper', fn: toggleCameraHelper }],
        },
      }),
    ],
  });
  cameraDebuggerGUIInitiated = true;
};

/**
 * Called from a camera's delete hook: refreshes the list and closes the camera's edit window
 * (checked a microtask later, like the lights' `_onLightDeleted`: rebuilt when the camera is back
 * under the same app id). A scene change leaves the windows to the scene change handling.
 */
export const _onCameraDeleted = (entityId: number, world: ECSWorld) => {
  updateCamerasDebuggerGUI('LIST');
  const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
  if (!appId || world !== getECSWorld() || isCurrentlyLoading()) return;
  queueMicrotask(() => {
    const winId = getKindWindowId(EDIT_CAMERA_WIN_ID, appId);
    if (resolveCameraListItem(appId)) {
      updateDraggableWindow(winId);
    } else {
      closeDraggableWindow(winId);
    }
  });
};

registerDraggableWindowKind(EDIT_CAMERA_WIN_ID, {
  content: createEditCameraContent,
  onClose: () => updateDebuggerTab(CAMERAS_TAB_ID),
  // Kept open on a scene change when the next scene has a camera with the same appId
  sceneTargetResolver: (data) => {
    const entityId = getEntityIdByAppId(String(data?.id));
    return Boolean(entityId && getECSWorld().isAlive(entityId));
  },
});
