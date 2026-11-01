import { CMP } from '../../ui/core/CMP';
import type { CMPHandle } from '../../ui/core/CMPTypes';
import { createTabs, type TabDef, type Tabs } from '../../ui/components/Tabs';
import styles from './Profiler.module.scss';
import { lsGetItem, lsSetItem } from '../../utils/LocalAndSessionStorage';
import { lwarn } from '../../utils/Logger';
import { getSvgIcon } from '../../ui/core/icons/SvgIcon';
import {
  openDraggableWindow,
  registerDraggableWindow,
  toggleDraggableWindow,
} from '../../ui/overlays/windows/DraggableWindow';
import type { OpenDraggableWindowProps } from '../../ui/overlays/windows/DraggableWindowTypes';
import {
  hydrateDebuggerTabState,
  type AnyDebuggerTabDef,
  type UpdateDebuggerTabOpts,
} from '../DebuggerGUI';
import {
  DEFAULT_PROFILER_SETTINGS,
  PROFILER_BAR_MEASURES,
  PROFILER_LS_KEY,
  PROFILER_UI_LS_KEY,
  PROFILER_UPDATE_RATES_HZ,
  PROFILER_WINDOW_ID,
  type ProfilerSettings,
} from '../Profiler';
import { updateOnScreenTools } from '../OnScreenTools';
import { updateStatsProfilerEntryPoint } from '../Stats';
import { createTabHost } from '../_dbg__TabHost';
import { createTabContainers } from '../_dbg__TabContainers';
import { persistDebuggerTabStateValue } from '../_dbg__DebuggerPaneBuilder';
import { _acquireFrameProbe, _releaseFrameProbe } from './_dbg__FrameProbe';
import {
  createProfilerOverviewTabDef,
  PROFILER_OVERVIEW_TAB_ID,
  sanitizeOverviewMetrics,
} from './_dbg__ProfilerOverview';
import { createProfilerObjectsTabDef, PROFILER_OBJECTS_TAB_ID } from './_dbg__ProfilerObjects';
import { registerBuiltInStatsSources } from './_dbg__ProfilerSources';
import { _syncStatsSources } from './_dbg__StatsSources';
import {
  createProfilerSettingsTabDef,
  PROFILER_SETTINGS_PERSIST_KEYS,
  PROFILER_SETTINGS_TAB_ID,
} from './_dbg__ProfilerSettings';

// SETTINGS

const settings: ProfilerSettings = { ...DEFAULT_PROFILER_SETTINGS };

/** Puts values the Settings tab can't offer (a stale or hand-edited LS) back to their default. */
const sanitizeSettings = () => {
  if (!(PROFILER_UPDATE_RATES_HZ as readonly number[]).includes(settings.updateRateHz)) {
    settings.updateRateHz = DEFAULT_PROFILER_SETTINGS.updateRateHz;
  }
  // Also turns the default's empty list into the default rows (always a new array)
  settings.overviewMetrics = sanitizeOverviewMetrics(settings.overviewMetrics);
  settings.openFromStatsPanels = Boolean(settings.openFromStatsPanels);
  settings.enabledInProdTest = Boolean(settings.enabledInProdTest);
  settings.measureGpu = Boolean(settings.measureGpu);
  settings.excludeDebugHelpers = Boolean(settings.excludeDebugHelpers);
  if (!PROFILER_BAR_MEASURES.includes(settings.objectsBarMeasure)) {
    settings.objectsBarMeasure = DEFAULT_PROFILER_SETTINGS.objectsBarMeasure;
  }
};

hydrateDebuggerTabState({
  lsKey: PROFILER_LS_KEY,
  state: settings,
  persistKeys: PROFILER_SETTINGS_PERSIST_KEYS,
});
sanitizeSettings();

/** Applies a changed setting (it is already written and persisted). */
const applySetting = (key: keyof ProfilerSettings) => {
  switch (key) {
    case 'openFromStatsPanels':
      updateStatsProfilerEntryPoint();
      break;
    case 'enabledInProdTest':
      // The window's stored config carries the flag that lets it reopen in prodTest. A closed
      // window gets it on its next open.
      if (windowRoot) openDraggableWindow({ ...getWindowProps(), focusFirstElement: false });
      updateOnScreenTools('PLAY');
      break;
    case 'updateRateHz':
      // The Overview and Objects tabs read it on their next mount (they aren't visible next to
      // the Settings tab)
      break;
    case 'overviewMetrics':
      // An open Overview (eg. changed through setProfilerSettings) applies it now, otherwise
      // its next mount does
      _updateProfilerTab(PROFILER_OVERVIEW_TAB_ID);
      break;
    case 'measureGpu':
      // A held GPU frame time source is released or acquired right away
      _syncStatsSources();
      break;
    case 'excludeDebugHelpers':
      // The census reads it on its next sample (a cached one taken with the old value isn't reused)
      break;
    case 'objectsBarMeasure':
      _updateProfilerTab(PROFILER_OBJECTS_TAB_ID);
      break;
  }
};

