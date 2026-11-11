// Mesh merge groups (docs/plans/_DONE_p372_mesh-merge-groups.md): mesh entities sharing a material drawn
// as one merged mesh, owned by a group entity (`MERGE_GROUP`), each member (`MERGE_MEMBER`)
// keeping its entity, transform, body and asset refs. A built member is hidden by `TAG_MERGED`,
// a reason of the kernel's visibility reconcile (`reconcileObject3DVisibility`), whose hooks this
// feature registers, as `lod()` does `TAG_LOD_CULLED`'s, and leaves the DEFAULT spatial domain.
//
// Adds mark the group pending; `mergeGroupBuildSystem` (APP_RENDER_SYNC, before the pose
// producers) builds the pending groups once a frame (MergeBuild.ts): a `BAKED` group with p371's
// merge, a `BATCHED` one (p375) as instances of one `BatchedMesh` (MergeBatch.ts). Each mode's code
// loads with its first build. A member stays drawn on its own until a build includes it.
//
// A built member's changes are written in place (MergeInPlace.ts, MergeRanges.ts): a move with
// `updateMergeMember` rewrites its range from the world matrix it was baked with
// (`MERGE_MEMBER._bakedMatrix`), the bounds only growing until the next build; a remove or a
// delete collapses its triangles and counts its vertices as wasted, and past a quarter of the
// group's the group builds again, compact. The shared state is MergeState.ts.
//
// A mesh's `merge` prop (`createMeshEntity`, through the kernel's `setMeshMergeHandler`) is queued
// and joins at the next build (`resolveQueuedMerges`), so the refusals see what was added after
// the mesh (an import's bodies) and `AUTO` (MergeAuto.ts) picks the cell from the final pose.
import * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { getECSWorld } from '../../kernel/ecs/ECS';
import { reconcileObject3DVisibility } from '../../kernel/ecs/ECSCoreSystems';
import { setLodMeshDrawDelegate } from '../../kernel/ecs/LodTargets';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import { setMeshMergeHandler } from '../../kernel/mesh/Mesh';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { AUTO, AUTO_ID_PREFIX, collectQueuedJoins, queueMerge } from './MergeAuto';
import {
  batchMemberLodDelegate,
  detachBatchedMemberMesh,
  dropBatchMember,
  getMergeBatchModule,
  installBatchMemberVisibility,
  isBatchedGroup,
  reattachMemberMesh,
} from './MergeBatchFront';
import {
  buildPendingGroups,
  loadPendingBuildCodeAsync,
  startPendingBuildCodeLoads,
} from './MergeBuild';
import { getBatchLodRefusal, getMergeRefusal } from './MergeEligibility';
import { findPaletteMaterial, getGroupPaletteIndex } from './MergePalettes';
import { getActiveSceneMergeSettings, keepSceneMergeSettings } from './MergeSceneSettings';
import {
  collapseDisabledMember,
  dropMember,
  restoreEnabledMember,
  rewriteMember,
} from './MergeInPlace';
import {
  createGroup,
  findPending,
  findQueued,
  getGroups,
  getPending,
  holdForSceneLoad,
  isMergeSceneLoading,
  markPending,
  noteMergeRefusal,
  releaseMember,
  releaseSceneLoadHolds,
  setMergeSceneLoading,
} from './MergeState';
import type {
  MergeGroupData,
  MergeGroupMode,
  MergeGroupSettings,
  MergeMemberData,
} from './MergeTypes';

// The TAG_MERGED hooks' overrides: constants, so a toggle allocates nothing
const IS_MERGED = Object.freeze({ isMerged: true });
const IS_UNMERGED = Object.freeze({ isMerged: false });

let isInstalled = false;

/**
 * Throws, naming `fn`, unless the `merging()` feature is installed (every API function's first
 * check; MergeMemberEdit.ts' too).
 * @internal
 */
export const assertMergingInstalled = (fn: string) => {
  if (!isInstalled) {
    throw new Error(
      `${fn}: merge groups need the merging() feature (from 'aekasha/merging') in InitEngine's \`features\`.`
    );
  }
};

// --- API ---

/** {@link createMergeGroup}'s options: the group's id and its settings. */
export type CreateMergeGroupOptions = MergeGroupSettings & {
  /** The group's id, unique in its world. */
  id: string;
};

