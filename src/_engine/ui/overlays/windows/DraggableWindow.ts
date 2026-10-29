// The draggable windows: their registries, the stacks, the window's DOM, the scene load and boot
// hooks, and the public API (types: DraggableWindowTypes.ts; configs and LS:
// DraggableWindowStore.ts; geometry: DraggableWindowGeometry.ts; drags: DraggableWindowDrag.ts;
// the header and the parts without state: DraggableWindowDom.ts; keys: DraggableWindowKeys.ts).
// Over the 800-line limit (p617 D10), with docs: what is left shares the module's state (the
// windows map, the stacks, the kind registries, the suspended windows), so a further split
// would make the modules import each other.
import type { CMPHandle } from '../../core/CMPTypes';
import { CMP } from '../../core/CMP';
import { lerror } from '../../../utils/Logger';
import { getConfig, IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../../../kernel/config/Config';
import { getHUDRootCMP, KEEP_IN_VIEWS_CLASS } from '../../core/HUD';
import { onBoundsResize } from '../../core/Window';
import { addSceneHooks } from '../../../kernel/scene/SceneHooks';
import { addBootAfterStartHook } from '../../../kernel/init/BootHooks';
import './DraggableWindow.scss';
import '../../styles/kit.scss';
import { getFirstFocusable } from '../FocusTrap';
import { addDragHandle, cancelDragSession } from './DraggableWindowDrag';
import {
  buildHeader,
  getThemeAttr,
  getWindowAttr,
  getPartId,
  renderTitle,
  syncContentTabStop,
  WINDOW_CLASS,
  writeCollapsedState,
  writeWindowName,
} from './DraggableWindowDom';
import {
  fitWindow,
  getGeometryStyle,
  isFittable,
  keepOnScreen,
  placeWindow,
} from './DraggableWindowGeometry';
import { addWindowCycleListener } from './DraggableWindowKeys';
import {
  createRuntime,
  hydrateFromLS,
  kindGeometry,
  recordKindGeometry,
  resolveWindowConfig,
  writeWindowStatesToLS,
} from './DraggableWindowStore';
import type {
  DraggableWindow,
  DraggableWindowConfig,
  DraggableWindowData,
  DraggableWindowKindOpts,
  DraggableWindowRuntime,
  DragMode,
  OpenDraggableWindowProps,
  SceneTargetResolver,
  WindowEntry,
} from './DraggableWindowTypes';

/** The window stacks: the app's windows, the app's modal dialogs, the debug windows and the debug
 * modal dialogs (p803 D7) */
type Layer = 'APP' | 'DIALOG' | 'DEBUG' | 'DEBUG_DIALOG';
/**
 * Each stack's z-index base: its token's value (`tokens.css`' `--aek-z-window`, `-dialog`,
 * `-debug-window`, `-debug-dialog`; `DraggableWindow.test.ts` keeps them equal). Each window takes
 * two z levels (its backdrop right below it). The app's windows stay below the scene loader
 * (1000), room for about 450; the app's dialogs below the debugger (10000 and up), so an app's
 * modal dialog leaves it usable (p803 D7).
 * @internal
 */
export const Z_INDEX_BASES: Record<Layer, number> = {
  APP: 100,
  DIALOG: 5000,
  DEBUG: 20000,
  DEBUG_DIALOG: 30000,
};
const DEBUG_ADDITION_TO_CUSTOM_Z_INDEX = 100;
const RESIZE_DEBOUNCE_MS = 150;

/** Every known window, open or not. Hydrated from LS on the first access (see getWindows). */
let windows: Map<string, WindowEntry> | null = null;
/** Each layer's open windows, bottom to top. */
const stacks: Record<Layer, string[]> = { APP: [], DIALOG: [], DEBUG: [], DEBUG_DIALOG: [] };
/** The modal dialogs' ids (`openDialog`'s), which stack in the dialog layers */
const modalIds = new Set<string>();
/** Keyed by kind (a window's kind, or its id when it has none) */
const contentFns: { [kind: string]: (data?: DraggableWindowData) => CMPHandle } = {};
const sceneTargetResolvers: { [kind: string]: SceneTargetResolver } = {};
const registeredKinds = new Set<string>();
const kindOnCloses: { [kind: string]: (id: string) => void } = {};
const keepInViewsKinds = new Set<string>();
/** Windows suspended at a scene change start: torn down but kept open until the scene change end
 * decides whether their target exists in the next scene. */
const suspendedWindowIds = new Set<string>();
let isViewportResizerAdded = false;
let isCycleListenerAdded = false;
let viewportResizeTimer: ReturnType<typeof setTimeout> | null = null;

/** Non-debug (app) windows are always allowed. Debug windows are allowed in debug mode, and in
 * prodTest mode only when they opt in with `showInProdTest`. */
const isDraggableWindowAllowed = (config: { isDebugWindow?: boolean; showInProdTest?: boolean }) =>
  !config.isDebugWindow || IS_DEBUG_ENV || (Boolean(config.showInProdTest) && IS_PROD_TEST_MODE);

/** A window's kind: its `kind`, else its id. The kind registries are keyed by it. */
const getWindowKind = (config: DraggableWindowConfig) => config.kind ?? config.id;

// State

let areWindowHooksAdded = false;

/** Adds the windows' part of every scene load and the boot's restore from LS, on the windows'
 * first use (p613 D5): neither the scene loader nor the boot names this module, so a build that
 * uses no window leaves it out. A first use after the boot restores nothing. */
const addWindowHooks = () => {
  if (areWindowHooksAdded) return;
  areWindowHooksAdded = true;
  addSceneHooks({
    // Before the features' exit hooks: the windows go before the entities they show
    loadStart: handleWindowsOnSceneChangeStart,
    // After the enter listeners, so entities the scene code created exist too
    entered: () => handleWindowsOnSceneChangeEnd(false),
    // A failed load (its entered hooks didn't run): the windows it suspended close
    loadSettled: () => {
      if (suspendedWindowIds.size) handleWindowsOnSceneChangeEnd(true);
    },
  });
  addBootAfterStartHook(loadDraggableWindowStatesFromLS);
};

const getWindows = () => {
  if (!windows) {
    addWindowHooks();
    windows = new Map();
    hydrateFromLS(windows);
  }
  return windows;
};

/** Writes the windows' states to LS (`DraggableWindowStore.ts`). Called on finished changes only. */
const saveDraggableWindowStatesToLS = () => writeWindowStatesToLS(getWindows());

/** A drag's end that changed a window: its geometry becomes its kind's, and LS gets it. */
const commitDrag = (entry: WindowEntry) => {
  recordKindGeometry(entry);
  saveDraggableWindowStatesToLS();
};

/** Runs the window's own onClose, else its kind's. */
const runOnClose = ({ config, runtime }: WindowEntry) => {
  if (runtime.onClose) {
    runtime.onClose();
    return;
  }
  kindOnCloses[getWindowKind(config)]?.(config.id);
};

const toPublicWindow = ({ config, runtime }: WindowEntry): DraggableWindow => ({
  ...config,
  isActive: isDraggableWindowOnTop(config.id),
  windowCMP: runtime.windowCMP,
  backDropCMP: runtime.backDropCMP,
  content: runtime.content,
  onClose: runtime.onClose,
});

// Stacking

const getLayer = ({ id, isDebugWindow }: DraggableWindowConfig): Layer =>
  modalIds.has(id) ? (isDebugWindow ? 'DEBUG_DIALOG' : 'DIALOG') : isDebugWindow ? 'DEBUG' : 'APP';

/**
 * Makes a window a modal dialog (`openDialog`, before it opens it): it stacks with the dialogs,
 * above the windows of its layer (p803 D7). Kept until the window is removed.
 * @internal
 */
export const setDraggableWindowModal = (id: string) => {
  modalIds.add(id);
};

const getWindowZIndex = (config: DraggableWindowConfig, index: number) => {
  if (config.customZIndex !== undefined) {
    return config.isDebugWindow
      ? config.customZIndex + DEBUG_ADDITION_TO_CUSTOM_Z_INDEX
      : config.customZIndex;
  }
  return Z_INDEX_BASES[getLayer(config)] + 2 * index;
};

/** Writes the z-index of every window in the stack whose index changed. */
const restack = (stack: string[]) => {
  for (let i = 0; i < stack.length; i++) {
    const entry = getWindows().get(stack[i]);
    if (!entry) continue;
    entry.config.orderNr = i;
    const zIndex = getWindowZIndex(entry.config, i);
    if (entry.runtime.zIndex === zIndex) continue;
    entry.runtime.zIndex = zIndex;
    entry.runtime.windowCMP?.updateStyle({ zIndex });
    entry.runtime.backDropCMP?.updateStyle({ zIndex: zIndex - 1 });
  }
};

const removeFromStacks = (id: string) => {
  const layers = Object.keys(stacks) as Layer[];
  for (let i = 0; i < layers.length; i++) {
    const stack = stacks[layers[i]];
    const index = stack.indexOf(id);
    if (index === -1) continue;
    stack.splice(index, 1);
    restack(stack);
  }
};

/** Puts a window on top of its layer. Returns whether the order changed. */
const moveToTop = (id: string) => {
  const entry = getWindows().get(id);
  if (!entry?.runtime.windowCMP) return false;
  const stack = stacks[getLayer(entry.config)];
  const index = stack.indexOf(id);
  if (index !== -1 && index === stack.length - 1) return false;
  if (index !== -1) {
    stack.splice(index, 1);
  } else {
    removeFromStacks(id);
  }
  stack.push(id);
  restack(stack);
  return true;
};

/**
 * Brings an open window to the front of its layer (the app's windows, the app's dialogs, the debug
 * windows or the debug dialogs); a no-op for one that's closed or on top already.
 */
export const bringDraggableWindowToFront = (id: string) => {
  if (moveToTop(id)) saveDraggableWindowStatesToLS();
};

/**
 * Whether the window is on top of its layer (the app's windows, the app's dialogs, the debug
 * windows or the debug dialogs): false for an unknown or a closed one.
 */
export const isDraggableWindowOnTop = (id: string) => {
  const entry = getWindows().get(id);
  if (!entry) return false;
  const stack = stacks[getLayer(entry.config)];
  return stack[stack.length - 1] === id;
};

const getOpenWindowsOfKind = (kind: string) => {
  const result: WindowEntry[] = [];
  for (const entry of getWindows().values()) {
    if (entry.config.isOpen && getWindowKind(entry.config) === kind) result.push(entry);
  }
  return result;
};

/** Brings a kind's stored windows into the kind: the pre-kind window whose id is the kind (a
 * window that used to be the kind's only one) seeds the kind's geometry and is dropped, and a
 * window without a kind whose id is a `getKindWindowId(kind, key)` id gets the kind. */
const adoptKind = (kind: string) => {
  const map = getWindows();
  let isChanged = false;
  const legacy = map.get(kind);
  if (legacy && !legacy.config.kind) {
    if (!kindGeometry[kind]) {
      recordKindGeometry({ ...legacy, config: { ...legacy.config, kind } });
    }
    unmountWindow(legacy);
    suspendedWindowIds.delete(kind);
    map.delete(kind);
    isChanged = true;
  }
  const prefix = `${kind}_`;
  for (const { config } of map.values()) {
    if (config.kind || !config.id.startsWith(prefix)) continue;
    config.kind = kind;
    isChanged = true;
  }
  if (isChanged) saveDraggableWindowStatesToLS();
};

const onViewportResized = () => {
  viewportResizeTimer = null;
  let isChanged = false;
  for (const entry of getWindows().values()) {
    if (keepOnScreen(entry)) isChanged = true;
  }
  if (isChanged) saveDraggableWindowStatesToLS();
};

/** The cycle keys' listener on the HUD root's parent (`DraggableWindowKeys.ts`): added at the
 * first mount and kept */
const ensureCycleListener = () => {
  const hudRoot = getHUDRootCMP().elem;
  const parent = hudRoot.parentElement;
  if (isCycleListenerAdded || !parent) return;
  isCycleListenerAdded = true;
  addWindowCycleListener(parent, {
    hudRoot,
    getEntries: () => getWindows().values(),
    focusWindow: (entry) => {
      bringDraggableWindowToFront(entry.config.id);
      focusFirstFocusableElement(entry);
    },
  });
};

/** Added at the first mount and kept: a no-op while no window is open. */
const ensureViewportResizer = () => {
  if (isViewportResizerAdded) return;
  isViewportResizerAdded = true;
  onBoundsResize(() => {
    if (viewportResizeTimer) clearTimeout(viewportResizeTimer);
    viewportResizeTimer = setTimeout(onViewportResized, RESIZE_DEBOUNCE_MS);
  });
};

// DOM

const toClassList = (classes?: string | string[]) =>
  !classes ? [] : typeof classes === 'string' ? [classes] : classes;

/** Whether the window (and its backdrop) stays visible in editor views: a debug dialog, or a
 * window of a kind registered with `keepInViews`. */
const isKeptInViews = (config: DraggableWindowConfig) =>
  (config.isDebugWindow && config.hasBackDrop) || keepInViewsKinds.has(getWindowKind(config));

const getWindowClasses = (config: DraggableWindowConfig) => {
  const classList = [WINDOW_CLASS];
  if (isKeptInViews(config)) classList.push(KEEP_IN_VIEWS_CLASS);
  return classList.concat(toClassList(config.windowClass));
};

/** The config keys that change the window's DOM structure: a change remounts the window. */
const STRUCTURAL_KEYS = [
  'isDebugWindow',
  'disableDragging',
  'disableVertResize',
  'disableHoriResize',
  'disableCollapseBtn',
  'disableCloseBtn',
  'hasBackDrop',
  'backDropClickClosesWindow',
  'backDropClass',
] as const;

const hasStructuralChange = (prev: DraggableWindowConfig, next: DraggableWindowConfig) =>
  STRUCTURAL_KEYS.some((key) => JSON.stringify(prev[key]) !== JSON.stringify(next[key]));

const buildContent = ({ config, runtime }: WindowEntry) => {
  const { content } = runtime;
  if (typeof content === 'function') return content(config.data);
  if (content) return content;
  const kind = getWindowKind(config);
  const contentFn = contentFns[kind] ?? getConfig().draggableWindows?.[kind]?.contentFn;
  return contentFn?.(config.data);
};

/** Content passed as a CMP (not a function) outlives the window's DOM: it is detached before the
 * window is torn down, so a reopen can add it back. */
const detachStaticContent = ({ content, contentWrapperCMP }: DraggableWindowRuntime) => {
  if (!content || typeof content === 'function' || !contentWrapperCMP) return;
  contentWrapperCMP.children = contentWrapperCMP.children.filter((child) => child !== content);
  content.elem.remove();
};

const rebuildContent = (entry: WindowEntry) => {
  const wrapper = entry.runtime.contentWrapperCMP;
  if (!wrapper) return;
  detachStaticContent(entry.runtime);
  wrapper.removeChildren();
  const content = buildContent(entry);
  if (content) wrapper.add(content);
  syncContentTabStop(entry.runtime);
};

const createBackDropCMP = (entry: WindowEntry) => {
  const { id, backDropClass, backDropClickClosesWindow } = entry.config;
  return CMP({
    class: [
      'aekWindowBackdrop',
      ...(isKeptInViews(entry.config) ? [KEEP_IN_VIEWS_CLASS] : []),
      ...toClassList(backDropClass),
    ],
    ...getThemeAttr(entry.config),
    ...(backDropClickClosesWindow ? { onClick: () => closeDraggableWindow(id) } : {}),
  });
};

/** Builds the window's DOM and puts it in its stack: on top, or at its place when it has one (a
 * window suspended over a scene change). */
const mountWindow = (entry: WindowEntry) => {
  const { config, runtime } = entry;
  const { id } = config;
  const hudRoot = getHUDRootCMP();
  ensureViewportResizer();
  ensureCycleListener();

  if (config.hasBackDrop) runtime.backDropCMP = hudRoot.add(createBackDropCMP(entry));

  const windowCMP = CMP({
    id,
    idAttr: true,
    class: getWindowClasses(config),
    style: getGeometryStyle(config),
    attr: getWindowAttr(config),
  });
  runtime.windowCMP = windowCMP;
  // Capture phase: any press in the window, also one its content stops, brings it to the front;
  // so does the focus moving into it (Tab, the cycle keys)
  windowCMP.elem.addEventListener('pointerdown', () => bringDraggableWindowToFront(id), true);
  windowCMP.elem.addEventListener('focusin', () => bringDraggableWindowToFront(id));

  buildHeader(entry, {
    onCommit: commitDrag,
    onToggleCollapse: () => toggleCollapse(id),
    onClose: () => closeDraggableWindow(id),
    onFit: () => fitDraggableWindowToScreen(id),
  });
  runtime.contentWrapperCMP = windowCMP.add({
    class: 'aekWindow__content',
    attr: { id: getPartId(id, 'content') },
  });

  const resizeHandles: [string, DragMode, boolean][] = [
    ['aekWindow__resizeV', 'RESIZE_V', !config.disableVertResize],
    ['aekWindow__resizeH', 'RESIZE_H', !config.disableHoriResize],
    ['aekWindow__resizeHV', 'RESIZE_HV', !config.disableVertResize && !config.disableHoriResize],
  ];
  for (const [className, mode, isOn] of resizeHandles) {
    if (isOn) addDragHandle(entry, windowCMP.add({ class: className }).elem, mode, commitDrag);
  }

  const content = buildContent(entry);
  if (content) runtime.contentWrapperCMP.add(content);

  hudRoot.add(windowCMP);
  writeWindowName(entry);
  writeCollapsedState(entry);
  syncContentTabStop(runtime);
  runtime.zIndex = -1;
  const stack = stacks[getLayer(config)];
  if (!stack.includes(id)) {
    removeFromStacks(id);
    stack.push(id);
  }
  restack(stack);
};

/** Applies a reopen's changes to a mounted window. The content is rebuilt when `data` changed. */
const updateMountedWindow = (entry: WindowEntry, prev: DraggableWindowConfig) => {
  const { config, runtime } = entry;
  runtime.windowCMP?.updateClass(getWindowClasses(config), 'replace');
  runtime.windowCMP?.updateStyle(getGeometryStyle(config));
  writeCollapsedState(entry);
  if ((config.title !== prev.title || config.icon !== prev.icon) && runtime.titleCMP) {
    renderTitle(runtime.titleCMP, config);
    runtime.titleTooltip?.setText(config.title);
  }
  if (config.title !== prev.title || config.ariaLabel !== prev.ariaLabel) writeWindowName(entry);
  if (JSON.stringify(config.data) !== JSON.stringify(prev.data)) rebuildContent(entry);
};

/** Tears the window's DOM and content down (running the content's own teardown, eg. disposing
 * panes and clearing intervals). The config stays. */
const unmountWindow = (entry: WindowEntry, keepInStack?: boolean) => {
  const { runtime } = entry;
  // First: the focus is still where it was in the window
  const onUnmount = runtime.onUnmount;
  runtime.onUnmount = undefined;
  onUnmount?.();
  cancelDragSession(entry);
  for (const tooltip of runtime.tooltips ?? []) tooltip.cmp.remove();
  runtime.tooltips = undefined;
  runtime.collapseTooltip = undefined;
  runtime.titleTooltip = undefined;
  runtime.collapseBtnCMP = undefined;
  detachStaticContent(runtime);
  runtime.backDropCMP?.remove();
  runtime.windowCMP?.remove();
  runtime.backDropCMP = undefined;
  runtime.windowCMP = undefined;
  runtime.headerCMP = undefined;
  runtime.titleCMP = undefined;
  runtime.contentWrapperCMP = undefined;
  runtime.zIndex = -1;
  if (!keepInStack) removeFromStacks(entry.config.id);
};

/** Focuses the window's first focusable content element, else its first header button. */
const focusFirstFocusableElement = ({ runtime }: WindowEntry) => {
  const target =
    getFirstFocusable(runtime.contentWrapperCMP?.elem) ||
    getFirstFocusable(runtime.windowCMP?.elem);
  target?.focus({ preventScroll: true });
};

// Public API

/**
 * Opens a window, or reopens (and updates) the one with its id: its config resolved from `props`
 * and its stored state (see {@link OpenDraggableWindowProps}), mounted under the HUD root, put on
 * top of its layer and saved to LS when it's `saveToLS`. A debug window outside the debug env
 * isn't opened. Throws without an id.
 * @example
 * ```ts
 * openDraggableWindow({
 *   id: 'inventory',
 *   title: 'Inventory',
 *   content: () => createInventoryPanel(),
 *   size: { w: 360, h: 480 },
 *   saveToLS: true,
 * });
 * ```
 */
export const openDraggableWindow = (props: OpenDraggableWindowProps) => {
  const { id, focusFirstElement = true } = props;
  if (!id) {
    const msg = 'Draggable window has to have an id (in openDraggableWindow).';
    lerror(msg);
    throw new Error(msg);
  }

  if (props.kind) registerDraggableWindowKind(props.kind);
  const map = getWindows();
  let entry = map.get(id);
  const isNew = !entry;
  const kind = props.kind ?? entry?.config.kind;
  const config = resolveWindowConfig(props, entry?.config, kind ? kindGeometry[kind] : undefined);
  // Also gates the content: every path that builds a window's content goes through here
  if (!isDraggableWindowAllowed(config)) return;
  suspendedWindowIds.delete(id);

  if (props.closeIfOpen && entry?.config.isOpen && entry.runtime.windowCMP) {
    if (props.onClose) entry.runtime.onClose = props.onClose;
    closeDraggableWindow(id);
    return;
  }

  if (!entry) {
    entry = { config, runtime: createRuntime() };
    map.set(id, entry);
  }
  const prev = entry.config;
  // Kept on the same entry object: the window's listeners hold it
  entry.config = config;
  if (props.content) entry.runtime.content = props.content;
  if (props.onClose) entry.runtime.onClose = props.onClose;

  // A live window keeps its place (it may hang off an edge on purpose), unless the open resets it
  let shouldPlace = Boolean(props.resetPosition || props.resetSize);
  if (entry.runtime.windowCMP && !hasStructuralChange(prev, config)) {
    updateMountedWindow(entry, prev);
  } else {
    if (entry.runtime.windowCMP) unmountWindow(entry);
    mountWindow(entry);
    shouldPlace = true;
  }
  // A new window of a kind cascades from the kind's geometry by the kind's other open windows
  const cascadeIndex = isNew && config.kind ? getOpenWindowsOfKind(config.kind).length - 1 : 0;
  if (shouldPlace) placeWindow(entry, cascadeIndex);
  moveToTop(id);
  saveDraggableWindowStatesToLS();
  if (focusFirstElement) focusFirstFocusableElement(entry);
};

/**
 * Runs `listener` once when the mounted window's DOM goes (a close, a remove, a remount, a scene
 * load's teardown), before its elements are removed, so the focus is still in it. One per
 * window: a second call replaces the first. A no-op when the window isn't mounted.
 * @internal
 */
export const onDraggableWindowUnmount = (id: string, listener: () => void) => {
  const runtime = getWindows().get(id)?.runtime;
  if (runtime?.windowCMP) runtime.onUnmount = listener;
};

/**
 * Closes a window and runs its `onClose`: its state stays (a reopen restores its layout), unless
 * it's `removeOnClose` or of a kind, which are removed instead. A no-op for an unknown id.
 */
export const closeDraggableWindow = (id: string) => {
  const entry = getWindows().get(id);
  if (!entry) return;
  suspendedWindowIds.delete(id);

  // A kind window is removed (its geometry stays as the kind's), so closed ones don't pile up
  if (entry.config.removeOnClose || entry.config.kind) {
    removeDraggableWindow(id);
    return;
  }

  unmountWindow(entry);
  entry.config.isOpen = false;
  saveDraggableWindowStatesToLS();
  runOnClose(entry);
};

const toggleCollapse = (id: string) => {
  const entry = getWindows().get(id);
  if (!entry?.runtime.windowCMP) return;
  entry.config.isCollapsed = !entry.config.isCollapsed;
  writeCollapsedState(entry);
  saveDraggableWindowStatesToLS();
};

/**
 * Moves an open draggable window to the top center of the screen, and shrinks a resizable one
 * that still overflows (never below its min size). A collapsed window fits its expanded size.
 * Dialogs and other non-draggable windows are skipped. Header double-clicks call this.
 * @param cascadeIndex offsets the window by this many header heights (x and y), wrapping before
 * the offset passes a third of the viewport (default 0)
 * @returns whether the window was fitted (false when it is closed or not draggable)
 */
export const fitDraggableWindowToScreen = (id: string, cascadeIndex = 0) => {
  const entry = getWindows().get(id);
  if (!entry || !isFittable(entry)) return false;
  if (fitWindow(entry, cascadeIndex)) saveDraggableWindowStatesToLS();
  return true;
};

/**
 * Fits every open draggable window to the screen (see {@link fitDraggableWindowToScreen}),
 * cascaded bottom to top over the app windows and then the debug windows, so the top window
 * lands last and every header stays visible.
 * @returns the number of windows fitted
 */
export const fitAllDraggableWindowsToScreen = () => {
  const ids = [...stacks.APP, ...stacks.DEBUG];
  let count = 0;
  let isChanged = false;
  for (let i = 0; i < ids.length; i++) {
    const entry = getWindows().get(ids[i]);
    if (!entry || !isFittable(entry)) continue;
    if (fitWindow(entry, count)) isChanged = true;
    count++;
  }
  if (isChanged) saveDraggableWindowStatesToLS();
  return count;
};

/** Rebuilds an open window's content (its `onClose` doesn't run). */
export const updateDraggableWindow = (id: string) => {
  const entry = getWindows().get(id);
  // A suspended window has no DOM: it is rebuilt (or closed) at the scene change end
  if (!entry?.config.isOpen || !entry.runtime.windowCMP) return;
  rebuildContent(entry);
};

/**
 * Removes a window and its state (from LS too), and runs its `onClose`. A kind's window leaves its
 * geometry as the kind's, for the kind's next window. A no-op for an unknown id.
 * @param doNotSaveToLS leaves LS as it is (the engine's own removals that save later)
 */
export const removeDraggableWindow = (id: string, doNotSaveToLS?: boolean) => {
  const map = getWindows();
  const entry = map.get(id);
  if (!entry) return;
  suspendedWindowIds.delete(id);

  if (entry.config.isOpen) recordKindGeometry(entry);
  unmountWindow(entry);
  map.delete(id);
  modalIds.delete(id);
  if (!doNotSaveToLS) saveDraggableWindowStatesToLS();
  runOnClose(entry);
};

const resolveSceneTarget = ({ config }: WindowEntry) => {
  const resolver = sceneTargetResolvers[getWindowKind(config)];
  if (!resolver) return false;
  try {
    return resolver(config.data);
  } catch {
    return false;
  }
};

/** A scene load's start (the `loadStart` scene hook): removes the windows flagged
 * `removeOnSceneChange` and closes the ones flagged `closeOnSceneChange`, except the ones with a
 * scene target resolver: those are suspended until {@link handleWindowsOnSceneChangeEnd}. */
const handleWindowsOnSceneChangeStart = () => {
  const entries = [...getWindows().values()];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { config } = entry;
    // Never opened in this mode: kept as is, so it comes back in the mode that allows it
    if (!isDraggableWindowAllowed(config)) continue;
    // Open but neither mounted nor suspended: stored in LS and not restored yet (the boot's first
    // scene load runs before loadDraggableWindowStatesFromLS), so the restore handles it
    if (config.isOpen && !entry.runtime.windowCMP && !suspendedWindowIds.has(config.id)) continue;
    if (config.removeOnSceneChange) {
      removeDraggableWindow(config.id);
      continue;
    }
    if (!config.closeOnSceneChange || !config.isOpen) continue;
    if (sceneTargetResolvers[getWindowKind(config)]) {
      // Torn down rather than kept live, so no content refresh runs against the entities that
      // are being torn down. It keeps its place in the stack.
      unmountWindow(entry, true);
      suspendedWindowIds.add(config.id);
    } else {
      closeDraggableWindow(config.id);
    }
  }
};