const applyAllSettings = () => {
  for (let i = 0; i < PROFILER_SETTINGS_PERSIST_KEYS.length; i++) {
    applySetting(PROFILER_SETTINGS_PERSIST_KEYS[i]);
  }
};

const settingsTabDef = createProfilerSettingsTabDef({
  settings,
  onChange: applySetting,
  setSettings: (partial) => _setProfilerSettings(partial),
  onClearLS: () => {
    Object.assign(settings, DEFAULT_PROFILER_SETTINGS);
    sanitizeSettings();
    applyAllSettings();
    _updateProfilerTab(PROFILER_SETTINGS_TAB_ID);
  },
}) as unknown as AnyDebuggerTabDef;

export const _getProfilerSettings = () => settings;

export const _setProfilerSettings = (partial: Partial<ProfilerSettings>) => {
  const changed: (keyof ProfilerSettings)[] = [];
  for (let i = 0; i < PROFILER_SETTINGS_PERSIST_KEYS.length; i++) {
    const key = PROFILER_SETTINGS_PERSIST_KEYS[i];
    if (!(key in partial)) continue;
    (settings as Record<string, unknown>)[key] = partial[key];
    changed.push(key);
  }
  sanitizeSettings();
  for (let i = 0; i < changed.length; i++) {
    persistDebuggerTabStateValue(settingsTabDef, changed[i]);
    applySetting(changed[i]);
  }
  if (changed.length) _updateProfilerTab(PROFILER_SETTINGS_TAB_ID);
};

// UI STATE (the open tab; the folder states share the key)

type ProfilerUIState = { currentTabId?: string };

const getSavedTabId = () =>
  (lsGetItem(PROFILER_UI_LS_KEY, {}) as ProfilerUIState | null)?.currentTabId || '';

const saveTabId = (currentTabId: string) => {
  const uiState = (lsGetItem(PROFILER_UI_LS_KEY, {}) as ProfilerUIState | null) || {};
  lsSetItem(PROFILER_UI_LS_KEY, { ...uiState, currentTabId });
};

// TABS

// Keyed by tab id. A Map keeps insertion order, so a re-registered (replaced) tab keeps its
// registration position for the ordering tie-break.
const tabs = new Map<string, AnyDebuggerTabDef>();

/** All tabs in menu order: `orderNr`, then registration order (Array.sort is stable). */
const getOrderedTabs = () =>
  [...tabs.values()].sort((a, b) => (a.orderNr ?? Infinity) - (b.orderNr ?? Infinity));

// WINDOW

/** The window content's root, while the window is open (its content is mounted). */
let windowRoot: CMPHandle | null = null;
/** The tab menu (p806 D6: horizontal, icon only, manual activation), while the window is open */
let menu: Tabs | null = null;
/** Each tab's container, its scroller (the menu's panel content) */
const containers = createTabContainers({ class: styles.tabContent });

const host = createTabHost({
  getContainer: () => containers.get(menu?.getSelected() ?? null),
  isVisible: () => Boolean(windowRoot),
  label: 'Profiler tab',
});

const getWindowProps = (): OpenDraggableWindowProps => ({
  id: PROFILER_WINDOW_ID,
  title: 'Profiler',
  icon: 'profiler',
  isDebugWindow: true,
  saveToLS: true,
  showInProdTest: settings.enabledInProdTest,
  size: { w: 560, h: 640 },
  minSize: { w: 380, h: 320 },
});

const getMenuTabs = (): TabDef[] =>
  getOrderedTabs().map((def) => ({
    key: def.id,
    label: def.title,
    icon: getSvgIcon(def.icon),
    iconOnly: true,
    content: containers.getContentFn(def.id),
  }));

/** Shows a tab in the menu and mounts it in its container (scrolled to the top); the others are
 * emptied */
const mountTab = (def: AnyDebuggerTabDef) => {
  if (!menu) return;
  menu.select(def.id);
  host.mount(def);
  containers.clearOthers(def.id);
  const container = containers.get(def.id);
  if (container) container.elem.scrollTop = 0;
};

/** Set while the window changes the menu itself: a selection the menu reports then (the selected
 * tab removed) mounts the next tab without saving it as the user's */
let isSyncingTabs = false;

