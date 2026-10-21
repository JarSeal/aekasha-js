import { CMP } from '../ui/CMP';
import type { TCMP } from '../ui/CMPTypes';
import styles from './DebuggerGUI.module.scss';
import { lsRemoveItem } from '../utils/LocalAndSessionStorage';
import { lerror } from '../utils/Logger';
import type { AnyDebuggerTabDef } from './DebuggerGUI';
import { getSvgIcon } from '../ui/icons/SvgIcon';
import { createClearTabLSButton, lsKeyHasData } from './_dbg__ClearLSButtons';
import { _buildDebuggerPane } from './_dbg__DebuggerPaneBuilder';
import { _refreshDebuggerLists } from './_dbg__DebuggerList';

export type TabHostOpts = {
  /** The element the mounted tab's content goes in, which is also its scroller. Re-read on every
   * use, because the owner may rebuild it (the drawer, a window's content). */
  getContainer: () => TCMP | null;
  /** Whether the host can be seen (eg. the drawer is open). A tab's `refreshIntervalMs` runs only
   * while it can. */
  isVisible: () => boolean;
  /** Runs after a tab's content is mounted (eg. to select its menu button). */
  onMount?: (def: AnyDebuggerTabDef) => void;
  /** Error log prefix. Default 'Debugger tab'. */
  label?: string;
};

export type TabHost = {
  /** Replaces the container's content with this tab's fresh content. */
  mount: (def: AnyDebuggerTabDef) => void;
  /** Refreshes the mounted tab's content (panes, lists and CMP sections with an `html`
   * function), or with `rebuild` mounts it again, keeping the scroll position. */
  refresh: (rebuild?: boolean) => void;
  /** Runs the mounted tab's lifecycle cleanup. The DOM/CMP removal is up to the owner. */
  unmount: () => void;
  /** The host became visible: refreshes the mounted tab (it wasn't refreshed while hidden) and
   * starts its refresh interval. */
  resume: () => void;
  /** The host was hidden: stops the mounted tab's refresh interval. */
  pause: () => void;
  /** The mounted tab's id, or null. */
  readonly mountedId: string | null;
};

/** The tab whose content is currently in the container. */
type MountedTab = {
  def: AnyDebuggerTabDef;
  /** Refresh function of each content section. */
  sectionRefreshers: (() => void)[];
  onOpenCleanup: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
};

/** Runs a tab's `onRefresh`; a throw is logged. */
const runOnRefresh = (def: AnyDebuggerTabDef, label: string) => {
  try {
    def.onRefresh?.();
  } catch (err) {
    lerror(`${label} "${def.id}" onRefresh failed`, err);
  }
};

/** Adds a dynamic CMP section's refresher: only a dynamic template has anything to refresh (a
 * static CMP is left alone), and it is only re-rendered when its html changed (a re-render
 * replaces the element: hover, focus). The html is computed once per refresh: the update
 * renders the string the comparison computed. */
const addCmpSectionRefresher = (section: TCMP, sectionRefreshers: (() => void)[]) => {
  const html = section.props?.html;
  if (typeof html !== 'function') return;
  let lastHtml = html(section);
  let renderedHtml: string | null = null;
  const cachedHtml = (cmp: TCMP) => renderedHtml ?? html(cmp);
  sectionRefreshers.push(() => {
    const nextHtml = html(section);
    if (nextHtml === lastHtml) return;
    lastHtml = nextHtml;
    renderedHtml = nextHtml;
    try {
      section.update({ html: cachedHtml });
    } finally {
      renderedHtml = null;
    }
  });
};

/** Builds the content sections into the container. Throws what the tab's code throws. */
const buildSections = (
  def: AnyDebuggerTabDef,
  container: TCMP,
  sectionRefreshers: (() => void)[],
  label: string
) => {
  runOnRefresh(def, label);
  const sections = def.content();
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if ('isCmp' in section) {
      container.add(section);
      addCmpSectionRefresher(section, sectionRefreshers);
      continue;
    }
    const built = _buildDebuggerPane(def, section);
    container.add(built.cmp);
    sectionRefreshers.push(built.refresh);
  }
};

/**
 * Builds a tab: container with the heading row, then the content sections. A tab whose code
 * throws gets an error line in place of its content (logged), so a broken tab never breaks
 * the drawer's or the window's build.
 * @returns the container, its sections' refreshers, and whether the build failed
 */
