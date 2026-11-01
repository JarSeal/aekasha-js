// The lights' debugger state (`AEK_debugLights`, per scene): the saved values, the helper and
// symbol preferences and their 3D visuals, the refresh of the Lights tab and its edit windows, and
// a light's rebuild for a new shadow map size. What the tab, the edit window and the undo share.
import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../ecs/ECS';
import { getECSWorld } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import {
  getKindWindowId,
  updateDraggableWindow,
  updateDraggableWindowsOfKind,
} from '../../../ui/overlays/windows/DraggableWindow';
import type { ShadowQuality } from '../../../schemas/_HelperSchemas';
import { getCurrentSceneId, getRootScene } from '../../scene/Scene';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { getActiveCameraId } from '../../camera/Camera';
import { updateOnScreenTools } from '../../../debug/OnScreenTools';
import { lerror } from '../../../utils/Logger';

export interface LightEntityDebugState {
  enabled: boolean;
  helperVisible: boolean;
  symbolVisible: boolean;
  color?: number;
  groundColor?: number;
  intensity?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
  position?: { x: number; y: number; z: number };
  targetPos?: { x: number; y: number; z: number };
  castShadow?: boolean;
  frustumCullingEnabled?: boolean;
  objectCullingEnabled?: boolean;
  shadowPreset?: ShadowQuality;
  shadowBias?: number;
  shadowNormalBias?: number;
  shadowMapSize?: [number, number];
  shadowCameraNearFar?: [number, number];
  shadowCameraFrustum?: [number, number, number, number]; // Left, Right, Top, Bottom
  shadowBlurSamples?: number;
  shadowRadius?: number;
  shadowIntensity?: number;
  _shadowFolderOpen?: boolean;
  _shadowCameraFolderOpen?: boolean;
}

export interface LightSceneDebugState {
  globalHelpersVisible: boolean;
  /** Map of fixed appId to light-specific debug state */
  lights: Record<string, LightEntityDebugState>;
}

/** The structure of 'AEK_debugLights' in LocalStorage */
export interface LightDebugLSData {
  [sceneId: string]: LightSceneDebugState;
}

/** The edit windows' kind: one window per light, keyed by its app id */
export const EDIT_LIGHT_WIN_ID = 'lightEditorWindow';
export const LS_LIGHTS_KEY = 'AEK_debugLights';
export const LIGHTS_TAB_ID = 'lightsControls';
export let globalHelpersVisible = false;

/** Managed lights' helper choices, session only (by app id): nothing about a managed light goes
 * to LS. Without one, a managed light follows the global helpers toggle. */
const managedHelperPrefs = new Map<string, boolean>();

export const reconcileDebugVisuals = (
  entityId: number,
  world: ECSWorld,
  dataOverride?: LightDebugLSData,
  // `removeComponent` fires onRemoveComponent hooks before the component is
  // actually gone (ECS.ts), so `world.isDisabled()` still reads `true` here
  // when this runs from DISABLED's own onRemoveComponent. That call site
  // passes `false` explicitly since removal means "no longer disabled" by
  // definition; every other caller lets this fall through to the live value.
  isDisabledOverride?: boolean
) => {
  const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
  const light = objComp?.value as THREE.Light;

  if (!light) return;

  // Combine ECS status with the actual Three.js visibility property.
  // This handles initialization and "first load" cases where components might not be synced yet.
  const isEnabled = light.visible && !(isDisabledOverride ?? world.isDisabled(entityId));

  const isCurrentActiveCam = entityId === getActiveCameraId();

  // Get user preferences
  const { helper: helperPref, symbol: symbolPref } = getLightDebugVisibilityPref(
    entityId,
    world,
    dataOverride
  );

  // Sync Helper
  const helperComp = world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER);
  if (helperComp) {
    // Helper only shows if: (Light is physically ON) AND (User wants to see helpers)
    helperComp.value.visible = isEnabled && helperPref;

    if (helperComp.camHelper) {
      // Shadow lines only show if: (Light is ON) AND (User wants helpers) AND (Casts Shadows)
      helperComp.camHelper.visible = light.castShadow && isEnabled && helperPref;
    }
  }

  // Sync Symbol
  const symbolComp = world.getComponent(entityId, ComponentType.DEBUG_SYMBOL);
  if (symbolComp) {
    symbolComp.userVisible = symbolPref;
    symbolComp.value.visible = isEnabled && symbolPref && !isCurrentActiveCam;
  }
};