/**
 * Creates an empty merge group: its members (`addToMergeGroup`) are drawn as one merged mesh,
 * built in the frame after they join. Its entity is managed (`MANAGED_BY` `MERGE`): it has no mesh
 * until its first build, and goes with the scene that created it unless `persistent`. With a
 * `palette` (one the scene lists in `mergeMaterials`), its members may have any of the palette's
 * materials, drawn in one draw by the palette's merge material. With `mode: 'BATCHED'` its
 * members are instances of one `BatchedMesh`: they may move (bodies included), each drawn where it
 * is and culled on its own.
 * @param world the group's world (default: the default world)
 * @returns the group's entity id
 * @throws for an id the world has a group with already, a reserved id (`AUTO`, or one starting
 * with `auto:`, the automatic groups'), a `palette` the scene doesn't list (no merge material is
 * registered under its id), with `persistent` or with `BATCHED`, an unknown `mode`, or without
 * the `merging()` feature
 * @example
 * ```ts
 * import { createMeshEntity } from 'aekasha';
 * import { addToMergeGroup, createMergeGroup } from 'aekasha/merging';
 *
 * createMergeGroup({ id: 'ruins', castShadow: true, receiveShadow: true });
 * const walls = [0, 4, 8].map((x) =>
 *   createMeshEntity({ geo: 'wallGeo', mat: 'stoneMat', position: { x } })
 * );
 * addToMergeGroup('ruins', walls);
 * ```
 */
