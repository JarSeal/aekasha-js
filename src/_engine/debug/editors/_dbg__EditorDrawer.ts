/**
 * An editor view's right drawer (docs/plans/_DONE_p084_material-editor-stage-and-selector.md DD6),
 * written for every editor: the scene debug drawer's shell (p806 D6, `_dbg__DrawerShell.ts`: the
 * toggler, the width handle, the heading row with a title and a close button, the tab rail, a
 * scrolling container per tab) mounting ordinary
 * debugger tab definitions ({@link AnyDebuggerTabDef}) through a tab host of its own, so panes,
 * lists, clear-LS buttons, `onRefresh` / `onOpen` / `refreshIntervalMs` and folder persistence
 * work as in the scene drawer.
 *
 * An instance, not a singleton: each editor creates its own. It is only UI: the editor keeps its
 * state (`initialState`, `onStateChange`), and tells it when its view is entered or left
 * (`setActive`). While active and open, it sets the `debugDrawerOpen` body class, so the top
 * on-screen row, the viewport stack and the editor's own UI shift with it.
 */
import type { CMPHandle } from '../../ui/core/CMPTypes';
import type { AnyDebuggerTabDef } from '../DebuggerGUI';
import { appendDebuggerRoot } from '../../ui/overlays/DebuggerRoot';
import { createTabHost } from '../_dbg__TabHost';
import { createDrawerShell, setBodyDrawerWidth } from '../_dbg__DrawerShell';

/** Set on <body> while a right-side debug drawer is open (_dbg__DebuggerGUI.ts). */
const DRAWER_OPEN_BODY_CLASS = 'debugDrawerOpen';

/** The drawer's UI state (persisted by the editor). */
export type EditorDrawerState = {
  isOpen: boolean;
  /** Empty = the first tab. */
  currentTabId: string;
  /** Each tab's scroll position, by tab id. */
  scrollPos: Record<string, number>;
  /** The width its handle set, in px (none: the default) */
  width?: number;
};

export type EditorDrawerOpts = {
  /** Unique among the drawers (the element ids are prefixed with it). */
  id: string;
  /** The parent element (the editor's HUD, which must have KEEP_IN_VIEWS_CLASS). */
  parent: HTMLElement;
  /** The toggler button's text (eg. 'Material'), also the drawer's accessible name. */
  togglerText: string;
  /** The small label above the title (eg. 'Material'). */
  headingLabel: string;
  /** The title (eg. the material's name), re-read on every refresh and rebuild. */
  getTitle: () => string;
  /** The tabs, in menu order. Called again on every rebuild (an editor's tabs can be per
   * subject, eg. per material). */
  getTabs: () => AnyDebuggerTabDef[];
  initialState?: Partial<EditorDrawerState>;
  /** After any state change (open, tab, scroll, width). */
  onStateChange?: (state: EditorDrawerState) => void;
};

export type EditorDrawer = {
  cmp: CMPHandle;
  /** Opens or closes the drawer (no argument toggles it). */
  toggle: (open?: boolean) => void;
  isOpen: () => boolean;
  /** Its view was entered (true) or left (false): only an active drawer drives the
   * `debugDrawerOpen` body class and refreshes its tab. */
  setActive: (active: boolean) => void;
  /** Re-reads the tabs (`getTabs`) and the title, and mounts the current tab again (its scroll
   * position is kept). */
  rebuild: () => void;
  /** Refreshes the title and the mounted tab. */
  refresh: () => void;
  getState: () => EditorDrawerState;
  dispose: () => void;
};

/**
 * Creates an editor view's right drawer in `opts.parent` (see the file comment).
 * @param opts ({@link EditorDrawerOpts})
 * @returns ({@link EditorDrawer})
 */
