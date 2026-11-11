// Batched merge groups (docs/plans/p375_batched-mesh-batches.md §3): a `BATCHED` group draws its
// members as instances of one three `BatchedMesh`, each geometry added once and each member an
// instance (`MERGE_MEMBER.instanceId`). Loaded behind `import()` on the first batched group's build
// (MergeBatchFront.ts): `BatchedMesh` is about 18 kB minified.
//
// A build adds the members not in the batch yet, growing its buffers when they're full; the first
// build (and `rebuildMergeGroup`) makes the batch from every member, added grouped by geometry with
// `sortObjects` off, so r187's WebGPU backend merges each geometry's instances into one draw
// (D1). The batch sits at the centre of its members' bounds when it's made, as a baked group's
// mesh does, each instance's matrix its member's world matrix less that centre; its internal
// geometry carries the members' bounding sphere, which the spatial index measures a mesh by. Built
// on the main thread: there is no geometry to merge (D3).
//
// The sync (`mergeBatchSyncSystem`, APP_RENDER_SYNC at MERGE_BATCH_SYNC, after the pose
// producers) writes an instance's matrix from its member's own mesh, which the member keeps hidden:
// the batch draws a member where its mesh would be drawn on its own. A mesh moved by
// `object3DSyncSystem` is seen by its `OBJECT3D._lastVersion` (the transform's version in `MAP`
// storage, a count of the copies in `TYPED_ARRAY`); a body's mesh (`BODY_DYNAMIC_VISUAL`) is
// written every frame, as physics' interpolation moves it without a version. The batch's sphere
// grows with what's written (never shrinks: the next full build measures it again), so three
// culls it whole only when no member can be in view.
//
// Grouping (D1): r187 merges only adjacent draws of one geometry (in instance id order; a freed or
// hidden id between them doesn't split them). A join takes the lowest freed id, which can sit in
// another geometry's run, so a batch counts its runs after its instances changed (`countRuns`,
// from its own geometry-per-id list) and, past COMPACT_RUNS_FACTOR times the geometries in use,
// compacts in the sync that frame (`compactBatch`): the same ids, each given the next member in
// geometry order (`setGeometryIdAt`, its matrix and visibility written again), so nothing is
// reallocated.
import * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import { incMaterialRef } from '../../kernel/assets/Material';
import { getRootScene } from '../../kernel/scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import type { BatchVisibilityOverrides } from './MergeBatchFront';
import { clearEmptyGroup, getLiveMembers } from './MergeBuild';
import { getMemberMesh, noteMergeBuild, syncMemberPose } from './MergeState';
import type { MergeGroupData, MergeMemberData } from './MergeTypes';

/**
 * A batch compacts once its geometry runs (in id order) pass this many times the geometries its
 * instances use (D1): one run per geometry is one draw on WebGPU.
 * @internal
 */
export const COMPACT_RUNS_FACTOR = 2;

/** A batch is made, and grows, with this share of room over what it holds. */
const BATCH_RESERVE = 1.25;
/** And at least this many instances more. */
const MIN_SPARE_INSTANCES = 16;

/** A batched group's batch and its bookkeeping. */
type BatchState = {
  /** Its group, and the group's entity. */
  group: MergeGroupData;
  groupEntityId: number;
  batch: THREE.BatchedMesh;
  /** The batch's geometry id of each member geometry it holds. */
  geometryIds: Map<THREE.BufferGeometry, number>;
  /** The batch's place: its members' bounds' centre when it was made. */
  centre: THREE.Vector3;
  /** The vertex and index buffers' sizes (`BatchedMesh` keeps them private). */
  maxVertexCount: number;
  maxIndexCount: number;
  /** A full build is due (`rebuildMergeGroup`). */
  isRebuildDue: boolean;
  /** The batch's geometry id of each instance id, -1 for a freed one (three's is private). */
  geometryAt: number[];
  /** Its instances changed since the runs were counted: the sync counts them again. */
  isOrderDirty: boolean;
  /** Its geometry runs in instance id order (a draw each on WebGPU), and the geometries its
   * instances use, at the last count. */
  runs: number;
  geometriesInUse: number;
  /** Compactions so far. */
  compactions: number;
  /** The run count's per-geometry marks, and the count's stamp. */
  seen: number[];
  countStamp: number;
};

const states = new WeakMap<MergeGroupData, BatchState>();
/** Per world: its batches, for the sync (a deleted group's goes at the sync's next run). */
const batchesByWorld = new WeakMap<ECSWorld, Set<BatchState>>();

