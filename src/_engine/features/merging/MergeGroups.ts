// Mesh merge groups (docs/plans/p372_mesh-merge-groups.md): mesh entities sharing a material drawn
// as one merged mesh, owned by a group entity (`MERGE_GROUP`), each member (`MERGE_MEMBER`)
// keeping its entity, transform, body and asset refs. A built member is hidden by `TAG_MERGED`,
// a reason of the kernel's visibility reconcile (`reconcileObject3DVisibility`), whose hooks this
// feature registers, as `lod()` does `TAG_LOD_CULLED`'s.
import { reconcileObject3DVisibility } from '../../kernel/ecs/ECSCoreSystems';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';

// The TAG_MERGED hooks' overrides: constants, so a toggle allocates nothing
const IS_MERGED = Object.freeze({ isMerged: true });
const IS_UNMERGED = Object.freeze({ isMerged: false });

/**
 * Installs the merge groups (the `merging()` feature's install, MergingFeature.ts): the
 * `TAG_MERGED` visibility hooks.
 * @internal
 */
export const installMergeGroups = (ctx: FeatureContext) => {
  ctx.registerComponentHooks(ComponentType.TAG_MERGED, {
    onAddComponent: (entityId, world) => reconcileObject3DVisibility(entityId, world, IS_MERGED),
    onRemoveComponent: (entityId, world) =>
      reconcileObject3DVisibility(entityId, world, IS_UNMERGED),
  });
};
