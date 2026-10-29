// The on-screen tools (p806 D7): four kit toolbars in three debugger roots. The top left row holds
// the About and undo / redo tools, then the view switch; the centred top row the play tools; the
// bottom row the scene's switch tools (Runtime view only). Each group is refreshed in place
// (`_dbg__OnScreenToolbar.ts`), and during a scene load every control is `aria-disabled`.
import {
  getAllCamerasAsArray,
  getMainAppCameraId,
  isAnyCameraHelperVisible,
  isDebugCameraActive,
  setCurrentCamera,
  toggleAllCameraHelpers,
  toggleDebugCamera,
} from '../kernel/camera/Camera';
import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../kernel/config/Config';
import { getHUDRootCMP, KEEP_IN_VIEWS_CLASS } from '../ui/core/HUD';
import { isAnyLightHelperVisible, toggleAllLightHelpers } from '../kernel/light/Light';
import { getReadOnlyLoopState, toggleMainPlay } from '../kernel/loop/MainLoop';
import { getPhysicsState } from '../features/physics/PhysicsState';
import { getCurrentSceneId, getGeneratedAppData } from '../kernel/scene/Scene';
import { isCurrentlyLoading, loadScene } from '../kernel/scene/SceneLoader';
import { getSvgIcon } from '../ui/core/icons/SvgIcon';
import { createDropDown, type DropDownProps } from '../ui/forms/DropDown';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { getDebuggerRootProps } from '../ui/overlays/DebuggerRoot';
import styles from './OnScreenTools.module.scss';
import { getECSWorld } from '../kernel/ecs/ECS';
import type { SceneAsset } from '../schemas/SceneSchema';
import type { OnScreenDropDownKey, ToolTypes } from './OnScreenTools';
import { addDebugToast, DEBUGGER_SCENE_LOADER_ID } from './DebuggerGUI';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModule, useDebug } from '../kernel/config/DebugModules';
import { getDebugToolsState } from './DebugTools';
import { canRedo, canUndo, redoLastAction, undoLastAction } from './UndoRedo';
import { openAboutDialog } from './_dbg__About';
import { isProfilerAvailable, isProfilerWindowOpen, toggleProfilerWindow } from './Profiler';
import {
  createOnScreenToolbar,
  getOnScreenToolsSignature,
  keepFocusOnPress,
  type OnScreenToolbar,
  type OnScreenToolItem,
} from './_dbg__OnScreenToolbar';
import {
  getActiveView,
  getActiveViewId,
  getViews,
  isRuntimeViewActive,
  isViewPlaying,
  RUNTIME_VIEW_BUTTON,
  RUNTIME_VIEW_ID,
  setActiveView,
  toggleViewPlay,
} from '../kernel/render/Views';

// This file (a lazily-loaded _dbg__ module) also loads in IS_PROD_TEST_MODE (see
// debug/OnScreenTools.ts's registerOnScreenTools), but the physics wireframe system is
// IS_DEBUG_ENV-only — never reaches prodTest, matching the physics feature's `onDebug` hook
// (PhysicsEntity.ts' registerPhysicsWireframeDebugAsync). Cross-referencing it via loadDebugModule (not a static import) is what keeps
// that scoping intact: a static import would run this module's side effects unconditionally
// the moment _dbg__OnScreenTools.ts itself loads, regardless of IS_DEBUG_ENV.
const physicsDebugDrawRef: DebugModuleRef<
  typeof import('../features/physics/debug/_dbg__PhysicsDebugDraw')
> | null = loadDebugModule(() => import('../features/physics/debug/_dbg__PhysicsDebugDraw'));

/** Reloads the app with one mode query param on and the other one removed. */
const reloadInMode = (onParam: 'isProdTest' | 'isDebug', offParam: 'isProdTest' | 'isDebug') => {
  const queryData = new URLSearchParams(window.location.search.slice(1));
  queryData.set(onParam, 'true');
  queryData.delete(offParam);
  const newUrl = new URL(window.location.href);
  newUrl.search = queryData.toString();
  window.location.href = newUrl.toString();
};

