// The batched merge groups' part in the first download (docs/plans/_DONE_p375_batched-mesh-batches.md):
// the batch code's loader and what the first-download paths do with a batched member. The batch
// code (MergeBatch.ts, with three's `BatchedMesh`, about 18 kB minified) loads on the first
// batched group's build, so an app that lists `merging()` without one never downloads it. A member
// that has an instance (`instanceId >= 0`) was added by that code, so it's loaded whenever one
// needs it.
//
// A batched member's own mesh is out of the scene graph while the batch draws it (p375 Phase 2
// S1): three's scene update walked the hidden meshes (0.22 ms at 2 000 members). `TAG_MERGED`'s
// hooks take it out and put it back under the root scene (its parent: `BATCHED` refuses a mesh
// anywhere else), so a leave, a deleted group and "Show unmerged" put it back, and a full
// rebuild, which keeps `TAG_MERGED`, leaves it out. Its readers don't need its place: the sync and
// the overlay compose its pose, LOD's `measureEntity` reads a mesh without a parent as one at the
// root, frustum culling's `getWorldPosition` updates its matrix itself, and a deleted entity's
// `disposeMesh` takes it from no parent. A raycast of the root scene hits the batch instead
// (`getMergeMemberAtBatchId` maps its `batchId` to the member).
//
// A batched member's LOD (p375 Phase 2): `batchMemberLodDelegate`, the kernel's mesh draw delegate
// (merging's install sets it), forwards the levels, the cull and the fades of a member its batch
// draws (an instance and `TAG_MERGED`: not while "Show unmerged" draws its own mesh) to the batch
// code; merged again, its instance takes what its own mesh shows (`refreshBatchMember`).
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { LodMeshDrawDelegate } from '../../kernel/ecs/LodTargets';
import type { FeatureContext } from '../../kernel/init/Features';
import { getRootScene } from '../../kernel/scene/Scene';
import { markPending } from './MergeState';
import type { MergeGroupData, MergeMemberData } from './MergeTypes';

type BatchModule = typeof import('./MergeBatch');
type BatchLodModule = typeof import('./MergeBatchLod');
let batchModule: BatchModule | null = null;
/** Its members' LOD (MergeBatchLod.ts), loaded with it. */
let lodModule: BatchLodModule | null = null;
let batchModulePromise: Promise<BatchModule> | null = null;

/**
 * Loads the batch code and its members' LOD code (once; a failed load is tried again by the next
 * call).
 * @internal
 */
export const loadMergeBatchModuleAsync = () =>
  (batchModulePromise ??= Promise.all([import('./MergeBatch'), import('./MergeBatchLod')]).then(
    ([module, lod]) => {
      lodModule = lod;
      return (batchModule = module);
    },
    (err: unknown) => {
      batchModulePromise = null;
      throw err;
    }
  ));

/**
 * The batch code, once loaded.
 * @internal
 */
export const getMergeBatchModule = () => batchModule;

/**
 * Whether a group draws its members as a batch (`mode: 'BATCHED'`).
 * @internal
 */
export const isBatchedGroup = (group: MergeGroupData) => group.settings.mode === 'BATCHED';

/**
 * Takes a leaving member (removed or deleted) out of its batched group: out of `members`, its
 * instance deleted. Its own components stay (`releaseMember` lets it go). A group left with no
 * member is marked, so its next build deletes it (`AUTO`) or takes its batch out of the scene.
 * @internal
 */
export const dropBatchMember = (
  entityId: number,
  member: MergeMemberData,
  group: MergeGroupData,
  world: ECSWorld
) => {
  const index = group.members.indexOf(entityId);
  if (index >= 0) group.members.splice(index, 1);
  if (member.instanceId >= 0) batchModule?.deleteBatchInstance(member, group);
  member.instanceId = -1;
  if (group.members.length === 0) markPending(world, member.groupEntityId, group);
};

/** The batched members' own meshes merging took out of the scene graph. */
const detachedMeshes = new WeakSet<object>();

/**
 * Takes a batched member's own mesh out of the scene graph (`TAG_MERGED`'s add hook): its batch
 * draws it. A baked member, or a member without an instance yet, stays.
 * @internal
 */
export const detachBatchedMemberMesh = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member || member.instanceId < 0) return;
  // Its LOD changed its own mesh while that was drawn (an instance means the code is loaded)
  lodModule?.refreshBatchMember(entityId, world);
  const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (!object?.parent) return;
  object.removeFromParent();
  detachedMeshes.add(object);
};

