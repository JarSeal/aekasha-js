import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { EngineFeature } from '../../kernel/init/Features';
import {
  buildPostFxForScene,
  createPostFXDebugGUI,
  disposePostFx,
  getActivePostFxPipeline,
  installPostFx,
  loadScenePostFxFilesAsync,
  registerPostFxProfiler,
} from './PostFX';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';

/**
 * PostFX's part of a scene load: the previous scene's chain is disposed, and the next scene's is
 * set up from its options (`postFx`, `postFxEnabled`) once its code has run, after its passes'
 * files have loaded. The pipeline itself is built on the first frame that renders it.
 * @internal
 */
export const postFxSceneHooks: SceneHooks = {
  exit: () => disposePostFx(),
  created: async (sceneId) => {
    // The chain's files load on demand: the chain is known once the scene's code has run
    await loadScenePostFxFilesAsync(sceneId);
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
    // the context, so a production build would keep the profiler's loader without it
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
