// What the Merging tab and its windows read of the merge groups (docs/plans/_DONE_p373_merge-debug-and-member-editing.md
// D1, D2): names, a group's vertices and cell, the summary's figures (counts, draws per pass,
// waste), the build and update rates, and the refusals still standing. Pure reads of the
// components and of the merging code's debug figures (MergeState.ts' `getMergeDebugStats`).
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { AUTO_ID_PREFIX } from '../MergeAuto';
import { findPending, findQueued, getGroupMesh, getMergeDebugStats } from '../MergeState';
import type { MergeGroupData } from '../MergeTypes';

/** The Merging drawer tab's id. */
export const MERGING_TAB_ID = 'mergingControls';

/** A count with thousands separators. */
export const formatCount = (n: number) => n.toLocaleString('en-US');

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

/** A group's merged vertices once built (collapsed ones included), else its members' sum. */
export const getGroupVertexCount = (
  groupEntityId: number,
  group: MergeGroupData,
  world: ECSWorld
) => {
  const mesh = getGroupMesh(groupEntityId, world);
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
  /** Vertices in the merged geometries */
  mergedVertices: number;
  /** Of those, the collapsed ones a compacting build drops */
  wastedVertices: number;
  /** The main pass's draws now: the drawn groups, and the members drawn on their own meanwhile */
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
    summary.mergedVertices += mesh.geometry.getAttribute('position').count;
    if (!isGroupDrawn(groupEntityId, world)) continue;
    summary.drawnGroups++;
    summary.drawsNow++;
    if (mesh.castShadow) summary.shadowDrawsNow++;
  }
  for (const [entityId, member] of world.getStorage(ComponentType.MERGE_MEMBER)) {
    summary.members++;
    if (member.partIndex !== -1) summary.builtMembers++;
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
