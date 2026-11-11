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
// reallocated. That's a batch's `order` (`BatchOrder`, p375 Phase 2 S6, D1's fallback decided):
// `COMPACT` on WebGPU; `RANGE_SORT` on WebGPU once a member has a LOD (its swaps and fades split
// the runs every frame: compacting each frame cost ~1.3 ms at 2 000 members and its fades' second
// instances kept the runs past the limit), three sorting each pass's list by geometry range then
// depth; `NONE` on WebGL2, whose multi-draw is one draw in any order. A transparent batch (p375
// Phase 3) is sorted on both backends instead, never compacted: `DEPTH` (three's back-to-front
// sort) or `JOIN` (the order its members joined, `MERGE_MEMBER._joinSeq`, the newest drawn last),
// its group's `transparentOrder`.
//
// LOD per member (p375 Phase 2): `lod()` keeps a member's levels and sets each on its own mesh; the
// kernel's mesh draw delegate (MergeBatchFront.ts' forwarding stub, registered by merging's
// install) hands MergeBatchLod.ts the level, the cull and the fade steps. The batch holds every
// level geometry of its members (added with them; a LOD that came later adds its levels at its
// first apply), and a level change gives the instance the level's geometry in place (`setGeometryIdAt`:
// the id stays, its run may split, D1's compaction regroups: in the next frame's sync, which runs
// before the LOD's apply, APP_RENDER_SYNC_ORDER). LOD culling hides the instance
// (`isBatchMemberShown`), and a cull fading out keeps it until its fade ends. The fades dither
// through the batch's fade texture (MergeBatchFades.ts), a level fade's outgoing level as a second
// instance (`MERGE_MEMBER._fadeInstanceId`), which this module keeps with its member: deleted
// with it, moved by the sync, shown and hidden with it, and left in place by a compaction.
import * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { reconcileObject3DVisibility } from '../../kernel/ecs/ECSCoreSystems';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import { incMaterialRef } from '../../kernel/assets/Material';
import { getRenderer } from '../../kernel/render/Renderer';
import { getRootScene } from '../../kernel/scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { LOD_FADE_OPAQUE } from '../../kernel/render/LodFade';
import { type BatchFades, createBatchFades, setInstanceFade } from './MergeBatchFades';
import {
  BATCH_RESERVE,
  addGeometries,
  getReservedIndices,
  getReservedVertices,
  markLevelSlots,
  rewriteGeometry,
  setInstanceSlot,
} from './MergeBatchSlots';
import type { BatchVisibilityOverrides } from './MergeBatchFront';
import { clearEmptyGroup, getLiveMembers } from './MergeBuild';
import {
  getMemberMesh,
  isMergeGroupShownUnmerged,
  noteMergeBuild,
  syncMemberPose,
} from './MergeState';
import type { MergeGroupData, MergeMemberData } from './MergeTypes';

/**
 * A batch compacts once its geometry runs (in id order) pass this many times the geometries its
 * instances use (D1): one run per geometry is one draw on WebGPU.
 * @internal
 */
export const COMPACT_RUNS_FACTOR = 2;

/** A batch is made, and grows, with BATCH_RESERVE's room over what it holds, and at least this
 * many instances more. */
const MIN_SPARE_INSTANCES = 16;

/**
 * How a batch orders its draws. An opaque one keeps each geometry's instances in one draw (D1):
 * `COMPACT` regroups its ids past COMPACT_RUNS_FACTOR (WebGPU), `RANGE_SORT` has three sort each
 * pass's list by geometry range then depth (WebGPU, once a member has a LOD), `NONE` does neither
 * (WebGL2: one multi-draw anyway). A transparent one is sorted each pass on both backends, its
 * group's `transparentOrder`: `DEPTH` back to front, `JOIN` by its members' join order.
 * @internal
 */
export type BatchOrder = 'COMPACT' | 'RANGE_SORT' | 'NONE' | 'DEPTH' | 'JOIN';

