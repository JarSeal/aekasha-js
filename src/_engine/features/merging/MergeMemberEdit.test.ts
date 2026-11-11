import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry } from '../../kernel/assets/Geometry';
import { mergeGeometryParts } from '../../kernel/assets/GeometryMerge';
import type { MergedGeometry } from '../../kernel/assets/GeometryMergeCore';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene, runOnAllSceneExits } from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
} from './MergeGroups';
import {
  beginMergeMemberEdit,
  cancelMergeMemberEdit,
  endMergeMemberEdit,
  getMergeMemberAtFace,
  isMergeMemberInEdit,
} from './MergeMemberEdit';

// p373 D4: a member's edit sessions and face picking

// The warning log, and the worker merge: held until the test lets it finish (as MergeGroups.test.ts)
const fns = vi.hoisted(() => ({
  lwarn: vi.fn(),
  release: [] as (() => void)[],
}));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));
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
  installMergeGroups(ctx);
  createGeometry({
    id: 'mergeEditBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeEditMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  world.clearWorld();
  fns.lwarn.mockClear();
  fns.release.length = 0;
});

let seq = 0;
const createBox = (x: number) =>
  createMeshEntity({ geo: 'mergeEditBox', mat: 'mergeEditMat', position: { x, y: 1 } });

const getMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Mesh | undefined;
const getGroup = (groupEntityId: number) =>
  world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
const getMerged = (groupEntityId: number) => getMesh(groupEntityId)!.geometry as MergedGeometry;

/** A group of three boxes at x 0, 2 and 4; built unless `build` is false. */
const createGroupAsync = async (build = true) => {
  const groupId = `editGroup${seq++}`;
  const groupEntityId = createMergeGroup({ id: groupId });
  const members = [createBox(0), createBox(2), createBox(4)];
  addToMergeGroup(groupId, members);
  if (build) await buildPendingMergeGroupsAsync();
  return { groupId, groupEntityId, members, group: getGroup(groupEntityId) };
};

/** The members merged fresh at the group mesh's place: what an in-place write must match. */
const getFreshMerge = (groupEntityId: number, members: number[]) => {
  const groupMesh = getMesh(groupEntityId)!;
  groupMesh.updateWorldMatrix(true, false);
  const inverse = groupMesh.matrixWorld.clone().invert();
  return mergeGeometryParts(
    members.map((id) => {
      const mesh = getMesh(id)!;
      mesh.position.copy(world.getComponent(id, ComponentType.TRANSFORM)!.position);
      mesh.quaternion.copy(world.getComponent(id, ComponentType.TRANSFORM)!.quaternion);
      mesh.scale.copy(world.getComponent(id, ComponentType.TRANSFORM)!.scale);
      mesh.updateWorldMatrix(true, false);
      return { geo: mesh.geometry, matrix: inverse.clone().multiply(mesh.matrixWorld) };
    })
  );
};

const expectSameGeometry = (a: THREE.BufferGeometry, b: THREE.BufferGeometry) => {
  for (const name in b.attributes) {
    const left = a.getAttribute(name).array;
    const right = b.getAttribute(name).array;
    expect(left.length).toBe(right.length);
    for (let i = 0; i < left.length; i++) expect(left[i]).toBeCloseTo(right[i], 5);
  }
  expect(Array.from(a.index!.array)).toEqual(Array.from(b.index!.array));
};

const expectCollapsed = (merged: MergedGeometry, part: number) => {
  const { indexStart, indexCount, vertexStart } = merged.userData.mergeParts[part];
  const range = Array.from(merged.index!.array).slice(indexStart, indexStart + indexCount);
  expect(new Set(range)).toEqual(new Set([vertexStart]));
};

const isDrawnOnItsOwn = (entityId: number) => getMesh(entityId)!.visible;

const setScale = (id: number, x: number, y: number, z: number) => {
  const transform = world.getComponent(id, ComponentType.TRANSFORM)!;
  transform.scale.set(x, y, z);
  transform.setDirty();
  world.commitTransform(id, transform);
};

