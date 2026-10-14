import type { AppConfig } from '../config/Config';
import type { AppData } from '../scene/AppData';
import type { EngineFeature } from './Features';
// The page's styles (normalize, html, body) first, then the boot's, which imports the components'
// styles: a mounted engine (mountAekasha) imports the boot alone (p611 D6)
import '../../ui/styles/page.scss';
import { bootEngineAsync } from './Boot';
import { lerror } from '../../utils/Logger';

/** {@link InitEngine}'s options. */
export type InitEngineOptions = {
  /** The app's configuration, merged over the engine defaults per top-level key (the template
   * keeps it in `src/CONFIG.ts`). Default: the engine defaults only. */
  config?: AppConfig;
  /** The app's gathered scenes and assets: `appData` from `src/generated/`, which
   * `yarn gatherAppData` writes. */
  data: AppData;
  /** The features to install, in this order, after the kernel (p607 D1): each once, awaiting
   * each `install`. The engine installs nothing else on its own: each engine feature comes from
   * its entry (`physics()` from `aekasha/physics`, …), and one not listed isn't installed
   * (`createLines` throws without `lines()`, a scene's `postFx` is ignored without `postFx()`).
   * The template lists all nine and the app's own last (`appECSPlugins`); `[]` is the kernel
   * alone. */
  features: EngineFeature[];
  /** The app's start: creates the renderer and the scene loader and loads the first scene. Runs
   * after the engine's own init (and the debug tools' registration), before the main loop
   * starts. */
  start: () => Promise<void>;
};

/**
 * Initializes the engine with the app's configuration and data, then runs the app's `start`. Call
 * it once, first thing: it reads the environment (the env vars and the `?isDebug` / `?isProdTest`
 * URL params), so the `IS_*` flags read as production until it runs.
 * @example
 * ```ts
 * import { InitEngine, createRenderer, loadScene } from 'aekasha';
 * import config from './CONFIG';
 * import { character } from 'aekasha/character';
 * import { instancing } from 'aekasha/instancing';
 * import { lines } from 'aekasha/lines';
 * import { lod } from 'aekasha/lod';
 * import { physics } from 'aekasha/physics';
 * import { postFx } from 'aekasha/postfx';
 * import { skyBox } from 'aekasha/skybox';
 * import { spatial } from 'aekasha/spatial';
 * import { viewports } from 'aekasha/viewports';
 * import { appData } from './generated';
 * import { appECSPlugins } from './AppECSPlugins';
 *
 * InitEngine({
 *   config,
 *   data: appData,
 *   features: [
 *     physics(),
 *     character(),
 *     skyBox(),
 *     lod(),
 *     spatial(),
 *     instancing(),
 *     lines(),
 *     postFx(),
 *     viewports(),
 *     appECSPlugins,
 *   ],
 *   start: async () => {
 *     await createRenderer({ antialias: true });
 *     await loadScene({ sceneId: 'myScene' });
 *   },
 * });
 * ```
 */
export const InitEngine = (options: InitEngineOptions) =>
  // A promise's catch, not a try block: Rollup keeps everything inside a try block whole (its
  // `tryCatchDeoptimization`), so the debug blocks below and the app's `start` stayed in a
  // production build after `__AEK_DEBUG__` had folded their conditions
  bootEngineAsync(options).catch((err: unknown) => {
    const msg = 'Error at app start function (InitEngine)';
    lerror(msg, err);
    throw new Error(msg);
  });
