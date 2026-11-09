import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { decGeometryRef, incGeometryRef } from '../../kernel/assets/Geometry';
import { decMaterialRef, incMaterialRef } from '../../kernel/assets/Material';
import { isWebGPURenderer } from '../../kernel/render/Renderer';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { lwarn } from '../../utils/Logger';
import type { LodDef } from '../lod/LodTypes';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import type { InstancedLodPoolLevel } from './InstancedMeshPool';
import type { InstancePlacement } from './InstancedMeshPoolTypes';
import type {
  CreateInstanceSetBackend,
  InstanceRange,
  InstanceSetBackend,
  InstanceSetBackendParams,
  InstanceSetStats,
} from './InstanceSetTypes';

// Instance sets (docs/plans/p354_gpu-driven-culling.md): many instances as plain data, with no
// entity per instance, culled and LOD-selected per instance by a backend: the GPU one (compute
// culling and indirect draws, WebGPU) or the CPU one (WebGL2, Phase 4). This is the front, on the
// entry: the options' checks, the owning entity, the ranges and the backend's `import()`, so a
// build that never creates a set ships only this, and a device downloads only its own backend.
// The backends' contract is InstanceSetTypes.ts.

/** The most instances a set holds: a visible list's entry packs the instance in 24 bits (D4). */
const MAX_INSTANCE_SET_INSTANCES = 1 << 24;
/** `maxVisible`'s default cap. */
const DEFAULT_MAX_VISIBLE = 65_536;

/** Set by the `instancing()` feature's install: without it, deleting a set's entity frees nothing. */
let areInstanceSetsInstalled = false;
let hasWarnedNotInstalled = false;
let hasWarnedNoCompute = false;

/** Each set's backend, for the debug readback (`_dbg__InstanceSet.ts`). */
const backendsBySet = new WeakMap<
  InstanceSet,
  { backend: InstanceSetBackend; isDisposed: () => boolean }
>();

/** What draws a set: compute culling and indirect draws (WebGPU), or the CPU (WebGL2). */
export type InstanceSetBackendKind = 'GPU' | 'CPU';

/** What {@link createInstanceSetAsync} takes: an instanced LOD pool's options, for plain data. */
export interface CreateInstanceSetOptions {
  /** The set's world: it holds the set's owning entity, so a scene switch clears the set like the
   * rest of the scene's content. */
  world: ECSWorld;
  /** Level 0 (the finest) first, `screenSize` descending: the instanced LOD pool's levels. Each
   * level's geometry groups draw with its material array, like a mesh's. A set with one level and
   * no `cullScreenSize` is a frustum-culled instanced mesh. */
  levels: InstancedLodPoolLevel[];
  /** The most instances the set holds, sized once: at most 2^24 (16,777,216). */
  maxInstances: number;
  /** The selection settings every instance shares (`cullScreenSize`, `hysteresis`, `bias`,
   * `fadeSeconds`), as an instanced LOD pool's. A set draws without cross-fades for now: a level
   * change is instant whatever `fadeSeconds` says (p354 Phase 2 adds the fades). */
  lod?: Omit<LodDef, 'levels'>;
  /** Whether the instances receive shadows. Default true (casting is per level). */
  receiveShadow?: boolean;
  /** The most instances one camera draws per level: the GPU backend's visible lists are sized by
   * it, and what's past it isn't drawn that frame. Default: `maxInstances`, at most 65,536. */
  maxVisible?: number;
  /** The owning entity's options (eg. `persistent` for a set that outlives the scene). */
  entityOpts?: CoreEntityOpts;
}

/** What {@link createInstanceSetAsync} returns: the set's draws, its owning entity and its
 * instances. */
