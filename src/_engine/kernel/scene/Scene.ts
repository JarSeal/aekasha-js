import * as THREE from 'three/webgpu';
import type { GeoProps } from '../assets/Geometry';
import type { MatProps } from '../assets/Material';
import { lerror, lwarn } from '../../utils/Logger';
import type { TextureProps } from '../assets/Texture';
import { getTexture } from '../assets/Texture';
import { initMainLoop } from '../loop/MainLoop';
import { updateDebuggerSceneTitle } from '../../debug/DebuggerGUI';
import { IS_DEBUG_ENV } from '../config/Config';
import type { LightProps } from '../light/Light';
import type { ImportAssetParams } from '../assets/import/ImportTypes';
import { runSceneRegisteredHooks } from './SceneHooks';
import type { SkyBoxDef } from '../../features/skybox/SkyBoxTypes';
import { getAppData } from './AppData';
import type { CameraProps } from '../../schemas/CameraSchema';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import type { SceneSpatialDomainEntry } from '../../schemas/SpatialDomainSchema';
import type { ImpostorDef } from '../../features/lod/impostors/ImpostorSchema';
import type { MeshProps } from '../mesh/Mesh';
import type { PostFxPassProps } from '../../features/postfx/PostFXTypes';

/** A scene looper: called once per frame with the frame's delta (seconds). */
export type Looper = (delta: number) => void;

/**
 * A scene's gathered data (`*.scene.json`, resolved by the gatherer): each list holds an asset's
 * definition, or its id for an asset another file defines. {@link getGeneratedSceneData} returns
 * it.
 */
export type SceneData = {
  /** The scene id: it keys the scene's save data, its LS state and `?startScene=`. */
  id: string;
  /** The scene's code module, relative to `src/app/` (its loader is in the generated code). */
  sceneFile: string;
  /** A scene only the debug env lists. */
  isDebugScene?: boolean;
  /** The name the debugger and the scene loader show. */
  name?: string;
  /** A description for the debugger. */
  description?: string;
  /** The root scene's background colour while the scene is current. */
  backgroundColor?: string | number;
  /** A registered texture's id for the root scene's background (over `backgroundColor`). */
  backgroundTexture?: string;
  /** The cameras the loader creates before the assets. */
  cameras?: (
    | {
        camProps: CameraProps;
        entityOpts?: CoreEntityOpts;
      }
    | string
  )[];
  /** The lights the loader creates after the scene code. */
  lights?: ({ lightProps: LightProps; entityOpts?: CoreEntityOpts } | string)[];
  /** The geometries the loader registers. */
  geometries?: (GeoProps | string)[];
  /** The textures the loader loads. */
  textures?: (TextureProps | string)[];
  /** The materials the loader creates (after the textures they name). */
  materials?: (MatProps | string)[];
  /** The meshes the loader creates after the scene code. */
  meshes?: ({ props: MeshProps; entityOpts?: CoreEntityOpts } | string)[];
  /** The glTF imports the loader runs with the assets. */
  importedAssets?: (ImportAssetParams | string)[];
  /** The scene's sky boxes (the `skyBox()` feature). */
  skyboxes?: (SkyBoxDef | string)[];
  /** Ordered PostFX pass chain (array order is execution order). */
  postFx?: (PostFxPassProps | string)[];
  /** Whether the PostFX chain starts switched on. Default true. */
  postFxEnabled?: boolean;
  /** Registered for this scene by the loader, see registerSceneSpatialDomains (SpatialIndexSystem.ts). */
  spatialDomains?: SceneSpatialDomainEntry[];
  /** The exported impostors the scene lists, resolved by the gatherer (their atlas slots are in
   * `textures`). */
  impostors?: ImpostorDef[];
  /** The features this scene's data needs (the gatherer's manifest, p607 D10): `InitEngine`
   * fails when its `features` doesn't list one. */
  __features?: string[];
};

/**
 * A registered scene's options, from its data: what `setCurrentScene` and the features read
 * when it becomes current.
 * @internal
 */
