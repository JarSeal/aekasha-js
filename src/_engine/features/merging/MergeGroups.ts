// Mesh merge groups (docs/plans/p372_mesh-merge-groups.md): mesh entities sharing a material drawn
// as one merged mesh, owned by a group entity (`MERGE_GROUP`), each member (`MERGE_MEMBER`)
// keeping its entity, transform, body and asset refs. A built member is hidden by `TAG_MERGED`,
// a reason of the kernel's visibility reconcile (`reconcileObject3DVisibility`), whose hooks this
// feature registers, as `lod()` does `TAG_LOD_CULLED`'s, and leaves the DEFAULT spatial domain.
//
// Adds and deletes mark the group pending; `mergeGroupBuildSystem` (APP_RENDER_SYNC, before the
// pose producers) builds the pending groups once a frame with p371's merge (`GeometryMerge.ts`,
// loaded on the first build, so an app that never merges doesn't download it), in the assets
// worker above WORKER_BUILD_VERTICES. A member stays drawn on its own until a build includes it,
// so a worker build never leaves a frame without it.
//
// The group's mesh is added at its first build (the material is its first member's), at the
// centre of the members' bounds with the members baked relative to it: the spatial index measures
// a mesh's radius from its origin, so a world-space merge at the origin would get a wrong one.
//
// A built member moved with `updateMergeMember` has its range rewritten in place (MergeRanges.ts),
// from the world matrix it was baked with (`MERGE_MEMBER._bakedMatrix`); the bounds only grow until
// the next build.
import * as THREE from 'three/webgpu';
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
import type { MergePart } from '../../kernel/assets/GeometryMerge';
import type { MergedGeometry } from '../../kernel/assets/GeometryMergeCore';
import { getCurrentSceneId, getLoadingSceneId, getRootScene } from '../../kernel/scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { getMergeRefusal } from './MergeEligibility';
import { flipPartWinding, growMergedBounds, rewritePartVertices } from './MergeRanges';
import type { MergeGroupData, MergeGroupSettings, MergeMemberData } from './MergeTypes';

/**
 * A build of more vertices than this merges in the assets worker (`mergeGeometryPartsAsync`):
 * p371 measured a warm 100k-vertex merge at about 11 ms on the main thread.
 * @internal
 */
export const WORKER_BUILD_VERTICES = 65_536;

/** The `MANAGED_BY` manager of a group entity. */
const MANAGER = 'MERGE';

// The TAG_MERGED hooks' overrides: constants, so a toggle allocates nothing
const IS_MERGED = Object.freeze({ isMerged: true });
const IS_UNMERGED = Object.freeze({ isMerged: false });

let isInstalled = false;

/** Per world: the group entities by group id, and the groups waiting for a build. */
const groupsByWorld = new WeakMap<ECSWorld, Map<string, number>>();
const pendingByWorld = new WeakMap<ECSWorld, Set<number>>();

const getGroups = (world: ECSWorld) => {
  let groups = groupsByWorld.get(world);
  if (!groups) groupsByWorld.set(world, (groups = new Map()));
  return groups;
};

const getPending = (world: ECSWorld) => {
  let pending = pendingByWorld.get(world);
  if (!pending) pendingByWorld.set(world, (pending = new Set()));
  return pending;
};

const assertInstalled = (fn: string) => {
  if (!isInstalled) {
    throw new Error(
      `${fn}: merge groups need the merging() feature (from 'aekasha/merging') in InitEngine's \`features\`.`
    );
  }
};

