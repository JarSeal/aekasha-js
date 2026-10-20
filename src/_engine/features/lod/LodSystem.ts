import * as THREE from 'three/webgpu';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { IComponentStorage } from '../../kernel/ecs/ECSComponentStorage';
import { reconcileObject3DVisibility } from '../../kernel/ecs/ECSCoreSystems';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import {
  decGeometryRef,
  getConservativeGeometryRadius,
  getGeometryRegistry,
  incGeometryRef,
} from '../../kernel/assets/Geometry';
import { getLodTargets } from '../../kernel/ecs/LodTargets';
import { decMaterialRef, getMaterialRegistry, incMaterialRef } from '../../kernel/assets/Material';
import { preWarmMesh } from '../../kernel/mesh/Mesh';
import { lwarn } from '../../utils/Logger';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { getInstancedLodBounds } from './LodBounds';
import { enableLodDither } from '../../kernel/render/LodFade';
import {
  applyLevelTo,
  createStandIn,
  drawFade,
  endFade,
  getLodMesh,
  prepareChange,
  removeLodCulledInstantly,
  setCulledTo,
  setMeshFade,
  setMeshLevel,
  startFade,
} from './LodFades';
import {
  type CameraTerms,
  computeCameraTerms,
  getLodSelectionCamera,
  getScreenSize,
  measureEntity,
  type StorageOf,
} from './LodMeasure';
import {
  getLodDebugOptions,
  getLodFadeSeconds,
  getLodMaxSelectionsPerFrame,
  getWritableLodFrameStats,
  type LodFrameStats,
} from './LodSettings';
import type { LodData, LodResolvedLevel } from './LodTypes';

/** A component type's hooks, as `FeatureContext.registerComponentHooks` takes them. */
type ComponentHooks = Parameters<FeatureContext['registerComponentHooks']>[1];

// Debug
type LodDebugModule = typeof import('./debug/_dbg__LOD');
let debugGUI: DebugModuleRef<LodDebugModule> | null = null;

/**
 * Loads and builds the LOD debug tab: the `lod()` feature's `onDebug` hook.
 * @internal
 */
export const registerLodDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__LOD'));
  useDebug(debugGUI)?._createLodDebugGUI();
};

// LOD selection and apply (docs/plans/_DONE_p348_ecs-lod-selection.md). `LOD` is the opt-in definition
// and the selected/applied level; TAG_LOD_CULLED is the runtime state "beyond the last level",
// a fourth cull reason next to DISABLED, TAG_FRUSTUM_CULLED and TAG_OBJECT_CULLED.
//
// Refs: the mesh always holds one ref on the geometry and material it shows (the apply moves it
// with setMeshGeometry/setMeshMaterial), and the LOD component one on every level's. So a level's
// assets live as long as the component, and deleting the entity releases them in any hook order.
//
// An entity without a plain mesh (an instanced LOD pool's instance) gets its levels from a LodTarget
// registered for one of its components, which then applies them and handles LOD culling.
//
// An InstancedMesh entity (a static instance cell, §4.3) is a plain mesh whose swap changes every
// instance: its bounds are level 0 over all its instances (LodBounds.ts), not one instance.
//
// The settings are in LodSettings.ts, the measuring in LodMeasure.ts, the cross-fades in
// LodFades.ts; this module has the hooks, the selection, apply and fade systems and the install.

/** A definition's `hysteresis` when it has none. */
export const DEFAULT_LOD_HYSTERESIS = 0.1;

