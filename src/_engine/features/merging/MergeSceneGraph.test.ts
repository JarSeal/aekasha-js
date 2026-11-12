import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry, getGeometryRegistry } from '../../kernel/assets/Geometry';
import { mergeGeometryParts } from '../../kernel/assets/GeometryMerge';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { addToGroupEntity, createGroupEntity, installGroups } from '../../kernel/scene/Group';
import { createRootScene, getRootScene } from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  dissolveMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
  updateMergeMember,
} from './MergeGroups';
import {
  beginMergeMemberEdit,
  cancelMergeMemberEdit,
  endMergeMemberEdit,
  getMergeMemberAtFace,
} from './MergeMemberEdit';
import { getGroupMesh, getGroups } from './MergeState';

// p378 Phase 1 (docs/plans/_DONE_p378_baked-members-out-of-the-scene-graph.md): a baked member's own
// mesh is out of the scene graph while its group's mesh draws it, as a batched member's
// (MergeBatchDetach.test.ts), and back under the root scene when it's drawn on its own again. A
// member anywhere but directly under the root scene, or with children, stays in the graph. The
// readers (the builds, the in-place writes, picking, a deletion) work on it out of the graph;
// the moved-member check's test is debug/_dbg__MergeGroups.test.ts', "Show unmerged"'s
// debug/_dbg__MergingUnmerged.test.ts'.

// The worker merge, held until the test lets it finish (the real merge on the main thread then)
const fns = vi.hoisted(() => ({ release: [] as (() => void)[] }));
vi.mock(import('../../kernel/assets/GeometryMerge'), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    mergeGeometryPartsAsync: (parts, opts) => {
      const geometry = original.mergeGeometryParts(parts, opts);
      return new Promise((resolve) => fns.release.push(() => resolve(geometry)));
    },
  };
});

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installGroups(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'sceneGraphBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'sceneGraphMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  world.clearWorld();
  fns.release.length = 0;
});

let seq = 0;

const createBox = (x: number) =>
  createMeshEntity({ geo: 'sceneGraphBox', mat: 'sceneGraphMat', position: { x, y: 1 } });

/** A baked group of boxes at x = 0, 2, 4, …, built. */
const createBuiltGroupAsync = async (count: number) => {
  const groupId = `sceneGraph${seq++}`;
  const groupEntityId = createMergeGroup({ id: groupId });
  const members = Array.from({ length: count }, (_, i) => createBox(i * 2));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, groupEntityId, members };
};

const getOwnMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

/** Whether the entity's own mesh is under the root scene. */
const isInScene = (entityId: number) => getOwnMesh(entityId).parent === getRootScene();
/** Whether it's under the root scene and drawn (on its own). */
const isDrawnOnItsOwn = (entityId: number) => isInScene(entityId) && getOwnMesh(entityId).visible;

/** The merged geometry the members would give merged fresh at the group mesh's place. */
const getFreshMerge = (groupMesh: THREE.Mesh, members: number[]) => {
  groupMesh.updateWorldMatrix(true, false);
  const inverse = groupMesh.matrixWorld.clone().invert();
  return mergeGeometryParts(
    members.map((id) => {
      const mesh = getOwnMesh(id);
      mesh.updateWorldMatrix(true, false);
      return { geo: mesh.geometry, matrix: inverse.clone().multiply(mesh.matrixWorld) };
    })
  );
};

const expectSamePositions = (a: THREE.BufferGeometry, b: THREE.BufferGeometry) => {
  const left = a.getAttribute('position').array;
  const right = b.getAttribute('position').array;
  expect(left.length).toBe(right.length);
  for (let i = 0; i < left.length; i++) expect(left[i]).toBeCloseTo(right[i], 5);
};