/**
 * A batched group's batch, once built (the debugger's figures read it).
 * @internal
 */
export const getBatchState = (group: MergeGroupData): Readonly<BatchState> | undefined =>
  states.get(group);

const scratchBox = new THREE.Box3();
const bounds = new THREE.Box3();
const instanceMatrix = new THREE.Matrix4();
const memberSphere = new THREE.Sphere();

/** A geometry's index count, or 0 without an index (a batch's geometries agree on it). */
const getIndexCount = (geometry: THREE.BufferGeometry) => geometry.index?.count ?? 0;

/** Writes `instanceMatrix`, a member's world matrix, as its instance's (the batch's centre taken
 * off, in place). */
const writeInstanceMatrix = (state: BatchState, instanceId: number) => {
  const { centre } = state;
  const e = instanceMatrix.elements;
  e[12] -= centre.x;
  e[13] -= centre.y;
  e[14] -= centre.z;
  state.batch.setMatrixAt(instanceId, instanceMatrix);
};

/** Grows the batch's sphere, and its geometry's copy, to hold a member's geometry at
 * `instanceMatrix`. Whether it grew. */
const growBatchSphere = (state: BatchState, geometry: THREE.BufferGeometry) => {
  const sphere = state.batch.boundingSphere;
  if (!sphere) return false;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  memberSphere.copy(geometry.boundingSphere!).applyMatrix4(instanceMatrix);
  if (memberSphere.center.distanceTo(sphere.center) + memberSphere.radius <= sphere.radius) {
    return false;
  }
  sphere.union(memberSphere);
  state.batch.geometry.boundingSphere?.copy(sphere);
  return true;
};

/** The group joins the spatial index again, so it measures the grown sphere. */
const rejoinSpatialIndex = (groupEntityId: number, world: ECSWorld) => {
  if (!world.hasComponent(groupEntityId, ComponentType.SPATIAL_INDEXED)) return;
  world.removeComponent(groupEntityId, ComponentType.SPATIAL_INDEXED);
  world.addComponent(groupEntityId, ComponentType.SPATIAL_INDEXED, true);
};

/**
 * Whether a batched member is drawn: not disabled, frustum-culled (an opt-in, the engine's) or
 * held. `overrides` gives the value of the tag a hook is changing (its remove hook runs before
 * it's gone).
 * @internal
 */
export const isBatchMemberShown = (
  entityId: number,
  world: ECSWorld,
  overrides?: BatchVisibilityOverrides
) =>
  !(overrides?.isDisabled ?? world.isDisabled(entityId)) &&
  !(overrides?.isFrustumCulled ?? world.hasComponent(entityId, ComponentType.TAG_FRUSTUM_CULLED)) &&
  !(overrides?.isDrawHeld ?? world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD));

/**
 * Sets a batched member's instance visibility (its visibility hooks, MergeBatchFront.ts).
 * @internal
 */
export const setBatchMemberVisible = (
  member: MergeMemberData,
  group: MergeGroupData,
  isVisible: boolean
) => {
  const state = states.get(group);
  if (state && member.instanceId >= 0) state.batch.setVisibleAt(member.instanceId, isVisible);
};

/** Adds a member's instance of its geometry (in the batch already): its matrix, its visibility,
 * and on its first build its own mesh hidden and out of the spatial index. */
const addMemberInstance = (entityId: number, state: BatchState, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;
  const mesh = getMemberMesh(entityId, world);
  const isFirstBuild = member.instanceId === -1;
  const geometryId = state.geometryIds.get(mesh.geometry)!;
  member.instanceId = state.batch.addInstance(geometryId);
  state.geometryAt[member.instanceId] = geometryId;
  state.isOrderDirty = true;
  syncMemberPose(entityId, mesh, world);
  instanceMatrix.copy(mesh.matrixWorld);
  writeInstanceMatrix(state, member.instanceId);
  member._batchVersion = world.getComponent(entityId, ComponentType.OBJECT3D)!._lastVersion;
  if (!isBatchMemberShown(entityId, world)) state.batch.setVisibleAt(member.instanceId, false);
  if (isFirstBuild) {
    member._wasSpatialIndexed = world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED);
    world.removeComponent(entityId, ComponentType.SPATIAL_INDEXED);
  }
  if (!world.hasComponent(entityId, ComponentType.TAG_MERGED)) {
    world.addComponent(entityId, ComponentType.TAG_MERGED, true);
  }
};

/** The members' geometries in first-seen order, and the members grouped by them in that order
 * (stable: a geometry's members in their order in `members`). */
