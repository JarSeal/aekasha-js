import type { EngineFeature } from '../../kernel/init/Features';
import { disposeNonPersistentLines, installLines } from './Lines';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';

/**
 * The lines' part of a scene load: the previous scene's lines go, except the `persistent` ones and
 * those an entity owns (they go with their entity).
 * @internal
 */
export const linesSceneHooks: SceneHooks = {
  exit: () => disposeNonPersistentLines(),
};

/**
 * The lines feature: line segments drawn 1px or thick (`createLines`, `createLineEntity`), with
 * pulses and dashes, refillable every frame without allocating. Without it, `createLines` throws,
 * and the engine's debug drawing (ray helpers, collider wireframes, the LOD and spatial overlays,
 * the character gizmos) is off.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { lines } from 'aekasha/lines';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [lines()], start: async () => {} });
 * ```
 */
export const lines = (): EngineFeature => ({
  id: 'lines',
  install: (ctx) => {
    installLines(ctx);
    ctx.addSceneHooks(linesSceneHooks);
  },
});