export const createMergeGroup = (opts: CreateMergeGroupOptions, world?: ECSWorld): number => {
  assertMergingInstalled('createMergeGroup');
  const ecsWorld = world ?? getECSWorld();
  if (opts.id === AUTO || opts.id.startsWith(AUTO_ID_PREFIX)) {
    throw new Error(
      `createMergeGroup: "${opts.id}" is reserved for the automatic groups (merge: 'AUTO').`
    );
  }
  if (getGroups(ecsWorld).has(opts.id)) {
    throw new Error(`createMergeGroup: the world has a merge group "${opts.id}" already.`);
  }
  const { palette, mode } = opts;
  if (mode !== undefined && mode !== 'BAKED' && mode !== 'BATCHED') {
    throw new Error(
      `createMergeGroup("${opts.id}"): the mode "${String(mode)}" isn't BAKED or BATCHED.`
    );
  }
  if (
    palette !== undefined &&
    (opts.persistent || mode === 'BATCHED' || !findPaletteMaterial(palette))
  ) {
    throw new Error(
      `createMergeGroup("${opts.id}"): ${opts.persistent ? `a palette group can't be persistent (the palette "${palette}"'s merge material is its scene's)` : mode === 'BATCHED' ? "a palette group can't be BATCHED (its merge material reads the merged vertices' palette index)" : `no merge material "${palette}": the scene lists no such palette (mergeMaterials)`}.`
    );
  }
  return createGroup(opts, ecsWorld, false);
};

/**
 * Adds mesh entities to a merge group (created when the world has none with this id, with the
 * settings of the loading or current scene's `mergeGroups` entry for it, else the defaults).
 * They're drawn merged from the group's next build, in the next frame's render sync (a large
 * group's builds in the assets worker, and its new members are drawn on their own until it's in).
 * A member keeps its entity, transform, physics body and assets; its own mesh is hidden. A
 * disabled member (`setDisabled`) isn't drawn in the merged mesh either, and is again when it's
 * enabled, without a rebuild. `'AUTO'` queues them as a mesh's `merge: 'AUTO'` does: each joins
 * the automatic group of its material and cell at the next build.
 *
 * Refused with a warning naming the entity and the reason, the entity then drawn on its own: an
 * entity that isn't a plain mesh (skinned, morphed, instanced), has a transparent material, a
 * material array or another material than the group's (a palette group's: one its palette doesn't
 * have), a manager, a `LOD`, attributes the group's can't take, or a group already; a persistent
 * one, unless the group is persistent. A `BAKED` group refuses a dynamic or kinematic body; a
 * `BATCHED` one a mesh that isn't directly under the root scene.
 * @param world the group's world (default: the default world)
 * @remarks Members are static: a member moved later is drawn where it was merged until
 * `updateMergeMember` moves its part.
 * @example
 * ```ts
 * import { getEntityIdByAppId } from 'aekasha';
 * import { addToMergeGroup } from 'aekasha/merging';
 *
 * const pillars = ['pillarA', 'pillarB', 'pillarC'].map((appId) => getEntityIdByAppId(appId)!);
 * addToMergeGroup('ruins', pillars);
 * ```
 */
export const addToMergeGroup = (groupId: string, entityIds: number[], world?: ECSWorld) => {
  assertMergingInstalled('addToMergeGroup');
  joinMergeGroup(groupId, entityIds, world ?? getECSWorld());
};

/** `addToMergeGroup`, with the mode each entity's `merge` names (`modes`, the queue's), which a
 * group of the other mode refuses, and the first of which a group made on first use takes unless
 * its scene entry gives one. */
const joinMergeGroup = (
  groupId: string,
  entityIds: number[],
  ecsWorld: ECSWorld,
  modes?: ReadonlyMap<number, MergeGroupMode>
) => {
  if (groupId === AUTO) {
    for (const entityId of entityIds) queueMerge(entityId, AUTO, ecsWorld);
    return;
  }
  // This call wins over a mesh's `merge` still waiting for its build
  const queued = findQueued(ecsWorld);
  if (queued?.size) for (const entityId of entityIds) queued.delete(entityId);
  // Made on first use with the scene's `mergeGroups` entry's settings, if it lists one
  const entry = getActiveSceneMergeSettings().groups.get(groupId);
  const mode = entry?.mode ?? entityIds.map((id) => modes?.get(id)).find(Boolean);
  const groupEntityId =
    getGroups(ecsWorld).get(groupId) ??
    createMergeGroup({ ...entry, ...(mode && { mode }), id: groupId }, ecsWorld);
  const group = existsOrThrow(
    ecsWorld.getComponent(groupEntityId, ComponentType.MERGE_GROUP),
    `addToMergeGroup: the merge group "${groupId}" has no MERGE_GROUP component.`
  );
  let added = 0;
  for (const entityId of entityIds) {
    const refusal = getMergeRefusal(entityId, ecsWorld, group, modes?.get(entityId));
    if (refusal) {
      lwarn(`addToMergeGroup("${groupId}"): entity ${entityId} is drawn on its own: ${refusal}.`);
      if (IS_DEBUG_ENV) noteMergeRefusal(ecsWorld, entityId, groupId, refusal);
      continue;
    }
    const { material } = ecsWorld.getComponent(entityId, ComponentType.OBJECT3D)!
      .value as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    group._material ??= material;
    ecsWorld.addComponent(entityId, ComponentType.MERGE_MEMBER, {
      groupEntityId,
      groupId,
      partIndex: -1,
      instanceId: -1,
      _wasSpatialIndexed: false,
      _bakedMatrix: new THREE.Matrix4(),
      _isCollapsed: false,
      _paletteIndex: getGroupPaletteIndex(group, material),
    });
    group.members.push(entityId);
    holdForSceneLoad(entityId, ecsWorld);
    added++;
  }
  if (added > 0) markPending(ecsWorld, groupEntityId, group);
};

/**
 * Builds a merge group's mesh again from its members, in the next frame's render sync. A member
 * moved since the last build is drawn where it is now. A `BATCHED` group's batch is made again
 * from every member, its instances grouped by geometry.
 * @param world the group's world (default: the default world)
 * @example
 * ```ts
 * import { rebuildMergeGroup } from 'aekasha/merging';
 *
 * rebuildMergeGroup('ruins');
 * ```
 */
export const rebuildMergeGroup = (groupId: string, world?: ECSWorld) => {
  assertMergingInstalled('rebuildMergeGroup');
  const ecsWorld = world ?? getECSWorld();
  const groupEntityId = getGroups(ecsWorld).get(groupId);
  const group =
    groupEntityId !== undefined
      ? ecsWorld.getComponent(groupEntityId, ComponentType.MERGE_GROUP)
      : undefined;
  if (groupEntityId === undefined || !group) {
    lwarn(`rebuildMergeGroup: no merge group "${groupId}".`);
    return;
  }
  // A batch is made again from every member, grouped by geometry
  if (isBatchedGroup(group)) getMergeBatchModule()?.requestBatchRebuild(group);
  markPending(ecsWorld, groupEntityId, group);
};

/**
 * Moves a merged member's part of its group's mesh to where the member is now: call it after
 * changing a member's `TRANSFORM` (`setTransform`, a fixed body moved). Only the member's range of
 * the merged geometry is written again, without a rebuild. A member waiting for its group's build
 * is merged where it is then and needs no call, and so does a `BATCHED` group's member (its
 * instance follows its `TRANSFORM` every frame).
 * @param world the member's world (default: the default world)
 * @remarks Members are static by contract: a member moved without this call is still drawn where
 * it was merged (the debug env warns once per member). Its geometry's vertex count can't change in
 * place: a member whose geometry was replaced makes its group build again.
 * @example
 * ```ts
 * import { getEntityIdByAppId, getECSWorld } from 'aekasha';
 * import { updateMergeMember } from 'aekasha/merging';
 *
 * const gate = getEntityIdByAppId('ruinGate')!;
 * getECSWorld().setTransform(gate, { pos: { x: 4, y: 0, z: 12 } });
 * updateMergeMember(gate);
 * ```
 */
export const updateMergeMember = (entityId: number, world?: ECSWorld) => {
  assertMergingInstalled('updateMergeMember');
  const ecsWorld = world ?? getECSWorld();
  const member = ecsWorld.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const group = member && ecsWorld.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
  if (!member || !group) {
    lwarn(`updateMergeMember: entity ${entityId} isn't in a merge group.`);
    return;
  }
  // A running worker build read the old pose: it's dropped, and the group builds again
  if (group._isBuilding) {
    group._buildToken++;
    group._isBuilding = false;
    markPending(ecsWorld, member.groupEntityId, group);
  }
  if (member.partIndex !== -1) rewriteMember(entityId, member, group, ecsWorld);
};

/**
 * Takes members out of their merge groups: each is drawn on its own again at once, back in the
 * spatial index if it was. A built member's triangles in the merged mesh are collapsed in place
 * (no rebuild), and its vertices counted as wasted; once a group's waste passes a quarter of its
 * vertices, it builds again, compact, in the next frame's render sync.
 * @param world the members' world (default: the default world)
 * @remarks An entity that isn't a member is skipped with a warning, unless its `merge` was still
 * waiting for the next build: it then doesn't join. Deleting a member collapses its range the
 * same way.
 * @example
 * ```ts
 * import { getEntityIdByAppId } from 'aekasha';
 * import { removeFromMergeGroup } from 'aekasha/merging';
 *
 * // The wall the player broke: drawn on its own from now on
 * removeFromMergeGroup([getEntityIdByAppId('ruinWall3')!]);
 * ```
 */
export const removeFromMergeGroup = (entityIds: number[], world?: ECSWorld) => {
  assertMergingInstalled('removeFromMergeGroup');
  const ecsWorld = world ?? getECSWorld();
  const queued = findQueued(ecsWorld);
  for (const entityId of entityIds) {
    if (queued?.delete(entityId)) continue;
    const member = ecsWorld.getComponent(entityId, ComponentType.MERGE_MEMBER);
    const group = member && ecsWorld.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
    if (!member || !group) {
      lwarn(`removeFromMergeGroup: entity ${entityId} isn't in a merge group.`);
      continue;
    }
    dropGroupMember(entityId, member, group, ecsWorld);
    releaseMember(entityId, ecsWorld);
  }
};

/**
 * Dissolves a merge group: its members are drawn on their own again at once, back in the spatial
 * index, and its entity and merged mesh are deleted. An unknown id does nothing.
 * @param world the group's world (default: the default world)
 * @example
 * ```ts
 * import { dissolveMergeGroup } from 'aekasha/merging';
 *
 * dissolveMergeGroup('ruins');
 * ```
 */
export const dissolveMergeGroup = (groupId: string, world?: ECSWorld) => {
  assertMergingInstalled('dissolveMergeGroup');
  const ecsWorld = world ?? getECSWorld();
  const groupEntityId = getGroups(ecsWorld).get(groupId);
  // The group's delete hook lets its members go
  if (groupEntityId !== undefined) ecsWorld.deleteEntity(groupEntityId);
};

/**
 * The merge group an entity is a member of (built or waiting for its build), if any. A mesh whose
 * `merge` prop hasn't joined yet (it joins at the next build) has none.
 * @param world the entity's world (default: the default world)
 * @returns the group's id, or undefined
 * @example
 * ```ts
 * import { getEntityIdByAppId } from 'aekasha';
 * import { getMergeGroupOf } from 'aekasha/merging';
 *
 * const groupId = getMergeGroupOf(getEntityIdByAppId('pillarA')!);
 * ```
 */
export const getMergeGroupOf = (entityId: number, world?: ECSWorld): string | undefined =>
  (world ?? getECSWorld()).getComponent(entityId, ComponentType.MERGE_MEMBER)?.groupId;

// --- MEMBERSHIP ---

/** Joins the queued `merge`s to their groups (MergeAuto.ts picks the `AUTO` ones). A group that
 * can't be made on first use (its scene entry's palette isn't registered) is logged, and its
 * meshes are drawn on their own. */
const resolveQueuedMerges = (world: ECSWorld) => {
  const queued = collectQueuedJoins(world);
  if (!queued) return;
  for (const [groupId, entityIds] of queued.joins) {
    try {
      joinMergeGroup(groupId, entityIds, world, queued.modes);
    } catch (err) {
      lerror(
        `Merge group "${groupId}": entities ${entityIds.join(', ')} are drawn on their own.`,
        err
      );
    }
  }
};

/** A group entity's deletion (a dissolve, its scene's exit): its members go free. */
const onGroupDeleted = (groupEntityId: number, world: ECSWorld) => {
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
  if (!group) return;
  for (const entityId of group.members) {
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
    if (member?.groupEntityId === groupEntityId) releaseMember(entityId, world);
  }
  group.members.length = 0;
  group._buildToken++; // a running worker build is dropped
  const groups = getGroups(world);
  if (groups.get(group.id) === groupEntityId) groups.delete(group.id);
  getPending(world).delete(groupEntityId);
};

/** A leaving member out of its group, by the group's mode: a baked range collapsed, or an
 * instance deleted. */
const dropGroupMember = (
  entityId: number,
  member: MergeMemberData,
  group: MergeGroupData,
  world: ECSWorld
) =>
  isBatchedGroup(group)
    ? dropBatchMember(entityId, member, group, world)
    : dropMember(entityId, member, group, world);

/** A member's deletion: its range collapses, as a remove's (its components go with it). */
const onMemberDeleted = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const group = member && world.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
  if (member && group) dropGroupMember(entityId, member, group, world);
};