const lodCulledHooks: ComponentHooks = {
  onAddComponent: (entityId, world) => {
    reconcileObject3DVisibility(entityId, world, { isLodCulled: true });
    const lod = world.getComponent(entityId, ComponentType.LOD);
    if (!lod) return;
    const fade = prepareChange(entityId, world, lod);
    setCulledTo(entityId, world, lod, true, fade);
    if (fade) startFade(entityId, world, lod, lod.applied);
  },
  onRemoveComponent: (entityId, world) => {
    reconcileObject3DVisibility(entityId, world, { isLodCulled: false });
    const lod = world.getComponent(entityId, ComponentType.LOD);
    if (!lod) return;
    // Shown for the first time too when it was culled at its first selection (nothing of it drawn)
    const fade = prepareChange(entityId, world, lod, true);
    if (fade && lod.level >= 0 && lod.level !== lod.applied) {
      // Not drawn yet, so the swap shows nothing: it fades in in the selected level, not in the
      // one it was hidden in (which would then fade into the selected one)
      applyLevelTo(entityId, world, lod, lod.level, false);
      lod.applied = lod.level;
    }
    setCulledTo(entityId, world, lod, false, fade);
    if (fade) startFade(entityId, world, lod, -1);
  },
};

// A plain mesh fading out to LOD culled stays visible until its fade ends
const lodTransitioningHooks: ComponentHooks = {
  onAddComponent: (entityId, world) => {
    reconcileObject3DVisibility(entityId, world, { isLodTransitioning: true });
  },
  onRemoveComponent: (entityId, world) => {
    reconcileObject3DVisibility(entityId, world, { isLodTransitioning: false });
  },
};

// --- TARGETS ---
// Registered with registerLodTarget (kernel/ecs/LodTargets.ts, the kernel's registry)

/** Sets the entity's levels from the first target that has them. False when none does. */
const resolveTargetLevels = (entityId: number, world: ECSWorld, lod: LodData) => {
  for (const { componentType, target } of getLodTargets()) {
    if (!world.hasComponent(entityId, componentType)) continue;
    const levels = target.resolveLevels(entityId, world, lod);
    if (!levels || levels.length === 0) continue;
    lod._levels = levels;
    lod._target = target;
    lod.radius = getConservativeGeometryRadius(levels[0].geometry);
    return true;
  }
  return false;
};

// --- SELECTION BUDGET ---

/** Per world: entities to select in the next frame whatever the budget (see
 * setLodMaxSelectionsPerFrame). Filled only while there is a cap. */
const prioritySelections = new WeakMap<ECSWorld, number[]>();

const queuePrioritySelection = (entityId: number, world: ECSWorld) => {
  if (getLodMaxSelectionsPerFrame() === Infinity) return;
  if (!world.hasComponent(entityId, ComponentType.LOD)) return;
  let queue = prioritySelections.get(world);
  if (!queue) {
    queue = [];
    prioritySelections.set(world, queue);
  }
  queue.push(entityId);
};

/** Per world: where the capped walk stopped. The `LOD` storage is always a Map, whose iterators
 * stay valid across frames (deleted entries are skipped, new ones visited). */
type SelectionCursor = {
  storage: IComponentStorage<LodData>;
  iter: IterableIterator<[number, LodData]>;
  /** Frames since the current lap started. */
  lapFrames: number;
};

const selectionCursors = new WeakMap<ECSWorld, SelectionCursor>();

// --- LEVELS AND REFS ---

const forEachMaterial = (
  material: THREE.Material | THREE.Material[],
  fn: (m: THREE.Material) => void
) => {
  if (Array.isArray(material)) material.forEach(fn);
  else fn(material);
};

const refLevel = (level: LodResolvedLevel, isInc: boolean) => {
  const geoId = level.geometry.userData.id as string | undefined;
  if (geoId) (isInc ? incGeometryRef : decGeometryRef)(geoId);
  forEachMaterial(level.material, (m) => {
    const matId = m.userData.id as string | undefined;
    if (matId) (isInc ? incMaterialRef : decMaterialRef)(matId);
  });
};

/** Resolves `def.levels` against the registries. Omitted assets and `castShadow` come from the
 * previous level, level 0's from the mesh. A missing id warns and keeps the previous level's. */