/** Reloads the app in production test mode (the on-screen play button). */
export const _playInProdTestMode = () => reloadInMode('isProdTest', 'isDebug');

/** Reloads the app in debug mode (the on-screen stop button in production test mode). */
export const _stopProdTestMode = () => reloadInMode('isDebug', 'isProdTest');

/** A toast of the camera that is now active: the debug camera, or the app camera by name (with
 * the same icons as the on-screen debug camera button and camera dropdown). */
const showActiveCameraToast = () => {
  if (isDebugCameraActive()) {
    addDebugToast({ title: 'Debug camera', icon: getSvgIcon('aspectRatio') });
    return;
  }
  const appCamId = getMainAppCameraId();
  const appCamName = getAllCamerasAsArray().find((c) => c.appId === appCamId)?.name;
  addDebugToast({
    title: 'App camera',
    message: appCamName || 'No app camera',
    icon: getSvgIcon('camera'),
  });
};

/** Toggles between the debug camera and the app camera (F1, the debug camera button). */
export const _toggleDebugCameraWithToast = () => {
  toggleDebugCamera(getECSWorld(), !isDebugCameraActive());
  _updateOnScreenTools('SWITCH');
  showActiveCameraToast();
};

/** The scenes in the order of the on-screen scene selector, with their labels. */
const getSceneOptions = () => {
  const scenes = getGeneratedAppData().scenes as unknown as { [id: string]: SceneAsset };
  // The scene's name if declared, else its id
  return Object.keys(scenes).map((id) => ({ value: id, label: scenes[id]?.name || `[${id}]` }));
};

const loadSceneFromTools = (sceneId: string) => {
  if (isCurrentlyLoading() || sceneId === getCurrentSceneId()) return;
  loadScene({ sceneId, loaderId: DEBUGGER_SCENE_LOADER_ID });
};

// THE ROWS
// Each is a debugger root (the theme and density, p806 D8), kept in editor views. A press on a tool
// leaves the focus where it was (keepFocusOnPress).

/** The fixed, centred top row: the play tools */
let topRowCMP: CMPHandle | null = null;
/** The fixed row in the top left corner: the About and undo / redo tools, then the view tools */
let topLeftRowCMP: CMPHandle | null = null;
/** The fixed, centred bottom row: the switch tools */
let bottomRowCMP: CMPHandle | null = null;

const createRow = (className: string, globalClass: string) =>
  getHUDRootCMP().add({
    class: [className, globalClass, KEEP_IN_VIEWS_CLASS],
    listeners: [{ type: 'mousedown', fn: keepFocusOnPress }],
    ...getDebuggerRootProps(),
  });

const getTopRow = () => (topRowCMP ??= createRow(styles.onScreenTopRow, 'onScreenTopRow'));

const getTopLeftRow = () =>
  (topLeftRowCMP ??= createRow(styles.onScreenTopLeftRow, 'onScreenTopLeftRow'));

const getBottomRow = () =>
  (bottomRowCMP ??= createRow(styles.onScreenBottomRow, 'onScreenBottomRow'));

// THE GROUPS' TOOLS
// Each returns the group's tools now, or null when it isn't shown. Their state is read through
// getters, so a group whose tools are the same is refreshed, not rebuilt.

/** Switches to a view and shows a toast of it (a view tools button). */
const switchViewWithToast = async (id: string) => {
  if (id === getActiveViewId()) return;
  if (!(await setActiveView(id))) {
    // Not switched: the pressed button goes back
    _updateOnScreenTools('VIEW');
    return;
  }
  const view = id === RUNTIME_VIEW_ID ? RUNTIME_VIEW_BUTTON : getViews().find((v) => v.id === id);
  if (view) addDebugToast({ title: view.title, icon: getSvgIcon(view.icon) });
};

/** One button per view (Views.ts): the Runtime view first, then the editor views. Debug environment
 * only (never prod test mode), and only when an editor view is registered. */
