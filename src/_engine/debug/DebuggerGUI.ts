import type { CMPHandle } from '../ui/core/CMPTypes';
import type { BindingScheduler } from '../ui/forms/binding/BindingScheduler';
import type { BindingSource, ReadonlyBindingSource } from '../ui/forms/binding/Binding';
import type { FieldChange } from '../ui/forms/Field';
import type {
  PropertyGridButtonItem,
  PropertyGridCustomItem,
  PropertyGridFieldItem,
  PropertyGridSeparatorItem,
} from '../ui/forms/PropertyGridItems';
import type { SvgIconKey } from '../ui/core/icons/SvgIcon';
import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../kernel/config/Config';
import { lsGetItem } from '../utils/LocalAndSessionStorage';
import { loadDebugModuleAsync, useDebug, type DebugModuleRef } from '../kernel/config/DebugModules';
import { lerror } from '../utils/Logger';
import { addToast, hasToaster, type ToastProps } from '../ui/overlays/Toaster';

/**
 * The debugger scene loader's id: `loadScene`, the Debug tools tab and the on-screen tools use it.
 * @internal
 */
export const DEBUGGER_SCENE_LOADER_ID = '__debugger-scene-loader';
/**
 * The debug toaster's id: the boot creates it, the engine's debug modules add to it.
 * @internal
 */
export const DEBUG_TOASTER_ID = 'debugToaster';

/**
 * Adds a toast to the debug toaster (bottom left, above the stats). A no-op returning null while
 * there is no debug toaster: before it is created at the end of InitEngine, and outside the
 * debug environment.
 * @param props the toast, without `toasterId`
 * @returns the toast's handle ({@link addToast}'s), or null
 * @example
 * ```ts
 * import { addDebugToast } from 'aekasha/debug';
 *
 * addDebugToast({ title: 'Level saved' });
 * ```
 */
export const addDebugToast = (props: Omit<ToastProps, 'toasterId'>) =>
  hasToaster(DEBUG_TOASTER_ID) ? addToast({ ...props, toasterId: DEBUG_TOASTER_ID }) : null;

const queuedDebugToasts: Omit<ToastProps, 'toasterId'>[] = [];

/**
 * Like {@link addDebugToast}, but a toast added before the debug toaster exists waits for it:
 * for messages from the boot itself (the app start function and the first scene load run before
 * InitEngine creates the toaster). A no-op outside the debug environment. Used by `loadScene` and
 * the sky box layers.
 * @internal
 * @param props the toast, without `toasterId`
 */
export const addDebugToastWhenReady = (props: Omit<ToastProps, 'toasterId'>) => {
  if (!IS_DEBUG_ENV) return;
  if (hasToaster(DEBUG_TOASTER_ID)) {
    addDebugToast(props);
    return;
  }
  queuedDebugToasts.push(props);
};

/**
 * Shows the toasts {@link addDebugToastWhenReady} queued. InitEngine calls it right after it
 * creates the debug toaster.
 * @internal
 */
export const flushQueuedDebugToasts = () => {
  for (const props of queuedDebugToasts.splice(0)) addDebugToast(props);
};

type DebuggerGUIModule = typeof import('./_dbg__DebuggerGUI');
let debugGUI: DebugModuleRef<DebuggerGUIModule> | null = null;

/**
 * Where the drawer's open button sits on its edge. It applies to the whole drawer, whichever tab
 * passes it.
 * @deprecated Removed with {@link createDebuggerTab}'s second parameter in engine 6.0.0: the
 * button stays in the middle (move it with CSS).
 */
export type DebugGUIOpts = { drawerBtnPlace?: 'TOP' | 'MIDDLE' | 'BOTTOM' };

/**
 * A key of a tab's state, or a one level deep path into a nested object of it
 * (eg. `'helpers.showGrid'`): what a binding's `key` takes.
 * @template S the tab's state
 */
export type DebuggerStateKey<S> = {
  [K in keyof S & string]: S[K] extends readonly unknown[]
    ? K
    : S[K] extends object
      ? K | `${K}.${keyof S[K] & string}`
      : K;
}[keyof S & string];

/**
 * A static value, or a function re-read on every tab refresh (eg. a binding's `hidden`).
 * @template T the value
 */