const resolveLevels = (mesh: THREE.Mesh, lod: LodData): LodResolvedLevel[] => {
  const levels = lod.def.levels;
  const label = mesh.userData.id || mesh.uuid;
  if (IS_DEBUG_ENV) {
    for (let i = 1; i < levels.length; i++) {
      if (levels[i].screenSize < levels[i - 1].screenSize) continue;
      lwarn(
        `[LOD] Mesh "${label}": level ${i}'s screenSize (${levels[i].screenSize}) isn't below level ${i - 1}'s (${levels[i - 1].screenSize}). Levels go from level 0 down, screenSize descending.`
      );
    }
  }

  const geometries = getGeometryRegistry();
  const materials = getMaterialRegistry();
  let prev: LodResolvedLevel = {
    geometry: mesh.geometry,
    material: mesh.material,
    castShadow: mesh.castShadow,
  };
  const resolved: LodResolvedLevel[] = [];
  for (let i = 0; i < levels.length; i++) {
    const def = levels[i];
    let geometry = prev.geometry;
    if (def.geo !== undefined) {
      const entry = geometries[def.geo];
      if (entry) geometry = entry.resource;
      else lwarn(`[LOD] Mesh "${label}", level ${i}: no registered geometry "${def.geo}".`);
    }
    let material = prev.material;
    if (def.mat !== undefined) {
      const entry = materials[def.mat];
      if (entry) material = entry.resource;
      else lwarn(`[LOD] Mesh "${label}", level ${i}: no registered material "${def.mat}".`);
    }
    prev = { geometry, material, castShadow: def.castShadow ?? prev.castShadow };
    resolved.push(prev);
  }
  return resolved;
};

/** Pre-warms the levels the mesh doesn't already show (createMeshEntity pre-warmed that one), or
 * every level with `includeOwn` (its material changed since: enableLodDither). */
const preWarmLevels = (mesh: THREE.Mesh, levels: LodResolvedLevel[], includeOwn: boolean) => {
  const label = mesh.userData.id || 'mesh';
  const warmed: LodResolvedLevel[] = includeOwn
    ? []
    : [{ geometry: mesh.geometry, material: mesh.material, castShadow: mesh.castShadow }];
  for (const level of levels) {
    const isWarmed = warmed.some(
      (w) =>
        w.geometry === level.geometry &&
        w.material === level.material &&
        w.castShadow === level.castShadow
    );
    if (isWarmed) continue;
    warmed.push(level);
    preWarmMesh(createStandIn(mesh, level), label);
  }
};

/** Sets the LOD's radius (and an InstancedMesh's centre) from level 0. */
const setMeshLodBounds = (mesh: THREE.Mesh, lod: LodData) => {
  const geometry = lod._levels[0].geometry;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const bounds = getInstancedLodBounds(mesh as THREE.InstancedMesh, geometry);
    lod.radius = bounds.radius;
    lod._center = bounds.center;
  } else {
    lod.radius = getConservativeGeometryRadius(geometry);
    lod._center = undefined;
  }
};

/**
 * Re-reads an `InstancedMesh` entity's LOD bounds (eg. a static instance cell's) after its instance
 * matrices or `count` changed: they are level 0 at every instance, read when the LOD was added. An
 * `AUTO` LOD's thresholds were computed from the bounds then: after a large change, set the LOD
 * again. A no-op for other entities (their bounds are level 0's geometry) and without a LOD.
 * @param entityId the mesh entity
 * @param ecsWorld the entity's world (default: the default world)
 * @example
 * ```ts
 * import { refreshLodBounds } from 'aekasha/lod';
 *
 * // A static instance cell got more instances: its LOD measures all of them again
 * cell.count = placements.length;
 * cell.instanceMatrix.needsUpdate = true;
 * refreshLodBounds(cellEntityId);
 * ```
 */
export const refreshLodBounds = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  const lod = world.getComponent(entityId, ComponentType.LOD);
  const mesh = getLodMesh(entityId, world);
  if (!lod || lod._target || lod._levels.length === 0) return;
  if (!(mesh as THREE.InstancedMesh | undefined)?.isInstancedMesh) return;
  setMeshLodBounds(mesh as THREE.Mesh, lod);
};

