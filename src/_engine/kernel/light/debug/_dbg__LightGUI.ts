// The Lights tab: its list of the scene's lights with their toggles, the edit windows' kind, and
// the hooks that keep the lights' debug visuals in step. The module `Light.ts` loads: the state,
// the edit window and the undo are in their own (`_dbg__LightDebugState.ts`,
// `_dbg__LightEditWindow.ts`, `_dbg__LightUndo.ts`).
import * as THREE from 'three/webgpu';
import { getECSWorld, ECSWorld, getEntityIdByAppId, getStableAppId } from '../../ecs/ECS';
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
import { isCurrentlyLoading } from '../../scene/SceneLoader';
import { getCurrentSceneId } from '../../scene/Scene';
import { lsGetItem } from '../../../utils/LocalAndSessionStorage';
import {
  confirmClearScope,
  createClearListLSButton,
  createClearTabLSButton,
} from '../../../debug/_dbg__ClearLSButtons';
import { getLightCharacteristics } from '../LightHelpers';
import { _getEntityManagerInfo } from '../../../debug/_dbg__ManagedEntities';
import {
  EDIT_LIGHT_WIN_ID,
  LIGHTS_TAB_ID,
  LS_LIGHTS_KEY,
  getLightDebugVisibilityPref,
  pruneEmptyLightScene,
  reconcileDebugVisuals,
  saveLightToLS,
  setLightHelperVisible,
  updateLightsDebuggerGUI,
  writeLightLSOrRemove,
  type LightDebugLSData,
} from './_dbg__LightDebugState';
import { applyLightField, recordLightChange } from './_dbg__LightUndo';
import { createEditLightContent } from './_dbg__LightEditWindow';

// What `Light.ts` reads of this module
export {
  _toggleAllLightHelpers,
  globalHelpersVisible,
  loadLightDebugData,
  syncDebugVisualsFromLS,
  updateLightsDebuggerGUI,
} from './_dbg__LightDebugState';

const getLightTypeShorthand = (world: ECSWorld, entityId: number) => {
  if (world.hasComponent(entityId, ComponentType.TAG_IS_POINT_LIGHT)) return 'PL';
  if (world.hasComponent(entityId, ComponentType.TAG_IS_DIRECTIONAL_LIGHT)) return 'DL';
  if (world.hasComponent(entityId, ComponentType.TAG_IS_SPOT_LIGHT)) return 'SL';
  if (world.hasComponent(entityId, ComponentType.TAG_IS_AMBIENT_LIGHT)) return 'AL';
  if (world.hasComponent(entityId, ComponentType.TAG_IS_HEMISPHERE_LIGHT)) return 'HL';
  return '??';
};