export type SceneOptions = {
  /** The name the debugger shows. */
  name?: string;
  /** A description for the debugger. */
  description?: string;
  /** The root scene's background colour while the scene is current. */
  backgroundColor?: THREE.Color | string | number;
  /** The root scene's background (a registered texture's id, or the texture), over the colour. */
  backgroundTexture?: THREE.Texture | string;
  /** Ordered PostFX pass chain (array order is execution order), see PostFX.ts. */
  postFx?: (PostFxPassProps | string)[];
  /** Whether the PostFX chain starts switched on. Default true. */
  postFxEnabled?: boolean;
};

/** A scene's loopers of one kind. A deleted looper leaves `null`, so the indexes the create
 * functions returned stay valid; clearing the scene's loopers (its exit) moves `base` past them,
 * so an index from an earlier visit never names a new looper. */
type SceneLooperSlots = { base: number; slots: (Looper | null)[] };

/** One kind of scene looper: each scene's slots, and the current scene's loopers, which the loop
 * runs. */
type LooperList = {
  /** The create function's name, for its warning. */
  createName: string;
  /** The delete function's name, for its warning. */
  deleteName: string;
  byScene: { [sceneId: string]: SceneLooperSlots };
  running: Looper[];
};

/** A listener registry: one function per key, a new one replacing the old. */
type SceneListeners = { [key: string]: () => void };

const scenes: { [id: string]: THREE.Group } = {};
const sceneOpts: { [id: string]: SceneOptions } = {};
let rootScene: THREE.Scene | null = null;
let currentScene: THREE.Group | null = null;
let currentSceneId: string | null = null;
/** The scene whose code is running in `loadScene` (set by the scene loader), until it's current */
let loadingSceneId: string | null = null;
const mainLoopers: LooperList = {
  createName: 'createSceneMainLooper',
  deleteName: 'deleteSceneMainLooper',
  byScene: {},
  running: [],
};
const mainLateLoopers: LooperList = {
  createName: 'createSceneMainLooper',
  deleteName: 'deleteSceneMainLooper',
  byScene: {},
  running: [],
};
const appLoopers: LooperList = {
  createName: 'createSceneAppLooper',
  deleteName: 'deleteSceneAppLooper',
  byScene: {},
  running: [],
};
const onSceneExit: SceneListeners = {};
const onSceneEnter: SceneListeners = {};
const onAllSceneExits: SceneListeners = {};
const onAllSceneEnters: SceneListeners = {};

/**
 * Creates (registers) a scene: an empty `THREE.Group` that the root scene holds while it's
 * current. An id already created returns that scene and ignores `opts`.
 * @internal
 * @returns the scene's group
 */
export const createScene = (id: string, opts?: SceneOptions) => {
  if (scenes[id]) return scenes[id];

  const scene = new THREE.Group();
  if (opts) sceneOpts[id] = opts;
  scenes[id] = scene;
  scene.userData.id = id;
  return scene;
};

/**
 * A registered scene's group by id: every scene of the gathered data is registered at boot, so
 * scene code can add to its own scene's group before the scene is current.
 * @param silent no warning for an unknown id
 * @param throwOnError throw for an unknown id instead (unless `silent`)
 * @returns the scene's group, or `null` for an unknown id
 * @example
 * ```ts
 * import { getScene } from 'aekasha';
 *
 * const scene = getScene('myScene', false, true)!;
 * ```
 */
export const getScene = (id: string, silent?: boolean, throwOnError?: boolean) => {
  const scene = scenes[id];
  if (!scene && !silent) {
    const msg = `Could not find scene with id "${id}", in getScene(id).`;
    if (throwOnError) {
      lerror(msg);
      throw new Error(msg);
    }
    lwarn(msg);
  }
  return scene || null;
};

/**
 * Makes a registered scene current (the scene loader calls it once the scene code has run): the
 * root scene holds its group instead of the previous one's, takes its background, and the loop
 * runs its loopers. `null` leaves no scene current. The first scene with children starts the main
 * loop.
 * @internal
 * @returns the new current scene's group, or the unchanged current one for an unknown id
 */