describe('an edit session', () => {
  test('draws the member on its own, collapsed in the group, and its end merges it back in place', async () => {
    const { groupEntityId, members, group } = await createGroupAsync();
    const merged = getMerged(groupEntityId);

    beginMergeMemberEdit(members[1]);
    expect(isMergeMemberInEdit(members[1])).toBe(true);
    expect(isMergeMemberInEdit(members[0])).toBe(false);
    expectCollapsed(merged, 1);
    expect(isDrawnOnItsOwn(members[1])).toBe(true);
    expect(isDrawnOnItsOwn(members[0])).toBe(false);
    expect(group.wasted).toBe(0);

    // Moved as a drag would, many times: nothing written to the group meanwhile
    const index = merged.index as THREE.BufferAttribute;
    index.clearUpdateRanges();
    for (let i = 1; i <= 5; i++) world.setTransform(members[1], { pos: { x: 2, y: 1 + i, z: i } });
    expect(index.updateRanges).toEqual([]);

    endMergeMemberEdit(members[1]);
    expect(isMergeMemberInEdit(members[1])).toBe(false);
    expect(isDrawnOnItsOwn(members[1])).toBe(false);
    expectSameGeometry(merged, getFreshMerge(groupEntityId, members));
    // No rebuild, nothing pending: the in-place writes only
    expect(group.rebuilds).toBe(1);
    expect(group._isPending).toBe(false);
    expect(getMesh(groupEntityId)!.geometry).toBe(merged);
  });

  test('ends with the winding of a mirroring that came during it', async () => {
    const { groupEntityId, members } = await createGroupAsync();
    beginMergeMemberEdit(members[2]);
    setScale(members[2], -1, 2, 1);
    world.setTransform(members[2], {
      pos: { x: 5, y: 0, z: 1 },
      rot: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7),
    });
    endMergeMemberEdit(members[2]);
    expectSameGeometry(getMerged(groupEntityId), getFreshMerge(groupEntityId, members));
  });

  test('moves the member to its TRANSFORM at the end, so a body follows', async () => {
    const { members } = await createGroupAsync();
    beginMergeMemberEdit(members[0]);
    // A TRANSFORM written directly (a gizmo's write), not through setTransform
    const transform = world.getComponent(members[0], ComponentType.TRANSFORM)!;
    transform.position.set(-3, 2, 1);
    transform.setDirty();
    world.commitTransform(members[0], transform);
    const setTransform = vi.spyOn(world, 'setTransform');
    endMergeMemberEdit(members[0]);
    expect(setTransform).toHaveBeenCalledTimes(1);
    expect(setTransform.mock.calls[0][0]).toBe(members[0]);
    const { pos } = setTransform.mock.calls[0][1];
    expect([pos!.x, pos!.y, pos!.z]).toEqual([-3, 2, 1]);
    setTransform.mockRestore();
  });

  test('cancelled, puts the pose at its begin back and merges it there', async () => {
    const { groupEntityId, members, group } = await createGroupAsync();
    const merged = getMerged(groupEntityId);
    const before = Array.from(merged.getAttribute('position').array);
    const indexBefore = Array.from(merged.index!.array);

    beginMergeMemberEdit(members[1]);
    setScale(members[1], 3, 3, 3);
    world.setTransform(members[1], { pos: { x: 9, y: 9, z: 9 } });
    // A second begin keeps the first pose
    beginMergeMemberEdit(members[1]);
    cancelMergeMemberEdit(members[1]);

    const transform = world.getComponent(members[1], ComponentType.TRANSFORM)!;
    expect(transform.position.toArray()).toEqual([2, 1, 0]);
    expect(transform.scale.toArray()).toEqual([1, 1, 1]);
    const after = merged.getAttribute('position').array;
    before.forEach((value, i) => expect(after[i]).toBeCloseTo(value, 5));
    expect(Array.from(merged.index!.array)).toEqual(indexBefore);
    expect(isDrawnOnItsOwn(members[1])).toBe(false);
    expect(group.rebuilds).toBe(1);
  });

  test("of a member not built yet only records its pose, and the build keeps it out until it's over", async () => {
    const { groupEntityId, members, group } = await createGroupAsync(false);
    beginMergeMemberEdit(members[0]);
    world.setTransform(members[0], { pos: { x: -2, y: 1, z: 0 } });
    await buildPendingMergeGroupsAsync();
    expectCollapsed(getMerged(groupEntityId), 0);
    expect(isDrawnOnItsOwn(members[0])).toBe(true);
    expect(isDrawnOnItsOwn(members[1])).toBe(false);

    world.setTransform(members[0], { pos: { x: -4, y: 1, z: 0 } });
    endMergeMemberEdit(members[0]);
    expect(isDrawnOnItsOwn(members[0])).toBe(false);
    expectSameGeometry(getMerged(groupEntityId), getFreshMerge(groupEntityId, members));
    expect(group.rebuilds).toBe(1);
  });

  test('stays drawn on its own through a rebuild, merged at the end', async () => {
    const { groupId, groupEntityId, members } = await createGroupAsync();
    beginMergeMemberEdit(members[1]);
    world.setTransform(members[1], { pos: { x: 2, y: 4, z: 0 } });
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expectCollapsed(getMerged(groupEntityId), 1);
    expect(isDrawnOnItsOwn(members[1])).toBe(true);

    world.setTransform(members[1], { pos: { x: 2, y: 6, z: 0 } });
    endMergeMemberEdit(members[1]);
    expectSameGeometry(getMerged(groupEntityId), getFreshMerge(groupEntityId, members));
  });

  test('begun during a worker build: the build applies it collapsed', async () => {
    const groupId = `editGroup${seq++}`;
    const groupEntityId = createMergeGroup({ id: groupId });
    const big = createMeshEntity({
      geo: new THREE.SphereGeometry(1, 300, 300),
      mat: 'mergeEditMat',
      position: { x: 0 },
    });
    const box = createBox(3);
    addToMergeGroup(groupId, [big, box]);
    const build = buildPendingMergeGroupsAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    beginMergeMemberEdit(box);
    for (const release of fns.release.splice(0)) release();
    await build;
    expectCollapsed(getMerged(groupEntityId), 1);
    expect(isDrawnOnItsOwn(box)).toBe(true);
    expect(isDrawnOnItsOwn(big)).toBe(false);
  });

  test('of a disabled member: an enable during it keeps it collapsed, and the end leaves it for the enable', async () => {
    const { groupEntityId, members } = await createGroupAsync();
    const merged = getMerged(groupEntityId);
    beginMergeMemberEdit(members[1]);
    world.setDisabled(members[1], true);
    expect(isDrawnOnItsOwn(members[1])).toBe(false);
    world.setDisabled(members[1], false);
    expectCollapsed(merged, 1);
    expect(isDrawnOnItsOwn(members[1])).toBe(true);

    world.setDisabled(members[1], true);
    world.setTransform(members[1], { pos: { x: 2, y: 3, z: 0 } });
    endMergeMemberEdit(members[1]);
    expectCollapsed(merged, 1);
    world.setDisabled(members[1], false);
    expect(isDrawnOnItsOwn(members[1])).toBe(false);
    expectSameGeometry(merged, getFreshMerge(groupEntityId, members));
  });

  test('goes with the member when it leaves its group or is deleted', async () => {
    const { members, group } = await createGroupAsync();
    beginMergeMemberEdit(members[0]);
    world.setTransform(members[0], { pos: { x: -3, y: 1, z: 0 } });
    removeFromMergeGroup([members[0]]);
    expect(isMergeMemberInEdit(members[0])).toBe(false);
    expect(isDrawnOnItsOwn(members[0])).toBe(true);
    expect(group.wasted).toBe(24);
    endMergeMemberEdit(members[0]);
    cancelMergeMemberEdit(members[0]);
    expect(world.getComponent(members[0], ComponentType.TRANSFORM)!.position.x).toBe(-3);

    beginMergeMemberEdit(members[1]);
    world.deleteEntity(members[1]);
    expect(() => endMergeMemberEdit(members[1])).not.toThrow();
    expect(group.members).toEqual([members[2]]);
  });

  test('is cancelled by a scene exit', async () => {
    const { groupEntityId, members } = await createGroupAsync();
    beginMergeMemberEdit(members[2]);
    world.setTransform(members[2], { pos: { x: 8, y: 1, z: 0 } });
    runOnAllSceneExits();
    expect(isMergeMemberInEdit(members[2])).toBe(false);
    expect(world.getComponent(members[2], ComponentType.TRANSFORM)!.position.x).toBe(4);
    expect(isDrawnOnItsOwn(members[2])).toBe(false);
    expectSameGeometry(getMerged(groupEntityId), getFreshMerge(groupEntityId, members));
  });

  test('warns for a non-member; ending or cancelling without a session does nothing', async () => {
    const loner = createBox(0);
    beginMergeMemberEdit(loner);
    expect(fns.lwarn).toHaveBeenCalledWith(
      `beginMergeMemberEdit: entity ${loner} isn't in a merge group.`
    );
    expect(isMergeMemberInEdit(loner)).toBe(false);

    const { groupEntityId, members } = await createGroupAsync();
    const index = getMerged(groupEntityId).index as THREE.BufferAttribute;
    index.clearUpdateRanges();
    endMergeMemberEdit(members[0]);
    cancelMergeMemberEdit(members[0]);
    endMergeMemberEdit(loner);
    expect(index.updateRanges).toEqual([]);
    expect(fns.lwarn).toHaveBeenCalledTimes(1);
  });
});

