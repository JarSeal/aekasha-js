// What the Merging tab and its windows read of the merge groups (docs/plans/_DONE_p373_merge-debug-and-member-editing.md
// D1, D2): names, a group's vertices and cell, the summary's figures (counts, draws per pass,
// waste), the build and update rates, and the refusals still standing; a batched group's batch
// figures (p375 S5: its instances, visible ones, geometry runs and compactions; Phase 2 S5: its
// members' LOD, their level geometries, fades and outgoing instances). Pure reads of the
// components, of the merging code's debug figures (MergeState.ts' `getMergeDebugStats`) and of a
// batch's state (MergeBatch.ts' `getBatchState`, through the loader: the batch code isn't pulled
// into the debugger's chunk, and no batch exists before it's loaded).
import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { AUTO_ID_PREFIX } from '../MergeAuto';
import { getMergeBatchModule, isBatchedGroup } from '../MergeBatchFront';
import { findPending, findQueued, getGroupMesh, getMergeDebugStats } from '../MergeState';
import type { BatchOrder } from '../MergeBatch';
import type { MergeGeometryReserve, MergeGroupData, MergeMemberData } from '../MergeTypes';

/** The Merging drawer tab's id. */
export const MERGING_TAB_ID = 'mergingControls';

/** A count with thousands separators. */
export const formatCount = (n: number) => n.toLocaleString('en-US');

/** A count and its noun, eg. "1 run", "20 runs" (`plural`: the noun's plural, default `<noun>s`). */
export const formatCountOf = (n: number, noun: string, plural = `${noun}s`) =>
  `${formatCount(n)} ${n === 1 ? noun : plural}`;

/** Whether a member is drawn by its group's build: a part of a baked group's geometry, or an
 * instance of a batched group's batch. */
export const isMergeMemberBuilt = (member: MergeMemberData) =>
  member.partIndex !== -1 || member.instanceId >= 0;

/** A batched group's batch, once built (the batch code loaded), else undefined. */
export const getGroupBatchState = (group: MergeGroupData) =>
  isBatchedGroup(group) ? getMergeBatchModule()?.getBatchState(group) : undefined;

/** A batched group's batch figures. */
export type MergeBatchFigures = {
  /** Members with an instance */
  instances: number;
  /** …of which shown (`setVisibleAt`: not disabled, held or culled by the engine; three's own
   * per-member culling is per pass, not counted) */
  visible: number;
  /** The batch's instances: the members' and their level fades' outgoing ones */
  batchInstances: number;
  /** The instances the batch has room for */
  maxInstances: number;
  /** Geometries the batch holds, and those its instances use */
  geometries: number;
  geometriesInUse: number;
  /** Its geometry slots, of which free (a geometry no instance used any more: the next one that
   * fits takes it), and the room its group reserves for each (`geometryReserve`) */
  slots: number;
  freeSlots: number;
  reserve: MergeGeometryReserve | undefined;
  /** Members with a colour (`setMergeMemberColor`) */
  colored: number;
  /** Of the geometries it holds, those a member's LOD has as a level */
  levelGeometries: number;
  /** Members with an instance and a `LOD` */
  lodMembers: number;
  /** Members in a level fade (each with an outgoing instance), and in a cull fade (out or in) */
  levelFades: number;
  cullFades: number;
  /** Members the LOD culled, their instance hidden (a cull fading out is still drawn) */
  lodCulled: number;
  /** The vertices its geometries take, and its vertex buffer's size */
  vertices: number;
  maxVertices: number;
  /** Its geometry runs in instance id order at the sync's last count (a draw each on WebGPU) */
  runs: number;
  /** Its compactions so far */
  compactions: number;
  /** How it orders its draws (MergeBatch.ts' `BatchOrder`; S4 shows the transparent ones) */
  order: BatchOrder;
  /** Its draws per pass with every member in view: its runs (`COMPACT`), the geometries in use
   * (`RANGE_SORT`), at most its shown instances (`DEPTH`, `JOIN`: sorted, a geometry's instances
   * merge only where they're adjacent), one multi-draw (WebGL2) */
  draws: number;
  /** Drawn by a multi-draw backend (WebGL2) */
  isMultiDraw: boolean;
  /** Whether each member is frustum-culled on its own */
  perMemberCulling: boolean;
};

