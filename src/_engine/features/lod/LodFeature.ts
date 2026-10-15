import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { EngineFeature } from '../../kernel/init/Features';
import { setAutoLodResolverLoader } from '../../kernel/mesh/Mesh';
import { lodImportExtension } from './LodImport';
import { installLodSystem, registerLodDebugGUI } from './LodSystem';

/**
 * The LOD feature: level-of-detail selection for entities with a `LOD` (a mesh's `lod` prop or
 * `setMeshLod`, and the instanced LOD pools), with budgets and cross-fades. Generating LOD chains
 * and impostors loads on first use. Without it, a mesh's `lod` does nothing, and an import reads no
 * prebuilt LOD chains and makes none (`lodChain`).
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
    // A file's prebuilt chains and an import's `lodChain`
    ctx.registerImportExtension(lodImportExtension);
    // A mesh's `lod: 'AUTO'`: its code loads on the first one
    setAutoLodResolverLoader(() =>
      import('./LodAuto').then(({ resolveAutoLod }) => resolveAutoLod)
    );
    // Gated like every debug hook (the hooks run only in the debug env): a production build then
    // drops the calls and the debug wrappers they name (verify:baselines fails on an ungated one)
    if (IS_DEBUG_ENV) ctx.onDebug(registerLodDebugGUI);
  },
});
