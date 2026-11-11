// The merge groups' shared state and helpers (docs/plans/_DONE_p372_mesh-merge-groups.md): the groups and
// pending builds per world, and a member's mesh and pose. MergeGroups.ts (the API and the builds)
// and MergeInPlace.ts (the in-place range updates) both use them.
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getCurrentSceneId, getLoadingSceneId } from '../../kernel/scene/Scene';
import type { MergedGeometry } from '../../kernel/assets/GeometryMergeCore';
import type { MergeGroupData, MergeGroupSettings, MeshMergeDef } from './MergeTypes';

/** Per world: the group entities by group id, the groups waiting for a build, and the meshes
 * whose `merge` waits for the next build to join. */
const groupsByWorld = new WeakMap<ECSWorld, Map<string, number>>();
const pendingByWorld = new WeakMap<ECSWorld, Set<number>>();
const queuedByWorld = new WeakMap<ECSWorld, Map<number, MeshMergeDef>>();

/**
 * The world's group entities by group id (made on first use).
 * @internal
 */
export const getGroups = (world: ECSWorld) => {
  let groups = groupsByWorld.get(world);
  if (!groups) groupsByWorld.set(world, (groups = new Map()));
  return groups;
};

/**
 * The world's groups waiting for a build (made on first use).
 * @internal
 */
export const getPending = (world: ECSWorld) => {
  let pending = pendingByWorld.get(world);
  if (!pending) pendingByWorld.set(world, (pending = new Set()));
  return pending;
};

/**
 * The world's groups waiting for a build, if it ever had any: for the per-frame check.
 * @internal
 */
export const findPending = (world: ECSWorld) => pendingByWorld.get(world);

/**
 * Creates a group's entity and its `MERGE_GROUP`, and lists it under its id (no checks: the API's
 * `createMergeGroup` and the `AUTO` groups' resolution make them).
 * @internal
 */
export const createGroup = (
  opts: MergeGroupSettings & { id: string },
  ecsWorld: ECSWorld,
  isAuto: boolean
) => {
  const { id, ...settings } = opts;
  const sceneId = getLoadingSceneId() ?? getCurrentSceneId() ?? '';
  const groupEntityId = ecsWorld.createEntity({
    appId: `mergeGroup:${id}`,
    managedBy: { manager: 'MERGE', ownerId: settings.persistent ? '' : sceneId, role: 'group' },
    debugData: { name: `Merge group ${id}` },
  });
  if (settings.persistent) ecsWorld.addComponent(groupEntityId, ComponentType.PERSISTENT, true);
  ecsWorld.addComponent(groupEntityId, ComponentType.MERGE_GROUP, {
    id,
    members: [],
    settings,
    partIndex: new Map(),
    wasted: 0,
    rebuilds: 0,
    _material: null,
    _isPending: false,
    _buildToken: 0,
    _isBuilding: false,
    _isAuto: isAuto,
  });
  getGroups(ecsWorld).set(id, groupEntityId);
  return groupEntityId;
};

/**
 * The world's meshes whose `merge` joins at the next build, in creation order (made on first use).
 * @internal
 */
export const getQueued = (world: ECSWorld) => {
  let queued = queuedByWorld.get(world);
  if (!queued) queuedByWorld.set(world, (queued = new Map()));
  return queued;
};

/**
 * The world's queued `merge`s, if it ever had any: for the per-frame check.
 * @internal
 */
export const findQueued = (world: ECSWorld) => queuedByWorld.get(world);

/** A scene load is running (the `loadStart` hook until the scene step, or `loadSettled` for a
 * load that failed): the build system waits for the step, and joining members are held. */
let isSceneLoading = false;
/** Per world: the members a scene load held from drawing (`TAG_DRAW_HELD`, only those it added). */
const loadHoldsByWorld = new WeakMap<ECSWorld, Set<number>>();

/**
 * Sets whether a scene load is running (the `merging()` feature's scene hooks).
 * @internal
 */
export const setMergeSceneLoading = (isLoading: boolean) => {
  isSceneLoading = isLoading;
};

/**
 * Whether a scene load is running: the build system waits for the scene step.
 * @internal
 */
export const isMergeSceneLoading = () => isSceneLoading;

/**
 * Holds a mesh joining a group during a scene load from drawing until the scene step has built its
 * group: a mesh drawn on its own even once uploads its geometry, which three keeps until it's
 * disposed (p372 Phase 1). Not one something else holds already. Outside a load, nothing.
 * @internal
 */
export const holdForSceneLoad = (entityId: number, world: ECSWorld) => {
  if (!isSceneLoading || world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD)) return;
  world.addComponent(entityId, ComponentType.TAG_DRAW_HELD, true);
  let held = loadHoldsByWorld.get(world);
  if (!held) loadHoldsByWorld.set(world, (held = new Set()));
  held.add(entityId);
};

/**
 * Lets go of the members the scene load held: the merged ones stay hidden by `TAG_MERGED`, a
 * refused one is drawn on its own.
 * @internal
 */
