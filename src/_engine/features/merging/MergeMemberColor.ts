// A batched member's colour (docs/plans/p375_batched-mesh-batches.md, Phase 3 S3): a colour and an
// opacity multiplied into the group's material for one member, its batch instance's colour
// (three's `setColorAt`, a `vec4` the material multiplies into its colour before its opacity, so
// the alpha fades a transparent member: p309's decals). Kept on `MERGE_MEMBER._color` and written
// to the batch by its lazy code (MergeBatch.ts' `writeBatchMemberColor`; a member waiting for its
// build gets it at the build). Its own module: a build drops it until an app calls it.
import * as THREE from 'three/webgpu';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { lwarn } from '../../utils/Logger';
import { getMergeBatchModule, isBatchedGroup } from './MergeBatchFront';
import { assertMergingInstalled } from './MergeGroups';

/** {@link setMergeMemberColor}'s options: each one given replaces the member's, each one left out
 * keeps it. */
export type MergeMemberColorOptions = {
  /** The colour multiplied into the group material's colour for this member (white: the
   * material's own). Default: the member's (white until set). */
  color?: THREE.ColorRepresentation;
  /** Multiplied into the material's opacity for this member: a transparent material fades with it
   * (with `alphaTest`, it's cut away below the test). Default: the member's (1 until set). */
  opacity?: number;
};

const scratchColor = new THREE.Color();

/**
 * Sets a `BATCHED` merge group member's colour and opacity, multiplied into its group's material
 * for that member alone (its instance's colour in the batch): a decal fading out, a unit tinted by
 * its team. Writes only when they changed, without allocating, so it can run every frame.
 * @param entityId a member of a `BATCHED` group
 * @param opts the colour and opacity; one left out keeps the member's
 * @param world the member's world (default: the default world)
 * @throws without the `merging()` feature
 * @remarks The colour is the batch's: it lasts while the entity is in its group (a member that
 * leaves is drawn by its own mesh, with its material's colour), and a member waiting for its
 * group's build gets it at the build. A baked group's member, or an entity in no group, warns and
 * does nothing. The batch's first colour makes it compile its shader again (its material reads
 * the colours from then on).
 * @example
 * ```ts
 * import { setMergeMemberColor } from 'aekasha/merging';
 *
 * // A decal fading out over its last second, called every frame (one options object, reused)
 * const fade = { opacity: 1 };
 * export const fadeDecal = (decal: number, secondsLeft: number) => {
 *   fade.opacity = Math.min(1, Math.max(0, secondsLeft));
 *   setMergeMemberColor(decal, fade);
 * };
 * ```
 */
export const setMergeMemberColor = (
  entityId: number,
  opts: MergeMemberColorOptions,
  world?: ECSWorld
) => {
  assertMergingInstalled('setMergeMemberColor');
  const ecsWorld = world ?? getECSWorld();
  const member = ecsWorld.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const group = member && ecsWorld.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
  if (!member || !group || !isBatchedGroup(group)) {
    lwarn(
      `setMergeMemberColor: entity ${entityId} isn't in a BATCHED merge group (a baked group's members are one mesh).`
    );
    return;
  }
  const current = member._color;
  let r = current?.r ?? 1;
  let g = current?.g ?? 1;
  let b = current?.b ?? 1;
  if (opts.color !== undefined) {
    scratchColor.set(opts.color);
    ({ r, g, b } = scratchColor);
  }
  const a = opts.opacity ?? current?.a ?? 1;
  if (current) {
    if (current.r === r && current.g === g && current.b === b && current.a === a) return;
    current.r = r;
    current.g = g;
    current.b = b;
    current.a = a;
  } else {
    // White and opaque is what an instance without a colour draws
    if (r === 1 && g === 1 && b === 1 && a === 1) return;
    member._color = { r, g, b, a };
  }
  getMergeBatchModule()?.writeBatchMemberColor(member, group);
};
