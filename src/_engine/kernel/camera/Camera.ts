import * as THREE from 'three/webgpu';
import {
  DEFAULT_ECS_WORLD_ID,
  ECSWorld,
  getAllECSWorlds,
  getECSWorld,
  getEntityIdByAppId,
} from '../ecs/ECS';
import { getCurrentSceneId, getRootScene, registerOnAllSceneEnters } from '../scene/Scene';
import type { DebugModuleRef } from '../config/DebugModules';
import { loadDebugModule, loadDebugModuleAsync, useDebug } from '../config/DebugModules';
import { getCanvasSize } from '../render/CanvasSize';
import { IS_DEBUG_ENV } from '../config/Config';
import type { CoreComponentData } from '../ecs/ECSCoreComponents';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { addResizer } from '../loop/MainLoop';
import { inspectEntity, lookAtPoint } from '../ecs/ECSHelpers';
import { loadPersistentProps } from '../scene/PropertyLoader';
import type { CameraProps } from '../../schemas/CameraSchema';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import { existsOrThrow } from '../../utils/Assert';
import { DEBUG_CAMERA_ID } from '../../debug/DebugTools';
import { updateOnScreenTools } from '../../debug/OnScreenTools';
import { lerror } from '../../utils/Logger';
import type { FeatureContext } from '../init/Features';

// --- STATE ---
let activeCameraEntityId: number | null = null;
let activeCameraObject: THREE.Camera | null = null;
let debugCameraEntityId: number | null = null;
// The default world's main camera (p200): the one entity with TAG_IS_MAIN_CAMERA, kept by
// setMainCamera (the tag's only add site) and cleared by the tag's hooks, so the per-frame
// getMainCamera() needs no query
let mainCameraEntityId: number | null = null;

type DebugCameraModule = typeof import('./debug/_dbg__DebugCamera');
type CameraHelpersModule = typeof import('./debug/_dbg__CameraHelpers');

/**
 * The cameras' debug GUI module.
 * @internal
 */
export type CameraGUIModule = typeof import('./debug/_dbg__CameraGUI');

/**
 * The cameras' debug GUI, loaded by the boot's debug step (debug env only; `null` otherwise).
 * @internal
 */
export let cameraDebugGUI: DebugModuleRef<CameraGUIModule> | null = null;

let debugHelpers: DebugModuleRef<CameraHelpersModule> | null = null;
let debugCamera: DebugModuleRef<DebugCameraModule> | null = null;

const _m1 = new THREE.Matrix4();
const _v1 = new THREE.Vector3();

/**
 * Installs the cameras (the kernel, p607): a camera entity's deletion disposes its camera, the
 * main camera cache follows its tag, and every camera's aspect follows the canvas.
 * @internal
 */
export const installCameras = (ctx: FeatureContext) => {
  addResizer('cameraAspectResizer', updateAllCameraAspectRatios);

  ctx.registerComponentHooks(ComponentType.TAG_IS_CAMERA, {
    onDeleteEntity: (entityId, world) => disposeCamera(entityId, world),
  });

  // The main camera cache follows the tag in the default world (other worlds have their own
  // entity ids: the same number there is another entity)
  const clearMainCamera = (entityId: number, world: ECSWorld) => {
    if (world.id === DEFAULT_ECS_WORLD_ID && entityId === mainCameraEntityId) {
      mainCameraEntityId = null;
    }
  };
  ctx.registerComponentHooks(ComponentType.TAG_IS_MAIN_CAMERA, {
    onRemoveComponent: clearMainCamera,
    onDeleteEntity: clearMainCamera,
  });
};

/**
 * Debug env: loads the cameras' debug GUI, keeps its list current, and syncs the camera helpers
 * from LS on every scene enter. The boot calls it before the features install.
 * @internal
 */
export const registerCameraDebugGUI = async () => {
  // Awaited, so the debug camera's MAIN system (its module comes with the GUI's) registers in a
  // fixed place: before the light helpers' and the line time system (a load race before p607)
  cameraDebugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__CameraGUI'));
  if (!cameraDebugGUI) return;

  registerOnAllSceneEnters('cameraDebugSync', () => {
    const sceneId = getCurrentSceneId();
    if (sceneId) {
      useDebug(debugHelpers)?.syncCameraHelpersFromLS(sceneId, getECSWorld());
    }
  });
  // After the 3D symbols' hook on the tag, which attaches the symbol the list shows
  ECSWorld.registerComponentHooks(ComponentType.TAG_IS_CAMERA, {
    onAddComponent: () => useDebug(cameraDebugGUI)?.updateCamerasDebuggerGUI('LIST'),
  });
};

