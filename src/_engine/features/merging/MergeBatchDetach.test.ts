import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry } from '../../kernel/assets/Geometry';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity } from '../../kernel/mesh/Mesh';
import { installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene, getRootScene } from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  dissolveMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
} from './MergeGroups';
import { getMergeMemberAtBatchId, getMergeMemberAtFace } from './MergeMemberEdit';
import { getGroups } from './MergeState';

// p375 Phase 2 S1 (docs/plans/_DONE_p375_batched-mesh-batches.md): a batched member's own mesh is out of
// the scene graph while its batch draws it, back under the root scene when it's drawn on its own
// again; a raycast hits the batch, and `getMergeMemberAtBatchId` maps the hit to the member.
// MergeBatch.test.ts has the rest of the batch (the sync's tests run with the meshes out).

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'detachTestBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'detachTestMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => world.clearWorld());

let seq = 0;

/** A group of `count` boxes at x = 0, 2, 4, …, y 1, built. */
const createBuiltGroupAsync = async (count: number, mode: 'BAKED' | 'BATCHED' = 'BATCHED') => {
  const groupId = `detach${seq++}`;
  createMergeGroup({ id: groupId, mode });
  const members = Array.from({ length: count }, (_, i) =>
    createMeshEntity({ geo: 'detachTestBox', mat: 'detachTestMat', position: { x: i * 2, y: 1 } })
  );
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, groupEntityId: getGroups(world).get(groupId)!, members };
};

const getOwnMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

const getBatch = (groupEntityId: number) =>
  world.getComponent(groupEntityId, ComponentType.OBJECT3D)!.value as THREE.BatchedMesh;

/** Whether the entity's own mesh is under the root scene. */
const isInScene = (entityId: number) => getOwnMesh(entityId).parent === getRootScene();

describe("a batched member's own mesh", () => {
  test('leaves the scene graph with its build, as a baked member does (p378)', async () => {
    const batched = await createBuiltGroupAsync(3);
    const baked = await createBuiltGroupAsync(2, 'BAKED');
    expect(batched.members.map((id) => getOwnMesh(id).parent)).toEqual([null, null, null]);
    expect(getBatch(batched.groupEntityId).parent).toBe(getRootScene());
    expect(baked.members.map(isInScene)).toEqual([false, false]);
  });

  test('a member waiting for its build stays in the scene until the build', async () => {
    const { groupId, members } = await createBuiltGroupAsync(1);
    const late = createMeshEntity({ geo: 'detachTestBox', mat: 'detachTestMat' });
    addToMergeGroup(groupId, [late]);
    expect(isInScene(late)).toBe(true);
    await buildPendingMergeGroupsAsync();
    expect([members[0], late].map(isInScene)).toEqual([false, false]);
  });

  test('comes back under the root scene, drawn, when it leaves or its group is dissolved', async () => {
    const { groupId, members } = await createBuiltGroupAsync(3);
    removeFromMergeGroup([members[0]]);
    expect(isInScene(members[0])).toBe(true);
    expect(getOwnMesh(members[0]).visible).toBe(true);

    dissolveMergeGroup(groupId);
    expect(members.map(isInScene)).toEqual([true, true, true]);
    expect(members.map((id) => getOwnMesh(id).visible)).toEqual([true, true, true]);
  });

  test("stays out through a rebuild, and a deleted member's isn't put back", async () => {
    const { groupId, members } = await createBuiltGroupAsync(3);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expect(members.map(isInScene)).toEqual([false, false, false]);

    const mesh = getOwnMesh(members[1]);
    world.deleteEntity(members[1]);
    expect(mesh.parent).toBeNull();
    expect(getRootScene()!.children).not.toContain(mesh);
  });

  test('a leave after a scene graph change goes back under the current root scene', async () => {
    const { members } = await createBuiltGroupAsync(1);
    const root = getRootScene()!;
    removeFromMergeGroup(members);
    expect(getOwnMesh(members[0]).parent).toBe(root);
  });
});

describe("a batched group's picking", () => {
  /** Casts down at x from above (off a box's diagonal), against the whole root scene. */
  const castAt = (x: number) => {
    getRootScene()!.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x + 0.2, 10, 0.1),
      new THREE.Vector3(0, -1, 0)
    );
    return ray.intersectObject(getRootScene()!, true);
  };

  test('hits the batch, whose batchId getMergeMemberAtBatchId maps to the member', async () => {
    const { groupEntityId, members } = await createBuiltGroupAsync(3);
    const hits = castAt(2);
    // Only the batch: the member's own mesh isn't in the scene graph
    expect(hits.map((hit) => hit.object)).toEqual([getBatch(groupEntityId)]);
    const [hit] = hits;
    expect(hit.object.userData.entityId).toBe(groupEntityId);
    expect(getMergeMemberAtBatchId(groupEntityId, hit.batchId!)).toBe(members[1]);
    expect(getMergeMemberAtFace(groupEntityId, hit.faceIndex!)).toBeUndefined();
  });

  test("answers undefined for a freed instance, an unknown id and a group that isn't batched", async () => {
    const { groupEntityId, members } = await createBuiltGroupAsync(2);
    const instanceId = world.getComponent(members[0], ComponentType.MERGE_MEMBER)!.instanceId;
    removeFromMergeGroup([members[0]]);
    expect(getMergeMemberAtBatchId(groupEntityId, instanceId)).toBeUndefined();
    expect(getMergeMemberAtBatchId(groupEntityId, 99)).toBeUndefined();
    expect(getMergeMemberAtBatchId(groupEntityId, -1)).toBeUndefined();

    const baked = await createBuiltGroupAsync(1, 'BAKED');
    expect(getMergeMemberAtBatchId(baked.groupEntityId, 0)).toBeUndefined();
    expect(getMergeMemberAtBatchId(members[1], 0)).toBeUndefined();
  });
});