/**
 * Joins the queued `merge`s, then builds the pending merge groups, once a frame (APP_RENDER_SYNC,
 * `MERGE_BUILD`). Its first run with a pending group loads its mode's code (the merge code, or
 * the batch code), and the run after it's in builds. Not during a scene load: its scene step builds (`buildSceneMergeGroupsAsync`), once
 * the scene's code has placed its meshes and physics has created their bodies.
 */
const mergeGroupBuildSystem = (world: ECSWorld) => {
  if (isMergeSceneLoading()) return;
  resolveQueuedMerges(world);
  const pending = findPending(world);
  if (!pending || pending.size === 0) return;
  // A group whose mode's code is still loading waits for a run after it's in
  startPendingBuildCodeLoads(world);
  void buildPendingGroups(world);
};

/**
 * Joins the queued `merge`s and builds the world's pending merge groups now, worker builds
 * included, without waiting for the build system: for a scene load, so its first frame draws them
 * merged (p372 §6).
 * @internal
 */
export const buildPendingMergeGroupsAsync = async (world?: ECSWorld) => {
  const ecsWorld = world ?? getECSWorld();
  resolveQueuedMerges(ecsWorld);
  if (!findPending(ecsWorld)?.size) return;
  await loadPendingBuildCodeAsync(ecsWorld);
  await Promise.all(buildPendingGroups(ecsWorld));
};

