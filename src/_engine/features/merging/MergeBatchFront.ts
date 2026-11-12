// The batched merge groups' part in the first download (docs/plans/_DONE_p375_batched-mesh-batches.md):
// the batch code's loader and what the first-download paths do with a batched member. The batch
// code (MergeBatch.ts, with three's `BatchedMesh`, about 18 kB minified) loads on the first
// batched group's build, so an app that lists `merging()` without one never downloads it. A member
// that has an instance (`instanceId >= 0`) was added by that code, so it's loaded whenever one
// needs it.
//
// A batched member's own mesh is out of the scene graph while the batch draws it, as a baked
// member's (MergeSceneGraph.ts, both modes; p375 Phase 2 S1 took the batched ones out first). A
// raycast of the root scene hits the batch instead (`getMergeMemberAtBatchId` maps its `batchId`
// to the member).
//
// A batched member's LOD (p375 Phase 2): `batchMemberLodDelegate`, the kernel's mesh draw delegate
// (merging's install sets it), forwards the levels, the cull and the fades of a member its batch
// draws (an instance and `TAG_MERGED`: not while "Show unmerged" draws its own mesh) to the batch
// code; merged again, its instance takes what its own mesh shows (`refreshBatchMember`).
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { LodMeshDrawDelegate } from '../../kernel/ecs/LodTargets';
import type { FeatureContext } from '../../kernel/init/Features';
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

/**
 * A batched member merged (`TAG_MERGED`'s add hook): its instance takes the level and visibility
 * its LOD gave its own mesh while that was drawn. A baked member, or one without an instance yet,
 * has nothing to take.
 * @internal
 */
export const refreshMergedBatchMember = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  // An instance means the code is loaded
  if (member && member.instanceId >= 0) lodModule?.refreshBatchMember(entityId, world);
};

/**
 * A batched member drawn on its own again (`TAG_MERGED`'s remove hook, "Show unmerged"): its LOD
 * no longer tells the batch, so a fade the batch drew ends.
 * @internal
 */
export const endUnmergedBatchMemberFade = (entityId: number, world: ECSWorld) => {
  lodModule?.endBatchMemberFade(entityId, world);
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
