import type { Object3D } from 'three/webgpu';
import type { ECSWorld } from '../kernel/ecs/ECS';
import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../kernel/config/Config';
import { DEBUG_HELPER_USER_DATA_KEY } from '../kernel/render/Object3DHelpers';
import { lsGetItem } from '../utils/LocalAndSessionStorage';
import { loadDebugModuleAsync, useDebug, type DebugModuleRef } from '../kernel/config/DebugModules';
import {
  hydrateDebuggerTabState,
  type AnyDebuggerTabDef,
  type DebuggerTabDef,
  type UpdateDebuggerTabOpts,
} from './DebuggerGUI';

/**
 * Draggable window id of the profiler. The profiler's.
 * @internal
 */
export const PROFILER_WINDOW_ID = 'aekProfiler';
/**
 * LocalStorage key of the profiler settings (the Settings tab). The profiler's.
 * @internal
 */
export const PROFILER_LS_KEY = 'AEK_debugProfiler';
/**
 * LocalStorage key of the profiler UI state: the open tab and the folder states. The profiler's.
 * @internal
 */
export const PROFILER_UI_LS_KEY = 'AEK_debugProfilerUI';

/**
 * The Overview and Objects refresh rates offered in the Settings tab. The profiler's.
 * @internal
 */
export const PROFILER_UPDATE_RATES_HZ = [1, 2, 4, 10] as const;

/**
 * One Overview row: its metric id (an app stats source's is `app:` and the source id) and whether
 * it is shown. The profiler's Overview and Settings tabs'.
 * @internal
 */
export type ProfilerOverviewMetricEntry = { id: string; visible: boolean };

/**
 * The profiler's settings, persisted by its Settings tab; the Statistics tab reads them too.
 * @internal
 */
export type ProfilerSettings = {
  /** Overview and Objects refresh rate, one of {@link PROFILER_UPDATE_RATES_HZ}. */
  updateRateHz: number;
  /** The Overview rows in order, the engine's first, then the app stats sources'. Unknown ids are
   * dropped and new metrics appended (with their default visibility) when the profiler loads, so
   * a saved list survives new metrics. An app source's row is kept while the source isn't
   * registered, and a newly registered source's row is appended, shown. Empty = the default
   * order. */
  overviewMetrics: ProfilerOverviewMetricEntry[];
  /** Clicking the on-screen stats panels toggles the profiler window. */
  openFromStatsPanels: boolean;
  /** The profiler loads in prodTest mode too: its window stays open over the play button, and
   * the on-screen tools get its button there. Read at boot. */
  enabledInProdTest: boolean;
  /** Time the GPU work of every frame while a profiler view needs it (WebGPU with timestamp
   * queries only). */
  measureGpu: boolean;
  /** The in-view census counts debug helpers ({@link markDebugHelper}, three's `*Helper`s) in a
   * row of their own instead of the scene figures. */
  excludeDebugHelpers: boolean;
  /** What the Objects tab's bars measure (their length is the share of the scene total). */
  objectsBarMeasure: ProfilerBarMeasure;
};

/**
 * The Objects tab's bar measures. The profiler's.
 * @internal
 */
export const PROFILER_BAR_MEASURES = ['TRIANGLES', 'VERTICES', 'OBJECTS'] as const;
/**
 * The Objects tab's bar measure (`PROFILER_BAR_MEASURES`).
 * @internal
 */
export type ProfilerBarMeasure = (typeof PROFILER_BAR_MEASURES)[number];

/**
 * The profiler settings' defaults: the profiler's and the Statistics tab's.
 * @internal
 */
export const DEFAULT_PROFILER_SETTINGS: Readonly<ProfilerSettings> = {
  updateRateHz: 4,
  overviewMetrics: [],
  openFromStatsPanels: true,
  enabledInProdTest: false,
  measureGpu: true,
  excludeDebugHelpers: true,
  objectsBarMeasure: 'TRIANGLES',
};

type ProfilerModule = typeof import('./profiler/_dbg__Profiler');
let profiler: DebugModuleRef<ProfilerModule> | null = null;

const useProfiler = () => useDebug(profiler, true);