export type DebuggerDyn<T> = T | (() => T);

/**
 * The kit field item's props a {@link DebuggerPaneBinding} takes, besides its binding, `label` and
 * `onChange`: `kind`, `min`, `max`, `step`, `options`, `readonly`, `interval`, `format`, … (the
 * kit's names, which are Tweakpane's where it had them).
 */
export type DebuggerPaneBindingProps = Omit<
  PropertyGridFieldItem,
  'type' | 'target' | 'key' | 'get' | 'set' | 'value' | 'label' | 'onChange'
>;

/**
 * A pane item that binds a field (or a read-only monitor, `readonly: true`) to a property of the
 * tab's `state` by default, or to any of the kit's bindings: `{ target, key }`, `{ get, set }`,
 * `{ get }` or `{ value }`. Its other fields are the kit's field item's
 * ({@link DebuggerPaneBindingProps}): a field the kit doesn't take is a type error, and the tab's
 * error line at run time. Without `kind` the field is inferred from the value (a colour number
 * says `kind: 'color'`); `interval: 0` reads a monitor only when the tab refreshes.
 * @template S the tab's state
 */
export type DebuggerPaneBinding<S extends object = object> = DebuggerPaneBindingProps & {
  /** The item's kind; a binding may leave it out */
  type?: 'binding' | 'field';
  /** The field's name (default: its `key`) */
  label?: string;
  /** Called on every write of the value, never on a refresh or rebuild (the kit's order: each
   * step of a drag with `last: false`, then `last: true` with `prev` the value before the
   * gesture). A state key in `persistKeys` is persisted on `last` before this is called. */
  onChange?(value: unknown, change: FieldChange<unknown>): void;
} & (
    | {
        /** Property of the tab's `state`, or a path one level into it (eg. 'helpers.showGrid').
         * It is persisted when its top-level key is one of the tab's persistKeys. */
        key: DebuggerStateKey<S>;
        /** None: the binding binds to the tab's `state` */
        target?: undefined;
        get?: never;
        set?: never;
        value?: never;
      }
    | BindingSource<unknown>
    | ReadonlyBindingSource<unknown>
  );

/**
 * A foldable group of pane items. Its open / closed state is persisted to the tab's UI key (see
 * `DebuggerTabDef.uiLsKey`) when it has one.
 * @template S the tab's state
 */
export type DebuggerPaneFolder<S extends object = object> = {
  /** The item's kind */
  type: 'folder';
  /** Folder state id. Default: the title path (eg. 'Parent/Child'). */
  id?: string;
  /** The folder's heading */
  title: string;
  /** Initial open state (before any persisted state). Default true. */
  expanded?: boolean;
  /** Whether the open/closed state is persisted. Default true when the tab has a UI key. */
  persistExpanded?: boolean;
  /** Hides the folder, re-read on every refresh */
  hidden?: DebuggerDyn<boolean>;
  /** The folder's items, in order */
  content: DebuggerPaneItem<S>[];
};

/** A pane item that runs a function when clicked: the kit's button item. */
export type DebuggerPaneButton = PropertyGridButtonItem;

/** A pane item that draws a line between the items around it: the kit's separator item. */
export type DebuggerPaneSeparator = PropertyGridSeparatorItem;

/**
 * Escape hatch for anything the items don't cover: `build` adds it to its container, a CMP across
 * the grid's two columns. The function `build` returns (if any) is called on every tab refresh.
 * The kit's custom item.
 */
export type DebuggerPaneCustom = PropertyGridCustomItem;

/**
 * One item of a declarative pane: a binding, a folder, a button, a separator or a custom item.
 * @template S the tab's state
 */
export type DebuggerPaneItem<S extends object = object> =
  | DebuggerPaneBinding<S>
  | DebuggerPaneFolder<S>
  | DebuggerPaneButton
  | DebuggerPaneSeparator
  | DebuggerPaneCustom;

/**
 * A tab section built from a declarative item list: a property grid of the UI kit's fields.
 * Disposed when the tab unmounts.
 * @template S the tab's state
 */