const getViewTools = (): OnScreenToolItem[] | null => {
  if (!IS_DEBUG_ENV || IS_PROD_TEST_MODE) return null;
  const editorViews = getViews();
  if (!editorViews.length) return null;
  return [RUNTIME_VIEW_BUTTON, ...editorViews].map((view) => ({
    key: view.id,
    label: view.title,
    icon: view.icon,
    isIconSmall: 'iconSize' in view && view.iconSize === 'small',
    isPressed: () => getActiveViewId() === view.id,
    onClick: () => switchViewWithToast(view.id),
  }));
};

const getPlayTools = (): OnScreenToolItem[] | null => {
  // Toggled in the Debug Tools Controls tab ("On-screen tools" folder); read from LS
  // here because that tab (and its state loading) never runs in prodTest mode itself.
  if (IS_PROD_TEST_MODE && !getDebugToolsState(true).onScreenTools.showOnScreenToolsInProdTest) {
    return null;
  }
  const tools: OnScreenToolItem[] = [];
  if (IS_PROD_TEST_MODE) {
    tools.push({
      key: 'prodTest',
      label: 'Stop production test mode',
      icon: 'stop',
      keyId: 'sc-prod-test-stop',
      onClick: _stopProdTestMode,
    });
  } else if (isRuntimeViewActive()) {
    // Runtime view only: an editor view keeps the master loop and pause
    tools.push({
      key: 'prodTest',
      label: 'Play in production test mode',
      icon: 'playFill',
      keyId: 'sc-play-prod-test',
      onClick: _playInProdTestMode,
    });
  }
  tools.push(
    {
      key: 'mainLoop',
      label: 'Play the main loop',
      icon: 'infinity',
      keyId: IS_PROD_TEST_MODE ? 'sc-prod-test-toggle-main-loop' : 'sc-toggle-main-loop',
      isPressed: () => getReadOnlyLoopState().masterPlay,
      onClick: () => {
        toggleMainPlay();
        _updateOnScreenTools('PLAY');
      },
    },
    {
      // Pauses the active view: the app loop in the Runtime view, an editor view's own play flag
      // (its `update`) in an editor view
      key: 'pause',
      label: getActiveView() ? 'Pause the view' : 'Pause the app loop',
      icon: 'pause',
      keyId: IS_PROD_TEST_MODE ? 'sc-prod-test-toggle-app-pause' : 'sc-toggle-app-pause',
      isPressed: () => !isViewPlaying(),
      onClick: () => {
        toggleViewPlay();
        _updateOnScreenTools('PLAY');
      },
    }
  );
  // Loaded in prodTest only when it is enabled there. The window's open and close refresh these
  // tools.
  if (isProfilerAvailable()) {
    tools.push({
      key: 'profiler',
      label: 'Profiler',
      icon: 'speedometer',
      isIconSmall: true,
      keyId: IS_PROD_TEST_MODE ? 'sc-prod-test-toggle-profiler' : 'sc-toggle-profiler',
      isPressed: isProfilerWindowOpen,
      onClick: toggleProfilerWindow,
    });
  }
  return tools;
};

/** An on-screen drop-down: it opens upwards (the tools sit at the bottom), and stays focusable
 * while disabled (its toolbar's arrows stop on it) */
const createOnScreenDropDown = (props: Omit<DropDownProps, 'placement' | 'triggerClass'>) =>
  createDropDown({
    ...props,
    placement: 'top',
    focusableWhenDisabled: true,
    className: styles.onScreenDropDown,
    triggerClass: [styles.onScreenDropDownTrigger, 'onScreenDropDown'],
  });

/** The switch tools: they act on the scene, so the Runtime view only (an editor view hides its
 * HUD, and the o / p drop-down shortcuts do nothing there). */
