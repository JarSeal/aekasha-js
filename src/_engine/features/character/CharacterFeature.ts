import {
  createCharactersDebuggerGUI,
  deleteAllCharacters,
  installCharacters,
  registerCharacterTools,
} from './Character';
import { registerControllerKind } from './ActorKinds';
import { registerPlayerBrains } from './brains/PlayerBrains';
import type { EngineFeature } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';

/**
 * Characters' part of a scene load: the previous scene's characters go before its physics
 * entities (the exit hooks run in reverse install order, and characters install after physics).
 * @internal
 */
export const characterSceneHooks: SceneHooks = {
  exit: () => deleteAllCharacters(),
};

/**
 * The character feature: characters (`createCharacter`, `createDynamicCharacter`), their brains'
 * and controllers' fixed-step systems, the `DYNAMIC_CHARACTER` controller kind, the player brain
 * kinds (`TANK`, `WORLD_FIXED`, `CAMERA_RELATIVE`) and their debug tools. Needs `physics()` listed
 * before it.
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
    // Loaded on the first use: the controller stays with the scenes that make characters
    registerControllerKind('DYNAMIC_CHARACTER', async ({ id, name, visual, params, brain }) => {
      const { createDynamicCharacter } = await import('./DynamicCharacter');
      const { character } = await createDynamicCharacter({ id, name, visual, brain, ...params });
      return character;
    });
    registerPlayerBrains();
    ctx.addSceneHooks(characterSceneHooks);
    ctx.onDebug(registerCharacterTools);
    ctx.onDebugAfterStart(createCharactersDebuggerGUI);
  },
});
