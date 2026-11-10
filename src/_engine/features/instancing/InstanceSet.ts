import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { decGeometryRef, incGeometryRef } from '../../kernel/assets/Geometry';
import { decMaterialRef, incMaterialRef } from '../../kernel/assets/Material';
import { isWebGPURenderer } from '../../kernel/render/Renderer';
import { getCurrentSceneId, getLoadingSceneId } from '../../kernel/scene/Scene';
import { registerGPUMemorySource } from '../../debug/GPUMemory';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { lwarn } from '../../utils/Logger';
import type { LodDef } from '../lod/LodTypes';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import type { InstancedLodPoolLevel } from './InstancedMeshPool';
import type { InstancePlacement } from './InstancedMeshPoolTypes';
import { createInstanceRanges, type InstanceRanges } from './InstanceRanges';
import type {
  CreateInstanceSetBackend,
  InstanceRange,
  InstanceSetBackend,
  InstanceSetBackendParams,
  InstanceSetStats,
} from './InstanceSetTypes';

// Instance sets (docs/plans/_DONE_p354_gpu-driven-culling.md): many instances as plain data, with
// no entity per instance, culled and LOD-selected per instance by a backend: the GPU one (compute
// culling and indirect draws, WebGPU) or the CPU one (WebGL2). This is the front, on the entry: the
// options' checks, the owning entity, the ranges (InstanceRanges.ts: the live ones and the free
// list) and the backend's `import()`, so a build that never creates a set ships only this, and a
// device downloads only its own backend. The backends' contract is InstanceSetTypes.ts.

/** The most instances a set holds: a visible list's entry packs the instance in 24 bits (D4). */
const MAX_INSTANCE_SET_INSTANCES = 1 << 24;
/** `maxVisible`'s default cap. */
const DEFAULT_MAX_VISIBLE = 65_536;
/** `maxSlots`' default (D6). */
const DEFAULT_MAX_SLOTS = 8;

/** Set by the `instancing()` feature's install: without it, deleting a set's entity frees nothing. */
let areInstanceSetsInstalled = false;
let hasWarnedNotInstalled = false;

/** The debug option forcing new sets onto the CPU backend on WebGPU too (the LOD tab's): read
 * only in the debug env, so a production build drops it. */
let isCpuBackendForced = false;

/** Each set's backend, for the debug readback (`_dbg__InstanceSet.ts`). */
const backendsBySet = new WeakMap<
  InstanceSet,
  {
    backend: InstanceSetBackend;
    isDisposed: () => boolean;
    label: string;
    levels: readonly InstancedLodPoolLevel[];
    ranges: InstanceRanges;
  }