/** Matches the debug GUI's fov slider bounds — keeps computed FOV out of degenerate territory. */
const clampFov = (fov: number) => THREE.MathUtils.clamp(fov, 1, 170);

/**
 * "Hor+" aspect compensation: `baseFovDeg` is the vertical FOV authored for `referenceAspect`.
 * Returns the vertical FOV that keeps the *horizontal* FOV constant at `currentAspect` instead —
 * widens on narrow/portrait screens, narrows on wide/desktop screens.
 * @internal
 */
export const computeResponsiveFov = (
  baseFovDeg: number,
  referenceAspect: number,
  currentAspect: number
): number => {
  if (!Number.isFinite(referenceAspect) || referenceAspect <= 0) referenceAspect = 16 / 9;
  if (!Number.isFinite(currentAspect) || currentAspect <= 0) return clampFov(baseFovDeg);

  const halfVFovRef = THREE.MathUtils.degToRad(baseFovDeg) / 2;
  const halfHFovAtRef = Math.atan(Math.tan(halfVFovRef) * referenceAspect);
  const newHalfVFov = Math.atan(Math.tan(halfHFovAtRef) / currentAspect);
  return clampFov(THREE.MathUtils.radToDeg(newHalfVFov * 2));
};

/**
 * Orthographic equivalent of {@link computeResponsiveFov}: `baseFrustumSize` is the vertical
 * world-space extent authored for `referenceAspect`. Returns the vertical extent that keeps the
 * horizontal world-space width constant at `currentAspect` instead.
 * @internal
 */
export const computeResponsiveFrustumSize = (
  baseFrustumSize: number,
  referenceAspect: number,
  currentAspect: number
): number => {
  if (!Number.isFinite(referenceAspect) || referenceAspect <= 0) referenceAspect = 16 / 9;
  if (!Number.isFinite(currentAspect) || currentAspect <= 0) return baseFrustumSize;

  const targetWidth = baseFrustumSize * referenceAspect;
  return targetWidth / currentAspect;
};

/**
 * Applies `aspect` to a camera's projection, deriving the effective fov/frustumSize from
 * `settings.responsiveAspect` when enabled. Single source of truth shared by camera creation
 * and the window-resize system — `settings.fov`/`settings.frustumSize` are always treated as
 * the immutable authored base value; only the live THREE.js object is ever mutated here.
 * @internal
 */
export const applyCameraProjection = (
  cam: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  settings: CoreComponentData[typeof ComponentType.CAMERA_SETTINGS],
  aspect: number
) => {
  if (settings.type === 'PERSPECTIVE' && cam instanceof THREE.PerspectiveCamera) {
    cam.aspect = aspect;
    cam.fov = settings.responsiveAspect
      ? computeResponsiveFov(settings.fov, settings.referenceAspect, aspect)
      : settings.fov;
    cam.updateProjectionMatrix();
  } else if (settings.type === 'ORTHOGRAPHIC' && cam instanceof THREE.OrthographicCamera) {
    const s = settings.responsiveAspect
      ? computeResponsiveFrustumSize(settings.frustumSize, settings.referenceAspect, aspect)
      : settings.frustumSize;
    cam.left = (-s * aspect) / 2;
    cam.right = (s * aspect) / 2;
    cam.top = s / 2;
    cam.bottom = -s / 2;
    cam.updateProjectionMatrix();
  }
};

/**
 * Creates a camera entity: a perspective or orthographic camera (in the root scene unless
 * `entityOpts.doNotAddToScene`) with an `OBJECT3D`, its `CAMERA_SETTINGS` and a transform. Its
 * aspect follows the canvas (`responsiveAspect` keeps the horizontal field of view instead of
 * the vertical one). In the default world, a camera with `active: true`, or the first camera
 * while none is active, becomes the main camera and the one the scene renders through; in
 * another world, `active: true` only tags it that world's main camera.
 * @param camProps the camera's props (a `*.camera.json`'s `cameraProps`); in the debug env with
 *   the debugger's saved overrides for its app id
 * @param ecsWorld default: the default world
 * @returns the camera's entity id
 * @example
 * ```ts
 * import { createCameraEntity } from 'aekasha';
 *
 * createCameraEntity(
 *   { type: 'PERSPECTIVE', fov: 60, position: { x: 0, y: 4, z: 10 }, lookAtPoint: { x: 0, y: 0, z: 0 } },
 *   { appId: 'mainCamera' }
 * );
 * ```
 */
