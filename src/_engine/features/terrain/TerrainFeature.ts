import type { EngineFeature } from '../../kernel/init/Features';
import { terrainState } from './TerrainState';

/**
 * The terrain feature (p306 D2): terrain blocks, `*.terrainBlock.json` assets that tie a block's
 * geometry (imported, or made by a registered generator), its terrain material and per-block
 * inputs and its collider together, spawned from scene code. A block's collider needs `physics()`
 * listed before it (a block with `collider: { type: 'NONE' }` doesn't); its code loads with the
 * first block that has one. Without it, a scene listing blocks fails the boot.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { physics } from 'aekasha/physics';
 * import { terrain } from 'aekasha/terrain';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [physics(), terrain()], start: async () => {} });
 * ```
 */
export const terrain = (): EngineFeature => ({
  id: 'terrain',
  install: (ctx) => {
    terrainState.isInstalled = true;
    // Optional: only a block with a collider needs it (the gather's manifest names physics then)
    terrainState.hasPhysics = ctx.isInstalled('physics');
    // A spawn that awaits across a scene exit deletes what it made (its entities go with the
    // scene's anyway, but not one made after the exit)
    ctx.addSceneHooks({
      exit: () => {
        terrainState.sceneVisit++;
      },
    });
  },
});