/** A scene load's end (the `entered` scene hook, or `loadSettled` after a failed load): rebuilds
 * the suspended windows whose target exists in the next scene and closes the rest, or all of them
 * when the load failed. */
const handleWindowsOnSceneChangeEnd = (loadFailed: boolean) => {
  const ids = [...suspendedWindowIds];
  suspendedWindowIds.clear();
  for (let i = 0; i < ids.length; i++) {
    const entry = getWindows().get(ids[i]);
    if (!entry) continue;
    if (!loadFailed && resolveSceneTarget(entry)) {
      mountWindow(entry);
      placeWindow(entry);
    } else {
      closeDraggableWindow(entry.config.id);
    }
  }
  saveDraggableWindowStatesToLS();
};

/** Opens the windows that were open at the last save, in their saved stack order: the boot's
 * after-start step (`addBootAfterStartHook`), once the app's start has registered its windows. */
const loadDraggableWindowStatesFromLS = () => {
  const entries = [...getWindows().values()];
  for (let i = 0; i < entries.length; i++) {
    const { config, runtime } = entries[i];
    if (!config.isOpen || runtime.windowCMP) continue;
    // Not shown in this mode, but isOpen is kept, so it comes back in the mode that allows it
    // (eg. back in debug mode from prodTest mode)
    if (!isDraggableWindowAllowed(config)) continue;
    // Reloaded into a scene without the window's target: close it instead of showing "not found"
    // (a kind window is removed, like any closed kind window)
    if (sceneTargetResolvers[getWindowKind(config)] && !resolveSceneTarget(entries[i])) {
      if (config.kind) {
        removeDraggableWindow(config.id, true);
      } else {
        config.isOpen = false;
      }
      continue;
    }
    openDraggableWindow({ id: config.id, focusFirstElement: false });
  }
  saveDraggableWindowStatesToLS();
};