export const createCameraEntity = (
  camProps: CameraProps,
  entityOpts?: CoreEntityOpts,
  ecsWorld?: ECSWorld
): number => {
  const world = ecsWorld || getECSWorld();
  const rootScene = existsOrThrow(getRootScene(), 'No Scene for Camera.');
  const { aspect } = getCanvasSize();

  // The props with the debugger's saved overrides (debug env)
  const appId = camProps.appId || entityOpts?.appId;
  const props = loadPersistentProps<CameraProps>({ ...camProps, appId }, 'CAMERA');

  const settings: CoreComponentData[typeof ComponentType.CAMERA_SETTINGS] = {
    type: props.type,
    fov: props.type === 'PERSPECTIVE' ? props.fov ?? 45 : 0,
    near: props.near ?? 0.1,
    far: props.far ?? 2000,
    zoom: props.zoom ?? 1,
    frustumSize: props.type === 'ORTHOGRAPHIC' ? props.frustumSize ?? 10 : 0,
    responsiveAspect: props.responsiveAspect ?? false,
    referenceAspect: props.referenceAspect ?? 16 / 9,
  };

  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;

  if (settings.type === 'PERSPECTIVE') {
    camera = new THREE.PerspectiveCamera(settings.fov, aspect, settings.near, settings.far);
  } else {
    // Placeholder bounds — applyCameraProjection() below sets the real ones before first render.
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, settings.near, settings.far);
  }
  // Before the projection, which reads it
  camera.zoom = settings.zoom;
  applyCameraProjection(camera, settings, aspect);

  if (!entityOpts?.doNotAddToScene) {
    rootScene.add(camera);
  }

  const entityId = world.createEntity(entityOpts);
  camera.userData.entityId = entityId;

  world.addComponent(entityId, ComponentType.TAG_IS_CAMERA, true);
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: camera, _lastVersion: -1 });
  world.addComponent(entityId, ComponentType.CAMERA_SETTINGS, settings);

  if (props.active) {
    setMainCamera(world, entityId);
  } else if (world.id === DEFAULT_ECS_WORLD_ID && activeCameraEntityId === null) {
    // Route through setMainCamera (not setActiveCamera directly) so this camera is
    // also tagged TAG_IS_MAIN_CAMERA — otherwise a scene whose designated camera relies
    // on "first camera created" rather than an explicit `active: true` would never get
    // that tag, and getMainCamera() below would find nothing for it. The active camera is
    // the default world's, so another world's first camera isn't made main.
    setMainCamera(world, entityId);
  }

  const pos =
    'position' in props && props.position
      ? props.position
      : { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  camera.position.set(pos.x, pos.y, pos.z);

  if ('position' in props && props.position) {
    world.setTransform(entityId, { pos });
  }

  if ('lookAtPoint' in props && props.lookAtPoint) {
    lookAtPoint(entityId, props.lookAtPoint, world);
  }

  useDebug(debugHelpers)?.attachCameraHelpers(entityId, camera, world, rootScene);

  return entityId;
};

/**
 * Makes a default world camera entity the one the scene renders through, without moving the main
 * camera tag (the debug camera's toggle uses it). Game code calls {@link setMainCamera}.
 * @internal
 * @throws for an entity without a camera
 */
export const setActiveCamera = (entityId: number) => {
  const world = getECSWorld();
  const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
  if (objComp && objComp.value instanceof THREE.Camera) {
    activeCameraEntityId = entityId;
    activeCameraObject = objComp.value; // Cache the direct pointer
    // Keep the debug drawer's camera tab and the on-screen tools' camera dropdown in sync —
    // both only ever refreshed reactively from their own button handlers before, so a switch
    // triggered from application code (e.g. a scene's own camera-toggle key binding) never
    // reached them.
    useDebug(cameraDebugGUI)?.updateCamerasDebuggerGUI('LIST');
    updateOnScreenTools('SWITCH');
    return;
  }
  const msg = `Could not find camera entity with id ${entityId} in setActiveCamera.`;
  lerror(msg);
  throw new Error(msg);
};

