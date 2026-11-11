import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { EngineFeature } from '../../kernel/init/Features';
import { installMergeGroups, registerMergeDebug } from './MergeGroups';
import { createSceneMergeMaterialsAsync } from './MergeMaterialLoad';

/**
 * The merging feature: mesh entities that share a material drawn as one merged mesh (a merge
 * group), each member staying an entity with its own transform, physics body and data, and the
 * merge materials of the palettes a scene lists (`mergeMaterials`). Building a large group loads
 * the merge code on first use, a scene's first palette the merge material's. Without it, an app
 * can't create merge groups.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { merging } from 'aekasha/merging';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [merging()], start: async () => {} });
 * ```
 */
export const merging = (): EngineFeature => ({
  id: 'merging',
  install: (ctx) => {
    installMergeGroups(ctx);
    // A listed palette's merge material, before the scene code (p374)
    ctx.addSceneHooks({ assetsLoaded: createSceneMergeMaterialsAsync });
    // The moved-member check; gated like every debug hook, so a production build drops the call
    // and the wrapper it names (verify:baselines fails on an ungated one)
    if (IS_DEBUG_ENV) ctx.onDebug(registerMergeDebug);
  },
});