describe("a baked member's own mesh", () => {
  test('leaves the scene graph with its build, hidden; the group mesh is in it', async () => {
    const { groupEntityId, members } = await createBuiltGroupAsync(3);
    expect(members.map((id) => getOwnMesh(id).parent)).toEqual([null, null, null]);
    expect(members.map((id) => getOwnMesh(id).visible)).toEqual([false, false, false]);
    expect(getRootScene()!.children).toEqual([getGroupMesh(groupEntityId, world)]);
  });

  test('a member waiting for its build stays in the scene until the build', async () => {
    const { groupId, members } = await createBuiltGroupAsync(1);
    const late = createBox(4);
    addToMergeGroup(groupId, [late]);
    expect(isDrawnOnItsOwn(late)).toBe(true);
    await buildPendingMergeGroupsAsync();
    expect([members[0], late].map(isInScene)).toEqual([false, false]);
  });

  test('comes back under the root scene, drawn, when it leaves, its group is dissolved or deleted', async () => {
    const dissolved = await createBuiltGroupAsync(3);
    removeFromMergeGroup([dissolved.members[0]]);
    expect(isDrawnOnItsOwn(dissolved.members[0])).toBe(true);
    expect(dissolved.members.slice(1).map(isInScene)).toEqual([false, false]);
    dissolveMergeGroup(dissolved.groupId);
    expect(dissolved.members.map(isDrawnOnItsOwn)).toEqual([true, true, true]);

    const deleted = await createBuiltGroupAsync(2);
    world.deleteEntity(deleted.groupEntityId);
    expect(deleted.members.map(isDrawnOnItsOwn)).toEqual([true, true]);
  });

  test('comes back for an edit session, and leaves again at its end or cancel', async () => {
    const { members } = await createBuiltGroupAsync(2);
    beginMergeMemberEdit(members[0]);
    expect(isDrawnOnItsOwn(members[0])).toBe(true);
    expect(isInScene(members[1])).toBe(false);
    world.setTransform(members[0], { pos: { x: -1, y: 2, z: 0 } });
    endMergeMemberEdit(members[0]);
    expect(isInScene(members[0])).toBe(false);

    beginMergeMemberEdit(members[1]);
    expect(isDrawnOnItsOwn(members[1])).toBe(true);
    cancelMergeMemberEdit(members[1]);
    expect(isInScene(members[1])).toBe(false);
  });

  test('stays out through a rebuild, a worker build and a DISABLED round trip', async () => {
    const { groupId, groupEntityId, members } = await createBuiltGroupAsync(2);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expect(members.map(isInScene)).toEqual([false, false]);

    // Over the worker threshold: the group builds in the (mocked) worker, the newcomer drawn on its
    // own until the merge is in, the others still out
    const big = createMeshEntity({
      geo: new THREE.SphereGeometry(1, 300, 300),
      mat: 'sceneGraphMat',
      position: { x: 8 },
    });
    addToMergeGroup(groupId, [big]);
    const build = buildPendingMergeGroupsAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fns.release).toHaveLength(1);
    expect(isDrawnOnItsOwn(big)).toBe(true);
    expect(members.map(isInScene)).toEqual([false, false]);
    for (const release of fns.release.splice(0)) release();
    await build;
    expect(getGroupMesh(groupEntityId, world)!.geometry.getAttribute('position').count).toBe(
      90_601 + 48
    );
    expect([...members, big].map(isInScene)).toEqual([false, false, false]);

    // A disabled member keeps TAG_MERGED (collapsed in place): out, and out once enabled
    world.setDisabled(members[0], true);
    expect(isInScene(members[0])).toBe(false);
    world.setDisabled(members[0], false);
    expect(isInScene(members[0])).toBe(false);
    expect(getOwnMesh(members[0]).visible).toBe(false);
  });

  test('a member under a group entity, or with a child, stays in the scene graph', async () => {
    const parentId = createGroupEntity({ appId: `sceneGraphParent${seq++}`, position: { y: 2 } });
    const inGroup = createMeshEntity(
      { geo: 'sceneGraphBox', mat: 'sceneGraphMat', position: { x: 1 } },
      { doNotAddToScene: true }
    );
    const parent = addToGroupEntity(parentId, getOwnMesh(inGroup))!;
    const withChild = createBox(4);
    const child = new THREE.Object3D();
    getOwnMesh(withChild).add(child);
    const groupId = `sceneGraph${seq++}`;
    addToMergeGroup(groupId, [inGroup, withChild]);
    await buildPendingMergeGroupsAsync();

    expect(world.hasComponent(inGroup, ComponentType.TAG_MERGED)).toBe(true);
    expect(getOwnMesh(inGroup).parent).toBe(parent);
    expect(isInScene(withChild)).toBe(true);
    expect(child.parent).toBe(getOwnMesh(withChild));
    expect([inGroup, withChild].map((id) => getOwnMesh(id).visible)).toEqual([false, false]);
    // Merged at its world pose: under the group entity, lifted by it
    const groupMesh = getGroupMesh(getGroups(world).get(groupId)!, world)!;
    groupMesh.geometry.computeBoundingBox();
    // (its top at 2.5; the other member's at 1.5)
    expect(groupMesh.geometry.boundingBox!.max.y + groupMesh.position.y).toBeCloseTo(2.5, 5);

    // Its group entity's deletion still finds it
    world.deleteEntity(parentId);
    expect(world.isAlive(inGroup)).toBe(false);
    expect(
      world.getComponent(getGroups(world).get(groupId)!, ComponentType.MERGE_GROUP)!.members
    ).toEqual([withChild]);
  });

  test('a deleted member is disposed out of the graph, and not put back', async () => {
    createGeometry({
      id: 'sceneGraphOwnBox',
      type: 'BOX',
      params: { width: 1, height: 1, depth: 1 },
    });
    const groupId = `sceneGraph${seq++}`;
    const member = createMeshEntity({ geo: 'sceneGraphOwnBox', mat: 'sceneGraphMat' });
    addToMergeGroup(groupId, [member, createBox(2)]);
    await buildPendingMergeGroupsAsync();
    const mesh = getOwnMesh(member);
    expect(mesh.parent).toBeNull();
    const dispose = vi.spyOn(mesh, 'dispose');

    world.deleteEntity(member);
    expect(dispose).toHaveBeenCalledOnce();
    expect(mesh.parent).toBeNull();
    expect(getRootScene()!.children).not.toContain(mesh);
    // Its geometry's last ref went with it
    expect(getGeometryRegistry().sceneGraphOwnBox).toBeUndefined();
  });
});