>();
/** The live sets, for the LOD tab's list (the debug env only: production keeps none). */
const liveSets = new Set<InstanceSet>();

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
   * `fadeSeconds`), as an instanced LOD pool's: a level change and LOD culling cross-fade through
   * the LOD dither, which the set adds to its levels' materials (`enableLodDither`, as the pool
   * does). */
  lod?: Omit<LodDef, 'levels'>;
  /** Whether the instances receive shadows. Default true (casting is per level). */
  receiveShadow?: boolean;
  /** The most instances one camera draws per level: the GPU backend's visible lists are sized by
   * it, and what's past it isn't drawn that frame. Default: `maxInstances`, at most 65,536. */
  maxVisible?: number;
  /** The most cameras that draw the set at once (the view, a shadow, a viewport, the debug
   * camera): the GPU backend keeps a slot per camera, its visible lists sized for all of them
   * (`maxSlots` × levels × `maxVisible` × 4 bytes). A camera past it draws none of the set until
   * a slot frees (one unused for 120 frames). Default 8. */
  maxSlots?: number;
  /** Compiles the set's draws ahead of their first frame, once `object` is added to the root
   * scene (the engine's compile queue, as a pre-warmed mesh's), so the frame the set first shows in
   * doesn't stall on its shaders. The shadow pass compiles on its first frame, as a mesh's. Default
   * false. */
  preWarm?: boolean;
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
  /** What draws the set, chosen by the renderer: `'GPU'` on WebGPU, `'CPU'` on WebGL2 (and on
   * WebGPU with the LOD tab's debug option forcing it). */
  readonly backend: InstanceSetBackendKind;
  /** The most instances the set holds. */
  readonly maxInstances: number;
  /** The live instances: added and not removed. */
  readonly count: number;
  /**
   * Adds instances from placements (uniform scale) or from world matrices (16 floats each, column
   * major as three's `Matrix4.elements`, uniform scale: the vertex stage turns the normal with the
   * matrix's rotation). They're drawn from the next frame. They take the first removed range they
   * fit in, else go after the last ones. Returns their range, or `null` (and adds none) when they
   * don't fit in `maxInstances` (a removed range is reused only by an add of its size or smaller)
   * or once the set is disposed.
   */
  addInstances: (instances: InstancePlacement[] | Float32Array) => InstanceRange | null;
  /**
   * Removes a range `addInstances` returned: its instances aren't drawn from the next frame, and
   * a later add takes its indices again (a range can't be removed in part). Returns false (and
   * removes nothing) for a range that isn't live: removed already, another set's, or the set
   * disposed (a streamed cell unloading after its scene's switch).
   */
  removeInstances: (range: InstanceRange) => boolean;
  /**
   * Moves instances of a live range: writes `instances` (placements, or matrices as
   * `addInstances` takes them) over the range's instances from `offset` (default 0) on. They keep
   * their levels and cross-fades, and are drawn at their new places from the next frame. Writes in
   * a frame upload together before its first draw, adjacent ones as one range (on the GPU
   * backend), so moving instances one call each costs no more uploads than one call for them all.
   * A set is meant for static or rarely moving content: a sway or wind belongs in the material.
   * Returns false (and moves nothing) for a range that isn't live, or once the set is disposed.
   * @throws when the instances don't fit in the range from `offset`
   */
  setInstanceMatrices: (
    range: InstanceRange,
    instances: InstancePlacement[] | Float32Array,
    offset?: number
  ) => boolean;
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

const checkCount = (name: string, value: number) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`createInstanceSetAsync: ${name} (${value}) isn't a positive integer.`);
  }
  return value;
};

/** Checks the options as an instanced LOD pool does, plus the set's limits; returns `maxVisible`
 * and `maxSlots`. */
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
  checkCount('maxInstances', maxInstances);
  if (maxInstances > MAX_INSTANCE_SET_INSTANCES) {
    throw new Error(
      `createInstanceSetAsync: maxInstances (${maxInstances}) is over a set's ${MAX_INSTANCE_SET_INSTANCES} (2^24).`
    );
  }
  const maxVisible = checkCount(
    'maxVisible',
    opts.maxVisible ?? Math.min(maxInstances, DEFAULT_MAX_VISIBLE)
  );
  return {
    maxVisible: Math.min(maxVisible, maxInstances),
    maxSlots: checkCount('maxSlots', opts.maxSlots ?? DEFAULT_MAX_SLOTS),
  };
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

const loadBackendAsync = async (kind: InstanceSetBackendKind) =>
  kind === 'GPU'
    ? (await import('./InstanceSetGpu')).createGpuInstanceSetBackend
    : (await import('./InstanceSetCpu')).createCpuInstanceSetBackend;