/** An item of three's per-pass draw list (`customSort`'s): the geometry's range and the depth, as
 * three types it, and the instance id, which its render list sets too. */
type DrawItem = { start: number; count: number; z: number };
type SortItem = DrawItem & { index: number };

/**
 * A batched group's batch and its bookkeeping.
 * @internal
 */
export type BatchState = {
  /** Its group, and the group's entity. */
  group: MergeGroupData;
  groupEntityId: number;
  batch: THREE.BatchedMesh;
  /** The batch's geometry id (its slot) of each geometry it holds (MergeBatchSlots.ts). */
  geometryIds: Map<THREE.BufferGeometry, number>;
  /** Each slot's geometry while the batch holds it (undefined: free). */
  slotGeometries: (THREE.BufferGeometry | undefined)[];
  /** Each slot's instances (the members' and their level fades' outgoing ones). */
  slotInstances: number[];
  /** Slots holding a member's LOD level: kept while no instance uses them, until a full build. */
  slotIsLevel: boolean[];
  /** Free slots, refilled by a geometry that fits (`setGeometryAt`). */
  freeSlots: number[];
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
  /** How it keeps a geometry's instances in one draw, and whether a member had a LOD (which
   * turned `COMPACT` into `RANGE_SORT` for good). */
  order: BatchOrder;
  hasLodMembers: boolean;
  /** Drawn by a multi-draw backend (WebGL2): one draw in any order. */
  isMultiDraw: boolean;
  /** The run count's per-geometry marks, and the count's stamp. */
  seen: number[];
  countStamp: number;
  /** Its instances' LOD fades (MergeBatchFades.ts), grown with its instances. */
  fades: BatchFades;
  /** Each instance id's member's `_joinSeq` (a level fade's outgoing instance its member's), and
   * the `customSort` that draws in it (`JOIN`). */
  joinSeq: number[];
  sortByJoin: (list: DrawItem[]) => void;
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
const instanceColor = new THREE.Vector4();

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

/** A WebGL2 renderer (three's WebGL backend, which multi-draws a batch); without a renderer (the
 * tests) a batch is drawn as on WebGPU. */
const isMultiDrawBackend = () => {
  const renderer = getRenderer();
  return Boolean(renderer) && !(renderer!.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
};

/** The range sort's order: by geometry range, then front to back. */
const compareByRange = (a: { start: number; z: number }, b: { start: number; z: number }) =>
  a.start - b.start || a.z - b.z;
/** The batch's `customSort` for `RANGE_SORT`: each geometry's draws adjacent, so r187 merges them. */
const sortByRange = (list: { start: number; z: number }[]) => {
  list.sort(compareByRange);
};

/** A batch's `JOIN` sort: by its instances' join order, the newest drawn last. */
const createJoinSort = (joinSeq: number[]) => {
  const compare = (a: SortItem, b: SortItem) => joinSeq[a.index] - joinSeq[b.index];
  return (list: DrawItem[]) => {
    (list as SortItem[]).sort(compare);
  };
};

/** The next member's place in the join order (an order within a batch: one count for all). */
let nextJoinSeq = 0;

/** Gives the members without a place in the join order the next ones, in `members`' order (a
 * group's members are in the order they joined). */
const assignJoinSeqs = (members: readonly number[], world: ECSWorld) => {
  for (const entityId of members) {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;
    member._joinSeq ??= nextJoinSeq++;
  }
};

/**
 * Sets a batch's order, and three's sort to match (`DEPTH`: three's own transparent sort).
 * @internal
 */
export const setBatchOrder = (state: BatchState, order: BatchOrder) => {
  state.order = order;
  state.batch.sortObjects = order === 'RANGE_SORT' || order === 'DEPTH' || order === 'JOIN';
  state.batch.setCustomSort(
    order === 'RANGE_SORT' ? sortByRange : order === 'JOIN' ? state.sortByJoin : null
  );
};

/**
 * Notes that a batch draws a member with a LOD: a compacting batch sorts by range from now on
 * (its swaps and fades split the runs every frame).
 * @internal
 */
export const noteBatchLodMember = (state: BatchState) => {
  if (state.hasLodMembers) return;
  state.hasLodMembers = true;
  if (state.order === 'COMPACT') setBatchOrder(state, 'RANGE_SORT');
};

/** The group joins the spatial index again, so it measures the grown sphere. */
const rejoinSpatialIndex = (groupEntityId: number, world: ECSWorld) => {
  if (!world.hasComponent(groupEntityId, ComponentType.SPATIAL_INDEXED)) return;
  world.removeComponent(groupEntityId, ComponentType.SPATIAL_INDEXED);
  world.addComponent(groupEntityId, ComponentType.SPATIAL_INDEXED, true);
};

/**
 * Whether a batched member is drawn: not disabled, frustum-culled (an opt-in, the engine's) or
 * held, and not LOD culled unless it's fading out (`TAG_LOD_TRANSITIONING`: the outgoing copy).
 * `overrides` gives the value of the tag a hook is changing (its remove hook runs before it's
 * gone, an add hook before a fade's tag is added).
 * @internal
 */
export const isBatchMemberShown = (
  entityId: number,
  world: ECSWorld,
  overrides?: BatchVisibilityOverrides
) =>
  !(overrides?.isDisabled ?? world.isDisabled(entityId)) &&
  !(overrides?.isFrustumCulled ?? world.hasComponent(entityId, ComponentType.TAG_FRUSTUM_CULLED)) &&
  !(overrides?.isDrawHeld ?? world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD)) &&
  (!(overrides?.isLodCulled ?? world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)) ||
    (overrides?.isLodFading ?? world.hasComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING)));

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
  if (!state || member.instanceId < 0) return;
  state.batch.setVisibleAt(member.instanceId, isVisible);
  // A level fade's outgoing instance with it
  if (member._fadeInstanceId >= 0) state.batch.setVisibleAt(member._fadeInstanceId, isVisible);
};