export interface InstanceSet {
  /** The set's draws. Add it directly under the root scene: the instances are placed in world
   * space. It has no bounds and no raycast; the backend culls each instance itself. */
  readonly object: THREE.Group;
  /** The owning entity: deleting it (or the scene switch that deletes it) disposes the set: its
   * draws, its buffers and its registry refs on the levels' geometries and materials. */
  readonly entityId: number;
  /** What draws the set, chosen by the renderer: `'GPU'` on WebGPU, `'CPU'` on WebGL2. */
  readonly backend: InstanceSetBackendKind;
  /** The most instances the set holds. */
  readonly maxInstances: number;
  /** Instances added so far. */
  readonly count: number;
  /**
   * Adds instances after the last ones, from placements (uniform scale) or from world matrices
   * (16 floats each, column major as three's `Matrix4.elements`, uniform scale: the vertex stage
   * turns the normal with the matrix's rotation). They're drawn from the next frame. Returns
   * their range, or `null` (and adds none) past `maxInstances` or once the set is disposed.
   */
  addInstances: (instances: InstancePlacement[] | Float32Array) => InstanceRange | null;
}

const refLevels = (levels: readonly InstancedLodPoolLevel[], isInc: boolean) => {
  for (const { geometry, material } of levels) {
    const geoId = geometry.userData.id as string | undefined;
    if (geoId) (isInc ? incGeometryRef : decGeometryRef)(geoId);
    for (const m of Array.isArray(material) ? material : [material]) {
      const matId = m.userData.id as string | undefined;
      if (matId) (isInc ? incMaterialRef : decMaterialRef)(matId);
    }
  }
};

/** Checks the options as an instanced LOD pool does, plus the set's limits; returns `maxVisible`. */
const checkOptions = (opts: CreateInstanceSetOptions) => {
  const { levels, maxInstances } = opts;
  if (levels.length === 0) throw new Error('createInstanceSetAsync: no levels.');
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].screenSize >= levels[i - 1].screenSize) {
      lwarn(
        `createInstanceSetAsync: level ${i}'s screenSize (${levels[i].screenSize}) isn't below level ${i - 1}'s (${levels[i - 1].screenSize}). Levels go from level 0 down, screenSize descending.`
      );
    }
  }
  if (!Number.isInteger(maxInstances) || maxInstances < 1) {
    throw new Error(
      `createInstanceSetAsync: maxInstances (${maxInstances}) isn't a positive integer.`
    );
  }
  if (maxInstances > MAX_INSTANCE_SET_INSTANCES) {
    throw new Error(
      `createInstanceSetAsync: maxInstances (${maxInstances}) is over a set's ${MAX_INSTANCE_SET_INSTANCES} (2^24).`
    );
  }
  const maxVisible = opts.maxVisible ?? Math.min(maxInstances, DEFAULT_MAX_VISIBLE);
  if (!Number.isInteger(maxVisible) || maxVisible < 1) {
    throw new Error(`createInstanceSetAsync: maxVisible (${maxVisible}) isn't a positive integer.`);
  }
  return Math.min(maxVisible, maxInstances);
};

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();

const toMatrices = (placements: InstancePlacement[]) => {
  const matrices = new Float32Array(placements.length * 16);
  for (let i = 0; i < placements.length; i++) {
    const { position, quaternion, scale } = placements[i];
    _matrix.compose(position, quaternion, _scale.setScalar(scale)).toArray(matrices, i * 16);
  }
  return matrices;
};

/** The first instance whose matrix scales its axes differently, -1 when none does (debug). */
const findNonUniformScale = (matrices: Float32Array, count: number) => {
  for (let i = 0; i < count; i++) {
    const m = i * 16;
    const x = matrices[m] ** 2 + matrices[m + 1] ** 2 + matrices[m + 2] ** 2;
    const y = matrices[m + 4] ** 2 + matrices[m + 5] ** 2 + matrices[m + 6] ** 2;
    const z = matrices[m + 8] ** 2 + matrices[m + 9] ** 2 + matrices[m + 10] ** 2;
    const largest = Math.max(x, y, z);
    if (largest - Math.min(x, y, z) > largest * 1e-4) return i;
  }
  return -1;
};

