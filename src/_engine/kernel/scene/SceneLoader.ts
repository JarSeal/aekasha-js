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
import {
  DEFAULT_ECS_WORLD_ID,
  deleteECSWorld,
  getAllECSWorlds,
  getECSWorld,
  getEntityIdByAppId,
} from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { getAppData } from './AppData';
import { getTexture, loadTextureAsync } from '../assets/Texture';
import { createMaterial, getMaterial, loadTslMaterialFileAsync } from '../assets/Material';
import { textureMapKeys } from '../../utils/Constants';
import { createGeometry, doesGeoExist, getGeometry } from '../assets/Geometry';
import { createLightEntity } from '../light/Light';
import { createCameraEntity, setActiveCamera } from '../camera/Camera';
import { createMeshEntity } from '../mesh/Mesh';
import type { ImportedAssetManifest } from '../assets/import/ImportTypes';
import { retagAssetOwner, setAssetOwnerScene } from '../assets/AssetOwners';
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

export const createCameras = (sceneData: SceneData) => {
  const cameraProps = sceneData.cameras || [];
  let firstCamId;
  let activeCamFound = false;
  let oneCameraCreated = false;
  if (!cameraProps?.length) {
    const msg = 'Could not find any cameras for the scene in createCameras (SceneLoader).';
    lerror(msg);
    throw new Error(msg);
  }
  for (let i = 0; i < cameraProps.length; i++) {
    const props = cameraProps[i];
    if (typeof props === 'string') {
      if (i === 0) firstCamId = getEntityIdByAppId(props);
      continue;
    }
    createCameraEntity(props.camProps, props.entityOpts);
    oneCameraCreated = true;
    if (props.camProps.active) activeCamFound = true;
  }
  if (!oneCameraCreated) {
    const msg = 'No camera was created in createCameras (SceneLoader).';
    lerror(msg);
    throw new Error(msg);
  }
  if (!activeCamFound && firstCamId) {
    setActiveCamera(firstCamId);
  }
};

export type ScenePrimitiveAssets = {
  textures: { [id: string]: THREE.Texture };
  materials: { [id: string]: THREE.Material };
  geometries: { [id: string]: THREE.BufferGeometry };
  /** The scene's imported assets by import id (spawn them with spawnImportedAsset). */
  importedAssets: { [id: string]: ImportedAssetManifest };
};

/** Imports a scene's imported assets into `importedAssets`, and re-tags the ones it names by id.
 * The import registry (the glTF import path) loads here, only for a scene that names an import
 * (p613 D4): a scene, or an app, without one never loads it. */
const loadSceneImportsAsync = async (
  assets: SceneData['importedAssets'],
  importedAssets: ScenePrimitiveAssets['importedAssets']
) => {
  if (!assets?.length) return;
  const registry = await import('../assets/import/ImportRegistry');
  const importPromises: Promise<ImportedAssetManifest | null>[] = [];
  for (const asset of assets) {
    if (typeof asset === 'string') {
      registry.retagImportedAsset(asset);
      const manifest = registry.getImportedAsset(asset);
      if (manifest) importedAssets[asset] = manifest;
      continue;
    }
    importPromises.push(registry.importAssetAsync(asset));
  }
  for (const manifest of await Promise.all(importPromises)) {
    if (manifest) importedAssets[manifest.id] = manifest;
  }
};

type SceneMaterialDef = Exclude<NonNullable<SceneData['materials']>[number], string>;

/** A copy of a material's params with its texture ids resolved to the scene's textures (or the
 * registered ones). Never resolved in place: the generated scene data is cached, so a revisit
 * would see the previous visit's texture objects, which its release may have disposed. */