/**
 * Makes room for `needed` instances, the fades too (three remakes its textures, so the batch's
 * next build is a new one, reading the grown fades).
 * @internal
 */
export const growInstances = (state: BatchState, needed: number) => {
  const { batch } = state;
  if (needed <= batch.maxInstanceCount) return;
  batch.setInstanceCount(Math.ceil(needed * BATCH_RESERVE) + MIN_SPARE_INSTANCES);
  // three (r187) replaces the batch's indirect, matrices and colour textures here, but keeps a
  // drawn batch's render objects (whose shaders read the old ones) until its material's version
  // changes: the batch's rebuild at its next draw (its key has the new matrices texture; other
  // objects on the material keep theirs)
  (batch.material as THREE.Material).needsUpdate = true;
  state.fades = createBatchFades(batch, batch.maxInstanceCount, state.fades);
};

/** Whether a batch has colours (three makes its colours texture at the first `setColorAt`). */
const hasColors = (batch: THREE.BatchedMesh) =>
  (batch as unknown as { _colorsTexture: THREE.DataTexture | null })._colorsTexture !== null;

/**
 * Writes a member's colour (`setMergeMemberColor`) on one of its instances, or white and opaque
 * when it has none and the batch has colours: three's `addInstance` resets a reused id's RGB but
 * not its alpha, so a faded-out member's id would hide the next one. A batch's first colour sets
 * its material's `needsUpdate`: three reads the colours in the shader only when the texture was
 * there at its build (`growInstances`' trap).
 * @internal
 */
export const writeMemberColor = (
  state: BatchState,
  member: MergeMemberData,
  instanceId: number
) => {
  const { batch } = state;
  const color = member._color;
  const hadColors = hasColors(batch);
  if (!color && !hadColors) return;
  instanceColor.set(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1, color?.a ?? 1);
  batch.setColorAt(instanceId, instanceColor);
  if (!hadColors) (batch.material as THREE.Material).needsUpdate = true;
};