/** Whether the profiler is enabled in prodTest mode (its stored setting). Read straight from LS,
 * because it decides whether the profiler module loads there at all. */
const isProfilerEnabledInProdTest = () => {
  const saved = lsGetItem(PROFILER_LS_KEY, {}) as Partial<ProfilerSettings> | null;
  return Boolean(saved?.enabledInProdTest);
};

let isProfilerMode: boolean | null = null;

/**
 * Whether this mode loads the profiler: the debug env, and prodTest mode when the profiler's
 * "Enabled in prodTest" setting is on. Read once, and known before the profiler module loads, so
 * code that registers profiler content gates on it (not on `IS_DEBUG_ENV`, which leaves out
 * prodTest mode).
 */
export const isProfilerLoadedInThisMode = () => {
  if (isProfilerMode === null) {
    isProfilerMode = IS_DEBUG_ENV || (IS_PROD_TEST_MODE && isProfilerEnabledInProdTest());
  }
  return isProfilerMode;
};

/**
 * Loads the profiler: in the debug environment, and in prodTest mode when it is enabled there
 * ({@link ProfilerSettings.enabledInProdTest}). Call before the draggable windows are restored
 * from LS, so an open profiler window gets its content. The boot's debug step calls it.
 * @internal
 */
export const registerProfiler = async () => {
  if (!isProfilerLoadedInThisMode()) return;
  profiler = await loadDebugModuleAsync(
    () => import('./profiler/_dbg__Profiler'),
    true,
    'Profiler'
  );
  const module = useProfiler();
  if (!module) return;
  // The tabs created before it loaded, in their creation order
  for (const def of pendingTabs.values()) module._createProfilerTab(def);
  pendingTabs.clear();
};

/**
 * Whether the profiler has loaded: false before the boot's debug step and where
 * {@link isProfilerLoadedInThisMode} is false.
 */
export const isProfilerAvailable = () => Boolean(useProfiler());

/** Opens the profiler window and brings it to the front, or closes it when it is on top. A no-op
 * while the profiler isn't loaded. */
export const toggleProfilerWindow = () => {
  useProfiler()?._toggleProfilerWindow();
};

/** Whether the profiler window is open (its content is mounted). */
export const isProfilerWindowOpen = () => useProfiler()?._isProfilerWindowOpen() ?? false;

// Tabs created before the profiler has loaded (eg. in a feature's `onDebug` hook, which runs
// before `registerProfiler`): it creates them when it loads
const pendingTabs = new Map<string, AnyDebuggerTabDef>();

/**
 * Creates (or replaces, by id) a profiler window tab. The same {@link DebuggerTabDef} contract as
 * `createDebuggerTab`, so a tab can move between the drawer and the profiler by changing this
 * call. Ordered by `orderNr` (the engine's: Overview 0, Objects 10, GPU memory 20, Settings 100),
 * then registration order. Profiler tabs have no `sceneId`: remove one with
 * {@link removeProfilerTab}. Works at any time: a tab created before the profiler has loaded is
 * added when it loads.
 * @remarks Where the profiler doesn't load (see {@link isProfilerLoadedInThisMode}) the tab is
 * never shown, but its `state` is still hydrated in the debug env and prodTest mode; gate the
 * call on `isProfilerLoadedInThisMode()` to skip that too.
 * @example
 * ```ts
 * import { createProfilerTab, isProfilerLoadedInThisMode } from 'aekasha/debug';
 *
 * const figures = { spawned: 0 };
 *
 * if (isProfilerLoadedInThisMode()) {
 *   createProfilerTab({
 *     id: 'spawner',
 *     title: 'Spawner',
 *     icon: 'geometry',
 *     orderNr: 30,
 *     refreshIntervalMs: 250,
 *     onRefresh: () => {
 *       figures.spawned = getSpawnedCount();
 *     },
 *     content: () => [
 *       {
 *         pane: true,
 *         content: [{ key: 'spawned', target: figures, label: 'Spawned', readonly: true }],
 *       },
 *     ],
 *   });
 * }
 * ```
 */