/** A batch's draws per pass with every member in view, by its order (a sorted one's at most its
 * `shown` instances); one before the sync's first count. */
const getBatchDraws = (
  state: { order: BatchOrder; runs: number; geometriesInUse: number; isMultiDraw: boolean },
  shown: number
) => {
  if (state.isMultiDraw || state.order === 'NONE') return 1;
  if (state.order === 'DEPTH' || state.order === 'JOIN') return Math.max(shown, 1);
  return Math.max(state.order === 'RANGE_SORT' ? state.geometriesInUse : state.runs, 1);
};

/**
 * A transparent batch's order in words ("sorted back to front", "in join order"), or undefined
 * for an opaque one.
 */
export const getSortedOrderText = (order: BatchOrder) =>
  order === 'DEPTH' ? 'sorted back to front' : order === 'JOIN' ? 'in join order' : undefined;

/** A batched group's batch figures, or null before its first build (or for a baked group). */
export const getMergeBatchFigures = (
  group: MergeGroupData,
  world: ECSWorld
): MergeBatchFigures | null => {
  const state = getGroupBatchState(group);
  if (!state) return null;
  const { batch } = state;
  let instances = 0;
  let visible = 0;
  let lodMembers = 0;
  let levelFades = 0;
  let cullFades = 0;
  let lodCulled = 0;
  let colored = 0;
  const levelGeometries = new Set<THREE.BufferGeometry>();
  for (const entityId of group.members) {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
    if (!member || member.instanceId < 0) continue;
    instances++;
    if (batch.getVisibleAt(member.instanceId)) visible++;
    if (member._color) colored++;
    if (member._fadeInstanceId >= 0) levelFades++;
    else if (member._lodFade) cullFades++;
    const lod = world.getComponent(entityId, ComponentType.LOD);
    if (!lod) continue;
    lodMembers++;
    for (const level of lod._levels) {
      if (state.geometryIds.has(level.geometry)) levelGeometries.add(level.geometry);
    }
    if (
      world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED) &&
      !world.hasComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING)
    ) {
      lodCulled++;
    }
  }
  return {
    instances,
    visible,
    batchInstances: batch.instanceCount,
    maxInstances: batch.maxInstanceCount,
    geometries: state.geometryIds.size,
    geometriesInUse: state.geometriesInUse,
    slots: state.slotGeometries.length,
    freeSlots: state.freeSlots.length,
    reserve: group.settings.geometryReserve,
    colored,
    levelGeometries: levelGeometries.size,
    lodMembers,
    levelFades,
    cullFades,
    lodCulled,
    vertices: state.maxVertexCount - batch.unusedVertexCount,
    maxVertices: state.maxVertexCount,
    runs: state.runs,
    compactions: state.compactions,
    order: state.order,
    draws: getBatchDraws(state, visible + levelFades),
    isMultiDraw: state.isMultiDraw,
    perMemberCulling: batch.perObjectFrustumCulled,
  };
};

/**
 * A batched member's colour (`setMergeMemberColor`), eg. "#ff8040, opacity 0.5": its hex in sRGB,
 * as a material's colour is written; "white, opaque (none set)" without one.
 */
export const getMemberColorText = (member: MergeMemberData) => {
  const color = member._color;
  if (!color) return 'white, opaque (none set)';
  const hex = new THREE.Color(color.r, color.g, color.b).getHexString();
  return `#${hex}, opacity ${Math.round(color.a * 100) / 100}`;
};