/**
 * Returns the entity id of the camera the scene renders through: the main camera, or the debug
 * camera while it's on (debug env).
 * @returns the entity id (the default world's), or `null` before any camera is active
 * @example
 * ```ts
 * import { getActiveCameraId, getECSWorld } from 'aekasha';
 *
 * const cameraId = getActiveCameraId();
 * const transform = cameraId !== null ? getECSWorld().getTransform(cameraId) : undefined;
 * ```
 */
export const getActiveCameraId = () => activeCameraEntityId;

/**
 * Returns the camera the scene renders through: the main camera, or the debug camera while it's
 * on (debug env).
 * @returns the camera, or `undefined` before any camera is active
 * @example
 * ```ts
 * import { getActiveCamera } from 'aekasha';
 * import { createViewport } from 'aekasha/viewports';
 *
 * // A resolver, called every frame: the viewport follows whichever camera is active
 * createViewport({
 *   id: 'pip',
 *   scene: pipScene,
 *   camera: getActiveCamera,
 *   anchor: 'BOTTOM_RIGHT',
 * });
 * ```
 */
export const getActiveCamera = (): THREE.Camera | undefined => activeCameraObject ?? undefined;

/**
 * Returns the real gameplay camera's Three.js object, regardless of whether the debug
 * fly-camera is currently active. Unlike `getActiveCamera()` (which resolves to the debug
 * camera while it's toggled on — required for `renderScene()` to render through it), this
 * always resolves via `TAG_IS_MAIN_CAMERA`, which `toggleDebugCamera` never touches.
 * Use this, not `getActiveCamera()`, for any system whose behavior must track the actual
 * gameplay camera's point of view (e.g. light frustum culling).
 * @internal
 */
export const getMainCamera = (): THREE.Camera | undefined => {
  if (mainCameraEntityId === null) return undefined;
  return getECSWorld().getComponent(mainCameraEntityId, ComponentType.OBJECT3D)?.value as
    | THREE.Camera
    | undefined;
};

/**
 * A camera entity's deletion hook: detaches its camera, and clears the active camera when it was
 * the default world's active one.
 * @internal
 */
export const disposeCamera = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();

  // The active camera is the default world's: the same id in another world is another entity
  if (world.id === DEFAULT_ECS_WORLD_ID && activeCameraEntityId === entityId) {
    activeCameraEntityId = null;
    activeCameraObject = null;
  }

  // A camera holds no GPU resources: detaching it is all
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value.removeFromParent();

  useDebug(cameraDebugGUI)?._onCameraDeleted(entityId, world);
};

/**
 * Turns a camera entity (or any entity with a transform) to face a point, once: its transform's
 * rotation, committed. A no-op for an entity without a transform.
 * @param ecsWorld default: the default world
 * @example
 * ```ts
 * import { cameraLookAtPoint, getActiveCameraId } from 'aekasha';
 *
 * const cameraId = getActiveCameraId();
 * if (cameraId !== null) cameraLookAtPoint(cameraId, { x: 0, y: 1, z: 0 });
 * ```
 */
export const cameraLookAtPoint = (
  entityId: number,
  point: { x: number; y: number; z: number },
  ecsWorld?: ECSWorld
) => {
  const world = ecsWorld || getECSWorld();
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (!transform) return;
  _v1.set(point.x, point.y, point.z);
  _m1.lookAt(transform.position, _v1, THREE.Object3D.DEFAULT_UP);
  transform.quaternion.setFromRotationMatrix(_m1);
  transform.setDirty();
  world.commitTransform(entityId, transform);
};

/**
 * Updates all cameras, in every ECS world, to match the canvas's aspect ratio.
 * @internal
 */
export const updateAllCameraAspectRatios = () => {
  const { aspect } = getCanvasSize();

  for (const world of getAllECSWorlds()) {
    const storage = world.getStorage(ComponentType.CAMERA_SETTINGS);

    for (const [entityId, settings] of storage) {
      const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
      if (!objComp) continue;

      applyCameraProjection(
        objComp.value as THREE.PerspectiveCamera | THREE.OrthographicCamera,
        settings,
        aspect
      );
    }
  }
};