const lodHooks: ComponentHooks = {
  onAddComponent: (entityId, world) => {
    const lod = world.getComponent(entityId, ComponentType.LOD);
    if (!lod) return;
    lod.level = -1;
    lod.applied = -1;
    lod._levels = [];
    lod._target = undefined;
    lod._center = undefined;
    const mesh = getLodMesh(entityId, world);
    if (!mesh) {
      if (resolveTargetLevels(entityId, world, lod)) {
        queuePrioritySelection(entityId, world);
        return;
      }
      lwarn(`[LOD] Entity ${entityId} has no mesh: its LOD does nothing.`);
      return;
    }
    if (lod.def.levels.length === 0) {
      lwarn(`[LOD] Mesh "${mesh.userData.id || mesh.uuid}" has a LOD without levels.`);
      return;
    }
    lod._levels = resolveLevels(mesh, lod);
    setMeshLodBounds(mesh, lod);
    for (const level of lod._levels) refLevel(level, true);
    // Cross-fades dither the level materials (LodFade.ts). A LOD that never fades leaves them be;
    // without its own fadeSeconds, the global one can turn fades on later.
    let isDitherNew = false;
    if (lod.def.fadeSeconds !== 0) {
      for (const level of lod._levels) isDitherNew = enableLodDither(level.material) || isDitherNew;
    }
    if (mesh.userData.preWarm) preWarmLevels(mesh, lod._levels, isDitherNew);
    queuePrioritySelection(entityId, world);
  },
  // The entity stays: back to level 0 and visible, then release the levels (the mesh took its
  // own ref on level 0's assets first).
  onRemoveComponent: (entityId, world) => {
    const lod = world.getComponent(entityId, ComponentType.LOD);
    if (!lod) return;
    endFade(entityId, world, lod);
    if (world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)) {
      removeLodCulledInstantly(entityId, world);
    }
    const target = lod._target;
    if (target) {
      if (lod.applied > 0) target.applyLevel(entityId, world, 0, false);
      lod._target = undefined;
      lod._levels = [];
      return;
    }
    const mesh = getLodMesh(entityId, world);
    const level0 = lod._levels[0];
    if (mesh && level0 && lod.applied > 0) setMeshLevel(mesh, level0);
    for (const level of lod._levels) refLevel(level, false);
    lod._levels = [];
  },
  onDeleteEntity: (entityId, world) => {
    const lod = world.getComponent(entityId, ComponentType.LOD);
    if (!lod) return;
    if (!lod._target) {
      // A running fade's copy is disposed (TAG_LOD_TRANSITIONING goes with the entity)
      setMeshFade(lod, 1);
      for (const level of lod._levels) refLevel(level, false);
    }
    lod._levels = [];
    lod._target = undefined;
  },
};

// --- SELECTION ---

/**
 * The level for screen size `s`, coming from level `current` (-1 = first selection). The finest
 * level whose screenSize `s` reaches (below all of them, the last level). A move to a finer level
 * happens at its screenSize; a move to a coarser one only once `s` is below the current level's
 * screenSize × (1 - hysteresis). Exported for its test.
 * @internal
 */
export const selectLevel = (
  levels: LodData['def']['levels'],
  s: number,
  current: number,
  h: number
) => {
  const last = levels.length - 1;
  let raw = last;
  for (let i = 0; i < last; i++) {
    if (s >= levels[i].screenSize) {
      raw = i;
      break;
    }
  }
  if (current < 0 || raw <= current) return raw;
  const f = 1 - h;
  for (let i = current; i < last; i++) {
    if (s >= levels[i].screenSize * f) return i;
  }
  return last;
};

/** Per world: entities whose selected level differs from the applied one, for lodApplySystem. */
const pendingApplies = new WeakMap<ECSWorld, number[]>();

