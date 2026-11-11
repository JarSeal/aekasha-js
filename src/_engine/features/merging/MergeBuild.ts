// The merge groups' builds (docs/plans/_DONE_p372_mesh-merge-groups.md): the pending groups built
// once a frame by the build system, or at once by the scene step (MergeGroups.ts), each by its
// mode's code. A `BAKED` group's members are merged with p371's merge (`GeometryMerge.ts`, loaded
// on the first build, so an app that never merges doesn't download it), in the assets worker above
// WORKER_BUILD_VERTICES; a member stays drawn on its own until a build includes it, so a worker
// build never leaves a frame without it. The group's mesh is added at its first build (the
// material is its first member's), at the centre of the members' bounds with the members baked
// relative to it: the spatial index measures a mesh's radius from its origin, so a world-space
// merge at the origin would get a wrong one. A `BATCHED` group's build is MergeBatch.ts' (p375),
// loaded on the first one (MergeBatchFront.ts).
import * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  decGeometryRef,
  getGeometry,
  incGeometryRef,
  saveBufferGeometry,
} from '../../kernel/assets/Geometry';
import { incMaterialRef } from '../../kernel/assets/Material';
import type { MergePart } from '../../kernel/assets/GeometryMerge';
import { getRootScene } from '../../kernel/scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { lerror } from '../../utils/Logger';
import { getMergeBatchModule, isBatchedGroup, loadMergeBatchModuleAsync } from './MergeBatchFront';
import { collapseDisabledMember } from './MergeInPlace';
import { warnIfGroupSpansStreamingCells } from './MergeSceneSettings';
import {
  getMemberMesh,
  getPending,
  isMergeGroupShownUnmerged,
  markPending,
  noteMergeBuild,
  syncMemberPose,
} from './MergeState';
import type { MergeGroupData } from './MergeTypes';

/**
 * A build of more vertices than this merges in the assets worker (`mergeGeometryPartsAsync`):
 * p371 measured a warm 100k-vertex merge at about 11 ms on the main thread.
 * @internal
 */
export const WORKER_BUILD_VERTICES = 65_536;

// --- THE MERGE CODE (loaded on the first build) ---

type MergeModule = typeof import('../../kernel/assets/GeometryMerge');
let mergeModule: MergeModule | null = null;
let mergeModulePromise: Promise<MergeModule> | null = null;

/** Loads the merge code (once; a failed load is tried again by the next call). */
const loadMergeModuleAsync = () =>
  (mergeModulePromise ??= import('../../kernel/assets/GeometryMerge').then(
    (module) => (mergeModule = module),
    (err: unknown) => {
      // The next build tries again
      mergeModulePromise = null;
      throw err;
    }
  ));

// --- BUILDS ---

const scratchBox = new THREE.Box3();
const groupBounds = new THREE.Box3();
const groupCentre = new THREE.Vector3();
const toGroupSpace = new THREE.Matrix4();

/**
 * The members still in the group, alive and pointing at it.
 * @internal
 */