export type DebuggerPaneSection<S extends object = object> = {
  /** Marks the section as a pane (any other section is a CMP) */
  pane: true;
  /** Folder state id of a titled pane. Default: the title. */
  id?: string;
  /** Makes the whole pane a foldable root with this title. */
  title?: string;
  /** Initial open state of a titled pane. Default true. */
  expanded?: boolean;
  /** The pane's items, in order */
  content: DebuggerPaneItem<S>[];
};

/**
 * One section of a debugger tab's content, mounted in array order: a CMP (mounted as is; one
 * with an `html` function is re-rendered on a refresh when its html changed) or a declarative
 * pane.
 * @template S the tab's state
 */
export type DebuggerTabSection<S extends object = object> = CMPHandle | DebuggerPaneSection<S>;

/**
 * What a tab's `content` gets (p806 D3): its host's refresh scheduler, shared by its declarative
 * sections, which a CMP section's own UI kit fields join too, so they refresh with the tab
 * (`refreshIntervalMs`, {@link updateDebuggerTab}) and their monitors pause with it.
 */
export type DebuggerTabContext = {
  /** The tab host's scheduler: give it to a kit field (`scheduler`) or a property grid */
  scheduler: BindingScheduler;
};

/**
 * A debugger tab, for {@link createDebuggerTab} (and `createProfilerTab`, without `sceneId`). The
 * call builds the menu button, the heading row (icon, title, clear-LS button, header buttons) and
 * the content.
 * @template S the tab's state
 */
export type DebuggerTabDef<S extends object = object> = {
  /** Unique tab id. Registering the same id again replaces the tab. */
  id: string;
  /** Heading text and menu button tooltip. */
  title: string;
  /** Menu button and heading icon. */
  icon: SvgIconKey;
  /** Explicit place in the menu, overriding `AppConfig.debugDrawer.tabOrder`. It is on the same
   * 0-based scale as the tabOrder indexes (eg. 1.5 = between the 2nd and the 3rd tab). */
  orderNr?: number;
  /** Makes this a scene tab: it is removed when this scene exits, so the scene creates it in its
   * scene code (it comes back on every visit). Unless `orderNr` or the tabOrder place it, it
   * goes after all the other tabs. When the saved open tab is a scene tab that doesn't exist yet
   * (eg. after a reload), the drawer shows the first tab until it is created. */
  sceneId?: string;
  /** LocalStorage key of this tab's own data. When set, the heading gets a clear-LS button for
   * it (see `clearLSButton`). */
  lsKey?: string;
  /** Module-owned object the pane bindings bind to by default (bindings without a `target`). */
  state?: S;
  /** The `state` keys that are persisted under `lsKey` (as a flat object). They are hydrated
   * into `state` synchronously at registration (also in prod test mode), and written on each
   * finished user change. No other key is ever read from or written to `lsKey`. A nested
   * object is persisted (and hydrated) whole. */
  persistKeys?: readonly (keyof S & string)[];
  /** LocalStorage key of the tab's UI state (folder open/closed states). Default:
   * `${lsKey}UI` when `lsKey` is set, otherwise none (nothing is persisted). */
  uiLsKey?: string;
  /** Extra heading row buttons, after the clear-LS button (eg. a clear list LS button). */
  headerButtons?: () => CMPHandle[];
  /** Whether the heading has the clear tab LS button. Default: true when `lsKey` is set. Set to
   * true without `lsKey` for a permanently disabled button (consistency with other tabs). */
  clearLSButton?: boolean;
  /** Called after the clear-LS button has removed `lsKey`, eg. to reset the live state. */
  onClearLS?: () => void;
  /** When set, the tab is refreshed ({@link updateDebuggerTab}) at this interval, but only
   * while it is visible (drawer open and this tab selected). */
  refreshIntervalMs?: number;
  /** Runs before the content is built and before every refresh, eg. to sync live values into
   * the objects the panes bind to. A throw is logged and shows an error line in the tab. */
  onRefresh?: () => void;
  /** Runs every time the tab content is mounted. The returned function runs on unmount (tab
   * switch, rebuild or drawer rebuild). */
  onOpen?: () => void | (() => void);
  /** Keeps the open tab on a scene change (default false: it's rebuilt from `content`): its DOM,
   * scroll position, open folders and focus stay, and `onSceneChange`, `onRefresh` and a refresh
   * of its fields run instead. For a tab whose content reads the scene through getters a refresh
   * re-reads, not one that captures the scene's data when `content` runs. */
  keepOnSceneChange?: boolean;
  /** Runs on a scene change while the tab is kept open (`keepOnSceneChange`), before `onRefresh`:
   * eg. to point the objects its fields bind to at the new scene's. A throw is logged. */
  onSceneChange?: () => void;
  /** Content factory. Runs on every mount and rebuild, because a removed CMP can't be mounted
   * again: the open tab is rebuilt on every scene change (unless `keepOnSceneChange`), and a
   * closed tab is built fresh on its next mount. `ctx.scheduler` is the tab's refresh scheduler
   * ({@link DebuggerTabContext}). A throw is logged and shows an error line in the tab's place. */
  content: (ctx: DebuggerTabContext) => DebuggerTabSection<S>[];
};

