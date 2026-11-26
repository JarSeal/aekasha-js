import type { EngineFeature } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { applySceneFogs, clearFogForScene, installFog } from './Fog';

/**
 * The fog's part of the scenes' life: a scene's exit clears its fog, and the next scene's
 * default fog (its JSON `fogs`) shows before its scene code runs, so its materials build with it.
 * @internal
 */
export const fogSceneHooks: SceneHooks = {
  exit: () => clearFogForScene(),
  worldCleared: (_world, _prevSceneId, nextSceneData) => applySceneFogs(nextSceneData),
};

/**
 * The fog feature (p106): one fog per scene, `LINEAR`, `EXP2` or `HEIGHT`, its colour the sky's
 * horizon by default, switched on and off as a whole without a recompile. A scene's JSON `fogs`
 * lists its fogs (`*.fog.json` ids or inline ones). Without the feature, the getters return null,
 * the setters throw, and a scene listing `fogs` fails the boot.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { fog } from 'aekasha/fog';
 * import { skyBox } from 'aekasha/skybox';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [skyBox(), fog()], start: async () => {} });
 * ```
 */
export const fog = (): EngineFeature => ({
  id: 'fog',
  install: (ctx) => {
    installFog(ctx);
    ctx.addSceneHooks(fogSceneHooks);
  },
});
