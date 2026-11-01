// The Physics API tab's and the physics entity window's shared state: the LS keys, the folders'
// open states, the global wireframe palette's persistence, the physics entities' lookups and the
// edit window's ids. Its own module so the tab, its folders and the window import it, never each
// other (the tab registers the window's kind by importing the window's module).
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { getKindWindowId } from '../../../ui/overlays/windows/DraggableWindow';
import { getECSWorld, getEntityIdByAppId, getStableAppId } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import {
  getGlobalWireframeColorOverrides,
  getWireframeLineThickness,
  getWireframeLineThicknessDefault,
  getWireframePoseSource,
  setGlobalWireframeColors,
  setGlobalWireframeLineThickness,
  setWireframePoseSource,
  DEFAULT_WIREFRAME_POSE_SOURCE,
  type WireframeColorState,
  type WireframePoseSource,
} from './_dbg__PhysicsDebugDraw';

export const PHYSICS_LS_KEY = 'AEK_debugPhysicsApi';
export const PHYSICS_TAB_ID = 'physicsApiControls';
/** Wireframe colors/thickness get their own key so "Clear tab LS" on the main physics
 * settings doesn't silently wipe the user's palette, and vice versa. */
export const PHYSICS_WIREFRAME_LS_KEY = 'AEK_debugPhysicsApiWireframe';
/** Pure UI state (which folders are open), kept apart from the settings keys so
 * "Reset all wireframe settings" doesn't also collapse the folder you're working in. It is the
 * tab's UI key (`${PHYSICS_LS_KEY}UI`): the tab keeps its folder states under `folders`, the edit
 * window its own field next to them. */
export const PHYSICS_UI_LS_KEY = 'AEK_debugPhysicsApiUI';

/** The edit windows' kind: one window per physics entity, keyed by its stable app id (the entity
 * id without one, see getPhysWinKey) */
export const EDIT_PHYS_ENTITY_WIN_ID = 'physicsApiEntityEditorWindow';

type PhysicsUIState = { entityWireframeFolderExpanded: boolean };

let physicsUIState: PhysicsUIState = { entityWireframeFolderExpanded: false };

/** Reads the edit window's folder state from the UI key (the tab's registration) */
export const loadPhysicsUIState = () => {
  physicsUIState = { ...physicsUIState, ...lsGetItem(PHYSICS_UI_LS_KEY, physicsUIState) };
};

/** Whether the edit window's "Debug wireframe" folder opens, shared by every entity's window */
export const isEntityWireframeFolderExpanded = () => physicsUIState.entityWireframeFolderExpanded;

/** Saves the edit window's folder state, merged so the tab's own folder states in the same key are
 * kept */
export const setEntityWireframeFolderExpanded = (expanded: boolean) => {
  physicsUIState.entityWireframeFolderExpanded = expanded;
  lsSetItem(PHYSICS_UI_LS_KEY, {
    ...(lsGetItem(PHYSICS_UI_LS_KEY, {}) as object),
    ...physicsUIState,
  });
};

type PersistedWireframeState = {
  colors?: Partial<Record<WireframeColorState, number>>;
  lineThickness?: number;
  poseSource?: WireframePoseSource;
};

/** Human-readable labels for the color pickers, phrased as the condition each one paints. */
export const WIREFRAME_STATE_LABELS: Record<WireframeColorState, string> = {
  tierDisabled: 'Tier DISABLED',
  tierStatic: 'Tier STATIC',
  disabled: 'Disabled (collider or its body)',
  sensor: 'Sensor',
  sleeping: 'Sleeping',
  kinematic: 'Kinematic',
  fixed: 'Fixed / static',
  awake: 'Awake / active',
};

/** Pushes any persisted palette into the draw module. Runs at boot rather than when the
 * tab is first opened, so wireframes come up in the user's colors even if they never
 * click into this tab. */