/**
 * Puts a member's own mesh back under the root scene when merging took it out (`TAG_MERGED`'s
 * remove hook: it's drawn on its own again).
 * @internal
 */
export const reattachMemberMesh = (entityId: number, world: ECSWorld) => {
  // Its LOD no longer tells the batch ("Show unmerged"): a fade the batch drew ends
  lodModule?.endBatchMemberFade(entityId, world);
  const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (!object || !detachedMeshes.has(object)) return;
  detachedMeshes.delete(object);
  getRootScene()?.add(object);
};

/**
 * The value of a visibility reason a hook is changing, which `isBatchMemberShown` takes over the
 * entity's.
 * @internal
 */
export type BatchVisibilityOverrides = Readonly<{
  isDisabled?: boolean;
  isFrustumCulled?: boolean;
  isDrawHeld?: boolean;
  isLodCulled?: boolean;
  /** `TAG_LOD_TRANSITIONING`: a member fading out to LOD culled is still drawn. */
  isLodFading?: boolean;
}>;

/**
 * The kernel's mesh draw delegate for batched members (merging's install sets it): a member its
 * batch draws (an instance, and `TAG_MERGED`) has its LOD's levels, cull and fades forwarded to
 * the batch code, loaded whenever a member has an instance.
 * @internal
 */
export const batchMemberLodDelegate: LodMeshDrawDelegate = {
  isDrawing: (entityId, world) =>
    lodModule !== null &&
    (world.getComponent(entityId, ComponentType.MERGE_MEMBER)?.instanceId ?? -1) >= 0 &&
    world.hasComponent(entityId, ComponentType.TAG_MERGED),
  applyLevel: (entityId, world, level, fade) =>
    lodModule!.applyBatchMemberLevel(entityId, world, level, fade),
  setCulled: (entityId, world, isCulled, fade) =>
    lodModule!.setBatchMemberLodCulled(entityId, world, isCulled, fade),
  setFade: (entityId, world, progress) => lodModule!.setBatchMemberFade(entityId, world, progress),
};

// The visibility hooks' overrides: the value of the tag a hook changes (a remove hook runs before
// it's gone). Constants, so a toggle allocates nothing
const IS_DISABLED = Object.freeze({ isDisabled: true });
const IS_ENABLED = Object.freeze({ isDisabled: false });
const IS_CULLED = Object.freeze({ isFrustumCulled: true });
const IS_UNCULLED = Object.freeze({ isFrustumCulled: false });
const IS_HELD = Object.freeze({ isDrawHeld: true });
const IS_RELEASED = Object.freeze({ isDrawHeld: false });

/** A hook that shows or hides a batched member's instance for its reasons now, with `overrides`. */
const createVisibilityHook =
  (overrides: BatchVisibilityOverrides) => (entityId: number, world: ECSWorld) => {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
    if (!batchModule || !member || member.instanceId < 0) return;
    const group = world.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
    if (!group) return;
    const isShown = batchModule.isBatchMemberShown(entityId, world, overrides);
    batchModule.setBatchMemberVisible(member, group, isShown);
  };

/**
 * Registers the batched members' visibility hooks (the `merging()` feature's install): `DISABLED`,
 * the engine's frustum culling (`TAG_FRUSTUM_CULLED`, an opt-in) and a draw hold
 * (`TAG_DRAW_HELD`: a scene load's, streaming's) show and hide a member's instance, as they do a
 * mesh drawn on its own; the batch itself is never hidden for one member.
 * @internal
 */
export const installBatchMemberVisibility = (ctx: FeatureContext) => {
  const hooks = (on: BatchVisibilityOverrides, off: BatchVisibilityOverrides) => ({
    onAddComponent: createVisibilityHook(on),
    onRemoveComponent: createVisibilityHook(off),
  });
  ctx.registerComponentHooks(ComponentType.DISABLED, hooks(IS_DISABLED, IS_ENABLED));
  ctx.registerComponentHooks(ComponentType.TAG_FRUSTUM_CULLED, hooks(IS_CULLED, IS_UNCULLED));
  ctx.registerComponentHooks(ComponentType.TAG_DRAW_HELD, hooks(IS_HELD, IS_RELEASED));
};