const getSwitchTools = (): OnScreenToolItem[] | null => {
  if (!isRuntimeViewActive()) return null;
  const tools: OnScreenToolItem[] = [
    {
      key: 'debugCamera',
      label: 'Debug camera',
      icon: 'aspectRatio',
      isIconSmall: true,
      keyId: 'sc-toggle-debug-camera',
      isPressed: isDebugCameraActive,
      onClick: _toggleDebugCameraWithToast,
    },
    {
      // The o shortcut
      key: 'CAMERA',
      create: () =>
        createOnScreenDropDown({
          icon: getSvgIcon('camera'),
          title: 'Change camera (O)',
          placeholder: 'No App Camera',
          options: () => getAllCamerasAsArray().map((c) => ({ value: c.appId, label: c.name })),
          value: getMainAppCameraId,
          onChange: (appId) => {
            if (appId === getMainAppCameraId() && !isDebugCameraActive()) return;
            setCurrentCamera(appId);
            if (isDebugCameraActive()) toggleDebugCamera(getECSWorld(), false);
            _updateOnScreenTools('SWITCH');
            showActiveCameraToast();
          },
        }),
      // The app camera isn't the one rendering while the debug camera is: its name struck
      onRefresh: (dropDown) =>
        dropDown.cmp.elem.toggleAttribute('data-debug-camera', isDebugCameraActive()),
    },
    {
      // The p shortcut
      key: 'SCENE',
      create: () =>
        createOnScreenDropDown({
          icon: getSvgIcon('easel'),
          title: 'Change scene (P)',
          placeholder: 'No scene',
          options: getSceneOptions,
          value: getCurrentSceneId,
          onChange: loadSceneFromTools,
        }),
    },
    {
      key: 'lightHelpers',
      label: 'Light helpers',
      icon: 'lamp',
      isIconSmall: true,
      isPressed: isAnyLightHelperVisible,
      onClick: () => {
        toggleAllLightHelpers();
        _updateOnScreenTools('SWITCH');
      },
    },
    {
      key: 'cameraHelpers',
      label: 'Camera helpers',
      icon: 'cameraReels',
      isIconSmall: true,
      isPressed: isAnyCameraHelperVisible,
      onClick: () => {
        toggleAllCameraHelpers();
        _updateOnScreenTools('SWITCH');
      },
    },
  ];
  // Physics wireframes master visibility toggle. A display-only filter over whatever per-entity
  // wireframes are already switched on (see _dbg__PhysicsDebugDraw.ts) — it never adds/removes
  // any entity's own DEBUG_PHYSICS_WIREFRAME toggle.
  if (getPhysicsState().enabled) {
    tools.push({
      key: 'physicsWireframes',
      label: 'Physics wireframes',
      icon: 'rocket',
      isIconSmall: true,
      isPressed: () => useDebug(physicsDebugDrawRef)?.isWireframeMasterVisible() ?? true,
      onClick: () => {
        useDebug(physicsDebugDrawRef)?.toggleWireframeMasterVisible();
        _updateOnScreenTools('SWITCH');
      },
    });
  }
  return tools;
};

/** The About Ækasha button, then undo and redo (`aria-disabled` while there's nothing to undo or
 * redo). Debug environment only: prod test mode has no debugger to make edits with. The undo /
 * redo module refreshes this group itself (`updateOnScreenTools('UNDO')`) when the history
 * changes. */
const getUndoTools = (): OnScreenToolItem[] => [
  {
    key: 'about',
    label: 'About Ækasha',
    icon: 'aekasha',
    // A gap sets it apart from the undo / redo buttons after it
    class: styles.aboutTool,
    onClick: openAboutDialog,
  },
  {
    key: 'undo',
    label: 'Undo',
    icon: 'undo',
    isIconSmall: true,
    keyId: 'sc-undo',
    isEnabled: canUndo,
    onClick: undoLastAction,
  },
  {
    key: 'redo',
    label: 'Redo',
    icon: 'redo',
    isIconSmall: true,
    keyId: 'sc-redo',
    isEnabled: canRedo,
    onClick: redoLastAction,
  },
];

// THE GROUPS

type GroupDef = {
  /** The toolbar's accessible name */
  label: string;
  /** Its global class (the old group classes) */
  globalClass: string;
  getRow: () => CMPHandle;
  /** First in its row (the undo tools, before the view tools) */
  isFirst?: boolean;
  exclusive?: boolean;
  getTools: () => OnScreenToolItem[] | null;
};