const groupByGeometry = (members: readonly number[], world: ECSWorld) => {
  const byGeometry = new Map<THREE.BufferGeometry, number[]>();
  for (const entityId of members) {
    const { geometry } = getMemberMesh(entityId, world);
    const list = byGeometry.get(geometry);
    if (list) list.push(entityId);
    else byGeometry.set(geometry, [entityId]);
  }
  return byGeometry;
};

/** The members' world bounds' centre (their poses synced from their TRANSFORMs). */
const getMembersCentre = (members: readonly number[], world: ECSWorld) => {
  bounds.makeEmpty();
  for (const entityId of members) {
    const mesh = getMemberMesh(entityId, world);
    syncMemberPose(entityId, mesh, world);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    bounds.union(scratchBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
  }
  return bounds.getCenter(new THREE.Vector3());
};

/** The batch's sphere measured from its instances: its own, which three culls it whole by, and a
 * copy as its geometry's, which the spatial index measures it by (a copy: a geometry's sphere is
 * recomputed in place from its vertices by whoever calls `computeBoundingSphere`). The group joins
 * the index again when the radius grew (or the batch is new). */
const updateBatchBounds = (state: BatchState, world: ECSWorld) => {
  const { batch } = state;
  const previous = batch.geometry.boundingSphere?.radius ?? -1;
  batch.computeBoundingSphere();
  batch.geometry.boundingSphere = batch.boundingSphere!.clone();
  if (batch.boundingSphere!.radius > previous) {
    world.removeComponent(state.groupEntityId, ComponentType.SPATIAL_INDEXED);
    world.addComponent(state.groupEntityId, ComponentType.SPATIAL_INDEXED, true);
  }
};

/** Makes the group's batch from all its members, replacing a previous one. */
const createBatch = (
  groupEntityId: number,
  group: MergeGroupData,
  members: readonly number[],
  world: ECSWorld
) => {
  const byGeometry = groupByGeometry(members, world);
  let vertices = 0;
  let indices = 0;
  for (const geometry of byGeometry.keys()) {
    vertices += geometry.getAttribute('position').count;
    indices += getIndexCount(geometry);
  }
  const material = existsOrThrow(group._material, `Merge group "${group.id}" has no material.`);
  const maxVertexCount = Math.ceil(vertices * BATCH_RESERVE);
  const maxIndexCount = Math.ceil(indices * BATCH_RESERVE);
  const batch = new THREE.BatchedMesh(
    Math.ceil(members.length * BATCH_RESERVE) + MIN_SPARE_INSTANCES,
    maxVertexCount,
    // A batch of unindexed geometries makes no index; its size is then unused
    Math.max(maxIndexCount, 1),
    material
  );
  const firstMember = getMemberMesh(members[0], world);
  batch.name = `mergeGroup:${group.id}`;
  batch.userData.id = `mergeGroup:${group.id}`;
  batch.userData.entityId = groupEntityId;
  batch.castShadow = group.settings.castShadow ?? firstMember.castShadow;
  batch.receiveShadow = group.settings.receiveShadow ?? firstMember.receiveShadow;
  // Grouped by geometry, unsorted: one draw per geometry on WebGPU (D1)
  batch.sortObjects = false;
  batch.perObjectFrustumCulled = group.settings.perMemberCulling ?? true;
  const centre = getMembersCentre(members, world);
  batch.position.copy(centre);

  const objComp = world.getComponent(groupEntityId, ComponentType.OBJECT3D);
  const previous = objComp?.value;
  if (objComp) {
    // A rebuild: the new batch in the old one's place (the material's ref stays)
    previous!.removeFromParent();
    (previous as THREE.BatchedMesh).dispose();
    objComp.value = batch;
  } else {
    if (material.userData.id) incMaterialRef(material.userData.id as string);
    world.addComponent(groupEntityId, ComponentType.OBJECT3D, { value: batch, _lastVersion: -1 });
    if (!world.hasComponent(groupEntityId, ComponentType.TAG_IS_MESH)) {
      world.addComponent(groupEntityId, ComponentType.TAG_IS_MESH, true);
    }
  }
  const transform = world.getComponent(groupEntityId, ComponentType.TRANSFORM);
  if (transform) {
    transform.position.copy(centre);
    transform.setDirty();
    world.commitTransform(groupEntityId, transform);
  }

  const state: BatchState = {
    group,
    groupEntityId,
    batch,
    geometryIds: new Map(),
    centre,
    maxVertexCount,
    maxIndexCount: Math.max(maxIndexCount, 1),
    isRebuildDue: false,
    geometryAt: [],
    isOrderDirty: true,
    runs: 0,
    geometriesInUse: 0,
    compactions: 0,
    seen: [],
    countStamp: 0,
  };
  const previousState = states.get(group);
  states.set(group, state);
  let batches = batchesByWorld.get(world);
  if (!batches) batchesByWorld.set(world, (batches = new Set()));
  if (previousState) batches.delete(previousState);
  batches.add(state);
  world.addSystem(
    ECSSystemStage.APP_RENDER_SYNC,
    'mergeBatchSync',
    mergeBatchSyncSystem,
    APP_RENDER_SYNC_ORDER.MERGE_BATCH_SYNC
  );
  for (const [geometry, ids] of byGeometry) {
    state.geometryIds.set(geometry, batch.addGeometry(geometry));
    for (const entityId of ids) addMemberInstance(entityId, state, world);
  }
  return state;
};

/** Makes room for `newcomers` and their geometries the batch doesn't hold yet, and adds those. */
const growBatch = (state: BatchState, newcomers: readonly number[], world: ECSWorld) => {
  const { batch, geometryIds } = state;
  const added = new Set<THREE.BufferGeometry>();
  let vertices = 0;
  let indices = 0;
  for (const entityId of newcomers) {
    const { geometry } = getMemberMesh(entityId, world);
    if (geometryIds.has(geometry) || added.has(geometry)) continue;
    added.add(geometry);
    vertices += geometry.getAttribute('position').count;
    indices += getIndexCount(geometry);
  }
  if (vertices > batch.unusedVertexCount || indices > batch.unusedIndexCount) {
    state.maxVertexCount = Math.ceil(
      (state.maxVertexCount - batch.unusedVertexCount + vertices) * BATCH_RESERVE
    );
    state.maxIndexCount = Math.max(
      Math.ceil((state.maxIndexCount - batch.unusedIndexCount + indices) * BATCH_RESERVE),
      1
    );
    batch.setGeometrySize(state.maxVertexCount, state.maxIndexCount);
  }
  for (const geometry of added) geometryIds.set(geometry, batch.addGeometry(geometry));
  const needed = batch.instanceCount + newcomers.length;
  if (needed > batch.maxInstanceCount) {
    batch.setInstanceCount(Math.ceil(needed * BATCH_RESERVE) + MIN_SPARE_INSTANCES);
  }
};

/**
 * Builds a batched group: the first build (or one `rebuildMergeGroup` asked for) makes its batch
 * from every member, grouped by geometry; a later one adds the members that joined since. A build
 * that finds no member left deletes an `AUTO` group and takes an explicit one's batch out of the
 * scene.
 * @internal
 */
export const buildBatchGroup = (groupEntityId: number, group: MergeGroupData, world: ECSWorld) => {
  const start = IS_DEBUG_ENV ? performance.now() : 0;
  const members = getLiveMembers(groupEntityId, group, world);
  group.members = members;
  if (members.length === 0) {
    clearEmptyGroup(groupEntityId, group, world);
    return;
  }
  let state = states.get(group);
  if (!state || state.isRebuildDue) {
    state = createBatch(groupEntityId, group, members, world);
  } else {
    const newcomers = members.filter(
      (entityId) => world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId === -1
    );
    if (newcomers.length > 0) {
      growBatch(state, newcomers, world);
      // Grouped by geometry: a block of ids each, as far as freed ids allow
      for (const ids of groupByGeometry(newcomers, world).values()) {
        for (const entityId of ids) addMemberInstance(entityId, state, world);
      }
    }
  }
  if (!state.batch.parent) {
    existsOrThrow(getRootScene(), 'Merge groups need the root scene.').add(state.batch);
  }
  updateBatchBounds(state, world);
  group.rebuilds++;
  if (IS_DEBUG_ENV) noteMergeBuild(world, group.id, performance.now() - start, false);
};

/**
 * Marks a batched group's next build as a full one (`rebuildMergeGroup`): a new batch from every
 * member, grouped by geometry.
 * @internal
 */
export const requestBatchRebuild = (group: MergeGroupData) => {
  const state = states.get(group);
  if (state) state.isRebuildDue = true;
};

/**
 * Deletes a leaving member's instance (MergeBatchFront.ts' `dropBatchMember`).
 * @internal
 */
export const deleteBatchInstance = (member: MergeMemberData, group: MergeGroupData) => {
  const state = states.get(group);
  if (!state) return;
  state.batch.deleteInstance(member.instanceId);
  state.geometryAt[member.instanceId] = -1;
  state.isOrderDirty = true;
};

/** Counts the batch's geometry runs in instance id order, freed ids skipped (three skips them
 * when it merges draws), and the geometries in use. */
const countRuns = (state: BatchState) => {
  const { geometryAt, seen } = state;
  const stamp = ++state.countStamp;
  let runs = 0;
  let geometries = 0;
  let previous = -1;
  for (let id = 0; id < geometryAt.length; id++) {
    const geometryId = geometryAt[id];
    if (geometryId < 0) continue;
    if (geometryId !== previous) runs++;
    previous = geometryId;
    if (seen[geometryId] !== stamp) {
      seen[geometryId] = stamp;
      geometries++;
    }
  }
  state.runs = runs;
  state.geometriesInUse = geometries;
};

/** A member being compacted: its geometry and its instance before. */
type CompactEntry = { entityId: number; member: MergeMemberData; geometryId: number; id: number };

/**
 * Compacts a batch (D1): its live instance ids, in order, each given the next member in geometry
 * order (by its id before within a geometry), so each geometry's instances are one run. Its matrix
 * from its own mesh (the sync's source) and its visibility are written again. A rare frame's
 * work: it allocates its lists.
 */
const compactBatch = (state: BatchState, world: ECSWorld) => {
  const { batch, geometryAt } = state;
  const entries: CompactEntry[] = [];
  for (const entityId of state.group.members) {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
    if (!member || member.instanceId < 0) continue;
    const { instanceId: id } = member;
    entries.push({ entityId, member, geometryId: geometryAt[id], id });
  }
  const ids = entries.map((entry) => entry.id).sort((a, b) => a - b);
  entries.sort((a, b) => a.geometryId - b.geometryId || a.id - b.id);
  entries.forEach((entry, k) => {
    const id = ids[k];
    const { entityId, member, geometryId } = entry;
    member.instanceId = id;
    geometryAt[id] = geometryId;
    batch.setGeometryIdAt(id, geometryId);
    const object = world.getComponent(entityId, ComponentType.OBJECT3D)!;
    const mesh = object.value as THREE.Mesh;
    instanceMatrix.compose(mesh.position, mesh.quaternion, mesh.scale);
    writeInstanceMatrix(state, id);
    member._batchVersion = object._lastVersion;
    batch.setVisibleAt(id, isBatchMemberShown(entityId, world));
  });
  state.compactions++;
  countRuns(state);
};

/**
 * Writes the batched members' instance matrices whose own meshes moved (a body's every frame) and
 * grows their batches' spheres (APP_RENDER_SYNC, MERGE_BATCH_SYNC; added with a world's first
 * batch). Storages read once, no allocation.
 * @internal
 */
export const mergeBatchSyncSystem = (world: ECSWorld) => {
  const batches = batchesByWorld.get(world);
  if (!batches?.size) return;
  const members = world.getStorage(ComponentType.MERGE_MEMBER);
  const objects = world.getStorage(ComponentType.OBJECT3D);
  const bodies = world.getStorage(ComponentType.BODY_DYNAMIC_VISUAL);
  for (const state of batches) {
    const { group, groupEntityId } = state;
    // A deleted group's, or one a full build replaced
    if (
      states.get(group) !== state ||
      world.getComponent(groupEntityId, ComponentType.MERGE_GROUP) !== group
    ) {
      batches.delete(state);
      continue;
    }
    let hasGrown = false;
    const ids = group.members;
    for (let i = 0; i < ids.length; i++) {
      const entityId = ids[i];
      const member = members.get(entityId);
      const object = objects.get(entityId);
      if (!member || member.instanceId < 0 || !object) continue;
      if (object._lastVersion === member._batchVersion && !bodies.has(entityId)) continue;
      member._batchVersion = object._lastVersion;
      const mesh = object.value as THREE.Mesh;
      instanceMatrix.compose(mesh.position, mesh.quaternion, mesh.scale);
      writeInstanceMatrix(state, member.instanceId);
      if (growBatchSphere(state, mesh.geometry)) hasGrown = true;
    }
    if (hasGrown) rejoinSpatialIndex(groupEntityId, world);
    if (state.isOrderDirty) {
      state.isOrderDirty = false;
      countRuns(state);
      if (state.runs > COMPACT_RUNS_FACTOR * state.geometriesInUse) compactBatch(state, world);
    }
  }
};
