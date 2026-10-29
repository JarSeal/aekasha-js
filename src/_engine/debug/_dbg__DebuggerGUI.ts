// The scene's debug drawer (p806 D6): its tabs on the drawer shell (`_dbg__DrawerShell.ts`: the
// toggler, the heading, the vertical rail, the width handle), mounted by a tab host, its state in
// `AEK_debugDrawerState`. The menu changes in place when a tab is created or removed.
import { lsGetItem, lsSetItem } from '../utils/LocalAndSessionStorage';
import { getHUDRootCMP } from '../ui/core/HUD';
import { DEFAULT_DEBUG_DRAWER_TAB_ORDER, getConfig, IS_DEBUG_ENV } from '../kernel/config/Config';
import { lwarn } from '../utils/Logger';
import type { DebugGUIOpts, AnyDebuggerTabDef, UpdateDebuggerTabOpts } from './DebuggerGUI';
import { createDebuggerSceneLoader } from '../kernel/scene/debug/_dbg__DebuggerSceneLoader';
import { persistDebuggerTabStateValue } from './_dbg__DebuggerPaneBuilder';
import { createTabHost } from './_dbg__TabHost';
import {
  createDrawerShell,
  setBodyDrawerWidth,
  type DrawerShell,
  type DrawerShellTab,
} from './_dbg__DrawerShell';
import { getDebugKeyChordLabel } from './DefaultDebugKeyBindings';
import { setOnScreenToolsDisabled } from './OnScreenTools';
import { doesSceneExist, getCurrentSceneId, registerOnAllSceneExits } from '../kernel/scene/Scene';
// The kit's fonts (p801 D8): the full page has them already (InitEngine), a debug embed gets them here
import '../ui/fonts/fonts.css';

export { _debuggerListCMP } from './_dbg__DebuggerList';

let shell: DrawerShell | null = null;
let currentSceneTitleText: string = '';
let debugSceneLoaderCreated = false;
let debuggerDisabled = false;
/** An editor view is active (see _setDrawerSuspendedByView). */
let isSuspendedByView = false;
/** Set while a right-side debug drawer is open: this one in the Runtime view, an editor's own one
 * in an editor view (Views.ts). The top on-screen row and the viewport stack shift by it. */
const DRAWER_OPEN_BODY_CLASS = 'debugDrawerOpen';
const LS_KEY = 'AEK_debugDrawerState';
const SCENE_EXIT_HOOK_ID = 'debuggerSceneTabs';

/** Sets the `debugDrawerOpen` body class with the drawer's width beside it (Runtime view) */
const addBodyClass = () => {
  document.body.classList.add(DRAWER_OPEN_BODY_CLASS);
  if (shell) setBodyDrawerWidth(shell.getWidth());
};
const TOGGLE_KEY_ID = 'sc-toggle-debug-drawer';

/** The saved drawer state. 5.x saved one `currentScrollPos` (the open tab's), read once into
 * `scrollPos` and not written again (D6). */
type DrawerState = {
  isOpen: boolean;
  /** Empty = the first tab in order */
  currentTabId: string;
  /** Each tab's scroll position, by tab id */
  scrollPos: Record<string, number>;
  /** The width the handle set, in px (none: the default) */
  width?: number;
};

let drawerState: DrawerState = { isOpen: false, currentTabId: '', scrollPos: {} };

