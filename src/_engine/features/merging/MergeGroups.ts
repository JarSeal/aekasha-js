// Mesh merge groups (docs/plans/_DONE_p372_mesh-merge-groups.md): mesh entities sharing a material drawn
// as one merged mesh, owned by a group entity (`MERGE_GROUP`), each member (`MERGE_MEMBER`)
// keeping its entity, transform, body and asset refs. A built member is hidden by `TAG_MERGED`,
// a reason of the kernel's visibility reconcile (`reconcileObject3DVisibility`), whose hooks this
// feature registers, as `lod()` does `TAG_LOD_CULLED`'s, and leaves the DEFAULT spatial domain.
//
// Adds mark the group pending; `mergeGroupBuildSystem` (APP_RENDER_SYNC, before the
// pose producers) builds the pending groups once a frame with p371's merge (`GeometryMerge.ts`,
// loaded on the first build, so an app that never merges doesn't download it), in the assets
// worker above WORKER_BUILD_VERTICES. A member stays drawn on its own until a build includes it,
// so a worker build never leaves a frame without it.
//
// The group's mesh is added at its first build (the material is its first member's), at the
// centre of the members' bounds with the members baked relative to it: the spatial index measures
// a mesh's radius from its origin, so a world-space merge at the origin would get a wrong one.
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
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import {
  decGeometryRef,
  getGeometry,
  incGeometryRef,
  saveBufferGeometry,
} from '../../kernel/assets/Geometry';
import { incMaterialRef } from '../../kernel/assets/Material';
import { setMeshMergeHandler } from '../../kernel/mesh/Mesh';
import type { MergePart } from '../../kernel/assets/GeometryMerge';
import { getRootScene } from '../../kernel/scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { AUTO, AUTO_ID_PREFIX, collectQueuedJoins, queueMerge } from './MergeAuto';
import { getMergeRefusal } from './MergeEligibility';
import {
  getActiveSceneMergeSettings,
  keepSceneMergeSettings,
  warnIfGroupSpansStreamingCells,
} from './MergeSceneSettings';
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
  getMemberMesh,
  getPending,
  holdForSceneLoad,
  isMergeSceneLoading,
  markPending,
  noteMergeBuild,
  noteMergeRefusal,
  releaseMember,
  releaseSceneLoadHolds,
  setMergeSceneLoading,
  syncMemberPose,
} from './MergeState';
import type { MergeGroupData, MergeGroupSettings } from './MergeTypes';

/**
 * A build of more vertices than this merges in the assets worker (`mergeGeometryPartsAsync`):
 * p371 measured a warm 100k-vertex merge at about 11 ms on the main thread.
 * @internal
 */
export const WORKER_BUILD_VERTICES = 65_536;

// The TAG_MERGED hooks' overrides: constants, so a toggle allocates nothing
const IS_MERGED = Object.freeze({ isMerged: true });
const IS_UNMERGED = Object.freeze({ isMerged: false });

let isInstalled = false;

const assertInstalled = (fn: string) => {
  if (!isInstalled) {
    throw new Error(
      `${fn}: merge groups need the merging() feature (from 'aekasha/merging') in InitEngine's \`features\`.`
    );
  }
};

// --- THE MERGE CODE (loaded on the first build) ---

type MergeModule = typeof import('../../kernel/assets/GeometryMerge');
let mergeModule: MergeModule | null = null;
let mergeModulePromise: Promise<MergeModule> | null = null;

const loadMergeModuleAsync = () =>
  (mergeModulePromise ??= import('../../kernel/assets/GeometryMerge').then(
    (module) => (mergeModule = module),
    (err: unknown) => {
      // The next build tries again
      mergeModulePromise = null;
      throw err;
    }
  ));

// --- API ---

/** {@link createMergeGroup}'s options: the group's id and its settings. */
export type CreateMergeGroupOptions = MergeGroupSettings & {
  /** The group's id, unique in its world. */
  id: string;
};