/** The frame's camera terms. */
const _terms: CameraTerms = { k: 0, isOrtho: false, position: new THREE.Vector3() };
const _objPos = new THREE.Vector3();

// The frame's inputs to selectEntity, read once per frame: a world.hasComponent / getComponent per
// entity looks the storage up again every time, which dominated the loop for a few thousand pool
// instances (docs/plans/_DONE_p348_ecs-lod-selection.md, Phase 3 step 4)
type SelectionFrame = {
  disabled: StorageOf<(typeof ComponentType)['DISABLED']>;
  frustumCulled: StorageOf<(typeof ComponentType)['TAG_FRUSTUM_CULLED']>;
  lodCulled: StorageOf<(typeof ComponentType)['TAG_LOD_CULLED']>;
  object3Ds: StorageOf<(typeof ComponentType)['OBJECT3D']>;
  transforms: StorageOf<(typeof ComponentType)['TRANSFORM']>;
  /** -1 = not forced. */
  forceLevel: number;
  pending: number[];
};

/** Selects one entity's level. False when it was skipped (no levels, disabled, out of view). */
const selectEntity = (entityId: number, lod: LodData, world: ECSWorld, frame: SelectionFrame) => {
  const levels = lod.def.levels;
  if (lod._levels.length === 0) return false;
  if (frame.disabled.has(entityId) || frame.frustumCulled.has(entityId)) return false;

  // The level is set before TAG_LOD_CULLED goes: its remove hook shows the entity in that level
  const isCulled = frame.lodCulled.has(entityId);
  if (frame.forceLevel >= 0) {
    lod.level = Math.min(frame.forceLevel, levels.length - 1);
    if (isCulled) world.removeComponent(entityId, ComponentType.TAG_LOD_CULLED);
    if (lod.level !== lod.applied) frame.pending.push(entityId);
    return true;
  }

  const maxScale = measureEntity(entityId, lod, frame.object3Ds, frame.transforms, _objPos);
  if (maxScale < 0) return true;
  const s = getScreenSize(_objPos, lod.radius * maxScale, _terms) * (lod.def.bias ?? 1);

  const h = lod.def.hysteresis ?? DEFAULT_LOD_HYSTERESIS;
  const cull = lod.def.cullScreenSize ?? 0;
  if (cull > 0 && s < (isCulled ? cull : cull * (1 - h))) {
    // Hidden: the level holds (no swap while nothing shows it)
    if (!isCulled) world.addComponent(entityId, ComponentType.TAG_LOD_CULLED, true);
    return true;
  }
  // Coming back from culled, it comes from beyond the last level
  lod.level = selectLevel(levels, s, isCulled ? levels.length - 1 : lod.level, h);
  if (isCulled) world.removeComponent(entityId, ComponentType.TAG_LOD_CULLED);
  if (lod.level !== lod.applied) frame.pending.push(entityId);
  return true;
};

const _frame: SelectionFrame = {
  disabled: new Map(),
  frustumCulled: new Map(),
  lodCulled: new Map(),
  object3Ds: new Map(),
  transforms: new Map(),
  forceLevel: -1,
  pending: [],
};

/** Walks the storage from where the last frame stopped until `budget` entities were selected or
 * every entity was visited once. Returns the selections. */
const walkCapped = (
  storage: IComponentStorage<LodData>,
  budget: number,
  world: ECSWorld,
  frame: SelectionFrame,
  stats: LodFrameStats
) => {
  let cursor = selectionCursors.get(world);
  if (!cursor || cursor.storage !== storage) {
    cursor = { storage, iter: storage.entries(), lapFrames: 0 };
    selectionCursors.set(world, cursor);
  }
  cursor.lapFrames++;
  const size = storage.size;
  let selections = 0;
  for (let walked = 0; walked < size && selections < budget; walked++) {
    let next = cursor.iter.next();
    if (next.done) {
      // Done at this frame's first step: the lap ended with the last frame
      stats.lapFrames = walked === 0 ? Math.max(cursor.lapFrames - 1, 1) : cursor.lapFrames;
      cursor.lapFrames = 1;
      cursor.iter = storage.entries();
      next = cursor.iter.next();
      if (next.done) break;
    }
    if (selectEntity(next.value[0], next.value[1], world, frame)) selections++;
  }
  return selections;
};

