import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import styles from './DebuggerGUI.module.scss';
import { lsRemoveItem } from '../utils/LocalAndSessionStorage';
import { lerror } from '../utils/Logger';
import type { AnyDebuggerTabDef } from './DebuggerGUI';
import { getSvgIcon } from '../ui/core/icons/SvgIcon';
import { createClearTabLSButton, lsKeyHasData } from './_dbg__ClearLSButtons';
import { _buildDebuggerPane } from './_dbg__DebuggerPaneBuilder';
import { _refreshDebuggerLists } from './_dbg__DebuggerList';
import { createEmptyState } from '../ui/components/EmptyState';
import type { ContextMenu } from '../ui/overlays/ContextMenu';
import {
  createBindingScheduler,
  type BindingScheduler,
} from '../ui/forms/binding/BindingScheduler';
import { createFieldContextMenu } from '../ui/forms/FieldContextMenu';

export type TabHostOpts = {
  /** The element the mounted tab's content goes in, which is also its scroller. Re-read on every
   * use, because the owner may rebuild it (the drawer, a window's content). */
  getContainer: () => CMPHandle | null;
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
  /** Refreshes the mounted tab's content (`onRefresh`, the CMP sections with an `html` function,
   * the lists, then the fields through the scheduler), or with `rebuild` mounts it again, keeping
   * the scroll position. */
  refresh: (rebuild?: boolean) => void;
  /** A scene change (p806 D5): the mounted tab is rebuilt, or with `keepOnSceneChange` kept
   * (`onSceneChange`, then a refresh). */
  sceneChanged: () => void;
  /** Runs the mounted tab's lifecycle cleanup. The DOM/CMP removal is up to the owner. */
  unmount: () => void;
  /** The host became visible: refreshes the mounted tab (it wasn't refreshed while hidden) and
   * starts its refresh interval and its scheduler's tick. */
  resume: () => void;
  /** The host was hidden: stops the mounted tab's refresh interval and its scheduler's tick. */
  pause: () => void;
  /** Unmounts the tab and disposes of the scheduler and the fields' context menu: an owner that
   * goes (the editor drawer). */
  dispose: () => void;
  /** The host's refresh scheduler: every declarative section's, and `content`'s `ctx.scheduler`. */
  readonly scheduler: BindingScheduler;
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
const addCmpSectionRefresher = (section: CMPHandle, sectionRefreshers: (() => void)[]) => {
  const html = section.props?.html;
  if (typeof html !== 'function') return;
  let lastHtml = html(section);
  let renderedHtml: string | null = null;
  const cachedHtml = (cmp: CMPHandle) => renderedHtml ?? html(cmp);
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

/** Builds the content sections into the container. Throws what the tab's code throws. Every
 * declarative section shares the host's scheduler, which the host refreshes once for all. */
const buildSections = (
  def: AnyDebuggerTabDef,
  container: CMPHandle,
  sectionRefreshers: (() => void)[],
  label: string,
  scheduler: BindingScheduler
) => {
  runOnRefresh(def, label);
  const sections = def.content({ scheduler });
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if ('isCmp' in section) {
      container.add(section);
      addCmpSectionRefresher(section, sectionRefreshers);
      continue;
    }
    container.add(_buildDebuggerPane(def, section, { scheduler }).cmp);
  }
};

/** The error line in a failed tab's place (p806 D5): a kit empty state in the danger role */
const createTabError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return createEmptyState({
    title: 'This tab failed to build',
    text: `${message} (see the console).`,
    icon: getSvgIcon('alert'),
    class: 'debuggerTabError',
    attr: { role: 'alert' },
  }).cmp;
};

/**
 * Builds a tab: container with the heading row, then the content sections. A tab whose code
 * throws gets an error line in place of its content (logged), so a broken tab never breaks
 * the drawer's or the window's build.
 * @returns the container, its sections' refreshers, and whether the build failed
 */
const buildTabContent = (def: AnyDebuggerTabDef, label: string, scheduler: BindingScheduler) => {
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

    buildSections(def, container, sectionRefreshers, label, scheduler);
  } catch (err) {
    lerror(`${label} "${def.id}" failed to build`, err);
    // What was built before the throw stays out: only the heading and the error line
    for (const child of [...container.children]) {
      if (child !== headingRow) child.remove();
    }
    container.add(createTabError(err));
    return { container, sectionRefreshers: [], failed: true };
  }

  return { container, sectionRefreshers, failed: false };
};

/**
 * Creates a tab host: the lifecycle of one mounted debugger tab ({@link AnyDebuggerTabDef}) in a
 * container. It builds the heading row and the sections, refreshes them, runs `onOpen` and its
 * cleanup, and runs `refreshIntervalMs` only while the host is visible. Its one refresh scheduler
 * (p806 D5) is every declarative section's and `content`'s `ctx.scheduler`, its tick running
 * while the host shows, and one fields' context menu covers its container. The owner keeps its own
 * menu, ordering and state (the debug drawer and the profiler window each use one host).
 * @param opts ({@link TabHostOpts})
 */
export const createTabHost = (opts: TabHostOpts): TabHost => {
  const { getContainer, isVisible, onMount, label = 'Debugger tab' } = opts;
  let mountedTab: MountedTab | null = null;
  // One per host (p806 D5): its tick runs while the host shows, as the refresh interval does
  const scheduler = createBindingScheduler({ visible: false });
  /** The fields' context menu (Reset, Copy, Paste), on the container it was made for: an owner
   * may rebuild its container (the drawer, a window's content) */
  let fieldMenu: { menu: ContextMenu; elem: HTMLElement } | null = null;

  const removeFieldMenu = () => {
    fieldMenu?.menu.cmp.remove();
    fieldMenu = null;
  };

  const ensureFieldMenu = (elem: HTMLElement) => {
    if (fieldMenu?.elem === elem) return;
    removeFieldMenu();
    fieldMenu = { menu: createFieldContextMenu({ container: elem }), elem };
  };

  const refreshMountedTab = () => {
    if (!mountedTab) return;
    runOnRefresh(mountedTab.def, label);
    const refreshers = mountedTab.sectionRefreshers;
    try {
      for (let i = 0; i < refreshers.length; i++) refreshers[i]();
      const container = getContainer();
      if (container) _refreshDebuggerLists(container.elem);
      scheduler.refresh();
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
    scheduler.setVisible(false);
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
    ensureFieldMenu(hostContainer.elem);

    const { container, sectionRefreshers, failed } = buildTabContent(def, label, scheduler);
    hostContainer.add(container);

    mountedTab = { def, sectionRefreshers, onOpenCleanup: null, intervalId: null };
    scheduler.setVisible(isVisible());
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

  const sceneChanged = () => {
    if (!mountedTab) return;
    const def = mountedTab.def;
    if (!def.keepOnSceneChange) {
      refresh(true);
      return;
    }
    try {
      def.onSceneChange?.();
    } catch (err) {
      lerror(`${label} "${def.id}" onSceneChange failed`, err);
    }
    refreshMountedTab();
  };

  return {
    mount,
    refresh,
    sceneChanged,
    unmount,
    resume: () => {
      scheduler.setVisible(Boolean(mountedTab) && isVisible());
      refreshMountedTab();
      startInterval();
    },
    pause: () => {
      scheduler.setVisible(false);
      stopInterval();
    },
    dispose: () => {
      unmount();
      removeFieldMenu();
      scheduler.dispose();
    },
    scheduler,
    get mountedId() {
      return mountedTab?.def.id ?? null;
    },
  };
};