/**
 * Creates an empty merge group: its members (`addToMergeGroup`) are drawn as one merged mesh,
 * built in the frame after they join. Its entity is managed (`MANAGED_BY` `MERGE`): it has no mesh
 * until its first build, and goes with the scene that created it unless `persistent`.
 * @param world the group's world (default: the default world)
 * @returns the group's entity id
 * @throws for an id the world has a group with already, a reserved id (`AUTO`, or one starting
 * with `auto:`, the automatic groups'), or without the `merging()` feature
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
  assertInstalled('createMergeGroup');
  const ecsWorld = world ?? getECSWorld();
  if (opts.id === AUTO || opts.id.startsWith(AUTO_ID_PREFIX)) {
    throw new Error(
      `createMergeGroup: "${opts.id}" is reserved for the automatic groups (merge: 'AUTO').`
    );
  }
  if (getGroups(ecsWorld).has(opts.id)) {
    throw new Error(`createMergeGroup: the world has a merge group "${opts.id}" already.`);
  }
  return createGroup(opts, ecsWorld, false);
};

/**
 * Adds mesh entities to a merge group (created when the world has none with this id, with the
 * settings of the loading or current scene's `mergeGroups` entry for it, else the defaults). They're drawn merged from the group's next build, in the next frame's render sync (a
 * large group's builds in the assets worker, and its new members are drawn on their own until it's
 * in). A member keeps its entity, transform, physics body and assets; its own mesh is hidden.
 * A disabled member (`setDisabled`) isn't drawn in the merged mesh either, and is again when
 * it's enabled, without a rebuild. `'AUTO'` queues them as a mesh's `merge: 'AUTO'` does: each
 * joins the automatic group of its material and cell at the next build.
 *
 * Refused with a warning naming the entity and the reason, the entity then drawn on its own: an
 * entity that isn't a plain mesh (skinned, morphed, instanced), has a transparent material, a
 * material array or another material than the group's, a dynamic or kinematic body, a manager, a
 * `LOD`, attributes the group's can't take, or a group already; a persistent one, unless the
 * group is persistent.
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
  assertInstalled('addToMergeGroup');
  const ecsWorld = world ?? getECSWorld();
  if (groupId === AUTO) {
    for (const entityId of entityIds) queueMerge(entityId, AUTO, ecsWorld);
    return;
  }
  // This call wins over a mesh's `merge` still waiting for its build
  const queued = findQueued(ecsWorld);
  if (queued?.size) for (const entityId of entityIds) queued.delete(entityId);
  // Made on first use with the scene's `mergeGroups` entry's settings, if it lists one
  const groupEntityId =
    getGroups(ecsWorld).get(groupId) ??
    createMergeGroup(
      { ...getActiveSceneMergeSettings().groups.get(groupId), id: groupId },
      ecsWorld
    );
  const group = existsOrThrow(
    ecsWorld.getComponent(groupEntityId, ComponentType.MERGE_GROUP),
    `addToMergeGroup: the merge group "${groupId}" has no MERGE_GROUP component.`
  );
  let added = 0;
  for (const entityId of entityIds) {
    const refusal = getMergeRefusal(entityId, ecsWorld, group);
    if (refusal) {
      lwarn(`addToMergeGroup("${groupId}"): entity ${entityId} is drawn on its own: ${refusal}.`);
      if (IS_DEBUG_ENV) noteMergeRefusal(ecsWorld, entityId, groupId, refusal);
      continue;
    }
    if (!group._material) {
      group._material = (
        ecsWorld.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh
      ).material as THREE.Material;
    }
    ecsWorld.addComponent(entityId, ComponentType.MERGE_MEMBER, {
      groupEntityId,
      groupId,
      partIndex: -1,
      _wasSpatialIndexed: false,
      _bakedMatrix: new THREE.Matrix4(),
      _isCollapsed: false,
    });
    group.members.push(entityId);
    holdForSceneLoad(entityId, ecsWorld);
    added++;
  }
  if (added > 0) markPending(ecsWorld, groupEntityId, group);
};

/**
 * Builds a merge group's mesh again from its members, in the next frame's render sync. A member
 * moved since the last build is drawn where it is now.
 * @param world the group's world (default: the default world)
 * @example
 * ```ts
 * import { rebuildMergeGroup } from 'aekasha/merging';
 *
 * rebuildMergeGroup('ruins');
 * ```
 */
