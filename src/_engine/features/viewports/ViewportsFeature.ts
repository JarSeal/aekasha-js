import type { EngineFeature } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { deleteSceneViewports, installViewports } from './Viewports';

/**
 * The viewports' part of a scene load: the viewports created for the exited scene (their
 * `sceneId`) go.
 * @internal
 */
export const viewportsSceneHooks: SceneHooks = {
  exit: (prevSceneId) => deleteSceneViewports(prevSceneId),
};

/**
 * The viewports feature: extra rectangles drawn over the finished frame, each with its own scene
 * and camera (picture-in-picture, minimaps, item previews), placed by the DOM. Without it,
 * `createViewport` throws, and the debug axes gizmo and environment ball are off.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { viewports } from 'aekasha/viewports';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [viewports()], start: async () => {} });
 * ```
 */
export const viewports = (): EngineFeature => ({
  id: 'viewports',
  install: (ctx) => {
    installViewports(ctx);
    ctx.addSceneHooks(viewportsSceneHooks);
  },
});