/** How many times the scene step builds again: a worker build dropped meanwhile (a member left
 * while it ran) marks its group again. */
const SCENE_STEP_BUILD_ROUNDS = 3;

/**
 * The scene step (p372 §6, the `entered` scene hook): joins the scene's queued `merge`s and builds
 * every pending group, awaiting the worker builds, then lets go of the members the load held, so
 * the scene's first frame draws them merged and their own geometry is never uploaded. Runs after
 * the `entered` hooks of the features listed before `merging()` (physics' waits for the scene's
 * bodies). A failed build or merge code load is logged and the members are drawn on their own
 * until the build system builds them.
 * @internal
 */
export const buildSceneMergeGroupsAsync = async () => {
  const world = getECSWorld();
  try {
    for (let round = 0; round < SCENE_STEP_BUILD_ROUNDS; round++) {
      await buildPendingMergeGroupsAsync(world);
      if (!findPending(world)?.size) break;
    }
  } catch (err) {
    lerror("Merge groups: the scene's groups failed to build.", err);
  } finally {
    setMergeSceneLoading(false);
    releaseSceneLoadHolds(world);
  }
};

/** A scene load's end, loaded or failed: a failed load never ran the scene step. */
const onSceneLoadSettled = () => {
  if (!isMergeSceneLoading()) return;
  setMergeSceneLoading(false);
  releaseSceneLoadHolds(getECSWorld());
};