export const rebuildMergeGroup = (groupId: string, world?: ECSWorld) => {
  assertInstalled('rebuildMergeGroup');
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
  markPending(ecsWorld, groupEntityId, group);
};

/**
 * Moves a merged member's part of its group's mesh to where the member is now: call it after
 * changing a member's `TRANSFORM` (`setTransform`, a fixed body moved). Only the member's range of
 * the merged geometry is written again, without a rebuild. A member waiting for its group's build
 * is merged where it is then and needs no call.
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
  assertInstalled('updateMergeMember');
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
  assertInstalled('removeFromMergeGroup');
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
    dropMember(entityId, member, group, ecsWorld);
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
  assertInstalled('dissolveMergeGroup');
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

/** Joins the queued `merge`s to their groups (MergeAuto.ts picks the `AUTO` ones). */
const resolveQueuedMerges = (world: ECSWorld) => {
  const joins = collectQueuedJoins(world);
  if (joins) for (const [groupId, entityIds] of joins) addToMergeGroup(groupId, entityIds, world);
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

/** A member's deletion: its range collapses, as a remove's (its components go with it). */
const onMemberDeleted = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const group = member && world.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
  if (member && group) dropMember(entityId, member, group, world);
};

// --- BUILDS ---

const scratchBox = new THREE.Box3();
const groupBounds = new THREE.Box3();
const groupCentre = new THREE.Vector3();
const toGroupSpace = new THREE.Matrix4();

/** The members still in the group, alive and pointing at it. */
const getLiveMembers = (groupEntityId: number, group: MergeGroupData, world: ECSWorld) =>
  group.members.filter(
    (entityId) =>
      world.getComponent(entityId, ComponentType.MERGE_MEMBER)?.groupEntityId === groupEntityId
  );

/** A build's input: the members as merge parts in the group's space (centred on their bounds),
 * the world matrices they were baked with, and that centre. */
type BuildParts = {
  parts: MergePart[];
  worldMatrices: THREE.Matrix4[];
  centre: THREE.Vector3;
  vertexCount: number;
};

const getBuildParts = (members: number[], world: ECSWorld): BuildParts => {
  groupBounds.makeEmpty();
  for (const entityId of members) {
    const mesh = getMemberMesh(entityId, world);
    syncMemberPose(entityId, mesh, world);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    groupBounds.union(scratchBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
  }
  groupBounds.getCenter(groupCentre);
  toGroupSpace.makeTranslation(-groupCentre.x, -groupCentre.y, -groupCentre.z);
  let vertexCount = 0;
  const worldMatrices: THREE.Matrix4[] = [];
  const parts: MergePart[] = members.map((entityId) => {
    const mesh = getMemberMesh(entityId, world);
    vertexCount += mesh.geometry.getAttribute('position').count;
    worldMatrices.push(mesh.matrixWorld.clone());
    return {
      geo: mesh.geometry,
      matrix: new THREE.Matrix4().multiplyMatrices(toGroupSpace, mesh.matrixWorld),
      key: String(entityId),
    };
  });
  return { parts, worldMatrices, centre: groupCentre.clone(), vertexCount };
};

/** Registers a build's geometry as the group's, releasing the one it replaces. */
const registerGroupGeometry = (
  group: MergeGroupData,
  geometry: THREE.BufferGeometry,
  previous: THREE.BufferGeometry | undefined
) => {
  const baseId = `mergeGroup:${group.id}`;
  // Its last ref: disposed and unregistered (never persistent: the group mesh's ref keeps it
  // through a scene release, so a persistent group's survives too)
  const previousId = previous?.userData.id as string | undefined;
  if (previousId) decGeometryRef(previousId);
  // Someone else still holds the previous one under the id: the new one takes another
  const id = getGeometry(baseId) ? `${baseId}#${group.rebuilds}` : baseId;
  saveBufferGeometry(geometry, { id });
  incGeometryRef(id);
};

/** Makes the group's mesh at its first build: a mesh entity's components on the group entity. */
const createGroupMesh = (
  groupEntityId: number,
  group: MergeGroupData,
  geometry: THREE.BufferGeometry,
  firstMember: THREE.Mesh,
  world: ECSWorld
) => {
  const material = existsOrThrow(group._material, `Merge group "${group.id}" has no material.`);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.id = `mergeGroup:${group.id}`;
  mesh.userData.entityId = groupEntityId;
  mesh.castShadow = group.settings.castShadow ?? firstMember.castShadow;
  mesh.receiveShadow = group.settings.receiveShadow ?? firstMember.receiveShadow;
  if (material.userData.id) incMaterialRef(material.userData.id as string);
  world.addComponent(groupEntityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: -1 });
  if (!world.hasComponent(groupEntityId, ComponentType.TAG_IS_MESH)) {
    world.addComponent(groupEntityId, ComponentType.TAG_IS_MESH, true);
  }
  return mesh;
};

