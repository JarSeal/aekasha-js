import type { EngineFeature } from '../../kernel/init/Features';
import { installRainOcclusion, rainOcclusionSceneHooks, stopRainOcclusion } from './RainOcclusion';
import { type RainOcclusionOpts, resolveRainOcclusionOpts } from './RainOcclusionModel';

// p307 T12
/**
 * The rain occlusion feature: a depth map rendered straight down around the active
 * camera, so a wet material with it (`getRainOcclusionNode`, the terrain material's
 * `wet.rainOcclusion: 'MAP'`) stays dry, unpuddled and unsnowed under roofs, trees and bridges.
 * Occluders are the objects that cast shadows, or those whose `userData.rainOccluder` says so
 * (`true` or `false` over `castShadow`). The map renders only once a material reads it: again
 * when the camera has moved an eighth of its extent, every `updateFrames` frames, and on
 * `requestRainOcclusionUpdate()`. Needs `surfaceConditions()` listed before it; list it right
 * after. Without it, `getRainOcclusionNode` returns null (a material falls back to the facing
 * alone), its setters throw, and a build leaves its code out.
 * @param opts the map's size, extent, height, update and bias
 * @returns the feature
 * @throws on an option out of its range
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { rainOcclusion, surfaceConditions } from 'aekasha/surface';
 * import { appData } from './generated';
 *
 * InitEngine({
 *   data: appData,
 *   features: [surfaceConditions(), rainOcclusion({ extent: 96 })],
 *   start: async () => {},
 * });
 * ```
 */
export const rainOcclusion = (opts?: RainOcclusionOpts): EngineFeature => {
  const resolved = resolveRainOcclusionOpts(opts);
  return {
    id: 'rainocclusion',
    requires: ['surfaceconditions'],
    install: (ctx) => {
      installRainOcclusion(ctx, resolved);
      ctx.addSceneHooks(rainOcclusionSceneHooks);
      ctx.onUnmount(stopRainOcclusion);
    },
  };
};
