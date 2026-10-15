import type * as THREE from 'three/webgpu';
import { lerror, lwarn } from '../../utils/Logger';
import type { SceneData } from './Scene';
import {
  deleteAllSceneLoopers,
  getCurrentScene,
  getCurrentSceneId,
  getGeneratedSceneData,
  getRootScene,
  getScene,
  getSceneOpts,
  runOnAllSceneEnters,
  runOnAllSceneExits,
  runOnSceneEnter,
  runOnSceneExit,
  setCurrentScene,
  setLoadingSceneId,
} from './Scene';
import type { TCMP } from '../../ui/CMP';
import { getHUDRootCMP } from '../../ui/HUD';
import {
  addDebugToastWhenReady,
  DEBUGGER_SCENE_LOADER_ID,
  disableDebugger,
} from '../../debug/DebuggerGUI';
import { setAllInputsEnabled } from '../input/InputState';
import { getCanvasParentElem } from '../render/Renderer';
import { getDebugToolsState } from '../../debug/DebugTools';
import { getStartSceneQueryParam, IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../config/Config';
import { updateOnScreenTools } from '../../debug/OnScreenTools';
import { existsOrThrow } from '../../utils/Assert';
import { resetRandomStreams } from '../../utils/RandomStreams';
import { deleteAllRayHelpers, resetRayCastStats } from '../render/Raycast';
import { deleteAllGroupEntities } from './Group';
import { setIsLoadingScene } from '../loop/MainLoop';
import { DEFAULT_ECS_WORLD_ID, deleteECSWorld, getAllECSWorlds, getECSWorld } from '../ecs/ECS';
import { getAppData } from './AppData';
import type { ImportedAssetManifest } from '../assets/import/ImportTypes';
import { setAssetOwnerScene } from '../assets/AssetOwners';
import { createCameras, createNextSceneObject3Ds, loadNextSceneAssets } from './SceneDataLoader';
import { releaseSceneOwnedAssets } from '../assets/SceneAssetRelease';
import {
  runSceneBeforeAssetsHooksAsync,
  runSceneCreatedHooksAsync,
  runSceneEnteredHooksAsync,
  runSceneExitHooks,
  runSceneLoadSettledHooks,
  runSceneLoadStartHooks,
  runSceneWorldClearedHooks,
} from './SceneHooks';

/**
 * A loader's progress callback ({@link SceneLoader.updateLoaderStatusFn}): scene code calls it
 * through {@link getLoaderStatusUpdater} with whatever the loader's screen shows (eg.
 * `{ loadedCount, totalCount }`).
 */
export type UpdateLoaderStatusFn = (
  loader: SceneLoader,
  params?: { [key: string]: unknown }
) => void;

/**
 * A scene loader: what a scene load shows while it runs (its screen) and the functions it awaits
 * at its start and end. {@link createSceneLoader} registers one, {@link loadScene} uses the current
 * one or the one its `loaderId` names.
 */
export type SceneLoader = {
  /** The loader's id (`LoadSceneProps.loaderId`). */
  id: string;

  /**
   * Runs the next scene's code: awaited after the scene's assets have loaded. Without it the load
   * runs the code itself; with it, call `nextSceneFn` once (eg. after a transition starts) and
   * resolve when it has resolved.
   * @param loader this loader
   * @param nextSceneFn runs the scene's code with its data and assets (its argument is ignored)
   */
  loadFn?: (
    loader: SceneLoader,
    nextSceneFn: (sceneData: SceneData) => Promise<void>
  ) => Promise<void>;

  /**
   * Awaited first, while the previous scene is still up (its container is on the HUD already):
   * eg. fade the screen in. The result is ignored.
   * @param loader this loader
   */
  loadStartFn?: (loader: SceneLoader) => Promise<boolean>;

  /**
   * Awaited last, once the next scene is current and entered: eg. fade the screen out. The
   * container and the group are removed after it. The result is ignored.
   * @param loader this loader
   */
  loadEndFn?: (loader: SceneLoader) => Promise<boolean>;

  /** The progress callback {@link getLoaderStatusUpdater} returns for scene code to call. */
  updateLoaderStatusFn?: UpdateLoaderStatusFn;

  /** A group added to the root scene for the load (eg. a 3D loading animation), removed at its
   * end. */
  loaderGroup?: THREE.Group;

  /** Makes the loader's HUD element, once per load: added to the HUD root at the load's start,
   * removed at its end. */
  loaderContainerFn?: () => TCMP;

  /** The HUD element `loaderContainerFn` made for the running load (set by the load; the last
   * one after it). */
  loaderContainer?: TCMP;

  /** The running load's phase (set by the load): `START` until the previous scene goes, `LOAD`
   * until the next scene is entered, `END` during `loadEndFn`; undefined between loads. */
  phase?: 'START' | 'LOAD' | 'END';
};

/**
 * {@link loadScene}'s options: the scene to load, its code and the loader.
 */
export type LoadSceneProps = {
  /** The scene to load: a scene of the gathered data, or one created in code with `createScene`.
   * On the page's first load, `?startScene` or the Debug tools' start scene replaces it (debug env
   * and prod test mode). */
  sceneId: string;
  /** The scene's code, in place of its scene file (`sceneFile`'s, from the gathered data): gets
   * the scene's data and its loaded assets. A start scene override always runs its scene file. */
  nextSceneFn?: ({
    sceneData,
    assets,
  }: {
    sceneData: SceneData;
    assets: ScenePrimitiveAssets;
  }) => Promise<void>;
  /**
   * Never read: the loader's own `updateLoaderStatusFn` is the one {@link getLoaderStatusUpdater}
   * returns.
   * @deprecated Give the loader its `updateLoaderStatusFn` (`createSceneLoader`). Removed in
   * engine 6.0.0.
   */
  updateLoaderStatusFn?: UpdateLoaderStatusFn;
  /** The loader to use (its {@link SceneLoader.id}), the current one without it. */
  loaderId?: string;
  /** Release the previous scene's assets before the next scene loads instead of after it: lower
   * peak memory, but assets the next scene shares are loaded again. */
  deletePrevScene?: boolean;
};

const sceneLoaders: SceneLoader[] = [];
let currentSceneLoader: SceneLoader | null = null;
let currentlyLoading = false;
let firstSceneLoaded = false;
let nextSceneId: string | null = null;

/**
 * Registers a scene loader: the screen a scene load shows and the functions it awaits. A loader
 * lives as long as the page (the boot runs once per page load). An id that is registered already
 * warns and keeps the first.
 * @param sceneLoader the loader (its `phase` and `loaderContainer` are set by the loads)
 * @param isCurrent `false` registers it without making it the current loader (default `true`):
 * a load then uses it only through its `loaderId`
 * @returns a promise that resolves at once (the registration is synchronous)
 * @example
 * ```ts
 * import { createSceneLoader } from 'aekasha';
 * import { CMP } from 'aekasha/ui';
 *
 * await createSceneLoader({
 *   id: 'main',
 *   loaderContainerFn: () => CMP({ id: 'mainLoader', text: 'Loading…' }),
 *   updateLoaderStatusFn: (loader, params) => {
 *     const { loadedCount, totalCount } = params ?? {};
 *     loader.loaderContainer?.update({ text: `Loading ${loadedCount} / ${totalCount}` });
 *   },
 * });
 * ```
 */
export const createSceneLoader = async (
  sceneLoader: Omit<SceneLoader, 'phase' | 'loaderContainer'>,
  isCurrent?: boolean
) => {
  const foundSameId = sceneLoaders.find((sl) => sl.id === sceneLoader.id);
  if (foundSameId) {
    const msg = `Could not add scene loader because the scene loader has already been created (loader id: ${sceneLoader.id}).`;
    lwarn(msg);
    return;
  }

  sceneLoaders.push(sceneLoader);
  if (isCurrent !== false) currentSceneLoader = sceneLoader;
};

/** The current loader: a load without a `loaderId` uses it. Throws when none is registered. */
const getCurrentSceneLoader = () => {
  if (!currentSceneLoader) {
    throw new Error(
      'Could not find the current scene loader: create one (createSceneLoader) before loading a scene.'
    );
  }
  return currentSceneLoader;
};

/**
 * The objects a scene's data defines, loaded before its code runs: what the scene's code
 * (`LoadSceneProps.nextSceneFn`, a scene file's default export) gets as `assets`, by asset id.
 */
export type ScenePrimitiveAssets = {
  /** The scene's textures (its data's `textures`). */
  textures: { [id: string]: THREE.Texture };
  /** The scene's materials, with their texture ids resolved. */
  materials: { [id: string]: THREE.Material };
  /** The scene's geometries. */
  geometries: { [id: string]: THREE.BufferGeometry };
  /** The scene's imported assets by import id (spawn them with `spawnImportedAsset`). */
  importedAssets: { [id: string]: ImportedAssetManifest };
};

/** A load {@link beginLoad} has started: what it resolved, and what it added to the page */
type ActiveLoad = {
  sceneId: string;
  sceneData: SceneData;
  nextSceneFn: NonNullable<LoadSceneProps['nextSceneFn']>;
  loader: SceneLoader;
  loaderContainer: TCMP | null;
  deletePrevScene: boolean;
};

/**
 * The scene the page's first load loads instead of the props' (and with which loader), or null:
 * the `?startScene` param (an unknown id warns and is ignored), else the Debug tools' start scene,
 * and the debugger's own loader when the Debug tools ask for it. Debug env and prod test mode
 * only; a production build drops it.
 */
const resolveStartSceneOverride = () => {
  if (firstSceneLoaded || !(IS_DEBUG_ENV || IS_PROD_TEST_MODE)) return null;

  // ?startScene=<sceneId> (getStartSceneQueryParam) wins over the Debug tools' start scene. The
  // Debug tools' state is prod-test-aware, so a prod test run honours a start scene left set there
  let sceneId: string | null = null;
  const startSceneParam = getStartSceneQueryParam();
  if (startSceneParam) {
    if (getGeneratedSceneData(startSceneParam) && getAppData().sceneFiles[startSceneParam]) {
      sceneId = startSceneParam;
    } else {
      const msg = `Unknown scene id "${startSceneParam}" in the startScene URL param, loading the usual start scene instead.`;
      lwarn(msg);
      addDebugToastWhenReady({ type: 'warning', title: 'Unknown startScene', message: msg });
    }
  }

  const { scenesListing } = getDebugToolsState(true);
  const useDebugStartScene = Boolean(
    scenesListing.useDebugStartScene && scenesListing.debugStartScene
  );
  if (!sceneId && useDebugStartScene) sceneId = scenesListing.debugStartScene;
  if (!sceneId) return null;

  // The debugger's own loader is registered in the debug env only (never in prod test mode), so
  // only the debug env targets it. It applies to a ?startScene too
  const loaderId =
    useDebugStartScene && IS_DEBUG_ENV && scenesListing.useDebuggerSceneLoader
      ? DEBUGGER_SCENE_LOADER_ID
      : undefined;
  return { sceneId, loaderId };
};

/** The loader with the id (the current loader without one). The debugger's loader falls back to
 * the current one when it doesn't exist: a stale debug setting must never fail the boot. Throws
 * on an unknown loader, or without any. */
const resolveLoader = (loaderId: string | undefined): SceneLoader => {
  if (!loaderId) return getCurrentSceneLoader();
  const loader = sceneLoaders.find((sl) => sl.id === loaderId);
  if (loader) return loader;
  // Only the debug env targets the debugger's loader: a production build drops this
  if (IS_DEBUG_ENV && loaderId === DEBUGGER_SCENE_LOADER_ID) {
    lwarn(
      `Could not find the debugger scene loader (loader id "${loaderId}") in loadScene, using the current scene loader instead.`
    );
    return getCurrentSceneLoader();
  }
  throw new Error(`Could not find scene loader with loader id "${loaderId}".`);
};

/** The scene, its data and code, and the loader a load uses. Throws on an unknown scene, a scene
 * without code, or an unknown loader. */
const resolveLoadTarget = (loadSceneProps: LoadSceneProps) => {
  const override = resolveStartSceneOverride();
  const sceneId = override?.sceneId ?? loadSceneProps.sceneId;

  let sceneData = getGeneratedSceneData(sceneId);
  if (!sceneData) {
    const sceneOpts = getSceneOpts(sceneId);
    if (!sceneOpts) {
      throw new Error(`Could not find sceneData / sceneOpts with scene id "${sceneId}".`);
    }
    sceneData = {
      id: sceneId,
      sceneFile: '',
      name: sceneOpts.name,
      description: sceneOpts.description,
    };
  }

  // A start scene override always runs its own scene file, never the code the props pass
  const nextSceneFn = (!override && loadSceneProps.nextSceneFn) || getAppData().sceneFiles[sceneId];
  if (!nextSceneFn) throw new Error(`Could not find the scene code of scene "${sceneId}".`);

  // The debugger's loader when the start scene asks for it, else the props'
  const loader = resolveLoader(override?.loaderId ?? loadSceneProps.loaderId);
  return { sceneId, sceneData, nextSceneFn, loader };
};

/** Resolves a load's target, then starts it: from here until {@link finishLoad} the page is
 * loading (the loader's container and group shown, the debugger, the inputs and the canvas's
 * pointer events off). Throws from {@link resolveLoadTarget} before anything changes. */
const beginLoad = (loadSceneProps: LoadSceneProps): ActiveLoad => {
  const { sceneId, sceneData, nextSceneFn, loader } = resolveLoadTarget(loadSceneProps);

  currentlyLoading = true;
  nextSceneId = sceneId;
  // Assets registered (or taken from the cache) from here on belong to the next scene
  setAssetOwnerScene(sceneId);

  // Add possible CMP container to HUD
  let loaderContainer: TCMP | null = null;
  if (loader.loaderContainerFn) {
    loaderContainer = loader.loaderContainerFn();
    loader.loaderContainer = loaderContainer;
    getHUDRootCMP().add(loaderContainer);
  }
  // Add possible loader group to current scene
  if (loader.loaderGroup) getRootScene()?.add(loader.loaderGroup);

  // Disable debuggers and input controls
  disableDebugger(true);
  setAllInputsEnabled(false);
  getCanvasParentElem()?.style.setProperty('pointer-events', 'none');

  loader.phase = 'START';
  return {
    sceneId,
    sceneData,
    nextSceneFn,
    loader,
    loaderContainer,
    deletePrevScene: Boolean(loadSceneProps.deletePrevScene),
  };
};

/** Tears the previous scene down: the features' exit hooks, the groups, its loopers, its exit
 * listeners, the secondary worlds and the default world's non-persistent entities. */
const tearDownPrevScene = (load: ActiveLoad, prevSceneId: string | undefined) => {
  // The features tear down the previous scene (in reverse install order: the viewports,
  // PostFX and lines, the sky box, characters, then physics entities), then the groups,
  // loopers and non-persistent entities go
  runSceneExitHooks(prevSceneId);
  deleteAllGroupEntities();
  if (prevSceneId) deleteAllSceneLoopers(prevSceneId);

  runOnSceneExit(prevSceneId);
  runOnAllSceneExits();
  deleteAllRayHelpers();

  // Secondary ECS worlds (eg. created ad-hoc by a scene) are scene-scoped and
  // never re-created if left alive, so wipe them all on every scene change.
  for (const world of getAllECSWorlds()) {
    if (world.id !== DEFAULT_ECS_WORLD_ID) deleteECSWorld(world.id);
  }

  const ecsWorld = existsOrThrow(getECSWorld(), 'Could not find ECS World in loadScene');
  ecsWorld.clearNonPersistent();
  // The features' part, before anything of the next scene exists (spatial's scene domains)
  runSceneWorldClearedHooks(ecsWorld, prevSceneId, load.sceneData);
  if (load.deletePrevScene && prevSceneId && prevSceneId !== load.sceneId) {
    releaseSceneOwnedAssets(prevSceneId);
  }
};

/** Builds the next scene until it's current with its JSON objects: its cameras, its assets, its
 * code (through the loader's `loadFn`), the features' `created` hooks, then the previous scene's
 * assets released. */
const loadNextSceneAsync = async (load: ActiveLoad, prevSceneId: string | undefined) => {
  const { sceneId, sceneData, loader } = load;
  loader.phase = 'LOAD';
  // From here until it is current, optional scene ids (loopers, sky boxes) mean the next scene
  setLoadingSceneId(sceneId);

  createCameras(sceneData);

  // Every random stream starts again, so the scene draws the same numbers on every visit
  resetRandomStreams();
  // After the cameras (frames keep rendering while a hook awaits, which needs a camera),
  // before the assets (imports can create entities): physics starts a fresh world here
  await runSceneBeforeAssetsHooksAsync();

  // Create / load all next scene assets before the scene file
  const nextSceneAssets = await loadNextSceneAssets(sceneData);
  const runSceneCode = () => load.nextSceneFn({ sceneData, assets: nextSceneAssets });
  if (loader.loadFn) {
    await loader.loadFn(loader, runSceneCode);
  } else {
    await runSceneCode();
  }

  // Scene has been loaded and initialized
  existsOrThrow(getScene(sceneId), `Scene loader could not find scene with scene id '${sceneId}'.`);
  setCurrentScene(sceneId);
  setLoadingSceneId(null);
  // The features' part (the sky box shows the scene's default, PostFX sets up its chain)
  await runSceneCreatedHooksAsync(sceneId);
  createNextSceneObject3Ds(sceneData);
  // The next scene has taken refs on, or re-tagged, what it shares with the previous one:
  // release what the previous scene still owns and nothing uses. (Reloading the same
  // scene releases nothing: its assets are all tagged with the same id.)
  if (prevSceneId && prevSceneId !== sceneId) releaseSceneOwnedAssets(prevSceneId);
};

/** Enters the scene that is now current: the inputs and the canvas back on, the enter listeners,
 * the debugger, and the features' `entered` hooks. */
const enterSceneAsync = async (sceneId: string) => {
  getCanvasParentElem()?.style.setProperty('pointer-events', '');
  setAllInputsEnabled(true);
  firstSceneLoaded = true;

  runOnSceneEnter(sceneId);
  runOnAllSceneEnters();

  if (IS_DEBUG_ENV) {
    disableDebugger(false);
    updateOnScreenTools();
  }
  resetRayCastStats();
  // The scene is complete: physics waits for its bodies and releases its stepping, the
  // draggable windows rebuild the ones whose target exists
  await runSceneEnteredHooksAsync();
};

/** A started load's phases, from the loader's `loadStartFn` to its `loadEndFn`. */
const runLoadPhasesAsync = async (load: ActiveLoad) => {
  const { loader } = load;
  const prevSceneId = getCurrentScene()?.userData.id as string | undefined;

  if (loader.loadStartFn) await loader.loadStartFn(loader);
  setIsLoadingScene(true);
  // The features' load start (physics holds its stepping until `entered`, the draggable windows
  // close or suspend theirs)
  runSceneLoadStartHooks();

  tearDownPrevScene(load, prevSceneId);
  await loadNextSceneAsync(load, prevSceneId);
  await enterSceneAsync(load.sceneId);

  loader.phase = 'END';
  if (loader.loadEndFn) await loader.loadEndFn(loader);
};

/** Ends a started load, loaded or failed: a failed one also undoes what {@link beginLoad} and the
 * phases it reached changed (the inputs, the canvas's pointer events, the debugger, the loading
 * scene and the asset owner), so the page stays usable on the scene that is current. The
 * `loadSettled` scene hooks run right after it (the draggable windows close the ones the load
 * suspended). */
const finishLoad = (load: ActiveLoad, isLoaded: boolean) => {
  if (!isLoaded) {
    setLoadingSceneId(null);
    // Assets registered from here on belong to the scene that's current (the next one, when the
    // load failed after the scene code ran)
    setAssetOwnerScene(getCurrentSceneId() ?? null);
    getCanvasParentElem()?.style.setProperty('pointer-events', '');
    setAllInputsEnabled(true);
    if (IS_DEBUG_ENV) disableDebugger(false);
  }
  load.loaderContainer?.remove();
  if (load.loader.loaderGroup) getRootScene()?.remove(load.loader.loaderGroup);
  load.loader.phase = undefined;
  currentlyLoading = false;
  nextSceneId = null;
  setIsLoadingScene(false);
};

/** One load, from its target's resolution to its end. Never rejects: a failure is logged, undone
 * and resolves `false`. */
const runLoadAsync = (loadSceneProps: LoadSceneProps): Promise<boolean> => {
  let load: ActiveLoad | null = null;
  // The executor runs synchronously, so the load has started (isCurrentlyLoading) when loadScene
  // returns. A promise chain, not a try block (Rollup keeps a try block's calls whole, so its
  // debug-gated calls would ship, see InitEngine)
  return new Promise<void>((resolve) => {
    load = beginLoad(loadSceneProps);
    resolve(runLoadPhasesAsync(load));
  })
    .then(
      () => true,
      (reason: unknown) => {
        const phase = load?.loader.phase;
        const sceneId = load?.sceneId ?? loadSceneProps.sceneId;
        lerror(`Could not load scene "${sceneId}"${phase ? ` (phase '${phase}')` : ''}.`, reason);
        return false;
      }
    )
    .then((isLoaded) => {
      if (load) finishLoad(load, isLoaded);
      // Failed or not (a failed load must not leave physics held)
      if (load) runSceneLoadSettledHooks();
      return isLoaded;
    });
};

/** The load that waits for the running one: a newer call replaces it */
let waitingLoad: { props: LoadSceneProps; resolve: (isLoaded: boolean) => void } | null = null;
let isLoadRunning = false;

/** Runs a load, then the one that waited for it (each in turn, none interleaved) */
const runQueuedLoadAsync = (loadSceneProps: LoadSceneProps): Promise<boolean> => {
  isLoadRunning = true;
  const loaded = runLoadAsync(loadSceneProps);
  void loaded.finally(() => {
    isLoadRunning = false;
    const waiting = waitingLoad;
    waitingLoad = null;
    if (waiting) void runQueuedLoadAsync(waiting.props).then(waiting.resolve);
  });
  return loaded;
};

/**
 * Loads a scene in place of the current one, with a scene loader: tears the current scene down,
 * creates the next one's cameras, loads its assets, runs its code and creates its JSON objects,
 * with the features' scene hooks at their places.
 *
 * One load runs at a time. A call while a load runs waits for it, then runs; a later call
 * meanwhile replaces the waiting one, which resolves `false` without loading (the last request
 * wins).
 * @param loadSceneProps the scene, its code and the loader
 * @returns `true` once the scene is current, `false` when the load failed (logged, and undone so
 * the page stays usable) or was replaced while it waited. It never rejects.
 * @remarks Never await it from a scene's code or a scene hook: the call waits for the load it runs
 * in, which waits for it. Call it without `await` there (it runs once the load has finished).
 * @example
 * ```ts
 * import { loadScene } from 'aekasha';
 *
 * const isLoaded = await loadScene({ sceneId: 'level2' });
 * if (!isLoaded) showMenu();
 * ```
 */
export const loadScene = (loadSceneProps: LoadSceneProps): Promise<boolean> => {
  if (!isLoadRunning) return runQueuedLoadAsync(loadSceneProps);
  waitingLoad?.resolve(false);
  return new Promise((resolve) => {
    waitingLoad = { props: loadSceneProps, resolve };
  });
};

/**
 * The progress callback of a loader (the current one without an id) for scene code to report
 * to: it calls the loader's {@link SceneLoader.updateLoaderStatusFn} with the loader. Throws when
 * the loader doesn't exist or has no `updateLoaderStatusFn`.
 * @param loaderId the loader's id (default: the current loader)
 * @returns a function that passes its `params` on to the loader's callback
 * @example
 * ```ts
 * import { getLoaderStatusUpdater } from 'aekasha';
 *
 * const updateLoaderFn = getLoaderStatusUpdater();
 * updateLoaderFn({ loadedCount: 1, totalCount: 3 });
 * ```
 */
export const getLoaderStatusUpdater = (loaderId?: string) => {
  let updateLoaderStatusFn: UpdateLoaderStatusFn | undefined = undefined;
  let loader: SceneLoader;

  if (!loaderId) {
    if (!currentSceneLoader) {
      const msg =
        'Could not find current scene loader. Create the loader first (createSceneLoader) before trying to get the loader status updater.';
      lerror(msg);
      throw new Error(msg);
    }

    updateLoaderStatusFn = currentSceneLoader.updateLoaderStatusFn;
    loader = currentSceneLoader;
  } else {
    const sceneLoader = sceneLoaders.find((loader) => loader.id === loaderId);
    if (!sceneLoader) {
      const msg = `Could not find a scene loader with id '${loaderId}'. Create the loader first (createSceneLoader) before trying to get the loader status updater.`;
      lerror(msg);
      throw new Error(msg);
    }

    updateLoaderStatusFn = sceneLoader.updateLoaderStatusFn;
    loader = sceneLoader;
  }

  if (!updateLoaderStatusFn) {
    const msg =
      'The scene loader does not have an updateLoaderStatusFn. Provide it when creating the scene loader (in createSceneLoader).';
    lerror(msg);
    throw new Error(msg);
  }

  return (params?: { [key: string]: unknown }) => updateLoaderStatusFn(loader, params);
};

/**
 * Whether a scene load runs: from the moment {@link loadScene} starts it (before the loader's
 * `loadStartFn`) until it has finished or failed (after `loadEndFn`). A load waiting for it isn't
 * counted. `loopState.isLoadingScene` is narrower: from after `loadStartFn`.
 * @internal
 */
export const isCurrentlyLoading = () => currentlyLoading;

/**
 * Whether a scene load has completed on this page (the first one ends the debug start-scene
 * overrides).
 * @internal
 */
export const hasFirstSceneBeenLoaded = () => firstSceneLoaded;

/**
 * The scene the running load loads (null between loads): while it loads, code that defaults a
 * scene id reads it (`isCurrentlyLoading() ? getNextSceneId() : getCurrentSceneId()`).
 * @internal
 */
export const getNextSceneId = () => nextSceneId;
