import type { EngineFeature } from '../../kernel/init/Features';
import { installInstancedMeshPools } from './InstancedMeshPool';
import { installInstanceSets } from './InstanceSet';
import { installScatters } from './ScatterGenerators';

/**
 * The instancing feature: instanced mesh pools (`createInstancedMeshPool`,
 * `createInstancedLodPool`), many entities drawn by one `InstancedMesh` each, instance sets
 * (`createInstanceSetAsync`), many instances as plain data, culled and LOD-selected per instance,
 * static instances (`createStaticInstances`, `createInstancedMeshEntity`), cells of instances
 * that never move, one entity per cell, and scatters (`*.scatter.json`, `spawnScatter`), static
 * instances placed by a registered generator or a list.
 * An instanced LOD pool's and an instance set's levels need `lod()` too, and a pool's
 * `spatialDomain` option `spatial()`.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { instancing } from 'aekasha/instancing';
 * import { lod } from 'aekasha/lod';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [lod(), instancing()], start: async () => {} });
 * ```
 */
export const instancing = (): EngineFeature => ({
  id: 'instancing',
  install: (ctx) => {
    installInstancedMeshPools(ctx);
    installInstanceSets(ctx);
    installScatters(ctx);
  },
});