/**
 * The open windows' ids, each layer bottom to top: the app's windows, the app's dialogs, the debug
 * windows, the debug dialogs. The test bridge's (p806 D14).
 * @internal
 */
export const getOpenDraggableWindowIds = () => [
  ...stacks.APP,
  ...stacks.DIALOG,
  ...stacks.DEBUG,
  ...stacks.DEBUG_DIALOG,
];

/** A window: a copy of its config, with its live CMPs; undefined for an unknown id. */
export const getDraggableWindow = (id: string): DraggableWindow | undefined => {
  const entry = getWindows().get(id);
  return entry ? toPublicWindow(entry) : undefined;
};

/**
 * The id of a kind's window for one key (eg. an entity id): `${kind}_${key}`.
 * @param key what the window is for, unique in the kind
 */
export const getKindWindowId = (kind: string, key: string | number) => `${kind}_${key}`;

/**
 * Registers a window kind (see {@link OpenDraggableWindowProps.kind}) and what its windows share:
 * their content function, onClose and scene target resolver. Register it once, before the boot
 * restores the saved windows (its step after the app's `start`): in `start` or a feature's
 * install (a `_dbg__` module may at its load). Then every window of the kind, also one restored
 * after a reload, gets them without any per-window registration. Opening a window with a `kind`
 * also registers the kind (without options).
 *
 * The first registration brings the kind's stored windows in: the window whose id is the kind
 * (from before the kind existed) only seeds the kind's geometry and is dropped, and a window
 * without a kind whose id is `getKindWindowId(kind, key)` gets the kind. So a single window uses
 * {@link registerDraggableWindow} (keyed by its id), not this.
 * @param opts a later registration replaces the options it passes
 * @example
 * ```ts
 * registerDraggableWindowKind('enemyInfo', {
 *   content: (data) => createEnemyPanel(data?.entityId as number),
 *   sceneTargetResolver: (data) => isEntityAlive(data?.entityId as number),
 * });
 * // One window per enemy, reopened on top when it's open
 * toggleDraggableWindow({
 *   id: getKindWindowId('enemyInfo', entityId),
 *   kind: 'enemyInfo',
 *   data: { entityId },
 *   title: 'Enemy',
 *   closeOnSceneChange: true,
 * });
 * ```
 */