/** A small icon toggle on the right side of each list row. */
export type DebuggerListToggle = {
  /** The toggle's icon (when on) */
  icon: SvgIconKey;
  /** Icon when off. Default: `icon` (dimmed). */
  iconOff?: SvgIconKey;
  /** The toggle's tooltip */
  title: string;
  /** Called with the new value. Use the same setter the item's edit window uses, so undo,
   * LS and an open edit window stay consistent. */
  fn: (itemId: string, nextValue: boolean) => void;
};

/** One row of a {@link debuggerListCMP} list. */
export type DebuggerListItem = {
  /** The row's id, as `onClick`, the toggles and `selectedItemId` name it */
  itemId: string;
  /** The row's text */
  title: string;
  /** Small line at the top of the row (eg. '[appId] [entityId]'). */
  subTitle?: string;
  /** An icon before the title */
  icon?: SvgIconKey;
  /** Short text before the title (eg. a type shorthand). */
  badge?: string;
  /** Short text after the title (eg. a count). */
  suffix?: string;
  /** A dimmed line under the title. */
  description?: string;
  /** Index-aligned with `perItemConfig.toggles`; null (or missing) = no toggle on this row. */
  toggleValues?: (boolean | null)[];
  /** Dimmed row. */
  disabled?: boolean;
  /** The row's tooltip */
  tooltip?: string;
  /** Italic title (eg. a fallback name). */
  titlePlaceholder?: boolean;
};

/** Definition for {@link debuggerListCMP}. */
export type DebuggerListDef = {
  /** CMP id `debuggerList-${id}`, automatic if omitted. */
  id?: string;
  /** Rendered above the list, with the item count. */
  heading?: string;
  /** Shown instead of the rows when there are none */
  emptyText?: string;
  /** What every row has */
  perItemConfig?: {
    /** The rows' icon toggles, right to left; a row's `toggleValues` sets each */
    toggles?: DebuggerListToggle[];
    /** Row click, usually opens the edit window. */
    onClick?: (itemId: string) => void;
  };
  /** The selected row(s), re-read on every render and refresh. */
  selectedItemId?: () => string | string[] | null | undefined;
  /** The rows. A function is re-read on every refresh (the list re-renders only when the rows
   * or the selection changed). */
  data: DebuggerListItem[] | (() => DebuggerListItem[]);
};

/**
 * A tab definition with its state type erased (the builder's view of any tab). The tab host's, the
 * drawer's and the profiler's.
 * @internal
 */
export type AnyDebuggerTabDef = DebuggerTabDef<Record<string, unknown>>;

/** Options for {@link updateDebuggerTab}. */
export type UpdateDebuggerTabOpts = {
  /** Re-run the tab's content factory instead of refreshing the mounted content (for
   * structural changes). The scroll position is kept. */
  rebuild?: boolean;
};

/**
 * Loads the debugger (the drawer and its tabs) and its scene loader: the boot's debug step.
 * @internal
 */
export const registerDebuggerGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./_dbg__DebuggerGUI'), true);
  const module = useDebug(debugGUI);
  // Debug env only: the first loadScene may target this loader ("Use debugger scene loader for start scene")
  module?._ensureDebuggerSceneLoader();
  if (!module) return;
  // The tabs created before it loaded, in their creation order
  for (const [def, opts] of pendingTabs.values()) module._createDebuggerTab(def, opts);
  pendingTabs.clear();
};

