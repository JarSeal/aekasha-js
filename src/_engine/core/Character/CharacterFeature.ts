import {
  createCharactersDebuggerGUI,
  deleteAllCharacters,
  installCharacters,
  registerCharacterTools,
} from '../Character';
import type { EngineFeature } from '../Features';
import type { SceneHooks } from '../SceneHooks';

/**
 * Characters' part of a scene load: the previous scene's characters go before its physics
 * entities (the exit hooks run in reverse install order, and characters install after physics).
 * @internal
 */
export const characterSceneHooks: SceneHooks = {
  exit: () => deleteAllCharacters(),
};

/**
 * The character feature: characters (`createCharacter`, `createDynamicCharacter`), their
 * controllers' fixed-step system and their debug tools. Needs `physics()` listed before it.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { character } from 'aekasha/character';
 * import { physics } from 'aekasha/physics';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [physics(), character()], start: async () => {} });
 * ```
 */
export const character = (): EngineFeature => ({
  id: 'character',
  requires: ['physics'],
  install: (ctx) => {
    installCharacters(ctx);
    ctx.addSceneHooks(characterSceneHooks);
    ctx.onDebug(registerCharacterTools);
    ctx.onDebugAfterStart(createCharactersDebuggerGUI);
  },
});
