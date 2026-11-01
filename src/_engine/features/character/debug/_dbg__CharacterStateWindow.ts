// The Character state window (p806 D10, D11): a character's controller data on the UI kit's
// property grids, the header's (`_dbg__CharacterStateHeader.ts`) and the groups' (the gizmos, then
// State, Properties and Internal memory: `_dbg__CharacterStateRows.ts`,
// `_dbg__CharacterConfigItems.ts`), refreshed by a scene looper at the window's interval; the
// window kind and the Characters tab's openers.
import { CMP } from '../../../ui/core/CMP';
import { createEmptyState } from '../../../ui/components/EmptyState';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { createDebugWindowGrid } from '../../../debug/_dbg__DebugWindowGrid';
import { lsSubscribe } from '../../../utils/LocalAndSessionStorage';
import { getCharacterById } from '../Character';
import type { CharacterObject } from '../CharacterTypes';
import {
  createSceneMainLooper,
  deleteSceneMainLooper,
  getCurrentSceneId,
} from '../../../kernel/scene/Scene';
import {
  getDraggableWindow,
  getKindWindowId,
  openDraggableWindow,
  registerDraggableWindowKind,
  toggleDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import type { OpenDraggableWindowProps } from '../../../ui/overlays/windows/DraggableWindowTypes';
import {
  acquireCharacterGizmos,
  releaseCharacterGizmos,
  setCharacterGizmosFrozen,
} from './_dbg__CharacterGizmos';
import { CHAR_CONFIG_LS_KEY } from './_dbg__CharacterConfigOverrides';
import {
  getConfigLeadItems,
  getConfigRowItem,
  onConfigApplied,
  renderConfigActions,
} from './_dbg__CharacterConfigItems';
import { getReadonlyRowItem } from './_dbg__CharacterStateRows';
import {
  getGizmoFolderItem,
  getHeaderItems,
  renderSavedState,
  type HeaderHandlers,
} from './_dbg__CharacterStateHeader';
import {
  copyFrozenData,
  getGroupSource,
  GROUPS,
  instances,
  loadSettings,
  saveSettings,
  type FolderId,
  type StateGroup,
  type StateRow,
  type StateWindowInstance,
} from './_dbg__CharacterStateWindowState';
import styles from './CharacterStateWindow.module.scss';

// The windows' kind: one window per character, keyed by its id. Kept from the legacy tracker
// window, so saved window positions and sizes still apply.
export const CHAR_STATE_WIN_ID = 'characterDataTrackerWindow';
export const getCharacterStateWindowId = (charId: string) =>
  getKindWindowId(CHAR_STATE_WIN_ID, charId);

/** Listeners of the state windows' open and close (the Characters tab's row toggles). */
const openStateListeners = new Set<() => void>();
const notifyOpenStateChange = () => {
  for (const listener of openStateListeners) listener();
};

const COST_READOUT_INTERVAL_MS = 250;
const NOT_FOUND_TITLE = 'Character not found (deleted?)';

// A configuration write (an undo, a reset, a gesture's end) shows in the character's window
onConfigApplied((charId) => {
  const inst = instances.get(charId);
  if (!inst || inst.isDisposed) return;
  renderConfigActions(inst);
  inst.groupsGrid?.grid.refresh();
});

/** The keys of every group's object (a change means a rebuild). */
const countKeys = (character: CharacterObject) => {
  let count = 0;
  for (let i = 0; i < GROUPS.length; i++) {
    const data = getGroupSource(character, GROUPS[i].id);
    for (const key in data) if (Object.prototype.hasOwnProperty.call(data, key)) count++;
  }
  return count;
};

/** A group's folder: the Properties group's lead items and editors, and a read-only row for
 * every other value. */
const getGroupFolder = (
  inst: StateWindowInstance,
  character: CharacterObject,
  id: StateGroup['id'],
  title: string
) => {
  const data = getGroupSource(character, id);
  const keys = Object.keys(data);
  const rows: StateRow[] = [];
  const items: PropertyGridItem[] = id === 'props' ? getConfigLeadItems(inst, character) : [];
  for (const key of keys) {
    const value = data[key];
    const configItem = id === 'props' ? getConfigRowItem(inst, character, key, value) : null;
    if (configItem) {
      items.push(configItem);
      rows.push({ key, groupId: id, matches: (next) => typeof next === typeof value });
      continue;
    }
    const built = getReadonlyRowItem(inst, id, key, value);
    items.push(built.item);
    rows.push(built.row);
  }
  return {
    group: { id, rows },
    keyCount: keys.length,
    folder: { type: 'folder', id, title: `${title} (${keys.length})`, items } as const,
  };
};

/** Builds (or builds again) the groups' grid: the Gizmos folder, then a folder per group, each
 * open as the viewer left it. */
const buildGroups = (inst: StateWindowInstance, character: CharacterObject) => {
  inst.groupsGrid?.cmp.remove();
  inst.configActions = null;
  inst.character = character;
  const items: PropertyGridItem[] = inst.gizmos ? [getGizmoFolderItem(inst, inst.gizmos)] : [];
  const groups: StateGroup[] = [];
  let keyCount = 0;
  for (const { id, title } of GROUPS) {
    const built = getGroupFolder(inst, character, id, title);
    groups.push(built.group);
    items.push(built.folder);
    keyCount += built.keyCount;
  }
  inst.groups = groups;
  inst.keyCount = keyCount;
  /** The flashes the grid's rows make (`onCreate`), disposed with it */
  const disposers: (() => void)[] = [];
  inst.groupsGrid = createDebugWindowGrid({
    items,
    folderExpanded: inst.settings.groupsOpen,
    onFolderExpandedChange: (id, expanded) => {
      inst.settings.groupsOpen[id as FolderId] = expanded;
      saveSettings(inst.settings);
    },
    onRemove: () => {
      for (const dispose of disposers) dispose();
    },
  });
  disposers.push(...inst.flashDisposers.splice(0));
  inst.root.add(inst.groupsGrid.cmp);
};

/** Freezing copies the three objects, so every read-only row (a shut folder's opened later too)
 * shows that moment. Unfreezing reads the live data without flashing everything since. */
const setFrozen = (inst: StateWindowInstance, isFrozen: boolean) => {
  if (inst.isFrozen === isFrozen || inst.isDisposed) return;
  const character = getCharacterById(inst.charId);
  inst.isFrozen = isFrozen;
  inst.frozen = isFrozen && character ? copyFrozenData(character) : null;
  inst.character = character ?? null;
  inst.groupsGrid?.grid.refresh();
  inst.lastUpdate = performance.now();
  // The gizmos hold the same moment as the rows
  if (inst.gizmos) setCharacterGizmosFrozen(inst.gizmos, isFrozen);
};

const disposeInstance = (inst: StateWindowInstance) => {
  inst.isDisposed = true;
  if (inst.looperIndex > -1) {
    deleteSceneMainLooper(inst.looperIndex, inst.sceneId || undefined, true);
    inst.looperIndex = -1;
  }
  inst.unsubscribePin?.();
  inst.unsubscribePin = null;
  inst.unsubscribeSaved?.();
  inst.unsubscribeSaved = null;
  if (inst.gizmos) {
    releaseCharacterGizmos(inst.gizmos, inst);
    inst.gizmos = null;
  }
  // A rebuilt window's new instance may already be registered under the same character
  if (instances.get(inst.charId) === inst) instances.delete(inst.charId);
};

/** Disposes from inside the looper. Deferred, so the late loopers array isn't replaced while it
 * is being iterated (that would skip the next looper for a frame). */
const disposeFromLooper = (inst: StateWindowInstance) => {
  inst.isDisposed = true;
  queueMicrotask(() => disposeInstance(inst));
};

const showCharacterNotFound = (inst: StateWindowInstance) => {
  inst.groupsGrid?.cmp.remove();
  inst.groupsGrid = null;
  inst.groups = [];
  inst.character = null;
  inst.root.add(createEmptyState({ title: NOT_FOUND_TITLE }).cmp);
  disposeFromLooper(inst);
};

/** Rebuilds when a key came or went or an open group's value changed its shape (rare), else
 * refreshes the groups' grid: its shown fields read the data, a changed read-only row flashes. */
const updateInstance = (inst: StateWindowInstance, character: CharacterObject) => {
  inst.character = character;
  if (countKeys(character) !== inst.keyCount) {
    buildGroups(inst, character);
    return;
  }
  for (let i = 0; i < inst.groups.length; i++) {
    const group = inst.groups[i];
    if (!inst.settings.groupsOpen[group.id]) continue;
    const data = getGroupSource(character, group.id);
    for (let j = 0; j < group.rows.length; j++) {
      const row = group.rows[j];
      if (!row.matches(data[row.key])) {
        buildGroups(inst, character);
        return;
      }
    }
  }
  inst.isRefreshing = true;
  inst.groupsGrid?.grid.refresh();
  inst.isRefreshing = false;
};

const updateCostReadout = (inst: StateWindowInstance, now: number) => {
  if (now - inst.costShownAt < COST_READOUT_INTERVAL_MS) return;
  inst.costShownAt = now;
  if (!inst.costCount) return;
  inst.costText?.updateText(`Update ${(inst.costSum / inst.costCount).toFixed(3)} ms`);
  inst.costSum = 0;
  inst.costCount = 0;
};

/** Runs on every rendered frame, also while the app is paused (a scene main late looper). */
const createLooper = (inst: StateWindowInstance) => () => {
  if (inst.isDisposed) return;
  // Safety net for a close path that detaches the DOM without removing the CMP
  if (!inst.root.elem.isConnected) {
    disposeFromLooper(inst);
    return;
  }
  if (inst.isFrozen || getDraggableWindow(inst.winId)?.isCollapsed) return;

  const start = performance.now();
  if (inst.settings.intervalMs > 0 && start - inst.lastUpdate < inst.settings.intervalMs) return;
  inst.lastUpdate = start;

  const character = getCharacterById(inst.charId);
  if (!character) {
    showCharacterNotFound(inst);
    return;
  }
  updateInstance(inst, character);

  const end = performance.now();
  inst.costSum += end - start;
  inst.costCount++;
  updateCostReadout(inst, end);
};

// Public (debug module) API

/** The window's content function: rebuilds the whole window for `winData.id`'s character. */
export const _createCharacterStateWindowContent = (winData?: { [key: string]: unknown }) => {
  const charId = String((winData as { id?: string } | undefined)?.id ?? '');
  const prevInst = instances.get(charId);
  if (prevInst) disposeInstance(prevInst);

  const sceneId = getCurrentSceneId();
  const inst: StateWindowInstance = {
    charId,
    winId: getCharacterStateWindowId(charId),
    character: getCharacterById(charId) ?? null,
    sceneId,
    looperIndex: -1,
    isDisposed: false,
    root: CMP({ class: styles.root, onRemoveCmp: () => disposeInstance(inst) }),
    header: null,
    groupsGrid: null,
    groups: [],
    keyCount: 0,
    settings: loadSettings(),
    isFrozen: false,
    frozen: null,
    isRefreshing: false,
    flashDisposers: [],
    gizmos: null,
    unsubscribePin: null,
    lastUpdate: 0,
    costSum: 0,
    costCount: 0,
    costShownAt: 0,
    costText: null,
    configActions: null,
    savedActions: null,
    unsubscribeSaved: null,
  };

  const character = inst.character;
  if (!character) {
    inst.root.add(createEmptyState({ title: NOT_FOUND_TITLE }).cmp);
    return inst.root;
  }

  inst.gizmos = acquireCharacterGizmos(charId, inst);
  const handlers: HeaderHandlers = {
    onFreezeChange: (isFrozen) => setFrozen(inst, isFrozen),
    onNotesChange: () => {
      const live = getCharacterById(inst.charId);
      if (live && !inst.isDisposed) buildGroups(inst, live);
    },
  };
  inst.header = createDebugWindowGrid({ items: getHeaderItems(inst, handlers) });
  inst.root.add(inst.header.cmp);
  buildGroups(inst, character);
  // Saves from this window, the Characters tab's clear button and undo all write through LS
  inst.unsubscribeSaved = lsSubscribe(CHAR_CONFIG_LS_KEY, () => renderSavedState(inst));
  if (sceneId) {
    inst.looperIndex = createSceneMainLooper(createLooper(inst), sceneId, true);
  }
  instances.set(charId, inst);
  // The content is built before the window state is open: notify after it
  queueMicrotask(notifyOpenStateChange);
  return inst.root;
};

registerDraggableWindowKind(CHAR_STATE_WIN_ID, {
  content: _createCharacterStateWindowContent,
  onClose: notifyOpenStateChange,
  // The window stays open over a scene change when the next scene has a character with the same
  // id
  sceneTargetResolver: (data) => {
    const charId = (data as { id?: string } | undefined)?.id;
    return Boolean(charId && getCharacterById(charId));
  },
});

const getStateWindowProps = (character: CharacterObject): OpenDraggableWindowProps => ({
  id: getCharacterStateWindowId(character.id),
  kind: CHAR_STATE_WIN_ID,
  position: { x: 130, y: 80 },
  size: { w: 480, h: 560 },
  saveToLS: true,
  title: `Character state: ${character.name || `[${character.id}]`}`,
  isDebugWindow: true,
  data: { id: character.id },
  closeOnSceneChange: true,
});

/** Opens the character's state window (or brings it to the front). */
export const _openCharacterStateWindow = (character: CharacterObject) => {
  openDraggableWindow(getStateWindowProps(character));
};

/** The list row toggle: opens the character's state window, brings it to the front, or closes
 * it when on top. */
export const _toggleCharacterStateWindow = (character: CharacterObject) => {
  toggleDraggableWindow(getStateWindowProps(character));
};

export const isCharacterStateWindowOpen = (charId: string) =>
  Boolean(getDraggableWindow(getCharacterStateWindowId(charId))?.isOpen);

/** Calls `listener` when a state window opens or closes. Returns the unsubscriber. */
export const onCharacterStateWindowsChange = (listener: () => void) => {
  openStateListeners.add(listener);
  return () => {
    openStateListeners.delete(listener);
  };
};