const resolveTextureParams = (
  params: SceneMaterialDef['params'],
  textures: ScenePrimitiveAssets['textures']
): SceneMaterialDef['params'] => {
  const resolved: Record<string, unknown> = { ...params };
  for (const texKey of textureMapKeys) {
    const texRef = resolved[texKey];
    if (typeof texRef !== 'string') continue;
    const texture = textures[texRef] || getTexture(texRef);
    if (!texture) {
      lwarn(`Could not find texture with id "${texRef}" in loadNextSceneAssets.`);
      continue;
    }
    resolved[texKey] = texture;
  }
  return resolved as SceneMaterialDef['params'];
};

const loadNextSceneAssets = async (sceneData: SceneData): Promise<ScenePrimitiveAssets> => {
  const textures: ScenePrimitiveAssets['textures'] = {};
  const materials: ScenePrimitiveAssets['materials'] = {};
  const geometries: ScenePrimitiveAssets['geometries'] = {};
  const importedAssets: ScenePrimitiveAssets['importedAssets'] = {};

  // Load textures, imported assets and the materials' TSL files (in parallel): materials can use
  // the textures and meshes the imported geometries (by id). Assets referenced by id are re-tagged
  // to this scene (AssetOwners), so leaving the scene that loaded them doesn't release them.
  const sceneTextures = sceneData.textures || [];
  const texturePromises: Promise<THREE.Texture>[] = [];
  const textureIds: string[] = [];
  for (let i = 0; i < sceneTextures.length; i++) {
    const tex = sceneTextures[i];
    if (typeof tex === 'string') {
      const texture = getTexture(tex);
      if (texture) retagAssetOwner(texture);
      continue;
    }
    const texId = tex.id;
    if (!texId) continue;
    textureIds.push(texId);
    texturePromises.push(loadTextureAsync(tex));
  }
  // The TSL files load on demand (p607 D11): createMaterial reads them synchronously
  const tslFilePromises: Promise<boolean>[] = [];
  for (const material of sceneData.materials || []) {
    if (typeof material === 'string' || !('tslFile' in material) || !material.tslFile) continue;
    tslFilePromises.push(loadTslMaterialFileAsync(material.tslMaterialId || material.id || ''));
  }
  const [loadedTextures] = await Promise.all([
    Promise.all(texturePromises),
    loadSceneImportsAsync(sceneData.importedAssets, importedAssets),
    Promise.all(tslFilePromises),
  ]);
  for (let i = 0; i < loadedTextures.length; i++) {
    textures[textureIds[i]] = loadedTextures[i];
  }

  // Create materials
  const sceneMaterials = sceneData.materials || [];
  for (let i = 0; i < sceneMaterials.length; i++) {
    const material = sceneMaterials[i];
    if (typeof material === 'string') {
      const mat = getMaterial(material);
      if (mat) {
        retagAssetOwner(mat);
        materials[material] = mat;
      }
      continue;
    }
    const params = resolveTextureParams(material.params, textures);
    const mat = createMaterial({ ...material, params });
    if (mat) materials[material.id || `material-${i}`] = mat;
  }

  // Create geometries
  const sceneGeometries = sceneData.geometries || [];
  for (let i = 0; i < sceneGeometries.length; i++) {
    const geometry = sceneGeometries[i];
    if (typeof geometry === 'string') {
      const geo = getGeometry(geometry);
      if (geo) {
        retagAssetOwner(geo as THREE.BufferGeometry);
        geometries[geometry] = geo as THREE.BufferGeometry;
      }
      continue;
    }
    const geo = createGeometry({ ...geometry });
    if (geo) geometries[geometry.id || `geometry-${i}`] = geo;
  }

  return { textures, materials, geometries, importedAssets };
};