// Tabs created before the drawer has loaded (eg. in a feature's `install`, which runs before the
// boot's debug step): it creates them when it loads
const pendingTabs = new Map<string, [AnyDebuggerTabDef, DebugGUIOpts | undefined]>();

/**
 * Toggles the drawer open or closed. The views' (`toggleActiveViewDrawer`) and the material
 * editor's.
 * @internal
 * @param openOrClose the drawer's next state; the other one by default
 */
export const toggleDrawer = (openOrClose?: 'OPEN' | 'CLOSE') => {
  useDebug(debugGUI)?._toggleDrawer(openOrClose);
};

/**
 * Hides the drawer while an editor view is active (Views.ts), or shows it again. Its open
 * state is kept; while hidden, its tab isn't refreshed and the `debugDrawerOpen` body class is
 * the editor view's. Debug environment only.
 * @internal
 * @param suspended whether an editor view is active
 */
export const setDrawerSuspendedByView = (suspended: boolean) => {
  useDebug(debugGUI)?._setDrawerSuspendedByView(suspended);
};

/**
 * Creates (or replaces, by id) a debugger tab: the menu button, the heading row and the content
 * (CMP sections, declarative panes and lists). Persisted `state` values are hydrated right away
 * (also in prod test mode, where the drawer itself doesn't exist). Works at any time: a tab
 * created before the drawer has loaded (eg. in a feature's `install`) is added when it loads. Only
 * the debug env shows the drawer.
 * @param opts deprecated, removed in engine 6.0.0 ({@link DebugGUIOpts}): moves the drawer button
 * for the whole drawer
 * @remarks A scene tab (`sceneId`) belongs in its scene's code, behind `IS_DEBUG_ENV` and an
 * `import()` of a `_dbg__` module, so it never ships.
 * @example
 * ```ts
 * import { createDebuggerTab } from 'aekasha/debug';
 *
 * const settings = { speed: 1, showPath: false };
 *
 * createDebuggerTab({
 *   id: 'myGame',
 *   title: 'My game',
 *   icon: 'geometry',
 *   state: settings,
 *   lsKey: 'myGameDebug',
 *   persistKeys: ['speed', 'showPath'],
 *   content: () => [
 *     {
 *       pane: true,
 *       content: [
 *         { key: 'speed', label: 'Speed', min: 0, max: 5, step: 0.1 },
 *         { key: 'showPath', label: 'Show path' },
 *       ],
 *     },
 *   ],
 * });
 * ```
 */
export const createDebuggerTab = <S extends object>(
  def: DebuggerTabDef<S>,
  opts?: DebugGUIOpts
) => {
  // Folds the pending tabs out of a production build
  if (!__AEK_DEBUG__) return;
  hydrateDebuggerTabState(def);
  // The builder only works with string keys, S only types the call site
  const anyDef = def as unknown as AnyDebuggerTabDef;
  const module = useDebug(debugGUI);
  if (module) {
    module._createDebuggerTab(anyDef, opts);
    return;
  }
  // A replaced pending tab keeps its creation position, as a replaced tab does in the drawer
  pendingTabs.set(def.id, [anyDef, opts]);
};

/**
 * Restores a tab's persisted values into its state. Runs at registration (not on the first tab
 * open, and also in prod test mode), so the module can use the values at boot. A module can also
 * call it earlier than its tab's registration, for values something reads before that (the tab
 * then hydrates the same values again). Used by `createDebuggerTab`, `createProfilerTab` and the
 * Physics API tab.
 * @internal
 * @param def the tab's `lsKey`, `state` and `persistKeys` (see {@link DebuggerTabDef})
 */