export const createProfilerTab = <S extends object>(def: DebuggerTabDef<S>) => {
  // Folds the pending tabs out of a production build
  if (!__AEK_DEBUG__) return;
  hydrateDebuggerTabState(def);
  // The builder only works with string keys, S only types the call site
  const anyDef = def as unknown as AnyDebuggerTabDef;
  const module = useProfiler();
  if (module) {
    module._createProfilerTab(anyDef);
    return;
  }
  // A replaced pending tab keeps its creation position, as a replaced tab does in the window
  pendingTabs.set(def.id, anyDef);
};

/** Removes a profiler window tab, also one waiting for the profiler to load (an open window shows
 * its first tab if it was the shown one). */
export const removeProfilerTab = (id: string) => {
  if (!__AEK_DEBUG__) return;
  if (pendingTabs.delete(id)) return;
  useProfiler()?._removeProfilerTab(id);
};

/** Opens the profiler window on a tab (switching to it if another one is showing), eg.
 * `GPU_MEMORY_TAB_ID`. A no-op while the profiler isn't loaded. */
export const openProfilerTab = (id: string) => {
  useProfiler()?._openProfilerTab(id);
};

/**
 * Refreshes a profiler tab if it is the visible one (see {@link isProfilerTabOpen}), as
 * `updateDebuggerTab` does a drawer tab; otherwise a no-op.
 * @param opts `rebuild` re-runs the tab's `content` instead
 */
export const updateProfilerTab = (id: string, opts?: UpdateDebuggerTabOpts) => {
  useProfiler()?._updateProfilerTab(id, opts);
};

/** Whether a profiler tab is visible: the window is open and the tab is the mounted one. */
export const isProfilerTabOpen = (id: string) => useProfiler()?._isProfilerTabOpen(id) ?? false;

/**
 * The profiler settings (the live object the Settings tab binds to). Undefined while the profiler
 * isn't loaded. The Statistics tab's.
 * @internal
 */
export const getProfilerSettings = (): Readonly<ProfilerSettings> | undefined =>
  useProfiler()?._getProfilerSettings();

/**
 * Changes profiler settings: persists them and applies them right away (the stats panels'
 * pointer, the on-screen button, an open Settings tab). The Statistics tab's and the profiler's.
 * @internal
 * @param partial the settings to change; the others keep their values
 */
export const setProfilerSettings = (partial: Partial<ProfilerSettings>) => {
  useProfiler()?._setProfilerSettings(partial);
};

// DEBUG HELPERS (§2.7)

/**
 * Marks an object (and its subtree) as a debug helper: the profiler's in-view census counts it in
 * its own row, not in the scene figures (its "Exclude debug helpers" setting), and
 * `takeSnapshotAsync` hides it (`hideDebugHelpers`). Debug code that adds gizmos, wireframes or
 * lines to the root scene should mark them. three's `*Helper` types are recognised without it.
 * @param obj the helper's root
 * @returns `obj`
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getRootScene } from 'aekasha';
 * import { markDebugHelper } from 'aekasha/debug';
 *
 * const marker = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicNodeMaterial());
 * getRootScene()?.add(markDebugHelper(marker));
 * ```
 */
export const markDebugHelper = <T extends Object3D>(obj: T) => {
  obj.userData[DEBUG_HELPER_USER_DATA_KEY] = true;
  return obj;
};

// STATS SOURCES (§2.5)

/**
 * A measurement the profiler views read; one that isn't the engine's gets a row of its own in the
 * Overview, under "App". It is refcounted: `acquire` runs when the first view needs it (and it is
 * available), `release` when the last one is done, so a closed profiler measures nothing.
 * @template T the value `read` returns
 */
export type StatsSource<T = unknown> = {
  /** Unique; registering the same id again replaces the source. */
  id: string;
  /** The row's name in the Overview and the Settings tab */
  label: string;
  /** Turns the measurement on. Only switch on what is off, and remember it for `release`. */
  acquire?: () => void;
  /** Turns off what `acquire` switched on (leave alone what was already on). */
  release?: () => void;
  /** The current value, called only at the profiler's update rate. Null = no value yet. */
  read: () => T | null;
  /** True, or why the source is n/a right now ("WebGPU only", "Chromium only"). While it is n/a
   * the source is not acquired (an acquired one is released), and it is acquired as soon as it
   * becomes available. */
  availability?: () => true | string;
  /** The value as the Overview shows it (a source that isn't the engine's gets a row there, under
   * "App"). Without it a number shows with two decimals, a string as is, anything else as JSON. */
  format?: (value: T) => string;
};