/**
 * Writes a batched member's colour on its instance and its level fade's outgoing one
 * (`setMergeMemberColor`; a member without an instance gets it at its build).
 * @internal
 */
export const writeBatchMemberColor = (member: MergeMemberData, group: MergeGroupData) => {
  const state = states.get(group);
  if (!state || member.instanceId < 0) return;
  writeMemberColor(state, member, member.instanceId);
  if (member._fadeInstanceId >= 0) writeMemberColor(state, member, member._fadeInstanceId);
};

/**
 * Deletes a member's level fade's outgoing instance, if it has one.
 * @internal
 */
export const deleteFadeInstance = (state: BatchState, member: MergeMemberData) => {
  const fadeId = member._fadeInstanceId;
  if (fadeId < 0) return;
  state.batch.deleteInstance(fadeId);
  setInstanceSlot(state, fadeId, -1);
  setInstanceFade(state.fades, fadeId, LOD_FADE_OPAQUE);
  member._fadeInstanceId = -1;
};

/** Adds a member's instance of its geometry (in the batch already): its matrix, its visibility,
 * and on its first build its own mesh out of the spatial index; its own mesh hidden
 * (`TAG_MERGED`) unless the Merging tab shows its group unmerged (debug env only, as
 * `applyBuild`). */
const addMemberInstance = (entityId: number, state: BatchState, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;
  const mesh = getMemberMesh(entityId, world);
  const isFirstBuild = member.instanceId === -1;
  const geometryId = state.geometryIds.get(mesh.geometry)!;
  member.instanceId = state.batch.addInstance(geometryId);
  setInstanceSlot(state, member.instanceId, geometryId);
  state.joinSeq[member.instanceId] = member._joinSeq ?? 0;
  writeMemberColor(state, member, member.instanceId);
  // Drawn whole: a fade the previous batch drew ended with it
  member._fadeInstanceId = -1;
  member._lodFade = undefined;
  setInstanceFade(state.fades, member.instanceId, LOD_FADE_OPAQUE);
  syncMemberPose(entityId, mesh, world);
  instanceMatrix.copy(mesh.matrixWorld);
  writeInstanceMatrix(state, member.instanceId);
  member._batchVersion = world.getComponent(entityId, ComponentType.OBJECT3D)!._lastVersion;
  if (!isBatchMemberShown(entityId, world)) state.batch.setVisibleAt(member.instanceId, false);
  if (isFirstBuild) {
    member._wasSpatialIndexed = world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED);
    world.removeComponent(entityId, ComponentType.SPATIAL_INDEXED);
  }
  if (IS_DEBUG_ENV && isMergeGroupShownUnmerged(state.groupEntityId, world)) return;
  if (!world.hasComponent(entityId, ComponentType.TAG_MERGED)) {
    world.addComponent(entityId, ComponentType.TAG_MERGED, true);
  }
};

/** Calls `fn` with a member's own geometry (the level it shows) and its LOD's level geometries
 * (the levels `lod()` resolved; none without a LOD). */
const forEachMemberGeometry = (
  entityId: number,
  world: ECSWorld,
  fn: (geometry: THREE.BufferGeometry) => void
) => {
  fn(getMemberMesh(entityId, world).geometry);
  const levels = world.getComponent(entityId, ComponentType.LOD)?._levels;
  if (levels) for (let i = 0; i < levels.length; i++) fn(levels[i].geometry);
};