/** A backend that draws nothing: a set on WebGL2 until the CPU backend lands. */
// TODO(docs/plans/p354_gpu-driven-culling.md Phase 4): the CPU backend, InstanceSetCpu.ts
const createEmptyBackend: CreateInstanceSetBackend = ({ label }) => {
  if (!hasWarnedNoCompute) {
    hasWarnedNoCompute = true;
    lwarn(
      `Instance set "${label}": this renderer has no compute (WebGL2), and the CPU backend isn't built yet: the set draws nothing.`
    );
  }
  return { writeInstances: () => {}, dispose: () => {} };
};

const loadBackendAsync = async (kind: InstanceSetBackendKind) =>
  kind === 'GPU'
    ? (await import('./InstanceSetGpu')).createGpuInstanceSetBackend
    : createEmptyBackend;

/**
 * Creates an instance set (docs/plans/p354_gpu-driven-culling.md): up to millions of instances of
 * an instanced LOD pool's levels as plain data, with no entity per instance. On WebGPU, compute
 * passes cull each instance against the camera and select its level by the LOD rules
 * (`LodDef`'s screen sizes, `hysteresis` and `cullScreenSize`, against the LOD selection's camera),
 * and each level and geometry group draws with one indirect draw: the CPU cost per frame stays flat
 * whatever the count.
 *
 * Use a set for static (or rarely moving) content past about 20k instances: forests, grass,
 * rocks. An instanced LOD pool stays the choice for fewer, and for instances gameplay addresses
 * (an entity each: transforms, ECS tags, raycasts, spatial domains).
 *
 * Only the main camera draws a set for now (a shadow or another view draws none of it). The levels
 * need `lod()` for their selection: without it a set draws level 0.
 * @returns the set, or `null` when its world's scene exited while its backend loaded (the owning
 * entity was deleted): re-check after the `await`, as after any. It rejects on bad options (no
 * levels, `maxInstances` past 2^24, a bad `maxVisible`).
 * @example
 * ```ts
 * import { getECSWorld, getRootScene } from 'aekasha';
 * import { createInstanceSetAsync } from 'aekasha/instancing';
 *
 * const set = await createInstanceSetAsync({
 *   world: getECSWorld(),
 *   levels: [
 *     { geometry: treeHigh, material: [trunkMat, leafMat], screenSize: 0.08 },
 *     { geometry: treeLow, material: [trunkMat, leafMat], screenSize: 0 },
 *   ],
 *   maxInstances: 200_000,
 *   lod: { cullScreenSize: 0.006 },
 * });
 * // null: the scene exited while the set's backend loaded
 * if (set) {
 *   getRootScene()?.add(set.object);
 *   set.addInstances(placements);
 * }
 * ```
 */