/**
 * Selects a level per `LOD` entity from its projected screen size (bounding-sphere diameter /
 * viewport height, × its `def.bias` × the global bias), with hysteresis, and adds or removes
 * TAG_LOD_CULLED. Uses the main camera, like frustum culling. Skips DISABLED and frustum-culled
 * entities, which keep their level: frustum culling runs first, so an entity re-entering the
 * view gets a fresh level in the same frame.
 * {@link _engine/features/lod/LodSettings!setLodDebugOptions} can freeze or force the levels, or
 * select against the active camera.
 * {@link _engine/features/lod/LodSettings!setLodMaxSelectionsPerFrame} caps the entities
 * reconsidered per frame (a forced level ignores the cap).
 * Registered by the feature's install.
 * @internal
 */
export const lodSelectionSystem = (world: ECSWorld) => {
  const stats = getWritableLodFrameStats(world);
  stats.selections = 0;
  stats.selectionMs = 0;

  const queue = prioritySelections.get(world);
  const storage = world.getStorage(ComponentType.LOD);
  const debugOptions = getLodDebugOptions();
  const forceLevel = debugOptions.forceLevel;
  const isForced = forceLevel >= 0;
  const camera =
    isForced || storage.size === 0 || debugOptions.freeze ? undefined : getLodSelectionCamera();
  if (!isForced && (!camera || !computeCameraTerms(camera, _terms))) {
    // Nothing to select: a queued entity is reconsidered by the walk later, like any other
    if (queue) queue.length = 0;
    stats.lapFrames = 1;
    return;
  }
  const start = IS_DEBUG_ENV ? performance.now() : 0;

  let pending = pendingApplies.get(world);
  if (!pending) {
    pending = [];
    pendingApplies.set(world, pending);
  }
  pending.length = 0;

  const frame = _frame;
  frame.disabled = world.getStorage(ComponentType.DISABLED);
  frame.frustumCulled = world.getStorage(ComponentType.TAG_FRUSTUM_CULLED);
  frame.lodCulled = world.getStorage(ComponentType.TAG_LOD_CULLED);
  frame.object3Ds = world.getStorage(ComponentType.OBJECT3D);
  frame.transforms = world.getStorage(ComponentType.TRANSFORM);
  frame.forceLevel = forceLevel;
  frame.pending = pending;

  let selections = 0;
  const budget = isForced ? Infinity : getLodMaxSelectionsPerFrame();
  if (budget === Infinity) {
    if (queue) queue.length = 0;
    for (const [entityId, lod] of storage) {
      if (selectEntity(entityId, lod, world, frame)) selections++;
    }
    stats.lapFrames = 1;
  } else {
    // Entities new in view first, whatever the budget, then the walk with what's left. One the
    // walk visits again this frame gets the same level.
    if (queue) {
      for (let i = 0; i < queue.length; i++) {
        const lod = storage.get(queue[i]);
        if (lod && selectEntity(queue[i], lod, world, frame)) selections++;
      }
      queue.length = 0;
    }
    // Called with no budget left too: the frame still counts toward the walk's lap
    selections += walkCapped(storage, Math.max(budget - selections, 0), world, frame, stats);
  }

  stats.selections = selections;
  if (IS_DEBUG_ENV) stats.selectionMs = performance.now() - start;
};

// --- APPLY ---

/**
 * Applies the levels lodSelectionSystem changed this frame: a mesh's geometry, material(s) and
 * `castShadow`, or the entity's {@link _engine/features/lod/LodTypes!LodTarget}, cross-fading
 * when it can.
 * Registered by the feature's install.
 * @internal
 */