const createNextSceneObject3Ds = async (sceneData: SceneData): Promise<void> => {
  // Create lights
  const lightProps = sceneData.lights || [];
  for (let i = 0; i < lightProps.length; i++) {
    const props = lightProps[i];
    if (typeof props === 'string') continue;
    createLightEntity(props.lightProps, props.entityOpts);
  }

  // Create meshes
  const meshProps = sceneData.meshes || [];
  for (let i = 0; i < meshProps.length; i++) {
    const props = meshProps[i];
    if (typeof props === 'string') continue;
    // Resolve into locals, never write back: the generated scene data is cached, and a revisit
    // would otherwise reuse the previous visit's released (disposed) geometry/material objects
    let geo = props.props.geo;
    if (typeof geo === 'string') {
      const foundGeo = doesGeoExist(geo) ? getGeometry(geo) : undefined;
      if (!foundGeo) {
        lerror(
          `Could not find geometry with id "${geo}" for mesh "${props.props.appId || props.entityOpts?.appId}" in createNextSceneObject3Ds. Mesh not created.`
        );
        continue;
      }
      geo = foundGeo as THREE.BufferGeometry;
    }
    let mat = props.props.mat;
    if (typeof mat === 'string') {
      const foundMat = getMaterial(mat);
      if (!foundMat) {
        lerror(
          `Could not find material with id "${mat}" for "${props.props.appId || props.entityOpts?.appId}" mesh in createNextSceneObject3Ds. Mesh not created.`
        );
        continue;
      }
      mat = foundMat;
    }
    createMeshEntity({ ...props.props, geo, mat }, props.entityOpts);
  }
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

/** The scene, its code and the loader a load uses: the props', or on the page's first load the
 * `?startScene` param's or the Debug tools' start scene (and loader). Throws on an unknown scene,
 * a scene without code, or an unknown loader. */
const resolveLoadTarget = (loadSceneProps: LoadSceneProps) => {
  let sceneId = loadSceneProps.sceneId;
  let targetLoaderId = loadSceneProps.loaderId;
  let overrideNextSceneFn = loadSceneProps.nextSceneFn;

  // Process Debug Start Scene Interception (First boot only) — also respected under
  // isProdTest (IS_PROD_TEST_MODE), not just real debug mode, so a "production build with a
  // subset of debug features" run still honors a start-scene override left set in the debug
  // tools tab (getDebugToolsState/registerDebugToolsModule are prod-test-aware for this).
  const debugToolsState =
    (IS_DEBUG_ENV || IS_PROD_TEST_MODE) && !firstSceneLoaded ? getDebugToolsState(true) : null;

  // ?startScene=<sceneId> (debug env and prod test mode, getStartSceneQueryParam) wins over the
  // Debug tools' start scene. An unknown id falls back to the scene loaded without it
  const startSceneParam = !firstSceneLoaded ? getStartSceneQueryParam() : null;
  let startSceneOverride: string | null = null;
  if (startSceneParam) {
    if (getGeneratedSceneData(startSceneParam) && getAppData().sceneFiles[startSceneParam]) {
      startSceneOverride = startSceneParam;
    } else {
      const msg = `Unknown scene id "${startSceneParam}" in the startScene URL param, loading the usual start scene instead.`;
      lwarn(msg);
      addDebugToastWhenReady({ type: 'warning', title: 'Unknown startScene', message: msg });
    }
  }

  const useDebugStartScene = Boolean(
    debugToolsState?.scenesListing.useDebugStartScene &&
      debugToolsState.scenesListing.debugStartScene
  );

  if (startSceneOverride || useDebugStartScene) {
    sceneId = startSceneOverride || debugToolsState?.scenesListing.debugStartScene || sceneId;

    // Clear out any hardcoded start functions passed by index.ts
    // to guarantee the lookup pulls dynamically from the app data's sceneFiles instead
    overrideNextSceneFn = undefined;
  }

  // Resolve your loader @TODO: Override with the explicit debugger loader
  // The debugger's own scene-loader UI is IS_DEBUG_ENV-only (never registered under
  // isProdTest) — only honor this sub-option in real debug mode, or targetLoaderId would
  // point at a loader that was never created. It applies to a ?startScene too.
  if (useDebugStartScene && IS_DEBUG_ENV && debugToolsState?.scenesListing.useDebuggerSceneLoader) {
    targetLoaderId = DEBUGGER_SCENE_LOADER_ID;
  }

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

  // Resolve the Stage Execution Function from your autogenerated registry module
  const nextSceneFn = overrideNextSceneFn || getAppData().sceneFiles[sceneId];
  if (!nextSceneFn) throw new Error(`Could not find the scene code of scene "${sceneId}".`);

  // Resolve the Scene Loader Component context
  let loader = targetLoaderId ? sceneLoaders.find((sl) => sl.id === targetLoaderId) : undefined;
  // Only the debug env targets the debugger's loader (above): a production build drops this
  if (!loader && IS_DEBUG_ENV && targetLoaderId === DEBUGGER_SCENE_LOADER_ID) {
    // A stale debug setting must never kill boot, fall back to the current loader
    lwarn(
      `Could not find the debugger scene loader (loader id "${targetLoaderId}") in loadScene, using the current scene loader instead.`
    );
    targetLoaderId = undefined;
  }
  if (!targetLoaderId) loader = getCurrentSceneLoader();
  if (!loader) throw new Error(`Could not find scene loader with loader id "${targetLoaderId}".`);

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

/** A started load's phases, from the loader's `loadStartFn` to its `loadEndFn`. */
const runLoadPhasesAsync = async (load: ActiveLoad) => {
  const { sceneId, sceneData, loader } = load;
  const prevScene = getCurrentScene();
  const prevSceneId = prevScene?.userData.id;

  if (loader.loadStartFn) await loader.loadStartFn(loader);
  setIsLoadingScene(true);
  // The features' load start (physics holds its stepping until `entered`)
  runSceneLoadStartHooks();

  // The features tear down the previous scene (in reverse install order: the viewports,
  // PostFX and lines, the sky box, characters, then physics entities), then the groups,
  // loopers and non-persistent entities go
  runSceneExitHooks(prevSceneId);
  deleteAllGroupEntities();

  if (prevScene) deleteAllSceneLoopers(prevSceneId);

  runOnSceneExit(prevSceneId);
  runOnAllSceneExits();
  deleteAllRayHelpers();

  // Secondary ECS worlds (eg. created ad-hoc by a scene) are scene-scoped and
  // never re-created if left alive, so wipe them all on every scene change.
  for (const world of getAllECSWorlds()) {
    if (world.id !== DEFAULT_ECS_WORLD_ID) deleteECSWorld(world.id);
  }

  const ecsWorld = existsOrThrow(getECSWorld(), 'Could not find ECS World in loadScene');
  if (IS_DEBUG_ENV) {
    // We Give the Debug Camera a chance to save its final state for the current scene.
    // This triggers the 'end' logic manually if needed, or simply ensures LS is up to date.
    void ecsWorld.getEntitiesWith(ComponentType.DEBUG_TAG_IS_DEBUG_CAMERA).next().value;
  }
  ecsWorld.clearNonPersistent();
  // The features' part, before anything of the next scene exists (spatial's scene domains)
  runSceneWorldClearedHooks(ecsWorld, prevSceneId, sceneData);
  if (load.deletePrevScene && prevSceneId && prevSceneId !== sceneId) {
    releaseSceneOwnedAssets(prevSceneId);
  }

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
  await createNextSceneObject3Ds(sceneData);
  // The next scene has taken refs on, or re-tagged, what it shares with the previous one:
  // release what the previous scene still owns and nothing uses. (Reloading the same
  // scene releases nothing: its assets are all tagged with the same id.)
  if (prevSceneId && prevSceneId !== sceneId) releaseSceneOwnedAssets(prevSceneId);

  getCanvasParentElem()?.style.setProperty('pointer-events', '');

  // Enable input controls
  setAllInputsEnabled(true);

  firstSceneLoaded = true;

  runOnSceneEnter(sceneId);
  runOnAllSceneEnters();

  if (IS_DEBUG_ENV) {
    // Enable debuggers
    disableDebugger(false);

    updateOnScreenTools();
  }
  resetRayCastStats();
  // The scene is complete: physics waits for its bodies and releases its stepping, the
  // draggable windows rebuild the ones whose target exists
  await runSceneEnteredHooksAsync();

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
