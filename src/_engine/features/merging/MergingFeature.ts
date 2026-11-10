import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { EngineFeature } from '../../kernel/init/Features';
import { installMergeGroups, registerMergeDebug } from './MergeGroups';

/**
 * The merging feature: mesh entities that share a material drawn as one merged mesh (a merge
 * group), each member staying an entity with its own transform, physics body and data. Building
 * a large group loads the merge code on first use. Without it, an app can't create merge groups.
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
    // The moved-member check; gated like every debug hook, so a production build drops the call
    // and the wrapper it names (verify:baselines fails on an ungated one)
    if (IS_DEBUG_ENV) ctx.onDebug(registerMergeDebug);
  },
});