/** The tab's clear-LS buttons: the scenes' global helper toggles, and the lights' saved values */
const createLightsHeaderButtons = () => {
  /** Clears `clear`'s part of the scenes that have one, asking which when there are several */
  const clearScenes = (
    hasPart: (scene: LightDebugLSData[string]) => boolean,
    clear: (scene: LightDebugLSData[string]) => void
  ) => {
    const current = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
    const sceneIdsWithData = Object.keys(current).filter((id) => hasPart(current[id]));
    const applyClear = (sceneIds: string[]) => {
      for (const sceneId of sceneIds) {
        clear(current[sceneId]);
        pruneEmptyLightScene(current, sceneId);
      }
      writeLightLSOrRemove(current);
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
  const hasHelpers = (scene: LightDebugLSData[string]) => scene.globalHelpersVisible;
  const hasLights = (scene: LightDebugLSData[string]) =>
    Boolean(scene.lights) && Object.keys(scene.lights).length > 0;
  const readScenes = () => Object.values(lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData);
  return [
    createClearTabLSButton({
      hasData: () => readScenes().some(hasHelpers),
      watchKey: LS_LIGHTS_KEY,
      onClear: () => clearScenes(hasHelpers, (scene) => (scene.globalHelpersVisible = false)),
    }),
    createClearListLSButton({
      hasData: () => readScenes().some(hasLights),
      watchKey: LS_LIGHTS_KEY,
      onClear: () => clearScenes(hasLights, (scene) => (scene.lights = {})),
    }),
  ];
};

/** Creates the Tab in the Debug Drawer */
let lightDebuggerGUIInitiated = false;
export const initLightDebuggerGUI = () => {
  if (lightDebuggerGUIInitiated) return;
  createDebuggerTab({
    id: LIGHTS_TAB_ID,
    title: 'Light controls',
    icon: 'lightBulb',
    // A refresh re-reads what it shows: kept open on a scene change (p806 D5)
    keepOnSceneChange: true,
    // The tab's LS data is scene-scoped (module-owned), so both clear buttons are custom
    clearLSButton: false,
    headerButtons: createLightsHeaderButtons,
    content: () => [
      debuggerListCMP({
        id: 'lights',
        label: 'Lights',
        emptyText: 'No ECS lights found.',
        data: () => getLightsListData(getECSWorld()),
        selectedItemId: () =>
          getDraggableWindowsOfKind(EDIT_LIGHT_WIN_ID).map((win) => String(win.data?.id)),
        perItemConfig: {
          onClick: openEditLightWindow,
          toggles: [
            { icon: 'lightBulb', title: 'Enabled', fn: toggleLightEnabled },
            { icon: 'lamp', title: 'Show helper', fn: toggleLightHelper },
          ],
        },
      }),
    ],
  });
  lightDebuggerGUIInitiated = true;
};

registerDraggableWindowKind(EDIT_LIGHT_WIN_ID, {
  content: createEditLightContent,
  onClose: () => updateDebuggerTab(LIGHTS_TAB_ID),
  // Kept open on a scene change when the next scene has a light with the same appId
  sceneTargetResolver: (data) => {
    const entityId = getEntityIdByAppId(String(data?.id));
    return Boolean(entityId && getECSWorld().isAlive(entityId));
  },
});

/** Finds a list row's light (the row id is the app id, or the entity id without one). */
const resolveLightListItem = (itemId: string) => {
  const world = getECSWorld();
  const entityId =
    getEntityIdByAppId(itemId, world) ?? (/^\d+$/.test(itemId) ? Number(itemId) : undefined);
  const light =
    entityId !== undefined ? world.getComponent(entityId, ComponentType.OBJECT3D)?.value : null;
  if (entityId === undefined || !(light instanceof THREE.Light)) return null;
  return { world, entityId, light };
};

const getLightsListData = (world: ECSWorld): DebuggerListItem[] => {
  const storage = world.getStorage(ComponentType.TAG_IS_LIGHT);
  const lsData = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  const items: DebuggerListItem[] = [];
  for (const [entityId] of storage) {
    const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
    const debugData = world.getComponent(entityId, ComponentType.DEBUG_DATA);
    const light = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    const hasHelper =
      light instanceof THREE.Light &&
      Boolean(world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER)) &&
      getLightCharacteristics(light).hasHelper;
    const itemId = appId || String(entityId);
    const managerInfo = _getEntityManagerInfo(entityId, world);
    items.push({
      itemId,
      title: debugData?.name || `[${itemId}]`,
      titlePlaceholder: !debugData?.name,
      subTitle: managerInfo
        ? `Managed by ${managerInfo.label} [${entityId}]`
        : `[${appId}] [${entityId}]`,
      ...(managerInfo?.icon ? { icon: managerInfo.icon } : {}),
      badge: getLightTypeShorthand(world, entityId),
      // A managed light's enabled state is its manager's: no toggle here (the helper is cosmetic)
      toggleValues: [
        light instanceof THREE.Light && !managerInfo ? light.visible : null,
        hasHelper ? getLightDebugVisibilityPref(entityId, world, lsData).helper : null,
      ],
    });
  }
  return items;
};

/** List row click: opens the light's window, brings it to the front, or closes it when on top. */
const openEditLightWindow = (itemId: string) => {
  const target = resolveLightListItem(itemId);
  if (!target) return;
  const appId = target.world.getComponent(target.entityId, ComponentType.APP_ID)?.id || itemId;
  const debugData = target.world.getComponent(target.entityId, ComponentType.DEBUG_DATA);
  toggleDraggableWindow({
    id: getKindWindowId(EDIT_LIGHT_WIN_ID, appId),
    kind: EDIT_LIGHT_WIN_ID,
    title: `${
      _getEntityManagerInfo(target.entityId, target.world) ? 'Managed Light' : 'Edit Light'
    }: ${debugData?.name || `[${itemId}]`}`,
    isDebugWindow: true,
    data: { id: appId },
    closeOnSceneChange: true,
    saveToLS: true,
  });
};

/** List toggle: the same path as the edit window's Enabled field (LS, undo, open window). */
const toggleLightEnabled = (itemId: string, next: boolean) => {
  const target = resolveLightListItem(itemId);
  if (!target || _getEntityManagerInfo(target.entityId, target.world)) return;
  const prev = target.light.visible;
  applyLightField.enabled(target, next);
  saveLightToLS(target.entityId, 'enabled', next);
  recordLightChange('enabled', getStableAppId(target.entityId, target.world), prev, next);
  updateLightsDebuggerGUI('WINDOW', itemId);
};

/** List toggle: the same path as the edit window's Show helper field. */
const toggleLightHelper = (itemId: string, next: boolean) => {
  const target = resolveLightListItem(itemId);
  if (!target) return;
  setLightHelperVisible(target.entityId, target.world, next);
  updateLightsDebuggerGUI('WINDOW', itemId);
};

/**
 * Called from a light's delete hook: refreshes the list and closes the light's edit window. The
 * entity is still alive in its delete hook, and a manager can re-create a light under the same
 * app id in the same call (eg. a sky light's castShadow change), so the window is checked a
 * microtask later: it is rebuilt when the light is back. A scene change leaves the windows to the
 * scene change handling (kept when the next scene has the light).
 */
export const _onLightDeleted = (entityId: number, world: ECSWorld) => {
  updateLightsDebuggerGUI('LIST');
  const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
  if (!appId || world !== getECSWorld() || isCurrentlyLoading()) return;
  queueMicrotask(() => {
    const winId = getKindWindowId(EDIT_LIGHT_WIN_ID, appId);
    if (resolveLightListItem(appId)) {
      updateDraggableWindow(winId);
    } else {
      closeDraggableWindow(winId);
    }
  });
};

/** Whether an entity has debug visuals to reconcile (a light's helper, a light's or camera's
 * symbol): DISABLED is added and removed on every kind of entity. */
const hasDebugVisuals = (id: number, w: ECSWorld) =>
  w.hasComponent(id, ComponentType.DEBUG_SYMBOL) ||
  w.hasComponent(id, ComponentType.DEBUG_LIGHT_HELPER);

ECSWorld.registerComponentHooks(ComponentType.DISABLED, {
  onAddComponent: (id, w) => {
    if (hasDebugVisuals(id, w)) reconcileDebugVisuals(id, w);
  },
  onRemoveComponent: (id, w) => {
    if (hasDebugVisuals(id, w)) reconcileDebugVisuals(id, w, undefined, false);
  },
});

// Run reconciler when a debug component is first attached to an entity
ECSWorld.registerComponentHooks(ComponentType.DEBUG_SYMBOL, {
  onAddComponent: (id, w) => reconcileDebugVisuals(id, w),
});
ECSWorld.registerComponentHooks(ComponentType.DEBUG_LIGHT_HELPER, {
  onAddComponent: (id, w) => reconcileDebugVisuals(id, w),
});
