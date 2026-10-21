import { IS_DEBUG_ENV } from '../config/Config';
import { loadDebugModuleAsync, useDebug } from '../config/DebugModules';
import { getCurrentSceneId, getLoadingSceneId } from '../scene/Scene';

/**
 * Debug env only: binds `K` (individual meshes, a draw call each) and `L` (instances of one
 * InstancedMesh) to spawn `batchSize` hovering spheres each press, for measuring the ECS and the
 * renderer under load. With `targetId`, instanced spheres near that entity turn red. The keys work
 * in the scene that calls it (its scene code), and the spheres go with that scene. The ECS debug
 * tab's benchmark spawns and clears batches too.
 * @param batchSize the spheres spawned per key press
 * @param targetId the entity instanced spheres turn red near
 * @remarks The implementation loads in the background, so the keys are bound a moment after the
 * call, and not at all when the calling scene has been left by then. Outside the debug env (prod
 * test mode included) it does nothing, and a production build drops it.
 */
export const initECSStressTest = (batchSize: number = 100, targetId?: number) => {
  // Folds the whole call out of a production build
  if (!IS_DEBUG_ENV) return;
  // The scene calling it (its scene code runs while it loads): the keys work only there
  const sceneId = getLoadingSceneId() || getCurrentSceneId() || undefined;
  loadDebugModuleAsync(() => import('./debug/_dbg__ECSStressTest'))
    .then((ref) => {
      if (sceneId && getLoadingSceneId() !== sceneId && getCurrentSceneId() !== sceneId) return;
      useDebug(ref)?._initECSStressTest(batchSize, targetId, sceneId);
    })
    // The loader has logged it
    .catch(() => {});
};