/** The geometries of `members` and their LOD levels, each once. */
const collectGeometries = (members: readonly number[], world: ECSWorld) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const add = (geometry: THREE.BufferGeometry) => geometries.add(geometry);
  for (const entityId of members) forEachMemberGeometry(entityId, world, add);
  return geometries;
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
  assignJoinSeqs(members, world);
  const byGeometry = groupByGeometry(members, world);
  // The buffers hold the members' LOD levels too
  const geometries = collectGeometries(members, world);
  const { settings } = group;
  let vertices = 0;
  let indices = 0;
  for (const geometry of geometries) {
    vertices += getReservedVertices(settings, geometry);
    indices += getReservedIndices(settings, geometry);
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
  // Its members' (a member of another is refused)
  batch.renderOrder = firstMember.renderOrder;
  // Grouped by geometry, unsorted: one draw per geometry on WebGPU (D1; `setBatchOrder` below)
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
  // A new batch is visible: hidden now if its group is (disabled, held: the Merging tab's A/B)
  reconcileObject3DVisibility(groupEntityId, world);
  const transform = world.getComponent(groupEntityId, ComponentType.TRANSFORM);
  if (transform) {
    transform.position.copy(centre);
    transform.setDirty();
    world.commitTransform(groupEntityId, transform);
  }

  const joinSeq: number[] = [];
  const state: BatchState = {
    group,
    groupEntityId,
    batch,
    geometryIds: new Map(),
    slotGeometries: [],
    slotInstances: [],
    slotIsLevel: [],
    freeSlots: [],
    centre,
    maxVertexCount,
    maxIndexCount: Math.max(maxIndexCount, 1),
    isRebuildDue: false,
    geometryAt: [],
    isOrderDirty: true,
    runs: 0,
    geometriesInUse: 0,
    compactions: 0,
    order: 'NONE',
    hasLodMembers: false,
    isMultiDraw: isMultiDrawBackend(),
    seen: [],
    countStamp: 0,
    // Before the batch's first build: its material's LOD dither reads them
    fades: createBatchFades(batch, batch.maxInstanceCount),
    joinSeq,
    sortByJoin: createJoinSort(joinSeq),
  };
  batch.addEventListener('dispose', () => state.fades.texture.dispose());
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
  // The members' geometries and their levels, the levels no member shows now too
  addGeometries(state, geometries);
  markLevelSlots(state, members, world);
  for (const ids of byGeometry.values()) {
    for (const entityId of ids) addMemberInstance(entityId, state, world);
  }
  const opaqueOrder = state.isMultiDraw ? 'NONE' : 'COMPACT';
  setBatchOrder(state, material.transparent ? settings.transparentOrder ?? 'DEPTH' : opaqueOrder);
  if (members.some((entityId) => world.hasComponent(entityId, ComponentType.LOD))) {
    noteBatchLodMember(state);
  }
  return state;
};

/** Makes room for `newcomers` and their geometries (their LOD levels too) the batch doesn't hold
 * yet, and adds those. */
