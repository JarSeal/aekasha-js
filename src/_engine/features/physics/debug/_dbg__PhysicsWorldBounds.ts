// The Physics API tab's world bounds (p102 Phase 3): the "World bounds" folder (the current world's
// box, where it comes from, its action, the scene's exit count, the toggle that draws it) and the
// list of the latest exits, whose rows open the exited entity's edit window. Its own module: the list opens the window, and
// the tab's folders module doesn't import the window's (see _dbg__PhysicsDebugState.ts).
import {
  debuggerListCMP,
  type DebuggerListItem,
  type DebuggerPaneItem,
} from '../../../debug/DebuggerGUI';
import { getDraggableWindowsOfKind } from '../../../ui/overlays/windows/DraggableWindow';
import { getECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { getWorldBoundsStats } from '../PhysicsWorldBounds';
import type { PhysicsState } from '../types/PhysicsConfigTypes';
import type { WorldBoundsExitInfo, WorldBoundsStats } from '../types/PhysicsWorldBoundsTypes';
import {
  EDIT_PHYS_ENTITY_WIN_ID,
  getPhysWinEntityId,
  getPhysicsEntityRigidBody,
  isWorldBoundsBoxShownSaved,
  setWorldBoundsBoxShownSaved,
} from './_dbg__PhysicsDebugState';
import { toggleEditPhysicsEntityWindow } from './_dbg__PhysicsEntityWindow';
import {
  canDrawWorldBounds,
  formatBoundsNumber,
  formatWorldBoundsBox,
  isWorldBoundsBoxShown,
  setWorldBoundsBoxShown,
} from './_dbg__WorldBoundsDraw';

const SOURCE_LABELS: Record<WorldBoundsStats['source'], string> = {
  SCENE: "The scene's (setSceneWorldBounds)",
  CONFIG: "The app's default (AppConfig.physics.worldBounds)",
  NONE: 'None',
};

/** The folder's values, synced by the tab's onRefresh (readonly bindings poll it). */
const boundsReadout = { box: '', source: '', action: '', exits: 0, ownBounds: 0 };

/** Syncs the "World bounds" folder's values: part of the tab's `onRefresh`. */
export const refreshWorldBoundsReadout = () => {
  const { def, source, exitCount } = getWorldBoundsStats();
  boundsReadout.box = def ? formatWorldBoundsBox(def) : source === 'SCENE' ? 'Off' : 'None';
  boundsReadout.source = SOURCE_LABELS[source];
  const action = def?.action ?? 'DELETE';
  boundsReadout.action = !def
    ? '-'
    : action === 'CALLBACK' && !def.onExit
      ? 'CALLBACK without onExit (acts as DISABLE)'
      : action;
  boundsReadout.exits = exitCount;
  boundsReadout.ownBounds = getECSWorld().getStorage(ComponentType.WORLD_BOUNDS).size;
};

/** The box toggle's value: the drawing module's, read again on every refresh. */
const boxToggleProxy = { shown: false };

const getBoxToggleItem = (): DebuggerPaneItem<PhysicsState> => {
  boxToggleProxy.shown = isWorldBoundsBoxShown();
  return {
    key: 'shown',
    target: boxToggleProxy,
    label: 'Draw the box (orange)',
    onChange: (value) => {
      setWorldBoundsBoxShown(Boolean(value));
      setWorldBoundsBoxShownSaved(isWorldBoundsBoxShown());
    },
  };
};

/** Turns the box drawing on when it was on at the last save: the tab's registration. */
export const restoreWorldBoundsBoxShown = () => {
  if (isWorldBoundsBoxShownSaved() && canDrawWorldBounds()) setWorldBoundsBoxShown(true);
};

// p102
/** The current world's bounds: its box, where it comes from and its action, the scene's
 * exits, and how many entities have bounds of their own (the default world's). */
export const getWorldBoundsFolder = (): DebuggerPaneItem<PhysicsState> => {
  const count = (key: 'exits' | 'ownBounds', label: string) => ({
    key,
    target: boundsReadout,
    label,
    readonly: true,
    format: (v: number) => v.toFixed(0),
  });
  return {
    type: 'folder',
    id: 'worldBounds',
    title: 'World bounds (live)',
    expanded: false,
    content: [
      { key: 'box', target: boundsReadout, label: 'Box', readonly: true },
      { key: 'source', target: boundsReadout, label: 'Source', readonly: true },
      { key: 'action', target: boundsReadout, label: 'Action', readonly: true },
      count('exits', 'Exits (this scene)'),
      count('ownBounds', 'Entities with their own bounds'),
      // Without the lines() feature the toggle is left out
      ...(canDrawWorldBounds() ? [getBoxToggleItem()] : []),
    ] as DebuggerPaneItem<PhysicsState>[],
  };
};

/** The exit's entity in the default world while it still has a body there (the edit window's
 * entities), else undefined. */
const getOpenableEntityId = (exit: WorldBoundsExitInfo) => {
  const { entityId, world } = exit;
  if (entityId === null || world !== getECSWorld() || !world.isAlive(entityId)) return undefined;
  return getPhysicsEntityRigidBody(entityId) ? entityId : undefined;
};

/** The latest exits by row id (the body id), as the list's data read them last. */
const exitsByItemId = new Map<string, WorldBoundsExitInfo>();

const toExitRow = (exit: WorldBoundsExitInfo): DebuggerListItem => {
  const { x, y, z } = exit.position;
  const pos = `${formatBoundsNumber(x)}, ${formatBoundsNumber(y)}, ${formatBoundsNumber(z)}`;
  const details = [`step ${exit.step} at (${pos})`];
  if (exit.source === 'ENTITY') details.push('its own bounds');
  if (exit.frozen) details.push('frozen (jointed)');
  if (exit.takenWith !== null) details.push(`with its multibody (body ${exit.takenWith} left)`);
  const openable = getOpenableEntityId(exit) !== undefined;
  return {
    itemId: String(exit.bodyId),
    title: exit.name,
    titlePlaceholder: exit.entityId === null,
    subTitle: exit.entityId === null ? `[body ${exit.bodyId}]` : `[${exit.entityId}]`,
    badge: exit.action ?? 'NO ENTITY',
    description: details.join(', '),
    disabled: !openable,
    tooltip: openable
      ? 'Open the edit window'
      : exit.entityId === null
        ? 'A body without a physics entity'
        : 'The entity no longer exists',
  };
};

const getExitRows = (): DebuggerListItem[] => {
  const { recentExits } = getWorldBoundsStats();
  exitsByItemId.clear();
  const rows: DebuggerListItem[] = [];
  // Newest first
  for (let i = recentExits.length - 1; i >= 0; i--) {
    exitsByItemId.set(String(recentExits[i].bodyId), recentExits[i]);
    rows.push(toExitRow(recentExits[i]));
  }
  return rows;
};

const openExitEntityWindow = (itemId: string) => {
  const exit = exitsByItemId.get(itemId);
  const entityId = exit && getOpenableEntityId(exit);
  if (entityId !== undefined) toggleEditPhysicsEntityWindow(String(entityId));
};

/** The rows whose entity has an open edit window. */
const getSelectedExitRows = () => {
  const open = new Set(
    getDraggableWindowsOfKind(EDIT_PHYS_ENTITY_WIN_ID).map((win) => getPhysWinEntityId(win.data))
  );
  const selected: string[] = [];
  for (const [itemId, exit] of exitsByItemId) {
    if (exit.entityId !== null && open.has(exit.entityId)) selected.push(itemId);
  }
  return selected;
};

/** The scene's latest world bounds exits, newest first: a row opens the entity's edit window
 * while it still exists ('DISABLE', 'CALLBACK'). */
export const getWorldBoundsExitsList = () =>
  debuggerListCMP({
    id: 'physicsWorldBoundsExits',
    heading: 'World bounds exits (latest 20)',
    emptyText: 'No body has left the world bounds in this scene.',
    data: getExitRows,
    selectedItemId: getSelectedExitRows,
    perItemConfig: { onClick: openExitEntityWindow },
  });