export const setCurrentScene = (id: string | null) => {
  if (currentSceneId === id) return currentScene;
  const nextScene = id ? scenes[id] : null;
  if (id && !nextScene) {
    lwarn(`Could not find scene with id "${id}" in setCurrentScene(id).`);
    return currentScene;
  }

  const rootScene = getRootScene() as THREE.Scene;

  if (currentScene) rootScene.remove(currentScene);

  currentSceneId = id;
  currentScene = nextScene;
  const opts = id ? sceneOpts[id] : undefined;
  refreshRunningLoopers(mainLoopers);
  refreshRunningLoopers(mainLateLoopers);
  refreshRunningLoopers(appLoopers);

  if (nextScene) {
    rootScene.background = null;
    rootScene.backgroundNode = null;
    rootScene.environmentNode = null;
    // `!== undefined`: 0 (black) is a colour
    if (opts?.backgroundColor !== undefined) {
      rootScene.background = new THREE.Color(opts.backgroundColor);
    }
    if (opts?.backgroundTexture) {
      if (typeof opts.backgroundTexture === 'string') {
        const tex = getTexture(opts.backgroundTexture);
        if (tex) {
          rootScene.background = tex;
        } else {
          lwarn(`Could not find texture for scene background with id '${opts.backgroundTexture}'.`);
        }
      } else {
        rootScene.background = opts.backgroundTexture;
      }
    }
    rootScene.add(nextScene);
  }

  // The flag here too (the debugger exists only there): a production build drops the call, whose
  // property reads it couldn't drop otherwise
  if (IS_DEBUG_ENV) {
    updateDebuggerSceneTitle(opts?.name || id || nextScene?.userData.id || '[No scene..]');
  }

  if (rootScene.children.length) initMainLoop();

  return nextScene;
};

/**
 * The current scene's group.
 * @internal
 * @param throwOnError throw when no scene is current
 * @returns the group, or `null` when no scene is current
 */
export const getCurrentScene = (throwOnError?: boolean) => {
  if (!currentScene && throwOnError) {
    const msg = 'The current scene is not defined in getCurrentScene.';
    lerror(msg);
    throw new Error(msg);
  }
  return currentScene || null;
};

/**
 * The current scene's id. While a scene loads, its code runs before it's current, so this is
 * still the previous scene's id then (`null` on the first load).
 * @param throwOnError throw when no scene is current
 * @returns the id, or `null` when no scene is current
 */
export const getCurrentSceneId = (throwOnError?: boolean) => {
  if (!currentSceneId && throwOnError) {
    const msg = 'The currentSceneId is not defined in getCurrentSceneId.';
    lerror(msg);
    throw new Error(msg);
  }
  return currentSceneId;
};

/**
 * A registered scene's options, or `undefined` for an unknown id.
 * @internal
 */
export const getSceneOpts = (id: string): SceneOptions | undefined => sceneOpts[id];

/**
 * Marks the scene whose code `loadScene` runs next (null when it's current or the load failed),
 * so the scene functions below that take an optional scene id default to it while it loads. Set
 * by the scene loader only.
 * @internal
 */
export const setLoadingSceneId = (sceneId: string | null) => {
  loadingSceneId = sceneId;
};

/** An optional scene id's default: the loading scene while its code runs, else the current one.
 * (The current scene is still the previous one then: it changes after the scene code resolves.) */
const resolveSceneId = (sceneId?: string) => sceneId || loadingSceneId || currentSceneId;

/** Points a list's running loopers at the current scene's */
const refreshRunningLoopers = (list: LooperList) => {
  const scene = currentSceneId ? list.byScene[currentSceneId] : undefined;
  list.running = scene ? scene.slots.filter((looper): looper is Looper => looper !== null) : [];
};

/** Adds a looper to a scene's list; returns its index, or -1 when there's no scene to add it to */
const addLooper = (list: LooperList, looper: Looper, sceneId: string | undefined) => {
  const id = resolveSceneId(sceneId);
  if (!id) {
    lwarn(`Could not find scene with id ${id} in ${list.createName}.`);
    return -1;
  }
  let scene = list.byScene[id];
  if (!scene) {
    scene = { base: 0, slots: [] };
    list.byScene[id] = scene;
  }
  scene.slots.push(looper);
  if (id === currentSceneId) refreshRunningLoopers(list);
  return scene.base + scene.slots.length - 1;
};

