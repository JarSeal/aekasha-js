// The Merging windows' undo / redo (docs/plans/p373_merge-debug-and-member-editing.md D2): a
// dissolve (undone by making the group again with the same members) and a member's removal (undone
// by adding it back). Entries are per scene, and their entities are named by entity id: members
// rarely have a stable app id (largeWorld's ruins have none), and an id means another entity after
// a reload or on another visit of the scene. So each entry carries the visit it was recorded in
// (`visit`, new on every scene exit and on every page load), and an undo or redo from another
// visit warns and does nothing. The handlers register at this module's load.
import * as THREE from 'three/webgpu';
import { getECSWorld, type ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { registerOnAllSceneExits } from '../../../kernel/scene/Scene';
import { lwarn } from '../../../utils/Logger';
import {
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import {
  addToMergeGroup,
  createMergeGroup,
  dissolveMergeGroup,
  removeFromMergeGroup,
} from '../MergeGroups';
import { createGroup, getGroups } from '../MergeState';
import type { MergeGroupSettings } from '../MergeTypes';

/** The action types this module records. */
export const MERGE_DISSOLVE_ACTION = 'merge.dissolve';
export const MERGE_REMOVE_ACTION = 'merge.removeMember';

/** The scene visit the entity ids are valid in: new on every scene exit (and page load). */
let visit = THREE.MathUtils.generateUUID();
registerOnAllSceneExits('mergingDebugUndoVisit', () => {
  visit = THREE.MathUtils.generateUUID();
});

/** The current scene visit's token (the tests'). */
export const getMergeUndoVisit = () => visit;

/** What makes a group again: its id, kind and settings (plain JSON, as an entry must be). */
type GroupSnapshot = { groupId: string; isAuto: boolean; settings: MergeGroupSettings };

/** A dissolve: the group and its members (entity ids, valid in `visit`). */
export type MergeDissolvePayload = GroupSnapshot & { visit: string; members: number[] };
/** A member's removal: the member and its group. */
export type MergeRemovePayload = GroupSnapshot & { visit: string; entityId: number };

/** Whether an entry belongs to this visit; else warns that it can't be applied. */
const isSameVisit = (payload: { visit: string; groupId: string }, what: string) => {
  if (payload.visit === visit) return true;
  lwarn(
    `Merging: can't ${what} for the merge group "${payload.groupId}": it was recorded on an earlier visit of the scene (or before a reload), whose entities are gone.`
  );
  return false;
};

/** A group's snapshot, for an entry. */
export const getGroupSnapshot = (groupEntityId: number, world: ECSWorld): GroupSnapshot => {
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
  return { groupId: group.id, isAuto: group._isAuto, settings: { ...group.settings } };
};

/** Adds the members back to the group, making it again (with its settings) when it's gone: an
 * `AUTO` group under its own id, as its bucket made it. Those not alive any more are skipped. */
const addBackToGroup = (snapshot: GroupSnapshot, entityIds: number[], world: ECSWorld) => {
  const { groupId, isAuto, settings } = snapshot;
  if (!getGroups(world).has(groupId)) {
    if (isAuto) createGroup({ ...settings, id: groupId }, world, true);
    else createMergeGroup({ ...settings, id: groupId }, world);
  }
  addToMergeGroup(
    groupId,
    entityIds.filter((entityId) => world.isAlive(entityId)),
    world
  );
};

/**
 * Dissolves a group and records it for undo (the group window's Dissolve).
 */
export const dissolveMergeGroupRecorded = (groupEntityId: number, world = getECSWorld()) => {
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
  if (!group) return;
  const payload: MergeDissolvePayload = {
    ...getGroupSnapshot(groupEntityId, world),
    visit,
    members: group.members.slice(),
  };
  dissolveMergeGroup(group.id, world);
  _recordUndoRedoAction(MERGE_DISSOLVE_ACTION, `Dissolve merge group ${group.id}`, payload);
};

/**
 * Takes a member out of its group and records it for undo (the member window's "Remove from
 * group").
 */
export const removeMergeMemberRecorded = (entityId: number, world = getECSWorld()) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member || !world.hasComponent(member.groupEntityId, ComponentType.MERGE_GROUP)) return;
  const payload: MergeRemovePayload = {
    ...getGroupSnapshot(member.groupEntityId, world),
    visit,
    entityId,
  };
  removeFromMergeGroup([entityId], world);
  _recordUndoRedoAction(
    MERGE_REMOVE_ACTION,
    `Remove entity ${entityId} from merge group ${member.groupId}`,
    payload
  );
};

_registerUndoRedoActionHandler<MergeDissolvePayload>(MERGE_DISSOLVE_ACTION, {
  undo: (payload) => {
    if (isSameVisit(payload, 'undo the dissolve')) {
      addBackToGroup(payload, payload.members, getECSWorld());
    }
  },
  redo: (payload) => {
    if (isSameVisit(payload, 'redo the dissolve')) dissolveMergeGroup(payload.groupId);
  },
});

_registerUndoRedoActionHandler<MergeRemovePayload>(MERGE_REMOVE_ACTION, {
  undo: (payload) => {
    if (isSameVisit(payload, 'undo the removal')) {
      addBackToGroup(payload, [payload.entityId], getECSWorld());
    }
  },
  redo: (payload) => {
    const world = getECSWorld();
    if (!isSameVisit(payload, 'redo the removal')) return;
    if (world.hasComponent(payload.entityId, ComponentType.MERGE_MEMBER)) {
      removeFromMergeGroup([payload.entityId], world);
    }
  },
});