describe('getMergeMemberAtFace', () => {
  const down = new THREE.Vector3(0, -1, 0);

  /** The member under x by a raycast down onto the group mesh. */
  const pickAt = (groupEntityId: number, x: number) => {
    const groupMesh = getMesh(groupEntityId)!;
    groupMesh.updateWorldMatrix(true, false);
    const [hit] = new THREE.Raycaster(new THREE.Vector3(x, 10, 0.1), down).intersectObject(
      groupMesh
    );
    if (!hit || hit.faceIndex == null) return undefined;
    return getMergeMemberAtFace(hit.object.userData.entityId as number, hit.faceIndex);
  };

  test('maps a raycast hit on a group mesh to the member drawn there', async () => {
    const { groupEntityId, members } = await createGroupAsync();
    expect(pickAt(groupEntityId, 0)).toBe(members[0]);
    expect(pickAt(groupEntityId, 2.2)).toBe(members[1]);
    expect(pickAt(groupEntityId, 3.8)).toBe(members[2]);
    expect(pickAt(groupEntityId, 7)).toBeUndefined();
    // Every face of a part, its first and last
    const { indexStart, indexCount } = getMerged(groupEntityId).userData.mergeParts[1];
    expect(getMergeMemberAtFace(groupEntityId, indexStart / 3)).toBe(members[1]);
    expect(getMergeMemberAtFace(groupEntityId, (indexStart + indexCount) / 3 - 1)).toBe(members[1]);
    expect(getMergeMemberAtFace(groupEntityId, (indexStart + indexCount) / 3)).toBe(members[2]);
    expect(getMergeMemberAtFace(groupEntityId, 10_000)).toBeUndefined();
  });

  test('answers nothing for a removed member, a group not built yet or another entity', async () => {
    const { groupEntityId, members } = await createGroupAsync();
    const { indexStart } = getMerged(groupEntityId).userData.mergeParts[1];
    removeFromMergeGroup([members[1]]);
    // Its range collapsed: the ray goes through to nothing, and its faces have no member
    expect(pickAt(groupEntityId, 2)).toBeUndefined();
    expect(getMergeMemberAtFace(groupEntityId, indexStart / 3)).toBeUndefined();
    expect(pickAt(groupEntityId, 4)).toBe(members[2]);

    const pending = await createGroupAsync(false);
    expect(getMergeMemberAtFace(pending.groupEntityId, 0)).toBeUndefined();
    expect(getMergeMemberAtFace(members[0], 0)).toBeUndefined();
  });
});