const growBatch = (state: BatchState, newcomers: readonly number[], world: ECSWorld) => {
  const { batch } = state;
  addGeometries(state, collectGeometries(newcomers, world));
  markLevelSlots(state, newcomers, world);
  growInstances(state, batch.instanceCount + newcomers.length);
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
      assignJoinSeqs(newcomers, world);
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
  deleteFadeInstance(state, member);
  member._lodFade = undefined;
  state.batch.deleteInstance(member.instanceId);
  setInstanceSlot(state, member.instanceId, -1);
  setInstanceFade(state.fades, member.instanceId, LOD_FADE_OPAQUE);
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

/** A member being compacted: its geometry, its instance before and that instance's fade. */
type CompactEntry = {
  entityId: number;
  member: MergeMemberData;
  geometryId: number;
  id: number;
  fade: number;
};

/**
 * Compacts a batch (D1): its members' live instance ids, in order, each given the next member in
 * geometry order (by its id before within a geometry), so each geometry's instances are one run.
 * Its matrix from its own mesh (the sync's source), its visibility and its fade are written again.
 * A level fade's outgoing instances stay where they are (they go when their fades end). A rare
 * frame's work: it allocates its lists.
 */
const compactBatch = (state: BatchState, world: ECSWorld) => {
  const { batch, geometryAt, fades } = state;
  const entries: CompactEntry[] = [];
  for (const entityId of state.group.members) {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
    if (!member || member.instanceId < 0) continue;
    const { instanceId: id } = member;
    entries.push({ entityId, member, geometryId: geometryAt[id], id, fade: fades.data[id] });
  }
  const ids = entries.map((entry) => entry.id).sort((a, b) => a - b);
  entries.sort((a, b) => a.geometryId - b.geometryId || a.id - b.id);
  entries.forEach((entry, k) => {
    const id = ids[k];
    const { entityId, member, geometryId } = entry;
    member.instanceId = id;
    geometryAt[id] = geometryId;
    batch.setGeometryIdAt(id, geometryId);
    setInstanceFade(fades, id, entry.fade);
    state.joinSeq[id] = member._joinSeq ?? 0;
    writeMemberColor(state, member, id);
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
      // A level fade's outgoing instance moves with it
      if (member._fadeInstanceId >= 0)
        state.batch.setMatrixAt(member._fadeInstanceId, instanceMatrix);
      if (growBatchSphere(state, mesh.geometry)) hasGrown = true;
    }
    if (hasGrown) rejoinSpatialIndex(groupEntityId, world);
    if (state.isOrderDirty) {
      state.isOrderDirty = false;
      countRuns(state);
      if (state.order === 'COMPACT' && state.runs > COMPACT_RUNS_FACTOR * state.geometriesInUse) {
        compactBatch(state, world);
      }
    }
  }
};

// --- LOD PER MEMBER (p375 Phase 2): what MergeBatchLod.ts' delegate work uses ---

/**
 * A member's batch, while it has an instance in one.
 * @internal
 */
export const getMemberState = (member: MergeMemberData | undefined, world: ECSWorld) => {
  if (!member || member.instanceId < 0) return undefined;
  const group = world.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
  return group && states.get(group);
};

/**
 * Gives a member's instance `geometry` (one of its levels) in place, adding the member's levels
 * first when the batch doesn't hold it (a LOD that came after the member's build), and grows the
 * batch's sphere to hold it there.
 * @internal
 */
export const setInstanceGeometry = (
  state: BatchState,
  entityId: number,
  instanceId: number,
  geometry: THREE.BufferGeometry,
  world: ECSWorld
) => {
  let geometryId = state.geometryIds.get(geometry);
  if (geometryId === undefined) {
    const geometries = collectGeometries([entityId], world);
    geometries.add(geometry);
    addGeometries(state, geometries);
    markLevelSlots(state, [entityId], world);
    geometryId = state.geometryIds.get(geometry)!;
  }
  if (state.geometryAt[instanceId] === geometryId) return;
  state.batch.setGeometryIdAt(instanceId, geometryId);
  setInstanceSlot(state, instanceId, geometryId);
  state.batch.getMatrixAt(instanceId, instanceMatrix);
  if (growBatchSphere(state, geometry)) rejoinSpatialIndex(state.groupEntityId, world);
};

/**
 * Writes a batched member's geometry into its batch again (`updateMergeMember`): its own mesh's
 * geometry rewritten in its slot (every instance of it then draws the new data), or, when its mesh
 * has another geometry now, its instance given that one (the old one's slot freed when no instance
 * uses it). Its batch's sphere grows to hold what the geometry's instances draw.
 * @internal
 */
export const updateBatchMemberGeometry = (
  entityId: number,
  member: MergeMemberData,
  group: MergeGroupData,
  world: ECSWorld
) => {
  const state = states.get(group);
  if (!state || member.instanceId < 0) return;
  const { geometry } = getMemberMesh(entityId, world);
  const { geometryAt, batch } = state;
  if (state.slotGeometries[geometryAt[member.instanceId]] !== geometry) {
    setInstanceGeometry(state, entityId, member.instanceId, geometry, world);
    return;
  }
  const slot = rewriteGeometry(state, geometry);
  let hasGrown = false;
  for (let id = 0; id < geometryAt.length; id++) {
    if (geometryAt[id] !== slot) continue;
    batch.getMatrixAt(id, instanceMatrix);
    if (growBatchSphere(state, geometry)) hasGrown = true;
  }
  if (hasGrown) rejoinSpatialIndex(state.groupEntityId, world);
};
