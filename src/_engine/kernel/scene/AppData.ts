import type { LoadSceneProps } from './SceneLoader';

/**
 * The gathered asset data (`src/generated/generatedAppData.json`): the scenes by id, and in a
 * development build each asset section by id too (`cameras`, `materials`, `postFx`, …).
 */
export type GeneratedAppJson = { scenes: Record<string, unknown>; [section: string]: unknown };

/**
 * The app's gathered data, which `yarn gatherAppData` writes to `src/generated/` and the app hands
 * to {@link _engine/kernel/init/InitEngine!InitEngine} as `data`. Its keys are filled by code the gatherer
 * generates; an app never writes them by hand.
 */
export type AppData = {
  /** The gathered asset data */
  json: GeneratedAppJson;
  /** Each scene's code by scene id (a scene JSON's `sceneFile`), loaded on demand */
  sceneFiles: Record<string, NonNullable<LoadSceneProps['nextSceneFn']>>;
  /** Each TSL material file's module (its node functions by socket) by material id (a material
   * JSON's `tslFile`), loaded on demand: a scene load loads its materials' files */
  tslMaterialFiles: Record<string, () => Promise<Record<string, unknown>>>;
  /** Each PostFX pass file's module (its `fxNode`) by pass id (a PostFX JSON's `tslFile`), loaded
   * on demand: the PostFX feature loads a scene's chain's files before it builds the chain */
  postFxFiles: Record<string, () => Promise<Record<string, unknown>>>;
};

// Empty until InitEngine: a module that reads it at load sees no scenes
let appData: AppData = {
  json: { scenes: {} },
  sceneFiles: {},
  tslMaterialFiles: {},
  postFxFiles: {},
};

/**
 * Sets the app's data: {@link _engine/kernel/init/InitEngine!InitEngine} calls it with its `data` before the
 * scenes are registered.
 * @internal
 */
export const setAppData = (data: AppData) => {
  appData = data;
};

/**
 * The app's data that {@link _engine/kernel/init/InitEngine!InitEngine} was given (empty before it). Apps read
 * the asset data through `getGeneratedAppData` and `getGeneratedSceneData`.
 * @internal
 */
export const getAppData = () => appData;