/**
 * Creates an instance set (docs/plans/_DONE_p354_gpu-driven-culling.md): up to millions of
 * instances of an instanced LOD pool's levels as plain data, with no entity per instance. On
 * WebGPU, compute passes cull each instance against the camera and select its level by the LOD
 * rules (`LodDef`'s screen sizes, `hysteresis` and `cullScreenSize`, against the LOD selection's
 * camera), and each level and geometry group draws with one indirect draw: the CPU cost per frame
 * stays flat whatever the count. On WebGL2 (no compute) the CPU backend draws the same set with the
 * same rules: an `InstancedMesh` per level, the instances moved between them each frame without an
 * entity each, culled by three per level mesh as a whole.
 *
 * Use a set for static (or rarely moving) content past about 20k instances: forests, grass,
 * rocks. An instanced LOD pool stays the choice for fewer, and for instances gameplay addresses
 * (an entity each: transforms, ECS tags, raycasts, spatial domains). Instances come and go by
 * range: `addInstances` returns one, `removeInstances` frees it for a later add (a streamed cell's
 * content adds its range in its load and removes it in its unload, and one set serves every cell),
 * and `setInstanceMatrices` moves its instances (now and then: a sway belongs in the material).
 *
 * Every camera that renders a set (the view, a viewport, the debug camera, a snapshot) culls it
 * against its own frustum, up to `maxSlots` cameras at once, and draws the levels selected against
 * the LOD selection's camera; a shadow draws its casting levels (`castShadow` per level). The
 * levels need `lod()` for their selection: without it a set draws level 0.
 * @returns the set, or `null` when its world's scene exited while its backend loaded (the owning
 * entity was deleted): re-check after the `await`, as after any. It rejects on bad options (no
 * levels, `maxInstances` past 2^24, a bad `maxVisible` or `maxSlots`).
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
  const { maxVisible, maxSlots } = checkOptions(opts);
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
  const isGpu = isWebGPURenderer() && !(IS_DEBUG_ENV && isCpuBackendForced);
  const backend: InstanceSetBackendKind = isGpu ? 'GPU' : 'CPU';
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
    world,
    object,
    levels,
    lod: opts.lod ?? {},
    maxInstances,
    maxVisible,
    maxSlots,
    receiveShadow,
    preWarm: opts.preWarm === true,
    label,
  };
  const drawer = createBackend(params);

  const ranges = createInstanceRanges(maxInstances);
  // The GPU memory tab's row of the set's buffers (D11: three's `info.memory` knows them only as
  // storage or instance attributes), under the scene it was made for (a persistent set: the
  // engine's). `__AEK_DEBUG__` first: a production build folds it, and the GPU memory module with
  // it, out of the front (as Viewports.ts)
  const removeMemorySource = __AEK_DEBUG__
    ? registerGPUMemorySource({
        id: `instanceSet.${entityId}`,
        label: `Instance set "${label}" (${backend})`,
        owner: opts.entityOpts?.persistent
          ? undefined
          : getLoadingSceneId() ?? getCurrentSceneId() ?? undefined,
        getResources: drawer.debugMemory,
      })
    : null;
  let isDisposed = false;
  world.addComponent(entityId, ComponentType.INSTANCE_SET, {
    object,
    _dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      if (IS_DEBUG_ENV) liveSets.delete(set);
      removeMemorySource?.();
      object.removeFromParent();
      drawer.dispose();
      refLevels(levels, false);
    },
  });

  /** The instances' count, checked as whole matrices. */
  const countInstances = (instances: InstancePlacement[] | Float32Array, call: string) => {
    if (!(instances instanceof Float32Array)) return instances.length;
    if (instances.length % 16 !== 0) {
      throw new Error(
        `InstanceSet.${call}: ${instances.length} floats aren't whole matrices (16 floats each).`
      );
    }
    return instances.length / 16;
  };

  /** The instances as matrices; a non-uniform scale warns in the debug env (placements have
   * none). */
  const toMatrixArray = (instances: InstancePlacement[] | Float32Array, count: number) => {
    if (!(instances instanceof Float32Array)) return toMatrices(instances);
    if (IS_DEBUG_ENV) {
      const index = findNonUniformScale(instances, count);
      if (index >= 0) {
        lwarn(
          `Instance set "${label}": instance ${index} of the ${count} written has a non-uniform scale, which a set doesn't draw right (its normals).`
        );
      }
    }
    return instances;
  };

  const addInstances: InstanceSet['addInstances'] = (instances) => {
    if (isDisposed) return null;
    const added = countInstances(instances, 'addInstances');
    if (added === 0) return { start: ranges.end, count: 0 };
    const start = ranges.take(added);
    if (start < 0) {
      lwarn(
        `Instance set "${label}": no room for ${added} instances in its maxInstances (${maxInstances}): ${ranges.count} live, and no removed range that large.`
      );
      return null;
    }
    const matrices = toMatrixArray(instances, added);
    drawer.addInstances(start, matrices, added);
    drawer.setExtent(ranges.end);
    return { start, count: added };
  };

  const removeInstances: InstanceSet['removeInstances'] = ({ start, count }) => {
    if (isDisposed) return false;
    if (count === 0) return true;
    if (!ranges.release(start, count)) {
      lwarn(
        `Instance set "${label}": the range ${start}-${start + count - 1} isn't one of its live ranges (removed already, or another set's): nothing removed.`
      );
      return false;
    }
    drawer.removeInstances(start, count);
    drawer.setExtent(ranges.end);
    return true;
  };

  const setInstanceMatrices: InstanceSet['setInstanceMatrices'] = (
    range,
    instances,
    offset = 0
  ) => {
    if (isDisposed) return false;
    const written = countInstances(instances, 'setInstanceMatrices');
    if (!Number.isInteger(offset) || offset < 0 || offset + written > range.count) {
      throw new Error(
        `InstanceSet.setInstanceMatrices: ${written} instances from offset ${offset} don't fit in the range's ${range.count}.`
      );
    }
    if (!ranges.isLive(range.start, range.count)) {
      lwarn(
        `Instance set "${label}": the range ${range.start}-${range.start + range.count - 1} isn't one of its live ranges (removed, or another set's): nothing moved.`
      );
      return false;
    }
    if (written > 0) {
      drawer.writeInstances(range.start + offset, toMatrixArray(instances, written), written);
    }
    return true;
  };

  const set: InstanceSet = {
    object,
    entityId,
    backend,
    maxInstances,
    get count() {
      return ranges.count;
    },
    addInstances,
    removeInstances,
    setInstanceMatrices,
  };
  backendsBySet.set(set, {
    backend: drawer,
    isDisposed: () => isDisposed,
    label,
    levels,
    ranges,
  });
  if (IS_DEBUG_ENV) liveSets.add(set);
  return set;
};

