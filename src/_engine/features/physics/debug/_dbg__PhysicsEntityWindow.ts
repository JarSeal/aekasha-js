// The physics entity edit window (p806 D10): a debug window per physics entity on the UI kit's
// property grid. Its pose rows (_dbg__BodyPoseItems.ts) edit a copy, which the Set buttons apply
// to the body, recorded per scene for undo; the "Debug wireframe" folder shows the entity's
// collider wireframe and overrides the global palette for it alone. The window's kind, its undo
// handlers and the profiler's opener register at this module's load.
import { CMP } from '../../../ui/core/CMP';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import {
  closeDraggableWindow,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
  updateDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import { createDebugWindowGrid, getEntityInfoItems } from '../../../debug/_dbg__DebugWindowGrid';
import { registerEntityWindowOpener } from '../../../debug/Profiler';
import {
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import {
  getECSWorld,
  getEntityIdByAppId,
  getStableAppId,
  type ECSWorld,
} from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { llog, lwarn } from '../../../utils/Logger';
import { RigidBodyTypeAPI, type RigidBodyAPI } from '../types/PhysicsBodyTypes';
import { ShapeType } from '../types/PhysicsColliderTypes';
import {
  getEntityWireframeColor,
  getWireframeColors,
  isWireframePersistable,
  isWireframeVisible,
  resetEntityWireframeColors,
  setEntityWireframeColor,
  setWireframeVisible,
  WIREFRAME_COLOR_STATES,
} from './_dbg__PhysicsDebugDraw';
import {
  EDIT_PHYS_ENTITY_WIN_ID,
  WIREFRAME_STATE_LABELS,
  getPhysWinEntityId,
  getPhysWinId,
  getPhysWinKey,
  getPhysicsEntityLabel,
  getPhysicsEntityRigidBody,
  isEntityWireframeFolderExpanded,
  refreshPhysicsTab,
  setEntityWireframeFolderExpanded,
  type PhysEntityWinData,
} from './_dbg__PhysicsDebugState';
import { getBodyPoseItems } from './_dbg__BodyPoseItems';

// Undo/redo

/** Physics entity poses set from the edit window, recorded to the scene's history. */
type PhysVec3 = { x: number; y: number; z: number };
type PhysQuat = { x: number; y: number; z: number; w: number };
type PhysicsObjectUndoPayload<T> = { appId: string; prev: T; next: T };

/** Finds the rigid body by app id at undo/redo time (never a captured reference). */
const resolvePhysicsEntityRigidBody = (appId: string) => {
  const entityId = getEntityIdByAppId(appId);
  const rigidBody = entityId !== undefined ? getPhysicsEntityRigidBody(entityId) : undefined;
  if (!rigidBody) lwarn(`Undo/redo: physics entity "${appId}" no longer exists, skipping.`);
  return rigidBody;
};

// Only the pose is restored: the body keeps simulating, so its velocity isn't rolled back.
_registerUndoRedoActionHandler<PhysicsObjectUndoPayload<PhysVec3>>('physicsObject.position', {
  undo: ({ appId, prev }) => resolvePhysicsEntityRigidBody(appId)?.setTranslation(prev, true),
  redo: ({ appId, next }) => resolvePhysicsEntityRigidBody(appId)?.setTranslation(next, true),
});
_registerUndoRedoActionHandler<PhysicsObjectUndoPayload<PhysQuat>>('physicsObject.rotation', {
  undo: ({ appId, prev }) => resolvePhysicsEntityRigidBody(appId)?.setRotation(prev, true),
  redo: ({ appId, next }) => resolvePhysicsEntityRigidBody(appId)?.setRotation(next, true),
});

// The window

/** What the window's items act on */
type PhysWindowContext = {
  world: ECSWorld;
  entityId: number;
  rigidBody: RigidBodyAPI;
  /** Its stable app id, if it has one: a generated app id can't be found again after a reload, so
   * only an entity with a stable one is recorded */
  stableAppId: string | undefined;
  /** Re-reads the grid */
  refresh: () => void;
};

const BODY_TYPE_LABELS: Record<RigidBodyTypeAPI, string> = {
  [RigidBodyTypeAPI.Dynamic]: 'Dynamic body',
  [RigidBodyTypeAPI.Fixed]: 'Fixed body',
  [RigidBodyTypeAPI.KinematicPositionBased]: 'Kinematic body (position based)',
  [RigidBodyTypeAPI.KinematicVelocityBased]: 'Kinematic body (velocity based)',
};

/** The pose rows, each Set recorded to the scene's history (an entity with a stable app id only) */
const getPoseItems = (ctx: PhysWindowContext): PropertyGridItem[] =>
  getBodyPoseItems({
    rigidBody: ctx.rigidBody,
    refresh: ctx.refresh,
    onSet: ({ field, prev, next }) => {
      if (!ctx.stableAppId || JSON.stringify(prev) === JSON.stringify(next)) return;
      _recordUndoRedoAction<PhysicsObjectUndoPayload<typeof next>>(
        `physicsObject.${field}`,
        `Physics entity ${ctx.stableAppId}: ${field}`,
        { appId: ctx.stableAppId, prev, next }
      );
    },
  });

/**
 * The "Debug wireframe" folder's items: the visibility toggle, and a colour per state that
 * overrides the global palette for this entity only. A colour without an override shows the
 * global one, and its "Reset to default" clears the override, so it tracks the global again.
 */
const getWireframeItems = (ctx: PhysWindowContext): PropertyGridItem[] => {
  const { entityId, world } = ctx;
  const items: PropertyGridItem[] = [
    {
      label: 'Show wireframe',
      get: () => isWireframeVisible(entityId, world),
      set: (visible) => setWireframeVisible(entityId, world, visible as boolean),
      onChange: () => refreshPhysicsTab(),
    },
  ];
  // Without an app-supplied appId an entity's id is a fresh UUID every load, so nothing
  // below can be keyed to it across reloads. Say so rather than letting the settings look
  // like they silently failed to save.
  if (!isWireframePersistable(entityId, world)) {
    items.push({
      label: 'Persistence',
      value: 'Session only (entity has no appId)',
      readonly: true,
      interval: 'refresh',
    });
  }
  for (const state of WIREFRAME_COLOR_STATES) {
    items.push(
      {
        label: WIREFRAME_STATE_LABELS[state],
        kind: 'color',
        get: () => getEntityWireframeColor(entityId, state) ?? getWireframeColors()[state],
        set: (color) => setEntityWireframeColor(entityId, world, state, color as number),
      },
      {
        type: 'button',
        title: 'Reset to default',
        onClick: () => {
          setEntityWireframeColor(entityId, world, state, undefined);
          ctx.refresh();
        },
      }
    );
  }
  items.push({
    type: 'button',
    title: 'Reset all to default',
    onClick: () => {
      resetEntityWireframeColors(entityId, world);
      ctx.refresh();
    },
  });
  return items;
};

/**
 * The entity's info rows, its collider shapes last: a monitor that reads "Loading…" until the
 * shapes resolve (asynchronously: ColliderAPI.shapeType()), then refreshes the grid unless the
 * window closed meanwhile.
 */
const getInfoItems = (ctx: PhysWindowContext, isClosed: () => boolean): PropertyGridItem[] => {
  const { world, entityId } = ctx;
  const colliders = world.getComponent(entityId, ComponentType.COLLIDER);
  const debugData = world.getComponent(entityId, ComponentType.DEBUG_DATA);
  const shapes = { text: colliders?.length ? 'Loading…' : 'No collider' };
  if (colliders?.length) {
    Promise.all(colliders.map((collider) => collider.shapeType())).then(
      (shapeTypes) => {
        if (isClosed()) return;
        shapes.text = shapeTypes.map((type) => ShapeType[type] ?? '[UNKNOWN]').join(', ');
        ctx.refresh();
      },
      // Eg. the entity deleted before the worker answered (the window closes with it)
      () => {
        if (isClosed()) return;
        shapes.text = 'Unavailable';
        ctx.refresh();
      }
    );
  }
  return [
    ...getEntityInfoItems({
      entityId,
      appId: world.getComponent(entityId, ComponentType.APP_ID)?.id,
      type: BODY_TYPE_LABELS[ctx.rigidBody.bodyTypeSync()] ?? 'Unknown body',
      name: world.getComponent(entityId, ComponentType.OBJECT3D)?.value.name || debugData?.name,
      description: debugData?.description,
    }),
    {
      label: colliders && colliders.length > 1 ? 'Colliders' : 'Collider',
      get: () => shapes.text,
      readonly: true,
      interval: 'refresh',
    },
  ];
};

/** Content for the physics entity's edit window */
export const createEditPhysicsEntityContent = (data?: { [key: string]: unknown }) => {
  const winId = getKindWindowId(EDIT_PHYS_ENTITY_WIN_ID, getPhysWinKey(data as PhysEntityWinData));
  const entityId = getPhysWinEntityId(data);
  const world = getECSWorld();

  const rigidBody = entityId === undefined ? undefined : getPhysicsEntityRigidBody(entityId);
  if (entityId === undefined || !rigidBody) {
    // We want to close the window when no entity is found,
    // but we have to return first, so wait one iteration.
    setTimeout(() => closeDraggableWindow(winId), 0);
    return CMP();
  }

  // The content is built before the window state is open: refresh the list selection after it
  queueMicrotask(refreshPhysicsTab);

  let refreshGrid = () => {};
  let isClosed = false;
  const ctx: PhysWindowContext = {
    world,
    entityId,
    rigidBody,
    stableAppId: getStableAppId(entityId, world),
    refresh: () => refreshGrid(),
  };

  const items: PropertyGridItem[] = [
    ...getPoseItems(ctx),
    { type: 'separator' },
    { type: 'folder', id: 'wireframe', title: 'Debug wireframe', items: getWireframeItems(ctx) },
    {
      type: 'button',
      title: 'Log to the console',
      onClick: () => {
        const colliders = world.getComponent(entityId, ComponentType.COLLIDER);
        llog('PHYSICS ENTITY:***************', { entityId, rigidBody, colliders });
      },
    },
    {
      type: 'button',
      title: 'Delete physics entity',
      variant: 'danger',
      onClick: () => {
        // Removes the ECS entity and its rigid body and colliders
        world.deleteEntity(entityId);
        closeDraggableWindow(winId);
      },
    },
    ...getInfoItems(ctx, () => isClosed),
  ];

  const { cmp, grid } = createDebugWindowGrid({
    items,
    folderExpanded: { wireframe: isEntityWireframeFolderExpanded() },
    onFolderExpandedChange: (_id, expanded) => setEntityWireframeFolderExpanded(expanded),
    onRemove: () => {
      isClosed = true;
    },
  });
  refreshGrid = grid.refresh;
  return cmp;
};

/** List row click: opens the entity's window, brings it to the front, or closes it when on top. */
export const toggleEditPhysicsEntityWindow = (itemId: string) => {
  const entityId = Number(itemId);
  const data: PhysEntityWinData = { entityId, appId: getStableAppId(entityId) };
  toggleDraggableWindow({
    id: getKindWindowId(EDIT_PHYS_ENTITY_WIN_ID, getPhysWinKey(data)),
    kind: EDIT_PHYS_ENTITY_WIN_ID,
    position: { x: 110, y: 60 },
    size: { w: 400, h: 400 },
    saveToLS: true,
    title: `Edit physics entity: ${getPhysicsEntityLabel(entityId)}`,
    isDebugWindow: true,
    data,
    closeOnSceneChange: true,
  });
};

/** List toggle: the same setter as the edit window's "Show wireframe" field. */
export const togglePhysicsEntityWireframe = (itemId: string, next: boolean) => {
  const entityId = Number(itemId);
  setWireframeVisible(entityId, getECSWorld(), next);
  updateDraggableWindow(getPhysWinId(entityId));
};

registerDraggableWindowKind(EDIT_PHYS_ENTITY_WIN_ID, {
  content: createEditPhysicsEntityContent,
  onClose: refreshPhysicsTab,
  // Kept open on a scene change when the next scene has a physics entity with the same stable
  // appId
  sceneTargetResolver: (data) => {
    if (!(data as Partial<PhysEntityWinData>)?.appId) return false;
    const entityId = getPhysWinEntityId(data);
    return entityId !== undefined && Boolean(getPhysicsEntityRigidBody(entityId));
  },
});

// The profiler's heaviest objects open a physics entity's window too
registerEntityWindowOpener({
  id: 'physicsEntity',
  label: 'Edit physics entity',
  canOpen: (world, entityId) =>
    world === getECSWorld() && Boolean(getPhysicsEntityRigidBody(entityId)),
  toggle: (_world, entityId) => toggleEditPhysicsEntityWindow(String(entityId)),
});