/** Deletes loopers from a scene's list by index; an index the list no longer holds is skipped */
const deleteLoopers = (list: LooperList, index: number | number[], sceneId: string | undefined) => {
  const id = resolveSceneId(sceneId);
  if (!id) {
    lwarn(`Could not find scene with id ${id} in ${list.deleteName}.`);
    return;
  }
  const scene = list.byScene[id];
  if (!scene) return;
  const indexes = typeof index === 'number' ? [index] : index;
  for (let i = 0; i < indexes.length; i++) {
    const slot = indexes[i] - scene.base;
    if (slot >= 0 && slot < scene.slots.length) scene.slots[slot] = null;
  }
  if (id === currentSceneId) refreshRunningLoopers(list);
};

/** Deletes a scene's loopers of one list (their indexes are never reused) */
const clearLoopers = (list: LooperList, sceneId: string) => {
  const scene = list.byScene[sceneId];
  if (scene) {
    scene.base += scene.slots.length;
    scene.slots = [];
  }
  if (sceneId === currentSceneId) list.running = [];
};

/** Runs a list's running loopers (a create or delete during the run takes effect next frame) */
const runLoopers = (list: LooperList, delta: number) => {
  const running = list.running;
  for (let i = 0; i < running.length; i++) running[i](delta);
};

/**
 * Adds a scene main looper: a function the main loop calls every frame while its scene is
 * current, also while the app is paused (`isLateLooper`: after the frame's render instead of
 * before it). Created during a scene's load, it starts once the scene is current. The scene's
 * loopers are deleted when it exits, so scene code adds them again on every visit.
 * @param sceneId the scene; default: the loading scene while its code runs, else the current one
 * @param isLateLooper run after the render (default false)
 * @returns the looper's index for {@link deleteSceneMainLooper} (with the same `sceneId` and
 * `isLateLooper`), or -1 when there's no scene to add it to
 * @example
 * ```ts
 * import { createSceneMainLooper } from 'aekasha';
 *
 * // In a scene file: turns the box every frame while the scene is current
 * createSceneMainLooper((delta) => {
 *   box.rotation.y += delta;
 * });
 * ```
 */
export const createSceneMainLooper = (looper: Looper, sceneId?: string, isLateLooper?: boolean) =>
  addLooper(isLateLooper ? mainLateLoopers : mainLoopers, looper, sceneId);

/**
 * Deletes scene main loopers by the indexes {@link createSceneMainLooper} returned. An index of an
 * earlier visit to the scene, or one already deleted, is skipped.
 * @param index one index or several
 * @param sceneId the scene; default: the loading scene while its code runs, else the current one
 * @param isLateLooper the late loopers' list (as the looper was created)
 * @example
 * ```ts
 * import { createSceneMainLooper, deleteSceneMainLooper } from 'aekasha';
 *
 * const looperIndex = createSceneMainLooper((delta) => tick(delta), 'myScene');
 * // ...later, while the scene is still the same visit
 * deleteSceneMainLooper(looperIndex, 'myScene');
 * ```
 */
export const deleteSceneMainLooper = (
  index: number | number[],
  sceneId?: string,
  isLateLooper?: boolean
) => deleteLoopers(isLateLooper ? mainLateLoopers : mainLoopers, index, sceneId);

/**
 * Adds a scene app looper: a function the main loop calls every frame while its scene is current
 * and the app plays (not while it's paused). Created during a scene's load, it starts once the
 * scene is current; the scene's loopers are deleted when it exits.
 * @param sceneId the scene; default: the loading scene while its code runs, else the current one
 * @returns the looper's index for {@link deleteSceneAppLooper} (with the same `sceneId`), or -1
 * when there's no scene to add it to
 * @example
 * ```ts
 * import { createSceneAppLooper } from 'aekasha';
 *
 * // In a scene file: moves the box only while the app plays
 * createSceneAppLooper((delta) => {
 *   box.position.x += delta;
 * });
 * ```
 */