const GROUPS: Record<ToolTypes, GroupDef> = {
  UNDO: {
    label: 'Debugger',
    globalClass: 'undoRedoTools',
    getRow: getTopLeftRow,
    isFirst: true,
    getTools: getUndoTools,
  },
  VIEW: {
    label: 'Views',
    globalClass: 'viewTools',
    getRow: getTopLeftRow,
    exclusive: true,
    getTools: getViewTools,
  },
  PLAY: { label: 'Play', globalClass: 'playTools', getRow: getTopRow, getTools: getPlayTools },
  SWITCH: {
    label: 'Scene and camera',
    globalClass: 'switchTools',
    getRow: getBottomRow,
    getTools: getSwitchTools,
  },
};

const toolbars = new Map<ToolTypes, OnScreenToolbar>();
/** During a scene load (p806 D7): every control `aria-disabled`, its tooltip saying why */
let isLoading = false;

/** Shows a group's tools now: refreshed in place when they're the same tools, else rebuilt where
 * the group was, with the focus on the same tool; removed when it isn't shown. */
const syncGroup = (type: ToolTypes) => {
  const def = GROUPS[type];
  const tools = def.getTools();
  const current = toolbars.get(type) ?? null;
  if (!tools?.length) {
    current?.cmp.remove();
    toolbars.delete(type);
    return;
  }
  if (current?.signature === getOnScreenToolsSignature(tools)) {
    current.refresh(isLoading);
    return;
  }
  const focusedKey = current?.getFocusedKey() ?? null;
  const toolbar = createOnScreenToolbar({
    label: def.label,
    items: tools,
    exclusive: def.exclusive,
    class: [def.globalClass],
  });
  const row = def.getRow();
  row.add(toolbar.cmp);
  if (current) current.cmp.elem.before(toolbar.cmp.elem);
  else if (def.isFirst) row.elem.prepend(toolbar.cmp.elem);
  current?.cmp.remove();
  toolbars.set(type, toolbar);
  toolbar.refresh(isLoading);
  if (focusedKey) toolbar.focusKey(focusedKey);
};

/**
 * Opens an on-screen dropdown's list on its current option (the o and p shortcuts), or closes it
 * when it is open. An open other dropdown closes (its list loses the focus).
 * @param key ('CAMERA' | 'SCENE') the dropdown
 */
export const _toggleOnScreenDropDown = (key: OnScreenDropDownKey) => {
  toolbars.get('SWITCH')?.getDropDown(key)?.toggle();
};

/** Builds (or refreshes) every on-screen tools group: the main loop's debug start. */
export const _InitOnScreenTools = () => {
  if (!IS_DEBUG_ENV && !IS_PROD_TEST_MODE) return;
  if (IS_PROD_TEST_MODE) {
    syncGroup('PLAY');
    return;
  }
  syncGroup('UNDO');
  syncGroup('VIEW');
  syncGroup('PLAY');
  syncGroup('SWITCH');
};

/** Refreshes the given groups (all of them by default) after a state they show changed. */
export const _updateOnScreenTools = (tools?: ToolTypes[] | ToolTypes) => {
  if (!IS_DEBUG_ENV && !IS_PROD_TEST_MODE) return;
  if (IS_PROD_TEST_MODE || !tools) {
    _InitOnScreenTools();
    return;
  }
  if (Array.isArray(tools)) {
    for (let i = 0; i < tools.length; i++) syncGroup(tools[i]);
    return;
  }
  syncGroup(tools);
};

/**
 * Disables every on-screen tool during a scene load, or enables them again (p806 D7, closing
 * `docs/issues/on-screen-tools-during-scene-load.md`): each control is `aria-disabled` (still
 * focusable, so the focus stays where it is) with the tooltip "Loading the scene…", its clicks are
 * ignored, and an open drop-down closes. The debug keys stop by themselves (their maps' context).
 * `_disableDebugger`'s.
 */
export const _setOnScreenToolsDisabled = (disable: boolean) => {
  if (!IS_DEBUG_ENV || isLoading === disable) return;
  isLoading = disable;
  for (const toolbar of toolbars.values()) toolbar.refresh(disable);
};

/**
 * The on-screen tools' groups and rows, for the tests.
 * @internal
 */
export const _getOnScreenToolsTestInfo = () => ({
  rows: [topLeftRowCMP, topRowCMP, bottomRowCMP].filter((row): row is CMPHandle => row !== null),
  isDisabled: isLoading,
});