/**
 * Loads and installs the moved-member check (debug/_dbg__MergeGroups.ts) and the Merging tab with
 * its windows (debug/_dbg__Merging.ts, p373): the `merging()` feature's `onDebug` hook.
 * @internal
 */
export const registerMergeDebug = async () => {
  const [check, tab] = await Promise.all([
    loadDebugModuleAsync(() => import('./debug/_dbg__MergeGroups')),
    loadDebugModuleAsync(() => import('./debug/_dbg__Merging')),
  ]);
  useDebug(check)?._installMergeDebug();
  useDebug(tab)?._createMergingDebugGUI();
};

/** A `LOD` added to a batched member after its join (an `AUTO` LOD whose chain came later,
 * `setMeshLod`): its levels are checked as at a join (`getBatchLodRefusal`), and a member whose
 * levels its batch can't draw leaves its group, warned, drawn on its own with its LOD. Registered
 * after `lod()`'s add hook, which resolves the levels. */
const checkBatchedMemberLod = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const group = member && world.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
  const lod = world.getComponent(entityId, ComponentType.LOD);
  if (!group || !lod || !isBatchedGroup(group)) return;
  const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;
  const refusal = getBatchLodRefusal(mesh, lod._levels);
  if (!refusal) return;
  lwarn(`Merge group "${group.id}": entity ${entityId} leaves it, drawn on its own: ${refusal}.`);
  if (IS_DEBUG_ENV) noteMergeRefusal(world, entityId, group.id, refusal);
  removeFromMergeGroup([entityId], world);
};

/**
 * Installs the merge groups (the `merging()` feature's install, MergingFeature.ts): the
 * `TAG_MERGED` visibility hooks, the groups' and members' deletion hooks, the `DISABLED` hooks
 * that collapse and restore a member's range, the meshes' `merge` prop, and the build system.
 * @internal
 */
export const installMergeGroups = (ctx: FeatureContext) => {
  isInstalled = true;
  setMeshMergeHandler(queueMerge);
  ctx.addSceneHooks({
    sceneRegistered: keepSceneMergeSettings,
    loadStart: () => setMergeSceneLoading(true),
    entered: buildSceneMergeGroupsAsync,
    loadSettled: onSceneLoadSettled,
  });
  // A batched member's own mesh leaves the scene graph too, and comes back (MergeBatchFront.ts)
  ctx.registerComponentHooks(ComponentType.TAG_MERGED, {
    onAddComponent: (entityId, world) => {
      reconcileObject3DVisibility(entityId, world, IS_MERGED);
      detachBatchedMemberMesh(entityId, world);
    },
    onRemoveComponent: (entityId, world) => {
      reconcileObject3DVisibility(entityId, world, IS_UNMERGED);
      reattachMemberMesh(entityId, world);
    },
  });
  ctx.registerComponentHooks(ComponentType.MERGE_GROUP, { onDeleteEntity: onGroupDeleted });
  ctx.registerComponentHooks(ComponentType.MERGE_MEMBER, { onDeleteEntity: onMemberDeleted });
  // A disabled member's range collapses, and enabling it restores it
  ctx.registerComponentHooks(ComponentType.DISABLED, {
    onAddComponent: collapseDisabledMember,
    onRemoveComponent: restoreEnabledMember,
  });
  // A batched member's instance is shown and hidden instead (p375)
  installBatchMemberVisibility(ctx);
  // A batched member's LOD: its batch draws its levels (the kernel's seam, read by lod() whatever
  // the install order), and one added later is checked after lod()'s add hook, which resolves its
  // levels (p375 Phase 2; without lod() a LOD does nothing)
  setLodMeshDrawDelegate(batchMemberLodDelegate);
  if (ctx.isInstalled('lod')) {
    ctx.registerComponentHooks(ComponentType.LOD, { onAddComponent: checkBatchedMemberLod });
  }
  ctx.registerPlugin((world) => {
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'mergeGroupBuildSystem',
      mergeGroupBuildSystem,
      APP_RENDER_SYNC_ORDER.MERGE_BUILD
    );
  });
};