export const createEditorDrawer = (opts: EditorDrawerOpts): EditorDrawer => {
  const { id } = opts;
  const state: EditorDrawerState = {
    isOpen: opts.initialState?.isOpen ?? false,
    currentTabId: opts.initialState?.currentTabId ?? '',
    scrollPos: { ...opts.initialState?.scrollPos },
    ...(opts.initialState?.width === undefined ? {} : { width: opts.initialState.width }),
  };
  const notify = () => opts.onStateChange?.({ ...state, scrollPos: { ...state.scrollPos } });

  let isActive = false;
  let tabs: AnyDebuggerTabDef[] = [];

  const isVisible = () => isActive && state.isOpen;

  const shell = createDrawerShell({
    id,
    label: opts.togglerText,
    togglerText: opts.togglerText,
    headingLabel: opts.headingLabel,
    title: opts.getTitle(),
    railLabel: `${opts.togglerText} tabs`,
    isOpen: state.isOpen,
    width: state.width,
    onToggle: () => toggle(undefined, true),
    onClose: () => toggle(false),
    onSelect: (tabId) => {
      const def = tabs.find((tab) => tab.id === tabId);
      if (def) selectTab(def);
    },
    onWidthInput: (width) => {
      if (isVisible()) setBodyDrawerWidth(width);
    },
    onWidthChange: (width) => {
      state.width = width;
      notify();
    },
    onScroll: (tabId, scrollTop) => {
      // Not a tab being emptied or rebuilt, nor while a display: none ancestor resets it
      if (tabId !== host.mountedId || !isVisible()) return;
      state.scrollPos[tabId] = scrollTop;
      notify();
    },
  });

  const host = createTabHost({
    getContainer: () => shell.getContainer(),
    isVisible,
    label: `Editor drawer "${id}" tab`,
  });

  /** The saved tab, or the first one. */
  const getCurrentTab = () => tabs.find((tab) => tab.id === state.currentTabId) || tabs[0];

  /** A display: none ancestor (the editor's HUD outside its view) loses the scroll position. */
  const restoreScroll = () => {
    const tabId = host.mountedId;
    const container = shell.getContainer();
    if (container) container.elem.scrollTop = tabId ? state.scrollPos[tabId] || 0 : 0;
  };

  const mountTab = (def: AnyDebuggerTabDef) => {
    shell.select(def.id);
    host.mount(def);
    shell.clearOtherContainers();
    restoreScroll();
  };

  const selectTab = (def: AnyDebuggerTabDef) => {
    if (host.mountedId === def.id) return;
    state.currentTabId = def.id;
    mountTab(def);
    notify();
  };

  const rebuild = () => {
    shell.setTitle(opts.getTitle());
    tabs = opts.getTabs();
    host.unmount();
    shell.setTabs(tabs.map((tab) => ({ id: tab.id, title: tab.title, icon: tab.icon })));
    const def = getCurrentTab();
    if (def) mountTab(def);
  };

  const refresh = () => {
    shell.setTitle(opts.getTitle());
    host.refresh();
  };

  const applyBodyClass = () => {
    if (!isActive) return;
    document.body.classList.toggle(DRAWER_OPEN_BODY_CLASS, state.isOpen);
    if (state.isOpen) setBodyDrawerWidth(shell.getWidth());
  };

  /** The toggler's click puts the focus on the open tab in the rail (p806 D12) */
  const toggle = (open?: boolean, focusTab?: boolean) => {
    const nextOpen = open ?? !state.isOpen;
    if (nextOpen === state.isOpen) return;
    state.isOpen = nextOpen;
    shell.setOpen(nextOpen, { focusTab });
    applyBodyClass();
    // The tab was not refreshed while closed
    if (isVisible()) host.resume();
    else host.pause();
    notify();
  };

  const setActive = (active: boolean) => {
    if (isActive === active) return;
    isActive = active;
    if (!active) {
      host.pause();
      // The view that is entered next (or the scene drawer) sets it again
      document.body.classList.remove(DRAWER_OPEN_BODY_CLASS);
      return;
    }
    applyBodyClass();
    restoreScroll();
    if (state.isOpen) host.resume();
  };

  appendDebuggerRoot(opts.parent, shell.cmp);
  rebuild();

  return {
    cmp: shell.cmp,
    toggle: (open) => toggle(open),
    isOpen: () => state.isOpen,
    setActive,
    rebuild,
    refresh,
    getState: () => ({ ...state, scrollPos: { ...state.scrollPos } }),
    dispose: () => {
      setActive(false);
      host.dispose();
      shell.dispose();
    },
  };
};
