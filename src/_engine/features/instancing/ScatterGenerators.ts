import type { ECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import type { ScatterItemDef } from './ScatterSchema';

/**
 * The scatters' install state, which their API reads.
 * @internal
 */
export const scatterState = {
  /** `instancing()` was installed */
  isInstalled: false,
  /** Counts the scene exits: a spawn whose count changed while it awaited was left behind */
  sceneVisit: 0,
};

/**
 * Installs the scatters (`instancing()`'s install): their registry and the scene exit count.
 * @internal
 */
export const installScatters = (ctx: FeatureContext) => {
  scatterState.isInstalled = true;
  // A spawn that awaits across a scene exit deletes what it made
  ctx.addSceneHooks({
    exit: () => {
      scatterState.sceneVisit++;
    },
  });
};

/**
 * Throws naming `instancing()` when it isn't installed (its scatter API without its feature says
 * so).
 * @internal
 */
export const assertScattersInstalled = (caller: string) => {
  if (scatterState.isInstalled) return;
  throw new Error(
    `${caller}: the instancing feature isn't installed. List instancing() from 'aekasha/instancing' in InitEngine's features.`
  );
};

/** Where a scatter spawns: what `PLACEMENTS` are relative to and a generator places on. */
export type ScatterTarget = {
  /** The target's centre (a terrain block's). `PLACEMENTS` are relative to it. Default: the
   * origin. */
  position?: { x: number; y: number; z: number };
  /** The target's grid place, combined into the seed (p301 §7), so every block gets its own
   * placements. Default: `(0, 0)`. */
  grid?: { x: number; z: number };
  /** The side of the target's square, centred on `position`, in metres (a terrain block's size).
   * A generator places in it. */
  size?: number;
  /** The surface's entity (a terrain block's mesh), for a generator that reads it. */
  entityId?: number;
};

/** What a scatter generator gets. */
export type ScatterGeneratorInput = {
  /** The scatter's id */
  scatterId: string;
  /** The scatter source's `params`, unchecked (the generator checks them) */
  params: Record<string, unknown>;
  /** The source's seed combined with the world seed, the target's grid place and the scatter's
   * id: draw every number from it (eg. `createSeededRandom(seed)`), never from a named stream,
   * so a block's scatter never depends on load order */
  seed: number;
  /** The scatter's items, their defaults filled in */
  items: readonly ScatterItemDef[];
  /** Where it spawns, its position and grid filled in */
  target: ScatterTarget & Required<Pick<ScatterTarget, 'position' | 'grid'>>;
  /** The world it spawns in */
  world: ECSWorld;
};

/** What a scatter generator returns. */
export type ScatterGeneratorResult = {
  /** The instances in world space: 16 floats a matrix (column major, three's `Matrix4.elements`) */
  matrices: Float32Array;
  /** Each instance's item, an index in `items`. Default: picked by the items' weights. */
  items?: Uint8Array;
  /** A colour per instance (linear RGB, 3 floats each), which multiplies the material's colour */
  colors?: Float32Array;
};

/**
 * A scatter generator: what a `*.scatter.json`'s `"source": { "type": "PROCEDURAL", "generator":
 * id, … }` runs when the scatter spawns. May be async (a worker's).
 */
export type ScatterGenerator = (
  input: ScatterGeneratorInput
) => ScatterGeneratorResult | Promise<ScatterGeneratorResult>;

const generators = new Map<string, ScatterGenerator>();

/**
 * Registers a scatter generator under an id, which a `*.scatter.json`'s `source.generator` names.
 * Register from an install (an app's `appECSPlugins`, a feature's), never at module load.
 * @param generator places a scatter's instances from its params, seed, items and target
 * @throws when `instancing()` isn't installed, or another generator has the id
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { createSeededRandom } from 'aekasha';
 * import { registerScatterGenerator } from 'aekasha/instancing';
 *
 * // Uniform on the target's square, at its height
 * registerScatterGenerator('uniformScatter', ({ params, seed, target }) => {
 *   const random = createSeededRandom(seed);
 *   const count = Number(params.count ?? 100);
 *   const size = target.size ?? 10;
 *   const matrices = new Float32Array(count * 16);
 *   const matrix = new THREE.Matrix4();
 *   for (let i = 0; i < count; i++) {
 *     const x = target.position.x + (random() - 0.5) * size;
 *     const z = target.position.z + (random() - 0.5) * size;
 *     matrix.makeTranslation(x, target.position.y, z).toArray(matrices, i * 16);
 *   }
 *   return { matrices };
 * });
 * ```
 */
export const registerScatterGenerator = (id: string, generator: ScatterGenerator) => {
  assertScattersInstalled('registerScatterGenerator');
  if (generators.has(id)) {
    throw new Error(`registerScatterGenerator: a generator has the id "${id}" already.`);
  }
  generators.set(id, generator);
};

/**
 * Removes a scatter generator.
 * @returns whether one had the id
 */
export const unregisterScatterGenerator = (id: string) => generators.delete(id);

/**
 * A registered scatter generator.
 * @returns the generator, or undefined when none has the id
 */
export const getScatterGenerator = (id: string): ScatterGenerator | undefined => generators.get(id);

/**
 * The registered scatter generators' ids, for the errors naming them.
 * @internal
 */
export const getScatterGeneratorIds = () => [...generators.keys()];
