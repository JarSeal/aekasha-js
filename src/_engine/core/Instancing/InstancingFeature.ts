import type { EngineFeature } from '../Features';
import { installInstancedMeshPools } from './InstancedMeshPool';

/**
 * The instancing feature: instanced mesh pools (`createInstancedMeshPool`,
 * `createInstancedLodPool`), many entities drawn by one `InstancedMesh` each. An instanced LOD
 * pool's levels need `lod()` too, and its `spatialDomain` option `spatial()`.
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
  },
});