describe("a detached member's readers", () => {
  test('updateMergeMember and a rebuild write the positions a fresh merge gives', async () => {
    const { groupId, groupEntityId, members } = await createBuiltGroupAsync(3);
    const groupMesh = getGroupMesh(groupEntityId, world)!;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);

    // Moved through its TRANSFORM only: its detached mesh isn't synced yet
    world.setTransform(members[1], { pos: { x: 2, y: 3, z: 1 }, rot: q });
    updateMergeMember(members[1]);
    expectSamePositions(groupMesh.geometry, getFreshMerge(groupMesh, members));
    expect(isInScene(members[1])).toBe(false);

    world.setTransform(members[2], { pos: { x: 7, y: -1, z: 2 }, rot: q });
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expect(world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!.rebuilds).toBe(2);
    expectSamePositions(groupMesh.geometry, getFreshMerge(groupMesh, members));
    expect(members.map(isInScene)).toEqual([false, false, false]);
  });

  test('a root-scene raycast hits the group mesh only, and getMergeMemberAtFace maps the hit', async () => {
    const { groupEntityId, members } = await createBuiltGroupAsync(3);
    const groupMesh = getGroupMesh(groupEntityId, world)!;
    getRootScene()!.updateMatrixWorld(true);
    const hits = new THREE.Raycaster(
      new THREE.Vector3(2.2, 10, 0.1),
      new THREE.Vector3(0, -1, 0)
    ).intersectObject(getRootScene()!, true);
    expect(hits.map((hit) => hit.object)).toEqual([groupMesh]);
    const [hit] = hits;
    expect(hit.object.userData.entityId).toBe(groupEntityId);
    expect(getMergeMemberAtFace(groupEntityId, hit.faceIndex!)).toBe(members[1]);
  });
});