export const registerDraggableWindowKind = (kind: string, opts?: DraggableWindowKindOpts) => {
  if (opts) registerDraggableWindow(kind, opts);
  if (registeredKinds.has(kind)) return;
  registeredKinds.add(kind);
  adoptKind(kind);
};

/**
 * Registers what a single window (one without a kind) gets on every open, also one restored after
 * a reload: its content function, onClose and scene target resolver (the functions LS can't
 * hold). Register it once, before the boot restores the saved windows (as
 * {@link registerDraggableWindowKind}). The window's own `content` / `onClose` passed on an open
 * win. For several windows of a kind, see {@link registerDraggableWindowKind}.
 * @param opts a later registration replaces the options it passes
 */
export const registerDraggableWindow = (id: string, opts: DraggableWindowKindOpts) => {
  addWindowHooks();
  if (opts.content) contentFns[id] = opts.content;
  if (opts.sceneTargetResolver) sceneTargetResolvers[id] = opts.sceneTargetResolver;
  if (opts.onClose) kindOnCloses[id] = opts.onClose;
  if (opts.keepInViews !== undefined) {
    if (opts.keepInViews) {
      keepInViewsKinds.add(id);
    } else {
      keepInViewsKinds.delete(id);
    }
  }
};

/**
 * The windows of a kind (a window without a `kind` is the only one of the kind named by its id),
 * each as {@link getDraggableWindow} gives it.
 * @param onlyOpen only the open windows (default true)
 */