export const createSceneAppLooper = (looper: Looper, sceneId?: string) =>
  addLooper(appLoopers, looper, sceneId);

/**
 * Deletes scene app loopers by the indexes {@link createSceneAppLooper} returned. An index of an
 * earlier visit to the scene, or one already deleted, is skipped.
 * @param index one index or several
 * @param sceneId the scene; default: the loading scene while its code runs, else the current one
 * @example
 * ```ts
 * import { createSceneAppLooper, deleteSceneAppLooper } from 'aekasha';
 *
 * const looperIndex = createSceneAppLooper((delta) => tick(delta));
 * deleteSceneAppLooper(looperIndex);
 * ```
 */
export const deleteSceneAppLooper = (index: number | number[], sceneId?: string) =>
  deleteLoopers(appLoopers, index, sceneId);

/**
 * Deletes a scene's main, late and app loopers (the scene loader, on the scene's exit).
 * @internal
 */
export const deleteAllSceneLoopers = (sceneId: string) => {
  clearLoopers(mainLoopers, sceneId);
  clearLoopers(mainLateLoopers, sceneId);
  clearLoopers(appLoopers, sceneId);
};

/**
 * Runs the current scene's main loopers (the main loop, every frame).
 * @internal
 */
export const runSceneMainLoopers = (delta: number, skipFrame: boolean) => {
  if (skipFrame) return;
  runLoopers(mainLoopers, delta);
};

/**
 * Runs the current scene's main late loopers (the main loop, after the render).
 * @internal
 */
export const runSceneMainLateLoopers = (delta: number) => runLoopers(mainLateLoopers, delta);

/**
 * Runs the current scene's app loopers (the main loop, while the app plays).
 * @internal
 */
export const runSceneAppLoopers = (delta: number) => runLoopers(appLoopers, delta);

/**
 * Whether a scene with this id is registered.
 * @internal
 */
export const doesSceneExist = (id: string) => Boolean(scenes[id]);

/**
 * Creates the root scene, which holds the current scene's group (the boot calls it once; a second
 * call does nothing).
 * @internal
 */
export const createRootScene = () => {
  if (rootScene) return;
  rootScene = new THREE.Scene();
};

/**
 * The root scene: what the renderer draws, holding the current scene's group, the cameras, the
 * engine's helpers and its background and environment.
 * @returns the root scene, or `null` before the boot creates it
 */
export const getRootScene = () => rootScene;

/** Sets a listener under its key; returns its remover */
const addListener = (listeners: SceneListeners, key: string, fn: () => void) => {
  listeners[key] = fn;
  return () => {
    if (listeners[key] === fn) delete listeners[key];
  };
};

/** Runs a registry's listeners (one removed by another during the run is skipped) */
const runListeners = (listeners: SceneListeners) => {
  const keys = Object.keys(listeners);
  for (let i = 0; i < keys.length; i++) listeners[keys[i]]?.();
};

/**
 * Sets the function a scene's load runs once the scene is entered: after its JSON objects exist,
 * before {@link registerOnAllSceneEnters}' functions. One per scene: a second call replaces the
 * first, so scene code can register it again on every visit.
 * @returns the remover, which removes `fn` only while it's still the scene's
 * @example
 * ```ts
 * import { registerOnSceneEnter } from 'aekasha';
 *
 * registerOnSceneEnter('myScene', () => console.log('entered'));
 * ```
 */
export const registerOnSceneEnter = (sceneId: string, fn: () => void) =>
  addListener(onSceneEnter, sceneId, fn);

/**
 * Sets the function the next scene's load runs when this scene exits: after the features' exit
 * hooks and the scene's groups and loopers have gone, before {@link registerOnAllSceneExits}'
 * functions and before its non-persistent entities go. One per scene: a second call replaces the
 * first.
 * @returns the remover, which removes `fn` only while it's still the scene's
 * @example
 * ```ts
 * import { registerOnSceneExit } from 'aekasha';
 *
 * // In a scene file: stops what the scene started outside the ECS
 * const timer = setInterval(() => console.log('tick'), 1000);
 * registerOnSceneExit('myScene', () => clearInterval(timer));
 * ```
 */
