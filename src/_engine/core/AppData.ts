import type { LoadSceneProps } from './SceneLoader';

/**
 * The gathered asset data (`src/generated/generatedAppData.json`): the scenes by id, and in a
 * development build each asset section by id too (`cameras`, `materials`, `postFx`, …).
 */
export type GeneratedAppJson = { scenes: Record<string, unknown>; [section: string]: unknown };

/**
 * The app's gathered data, which `yarn gatherAppData` writes to `src/generated/` and the app hands
 * to {@link InitEngine} as `data`. Its keys are filled by code the gatherer generates; an app never
 * writes them by hand.
 */
export type AppData = {
  /** The gathered asset data */
  json: GeneratedAppJson;
  /** Each scene's code by scene id (a scene JSON's `sceneFile`), loaded on demand */
  sceneFiles: Record<string, NonNullable<LoadSceneProps['nextSceneFn']>>;
  /** Each TSL material file's node exports by material id (a material JSON's `tslFile`) */
  tslMaterialFiles: Record<string, Record<string, unknown>>;
  /** Each PostFX pass file's exports by pass id (a PostFX JSON's `tslFile`) */
  postFxFiles: Record<string, Record<string, unknown>>;
};

// Empty until InitEngine: a module that reads it at load sees no scenes
let appData: AppData = {
  json: { scenes: {} },
  sceneFiles: {},
  tslMaterialFiles: {},
  postFxFiles: {},
};

/**
 * Sets the app's data: {@link InitEngine} calls it with its `data` before the scenes are
 * registered.
 * @internal
 */
export const setAppData = (data: AppData) => {
  appData = data;
};

/**
 * The app's data that {@link InitEngine} was given (empty before it). Apps read the asset data
 * through `getGeneratedAppData` and `getGeneratedSceneData`.
 * @internal
 */
export const getAppData = () => appData;