/**
 * Forces the sets created from now on onto the CPU backend on WebGPU too (the debug env only, the
 * LOD tab's option), to compare both backends on one device; sets already created keep theirs.
 * @internal
 */
export const setInstanceSetCpuBackendForced = (value: boolean) => {
  isCpuBackendForced = value;
};

/**
 * Whether the sets created from now on are forced onto the CPU backend (the debug option).
 * @internal
 */
export const isInstanceSetCpuBackendForced = () => isCpuBackendForced;

/**
 * The sets not disposed yet, for the debug tools (the debug env only: empty elsewhere).
 * @internal
 */
export const getLiveInstanceSets = (): ReadonlySet<InstanceSet> => liveSets;

/**
 * A set's label (its owning entity's app id, or its entity id), levels and ranges, for the debug
 * tools; undefined for a set this module didn't make.
 * @internal
 */
export const getInstanceSetDebugInfo = (set: InstanceSet) => {
  const entry = backendsBySet.get(set);
  return entry && { label: entry.label, levels: entry.levels, ranges: entry.ranges };
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
 * Reads back what each camera drawing a set drew in its last dispatch, per level (the main
 * camera's as `drawn` and `overflow`, every camera's in `slots`), and with `state: true` every
 * instance's selected level counted: a GPU readback, for the debug tools and measuring scenes. On
 * the CPU backend `drawn` is each level mesh's copies (three culls a level mesh as a whole, for
 * every camera), `slots` is empty and nothing overflows. The debug env and prod test mode only;
 * `null` elsewhere and for a disposed set.
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

/** Lists the sets in the LOD tab: the `instancing()` feature's `onDebug` hook. */
const registerInstanceSetDebugAsync = async () => {
  const ref = await loadDebugModuleAsync(() => import('./debug/_dbg__InstanceSet'));
  useDebug(ref)?._registerInstanceSetDebugSource();
};

const disposeInstanceSet = (entityId: number, world: ECSWorld) => {
  world.getComponent(entityId, ComponentType.INSTANCE_SET)?._dispose();
};

/**
 * Installs the instance sets (the `instancing()` feature's install): deleting a set's entity, or
 * removing its `INSTANCE_SET`, disposes the set; in the debug env the LOD tab lists them.
 * @internal
 */
export const installInstanceSets = (ctx: FeatureContext) => {
  areInstanceSetsInstalled = true;
  ctx.registerComponentHooks(ComponentType.INSTANCE_SET, {
    onRemoveComponent: disposeInstanceSet,
    onDeleteEntity: disposeInstanceSet,
  });
  // Gated like every debug hook: a production build drops the call and the loader
  if (IS_DEBUG_ENV) ctx.onDebug(registerInstanceSetDebugAsync);
};
