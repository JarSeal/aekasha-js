import type Rapier from '@dimforge/rapier3d-compat';

import type { EngineAPIType } from '../types/PhysicsBackendTypes';
import type { PhysicsEngine } from '../types/PhysicsConfigTypes';

/**
 * The physics backends by key (`AppConfig.physics.physicsEngine`): how each loads its package and
 * its {@link EngineAPIType}. A new backend adds its key to `PhysicsEngine` and its entry here.
 * @internal
 */
export const ENGINES: Record<
  PhysicsEngine,
  {
    /** Display name (eg. in the About dialog) */
    name: string;
    /** The engine's npm package, whose version package.json pins */
    packageName: string;
    /** Loads and initializes the engine's package (Rapier: its WASM), resolving with it. */
    init: () => Promise<unknown>;
    /** Types what init resolved with as the engine's module (a cast, nothing checked). */
    forceTypeEngine: (engineObj: unknown) => unknown;
    /** Loads the backend: only by `import()`, so the engine's package (Rapier: 829 kB gzip) is
     * in no chunk but the one that starts the simulation (p607) */
    loadEngineAPI: () => Promise<EngineAPIType>;
  }
> = {
  RAPIER: {
    name: 'Rapier',
    packageName: '@dimforge/rapier3d-compat',
    init: async () => {
      const mod = await import('@dimforge/rapier3d-compat');
      const RAPIER = mod.default;
      await RAPIER.init();
      return RAPIER as typeof Rapier;
    },
    forceTypeEngine: (engineObj: unknown) => engineObj as typeof Rapier,
    loadEngineAPI: () => import('./rapier/EngineRapier'),
  },
};