export const getLightDebugVisibilityPref = (
  entityId: number,
  world: ECSWorld,
  dataOverride?: LightDebugLSData
) => {
  const sceneId = getCurrentSceneId();
  const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
  const isDisabled = world.getComponent(entityId, ComponentType.DISABLED);
  const showHelper = !isDisabled ? globalHelpersVisible : false;
  if (!sceneId || !appId) return { helper: showHelper, symbol: true };
  if (world.hasComponent(entityId, ComponentType.MANAGED_BY)) {
    return {
      helper: !isDisabled && (managedHelperPrefs.get(appId) ?? globalHelpersVisible),
      symbol: true,
    };
  }

  const data = dataOverride || (lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData);
  const saved = data[sceneId]?.lights?.[appId];

  if (!saved) {
    return {
      helper: showHelper,
      symbol: true,
    };
  }

  return {
    helper: Boolean(saved.helperVisible),
    symbol: saved.symbolVisible !== undefined ? Boolean(saved.symbolVisible) : true,
  };
};

export const setLightDebugPreference = (
  entityId: number,
  world: ECSWorld,
  key: 'helperVisible' | 'symbolVisible',
  value: boolean
) => {
  const sceneId = getCurrentSceneId();
  const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
  if (!sceneId || !appId) return;
  if (world.hasComponent(entityId, ComponentType.MANAGED_BY)) {
    if (key === 'helperVisible') managedHelperPrefs.set(appId, value);
    reconcileDebugVisuals(entityId, world);
    return;
  }

  const data = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  if (!data[sceneId]) data[sceneId] = { lights: {}, globalHelpersVisible };
  if (!data[sceneId].lights[appId]) {
    data[sceneId].lights[appId] = {
      enabled: true,
      helperVisible: globalHelpersVisible,
      symbolVisible: true,
    };
  }

  data[sceneId].lights[appId][key] = value;
  lsSetItem(LS_LIGHTS_KEY, data);

  reconcileDebugVisuals(entityId, world);
};

/** Sets a light's "show helper" preference (edit window and list toggle). */
export const setLightHelperVisible = (entityId: number, world: ECSWorld, show: boolean) => {
  saveLightToLS(entityId, 'helperVisible', show);
  setLightDebugPreference(entityId, world, 'helperVisible', show);
  updateOnScreenTools('SWITCH');
};

/**
 * Refreshes the Lights tab and the open light edit windows.
 * @param only ('LIST' | 'WINDOW') optional, refreshes only the list or only the windows
 * @param appId (string) optional, rebuilds only this light's window (default: every open one)
 */
export const updateLightsDebuggerGUI = (only?: 'LIST' | 'WINDOW', appId?: string) => {
  if (only !== 'WINDOW') updateDebuggerTab(LIGHTS_TAB_ID);
  if (only === 'LIST') return;
  if (appId) {
    updateDraggableWindow(getKindWindowId(EDIT_LIGHT_WIN_ID, appId));
  } else {
    updateDraggableWindowsOfKind(EDIT_LIGHT_WIN_ID);
  }
};