export const restoreWireframeState = () => {
  const saved = lsGetItem(PHYSICS_WIREFRAME_LS_KEY, {}) as PersistedWireframeState;
  if (saved.colors) setGlobalWireframeColors(saved.colors);
  if (typeof saved.lineThickness === 'number') {
    setGlobalWireframeLineThickness(saved.lineThickness);
  }
  if (saved.poseSource === 'PHYSICS' || saved.poseSource === 'RENDERED') {
    setWireframePoseSource(saved.poseSource);
  }
};

/** Persists only what the user actually overrode — an untouched state stays absent, so it
 * keeps tracking the CONFIG.ts default if that changes later. */
export const persistWireframeState = () => {
  const colors = getGlobalWireframeColorOverrides();
  const lineThickness = getWireframeLineThickness();
  const isDefaultThickness = lineThickness === getWireframeLineThicknessDefault();
  const payload: PersistedWireframeState = {};
  if (Object.keys(colors).length) payload.colors = colors;
  if (!isDefaultThickness) payload.lineThickness = lineThickness;
  const poseSource = getWireframePoseSource();
  if (poseSource !== DEFAULT_WIREFRAME_POSE_SOURCE) payload.poseSource = poseSource;
  if (!Object.keys(payload).length) {
    lsRemoveItem(PHYSICS_WIREFRAME_LS_KEY);
    return;
  }
  lsSetItem(PHYSICS_WIREFRAME_LS_KEY, payload);
};

const PHYSICS_ENTITY_COMPONENT_TYPES = [
  ComponentType.BODY_STATIC,
  ComponentType.BODY_DYNAMIC_VISUAL,
  ComponentType.BODY_DYNAMIC_HEADLESS,
] as const;

/** The current world's physics entities, each once */
export const getAllPhysicsEntityIds = (): number[] => {
  const world = getECSWorld();
  const ids = new Set<number>();
  for (const type of PHYSICS_ENTITY_COMPONENT_TYPES) {
    for (const [entityId] of world.getStorage(type)) {
      ids.add(entityId);
    }
  }
  return [...ids];
};

/** A physics entity's rigid body in the current world, from whichever body bucket holds it */
export const getPhysicsEntityRigidBody = (entityId: number) => {
  const world = getECSWorld();
  for (const type of PHYSICS_ENTITY_COMPONENT_TYPES) {
    const rigidBody = world.getComponent(entityId, type);
    if (rigidBody) return rigidBody;
  }
  return undefined;
};

/** A physics entity's name in the list and the window's title: its app id, its object's name or
 * its entity id */
export const getPhysicsEntityLabel = (entityId: number): string => {
  const world = getECSWorld();
  const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
  if (appId) return appId;
  const obj3D = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (obj3D?.name) return obj3D.name;
  return `[${entityId}]`;
};

/** An edit window's data */
export type PhysEntityWinData = { entityId: number; appId?: string };

/** The edit window's entity: by its stable appId first (the raw entity id doesn't survive a scene
 * change), by the raw entity id only when the entity has no stable appId. */
export const getPhysWinEntityId = (data?: { [key: string]: unknown }) => {
  const d = (data || {}) as Partial<PhysEntityWinData>;
  return d.appId ? getEntityIdByAppId(d.appId) : d.entityId;
};

/** An entity's edit window key: its stable appId (found again after a scene change or a
 * reload), else its entity id (session only: the resolver never keeps such a window). */
export const getPhysWinKey = (data: PhysEntityWinData) => data.appId ?? String(data.entityId);

/** The entity's edit window id (the list's row id is the entity id). */
export const getPhysWinId = (entityId: number) =>
  getKindWindowId(
    EDIT_PHYS_ENTITY_WIN_ID,
    getPhysWinKey({ entityId, appId: getStableAppId(entityId) })
  );

/** Refreshes the tab: its readouts, and the list's selection, which follows the edit windows */
export const refreshPhysicsTab = () => updateDebuggerTab(PHYSICS_TAB_ID);
