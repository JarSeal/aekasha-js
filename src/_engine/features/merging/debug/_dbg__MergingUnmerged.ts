// A merge group shown unmerged (docs/plans/_DONE_p373_merge-debug-and-member-editing.md D3): the
// Merging tab's A/B of image and draws. The group's mesh is held from drawing (`TAG_DRAW_HELD`,
// the kernel's visibility reconcile) and its built members lose `TAG_MERGED`, so each is drawn by
// its own mesh, with its own culling, while staying in the group: its range, part and bookkeeping
// don't change, and a build during the view leaves them drawn (applyBuild reads the view, debug
// env only). Turning it off puts `TAG_MERGED` back and lets go of the hold. A view, not an edit:
// no undo, and every view ends at a scene exit. Default world.
//
// Only a built group (one with a mesh): `OBJECT3D`'s add hook doesn't run the reconcile, so a
// hold made before the first build wouldn't hide the mesh that build adds.
import { getECSWorld, type ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { registerOnAllSceneExits } from '../../../kernel/scene/Scene';
import { getGroupMesh, getMergeUnmergedViews, isMergeGroupShownUnmerged } from '../MergeState';
import { isMergeMemberBuilt } from './_dbg__MergingInfo';

/** Why a group can't be shown unmerged now, or null when it can. */
export const getUnmergedViewRefusal = (groupEntityId: number, world: ECSWorld) => {
  if (!world.hasComponent(groupEntityId, ComponentType.MERGE_GROUP)) {
    return 'The group was dissolved.';
  }
  return getGroupMesh(groupEntityId, world) ? null : 'The group isn’t built yet.';
};

/** Whether a group is shown unmerged (its members drawn on their own). */
export const isMergeGroupUnmergedView = (groupEntityId: number, world = getECSWorld()) =>
  isMergeGroupShownUnmerged(groupEntityId, world);

/** Ends a group's view: its built members merged again, the view's hold let go. */
const endView = (groupEntityId: number, world: ECSWorld) => {
  const views = getMergeUnmergedViews(world);
  if (!views.has(groupEntityId)) return;
  const addedHold = views.get(groupEntityId);
  views.delete(groupEntityId);
  // Dissolved meanwhile: its members were let go (releaseMember)
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
  if (!group) return;
  if (addedHold && world.hasComponent(groupEntityId, ComponentType.TAG_DRAW_HELD)) {
    world.removeComponent(groupEntityId, ComponentType.TAG_DRAW_HELD);
  }
  for (const entityId of group.members) {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
    // One in an edit session stays drawn on its own: its session's end merges it
    if (
      member?.groupEntityId !== groupEntityId ||
      !isMergeMemberBuilt(member) ||
      member._editPose
    ) {
      continue;
    }
    if (!world.hasComponent(entityId, ComponentType.TAG_MERGED)) {
      world.addComponent(entityId, ComponentType.TAG_MERGED, true);
    }
  }
};

/**
 * Shows a built group unmerged (its mesh hidden, its members drawn on their own) or merged again.
 * A group that isn't built, or is gone, stays as it is (`getUnmergedViewRefusal` says why).
 * @returns whether the group is shown unmerged now
 */
export const setMergeGroupUnmergedView = (
  groupEntityId: number,
  isOn: boolean,
  world = getECSWorld()
) => {
  if (!isOn) {
    endView(groupEntityId, world);
    return false;
  }
  const views = getMergeUnmergedViews(world);
  if (views.has(groupEntityId)) return true;
  if (getUnmergedViewRefusal(groupEntityId, world)) return false;
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
  // A hold something else made stays its own
  const addsHold = !world.hasComponent(groupEntityId, ComponentType.TAG_DRAW_HELD);
  views.set(groupEntityId, addsHold);
  if (addsHold) world.addComponent(groupEntityId, ComponentType.TAG_DRAW_HELD, true);
  for (const entityId of group.members) {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
    if (member?.groupEntityId === groupEntityId) {
      world.removeComponent(entityId, ComponentType.TAG_MERGED);
    }
  }
  return true;
};

/** How many of the world's groups are shown unmerged (a dissolved group's view dropped). */
export const getUnmergedViewCount = (world = getECSWorld()) => {
  const views = getMergeUnmergedViews(world);
  for (const groupEntityId of views.keys()) {
    if (!world.hasComponent(groupEntityId, ComponentType.MERGE_GROUP)) views.delete(groupEntityId);
  }
  return views.size;
};

/** A scene exit: every view ends (a persistent group's merged again too). */
const onSceneExit = () => {
  const world = getECSWorld();
  for (const groupEntityId of [...getMergeUnmergedViews(world).keys()]) {
    endView(groupEntityId, world);
  }
};

registerOnAllSceneExits('mergingUnmergedViews', onSceneExit);