const markPending = (world: ECSWorld, groupEntityId: number, group: MergeGroupData) => {
  group._isPending = true;
  getPending(world).add(groupEntityId);
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
 * @throws for an id the world has a group with already, or without the `merging()` feature
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
  const { id, ...settings } = opts;
  const groups = getGroups(ecsWorld);
  if (groups.has(id)) {
    throw new Error(`createMergeGroup: the world has a merge group "${id}" already.`);
  }
  const sceneId = getLoadingSceneId() ?? getCurrentSceneId() ?? '';
  const groupEntityId = ecsWorld.createEntity({
    appId: `mergeGroup:${id}`,
    managedBy: { manager: MANAGER, ownerId: settings.persistent ? '' : sceneId, role: 'group' },
    debugData: { name: `Merge group ${id}` },
  });
  if (settings.persistent) ecsWorld.addComponent(groupEntityId, ComponentType.PERSISTENT, true);
  ecsWorld.addComponent(groupEntityId, ComponentType.MERGE_GROUP, {
    id,
    members: [],
    settings,
    partIndex: new Map(),
    wasted: 0,
    rebuilds: 0,
    _material: null,
    _isPending: false,
    _buildToken: 0,
    _isBuilding: false,
  });
  groups.set(id, groupEntityId);
  return groupEntityId;
};

/**
 * Adds mesh entities to a merge group (created with default settings when the world has none with
 * this id). They're drawn merged from the group's next build, in the next frame's render sync (a
 * large group's builds in the assets worker, and its new members are drawn on their own until it's
 * in). A member keeps its entity, transform, physics body and assets; its own mesh is hidden.
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
  const groupEntityId =
    getGroups(ecsWorld).get(groupId) ?? createMergeGroup({ id: groupId }, ecsWorld);
  const group = existsOrThrow(
    ecsWorld.getComponent(groupEntityId, ComponentType.MERGE_GROUP),
    `addToMergeGroup: the merge group "${groupId}" has no MERGE_GROUP component.`
  );
  let added = 0;
  for (const entityId of entityIds) {
    const refusal = getMergeRefusal(entityId, ecsWorld, group);
    if (refusal) {
      lwarn(`addToMergeGroup("${groupId}"): entity ${entityId} is drawn on its own: ${refusal}.`);
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
    });
    group.members.push(entityId);
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
 * The merge group an entity is a member of (built or waiting for its build), if any.
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

/** Lets a member go: drawn on its own again, back in the spatial index if it was. */
const releaseMember = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member) return;
  world.removeComponent(entityId, ComponentType.MERGE_MEMBER);
  world.removeComponent(entityId, ComponentType.TAG_MERGED);
  if (member._wasSpatialIndexed) world.addComponent(entityId, ComponentType.SPATIAL_INDEXED, true);
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

/** A member's deletion: its group builds without it (p372 Phase 2 collapses its range instead). */
const onMemberDeleted = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member) return;
  const group = world.getComponent(member.groupEntityId, ComponentType.MERGE_GROUP);
  if (!group) return;
  const index = group.members.indexOf(entityId);
  if (index >= 0) group.members.splice(index, 1);
  group.partIndex.delete(entityId);
  markPending(world, member.groupEntityId, group);
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

const getMemberMesh = (entityId: number, world: ECSWorld) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

/**
 * Puts a member's mesh at its `TRANSFORM` now and updates its world matrix: object3DSyncSystem
 * copies a `TRANSFORM` only in MAIN, so one set later in the frame (an `APP_LOGIC` move followed
 * by `updateMergeMember`) isn't on the mesh yet. The sync's dirty flag stays for the sync.
 */
const syncMemberPose = (entityId: number, mesh: THREE.Mesh, world: ECSWorld) => {
  const store = world.getTypedTransformStore();
  if (store) {
    const slot = store.getSlot(entityId);
    if (slot !== -1) store.copyToObject3D(slot, mesh);
  } else {
    const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (transform) {
      mesh.position.copy(transform.position);
      mesh.quaternion.copy(transform.quaternion);
      mesh.scale.copy(transform.scale);
    }
  }
  mesh.updateWorldMatrix(true, false);
};

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
  const token = ++group._buildToken;
  const members = getLiveMembers(groupEntityId, group, world);
  group.members = members.concat();
  if (members.length === 0) {
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
        return;
      }
      applyBuild(groupEntityId, group, members, geometry, build, world);
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

// --- IN-PLACE UPDATES ---

const groupInverse = new THREE.Matrix4();
const partMatrix = new THREE.Matrix4();
const previousPartMatrix = new THREE.Matrix4();