/** A geometry reserve in words: "64 vertices, 192 indices", or each geometry's own size. */
export const getReserveText = (reserve: MergeGeometryReserve | undefined) => {
  if (!reserve) return "each geometry's own size";
  const indices = reserve.indices === undefined ? '' : `, ${formatCount(reserve.indices)} indices`;
  return `${formatCount(reserve.vertices)} vertices${indices}`;
};

/** An entity's readable name: its fixed app id (a mesh's id when it was given one), its debug
 * name, else "Entity N" (a mesh made without an id has its uuid as its mesh id: no name). */
export const getMergeEntityName = (entityId: number, world: ECSWorld) => {
  const appId = world.getComponent(entityId, ComponentType.APP_ID);
  if (appId?.isFixed) return appId.id;
  return world.getComponent(entityId, ComponentType.DEBUG_DATA)?.name ?? `Entity ${entityId}`;
};

/** A material's readable name: its registered id, its name, else the start of its uuid. */
export const getMaterialLabel = (material: THREE.Material | null) => {
  if (!material) return 'none yet';
  const id = material.userData.id as string | undefined;
  return id || material.name || `uuid ${material.uuid.slice(0, 8)}`;
};

/** An `AUTO` group's cell from its id (`auto:<hash>:<cx>,<cz>:<n>`), eg. "2, -1 (#0)", or null
 * for an explicit group. */
export const getAutoCellLabel = (groupId: string) => {
  if (!groupId.startsWith(AUTO_ID_PREFIX)) return null;
  const [, , cell, n] = groupId.split(':');
  return cell === undefined ? null : `${cell.replace(',', ', ')} (#${n ?? 0})`;
};

/** A member's own vertex count. */
const getMemberVertices = (entityId: number, world: ECSWorld) => {
  const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)?.value as
    | THREE.Mesh
    | undefined;
  return mesh?.geometry?.getAttribute('position')?.count ?? 0;
};

/** A baked group's merged vertices once built (collapsed ones included), else its members' sum; a
 * batched group's members' sum (what its instances draw: its batch holds each geometry once). */
export const getGroupVertexCount = (
  groupEntityId: number,
  group: MergeGroupData,
  world: ECSWorld
) => {
  const mesh = isBatchedGroup(group) ? undefined : getGroupMesh(groupEntityId, world);
  if (mesh) return mesh.geometry.getAttribute('position').count;
  let sum = 0;
  for (const entityId of group.members) sum += getMemberVertices(entityId, world);
  return sum;
};

/** Whether a group's mesh is in the scene and shown (a group whose members all left has none). */
export const isGroupDrawn = (groupEntityId: number, world: ECSWorld) => {
  const mesh = getGroupMesh(groupEntityId, world);
  return Boolean(mesh?.parent && mesh.visible) && !world.isDisabled(groupEntityId);
};

/** The summary pane's figures for a world. */
export type MergeSummary = {
  groups: number;
  /** Groups whose mesh is drawn */
  drawnGroups: number;
  /** Groups waiting for a build */
  pendingGroups: number;
  members: number;
  /** Members in a build (the rest wait for their group's next one) */
  builtMembers: number;
  /** Meshes whose `merge` waits for the next build to join */
  queued: number;
  /** Vertices in the merged geometries, and those batched groups' members draw */
  mergedVertices: number;
  /** Of those, the collapsed ones a compacting build drops */
  wastedVertices: number;
  /** The main pass's draws now: the drawn groups (a batched one's by its order: its geometry runs,
   * the geometries in use when sorted by range, one multi-draw on WebGL2), and the members drawn
   * on their own meanwhile */
  drawsNow: number;
  /** …and with every member drawn on its own */
  drawsUnmerged: number;
  /** The same for one shadow pass (the shadow casters only) */
  shadowDrawsNow: number;
  shadowDrawsUnmerged: number;
};

/** Whether a member's own mesh is drawn now (it waits for a build, isn't disabled or held). */
const isDrawnOnItsOwn = (entityId: number, world: ECSWorld) =>
  !world.isDisabled(entityId) &&
  !world.hasComponent(entityId, ComponentType.TAG_MERGED) &&
  !world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD);