/** Draws `members` merged as `geometry`, centred on the build's centre: the group's mesh takes
 * it, the members hide and leave the spatial index. */
const applyBuild = (
  groupEntityId: number,
  group: MergeGroupData,
  members: number[],
  geometry: THREE.BufferGeometry,
  build: BuildParts,
  world: ECSWorld
) => {
  const { centre, worldMatrices } = build;
  warnIfGroupSpansStreamingCells(group.id, worldMatrices);
  let mesh = world.getComponent(groupEntityId, ComponentType.OBJECT3D)?.value as
    | THREE.Mesh
    | undefined;
  const previous = mesh?.geometry;
  if (mesh) mesh.geometry = geometry;
  registerGroupGeometry(group, geometry, previous);
  mesh ??= createGroupMesh(groupEntityId, group, geometry, getMemberMesh(members[0], world), world);

  // Its pose at once (object3DSyncSystem ran in MAIN), and its TRANSFORM
  mesh.position.copy(centre);
  const transform = world.getComponent(groupEntityId, ComponentType.TRANSFORM);
  if (transform) {
    transform.position.copy(centre);
    transform.setDirty();
    world.commitTransform(groupEntityId, transform);
  }
  if (!mesh.parent) existsOrThrow(getRootScene(), 'Merge groups need the root scene.').add(mesh);

  group.partIndex.clear();
  members.forEach((entityId, partIndex) => {
    group.partIndex.set(entityId, partIndex);
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;
    member.partIndex = partIndex;
    member._bakedMatrix = worldMatrices[partIndex];
    member._isCollapsed = false;
    if (world.hasComponent(entityId, ComponentType.TAG_MERGED)) return;
    member._wasSpatialIndexed = world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED);
    world.removeComponent(entityId, ComponentType.SPATIAL_INDEXED);
    world.addComponent(entityId, ComponentType.TAG_MERGED, true);
  });
  // The built members first, in part order, then those that joined while it built
  const waiting = group.members.filter((entityId) => !group.partIndex.has(entityId));
  group.members = [...members, ...waiting];
  group.wasted = 0;
  group.rebuilds++;
  // A disabled member is merged as it is and collapsed, so enabling it needs no build
  for (const entityId of members) {
    if (world.isDisabled(entityId)) collapseDisabledMember(entityId, world);
  }

  // Joined again, so the spatial index measures the new bounds
  world.removeComponent(groupEntityId, ComponentType.SPATIAL_INDEXED);
  world.addComponent(groupEntityId, ComponentType.SPATIAL_INDEXED, true);
};

/** A worker build's result is still the group's: no newer build started, and its members are
 * all still in it. */
const isBuildCurrent = (
  groupEntityId: number,
  group: MergeGroupData,
  token: number,
  members: number[],
  world: ECSWorld
) =>
  world.getComponent(groupEntityId, ComponentType.MERGE_GROUP) === group &&
  group._buildToken === token &&
  members.every(
    (entityId) =>
      world.getComponent(entityId, ComponentType.MERGE_MEMBER)?.groupEntityId === groupEntityId
  );

/**
 * Builds one group: at once on the main thread, or in the worker above WORKER_BUILD_VERTICES
 * (then the returned promise resolves when it's applied or dropped). Needs the merge module.
 */