/**
 * A stats source with its value type erased: the profiler's view of any source.
 * @internal
 */
export type AnyStatsSource = StatsSource<unknown>;

const statsSources = new Map<string, AnyStatsSource>();

/**
 * Registers a stats source the profiler views read (eg. a streaming system's figures): the
 * Overview shows it in its "App" rows, which the Settings tab hides and orders like the engine's.
 * Works at any time, also before the profiler has loaded.
 * @returns a function that removes the source (a no-op once another source took its id)
 * @remarks A no-op returning a no-op where the profiler doesn't load (see
 * {@link isProfilerLoadedInThisMode}), so `read` is never called in a production build or plain
 * prodTest mode.
 * @example
 * ```ts
 * import { registerStatsSource } from 'aekasha/debug';
 *
 * let enemyCount = 0;
 *
 * const removeEnemiesSource = registerStatsSource({
 *   id: 'game.enemies',
 *   label: 'Enemies',
 *   read: () => enemyCount,
 *   format: (count) => `${count} alive`,
 * });
 * ```
 */
export const registerStatsSource = <T>(source: StatsSource<T>) => {
  if (!isProfilerLoadedInThisMode()) return () => {};
  const anySource = source as AnyStatsSource;
  const prev = statsSources.get(source.id);
  statsSources.set(source.id, anySource);
  if (prev) useProfiler()?._onStatsSourceReplaced(prev);
  return () => {
    if (statsSources.get(source.id) !== anySource) return;
    statsSources.delete(source.id);
    useProfiler()?._onStatsSourceReplaced(anySource);
  };
};

/**
 * The registered stats sources (the profiler).
 * @internal
 */
export const _getStatsSources = (): ReadonlyMap<string, AnyStatsSource> => statsSources;

// ENTITY WINDOWS (the Objects tab's heaviest objects)

/** Opens an entity's debug edit window from a profiler view (the Objects tab's heaviest objects'
 * links), eg. a physics entity's. */
export type EntityWindowOpener = {
  /** Unique; registering the same id again replaces the opener. */
  id: string;
  /** What the window is, eg. 'Edit physics entity' (the link's tooltip). */
  label: string;
  /** Openers are tried in descending priority (default 0), the first that can open the entity
   * does: eg. a character (also a physics entity) opens the character window. */
  priority?: number;
  /** Whether this window can show the entity (eg. it has a physics body) */
  canOpen: (world: ECSWorld, entityId: number) => boolean;
  /** Opens the window and brings it to the front, or closes it when it is on top. */
  toggle: (world: ECSWorld, entityId: number) => void;
};

const entityWindowOpeners: EntityWindowOpener[] = [];

/**
 * Registers an entity edit window the profiler can open (the Objects tab's heaviest objects), or
 * replaces the opener with its id. A no-op where the profiler doesn't load (see
 * {@link isProfilerLoadedInThisMode}).
 */
export const registerEntityWindowOpener = (opener: EntityWindowOpener) => {
  if (!isProfilerLoadedInThisMode()) return;
  const index = entityWindowOpeners.findIndex((o) => o.id === opener.id);
  if (index !== -1) entityWindowOpeners.splice(index, 1);
  entityWindowOpeners.push(opener);
  // Stable: equal priorities keep their registration order
  entityWindowOpeners.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
};

/**
 * The opener of an entity's edit window, or null (the profiler).
 * @internal
 */
export const _getEntityWindowOpener = (world: ECSWorld, entityId: number) => {
  if (!world.isAlive(entityId)) return null;
  for (let i = 0; i < entityWindowOpeners.length; i++) {
    if (entityWindowOpeners[i].canOpen(world, entityId)) return entityWindowOpeners[i];
  }
  return null;
};
