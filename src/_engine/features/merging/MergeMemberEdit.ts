// A merge member's edit sessions and face picking (docs/plans/p373_merge-debug-and-member-editing.md
// D4). A session takes a member out of its group's drawing while it's moved: its range collapses
// (as a disabled member's, no waste) and its own mesh is drawn, following its `TRANSFORM` with no
// per-frame cost in the group; the end writes its range once for where it is then (the in-place
// write `updateMergeMember` makes), so a move needs no rebuild. The session is the member's own
// state (`MERGE_MEMBER._editPose`), so a member removed or deleted mid-session takes it along.
// Picking maps a raycast's face on a group mesh to its member through the build's part table.
//
// Tree-shaken unless an app calls it: what ships with the groups is only the two guards that keep
// a member in a session collapsed (`applyBuild`, `restoreEnabledMember`).
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { getAllECSWorlds, getECSWorld, type ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { registerOnAllSceneExits } from '../../kernel/scene/Scene';
import { lwarn } from '../../utils/Logger';
import { assertMergingInstalled, updateMergeMember } from './MergeGroups';
import { collapseDisabledMember, restoreEnabledMember } from './MergeInPlace';
import {
  getGroupMesh,
  getMemberMesh,
  isMergeGroupShownUnmerged,
  syncMemberPose,
} from './MergeState';

let isSceneExitRegistered = false;

/** A scene exit: every open session is cancelled, in every world (a persistent member gets its
 * pose back; the scene's members go with it anyway). */
const cancelOpenEdits = () => {
  for (const world of getAllECSWorlds()) {
    const open: number[] = [];
    for (const [entityId, member] of world.getStorage(ComponentType.MERGE_MEMBER)) {
      if (member._editPose) open.push(entityId);
    }
    for (const entityId of open) cancelMergeMemberEdit(entityId, world);
  }
};

/**
 * Opens a merge member's edit session: it's drawn by its own mesh, which follows its `TRANSFORM`,
 * and its part of the group's mesh is hidden (collapsed in place, no rebuild), so moving it costs
 * the group nothing per frame. Move it as usual (`setTransform`, a `TRANSFORM` write), then
 * `endMergeMemberEdit` merges it back where it is, or `cancelMergeMemberEdit` puts it back where it
 * was. A member waiting for its group's first build only records its pose. A second begin keeps
 * the first one's pose.
 * @param world the member's world (default: the default world)
 * @throws without the `merging()` feature
 * @remarks A scene exit cancels the open sessions. A member removed from its group or deleted
 * during a session leaves it with its component, drawn on its own where it is. A group rebuilt
 * during a session merges the member at its pose then and keeps it hidden until the end.
 * @example
 * ```ts
 * import { getECSWorld, getEntityIdByAppId } from 'aekasha';
 * import { beginMergeMemberEdit, endMergeMemberEdit } from 'aekasha/merging';
 *
 * const gate = getEntityIdByAppId('ruinGate')!;
 * beginMergeMemberEdit(gate);
 * getECSWorld().setTransform(gate, { pos: { x: 4, y: 0, z: 12 } }); // as often as the drag moves
 * endMergeMemberEdit(gate);
 * ```
 */
export const beginMergeMemberEdit = (entityId: number, world?: ECSWorld): void => {
  assertMergingInstalled('beginMergeMemberEdit');
  const ecsWorld = world ?? getECSWorld();
  const member = ecsWorld.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member) {
    lwarn(`beginMergeMemberEdit: entity ${entityId} isn't in a merge group.`);
    return;
  }
  if (member._editPose) return;
  // The TRANSFORM's pose now, in either storage mode
  const mesh = getMemberMesh(entityId, ecsWorld);
  syncMemberPose(entityId, mesh, ecsWorld);
  member._editPose = {
    position: mesh.position.clone(),
    quaternion: mesh.quaternion.clone(),
    scale: mesh.scale.clone(),
  };
  // Built: its range collapses (a member waiting for its build has none yet)
  collapseDisabledMember(entityId, ecsWorld);
  ecsWorld.removeComponent(entityId, ComponentType.TAG_MERGED);
  if (!isSceneExitRegistered) {
    isSceneExitRegistered = true;
    registerOnAllSceneExits('mergeMemberEdits', cancelOpenEdits);
  }
};

/**
 * Ends a merge member's edit session: its part of the group's mesh is written for its pose now
 * (in place, without a rebuild, as `updateMergeMember`) and drawn again, its own mesh hidden. Its
 * physics body is moved to its `TRANSFORM` (`setTransform`): a fixed body doesn't follow its mesh.
 * A member waiting for its group's first build needs no write (the build reads its pose). Without
 * an open session it does nothing.
 * @param world the member's world (default: the default world)
 * @throws without the `merging()` feature
 * @example
 * ```ts
 * import { getEntityIdByAppId } from 'aekasha';
 * import { endMergeMemberEdit } from 'aekasha/merging';
 *
 * endMergeMemberEdit(getEntityIdByAppId('ruinGate')!);
 * ```
 */