export const createInstanceSetAsync = async (
  opts: CreateInstanceSetOptions
): Promise<InstanceSet | null> => {
  const maxVisible = checkOptions(opts);
  const { world, levels, maxInstances, receiveShadow = true } = opts;
  if (!areInstanceSetsInstalled && !hasWarnedNotInstalled) {
    hasWarnedNotInstalled = true;
    lwarn(
      "createInstanceSetAsync: the instancing() feature isn't in InitEngine's `features`: deleting a set's entity won't free it."
    );
  }

  // The owning entity first: a scene exit while the backend loads deletes it, which the check
  // after the import sees
  const entityId = world.createEntity(opts.entityOpts);
  // createEntity leaves it to the creators (as createLineEntity)
  if (opts.entityOpts?.persistent) world.addComponent(entityId, ComponentType.PERSISTENT, true);
  const backend: InstanceSetBackendKind = isWebGPURenderer() ? 'GPU' : 'CPU';
  let createBackend: CreateInstanceSetBackend;
  try {
    createBackend = await loadBackendAsync(backend);
  } catch (error) {
    if (world.isAlive(entityId)) world.deleteEntity(entityId);
    throw error;
  }
  if (!world.isAlive(entityId)) return null;

  const object = new THREE.Group();
  const label = opts.entityOpts?.appId ?? `entity ${entityId}`;
  object.name = `instanceSet ${label}`;
  refLevels(levels, true);
  const params: InstanceSetBackendParams = {
    object,
    levels,
    lod: opts.lod ?? {},
    maxInstances,
    maxVisible,
    receiveShadow,
    label,
  };
  const drawer = createBackend(params);

  let count = 0;
  let isDisposed = false;
  world.addComponent(entityId, ComponentType.INSTANCE_SET, {
    object,
    _dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      object.removeFromParent();
      drawer.dispose();
      refLevels(levels, false);
    },
  });

  const addInstances: InstanceSet['addInstances'] = (instances) => {
    if (isDisposed) return null;
    const isMatrices = instances instanceof Float32Array;
    if (isMatrices && instances.length % 16 !== 0) {
      throw new Error(
        `InstanceSet.addInstances: ${instances.length} floats aren't whole matrices (16 floats each).`
      );
    }
    const added = isMatrices ? instances.length / 16 : instances.length;
    if (count + added > maxInstances) {
      lwarn(
        `Instance set "${label}": maxInstances (${maxInstances}) reached, ${added} instances not added (${count} in the set).`
      );
      return null;
    }
    const matrices = isMatrices ? instances : toMatrices(instances);
    if (IS_DEBUG_ENV && isMatrices) {
      const index = findNonUniformScale(matrices, added);
      if (index >= 0) {
        lwarn(
          `Instance set "${label}": instance ${index} of the ${added} added has a non-uniform scale, which a set doesn't draw right (its normals).`
        );
      }
    }
    const range: InstanceRange = { start: count, count: added };
    if (added > 0) drawer.writeInstances(count, matrices, added);
    count += added;
    return range;
  };

  const set: InstanceSet = {
    object,
    entityId,
    backend,
    maxInstances,
    get count() {
      return count;
    },
    addInstances,
  };
  backendsBySet.set(set, { backend: drawer, isDisposed: () => isDisposed });
  return set;
};

/**
 * A set's backend, for the debug readback; undefined once the set is disposed.
 * @internal
 */
export const getInstanceSetBackend = (set: InstanceSet) => {
  const entry = backendsBySet.get(set);
  return entry && !entry.isDisposed() ? entry.backend : undefined;
};

/**
 * Reads back what a set drew in its last dispatch (the main camera's), per level, and with
 * `state: true` every instance's selected level counted: a GPU readback, for the debug tools and
 * measuring scenes. The debug env and prod test mode only; `null` elsewhere, for a set on the CPU
 * backend, and for a disposed one.
 * @param set a set `createInstanceSetAsync` made
 * @param opts `state`: also read the whole state buffer (4 bytes per instance)
 * @returns the counts, read after the GPU's queued work
 * @example
 * ```ts
 * import { readInstanceSetStatsAsync } from 'aekasha/instancing';
 *
 * const stats = await readInstanceSetStatsAsync(set, { state: true });
 * if (stats) console.log(`drawn per level: ${stats.drawn.join(' / ')}`);
 * ```
 */
export const readInstanceSetStatsAsync = async (
  set: InstanceSet,
  opts?: { state?: boolean }
): Promise<InstanceSetStats | null> => {
  const ref = await loadDebugModuleAsync(
    () => import('./debug/_dbg__InstanceSet'),
    true,
    'Instance set readback'
  );
  return (await useDebug(ref, true)?._readInstanceSetStatsAsync(set, opts)) ?? null;
};

const disposeInstanceSet = (entityId: number, world: ECSWorld) => {
  world.getComponent(entityId, ComponentType.INSTANCE_SET)?._dispose();
};

/**
 * Installs the instance sets (the `instancing()` feature's install): deleting a set's entity, or
 * removing its `INSTANCE_SET`, disposes the set.
 * @internal
 */
export const installInstanceSets = (ctx: FeatureContext) => {
  areInstanceSetsInstalled = true;
  ctx.registerComponentHooks(ComponentType.INSTANCE_SET, {
    onRemoveComponent: disposeInstanceSet,
    onDeleteEntity: disposeInstanceSet,
  });
};
