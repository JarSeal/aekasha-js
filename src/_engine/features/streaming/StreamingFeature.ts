import type { EngineFeature } from '../../kernel/init/Features';

/**
 * The streaming feature (p353): a scene larger than what fits in memory at once, cut into square
 * cells whose content is loaded, reduced or unloaded by its distance to a focus point (a scene's
 * `streaming` field). Without it, a scene with `streaming` fails the boot.
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
  // p353 Phase 1 adds the cells' system and scene hooks here
  install: () => {},
});
