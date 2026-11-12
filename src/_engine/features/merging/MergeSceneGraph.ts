// A merge member's own mesh out of the scene graph while its group draws it, both modes (p375
// Phase 2 S1 for a batched member, docs/plans/p378_baked-members-out-of-the-scene-graph.md D2 for a
// baked one). The mesh is hidden (`TAG_MERGED`), but three's walks still visit it: the scene's
// `updateMatrixWorld` (twice a frame with PostFX's pre-pass) and every render's projection walk
// (p378 Phase 0: 3.1-6.7 ms of CPU a frame at 20 770 baked members). `TAG_MERGED`'s hooks
// (MergeGroups.ts' install) take it out and put it back under the root scene, so a leave, a
// dissolve, a deleted group, an edit session and "Show unmerged" put it back, and a rebuild, which
// keeps `TAG_MERGED`, leaves it out.
//
// Only a mesh directly under the root scene with no children leaves: there's no parent or place
// among the children to keep, and a group entity's deletion (`disposeGroup`) still finds its
// children. A member anywhere else stays in the graph, hidden, as before.
//
// Its readers don't need its place. Parentless, its world matrix is its local one, as under the
// (untransformed) root scene: `syncMemberPose` (the builds, the in-place writes, the batch's
// instances) and the moved-member check update it themselves, the batch sync and the overlay
// compose its pose, LOD's `measureEntity` reads it as a mesh at the root, frustum culling's
// `getWorldPosition` updates it, and a deleted member's `disposeMesh` takes it from no parent. A
// raycast of the root scene hits its group's mesh instead (`getMergeMemberAtFace`,
// `getMergeMemberAtBatchId`).
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getRootScene } from '../../kernel/scene/Scene';

/** The members' own meshes merging took out of the scene graph. */
const detachedMeshes = new WeakSet<object>();

/**
 * Takes a member's own mesh out of the scene graph (`TAG_MERGED`'s add hook) when its group draws
 * it (a batched member's instance, a baked member's part) and it's directly under the root scene
 * with no children. Any other member stays in the graph, hidden.
 * @internal
 */
export const detachMemberMesh = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member || (member.instanceId < 0 && member.partIndex < 0)) return;
  const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (!object || object.children.length > 0) return;
  const root = getRootScene();
  if (!root || object.parent !== root) return;
  object.removeFromParent();
  detachedMeshes.add(object);
};

/**
 * Puts a member's own mesh back under the root scene when merging took it out (`TAG_MERGED`'s
 * remove hook: it's drawn on its own again).
 * @internal
 */
export const reattachMemberMesh = (entityId: number, world: ECSWorld) => {
  const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (!object || !detachedMeshes.has(object)) return;
  detachedMeshes.delete(object);
  getRootScene()?.add(object);
};
