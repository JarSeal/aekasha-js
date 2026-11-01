// The camera edit window (p806 D10): a debug window per camera on the UI kit's property grid. A
// change applies on every write and is saved per scene (`AEK_debugCams`) and recorded for undo
// when its gesture ends.
import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../ecs/ECS';
import { getECSWorld, getEntityIdByAppId, getStableAppId } from '../../ecs/ECS';
import { ComponentType, type CoreComponentData } from '../../ecs/ECSCoreComponents';
import { CMP } from '../../../ui/core/CMP';
import type { PropertyGridFieldItem, PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import type { FieldChange } from '../../../ui/forms/Field';
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import {
  closeDraggableWindow,
  getKindWindowId,
} from '../../../ui/overlays/windows/DraggableWindow';
import {
  createDebugWindowGrid,
  getEntityInfoItems,
  getReasonedButtonItem,
} from '../../../debug/_dbg__DebugWindowGrid';
import { getActiveCameraId, getAllCamerasAsArray, applyCameraProjection } from '../Camera';
import { getCanvasSize } from '../../render/CanvasSize';
import { lwarn } from '../../../utils/Logger';
import {
  _recordOrCoalesceUndoRedoAction,
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import {
  CAMERAS_TAB_ID,
  EDIT_CAMERA_WIN_ID,
  clearCameraFromLS,
  loadCameraDebugData,
  saveCameraToLS,
  setCameraHelperVisible,
  updateCamerasDebuggerGUI,
  type CamEntityDebugState,
} from './_dbg__CameraDebugState';

// Undo/redo

/** Edit window fields recorded to the (per-scene) undo/redo history. */
const UNDOABLE_CAM_KEYS = [
  'position',
  'responsiveAspect',
  'referenceAspect',
  'fov',
  'frustumSize',
  'near',
  'far',
] as const;
type UndoableCamKey = (typeof UNDOABLE_CAM_KEYS)[number];
type UndoableCamValues = { [K in UndoableCamKey]: NonNullable<CamEntityDebugState[K]> };
type CamUndoPayload<K extends UndoableCamKey> = {
  appId: string;
  prev: UndoableCamValues[K];
  next: UndoableCamValues[K];
};

const UNDOABLE_CAM_LABELS: Record<UndoableCamKey, string> = {
  position: 'position',
  responsiveAspect: 'responsive aspect',
  referenceAspect: 'reference aspect',
  fov: 'fov',
  frustumSize: 'frustum size',
  near: 'near',
  far: 'far',
};

/** Number fields: changes made in quick succession (key presses) are merged into one entry. */
const COALESCED_CAM_KEYS: ReadonlySet<UndoableCamKey> = new Set([
  'referenceAspect',
  'fov',
  'frustumSize',
  'near',
  'far',
]);

/** Finds the camera by app id at undo/redo time (never a captured reference). */
const resolveCamera = (appId: string) => {
  const world = getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  const camera =
    entityId !== undefined ? world.getComponent(entityId, ComponentType.OBJECT3D)?.value : null;
  const settings =
    entityId !== undefined ? world.getComponent(entityId, ComponentType.CAMERA_SETTINGS) : null;
  if (entityId === undefined || !(camera instanceof THREE.Camera) || !settings) {
    lwarn(`Undo/redo: camera "${appId}" no longer exists, skipping.`);
    return null;
  }
  return {
    world,
    entityId,
    camera: camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
    settings,
  };
};

type ResolvedCamera = NonNullable<ReturnType<typeof resolveCamera>>;

/** Applies a value the same way the edit window's own control does. */
const applyCamField: {
  [K in UndoableCamKey]: (cam: ResolvedCamera, value: UndoableCamValues[K]) => void;
} = {
  position: ({ world, entityId }, value) => world.setTransform(entityId, { pos: value }),
  responsiveAspect: ({ camera, settings }, value) => {
    settings.responsiveAspect = value;
    applyCameraProjection(camera, settings, getCanvasSize().aspect);
  },
  referenceAspect: ({ camera, settings }, value) => {
    settings.referenceAspect = value;
    applyCameraProjection(camera, settings, getCanvasSize().aspect);
  },
  // Goes through settings.fov in both modes: applyCameraProjection derives the live fov from it.
  fov: ({ camera, settings }, value) => {
    settings.fov = value;
    applyCameraProjection(camera, settings, getCanvasSize().aspect);
  },
  frustumSize: ({ camera, settings }, value) => {
    settings.frustumSize = value;
    applyCameraProjection(camera, settings, getCanvasSize().aspect);
  },
  near: ({ camera }, value) => {
    camera.near = value;
    camera.updateProjectionMatrix();
  },
  far: ({ camera }, value) => {
    camera.far = value;
    camera.updateProjectionMatrix();
  },
};

const setCamField = <K extends UndoableCamKey>(
  key: K,
  appId: string,
  value: UndoableCamValues[K]
) => {
  const cam = resolveCamera(appId);
  if (!cam) return;
  applyCamField[key](cam, value);
  saveCameraToLS(cam.entityId, key, value);
  updateCamerasDebuggerGUI('WINDOW', appId);
};

const registerCamUndoHandler = <K extends UndoableCamKey>(key: K) => {
  _registerUndoRedoActionHandler<CamUndoPayload<K>>(`camera.${key}`, {
    undo: ({ appId, prev }) => setCamField(key, appId, prev),
    redo: ({ appId, next }) => setCamField(key, appId, next),
  });
};
for (const key of UNDOABLE_CAM_KEYS) registerCamUndoHandler(key);

// The window

/** What the window's items act on */
type CamWindowContext = {
  world: ECSWorld;
  entityId: number;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  settings: CoreComponentData[typeof ComponentType.CAMERA_SETTINGS];
  /** Its stable app id, if it has one: a generated app id can't be found again after a reload, so only
   * a camera with a stable one is recorded */
  stableAppId: string | undefined;
  /** Re-reads the grid (the hidden fields, the clear button) */
  refresh: () => void;
};

/**
 * A field's change handler: `apply` on every write; at the gesture's end the value is saved and
 * recorded with the gesture's `prev` (p804 D3), and the grid re-read.
 */
const onCamChange =
  <K extends UndoableCamKey>(
    ctx: CamWindowContext,
    key: K,
    apply?: (value: UndoableCamValues[K]) => void
  ) =>
  (value: unknown, change: FieldChange<unknown>) => {
    const next = value as UndoableCamValues[K];
    apply?.(next);
    if (!change.last) return;
    saveCameraToLS(ctx.entityId, key, next);
    ctx.refresh();
    const prev = change.prev as UndoableCamValues[K];
    if (!ctx.stableAppId || JSON.stringify(prev) === JSON.stringify(next)) return;
    const payload: CamUndoPayload<K> = { appId: ctx.stableAppId, prev, next };
    const label = `Camera ${ctx.stableAppId}: ${UNDOABLE_CAM_LABELS[key]}`;
    if (COALESCED_CAM_KEYS.has(key)) {
      _recordOrCoalesceUndoRedoAction(`camera.${key}`, label, payload, `${ctx.stableAppId}.${key}`);
    } else {
      _recordUndoRedoAction(`camera.${key}`, label, payload);
    }
  };

/**
 * The lens folder's items. Responsive aspect compensation (Hor+) keeps the horizontal fov or
 * world width about the same across aspect ratios, which makes the fov or frustum size the value
 * authored at the reference aspect: its field is named so (one of two, the other hidden).
 */
const getLensItems = (ctx: CamWindowContext): PropertyGridItem[] => {
  const { camera, settings } = ctx;
  const project = () => applyCameraProjection(camera, settings, getCanvasSize().aspect);
  // The fields edit the authored settings, not the live camera: applyCameraProjection derives the
  // live fov from settings.fov, so a direct camera.fov edit would revert on the next resize
  const baseItem = (responsive: boolean): PropertyGridFieldItem => {
    const hidden = () => settings.responsiveAspect !== responsive;
    const base = responsive ? ' (base, @ ref aspect)' : '';
    return settings.type === 'PERSPECTIVE'
      ? {
          target: settings,
          key: 'fov',
          label: `Fov${base}`,
          min: 1,
          max: 170,
          step: 1,
          hidden,
          onChange: onCamChange(ctx, 'fov', project),
        }
      : {
          target: settings,
          key: 'frustumSize',
          label: `Frustum size${base}`,
          min: 0.1,
          step: 0.1,
          hidden,
          onChange: onCamChange(ctx, 'frustumSize', project),
        };
  };
  const updateProjection = () => camera.updateProjectionMatrix();
  return [
    {
      target: settings,
      key: 'responsiveAspect',
      label: 'Responsive aspect',
      onChange: onCamChange(ctx, 'responsiveAspect', project),
    },
    {
      target: settings,
      key: 'referenceAspect',
      label: 'Reference aspect',
      min: 0.1,
      step: 0.01,
      onChange: onCamChange(ctx, 'referenceAspect', project),
    },
    baseItem(false),
    baseItem(true),
    {
      target: camera,
      key: 'near',
      label: 'Near',
      min: 0.001,
      step: 0.01,
      onChange: onCamChange(ctx, 'near', updateProjection),
    },
    {
      target: camera,
      key: 'far',
      label: 'Far',
      min: 1,
      step: 1,
      onChange: onCamChange(ctx, 'far', updateProjection),
    },
  ];
};

/** Why a camera can't be deleted from its edit window, or null: the scene renders through the
 * active camera (the debug camera's toggle returns to the main one), and needs one camera. */
const getCameraDeleteBlocker = (entityId: number, world: ECSWorld) => {
  if (getAllCamerasAsArray().length <= 1) return 'the only camera';
  if (world === getECSWorld() && entityId === getActiveCameraId()) {
    return 'the active camera (make another one active first)';
  }
  if (world.hasComponent(entityId, ComponentType.TAG_IS_MAIN_CAMERA)) {
    return 'the main camera (make another one the main camera first)';
  }
  return null;
};

/** The clear and delete buttons */
const getButtonItems = (
  ctx: CamWindowContext,
  appId: string | undefined,
  winId: string
): PropertyGridItem[] => {
  const getDeleteReason = () => {
    const blocker = getCameraDeleteBlocker(ctx.entityId, ctx.world);
    return blocker ? `Can't delete ${blocker}` : null;
  };
  return [
    {
      type: 'button',
      title: 'Clear local storage',
      disabled: () => !loadCameraDebugData(appId),
      onClick: () => {
        if (appId) clearCameraFromLS(appId);
        ctx.refresh();
      },
    },
    getReasonedButtonItem({
      title: 'Delete camera',
      getDisabledReason: getDeleteReason,
      onClick: () => {
        // Checked again: the active camera may have changed since the last refresh
        const reason = getDeleteReason();
        if (reason) {
          lwarn(`Could not delete camera "${appId}": ${reason}`);
          ctx.refresh();
          return;
        }
        closeDraggableWindow(winId);
        ctx.world.deleteEntity(ctx.entityId);
        // deleteEntity fires disposeCamera's onDeleteEntity hook (which already refreshes this
        // list) before clearing the entity's component storages, so that refresh still sees the
        // entity in TAG_IS_CAMERA. Refresh again now that deletion has fully completed.
        updateCamerasDebuggerGUI('LIST');
      },
    }),
  ];
};

/** Content for the Edit Camera Draggable Window */
export const createEditCameraContent = (data?: { [key: string]: unknown }) => {
  const d = data as { id: string };
  const winId = getKindWindowId(EDIT_CAMERA_WIN_ID, d.id);
  const world = getECSWorld();
  const entityId = getEntityIdByAppId(d.id);

  if (!entityId || !world.isAlive(entityId)) return CMP({ text: 'Camera not found' });

  const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
  const settings = world.getComponent(entityId, ComponentType.CAMERA_SETTINGS);
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
  const debugData = world.getComponent(entityId, ComponentType.DEBUG_DATA);
  const helperComp = world.getComponent(entityId, ComponentType.DEBUG_CAMERA_HELPER);

  if (!objComp || !(objComp.value instanceof THREE.Camera) || !settings) return CMP();

  let refreshGrid = () => {};
  const ctx: CamWindowContext = {
    world,
    entityId,
    camera: objComp.value as THREE.PerspectiveCamera | THREE.OrthographicCamera,
    settings,
    stableAppId: getStableAppId(entityId, world),
    refresh: () => refreshGrid(),
  };

  const items: PropertyGridItem[] = [];
  if (helperComp) {
    items.push({
      label: 'Show helper',
      get: () => helperComp.value.visible,
      set: (show) => setCameraHelperVisible(entityId, world, show as boolean),
      onChange: () => {
        ctx.refresh();
        updateDebuggerTab(CAMERAS_TAB_ID);
      },
    });
  }
  if (transform) {
    items.push({
      label: 'Position',
      get: () => transform.position,
      set: (pos) => world.setTransform(entityId, { pos: pos as UndoableCamValues['position'] }),
      onChange: onCamChange(ctx, 'position'),
    });
  }
  items.push(
    { type: 'folder', id: 'lens', title: 'Lens settings', items: getLensItems(ctx) },
    ...getButtonItems(ctx, appId, winId),
    ...getEntityInfoItems({
      entityId,
      appId,
      type: settings.type,
      name: debugData?.name,
      description: debugData?.description,
    })
  );

  const { cmp, grid } = createDebugWindowGrid({
    items,
    folderExpanded: { lens: loadCameraDebugData(appId)?._lensSettingsOpen ?? false },
    onFolderExpandedChange: (_id, expanded) => {
      saveCameraToLS(entityId, '_lensSettingsOpen', expanded);
      ctx.refresh();
    },
  });
  refreshGrid = grid.refresh;

  // The content is built before the window state is open: refresh the list selection after it
  queueMicrotask(() => updateDebuggerTab(CAMERAS_TAB_ID));
  return cmp;
};
