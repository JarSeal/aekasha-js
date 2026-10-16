import * as THREE from 'three/webgpu';
import { ECSWorld, getECSWorld } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import { ECSSystemStage } from '../../loop/SystemStages';
import { markDebugHelper } from '../../../debug/Profiler';
import { getCurrentSceneId } from '../../scene/Scene';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
// Loaded before this module (the boot's kernel debug step loads the GUI first), so this static
// import changes no load order
import {
  LS_KEY,
  getDebugCamProps,
  updateCamerasDebuggerGUI,
  type CamDebugLSData,
} from './_dbg__CameraGUI';

// Register hook to clean up the helper when the camera entity dies
ECSWorld.registerComponentHooks(ComponentType.DEBUG_CAMERA_HELPER, {
  onDeleteEntity: (entityId, world) => {
    const helper = world.getComponent(entityId, ComponentType.DEBUG_CAMERA_HELPER);
    if (helper) {
      helper.value.removeFromParent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((helper.value as any).dispose) (helper.value as any).dispose();
    }
  },
});

ECSWorld.registerPlugin((world) => {
  world.addSystem(ECSSystemStage.LATE_MAIN, 'cameraHelperSyncSystem', (w) => {
    const storage = w.getStorage(ComponentType.DEBUG_CAMERA_HELPER);

    for (const [entityId, helper] of storage) {
      // Only sync if the helper is actually visible
      if (helper.value.visible) {
        const objComp = w.getComponent(entityId, ComponentType.OBJECT3D);
        const transform = w.getComponent(entityId, ComponentType.TRANSFORM);

        if (objComp && transform) {
          /**
           * If the camera is disabled, object3DSyncSystem ignored it.
           * We must manually sync the Three.js object position here
           * so the helper lines are drawn at the correct world coordinates.
           */
          if (w.isDisabled(entityId)) {
            objComp.value.position.copy(transform.position);
            objComp.value.quaternion.copy(transform.quaternion);
            objComp.value.scale.copy(transform.scale);
          }

          // Force matrix update and redraw the helper
          objComp.value.updateMatrixWorld(true);
          helper.value.update();
        }
      }
    }
  });
});

export const attachCameraHelpers = (
  entityId: number,
  camera: THREE.Camera,
  ecsWorld: ECSWorld,
  rootScene: THREE.Scene
) => {
  const helper = new THREE.CameraHelper(camera);

  // Hidden until the scene enter's sync (syncCameraHelpersFromLS) shows it
  helper.visible = false;
  rootScene.add(markDebugHelper(helper));

  ecsWorld.addComponent(entityId, ComponentType.DEBUG_CAMERA_HELPER, { value: helper });
};

/** Whether any camera's helper but the debug camera's shows, in the default world */
export const isAnyCameraHelperVisible = (): boolean => {
  const world = getECSWorld();
  const storage = world.getStorage(ComponentType.DEBUG_CAMERA_HELPER);
  for (const [entityId, helper] of storage) {
    if (world.hasComponent(entityId, ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA)) continue;
    if (helper.value.visible) return true;
  }
  return false;
};

/**
 * Shows or hides every camera's helper but the debug camera's (toggles them without `show`), and
 * saves the state of the cameras with a fixed app id for the current scene.
 */
export const toggleAllCameraHelpers = (show?: boolean) => {
  const world = getECSWorld();
  const sceneId = getCurrentSceneId();
  if (!sceneId) return;

  const storage = world.getStorage(ComponentType.TAG_IS_CAMERA);

  const currentData = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  if (!currentData[sceneId]) {
    currentData[sceneId] = { debugCam: getDebugCamProps(sceneId), cams: {} };
  }
  if (!currentData[sceneId].cams) currentData[sceneId].cams = {};

  const targetState = show !== undefined ? show : !isAnyCameraHelperVisible();

  for (const [entityId] of storage) {
    if (world.hasComponent(entityId, ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA)) continue;

    const helper = world.getComponent(entityId, ComponentType.DEBUG_CAMERA_HELPER);
    const appIdComp = world.getComponent(entityId, ComponentType.APP_ID);

    if (helper && appIdComp) {
      helper.value.visible = targetState;
      if (appIdComp.isFixed) {
        currentData[sceneId].cams[appIdComp.id] = {
          ...currentData[sceneId].cams[appIdComp.id],
          helperVisible: targetState,
        };
      }

      if (targetState) {
        const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
        if (objComp) objComp.value.updateMatrixWorld(true);
        helper.value.update();
      }
    }
  }

  lsSetItem(LS_KEY, currentData);

  updateCamerasDebuggerGUI();
};

/** Shows the helpers of the cameras with a fixed app id that the scene's saved state shows */
export const syncCameraHelpersFromLS = (sceneId: string, world: ECSWorld) => {
  const storage = world.getStorage(ComponentType.DEBUG_CAMERA_HELPER);
  const currentData = lsGetItem(LS_KEY, {}) as CamDebugLSData;

  for (const [entityId, helper] of storage) {
    if (world.hasComponent(entityId, ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA)) continue;

    const appIdComp = world.getComponent(entityId, ComponentType.APP_ID);
    if (appIdComp && appIdComp.isFixed) {
      const isVisible = Boolean(currentData[sceneId]?.cams[appIdComp.id]?.helperVisible);
      helper.value.visible = isVisible;

      // Force an immediate matrix update so the helper isn't collapsed on the first frame
      if (isVisible) {
        const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
        const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
        if (objComp && transform) {
          objComp.value.position.copy(transform.position);
          objComp.value.quaternion.copy(transform.quaternion);
          objComp.value.updateMatrixWorld(true);
          helper.value.update();
        }
      }
    }
  }
};
