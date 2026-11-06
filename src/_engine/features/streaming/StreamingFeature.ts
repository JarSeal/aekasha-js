import type { EngineFeature } from '../../kernel/init/Features';
import { installStreaming } from './Streaming';

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
  install: (ctx) => installStreaming(ctx),
});