export const _toggleAllLightHelpers = (show?: boolean) => {
  const world = getECSWorld();
  const sceneId = getCurrentSceneId();
  if (!sceneId) return;

  const storage = world.getStorage(ComponentType.TAG_IS_LIGHT);
  const currentData = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;

  if (!currentData[sceneId]) {
    currentData[sceneId] = { lights: {}, globalHelpersVisible: false };
  }

  // Determine the target state
  const targetState = show !== undefined ? show : !globalHelpersVisible;
  globalHelpersVisible = targetState;
  currentData[sceneId].globalHelpersVisible = globalHelpersVisible;

  // Managed lights follow the global state (they have no LS entries)
  managedHelperPrefs.clear();

  // Update the in-memory data object (Ignoring Symbols)
  for (const [entityId] of storage) {
    const appIdComp = world.getComponent(entityId, ComponentType.APP_ID);
    if (appIdComp?.isFixed && !world.hasComponent(entityId, ComponentType.MANAGED_BY)) {
      if (!currentData[sceneId].lights[appIdComp.id]) {
        currentData[sceneId].lights[appIdComp.id] = {
          enabled: true, // Default is true
          helperVisible: targetState,
          symbolVisible: true, // Default is true
        };
      } else {
        currentData[sceneId].lights[appIdComp.id].helperVisible = targetState;
      }
    }

    // Reconcile the 3D scene using the updated data
    reconcileDebugVisuals(entityId, world, currentData);
  }

  lsSetItem(LS_LIGHTS_KEY, currentData);

  updateLightsDebuggerGUI();
};

export const syncDebugVisualsFromLS = (sceneId: string, world: ECSWorld) => {
  const currentData = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  globalHelpersVisible = Boolean(currentData[sceneId]?.globalHelpersVisible);

  // Sync Helpers
  const helperStorage = world.getStorage(ComponentType.DEBUG_LIGHT_HELPER);
  for (const [entityId] of helperStorage) {
    reconcileDebugVisuals(entityId, world, currentData);
  }

  // Sync Symbols
  const symbolStorage = world.getStorage(ComponentType.DEBUG_SYMBOL);
  for (const [entityId] of symbolStorage) {
    reconcileDebugVisuals(entityId, world, currentData);
  }
};

const refreshLightShadowsAsync = async (light: THREE.Light, entityId: number, world: ECSWorld) => {
  const rootScene = getRootScene();
  if (!rootScene) return;

  // Finalize Projection for the new Light
  // A perspective shadow camera's aspect follows the map size (same as createLightEntity).
  // A directional light's ortho bounds are left as they are: createLightEntity applies
  // shadowCameraFrustum as-is regardless of the map size, so this preview must too.
  const l = light as THREE.SpotLight | THREE.DirectionalLight;
  if (l.shadow) {
    const { width, height } = l.shadow.mapSize;
    if (l.shadow.camera instanceof THREE.PerspectiveCamera) {
      l.shadow.camera.aspect = width / height;
    }
    l.shadow.camera.updateProjectionMatrix();
  }

  // Clone the light with these finalized settings
  const newLight = light.clone(true) as THREE.Light;

  // Preserve references
  if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
    (newLight as THREE.DirectionalLight | THREE.SpotLight).target = light.target;
  }

  // Clean up old visuals and dispose
  const oldHelperComp = world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER);
  if (oldHelperComp) {
    oldHelperComp.value.removeFromParent();
    oldHelperComp.camHelper?.removeFromParent();
  }

  light.removeFromParent();
  light.dispose();
  rootScene.add(newLight);

  // Update ECS
  const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
  if (objComp) {
    objComp.value = newLight;
    objComp._lastVersion = -1; // Force immediate transform sync
  }

  // Re-link Symbol
  const symbolComp = world.getComponent(entityId, ComponentType.DEBUG_SYMBOL);
  if (symbolComp) {
    symbolComp.value.matrix = newLight.matrixWorld;
    symbolComp.value.matrixAutoUpdate = false;
  }

  // Re-attach Helpers
  const { attachLightHelpers, disposeLightHelpers } = await import('./_dbg__LightHelpers');
  if (oldHelperComp) disposeLightHelpers(oldHelperComp);
  // Deleted while the module loaded (eg. a scene change): nothing to attach the helpers to
  if (!world.isAlive(entityId)) return;
  attachLightHelpers(entityId, newLight, world, rootScene);

  // The helper geometry needs to be rebuilt based on the new projection
  const newHelperComp = world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER);
  if (newHelperComp?.camHelper) {
    newHelperComp.camHelper.update(); // Sync lines to new camera bounds
  }

  reconcileDebugVisuals(entityId, world);
  updateLightsDebuggerGUI(undefined, world.getComponent(entityId, ComponentType.APP_ID)?.id);
};