export const releaseSceneLoadHolds = (world: ECSWorld) => {
  const held = loadHoldsByWorld.get(world);
  if (!held) return;
  for (const entityId of held) {
    if (world.isAlive(entityId) && world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD)) {
      world.removeComponent(entityId, ComponentType.TAG_DRAW_HELD);
    }
  }
  held.clear();
};

/**
 * Marks a group for a build at the build system's next run.
 * @internal
 */
export const markPending = (world: ECSWorld, groupEntityId: number, group: MergeGroupData) => {
  group._isPending = true;
  getPending(world).add(groupEntityId);
};

/**
 * A member's own mesh.
 * @internal
 */
export const getMemberMesh = (entityId: number, world: ECSWorld) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

/**
 * A built group's mesh and merged geometry, or undefined before its first build.
 * @internal
 */
export const getGroupMesh = (groupEntityId: number, world: ECSWorld) =>
  world.getComponent(groupEntityId, ComponentType.OBJECT3D)?.value as
    | (THREE.Mesh & { geometry: MergedGeometry })
    | undefined;

/**
 * Puts a member's mesh at its `TRANSFORM` now and updates its world matrix: object3DSyncSystem
 * copies a `TRANSFORM` only in MAIN, so one set later in the frame (an `APP_LOGIC` move followed
 * by `updateMergeMember`) isn't on the mesh yet. The sync's dirty flag stays for the sync.
 * @internal
 */
export const syncMemberPose = (entityId: number, mesh: THREE.Mesh, world: ECSWorld) => {
  const store = world.getTypedTransformStore();
  if (store) {
    const slot = store.getSlot(entityId);
    if (slot !== -1) store.copyToObject3D(slot, mesh);
  } else {
    const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (transform) {
      mesh.position.copy(transform.position);
      mesh.quaternion.copy(transform.quaternion);
      mesh.scale.copy(transform.scale);
    }
  }
  mesh.updateWorldMatrix(true, false);
};

// --- DEBUG FIGURES (p373 D1: the Merging tab's) ---
//
// Written only behind `if (IS_DEBUG_ENV)` at their call sites, so a production build folds the
// calls away and these functions with them.

/** An entity whose `merge` (or `addToMergeGroup`) was refused: the group it asked for and why. */
export type MergeRefusalRecord = { groupId: string; reason: string };

/** The merging figures the Merging tab shows that the components don't keep, per world. */
export type MergeDebugStats = {
  /** Builds applied since the world started (every group's, deleted ones included). */
  builds: number;
  /** In-place range writes (a move, a remove or delete, a disable, an enable). */
  inPlaceUpdates: number;
  /** The last build applied: its group, the time from its start to applied, and whether it ran
   * in the worker (then the time includes the wait). */
  lastBuild: { groupId: string; ms: number; isWorker: boolean } | null;
  /** The refused entities, by entity id, oldest first (at most MAX_REFUSALS). */
  refusals: Map<number, MergeRefusalRecord>;
};

/** The refusals kept per world, the newest. */
export const MAX_MERGE_REFUSALS = 200;

const debugStatsByWorld = new WeakMap<ECSWorld, MergeDebugStats>();

/**
 * The world's merging debug figures (made on first use). Debug env only.
 * @internal
 */
export const getMergeDebugStats = (world: ECSWorld) => {
  let stats = debugStatsByWorld.get(world);
  if (!stats) {
    stats = { builds: 0, inPlaceUpdates: 0, lastBuild: null, refusals: new Map() };
    debugStatsByWorld.set(world, stats);
  }
  return stats;
};

/**
 * Records a refused entity (its latest refusal replaces an earlier one). Call behind
 * `IS_DEBUG_ENV`.
 * @internal
 */
export const noteMergeRefusal = (
  world: ECSWorld,
  entityId: number,
  groupId: string,
  reason: string
) => {
  const { refusals } = getMergeDebugStats(world);
  refusals.delete(entityId);
  refusals.set(entityId, { groupId, reason });
  if (refusals.size > MAX_MERGE_REFUSALS) refusals.delete(refusals.keys().next().value!);
};

/**
 * Records an applied build. Call behind `IS_DEBUG_ENV`.
 * @internal
 */
export const noteMergeBuild = (world: ECSWorld, groupId: string, ms: number, isWorker: boolean) => {
  const stats = getMergeDebugStats(world);
  stats.builds++;
  stats.lastBuild = { groupId, ms, isWorker };
};

/**
 * Records an in-place range write. Call behind `IS_DEBUG_ENV`.
 * @internal
 */
export const noteMergeInPlaceUpdate = (world: ECSWorld) => {
  getMergeDebugStats(world).inPlaceUpdates++;
};

/**
 * Lets a member go: drawn on its own again, back in the spatial index if it was.
 * @internal
 */
export const releaseMember = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member) return;
  world.removeComponent(entityId, ComponentType.MERGE_MEMBER);
  world.removeComponent(entityId, ComponentType.TAG_MERGED);
  if (member._wasSpatialIndexed) world.addComponent(entityId, ComponentType.SPATIAL_INDEXED, true);
};