export const getDraggableWindowsOfKind = (kind: string, onlyOpen = true) => {
  const result: DraggableWindow[] = [];
  for (const entry of getWindows().values()) {
    if (getWindowKind(entry.config) !== kind || (onlyOpen && !entry.config.isOpen)) continue;
    result.push(toPublicWindow(entry));
  }
  return result;
};

/**
 * Rebuilds the content of every open window of a kind (see {@link updateDraggableWindow}).
 */
export const updateDraggableWindowsOfKind = (kind: string) => {
  const entries = getOpenWindowsOfKind(kind);
  for (let i = 0; i < entries.length; i++) updateDraggableWindow(entries[i].config.id);
};

/**
 * The list row click rule: opens the window when it isn't open, brings it to the front when it is
 * open under another window of its layer, and closes it when it is on top.
 * @param props the props it opens the window with
 */
export const toggleDraggableWindow = (props: OpenDraggableWindowProps) => {
  const entry = getWindows().get(props.id);
  if (!entry?.config.isOpen || !entry.runtime.windowCMP) {
    openDraggableWindow({ ...props, closeIfOpen: false });
    return;
  }
  if (!isDraggableWindowOnTop(props.id)) {
    bringDraggableWindowToFront(props.id);
    return;
  }
  closeDraggableWindow(props.id);
};