export const getLiveMembers = (groupEntityId: number, group: MergeGroupData, world: ECSWorld) =>
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
      paletteIndex: world.getComponent(entityId, ComponentType.MERGE_MEMBER)!._paletteIndex,
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
  // The Merging tab's A/B (debug env only): a group shown unmerged keeps its members drawn
  const isShownUnmerged = IS_DEBUG_ENV && isMergeGroupShownUnmerged(groupEntityId, world);
  members.forEach((entityId, partIndex) => {
    group.partIndex.set(entityId, partIndex);
    const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;
    // Merged for the first time (a member already built may be without TAG_MERGED: the A/B)
    const isFirstBuild = member.partIndex === -1;
    member.partIndex = partIndex;
    member._bakedMatrix = worldMatrices[partIndex];
    member._isCollapsed = false;
    if (isFirstBuild) {
      member._wasSpatialIndexed = world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED);
      world.removeComponent(entityId, ComponentType.SPATIAL_INDEXED);
    }
    // One in an edit session stays drawn by its own mesh, its new range collapsed (the session's
    // end writes it)
    if (member._editPose) collapseDisabledMember(entityId, world);
    else if (!isShownUnmerged && !world.hasComponent(entityId, ComponentType.TAG_MERGED)) {
      world.addComponent(entityId, ComponentType.TAG_MERGED, true);
    }
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
 * A build that finds no member left: an `AUTO` group goes (its id is free again), an explicit
 * one's mesh leaves the scene until a member joins. Both modes'.
 * @internal
 */
export const clearEmptyGroup = (groupEntityId: number, group: MergeGroupData, world: ECSWorld) => {
  if (group._isAuto) {
    world.deleteEntity(groupEntityId);
    return;
  }
  world.getComponent(groupEntityId, ComponentType.OBJECT3D)?.value.removeFromParent();
  group.partIndex.clear();
};

/**
 * Builds a `BAKED` group: at once on the main thread, or in the worker above
 * WORKER_BUILD_VERTICES (then the returned promise resolves when it's applied or dropped).
 */
const buildBakedGroup = (
  groupEntityId: number,
  group: MergeGroupData,
  world: ECSWorld,
  merge: MergeModule
): Promise<void> | undefined => {
  // The Merging tab's last build time (debug env only)
  const start = IS_DEBUG_ENV ? performance.now() : 0;
  const token = ++group._buildToken;
  const members = getLiveMembers(groupEntityId, group, world);
  group.members = members.concat();
  if (members.length === 0) {
    clearEmptyGroup(groupEntityId, group, world);
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

// --- THE PENDING BUILDS (both modes) ---

/** Whether the world's pending groups need the merge code (a `BAKED` one) or the batch code. */
const pendingCode = { baked: false, batched: false };
const findPendingCode = (world: ECSWorld) => {
  pendingCode.baked = false;
  pendingCode.batched = false;
  for (const groupEntityId of getPending(world)) {
    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
    if (!group) continue;
    if (isBatchedGroup(group)) pendingCode.batched = true;
    else pendingCode.baked = true;
  }
  return pendingCode;
};

/**
 * Starts loading the code the world's pending groups need and doesn't have yet (the build system's
 * first run with one; a run after it's in builds them).
 * @internal
 */
export const startPendingBuildCodeLoads = (world: ECSWorld) => {
  const { baked, batched } = findPendingCode(world);
  const log = (what: string) => (err: unknown) =>
    lerror(`Merge groups: the ${what} code failed to load.`, err);
  if (baked && !mergeModule) loadMergeModuleAsync().catch(log('merge'));
  if (batched && !getMergeBatchModule()) loadMergeBatchModuleAsync().catch(log('batch'));
};

/**
 * Loads the code the world's pending groups need (a scene step's build).
 * @internal
 */
export const loadPendingBuildCodeAsync = async (world: ECSWorld) => {
  const { baked, batched } = findPendingCode(world);
  await Promise.all([
    baked ? loadMergeModuleAsync() : undefined,
    batched ? loadMergeBatchModuleAsync() : undefined,
  ]);
};

/**
 * Builds the world's pending groups whose code is loaded (the others stay pending); the worker
 * builds' promises.
 * @internal
 */
export const buildPendingGroups = (world: ECSWorld) => {
  const pending = getPending(world);
  const batch = getMergeBatchModule();
  const running: Promise<void>[] = [];
  // A copy: a build may mark a group again (a member left), for the next run
  for (const groupEntityId of [...pending]) {
    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
    if (!group) {
      pending.delete(groupEntityId);
      continue;
    }
    const isBatched = isBatchedGroup(group);
    if (isBatched ? !batch : !mergeModule) continue;
    pending.delete(groupEntityId);
    group._isPending = false;
    if (isBatched) {
      try {
        batch!.buildBatchGroup(groupEntityId, group, world);
      } catch (err) {
        lerror(`Merge group "${group.id}" failed to build.`, err);
      }
      continue;
    }
    const build = buildBakedGroup(groupEntityId, group, world, mergeModule!);
    if (build) running.push(build);
  }
  return running;
};