const onMenuSelect = (id: string) => {
  const def = tabs.get(id);
  if (!def) return;
  if (!isSyncingTabs) saveTabId(id);
  if (host.mountedId !== id) mountTab(def);
};

/** The menu after a tab was created, replaced or removed (in place, as the drawer's rail): the
 * saved tab is shown when it's registered, else the shown one stays, else the first; a replaced
 * tab that's shown is mounted again. */
const syncTabs = (replacedId?: string) => {
  if (!menu) return;
  containers.retain(new Set(tabs.keys()));
  isSyncingTabs = true;
  try {
    menu.setTabs(getMenuTabs());
  } finally {
    isSyncingTabs = false;
  }
  const target =
    tabs.get(getSavedTabId()) ??
    (host.mountedId ? tabs.get(host.mountedId) : undefined) ??
    getOrderedTabs()[0];
  if (!target) return;
  if (target.id !== host.mountedId || target.id === replacedId) mountTab(target);
};

/** Releases what the open window holds. Runs after the content's CMPs are removed (a close, or a
 * rebuild right before the new content is built). */
const onWindowContentRemoved = () => {
  host.unmount();
  windowRoot = null;
  menu = null;
  containers.retain(new Set());
  _releaseFrameProbe();
  updateOnScreenTools('PLAY');
};

/** The window content: the tab menu over the mounted tab. Built on every open and rebuild. */
const buildWindowContent = () => {
  const root = CMP({ class: styles.profiler, onRemoveCmp: onWindowContentRemoved });
  windowRoot = root;
  _acquireFrameProbe();

  const def = tabs.get(getSavedTabId()) || getOrderedTabs()[0];
  menu = createTabs({
    label: 'Profiler tabs',
    activation: 'manual',
    tabs: getMenuTabs(),
    ...(def ? { selected: def.id } : {}),
    class: styles.tabs,
    onSelect: onMenuSelect,
  });
  root.add(menu.cmp);
  if (def) mountTab(def);

  updateOnScreenTools('PLAY');
  return root;
};

// Kept in editor views (Views.ts): F8 opens it in every view
registerDraggableWindow(PROFILER_WINDOW_ID, { content: buildWindowContent, keepInViews: true });

export const _toggleProfilerWindow = () => toggleDraggableWindow(getWindowProps());

export const _isProfilerWindowOpen = () => Boolean(windowRoot);

export const _createProfilerTab = (def: AnyDebuggerTabDef) => {
  if (def.sceneId) {
    lwarn(`Profiler tab "${def.id}" has a sceneId, which profiler tabs don't support (ignored).`);
  }
  // A replaced tab keeps its registration position
  const isReplaced = tabs.has(def.id);
  tabs.set(def.id, def);
  syncTabs(isReplaced ? def.id : undefined);
};

export const _removeProfilerTab = (id: string) => {
  if (!tabs.has(id)) {
    lwarn(`Could not find a profiler tab to remove with id "${id}" in removeProfilerTab`);
    return;
  }
  // Its cleanup runs before its container goes with its panel
  if (host.mountedId === id) host.unmount();
  tabs.delete(id);
  syncTabs();
};

export const _openProfilerTab = (id: string) => {
  const def = tabs.get(id);
  if (!def) {
    lwarn(`Could not find a profiler tab to open with id "${id}" in openProfilerTab`);
    return;
  }
  saveTabId(id);
  // An open window shows the tab first, so its focus on the front goes to the tab's button
  if (menu && host.mountedId !== id) mountTab(def);
  // Opens the window on the saved tab, or brings an open one to the front
  openDraggableWindow(getWindowProps());
};

export const _isProfilerTabOpen = (id: string) => Boolean(windowRoot) && host.mountedId === id;

/** The profiler window for the test bridge (p806 D14): its content root, the mounted tab and the
 * tab ids in menu order. */
export const _getProfilerTestInfo = () => ({
  element: windowRoot?.elem ?? null,
  mountedId: host.mountedId,
  tabIds: getOrderedTabs().map((def) => def.id),
});

export const _updateProfilerTab = (id: string, opts?: UpdateDebuggerTabOpts) => {
  if (!_isProfilerTabOpen(id)) return;
  host.refresh(opts?.rebuild);
};

// STATS SOURCES

export { _onStatsSourceReplaced } from './_dbg__StatsSources';

registerBuiltInStatsSources(settings);

// BUILT-IN TABS

_createProfilerTab(createProfilerOverviewTabDef(settings));
_createProfilerTab(
  createProfilerObjectsTabDef({ settings, setSettings: (partial) => _setProfilerSettings(partial) })
);
_createProfilerTab(settingsTabDef);