/**
 * The default world's cameras with an app id but the debug camera's, for the debugger's lists.
 * @internal
 * @returns each camera's app id, display name (its debug name, or the app id) and entity id
 */
export const getAllCamerasAsArray = () => {
  const world = getECSWorld();
  const storage = world.getStorage(ComponentType.TAG_IS_CAMERA);
  const result: { appId: string; name: string; entityId: number }[] = [];

  for (const [entityId] of storage) {
    // Exclude the debug camera from the list
    if (world.hasComponent(entityId, ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA)) continue;

    const appIdComp = world.getComponent(entityId, ComponentType.APP_ID);
    const debugData = world.getComponent(entityId, ComponentType.DEBUG_DATA);

    if (appIdComp) {
      // Use the Human Readable name, or fallback to the formatted appId
      const name = debugData?.name ? debugData.name : `[appId: ${appIdComp.id}]`;

      result.push({
        appId: appIdComp.id,
        name,
        entityId,
      });
    }
  }
  return result;
};

/**
 * Returns the main camera's app id (the default world's), for the debugger's lists.
 * @internal
 * @returns the app id, or `null` without a main camera
 */
export const getMainAppCameraId = () => {
  if (mainCameraEntityId === null) return null;
  return getECSWorld().getComponent(mainCameraEntityId, ComponentType.APP_ID)?.id || null;
};

/**
 * Makes a camera entity its world's main camera (`TAG_IS_MAIN_CAMERA`, moved from the previous
 * one). In the default world it's also the camera the scene renders through, unless the debug
 * camera is on (then the switch shows when it's turned off); in another world only the tag moves.
 * @param world the camera entity's world
 * @param newMainId a camera entity
 * @example
 * ```ts
 * import { getECSWorld, getEntityIdByAppId, setMainCamera } from 'aekasha';
 *
 * const topDownId = getEntityIdByAppId('topDownCamera');
 * if (topDownId !== undefined) setMainCamera(getECSWorld(), topDownId);
 * ```
 */
export const setMainCamera = (world: ECSWorld, newMainId: number) => {
  const mainCams = world.getEntitiesWith(ComponentType.TAG_IS_MAIN_CAMERA);
  for (const oldId of mainCams) {
    world.removeComponent(oldId, ComponentType.TAG_IS_MAIN_CAMERA);
  }
  world.addComponent(newMainId, ComponentType.TAG_IS_MAIN_CAMERA, true);
  // Another world's main camera is only its tag: the active camera is the default world's
  if (world.id !== DEFAULT_ECS_WORLD_ID) return;
  mainCameraEntityId = newMainId;
  if (!isDebugCameraActive()) {
    setActiveCamera(newMainId);
  } else {
    // setActiveCamera (and its own debug-UI refresh) is skipped while the debug fly-camera is
    // active — the render camera doesn't change — but the main-camera tag still moved, so the
    // camera tab/on-screen tools must refresh independently to reflect that.
    useDebug(cameraDebugGUI)?.updateCamerasDebuggerGUI('LIST');
    updateOnScreenTools('SWITCH');
  }
};

/**
 * Makes the default world's camera with this app id the main camera (and the active one, unless
 * the debug camera is), and saves it as the scene's latest camera for the debug camera. An id
 * without a camera does nothing.
 * @internal
 */
export const setCurrentCamera = (appId: string) => {
  const world = getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  if (entityId === undefined || !world.hasComponent(entityId, ComponentType.TAG_IS_CAMERA)) return;
  setMainCamera(world, entityId);
  useDebug(debugCamera)?.setLatestAppCameraId(appId);
};

// --- DEBUG CAMERA ---

/**
 * Debug env: loads the camera helpers and the debug camera's module, creates the debug orbit
 * camera (persistent), and on every scene enter restores its saved state, the scene's latest
 * camera and the helpers. The boot's kernel debug step calls it once.
 * @internal
 */