/**
 * Counts a world's groups, members and draws per pass. A draw count is before culling: what the
 * pass submits with everything in view (three culls a group whole, by its bounds).
 */
export const getMergeSummary = (world: ECSWorld): MergeSummary => {
  const summary: MergeSummary = {
    groups: 0,
    drawnGroups: 0,
    pendingGroups: findPending(world)?.size ?? 0,
    members: 0,
    builtMembers: 0,
    queued: findQueued(world)?.size ?? 0,
    mergedVertices: 0,
    wastedVertices: 0,
    drawsNow: 0,
    drawsUnmerged: 0,
    shadowDrawsNow: 0,
    shadowDrawsUnmerged: 0,
  };
  for (const [groupEntityId, group] of world.getStorage(ComponentType.MERGE_GROUP)) {
    summary.groups++;
    summary.wastedVertices += group.wasted;
    const mesh = getGroupMesh(groupEntityId, world);
    if (!mesh) continue;
    const batch = getGroupBatchState(group);
    summary.mergedVertices += batch
      ? getGroupVertexCount(groupEntityId, group, world)
      : mesh.geometry.getAttribute('position').count;
    if (!isGroupDrawn(groupEntityId, world)) continue;
    // A batch's runs are counted by its sync: one draw before its first (a sorted one's at most its
    // instances, hidden ones included: the summary doesn't walk the members)
    const draws = batch ? getBatchDraws(batch, batch.batch.instanceCount) : 1;
    summary.drawnGroups++;
    summary.drawsNow += draws;
    if (mesh.castShadow) summary.shadowDrawsNow += draws;
  }
  for (const [entityId, member] of world.getStorage(ComponentType.MERGE_MEMBER)) {
    summary.members++;
    if (isMergeMemberBuilt(member)) summary.builtMembers++;
    if (world.isDisabled(entityId)) continue;
    const castShadow = Boolean(
      world.getComponent(entityId, ComponentType.OBJECT3D)?.value.castShadow
    );
    summary.drawsUnmerged++;
    if (castShadow) summary.shadowDrawsUnmerged++;
    if (isDrawnOnItsOwn(entityId, world)) {
      summary.drawsNow++;
      if (castShadow) summary.shadowDrawsNow++;
    }
  }
  return summary;
};

/** One sample of the counters a rate is read from. */
type RateSample = { at: number; builds: number; updates: number };

/** How far back a rate looks, in ms. */
const RATE_WINDOW_MS = 1000;

/**
 * The builds and in-place updates of the last second, from samples taken on each read (the tab's
 * refreshes): the counts since the newest sample at least a second old, or since the first one.
 */
export const createMergeRateMeter = () => {
  const samples: RateSample[] = [];
  return {
    read: (world: ECSWorld, now: number) => {
      const { builds, inPlaceUpdates } = getMergeDebugStats(world);
      samples.push({ at: now, builds, updates: inPlaceUpdates });
      // Keep one sample at least a window old, as the base
      while (samples.length > 2 && now - samples[1].at >= RATE_WINDOW_MS) samples.shift();
      const base = samples[0];
      return { builds: builds - base.builds, updates: inPlaceUpdates - base.updates };
    },
    /** Starts again (a scene change: the counters stay, the rate restarts). */
    reset: () => {
      samples.length = 0;
    },
  };
};

/** A refused entity still standing: alive and in no group. */
export type MergeRefusalRow = { entityId: number; groupId: string; reason: string };

/** The world's refusals whose entity is alive and in no group, newest first. */
export const getStandingRefusals = (world: ECSWorld): MergeRefusalRow[] => {
  const rows: MergeRefusalRow[] = [];
  for (const [entityId, record] of getMergeDebugStats(world).refusals) {
    if (!world.isAlive(entityId) || world.hasComponent(entityId, ComponentType.MERGE_MEMBER)) {
      continue;
    }
    rows.push({ entityId, ...record });
  }
  return rows.reverse();
};