/** Rebuilds a light for a new shadow map size (logged when it fails). */
export const refreshLightShadows = (light: THREE.Light, entityId: number, world: ECSWorld) => {
  refreshLightShadowsAsync(light, entityId, world).catch((err: unknown) => {
    lerror('Rebuilding the light for its new shadow map size failed', err);
  });
};

/**
 * Returns a light's saved debugger state.
 * @param appId (string) the light's app id
 * @param sceneId (string) scene whose data to read, defaults to the current scene
 */
export const loadLightDebugData = (
  appId?: string,
  sceneId: string | null = getCurrentSceneId()
): LightEntityDebugState | undefined => {
  if (!appId) return;
  const currentData = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  if (
    !sceneId ||
    !currentData ||
    !currentData[sceneId] ||
    !currentData[sceneId].lights ||
    !currentData[sceneId].lights[appId]
  ) {
    return;
  }
  return currentData[sceneId].lights[appId];
};

export const clearLightFromLS = (appId: string) => {
  const sceneId = getCurrentSceneId();
  const currentData = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  if (!sceneId || !currentData[sceneId]?.lights?.[appId]) return;
  delete currentData[sceneId].lights[appId];
  lsSetItem(LS_LIGHTS_KEY, currentData);
};

/** Scene entries always carry both `lights` and `globalHelpersVisible` together;
 * once neither holds anything meaningful, drop the entry so `hasData` checks
 * (which only look at key/field presence) don't report stale data forever. */
export const pruneEmptyLightScene = (data: LightDebugLSData, sceneId: string) => {
  const scene = data[sceneId];
  if (!scene) return;
  const lightsEmpty = !scene.lights || Object.keys(scene.lights).length === 0;
  if (lightsEmpty && !scene.globalHelpersVisible) delete data[sceneId];
};

export const writeLightLSOrRemove = (data: LightDebugLSData) => {
  if (Object.keys(data).length === 0) lsRemoveItem(LS_LIGHTS_KEY);
  else lsSetItem(LS_LIGHTS_KEY, data);
};

/** Helper for saving specific light debug properties to LocalStorage.
 * @template K A generic extending the keys of the debug state.
 * @param value Automatically typed based on the key provided.
 */
export const saveLightToLS = <K extends keyof LightEntityDebugState>(
  entityId: number,
  key: K,
  value: LightEntityDebugState[K]
) => {
  const world = getECSWorld();
  const sceneId = getCurrentSceneId();
  const appIdComp = world.getComponent(entityId, ComponentType.APP_ID);
  // A managed light's values are its manager's (and it gets no LS overrides at creation)
  if (!sceneId || !appIdComp?.isFixed || world.hasComponent(entityId, ComponentType.MANAGED_BY)) {
    return;
  }
  const currentData = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  if (!currentData[sceneId]) currentData[sceneId] = { lights: {}, globalHelpersVisible: false };
  const appId = appIdComp.id;
  if (!currentData[sceneId].lights[appId]) {
    currentData[sceneId].lights[appId] = {
      enabled: true,
      helperVisible: false,
      symbolVisible: true,
    };
  }
  currentData[sceneId].lights[appId][key] = value;
  lsSetItem(LS_LIGHTS_KEY, currentData);
};