export const lodApplySystem = (world: ECSWorld) => {
  const stats = getWritableLodFrameStats(world);
  stats.applies = 0;
  const pending = pendingApplies.get(world);
  if (!pending || pending.length === 0) return;

  let applies = 0;
  for (let i = 0; i < pending.length; i++) {
    const entityId = pending[i];
    const lod = world.getComponent(entityId, ComponentType.LOD);
    if (!lod || lod.level < 0 || lod.level === lod.applied) continue;
    if (lod._levels[lod.level]) {
      const fade = prepareChange(entityId, world, lod);
      applyLevelTo(entityId, world, lod, lod.level, fade);
      if (fade) startFade(entityId, world, lod, lod.applied);
    }
    lod.applied = lod.level;
    applies++;
  }
  pending.length = 0;
  stats.applies = applies;
  stats.totalApplies += applies;
};

/**
 * Advances every running cross-fade (the TAG_LOD_TRANSITIONING entities) by the frame's `dt` (times
 * the `fadeTimeScale` debug option) over its `fadeSeconds`, and ends the ones that are done. Runs
 * right after lodApplySystem, so a fade started this frame is drawn at its first step.
 * Registered by the feature's install.
 * @internal
 */
export const lodFadeSystem = (world: ECSWorld, dt: number) => {
  const stats = getWritableLodFrameStats(world);
  const storage = world.getStorage(ComponentType.TAG_LOD_TRANSITIONING);
  stats.fadeMs = 0;
  if (storage.size === 0) {
    stats.fading = 0;
    return;
  }
  const start = IS_DEBUG_ENV ? performance.now() : 0;

  const lods = world.getStorage(ComponentType.LOD);
  const globalSeconds = getLodFadeSeconds();
  const step = dt * Math.max(getLodDebugOptions().fadeTimeScale, 0);
  // Removing the current entry while iterating a Map is safe
  for (const [entityId] of storage) {
    const lod = lods.get(entityId);
    if (!lod) {
      world.removeComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING);
      continue;
    }
    const seconds = lod.def.fadeSeconds ?? globalSeconds;
    const progress = seconds > 0 ? (lod._fade ?? 0) + step / seconds : 1;
    if (progress >= 1) {
      endFade(entityId, world, lod);
      continue;
    }
    lod._fade = progress;
    drawFade(entityId, world, lod, progress);
  }

  stats.fading = storage.size;
  if (IS_DEBUG_ENV) stats.fadeMs = performance.now() - start;
};

/**
 * Installs the LOD selection (the `lod()` feature's install, LodFeature.ts): the `LOD` and cull
 * hooks and the selection, apply and fade systems.
 * @internal
 */
export const installLodSystem = (ctx: FeatureContext) => {
  ctx.registerComponentHooks(ComponentType.TAG_LOD_CULLED, lodCulledHooks);
  ctx.registerComponentHooks(ComponentType.TAG_LOD_TRANSITIONING, lodTransitioningHooks);
  // Frustum culling runs before the selection in the same frame, so an entity re-entering the
  // view is queued in time for its first frame in view
  ctx.registerComponentHooks(ComponentType.TAG_FRUSTUM_CULLED, {
    onRemoveComponent: queuePrioritySelection,
  });
  ctx.registerComponentHooks(ComponentType.DISABLED, {
    onRemoveComponent: queuePrioritySelection,
  });
  ctx.registerComponentHooks(ComponentType.LOD, lodHooks);

  ctx.registerPlugin((world) => {
    // Same order: selection, apply, then the fades (registration order breaks the tie)
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'lodSelectionSystem',
      lodSelectionSystem,
      APP_RENDER_SYNC_ORDER.LOD_SELECTION
    );
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'lodApplySystem',
      lodApplySystem,
      APP_RENDER_SYNC_ORDER.LOD_SELECTION
    );
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'lodFadeSystem',
      lodFadeSystem,
      APP_RENDER_SYNC_ORDER.LOD_SELECTION
    );
    return world;
  });
};
