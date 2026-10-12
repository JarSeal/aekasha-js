import type { ECSWorld } from './ECS';
import type { SceneData } from './Scene';

// The scene seams (p607 D4): a feature adds its part of a scene load through
// `FeatureContext.addSceneHooks`, and `loadScene` (SceneLoader.ts) runs each phase where the
// feature's calls used to be, so the order inside a load stays. App code keeps
// `registerOnAllSceneExits` / `registerOnAllSceneEnterings`.

/**
 * A feature's part of a scene load (`FeatureContext.addSceneHooks`), by phase, in the order
 * `loadScene` runs them. Each phase runs the features' hooks in install order, except `exit`,
 * which runs them in reverse (a dependent feature tears down first: characters before physics).
 * The awaited phases await each hook before the next. A hook that throws fails the load like any
 * other step of it.
 */
export type SceneHooks = {
  /** First thing after the loader's `loadStartFn`, before anything of the previous scene goes. */
  loadStart?: () => void;
  /** Tears down what the previous scene left (`prevSceneId`, undefined on the first load), before
   * the kernel deletes the groups, the scene loopers and the non-persistent entities. */
  exit?: (prevSceneId: string | undefined) => void;
  /** After the default world's non-persistent entities are gone, before anything of the next
   * scene exists. */
  worldCleared?: (
    world: ECSWorld,
    prevSceneId: string | undefined,
    nextSceneData: SceneData
  ) => void;
  /** After the next scene's cameras exist, before its assets load (imports can create entities).
   * Awaited. */
  beforeAssets?: () => void | Promise<void>;
  /** After the scene code has run and the scene is current, before its JSON objects are created.
   * Awaited. */
  created?: (sceneId: string) => void | Promise<void>;
  /** After the enter hooks, before the loader's `loadEndFn`: the scene is complete. Awaited. */
  entered?: () => void | Promise<void>;
  /** When the load has finished, failed or not: undo what `loadStart` did if `entered` didn't. */
  loadSettled?: () => void;
};

const sceneHooks: SceneHooks[] = [];

/**
 * Adds a feature's scene hooks (`FeatureContext.addSceneHooks`). Returns the remover.
 * @internal
 */
export const addSceneHooks = (hooks: SceneHooks) => {
  sceneHooks.push(hooks);
  return () => {
    const index = sceneHooks.indexOf(hooks);
    if (index !== -1) sceneHooks.splice(index, 1);
  };
};

/**
 * Runs the `loadStart` hooks.
 * @internal
 */
export const runSceneLoadStartHooks = () => {
  for (let i = 0; i < sceneHooks.length; i++) sceneHooks[i].loadStart?.();
};

/**
 * Runs the `exit` hooks, in reverse install order.
 * @internal
 */
export const runSceneExitHooks = (prevSceneId: string | undefined) => {
  for (let i = sceneHooks.length - 1; i >= 0; i--) sceneHooks[i].exit?.(prevSceneId);
};

/**
 * Runs the `worldCleared` hooks.
 * @internal
 */
export const runSceneWorldClearedHooks = (
  world: ECSWorld,
  prevSceneId: string | undefined,
  nextSceneData: SceneData
) => {
  for (let i = 0; i < sceneHooks.length; i++) {
    sceneHooks[i].worldCleared?.(world, prevSceneId, nextSceneData);
  }
};

/**
 * Runs the `beforeAssets` hooks, awaiting each.
 * @internal
 */
export const runSceneBeforeAssetsHooksAsync = async () => {
  for (const hooks of sceneHooks.slice()) {
    if (hooks.beforeAssets) await hooks.beforeAssets();
  }
};

/**
 * Runs the `created` hooks, awaiting each.
 * @internal
 */
export const runSceneCreatedHooksAsync = async (sceneId: string) => {
  for (const hooks of sceneHooks.slice()) {
    if (hooks.created) await hooks.created(sceneId);
  }
};

/**
 * Runs the `entered` hooks, awaiting each.
 * @internal
 */
export const runSceneEnteredHooksAsync = async () => {
  for (const hooks of sceneHooks.slice()) {
    if (hooks.entered) await hooks.entered();
  }
};

/**
 * Runs the `loadSettled` hooks.
 * @internal
 */
export const runSceneLoadSettledHooks = () => {
  for (let i = 0; i < sceneHooks.length; i++) sceneHooks[i].loadSettled?.();
};