/** Writes a built member's range for its pose now (`updateMergeMember`): its vertices, its
 * winding when its mirroring changed, and the merged bounds when it moved out of them. */
const rewriteMember = (
  entityId: number,
  member: MergeMemberData,
  group: MergeGroupData,
  world: ECSWorld
) => {
  const groupEntityId = member.groupEntityId;
  const groupMesh = world.getComponent(groupEntityId, ComponentType.OBJECT3D)?.value as
    | THREE.Mesh
    | undefined;
  const merged = groupMesh?.geometry as MergedGeometry | undefined;
  const range = merged?.userData.mergeParts?.[member.partIndex];
  if (!groupMesh || !merged || !range) return;
  const mesh = getMemberMesh(entityId, world);
  if (mesh.geometry.getAttribute('position').count !== range.vertexCount) {
    lwarn(
      `updateMergeMember: entity ${entityId}'s geometry isn't the one merged (another vertex count): its merge group "${group.id}" builds again.`
    );
    markPending(world, groupEntityId, group);
    return;
  }
  syncMemberPose(entityId, mesh, world);
  groupMesh.updateWorldMatrix(true, false);
  groupInverse.copy(groupMesh.matrixWorld).invert();
  partMatrix.multiplyMatrices(groupInverse, mesh.matrixWorld);
  previousPartMatrix.multiplyMatrices(groupInverse, member._bakedMatrix);
  if (rewritePartVertices(merged, range, mesh.geometry, partMatrix, previousPartMatrix)) {
    flipPartWinding(merged, range);
  }
  member._bakedMatrix.copy(mesh.matrixWorld);
  if (
    growMergedBounds(merged, mesh.geometry, partMatrix) &&
    world.hasComponent(groupEntityId, ComponentType.SPATIAL_INDEXED)
  ) {
    // Joined again, so the spatial index measures the grown bounds
    world.removeComponent(groupEntityId, ComponentType.SPATIAL_INDEXED);
    world.addComponent(groupEntityId, ComponentType.SPATIAL_INDEXED, true);
  }
};

/**
 * Builds the pending merge groups, once a frame (APP_RENDER_SYNC, `MERGE_BUILD`). Its first run
 * with a pending group loads the merge code, and the run after it's in builds.
 */
const mergeGroupBuildSystem = (world: ECSWorld) => {
  const pending = pendingByWorld.get(world);
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
 * Builds the world's pending merge groups now, worker builds included, without waiting for the
 * build system: for a scene load, so its first frame draws them merged (p372 §6).
 * @internal
 */
export const buildPendingMergeGroupsAsync = async (world?: ECSWorld) => {
  const ecsWorld = world ?? getECSWorld();
  if (!pendingByWorld.get(ecsWorld)?.size) return;
  const merge = await loadMergeModuleAsync();
  await Promise.all(buildPendingGroups(ecsWorld, merge));
};

/**
 * Installs the merge groups (the `merging()` feature's install, MergingFeature.ts): the
 * `TAG_MERGED` visibility hooks, the groups' and members' deletion hooks and the build system.
 * @internal
 */
export const installMergeGroups = (ctx: FeatureContext) => {
  isInstalled = true;
  ctx.registerComponentHooks(ComponentType.TAG_MERGED, {
    onAddComponent: (entityId, world) => reconcileObject3DVisibility(entityId, world, IS_MERGED),
    onRemoveComponent: (entityId, world) =>
      reconcileObject3DVisibility(entityId, world, IS_UNMERGED),
  });
  ctx.registerComponentHooks(ComponentType.MERGE_GROUP, { onDeleteEntity: onGroupDeleted });
  ctx.registerComponentHooks(ComponentType.MERGE_MEMBER, { onDeleteEntity: onMemberDeleted });
  ctx.registerPlugin((world) => {
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'mergeGroupBuildSystem',
      mergeGroupBuildSystem,
      APP_RENDER_SYNC_ORDER.MERGE_BUILD
    );
  });
};