export const initDebugCamera = async (world: ECSWorld) => {
  if (debugHelpers) return;

  const camImporter = () => import('./debug/_dbg__DebugCamera');
  // Awaited: its LATE_MAIN system registers in a fixed place (after the light helpers')
  debugHelpers = await loadDebugModuleAsync(() => import('./debug/_dbg__CameraHelpers'));
  debugCamera = loadDebugModule(camImporter);

  if (IS_DEBUG_ENV) {
    registerOnAllSceneEnters('debugCamEnterSceneLogic', () => {
      useDebug(cameraDebugGUI)?.initCameraDebuggerGUI();

      const newSceneId = getCurrentSceneId();
      const debugCamModule = useDebug(debugCamera);
      if (!debugCamModule || !newSceneId) return;

      // If controls aren't attached yet (e.g. initial boot), attach them now.
      // This ensures the Canvas is ready and the correct Scene ID is used.
      if (
        debugCameraEntityId !== null &&
        !world.hasComponent(debugCameraEntityId, ComponentType.ORBIT_CONTROLS)
      ) {
        debugCamModule.attachOrbitControls(debugCameraEntityId, world, newSceneId);
      }

      debugCamModule.debugCamSceneChange(newSceneId, world);
      const props = useDebug(cameraDebugGUI)?.getDebugCamProps(newSceneId);

      if (props?.latestAppCameraId) {
        setCurrentCamera(props.latestAppCameraId);
      }

      useDebug(debugHelpers)?.syncCameraHelpersFromLS(newSceneId, world);

      toggleDebugCamera(world, props?.enabled || false);
    });

    debugCameraEntityId = createCameraEntity(
      { type: 'PERSPECTIVE', active: false, fov: 60, near: 0.1, far: 2000 },
      { appId: DEBUG_CAMERA_ID, userData: { name: 'DebugOrbitCamera' }, persistent: true },
      world
    );

    world.addComponent(debugCameraEntityId, ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA, true);
    world.addComponent(debugCameraEntityId, ComponentType.PERSISTENT, true);

    inspectEntity(debugCameraEntityId);
  }
};

/**
 * Turns the debug orbit camera on (it becomes the active camera) or off (back to the main
 * camera), and saves the state for the scene. Debug env; nothing otherwise.
 * @internal
 */
export const toggleDebugCamera = (world: ECSWorld, useDebugCam: boolean) =>
  useDebug(debugCamera)?.toggleDebugCamera(world, useDebugCam, setActiveCamera);

/**
 * Enables or disables the scene debug camera's canvas input (its OrbitControls) right away.
 * Views.ts turns it off while an editor view is active. Debug env only.
 * @internal
 */
export const setSceneDebugCameraInputEnabled = (enabled: boolean) =>
  useDebug(debugCamera)?.setSceneDebugCameraInputEnabled(enabled, getECSWorld());

/**
 * Whether the debug orbit camera is the active camera (debug env; always `false` otherwise). The
 * input bindings read it for their `enabledInDebugCam` option.
 * @internal
 */
export const isDebugCameraActive = (): boolean => {
  if (activeCameraEntityId === null) return false;
  const world = getECSWorld();
  return world.hasComponent(activeCameraEntityId, ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA);
};

/**
 * Whether any camera's helper but the debug camera's shows (debug env; `false` otherwise).
 * @internal
 */
export const isAnyCameraHelperVisible = (): boolean =>
  useDebug(debugHelpers)?.isAnyCameraHelperVisible() ?? false;

/**
 * Shows or hides every camera's helper but the debug camera's, toggling them without `show`, and
 * saves the state for the current scene (debug env; nothing otherwise).
 * @internal
 */
export const toggleAllCameraHelpers = (show?: boolean) =>
  useDebug(debugHelpers)?.toggleAllCameraHelpers(show);

/**
 * Returns the camera of the entity with this app id.
 * @param ecsWorld default: the default world
 * @returns the camera, or `undefined` when no entity has the id (or it has no object)
 * @throws when the entity's object isn't a camera
 * @example
 * ```ts
 * import { getCameraByAppId } from 'aekasha';
 *
 * const camera = getCameraByAppId('followCamera');
 * if (camera) camera.layers.enable(2);
 * ```
 */
export const getCameraByAppId = (appId: string, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  let camera: THREE.Camera | undefined = undefined;
  if (entityId !== undefined) {
    const obj = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    if (obj && !(obj as THREE.Camera).isCamera) {
      const msg = `Found Object3D is not a camera (type: ${obj.type}).`;
      lerror(msg);
      throw new Error(msg);
    }
    camera = obj as THREE.Camera | undefined;
  }
  return camera;
};