const buildTabContent = (def: AnyDebuggerTabDef, label: string) => {
  const container = CMP({ id: `debuggerPane-${def.id}`, class: styles.childContainer });
  const sectionRefreshers: (() => void)[] = [];

  const headingRow = container.add({ class: 'debuggerTabHeadingRow' });
  const icon = getSvgIcon(def.icon);
  headingRow.add({ html: () => `<h3>${icon} ${def.title}</h3>`, class: 'debuggerTabHeading' });
  try {
    const lsKey = def.lsKey;
    if (def.clearLSButton ?? Boolean(lsKey)) {
      headingRow.add(
        createClearTabLSButton({
          hasData: () => (lsKey ? lsKeyHasData(lsKey) : false),
          onClear: () => {
            if (!lsKey) return;
            lsRemoveItem(lsKey);
            def.onClearLS?.();
          },
          watchKey: lsKey,
        })
      );
    }
    const headerButtons = def.headerButtons?.() || [];
    for (let i = 0; i < headerButtons.length; i++) headingRow.add(headerButtons[i]);

    buildSections(def, container, sectionRefreshers, label);
  } catch (err) {
    lerror(`${label} "${def.id}" failed to build`, err);
    // What was built before the throw stays out: only the heading and the error line
    for (const child of [...container.children]) {
      if (child !== headingRow) child.remove();
    }
    const message = err instanceof Error ? err.message : String(err);
    container.add({
      class: 'debuggerTabError',
      text: `This tab failed to build: ${message} (see the console).`,
    });
    return { container, sectionRefreshers: [], failed: true };
  }

  return { container, sectionRefreshers, failed: false };
};

/**
 * Creates a tab host: the lifecycle of one mounted debugger tab ({@link AnyDebuggerTabDef}) in a
 * container. It builds the heading row and the sections, refreshes them, runs `onOpen` and its
 * cleanup, and runs `refreshIntervalMs` only while the host is visible. The owner keeps its own
 * menu, ordering and state (the debug drawer and the profiler window each use one host).
 * @param opts ({@link TabHostOpts})
 */
export const createTabHost = (opts: TabHostOpts): TabHost => {
  const { getContainer, isVisible, onMount, label = 'Debugger tab' } = opts;
  let mountedTab: MountedTab | null = null;

  const refreshMountedTab = () => {
    if (!mountedTab) return;
    runOnRefresh(mountedTab.def, label);
    const refreshers = mountedTab.sectionRefreshers;
    try {
      for (let i = 0; i < refreshers.length; i++) refreshers[i]();
      const container = getContainer();
      if (container) _refreshDebuggerLists(container.elem);
    } catch (err) {
      // Logged once: the interval stops, and the content stays as it was last refreshed
      lerror(`${label} "${mountedTab.def.id}" failed to refresh`, err);
      stopInterval();
    }
  };

  const startInterval = () => {
    if (!mountedTab || mountedTab.intervalId !== null || !isVisible()) return;
    const intervalMs = mountedTab.def.refreshIntervalMs;
    if (!intervalMs) return;
    mountedTab.intervalId = setInterval(() => {
      if (isVisible()) refreshMountedTab();
    }, intervalMs);
  };

  const stopInterval = () => {
    if (!mountedTab || mountedTab.intervalId === null) return;
    clearInterval(mountedTab.intervalId);
    mountedTab.intervalId = null;
  };

  const unmount = () => {
    if (!mountedTab) return;
    stopInterval();
    const cleanup = mountedTab.onOpenCleanup;
    const id = mountedTab.def.id;
    mountedTab = null;
    try {
      cleanup?.();
    } catch (err) {
      lerror(`${label} "${id}" onOpen cleanup failed`, err);
    }
  };

  const mount = (def: AnyDebuggerTabDef) => {
    const hostContainer = getContainer();
    if (!hostContainer) return;
    unmount();
    hostContainer.removeChildren();

    const { container, sectionRefreshers, failed } = buildTabContent(def, label);
    hostContainer.add(container);

    mountedTab = { def, sectionRefreshers, onOpenCleanup: null, intervalId: null };
    onMount?.(def);
    // A failed tab has nothing to open or refresh: it stays mounted (its menu button selected)
    // until another tab is mounted, or it is mounted again
    if (failed) return;
    if (def.onOpen) {
      try {
        mountedTab.onOpenCleanup = def.onOpen() || null;
      } catch (err) {
        lerror(`${label} "${def.id}" onOpen failed`, err);
      }
    }
    startInterval();
  };

  const refresh = (rebuild?: boolean) => {
    if (!rebuild) {
      refreshMountedTab();
      return;
    }
    const container = getContainer();
    if (!mountedTab || !container) return;
    const scrollPos = container.elem.scrollTop;
    mount(mountedTab.def);
    container.elem.scrollTop = scrollPos;
  };

  return {
    mount,
    refresh,
    unmount,
    resume: () => {
      refreshMountedTab();
      startInterval();
    },
    pause: stopInterval,
    get mountedId() {
      return mountedTab?.def.id ?? null;
    },
  };
};
