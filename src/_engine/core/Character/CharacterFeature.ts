import { deleteAllCharacters } from '../Character';
import type { SceneHooks } from '../SceneHooks';

/**
 * Characters' part of a scene load: the previous scene's characters go before its physics
 * entities (the exit hooks run in reverse install order, and characters install after physics).
 * @internal
 */
export const characterSceneHooks: SceneHooks = {
  exit: () => deleteAllCharacters(),
};
