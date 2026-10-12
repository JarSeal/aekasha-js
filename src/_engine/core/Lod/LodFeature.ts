import type { EngineFeature } from '../Features';
import { installLodSystem, registerLodDebugGUI } from './LodSystem';

/**
 * The LOD feature: level-of-detail selection for entities with a `LOD` (a mesh's `lod` prop or
 * `setMeshLod`, and the instanced LOD pools), with budgets and cross-fades. Generating LOD chains
 * and impostors loads on first use. Without it, a mesh's `lod` does nothing.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { lod } from 'aekasha/lod';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [lod()], start: async () => {} });
 * ```
 */
export const lod = (): EngineFeature => ({
  id: 'lod',
  install: (ctx) => {
    installLodSystem(ctx);
    ctx.onDebug(registerLodDebugGUI);
  },
});
