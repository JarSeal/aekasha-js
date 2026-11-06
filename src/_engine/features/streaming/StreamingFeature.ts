import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { EngineFeature } from '../../kernel/init/Features';
import { installStreaming, registerStreamingDebugGUI } from './Streaming';

/**
 * The streaming feature (p353): a scene larger than what fits in memory at once, cut into square
 * cells whose content is loaded, reduced or unloaded by its distance to a focus point (a scene's
 * `streaming` field, or `setSceneStreamingSettings`). Its budgets are `AppConfig.streaming`.
 * Without it, a scene with `streaming` fails the boot, and the streaming API throws.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { streaming } from 'aekasha/streaming';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [streaming()], start: async () => {} });
 * ```
 */
export const streaming = (): EngineFeature => ({
  id: 'streaming',
  install: (ctx) => {
    installStreaming(ctx);
    // Gated like every debug hook (the hooks run only in the debug env): a production build then
    // drops the call and the debug wrapper it names (verify:baselines fails on an ungated one)
    if (IS_DEBUG_ENV) ctx.onDebug(registerStreamingDebugGUI);
  },
});
