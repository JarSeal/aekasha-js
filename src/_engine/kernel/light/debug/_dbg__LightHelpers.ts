import * as THREE from 'three/webgpu';

import { ECSWorld } from '../../ecs/ECS';
import { ComponentType, type CoreComponentData } from '../../ecs/ECSCoreComponents';
import { ECSSystemStage } from '../../loop/SystemStages';
import { existsOrThrow } from '../../../utils/Assert';
import { getRootScene } from '../../scene/Scene';
import { getActiveCamera } from '../../camera/Camera';
import { isAnyLightHelperVisible } from '../Light';
import { markDebugHelper } from '../../../debug/Profiler';

/**
 * Removes a light's helper and its shadow camera helper from the scene and
 * disposes their internal geometries/materials.
 */
export const disposeLightHelpers = (
  helperComp: CoreComponentData[typeof ComponentType.DEBUG_LIGHT_HELPER]
) => {
  helperComp.value.removeFromParent();
  helperComp.value.dispose();
  helperComp.camHelper?.removeFromParent();
  helperComp.camHelper?.dispose();
};

ECSWorld.registerComponentHooks(ComponentType.DEBUG_LIGHT_HELPER, {
  onDeleteEntity: (entityId, world) => {
    const helper = world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER);
    if (helper) disposeLightHelpers(helper);
  },
});

/** Attaches a light entity's helpers, unless it has them (or isn't a three light). */
const attachMissingLightHelpers = (entityId: number, world: ECSWorld) => {
  if (world.hasComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER)) return;
  const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
  if (!(objComp?.value instanceof THREE.Light)) return;
  const rootScene = existsOrThrow(getRootScene(), 'No root scene');
  attachLightHelpers(entityId, objComp.value, world, rootScene);
};

// Static, so registered once here, not per world in the plugin below
ECSWorld.registerComponentHooks(ComponentType.TAG_IS_LIGHT, {
  onAddComponent: attachMissingLightHelpers,
});

/**
 * A directional light's drawn target line stops this far (metres) short of a target this close to
 * the active camera. A target at the camera (the sky's sun follows it) puts the line's end in the
 * eye, where the near plane clips it and each texel snap of the target swings it across the screen.
 */
const TARGET_LINE_EYE_GAP = 10;

const _cameraPosition = new THREE.Vector3();
const _targetPosition = new THREE.Vector3();

type LightHelperComponent = CoreComponentData[typeof ComponentType.DEBUG_LIGHT_HELPER];

/** Shows the shadow camera's helper only while the light's shadow shows, redrawing its frustum
 * when the projection changed (no buffer write otherwise). */
const syncShadowCameraHelper = (helper: LightHelperComponent, light: THREE.Light) => {
  const { camHelper, camProjection } = helper;
  if (!camHelper) return;
  const { shadow } = light as THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight;
  // Faded out (the sky's sun at night), nothing renders the shadow, so the helper would stay where
  // the last shadow render put it
  camHelper.visible = light.castShadow && shadow.intensity > 0;
  if (!camHelper.visible || !camProjection) return;
  if (camProjection.equals(camHelper.camera.projectionMatrix)) return;
  camProjection.copy(camHelper.camera.projectionMatrix);
  camHelper.update();
};

/**
 * Updates the visible helpers to their lights before the render (MAIN, after object3DSyncSystem
 * and the debug camera, so this frame's light and camera poses), also while the app loop is
 * paused. A shadow camera's pose is three's: it's set by the shadow render (never here, as
 * `shadow.updateMatrices` also writes the matrix the shadow map is sampled with), so its helper is
 * hidden while the shadow fades out. A pose written later in the frame (`lookAtSystem`, the
 * toolkit's `SunShadowFit`) shows a frame late, too little to see.
 */
const lightHelperSyncSystem = (w: ECSWorld) => {
  const storage = w.getStorage(ComponentType.DEBUG_LIGHT_HELPER);
  if (!storage.size) return;
  const camera = getActiveCamera();
  if (camera) _cameraPosition.setFromMatrixPosition(camera.matrixWorld);
  for (const [entityId, helper] of storage) {
    if (!helper.value.visible) continue;
    const objComp = w.getComponent(entityId, ComponentType.OBJECT3D);
    const transform = w.getComponent(entityId, ComponentType.TRANSFORM);
    if (!objComp || !transform) continue;

    // Bridge the disabled gap
    if (w.isDisabled(entityId)) {
      objComp.value.position.copy(transform.position);
      objComp.value.quaternion.copy(transform.quaternion);
      objComp.value.scale.copy(transform.scale);
    }
    objComp.value.updateMatrixWorld(true);
    helper.value.update();

    if (camera && helper.value instanceof THREE.DirectionalLightHelper) {
      _targetPosition.setFromMatrixPosition(helper.value.light.target.matrixWorld);
      if (_targetPosition.distanceTo(_cameraPosition) < TARGET_LINE_EYE_GAP) {
        const { targetLine } = helper.value;
        targetLine.scale.z = Math.max(0, targetLine.scale.z - TARGET_LINE_EYE_GAP);
      }
    }
    syncShadowCameraHelper(helper, objComp.value as THREE.Light);
  }
};

ECSWorld.registerPlugin((world) => {
  for (const [entityId] of world.getStorage(ComponentType.TAG_IS_LIGHT)) {
    attachMissingLightHelpers(entityId, world);
  }

  // After object3DSyncSystem and debugCameraSystem (order 0)
  world.addSystem(ECSSystemStage.MAIN, 'lightHelperSyncSystem', lightHelperSyncSystem, -1);
});

/**
 * Creates and attaches visual gizmos to light entities.
 * This file is dynamically imported only in Debug mode.
 */
export const attachLightHelpers = (
  entityId: number,
  light: THREE.Light,
  ecsWorld: ECSWorld,
  rootScene: THREE.Scene
) => {
  let helper:
    | THREE.PointLightHelper
    | THREE.DirectionalLightHelper
    | THREE.SpotLightHelper
    | undefined;
  // The lights with a helper, each with a shadow camera (an ambient or hemisphere light has none)
  let shadowCamera: THREE.Camera | undefined;

  if (light instanceof THREE.DirectionalLight) {
    helper = new THREE.DirectionalLightHelper(light, 5);
    shadowCamera = light.shadow.camera;
  } else if (light instanceof THREE.PointLight) {
    helper = new THREE.PointLightHelper(light, 1);
    shadowCamera = light.shadow.camera;
  } else if (light instanceof THREE.SpotLight) {
    helper = new THREE.SpotLightHelper(light);
    shadowCamera = light.shadow.camera;
  }

  if (helper) {
    const isEnabled = !ecsWorld.getComponent(entityId, ComponentType.DISABLED);
    const obj = ecsWorld.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    const isVisible = isEnabled && Boolean(obj?.visible);
    helper.visible = isVisible && isAnyLightHelperVisible();

    rootScene.add(markDebugHelper(helper));

    let camHelper: THREE.CameraHelper | undefined;
    let camProjection: THREE.Matrix4 | undefined;
    if (shadowCamera) {
      camHelper = new THREE.CameraHelper(shadowCamera);
      // The projection its constructor drew (a light is often sized after it's created)
      camProjection = shadowCamera.projectionMatrix.clone();
      rootScene.add(markDebugHelper(camHelper));
      if (!light.castShadow || !isEnabled) camHelper.visible = false;
    }

    ecsWorld.addComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER, {
      value: helper,
      camHelper,
      camProjection,
    });
  }
};
