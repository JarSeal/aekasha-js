import type { EngineFeature } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import {
  applySceneSurfaceConditions,
  installSurfaceConditions,
  resetSurfaceConditionsForScene,
  type SurfaceTimeSource,
} from './SurfaceConditions';

/**
 * The surface conditions' part of the scenes' life: every scene starts from the defaults and its
 * own JSON `surfaceConditions`, with the surface clock at 0, so it looks the same on every visit.
 * Its values apply before its scene code runs, which can set its own.
 * @internal
 */
export const surfaceConditionsSceneHooks: SceneHooks = {
  exit: () => resetSurfaceConditionsForScene(),
  worldCleared: (_world, _prevSceneId, nextSceneData) => applySceneSurfaceConditions(nextSceneData),
};

/** Options of {@link surfaceConditions}. */
export type SurfaceConditionsFeatureOpts = {
  /** What the surface clock and the simulation run with: `'APP'` (default) stops with the app
   * loop's pause, `'MAIN'` only with the master loop's. */
  timeSource?: SurfaceTimeSource;
};

/**
 * The surface conditions feature (p307): one global state of wetness, rain, puddles, water level,
 * snow, temperature and wind that wet materials read through stable uniforms
 * (`getSurfaceConditionNodes`), simulated (rain wets, the sun and the wind dry, snow melts) or set
 * by the app. A scene's JSON `surfaceConditions` sets its starting values. Without it, the
 * getters return null, the setters throw, and a scene setting `surfaceConditions` fails the boot.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { skyBox } from 'aekasha/skybox';
 * import { surfaceConditions } from 'aekasha/surface';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [skyBox(), surfaceConditions()], start: async () => {} });
 * ```
 */
export const surfaceConditions = (opts?: SurfaceConditionsFeatureOpts): EngineFeature => ({
  id: 'surfaceconditions',
  install: (ctx) => {
    installSurfaceConditions(ctx, opts?.timeSource ?? 'APP');
    ctx.addSceneHooks(surfaceConditionsSceneHooks);
  },
});