export const registerOnSceneExit = (sceneId: string, fn: () => void) =>
  addListener(onSceneExit, sceneId, fn);

/**
 * Runs the scene's enter function (the scene loader).
 * @internal
 */
export const runOnSceneEnter = (sceneId: string) => {
  onSceneEnter[sceneId]?.();
};

/**
 * Runs the scene's exit function (the scene loader).
 * @internal
 */
export const runOnSceneExit = (sceneId?: string) => {
  if (sceneId) onSceneExit[sceneId]?.();
};

/**
 * Sets a function every scene load runs once its scene is entered, after the scene's own
 * {@link registerOnSceneEnter} function. One per `id`: a second call with the same id replaces the
 * first.
 * @param id the function's key, any string unique to its owner
 * @returns the remover, which removes `fn` only while it's still the one under `id`
 * @example
 * ```ts
 * import { getCurrentSceneId, registerOnAllSceneEnters } from 'aekasha';
 *
 * const removeListener = registerOnAllSceneEnters('myHud', () => {
 *   console.log(`entered ${getCurrentSceneId()}`);
 * });
 * ```
 */
export const registerOnAllSceneEnters = (id: string, fn: () => void) =>
  addListener(onAllSceneEnters, id, fn);

/**
 * The old name of {@link registerOnAllSceneEnters}.
 * @deprecated Use {@link registerOnAllSceneEnters}. Removed in engine 6.0.0.
 */
export const registerOnAllSceneEnterings = registerOnAllSceneEnters;

/**
 * Sets a function every scene load runs when the previous scene exits, after that scene's own
 * {@link registerOnSceneExit} function. One per `id`: a second call with the same id replaces the
 * first.
 * @param id the function's key, any string unique to its owner
 * @returns the remover, which removes `fn` only while it's still the one under `id`
 * @example
 * ```ts
 * import { registerOnAllSceneExits } from 'aekasha';
 *
 * const removeListener = registerOnAllSceneExits('myHud', () => console.log('scene exit'));
 * ```
 */
export const registerOnAllSceneExits = (id: string, fn: () => void) =>
  addListener(onAllSceneExits, id, fn);

/**
 * Runs the {@link registerOnAllSceneEnters} functions (the scene loader).
 * @internal
 */
export const runOnAllSceneEnters = () => runListeners(onAllSceneEnters);

/**
 * Runs the {@link registerOnAllSceneExits} functions (the scene loader).
 * @internal
 */
export const runOnAllSceneExits = () => runListeners(onAllSceneExits);

/**
 * The gathered asset data that {@link _engine/kernel/init/InitEngine!InitEngine} was given as `data.json`: the
 * scenes by id, and in a development build each asset section by id too. Empty before
 * `InitEngine`.
 */
export const getGeneratedAppData = () => getAppData().json;
/** A scene's gathered data by id, or `undefined` for an id the gatherer didn't find. */
export const getGeneratedSceneData = (sceneId: string) =>
  getGeneratedAppData().scenes[sceneId] as SceneData | undefined;

/**
 * Registers (creates) the scenes of the gathered data. The boot calls it after the features have
 * installed, so each feature's `sceneRegistered` hook gets every scene with its data.
 * @internal
 */
export const registerScenesFromGeneratedData = () => {
  const { scenes } = getGeneratedAppData();
  const sceneIds = Object.keys(scenes);
  for (let i = 0; i < sceneIds.length; i++) {
    const sceneId = sceneIds[i];
    const sceneData = scenes[sceneId] as SceneData;

    createScene(sceneId, {
      backgroundColor: sceneData.backgroundColor,
      backgroundTexture: sceneData.backgroundTexture,
      name: sceneData.name,
      description: sceneData.description,
      postFx: sceneData.postFx,
      postFxEnabled: sceneData.postFxEnabled,
    });
    runSceneRegisteredHooks(sceneId, sceneData);
  }
};