export const hydrateDebuggerTabState = <S extends object>(
  def: Pick<DebuggerTabDef<S>, 'lsKey' | 'state' | 'persistKeys'>
) => {
  if (!IS_DEBUG_ENV && !IS_PROD_TEST_MODE) return;
  const { lsKey, state, persistKeys } = def;
  if (!lsKey || !state || !persistKeys?.length) return;
  let saved: unknown;
  try {
    saved = lsGetItem(lsKey, {});
  } catch {
    // Not JSON (a hand edit, another version's value): the state keeps its values
    return;
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
  for (let i = 0; i < persistKeys.length; i++) {
    const key = persistKeys[i];
    if (key in saved)
      (state as Record<string, unknown>)[key] = (saved as Record<string, unknown>)[key];
  }
};

/**
 * Persists one `persistKeys` value of a tab's state, for changes made outside the tab's own
 * inputs (eg. undo/redo handlers). Input changes are persisted automatically.
 * @param key one of the tab's `persistKeys` (another key isn't written)
 */
export const persistDebuggerTabValue = (id: string, key: string) => {
  useDebug(debugGUI)?._persistDebuggerTabValue(id, key);
};

/**
 * Refreshes a debugger tab if it is the visible one (see {@link isDebuggerTabOpen}). A refresh
 * runs the tab's `onRefresh`, then updates its panes (hidden / disabled and the bound values,
 * without firing `onChange`), its lists and its CMP sections with an `html` function.
 * @param opts `rebuild` re-runs the tab's `content` instead
 * @remarks A no-op unless the tab is visible: a closed tab, or the drawer hidden by an editor view.
 * A closed tab is built fresh on its next mount, so nothing is lost; for a figure that changes on
 * its own, use the tab's `refreshIntervalMs`.
 */
export const updateDebuggerTab = (id: string, opts?: UpdateDebuggerTabOpts) => {
  useDebug(debugGUI)?._updateDebuggerTab(id, opts);
};

/**
 * Whether a debugger tab is visible: the drawer is built, open and not hidden by an editor view,
 * and the tab is the mounted one. False outside the debug env.
 */
export const isDebuggerTabOpen = (id: string) =>
  useDebug(debugGUI)?._isDebuggerTabOpen(id) ?? false;

/**
 * Opens the drawer on a debugger tab (switching to it if another one is showing). A no-op for an
 * unknown id and outside the debug env.
 */
export const openDebuggerTab = (id: string) => {
  useDebug(debugGUI)?._openDebuggerTab(id);
};

/**
 * Removes a debugger tab, also one waiting for the drawer to load. A scene tab
 * (`DebuggerTabDef.sceneId`) is removed on its scene's exit without it.
 */
export const removeDebuggerTab = (id: string) => {
  if (!__AEK_DEBUG__) return;
  if (pendingTabs.delete(id)) return;
  useDebug(debugGUI)?._removeDebuggerTab(id);
};

/**
 * Creates a debugger list (the list component of the engine's tabs: rows with an icon, a badge,
 * a description and icon toggles) as a tab section. A list in the open tab is refreshed by
 * {@link updateDebuggerTab}: its `data` and `selectedItemId` are re-read, and it re-renders only
 * when they changed.
 * @throws outside the debug env (call it from a tab's `content`, which runs only there)
 * @example
 * ```ts
 * import { createDebuggerTab, debuggerListCMP } from 'aekasha/debug';
 *
 * const enemies = [{ id: 'e1', name: 'Grunt', hp: 30 }];
 *
 * createDebuggerTab({
 *   id: 'enemies',
 *   title: 'Enemies',
 *   icon: 'geometry',
 *   refreshIntervalMs: 500,
 *   content: () => [
 *     debuggerListCMP({
 *       heading: 'Enemies',
 *       emptyText: 'No enemies',
 *       data: () => enemies.map((e) => ({ itemId: e.id, title: e.name, suffix: `${e.hp} hp` })),
 *       perItemConfig: { onClick: (itemId) => openEnemyWindow(itemId) },
 *     }),
 *   ],
 * });
 * ```
 */
export const debuggerListCMP = (def: DebuggerListDef) => {
  const list = useDebug(debugGUI)?._debuggerListCMP(def);
  if (!list) {
    const msg =
      'Failed to create a debugger list (in debuggerListCMP). It could be that it is being created in production mode.';
    lerror(msg);
    throw new Error(msg);
  }
  return list;
};

/**
 * Sets the drawer's scene title: `setCurrentScene`'s.
 * @internal
 */
export const updateDebuggerSceneTitle = (title: string) => {
  useDebug(debugGUI)?._updateDebuggerSceneTitle(title);
};

/**
 * Disables the drawer during a scene load, or enables it again: `loadScene`'s.
 * @internal
 */
export const disableDebugger = (disable: boolean) => {
  useDebug(debugGUI)?._disableDebugger(disable);
};