export const endMergeMemberEdit = (entityId: number, world?: ECSWorld): void => {
  assertMergingInstalled('endMergeMemberEdit');
  const ecsWorld = world ?? getECSWorld();
  const member = ecsWorld.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member?._editPose) return;
  member._editPose = undefined;
  // The body follows the pose (its TRANSFORM's own values written back)
  const transform = ecsWorld.getComponent(entityId, ComponentType.TRANSFORM);
  if (transform) {
    ecsWorld.setTransform(entityId, { pos: transform.position, rot: transform.quaternion });
  }
  if (member.partIndex === -1) return;
  // Its vertices for the pose now (its collapsed index untouched), then the index with that
  // pose's winding, unless it's disabled (enabling it writes the index then)
  updateMergeMember(entityId, ecsWorld);
  if (!ecsWorld.isDisabled(entityId)) restoreEnabledMember(entityId, ecsWorld);
  // The Merging tab's A/B (debug env only): a group shown unmerged keeps its members drawn
  const isShownUnmerged = IS_DEBUG_ENV && isMergeGroupShownUnmerged(member.groupEntityId, ecsWorld);
  if (!isShownUnmerged && !ecsWorld.hasComponent(entityId, ComponentType.TAG_MERGED)) {
    ecsWorld.addComponent(entityId, ComponentType.TAG_MERGED, true);
  }
};

/**
 * Cancels a merge member's edit session: its pose at `beginMergeMemberEdit` (position, rotation
 * and scale) is put back on its `TRANSFORM` and its body, and it's merged again there, as
 * `endMergeMemberEdit` does. Without an open session it does nothing.
 * @param world the member's world (default: the default world)
 * @throws without the `merging()` feature
 * @example
 * ```ts
 * import { getEntityIdByAppId } from 'aekasha';
 * import { cancelMergeMemberEdit } from 'aekasha/merging';
 *
 * // Escape during a drag
 * cancelMergeMemberEdit(getEntityIdByAppId('ruinGate')!);
 * ```
 */
export const cancelMergeMemberEdit = (entityId: number, world?: ECSWorld): void => {
  assertMergingInstalled('cancelMergeMemberEdit');
  const ecsWorld = world ?? getECSWorld();
  const pose = ecsWorld.getComponent(entityId, ComponentType.MERGE_MEMBER)?._editPose;
  if (!pose) return;
  const transform = ecsWorld.getComponent(entityId, ComponentType.TRANSFORM);
  if (transform) {
    transform.position.copy(pose.position);
    transform.quaternion.copy(pose.quaternion);
    transform.scale.copy(pose.scale);
    transform.setDirty();
    ecsWorld.commitTransform(entityId, transform);
  }
  endMergeMemberEdit(entityId, ecsWorld);
};

/**
 * Whether a merge member has an open edit session (`beginMergeMemberEdit`).
 * @param world the member's world (default: the default world)
 * @example
 * ```ts
 * import { getEntityIdByAppId } from 'aekasha';
 * import { isMergeMemberInEdit } from 'aekasha/merging';
 *
 * const isMoving = isMergeMemberInEdit(getEntityIdByAppId('ruinGate')!);
 * ```
 */
export const isMergeMemberInEdit = (entityId: number, world?: ECSWorld): boolean =>
  Boolean((world ?? getECSWorld()).getComponent(entityId, ComponentType.MERGE_MEMBER)?._editPose);

/**
 * The merge member a face of a group's mesh belongs to: a raycast that hits a merge group's mesh
 * (its `userData.entityId` is the group's entity) resolves to the member drawn there. A binary
 * search of the group's part table, no allocation.
 * @param groupEntityId the entity the raycast hit (its mesh's `userData.entityId`)
 * @param faceIndex the triangle the raycast hit (its intersection's `faceIndex`)
 * @param world the group's world (default: the default world)
 * @returns the member's entity id, or undefined for a face of no member (one removed since the
 * build), or an entity that isn't a built merge group
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getRootScene } from 'aekasha';
 * import { getMergeMemberAtFace } from 'aekasha/merging';
 *
 * const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
 * const [hit] = ray.intersectObject(getRootScene()!, true);
 * const hitEntityId = hit?.object.userData.entityId as number | undefined;
 * const memberId =
 *   hitEntityId !== undefined && hit.faceIndex != null
 *     ? getMergeMemberAtFace(hitEntityId, hit.faceIndex)
 *     : undefined;
 * ```
 */
export const getMergeMemberAtFace = (
  groupEntityId: number,
  faceIndex: number,
  world?: ECSWorld
): number | undefined => {
  const ecsWorld = world ?? getECSWorld();
  const group = ecsWorld.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
  const parts = group && getGroupMesh(groupEntityId, ecsWorld)?.geometry.userData.mergeParts;
  if (!parts) return undefined;
  const index = faceIndex * 3;
  let low = 0;
  let high = parts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const part = parts[mid];
    if (index < part.indexStart) high = mid - 1;
    else if (index >= part.indexStart + part.indexCount) low = mid + 1;
    else {
      // The build keys each part by its member's entity id; a member gone since has no part
      const entityId = Number(part.key);
      return group.partIndex.get(entityId) === mid ? entityId : undefined;
    }
  }
  return undefined;
};
