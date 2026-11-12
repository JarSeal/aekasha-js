// The merge groups' moved-member check (docs/plans/_DONE_p372_mesh-merge-groups.md §3, debug env only):
// a member is static by contract, and one moved without `updateMergeMember` is still drawn where
// it was merged. Every MOVE_CHECK_FRAMES frames (LATE_MAIN, after the render updated the world
// matrices), each built member's world matrix is compared with the one its range was written
// with (`MERGE_MEMBER._bakedMatrix`), and a member that differs is warned about once.
//
// Remerging is never driven by this (§3): a TRANSFORM can change without a member moving (a fixed
// body's one-off sync), so the check only tells.
//
// A batched group's member (p375) moves by contract: its batch sync writes its instance, and its
// `partIndex` stays -1, so the check skips it as one waiting for a build.
import type * as THREE from 'three/webgpu';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { ECSSystemStage } from '../../../kernel/loop/SystemStages';
import { lwarn } from '../../../utils/Logger';

/** How many frames apart the check runs. */
export const MOVE_CHECK_FRAMES = 60;

/** A matrix element difference below this is no move (float noise). */
const EPSILON = 1e-5;

/** Per world: the members warned about (an entity id is unique with its generation), and the
 * frames to the next check. */
const warnedByWorld = new WeakMap<ECSWorld, Set<number>>();
const countdownByWorld = new WeakMap<ECSWorld, number>();

const isSameMatrix = (a: THREE.Matrix4, b: THREE.Matrix4) => {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a.elements[i] - b.elements[i]) > EPSILON) return false;
  }
  return true;
};

/**
 * Warns once about each built member of the world whose world matrix isn't the one it was merged
 * with. The members waiting for a build are skipped (the build reads their pose), and those in an
 * edit session (its end writes their range).
 * @internal
 * @returns the entities warned about in this check
 */
export const _checkMovedMergeMembers = (world: ECSWorld): number[] => {
  const storage = world.getStorage(ComponentType.MERGE_MEMBER);
  if (storage.size === 0) return [];
  let warned = warnedByWorld.get(world);
  if (!warned) warnedByWorld.set(world, (warned = new Set()));
  const found: number[] = [];
  for (const [entityId, member] of storage) {
    // One waiting for its build or batched (partIndex -1), or in an edit session (drawn by its own
    // mesh, merged at its end)
    if (member.partIndex === -1 || member._editPose || warned.has(entityId)) continue;
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    if (!mesh) continue;
    mesh.updateWorldMatrix(true, false);
    if (isSameMatrix(mesh.matrixWorld, member._bakedMatrix)) continue;
    warned.add(entityId);
    found.push(entityId);
    lwarn(
      `Merge group "${member.groupId}": its member, entity ${entityId}, moved without updateMergeMember, so it's still drawn where it was merged. Call updateMergeMember after moving it (or rebuildMergeGroup).`
    );
  }
  return found;
};

const mergeMoveCheckSystem = (world: ECSWorld) => {
  const countdown = (countdownByWorld.get(world) ?? MOVE_CHECK_FRAMES) - 1;
  if (countdown > 0) {
    countdownByWorld.set(world, countdown);
    return;
  }
  countdownByWorld.set(world, MOVE_CHECK_FRAMES);
  _checkMovedMergeMembers(world);
};

/**
 * Adds the moved-member check to every world (the `merging()` feature's debug hook).
 * @internal
 */
export const _installMergeDebug = () => {
  ECSWorld.registerPlugin((world) => {
    world.addSystem(ECSSystemStage.LATE_MAIN, 'mergeMoveCheckSystem', mergeMoveCheckSystem);
  });
};
