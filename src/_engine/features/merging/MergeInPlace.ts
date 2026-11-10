// A merge group's in-place member updates (docs/plans/p372_mesh-merge-groups.md §3, Phase 2):
// changes to one member written into the group's built geometry without a rebuild. A move
// rewrites the member's vertices (`updateMergeMember`); a leave (`removeFromMergeGroup`, a
// deleted member) collapses its triangles and counts its vertices as wasted, and past
// COMPACT_WASTE_SHARE of the merged vertices the group builds again, compact.
import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { lwarn } from '../../utils/Logger';
import {
  collapsePartIndex,
  flipPartWinding,
  growMergedBounds,
  rewritePartVertices,
} from './MergeRanges';
import { getGroupMesh, getMemberMesh, markPending, syncMemberPose } from './MergeState';
import type { MergeGroupData, MergeMemberData } from './MergeTypes';

/**
 * A group builds again, compact, once its collapsed (wasted) vertices pass this share of its
 * merged ones.
 * @internal
 */
export const COMPACT_WASTE_SHARE = 0.25;

const groupInverse = new THREE.Matrix4();
const partMatrix = new THREE.Matrix4();
const previousPartMatrix = new THREE.Matrix4();

/** A built member's range in its group's geometry, with the group's mesh, or undefined. */
const getMemberRange = (member: MergeMemberData, world: ECSWorld) => {
  if (member.partIndex === -1) return undefined;
  const groupMesh = getGroupMesh(member.groupEntityId, world);
  const range = groupMesh?.geometry.userData.mergeParts?.[member.partIndex];
  return groupMesh && range ? { groupMesh, range } : undefined;
};

/**
 * Writes a built member's range for its pose now (`updateMergeMember`): its vertices, its
 * winding when its mirroring changed, and the merged bounds when it moved out of them. A member
 * whose geometry no longer fits its range (another vertex count) makes the group build again.
 * @internal
 */
export const rewriteMember = (
  entityId: number,
  member: MergeMemberData,
  group: MergeGroupData,
  world: ECSWorld
) => {
  const found = getMemberRange(member, world);
  if (!found) return;
  const { groupMesh, range } = found;
  const merged = groupMesh.geometry;
  const groupEntityId = member.groupEntityId;
  const mesh = getMemberMesh(entityId, world);
  if (mesh.geometry.getAttribute('position').count !== range.vertexCount) {
    lwarn(
      `updateMergeMember: entity ${entityId}'s geometry isn't the one merged (another vertex count): its merge group "${group.id}" builds again.`
    );
    markPending(world, groupEntityId, group);
    return;
  }
  syncMemberPose(entityId, mesh, world);
  groupMesh.updateWorldMatrix(true, false);
  groupInverse.copy(groupMesh.matrixWorld).invert();
  partMatrix.multiplyMatrices(groupInverse, mesh.matrixWorld);
  previousPartMatrix.multiplyMatrices(groupInverse, member._bakedMatrix);
  if (rewritePartVertices(merged, range, mesh.geometry, partMatrix, previousPartMatrix)) {
    flipPartWinding(merged, range);
  }
  member._bakedMatrix.copy(mesh.matrixWorld);
  if (
    growMergedBounds(merged, mesh.geometry, partMatrix) &&
    world.hasComponent(groupEntityId, ComponentType.SPATIAL_INDEXED)
  ) {
    // Joined again, so the spatial index measures the grown bounds
    world.removeComponent(groupEntityId, ComponentType.SPATIAL_INDEXED);
    world.addComponent(groupEntityId, ComponentType.SPATIAL_INDEXED, true);
  }
};

/**
 * Takes a leaving member (removed or deleted) out of its group: out of `members` and
 * `partIndex`, its built range collapsed and counted as wasted, and the group marked for a
 * compacting build once the waste passes COMPACT_WASTE_SHARE. A member not built yet only leaves
 * the lists: the next build leaves it out. Its own components stay (`releaseMember` lets it go).
 * @internal
 */
export const dropMember = (
  entityId: number,
  member: MergeMemberData,
  group: MergeGroupData,
  world: ECSWorld
) => {
  const index = group.members.indexOf(entityId);
  if (index >= 0) group.members.splice(index, 1);
  group.partIndex.delete(entityId);
  const found = getMemberRange(member, world);
  if (!found) return;
  const merged = found.groupMesh.geometry;
  collapsePartIndex(merged, found.range);
  group.wasted += found.range.vertexCount;
  if (group.wasted > merged.getAttribute('position').count * COMPACT_WASTE_SHARE) {
    markPending(world, member.groupEntityId, group);
  }
};
