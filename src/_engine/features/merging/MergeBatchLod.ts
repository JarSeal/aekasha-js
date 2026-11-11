// A batched merge member's LOD (docs/plans/p375_batched-mesh-batches.md Phase 2): the work of the
// kernel's mesh draw delegate, which MergeBatchFront.ts' `batchMemberLodDelegate` forwards here for
// a member its batch draws. `lod()` has set the level on the member's own mesh already. Part of the
// lazy batch code, loaded with MergeBatch.ts.
//
// A level change gives the member's instance the level's geometry in place (MergeBatch.ts'
// `setInstanceGeometry`). Faded, the member gets a second instance with the outgoing level's
// geometry (`MERGE_MEMBER._fadeInstanceId`) for the fade, and the two dither into each other
// through the batch's fades (MergeBatchFades.ts: the incoming at `progress`, the outgoing at
// `progress - 1`); its end deletes the second instance. A cull fade dithers the one instance out
// (kept drawn until its end, `TAG_LOD_TRANSITIONING`) or in. `MERGE_MEMBER._lodFade` says which fade
// the batch draws: a fade the member came with (merged again mid-fade, or a rebuild's new batch)
// isn't one, and draws it whole until it ends.
import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { LOD_FADE_OPAQUE } from '../../kernel/render/LodFade';
import {
  type BatchState,
  deleteFadeInstance,
  getMemberState,
  growInstances,
  isBatchMemberShown,
  noteBatchLodMember,
  setInstanceGeometry,
  writeMemberColor,
} from './MergeBatch';
import { setInstanceFade } from './MergeBatchFades';
import { setInstanceSlot } from './MergeBatchSlots';
import { getMemberMesh } from './MergeState';
import type { MergeMemberData } from './MergeTypes';

// The cull's overrides (constants: a cull allocates nothing). The cull's add hook runs before its
// fade's tag is added: with a fade, the member is the outgoing copy until the fade ends
const LOD_CULLED = Object.freeze({ isLodCulled: true, isLodFading: false });
const LOD_CULLED_FADING = Object.freeze({ isLodCulled: true, isLodFading: true });
const LOD_SHOWN = Object.freeze({ isLodCulled: false });
const LOD_FADE_ENDED = Object.freeze({ isLodFading: false });

const fadeMatrix = new THREE.Matrix4();

/** Starts a level fade: a second instance of what the member's instance shows now, at its pose
 * and visibility, drawn as the outgoing copy, the instance itself as the incoming one. */
const startLevelFade = (state: BatchState, member: MergeMemberData) => {
  const { batch } = state;
  const id = member.instanceId;
  deleteFadeInstance(state, member);
  growInstances(state, batch.instanceCount + 1);
  const geometryId = state.geometryAt[id];
  const fadeId = batch.addInstance(geometryId);
  setInstanceSlot(state, fadeId, geometryId);
  state.joinSeq[fadeId] = state.joinSeq[id];
  writeMemberColor(state, member, fadeId);
  batch.getMatrixAt(id, fadeMatrix);
  batch.setMatrixAt(fadeId, fadeMatrix);
  batch.setVisibleAt(fadeId, batch.getVisibleAt(id));
  member._fadeInstanceId = fadeId;
  member._lodFade = 'LEVEL';
  setInstanceFade(state.fades, fadeId, -LOD_FADE_OPAQUE);
  setInstanceFade(state.fades, id, 0);
};

/**
 * The LOD delegate's `applyLevel`: the member's instance shows the level's geometry; faded, the
 * level it showed stays as a second instance fading out.
 * @internal
 */
export const applyBatchMemberLevel = (
  entityId: number,
  world: ECSWorld,
  level: { geometry: THREE.BufferGeometry },
  fade: boolean
) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const state = getMemberState(member, world);
  if (!state) return;
  // A LOD that came after the build: the batch sorts by range from now on (WebGPU)
  noteBatchLodMember(state);
  if (fade) startLevelFade(state, member!);
  setInstanceGeometry(state, entityId, member!.instanceId, level.geometry, world);
};

/**
 * The LOD delegate's `setCulled`: hides or shows the member's instance; faded, it dithers out
 * (kept drawn until the fade ends) or in.
 * @internal
 */
export const setBatchMemberLodCulled = (
  entityId: number,
  world: ECSWorld,
  isCulled: boolean,
  fade: boolean
) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const state = getMemberState(member, world);
  if (!state) return;
  const id = member!.instanceId;
  member!._lodFade = fade ? (isCulled ? 'OUT' : 'IN') : undefined;
  setInstanceFade(state.fades, id, fade ? (isCulled ? -LOD_FADE_OPAQUE : 0) : LOD_FADE_OPAQUE);
  const overrides = isCulled ? (fade ? LOD_CULLED_FADING : LOD_CULLED) : LOD_SHOWN;
  state.batch.setVisibleAt(id, isBatchMemberShown(entityId, world, overrides));
};

/**
 * The LOD delegate's `setFade`: the batch's fade at `progress`; 1 ends it (the outgoing instance
 * deleted, a member faded out to LOD culled hidden: its fade's tag goes right after). A fade the
 * batch didn't start draws nothing until its end.
 * @internal
 */
export const setBatchMemberFade = (entityId: number, world: ECSWorld, progress: number) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const state = getMemberState(member, world);
  if (!state) return;
  const id = member!.instanceId;
  if (progress >= 1) {
    deleteFadeInstance(state, member!);
    member!._lodFade = undefined;
    setInstanceFade(state.fades, id, LOD_FADE_OPAQUE);
    state.batch.setVisibleAt(id, isBatchMemberShown(entityId, world, LOD_FADE_ENDED));
    return;
  }
  switch (member!._lodFade) {
    case 'LEVEL':
      setInstanceFade(state.fades, id, progress);
      setInstanceFade(state.fades, member!._fadeInstanceId, progress - 1);
      break;
    case 'OUT':
      setInstanceFade(state.fades, id, progress - 1);
      break;
    case 'IN':
      setInstanceFade(state.fades, id, progress);
      break;
  }
};

/**
 * A batched member merged again (`TAG_MERGED`'s add hook: a build, "Show unmerged" turned off):
 * its instance takes the level its own mesh shows and its visibility now, which the LOD changed
 * on its own mesh meanwhile.
 * @internal
 */
export const refreshBatchMember = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const state = getMemberState(member, world);
  if (!state) return;
  const { geometry } = getMemberMesh(entityId, world);
  setInstanceGeometry(state, entityId, member!.instanceId, geometry, world);
  state.batch.setVisibleAt(member!.instanceId, isBatchMemberShown(entityId, world));
};

/**
 * Ends the fade a batch draws for a member drawn on its own now (`TAG_MERGED`'s remove hook: "Show
 * unmerged"): the LOD no longer tells the batch, so the outgoing instance would stay.
 * @internal
 */
export const endBatchMemberFade = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const state = getMemberState(member, world);
  if (!state || !member!._lodFade) return;
  deleteFadeInstance(state, member!);
  member!._lodFade = undefined;
  setInstanceFade(state.fades, member!.instanceId, LOD_FADE_OPAQUE);
};
