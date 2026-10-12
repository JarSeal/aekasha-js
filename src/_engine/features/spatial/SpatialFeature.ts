import { installLightObjectCulling } from './LightObjectCullingSystem';
import type { EngineFeature } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import {
  installSpatialIndex,
  registerSceneSpatialDomains,
  registerSpatialIndexDebugGUI,
  releaseSceneSpatialDomains,
} from './SpatialIndexSystem';

/**
 * The spatial index's part of a scene load: the previous scene's domain settings go and the next
 * scene's JSON domains (`spatialDomains`) are registered, between the two scenes' entities.
 * @internal
 */
export const spatialSceneHooks: SceneHooks = {
  worldCleared: (world, prevSceneId, nextSceneData) => {
    // After the delete, so a domain going back to its world settings re-inserts only the
    // persistent members, and before anything of the next scene joins a domain
    releaseSceneSpatialDomains(world, prevSceneId);
    // Before the next scene's assets, code and JSON objects join anything, so each grid is
    // created once, at the scene's own settings
    if (nextSceneData.spatialDomains?.length) {
      registerSceneSpatialDomains(world, nextSceneData.id, nextSceneData.spatialDomains);
    }
  },
};

/**
 * The spatial feature: the spatial index (named domains, each a grid of entities, which meshes and
 * point and spot lights join by default) and the light (contribution) culling that queries it.
 * Without it, nothing is indexed and no light is culled by contribution.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { spatial } from 'aekasha/spatial';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [spatial()], start: async () => {} });
 * ```
 */
export const spatial = (): EngineFeature => ({
  id: 'spatial',
  install: (ctx) => {
    installSpatialIndex(ctx);
    installLightObjectCulling(ctx);
    ctx.addSceneHooks(spatialSceneHooks);
    ctx.onDebug(registerSpatialIndexDebugGUI);
  },
});
