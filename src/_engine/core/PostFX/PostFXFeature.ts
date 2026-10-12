import { registerPostFxProfiler } from '../../debug/PostFXProfiler';
import { IS_DEBUG_ENV } from '../Config';
import type { EngineFeature } from '../Features';
import {
  buildPostFxForScene,
  createPostFXDebugGUI,
  disposePostFx,
  getActivePostFxPipeline,
  installPostFx,
} from '../PostFX';
import type { SceneHooks } from '../SceneHooks';

/**
 * PostFX's part of a scene load: the previous scene's chain is disposed, and the next scene's is
 * set up from its options (`postFx`, `postFxEnabled`) once its code has run. The pipeline itself
 * is built on the first frame that renders it.
 * @internal
 */
export const postFxSceneHooks: SceneHooks = {
  exit: () => disposePostFx(),
  created: (sceneId) => {
    buildPostFxForScene(sceneId);
  },
};

/**
 * The PostFX feature: each scene's chain of PostFX passes (a `*.postFx.json` and its TSL file
 * each, listed in the scene's `postFx`), rendered through a TSL `RenderPipeline` instead of a
 * direct render while it's on. Without it, scenes render directly and their `postFx` is ignored.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { postFx } from 'aekasha/postfx';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [postFx()], start: async () => {} });
 * ```
 */
export const postFx = (): EngineFeature => ({
  id: 'postfx',
  install: (ctx) => {
    installPostFx(ctx);
    ctx.setRenderPipeline(getActivePostFxPipeline);
    ctx.addSceneHooks(postFxSceneHooks);
    // The flag here too (the hooks run only in the debug env): Rollup keeps a closure handed to
    // the context, so a production build would keep the profiler's debug wrapper without it
    if (IS_DEBUG_ENV) {
      ctx.onDebugAfterStart(async () => {
        // Measuring needs the renderer
        await registerPostFxProfiler();
        // After the profiler: the tab re-applies a persisted measuring override
        await createPostFXDebugGUI();
      });
    }
  },
});
