// The Debug tools tab's "Debug camera" folder (p806 D11: out of _dbg__DebugTools.ts): the debug
// camera's pose and lens, applied to the camera and saved per scene, and synced back from the
// viewport while the camera is dragged.
import type * as THREE from 'three/webgpu';
import { updateDebuggerTab, type DebuggerPaneItem } from './DebuggerGUI';
import { DEBUG_CAMERA_ID, type DebugToolsState } from './DebugTools';
import { getECSWorld, getEntityIdByAppId } from '../kernel/ecs/ECS';
import { ComponentType } from '../kernel/ecs/ECSCoreComponents';
import {
  getDebugCamProps,
  saveDebugCameraToLS,
  type DebugCamLSProps,
} from '../kernel/camera/debug/_dbg__CameraDebugState';
import { DEFAULT_DEBUG_CAM_PROPS } from '../kernel/camera/debug/_dbg__DebugCamera';
import { DEBUG_TOOLS_TAB_ID } from './_dbg__DebugToolsState';

type Vec3 = { x: number; y: number; z: number };

/** The folder's values, synced from the viewport (see refreshDebugCameraFolderFromViewport). */
let debugCamPanelProxy: DebugCamLSProps | null = null;

const getDebugCamera = () => {
  const entityId = getEntityIdByAppId(DEBUG_CAMERA_ID);
  if (entityId === undefined) return null;
  const world = getECSWorld();
  return {
    obj: world.getComponent(entityId, ComponentType.OBJECT3D)?.value as
      | THREE.PerspectiveCamera
      | undefined,
    controls: world.getComponent(entityId, ComponentType.ORBIT_CONTROLS)?.controls,
    settings: world.getComponent(entityId, ComponentType.CAMERA_SETTINGS),
  };
};

const applyDebugCameraProps = (partial: Partial<DebugCamLSProps>) => {
  const debugCamera = getDebugCamera();
  if (!debugCamera) return;
  const { obj, controls, settings } = debugCamera;

  if (partial.position && obj) {
    obj.position.set(partial.position.x, partial.position.y, partial.position.z);
  }
  if (partial.target && controls) {
    controls.target.set(partial.target.x, partial.target.y, partial.target.z);
  }
  const hasLensChange =
    partial.fov !== undefined ||
    partial.near !== undefined ||
    partial.far !== undefined ||
    partial.zoom !== undefined;
  if (obj && hasLensChange) {
    if (partial.fov !== undefined) obj.fov = partial.fov;
    if (partial.near !== undefined) obj.near = partial.near;
    if (partial.far !== undefined) obj.far = partial.far;
    if (partial.zoom !== undefined) obj.zoom = partial.zoom;
    obj.updateProjectionMatrix();
  }
  if (settings && hasLensChange) {
    if (partial.fov !== undefined) settings.fov = partial.fov;
    if (partial.near !== undefined) settings.near = partial.near;
    if (partial.far !== undefined) settings.far = partial.far;
    if (partial.zoom !== undefined) settings.zoom = partial.zoom;
  }
  controls?.update();
  saveDebugCameraToLS(partial);
};

/** Live-refreshes the folder from the viewport (the debug camera dragged with OrbitControls):
 * debugCameraSystem calls it only on frames where OrbitControls reported a change, while the tab
 * is mounted. The tab refresh never fires onChange, so writing the live camera back into the
 * folder can't loop back into applyDebugCameraProps (which would re-dispatch OrbitControls'
 * change). */
export const refreshDebugCameraFolderFromViewport = () => {
  const debugCamera = getDebugCamera();
  const proxy = debugCamPanelProxy;
  if (!debugCamera?.obj || !debugCamera.controls || !proxy) return;
  const { obj, controls } = debugCamera;
  proxy.position = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
  proxy.target = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
  proxy.fov = obj.fov;
  proxy.near = obj.near;
  proxy.far = obj.far;
  proxy.zoom = obj.zoom;
  updateDebuggerTab(DEBUG_TOOLS_TAB_ID);
};

/**
 * The "Debug camera" folder for scene `sceneId`: the position and target apply at a gesture's end,
 * the lens fields on every write, as the Cameras tab's own lens fields.
 */
export const getDebugCameraFolder = (sceneId: string): DebuggerPaneItem<DebugToolsState> => {
  const camProxy: DebugCamLSProps = { ...getDebugCamProps(sceneId) };
  debugCamPanelProxy = camProxy;
  return {
    type: 'folder',
    id: 'debugCamera',
    title: 'Debug camera',
    expanded: false,
    content: [
      {
        key: 'position',
        target: camProxy,
        label: 'Position',
        onChange: (value, e) => {
          if (e.last) applyDebugCameraProps({ position: { ...(value as Vec3) } });
        },
      },
      {
        key: 'target',
        target: camProxy,
        label: 'Target',
        onChange: (value, e) => {
          if (e.last) applyDebugCameraProps({ target: { ...(value as Vec3) } });
        },
      },
      {
        key: 'fov',
        target: camProxy,
        label: 'FOV',
        min: 1,
        max: 170,
        step: 1,
        onChange: (value) => applyDebugCameraProps({ fov: Number(value) }),
      },
      {
        key: 'near',
        target: camProxy,
        label: 'Near',
        min: 0.001,
        step: 0.001,
        onChange: (value) => applyDebugCameraProps({ near: Number(value) }),
      },
      {
        key: 'far',
        target: camProxy,
        label: 'Far',
        min: 1,
        step: 1,
        onChange: (value) => applyDebugCameraProps({ far: Number(value) }),
      },
      {
        key: 'zoom',
        target: camProxy,
        label: 'Zoom',
        min: 0.01,
        step: 0.01,
        onChange: (value) => applyDebugCameraProps({ zoom: Number(value) }),
      },
      {
        type: 'button',
        title: 'Reset to default',
        onClick: () => {
          camProxy.position = { ...DEFAULT_DEBUG_CAM_PROPS.position };
          camProxy.target = { ...DEFAULT_DEBUG_CAM_PROPS.target };
          applyDebugCameraProps({
            position: { ...DEFAULT_DEBUG_CAM_PROPS.position },
            target: { ...DEFAULT_DEBUG_CAM_PROPS.target },
          });
          updateDebuggerTab(DEBUG_TOOLS_TAB_ID);
        },
      },
    ],
  };
};