const buildGroup = (
  groupEntityId: number,
  world: ECSWorld,
  merge: MergeModule
): Promise<void> | undefined => {
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
  if (!group) return;
  group._isPending = false;
  // The Merging tab's last build time (debug env only)
  const start = IS_DEBUG_ENV ? performance.now() : 0;
  const token = ++group._buildToken;
  const members = getLiveMembers(groupEntityId, group, world);
  group.members = members.concat();
  if (members.length === 0) {
    // An automatic group is only its members': it goes (its id is free again)
    if (group._isAuto) {
      world.deleteEntity(groupEntityId);
      return;
    }
    // Nothing to draw: the mesh leaves the scene until a member joins
    world.getComponent(groupEntityId, ComponentType.OBJECT3D)?.value.removeFromParent();
    group.partIndex.clear();
    return;
  }
  const build = getBuildParts(members, world);
  const fail = (err: unknown) => lerror(`Merge group "${group.id}" failed to build.`, err);

  if (build.vertexCount <= WORKER_BUILD_VERTICES) {
    try {
      applyBuild(
        groupEntityId,
        group,
        members,
        merge.mergeGeometryParts(build.parts),
        build,
        world
      );
      if (IS_DEBUG_ENV) noteMergeBuild(world, group.id, performance.now() - start, false);
    } catch (err) {
      fail(err);
    }
    return;
  }
  group._isBuilding = true;
  const settle = () => {
    if (group._buildToken === token) group._isBuilding = false;
  };
  return merge.mergeGeometryPartsAsync(build.parts).then(
    (geometry) => {
      settle();
      if (!isBuildCurrent(groupEntityId, group, token, members, world)) {
        geometry.dispose();
        // A member left while it ran (not a newer build, nor the group's deletion): build again
        const isLive = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP) === group;
        if (isLive && group._buildToken === token) markPending(world, groupEntityId, group);
        return;
      }
      applyBuild(groupEntityId, group, members, geometry, build, world);
      if (IS_DEBUG_ENV) noteMergeBuild(world, group.id, performance.now() - start, true);
    },
    (err: unknown) => {
      settle();
      fail(err);
    }
  );
};

/** Builds every pending group of the world; the worker builds' promises. */
const buildPendingGroups = (world: ECSWorld, merge: MergeModule) => {
  const pending = getPending(world);
  const running: Promise<void>[] = [];
  for (const groupEntityId of pending) {
    const build = buildGroup(groupEntityId, world, merge);
    if (build) running.push(build);
  }
  pending.clear();
  return running;
};

/**
 * Joins the queued `merge`s, then builds the pending merge groups, once a frame (APP_RENDER_SYNC,
 * `MERGE_BUILD`). Its first run with a pending group loads the merge code, and the run after it's
 * in builds. Not during a scene load: its scene step builds (`buildSceneMergeGroupsAsync`), once
 * the scene's code has placed its meshes and physics has created their bodies.
 */
const mergeGroupBuildSystem = (world: ECSWorld) => {
  if (isMergeSceneLoading()) return;
  resolveQueuedMerges(world);
  const pending = findPending(world);
  if (!pending || pending.size === 0) return;
  if (!mergeModule) {
    loadMergeModuleAsync().catch((err: unknown) =>
      lerror('Merge groups: the merge code failed to load.', err)
    );
    return;
  }
  void buildPendingGroups(world, mergeModule);
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
  const merge = await loadMergeModuleAsync();
  await Promise.all(buildPendingGroups(ecsWorld, merge));
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
  ctx.registerComponentHooks(ComponentType.TAG_MERGED, {
    onAddComponent: (entityId, world) => reconcileObject3DVisibility(entityId, world, IS_MERGED),
    onRemoveComponent: (entityId, world) =>
      reconcileObject3DVisibility(entityId, world, IS_UNMERGED),
  });
  ctx.registerComponentHooks(ComponentType.MERGE_GROUP, { onDeleteEntity: onGroupDeleted });
  ctx.registerComponentHooks(ComponentType.MERGE_MEMBER, { onDeleteEntity: onMemberDeleted });
  // A disabled member's range collapses, and enabling it restores it
  ctx.registerComponentHooks(ComponentType.DISABLED, {
    onAddComponent: collapseDisabledMember,
    onRemoveComponent: restoreEnabledMember,
  });
  ctx.registerPlugin((world) => {
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'mergeGroupBuildSystem',
      mergeGroupBuildSystem,
      APP_RENDER_SYNC_ORDER.MERGE_BUILD
    );
  });
};