const saveDrawerState = (newState?: Partial<DrawerState>) => {
  drawerState = { ...drawerState, ...newState };
  lsSetItem(LS_KEY, drawerState);
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The saved scroll positions' valid entries */
const readScrollPos = (saved: unknown) => {
  const result: Record<string, number> = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
  for (const [id, pos] of Object.entries(saved)) {
    if (isFiniteNumber(pos)) result[id] = pos;
  }
  return result;
};

/** The saved drawer state's valid fields; anything malformed falls back to the defaults. The
 * stored text is JSON either way (older versions wrote it as a string, the same text). Exported
 * for its test (the 5.x fixture, D14). */
export const _readSavedDrawerState = (): Partial<DrawerState> => {
  let saved: unknown;
  try {
    saved = lsGetItem(LS_KEY, {});
  } catch {
    lwarn(`The saved debug drawer state ("${LS_KEY}") isn't valid JSON, so it is ignored.`);
    return {};
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  const fields = saved as Partial<Record<string, unknown>>;
  const scrollPos = readScrollPos(fields.scrollPos);
  const result: Partial<DrawerState> = { scrollPos };
  if (typeof fields.isOpen === 'boolean') result.isOpen = fields.isOpen;
  const { currentTabId, currentScrollPos } = fields;
  if (typeof currentTabId === 'string') {
    result.currentTabId = currentTabId;
    // 5.x's one position was the saved tab's
    if (currentTabId && isFiniteNumber(currentScrollPos) && !(currentTabId in scrollPos)) {
      scrollPos[currentTabId] = currentScrollPos;
    }
  }
  if (isFiniteNumber(fields.width)) result.width = fields.width;
  return result;
};

/**
 * Creates the debugger scene loader (idempotent). Called at registration so the loader exists
 * before the first loadScene (which may target it via the debug start scene options).
 */
export const _ensureDebuggerSceneLoader = () => {
  if (debugSceneLoaderCreated) return;
  createDebuggerSceneLoader();
  debugSceneLoaderCreated = true;
};

// Keyed by tab id. A Map keeps insertion order, so a re-registered (replaced) tab keeps its
// registration position for the ordering tie-break.
const tabs = new Map<string, AnyDebuggerTabDef>();

const isVisible = () => Boolean(shell) && drawerState.isOpen && !isSuspendedByView;

/** The mounted tab's lifecycle (drawerState.currentTabId is only the saved preference, and it can
 * point to a tab that is not registered yet). */
const host = createTabHost({
  getContainer: () => shell?.getContainer() ?? null,
  // Hidden in editor views too (_setDrawerSuspendedByView)
  isVisible,
});

const getTabSortValue = (def: AnyDebuggerTabDef, tabOrder: string[]) => {
  if (def.orderNr !== undefined) return def.orderNr;
  const index = tabOrder.indexOf(def.id);
  return index === -1 ? Infinity : index;
};

/** All tabs in menu order (p806 D6): the engine's and the app's by `orderNr ?? tabOrder index`,
 * then the scene tabs by the same; ties (and unlisted tabs) in registration order. */
const getOrderedTabs = () => {
  const tabOrder = getConfig().debugDrawer?.tabOrder || DEFAULT_DEBUG_DRAWER_TAB_ORDER;
  // Array.sort is stable, so equal values keep the Map's registration order
  return [...tabs.values()].sort((a, b) => {
    const scene = Number(Boolean(a.sceneId)) - Number(Boolean(b.sceneId));
    if (scene) return scene;
    const aValue = getTabSortValue(a, tabOrder);
    const bValue = getTabSortValue(b, tabOrder);
    return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
  });
};

/** The rail's tabs: a scene tab says so in its name, and the first one has a divider before it */
const getShellTabs = (): DrawerShellTab[] =>
  getOrderedTabs().map((def, i, all) => ({
    id: def.id,
    title: def.sceneId ? `${def.title} (scene tab)` : def.title,
    icon: def.icon,
    separatorBefore: Boolean(def.sceneId) && i > 0 && !all[i - 1].sceneId,
  }));

/** The tab's saved scroll position, into its container (a closed drawer is only moved, so it
 * keeps it; an editor view's `display: none` doesn't) */
const restoreScroll = () => {
  const id = host.mountedId;
  const container = shell?.getContainer();
  if (!id || !container) return;
  container.elem.scrollTop = drawerState.scrollPos[id] || 0;
};

/** Shows a tab in the rail and mounts it in its container; the others are emptied */
const mountTab = (def: AnyDebuggerTabDef) => {
  if (!shell) return;
  shell.select(def.id);
  host.mount(def);
  shell.clearOtherContainers();
  restoreScroll();
};

/** Set while the drawer changes the rail itself: a selection the rail reports then (the selected
 * tab removed) mounts the next tab without saving it as the user's */
let isSyncingTabs = false;

const onRailSelect = (id: string) => {
  const def = tabs.get(id);
  if (!def) return;
  mountTab(def);
  if (!isSyncingTabs) saveDrawerState({ currentTabId: id });
};

/** The menu after a tab was created, replaced or removed (D5: in place). The saved tab is shown
 * when it's registered (a scene tab created on the scene's entry), else the shown one stays, else
 * the first; a replaced tab that's shown is mounted again. */
const syncTabs = (replacedId?: string) => {
  if (!shell) return;
  isSyncingTabs = true;
  try {
    shell.setTabs(getShellTabs());
  } finally {
    isSyncingTabs = false;
  }
  const target =
    tabs.get(drawerState.currentTabId) ??
    (host.mountedId ? tabs.get(host.mountedId) : undefined) ??
    getOrderedTabs()[0];
  if (!target) return;
  if (target.id !== host.mountedId || target.id === replacedId) mountTab(target);
};

let guiOpts: DebugGUIOpts | undefined = undefined;

const createShell = () => {
  shell = createDrawerShell({
    id: 'debugger',
    label: 'Debugger',
    togglerText: 'Debug',
    togglerPlace: guiOpts?.drawerBtnPlace,
    keys: getDebugKeyChordLabel(TOGGLE_KEY_ID),
    headingLabel: 'Scene',
    title: currentSceneTitleText,
    railLabel: 'Debugger tabs',
    isOpen: drawerState.isOpen,
    width: drawerState.width,
    onToggle: () => _toggleDrawer(undefined, { focusTab: true }),
    onClose: () => _toggleDrawer('CLOSE'),
    onSelect: onRailSelect,
    onWidthInput: (width) => {
      if (isVisible()) setBodyDrawerWidth(width);
    },
    onWidthChange: (width) => saveDrawerState({ width }),
    onScroll: (id, scrollTop) => {
      // Not a tab being emptied or rebuilt, nor while an editor view's display: none resets it
      if (id !== host.mountedId || !isVisible()) return;
      saveDrawerState({ scrollPos: { ...drawerState.scrollPos, [id]: scrollTop } });
    },
  });
  if (debuggerDisabled) shell.setDisabled(true);
  getHUDRootCMP().add(shell.cmp);
};

/** Builds the drawer on its first call (the first scene title); later calls change nothing. */
export const _createDebugGui = (opts?: DebugGUIOpts) => {
  if (!IS_DEBUG_ENV || shell) return;
  guiOpts = opts;
  _ensureDebuggerSceneLoader();
  drawerState = { ...drawerState, ..._readSavedDrawerState() };
  createShell();
  if (drawerState.isOpen && !isSuspendedByView) addBodyClass();
  syncTabs();
};

/**
 * Opens or closes the drawer (no argument toggles it). The debug key keeps the focus where it is
 * (D12: the user may be playing); the toggler's click puts it on the open tab in the rail. A close
 * with the focus inside gives it to the toggler.
 * @param openOrClose the next state
 * @param opts.focusTab focuses the rail's open tab when it opens
 */
export const _toggleDrawer = (openOrClose?: 'OPEN' | 'CLOSE', opts?: { focusTab?: boolean }) => {
  if (!shell) return;
  const isOpen =
    openOrClose === 'OPEN' ? true : openOrClose === 'CLOSE' ? false : !drawerState.isOpen;
  const wasOpen = drawerState.isOpen;
  if (isOpen !== wasOpen) saveDrawerState({ isOpen });
  shell.setOpen(isOpen, { focusTab: opts?.focusTab });
  if (isOpen) {
    // Hidden in an editor view: _setDrawerSuspendedByView shows it on the way back
    if (isSuspendedByView) return;
    addBodyClass();
    // The tab was not refreshed while hidden
    if (!wasOpen) host.resume();
    return;
  }
  host.pause();
  if (!isSuspendedByView) document.body.classList.remove(DRAWER_OPEN_BODY_CLASS);
};

/**
 * Hides the drawer for an editor view (Views.ts), or shows it again. The open state is kept,
 * but while suspended, its open tab isn't refreshed and the `debugDrawerOpen` body class is left
 * to the editor view (an editor's own right drawer sets it, so the offset rules of the top row and
 * the viewport stack keep working).
 * @param suspended (boolean) whether an editor view is active
 */
export const _setDrawerSuspendedByView = (suspended: boolean) => {
  if (isSuspendedByView === suspended) return;
  isSuspendedByView = suspended;
  // The view's display: none lost the scroll position
  if (!suspended) restoreScroll();
  if (!drawerState.isOpen) return;
  if (suspended) {
    host.pause();
    document.body.classList.remove(DRAWER_OPEN_BODY_CLASS);
    return;
  }
  addBodyClass();
  host.resume();
};

export const _createDebuggerTab = (def: AnyDebuggerTabDef, opts?: DebugGUIOpts) => {
  if (def.sceneId && !doesSceneExist(def.sceneId)) {
    lwarn(
      `Debugger tab "${def.id}" has a sceneId "${def.sceneId}" that is not a scene, so it is never removed on a scene exit (in createDebuggerTab)`
    );
  }
  // A replaced tab keeps its registration position
  const isReplaced = tabs.has(def.id);
  tabs.set(def.id, def);
  if (opts) guiOpts = { ...guiOpts, ...opts };
  if (opts?.drawerBtnPlace) shell?.setTogglerPlace(opts.drawerBtnPlace);
  syncTabs(isReplaced ? def.id : undefined);
};

export const _openDebuggerTab = (id: string) => {
  const def = tabs.get(id);
  if (!def) {
    lwarn(`Could not find a debugger tab to open with id "${id}" in openDebuggerTab`);
    return;
  }
  saveDrawerState({ currentTabId: id });
  if (shell && host.mountedId !== id) mountTab(def);
  _toggleDrawer('OPEN');
};

/** Removes a tab, without changing the menu. */
const deleteTab = (id: string) => {
  if (host.mountedId === id) host.unmount();
  tabs.delete(id);
};

export const _removeDebuggerTab = (id: string) => {
  if (!tabs.has(id)) {
    lwarn(`Could not find a debugger tab to remove with id "${id}" in removeDebuggerTab`);
    return;
  }
  deleteTab(id);
  syncTabs();
};

/** Removes the scene tabs of the scene being exited (registered on all scene exits), with one
 * menu change. The saved open tab id is kept, so a re-entry shows the tab again. */
const removeSceneTabs = () => {
  const sceneId = getCurrentSceneId();
  if (!sceneId) return;
  let removed = false;
  for (const def of [...tabs.values()]) {
    if (def.sceneId !== sceneId) continue;
    deleteTab(def.id);
    removed = true;
  }
  if (removed) syncTabs();
};

registerOnAllSceneExits(SCENE_EXIT_HOOK_ID, removeSceneTabs);

export const _persistDebuggerTabValue = (id: string, key: string) => {
  const def = tabs.get(id);
  if (!def) {
    lwarn(`Could not find a debugger tab with id "${id}" in persistDebuggerTabValue`);
    return;
  }
  persistDebuggerTabStateValue(def, key);
};

/** Hidden in an editor view too (_setDrawerSuspendedByView), so updateDebuggerTab skips the tab. */
export const _isDebuggerTabOpen = (id: string) => isVisible() && host.mountedId === id;

/** The drawer for the test bridge (p806 D14): its element, the mounted tab's container and the
 * tab ids in menu order. */
export const _getDrawerTestInfo = () => ({
  element: shell?.cmp.elem ?? null,
  contentElement: shell?.getContainer()?.elem ?? null,
  mountedId: host.mountedId,
  tabIds: getOrderedTabs().map((def) => def.id),
});

export const _updateDebuggerTab = (id: string, opts?: UpdateDebuggerTabOpts) => {
  if (!_isDebuggerTabOpen(id)) return;
  host.refresh(opts?.rebuild);
};

/** Builds the drawer on the first call (the first `setCurrentScene`). Later calls change the title
 * in place and pass the scene change to the open tab (p806 D5): it's rebuilt from `content`
 * (a tab built from the current scene's data: the Ray cast tab's physics section, LOD), or kept
 * and refreshed with `keepOnSceneChange`. */
export const _updateDebuggerSceneTitle = (title: string) => {
  currentSceneTitleText = title;
  if (shell) {
    shell.setTitle(title);
    host.sceneChanged();
    return;
  }
  _createDebugGui(guiOpts);
};

/** During a scene load (p806 D6, D7): the drawer is `inert`, `aria-busy` and dimmed, and every
 * on-screen tool `aria-disabled`; the scene loader's overlay is the loading signal. */
export const _disableDebugger = (disable: boolean) => {
  if (!IS_DEBUG_ENV) return;
  debuggerDisabled = disable;
  shell?.setDisabled(disable);
  setOnScreenToolsDisabled(disable);
};
