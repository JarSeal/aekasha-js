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

export type UpdateLoaderStatusFn = (
  loader: SceneLoader,
  params?: { [key: string]: unknown }
) => void;

export type SceneLoader = {
  /**
   * Scene Loader ID
   */
  id: string;

  /**
   * Next scene loader function, resolves when loading is done.
   * @param loader SceneLoader ({@link SceneLoader})
   * @param nextSceneFn runs the next scene's code with its data (the default loadFn only awaits it)
   */
  loadFn?: (
    loader: SceneLoader,
    nextSceneFn: (sceneData: SceneData) => Promise<void>
  ) => Promise<void>;

  /**
   * Load start function, returns true when done
   * @param loader SceneLoader ({@link SceneLoader})
   * @returns Promise<boolean>
   */
  loadStartFn?: (loader: SceneLoader) => Promise<boolean>;

  /**
   * Load end function, returns true when done
   * @param loader SceneLoader ({@link SceneLoader})
   * @returns Promise<boolean>
   */
  loadEndFn?: (loader: SceneLoader) => Promise<boolean>;

  /**
   * Update loader status function, returns true when loading is done. {@link UpdateLoaderStatusFn}
   */
  updateLoaderStatusFn?: UpdateLoaderStatusFn;

  /**
   * The optional three.js group to be used in the loader
   */
  loaderGroup?: THREE.Group;

  /**
   * The optional function to create a loader container
   * @returns function (() => TCMP)
   */
  loaderContainerFn?: () => TCMP;

  /**
   * The optional HTML overlay component of the loader view that is attached to the
   */
  loaderContainer?: TCMP;

  /**
   * Loading phase (no loading phase = undefined)
   */
  phase?: 'START' | 'LOAD' | 'END';
};

/**
 * {@link loadScene}'s options: the scene to load, the function that builds it from its data and
 * assets, the loader and its status callback.
 */
export type LoadSceneProps = {
  sceneId: string;
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
  loaderId?: string; // loaderId to use, if not provided then the currentSceneLoader will be used
  /** Release the previous scene's assets before the next scene loads instead of after it: lower
   * peak memory, but assets the next scene shares are loaded again. */
  deletePrevScene?: boolean;
  // @TODO: add possibility to disable inputControls for prevScene while loading
  // @TODO: add possibility to add nextSceneCamera (maybe)
};

const sceneLoaders: SceneLoader[] = [];
let currentSceneLoader: SceneLoader | null = null;
let currentSceneLoaderId: string | null = null;
let currentlyLoading = false;
let firstSceneLoaded = false;
let nextSceneId: string | null = null;

export const createSceneLoader = async (
  sceneLoader: Omit<SceneLoader, 'phase' | 'loaderContainer'>,
  isCurrent?: boolean // default is true
) => {
  const foundSameId = sceneLoaders.find((sl) => sl.id === sceneLoader.id);
  if (foundSameId) {
    const msg = `Could not add scene loader because the scene loader has already been created (loader id: ${sceneLoader.id}).`;
    lwarn(msg);
    return;
  }

  sceneLoaders.push(sceneLoader);

  if (isCurrent !== false) {
    setCurrentSceneLoader(sceneLoader.id);
  }
};

// @TODO: delete a scene loader (deleteSceneLoader)
// export const deleteSceneLoader = (id: string) => {};

export const setCurrentSceneLoader = (id: string) => {
  const foundLoader = sceneLoaders.find((sl) => sl.id === id);
  if (!foundLoader) {
    const msg = `Could not set current scene loader with loader id "${id}", because the loader was not found.`;
    lwarn(msg);
    return;
  }

  currentSceneLoader = foundLoader;
  currentSceneLoaderId = foundLoader.id;
};

export const getCurrentSceneLoader = () => {
  if (!currentSceneLoader) {
    const msg =
      'Could not find current scene loader, create a loader first before trying to access the current loader.';
    throw new Error(msg);
  }

  return currentSceneLoader;
};

export const getCurrentSceneLoaderId = () => {
  if (!currentSceneLoaderId) {
    const msg =
      'Could not find current scene loader id, create a loader first before trying to access the current loader id.';
    throw new Error(msg);
  }

  return currentSceneLoaderId;
};

export type ScenePrimitiveAssets = {
  textures: { [id: string]: THREE.Texture };
  materials: { [id: string]: THREE.Material };
  geometries: { [id: string]: THREE.BufferGeometry };
  /** The scene's imported assets by import id (spawn them with spawnImportedAsset). */
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
 * Returns a updateLoaderStatusFn wrapper. If the loaderId is not provided, the current sceneloader's updateLoaderStatusFn is returned.
 * @param loaderId SceneLoader id (optional)
 * @returns (params?: { [key: string]: unknown }) => SceneLoader.updateLoaderStatusFn(sceneLoader, params) ({@link UpdateLoaderStatusFn})
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
 * This tells whether the scene loader has started/ended the loading animation sequence.
 *
 * This does NOT tell whether the loading has started or ended, but just that loading
 * sequence has started or ended. For more accurate loading phase check, use
 * loopState.isLoading as it tells when the actual loading starts and ends.
 * @returns boolean
 */
export const isCurrentlyLoading = () => currentlyLoading;

export const hasFirstSceneBeenLoaded = () => firstSceneLoaded;

export const getNextSceneId = () => nextSceneId;
