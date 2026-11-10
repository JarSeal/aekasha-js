import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry, getGeometry, getGeometryRegistry } from '../../kernel/assets/Geometry';
import { mergeGeometryParts } from '../../kernel/assets/GeometryMerge';
import type { MergedGeometry } from '../../kernel/assets/GeometryMergeCore';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene, getRootScene } from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  dissolveMergeGroup,
  getMergeGroupOf,
  installMergeGroups,
  rebuildMergeGroup,
  updateMergeMember,
} from './MergeGroups';

// The warning log, and the worker merge: held until the test lets it finish (the real merge on
// the main thread then), so a test can change the group while it runs
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

const releaseWorkerBuildsAsync = async () => {
  for (const release of fns.release.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// The default world (the API's default) and the root scene; the hooks are static, registered once
// for this file: the kernel's, then the feature's
let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  // Persistent: a deleted mesh's last ref would release them
  createGeometry({
    id: 'mergeTestBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeTestMat', type: 'BASIC', params: {}, isPersistent: true });
  createMaterial({ id: 'mergeTestOtherMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  world.clearWorld();
  fns.lwarn.mockClear();
  fns.release.length = 0;
});

let seq = 0;
const nextGroupId = () => `group${seq++}`;

/** A box mesh entity at x, spatially indexed (createMeshEntity's default). */
const createBox = (x: number, mat = 'mergeTestMat') =>
  createMeshEntity({ geo: 'mergeTestBox', mat, position: { x, y: 1 } });

const getMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Mesh | undefined;

const getWorldBox = (geometry: THREE.BufferGeometry, object: THREE.Object3D) => {
  object.updateWorldMatrix(true, false);
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld);
};

describe('TAG_MERGED', () => {
  test('hides a merged entity whatever else changes, and shows it when it leaves', () => {
    const id = world.createEntity();
    const object = new THREE.Object3D();
    world.addComponent(id, ComponentType.OBJECT3D, { value: object, _lastVersion: -1 });

    world.addComponent(id, ComponentType.TAG_MERGED, true);
    expect(object.visible).toBe(false);

    // Another reason coming and going doesn't show it
    world.setDisabled(id, true);
    world.setDisabled(id, false);
    world.addComponent(id, ComponentType.TAG_FRUSTUM_CULLED, true);
    world.removeComponent(id, ComponentType.TAG_FRUSTUM_CULLED);
    expect(object.visible).toBe(false);

    world.removeComponent(id, ComponentType.TAG_MERGED);
    expect(object.visible).toBe(true);
  });

  test("leaving the group doesn't show an entity hidden for another reason", () => {
    const id = world.createEntity();
    const object = new THREE.Object3D();
    world.addComponent(id, ComponentType.OBJECT3D, { value: object, _lastVersion: -1 });

    world.addComponent(id, ComponentType.TAG_MERGED, true);
    world.setDisabled(id, true);
    world.removeComponent(id, ComponentType.TAG_MERGED);
    expect(object.visible).toBe(false);

    world.setDisabled(id, false);
    expect(object.visible).toBe(true);
  });
});

describe('a build', () => {
  test('draws the members as one mesh at their places, the members hidden and unindexed', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId, castShadow: true });
    const members = [createBox(0), createBox(4), createBox(10)];
    addToMergeGroup(groupId, members);

    // Not merged before the build: no mesh yet, the members drawn on their own
    expect(getMesh(groupEntityId)).toBeUndefined();
    expect(getMergeGroupOf(members[1])).toBe(groupId);
    expect(getMesh(members[0])!.visible).toBe(true);

    await buildPendingMergeGroupsAsync();

    const groupMesh = getMesh(groupEntityId)!;
    expect(groupMesh.parent).toBe(getRootScene());
    expect(groupMesh.castShadow).toBe(true);
    expect(groupMesh.material).toBe(getMesh(members[0])!.material);
    expect(groupMesh.geometry).toBe(getGeometry(`mergeGroup:${groupId}`));
    expect(getGeometryRegistry()[`mergeGroup:${groupId}`].count).toBe(1);
    expect(groupMesh.geometry.getAttribute('position').count).toBe(3 * 24);
    // At the centre of the members' bounds, its geometry covering them where they are
    expect(groupMesh.position.toArray()).toEqual([5, 1, 0]);
    const memberBounds = new THREE.Box3();
    for (const id of members) memberBounds.union(getWorldBox(getMesh(id)!.geometry, getMesh(id)!));
    const mergedBounds = getWorldBox(groupMesh.geometry, groupMesh);
    expect(mergedBounds.min.distanceTo(memberBounds.min)).toBeLessThan(1e-6);
    expect(mergedBounds.max.distanceTo(memberBounds.max)).toBeLessThan(1e-6);
    expect(world.getComponent(groupEntityId, ComponentType.TRANSFORM)!.position.x).toBe(5);

    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
    expect(group.members).toEqual(members);
    expect(group.rebuilds).toBe(1);
    members.forEach((id, i) => {
      expect(group.partIndex.get(id)).toBe(i);
      expect(world.getComponent(id, ComponentType.MERGE_MEMBER)!.partIndex).toBe(i);
      expect(getMesh(id)!.visible).toBe(false);
      expect(world.hasComponent(id, ComponentType.SPATIAL_INDEXED)).toBe(false);
    });
    expect(world.hasComponent(groupEntityId, ComponentType.SPATIAL_INDEXED)).toBe(true);
    expect(world.getComponent(groupEntityId, ComponentType.MANAGED_BY)?.manager).toBe('MERGE');
  });

  test('a member added later joins at the next build, the geometry replaced', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    addToMergeGroup(groupId, [createBox(0), createBox(2)]);
    await buildPendingMergeGroupsAsync();
    const first = getMesh(groupEntityId)!.geometry;

    const late = createBox(6);
    addToMergeGroup(groupId, [late]);
    expect(getMesh(late)!.visible).toBe(true);
    await buildPendingMergeGroupsAsync();

    const second = getMesh(groupEntityId)!.geometry;
    expect(second).not.toBe(first);
    expect(second.getAttribute('position').count).toBe(3 * 24);
    // The first one released (its only ref), the second under the group's id
    expect(getGeometry(`mergeGroup:${groupId}`)).toBe(second);
    expect(getMesh(late)!.visible).toBe(false);
  });

  test('rebuildMergeGroup builds again from where the members are now', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const member = createBox(0);
    addToMergeGroup(groupId, [member, createBox(2)]);
    await buildPendingMergeGroupsAsync();

    world.setTransform(member, { pos: { x: -2, y: 1, z: 0 } });
    getMesh(member)!.position.set(-2, 1, 0);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expect(getMesh(groupEntityId)!.position.x).toBe(0);
    expect(world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!.rebuilds).toBe(2);
  });
});

describe('updateMergeMember', () => {
  /** The merged geometry the members would give merged fresh at the group mesh's place: what an
   * in-place update must match. */
  const getFreshMerge = (groupMesh: THREE.Mesh, members: number[]) => {
    groupMesh.updateWorldMatrix(true, false);
    const inverse = groupMesh.matrixWorld.clone().invert();
    return mergeGeometryParts(
      members.map((id) => {
        const mesh = getMesh(id)!;
        mesh.updateWorldMatrix(true, false);
        return { geo: mesh.geometry, matrix: inverse.clone().multiply(mesh.matrixWorld) };
      })
    );
  };

  const expectSameGeometry = (a: THREE.BufferGeometry, b: THREE.BufferGeometry) => {
    expect(Object.keys(a.attributes).sort()).toEqual(Object.keys(b.attributes).sort());
    for (const name in a.attributes) {
      const left = a.getAttribute(name).array;
      const right = b.getAttribute(name).array;
      expect(left.length).toBe(right.length);
      for (let i = 0; i < left.length; i++) expect(left[i]).toBeCloseTo(right[i], 5);
    }
    expect(Array.from(a.index!.array)).toEqual(Array.from(b.index!.array));
  };

  /** A merged attribute: always a plain BufferAttribute. */
  const getAttr = (geometry: THREE.BufferGeometry, name: string) =>
    geometry.getAttribute(name) as THREE.BufferAttribute;

  /** Sets a Map-mode entity's scale (setTransform takes none). */
  const setScale = (id: number, x: number, y: number, z: number) => {
    const transform = world.getComponent(id, ComponentType.TRANSFORM)!;
    transform.scale.set(x, y, z);
    transform.setDirty();
    world.commitTransform(id, transform);
  };

  test("rewrites only the member's range, from its TRANSFORM, without a rebuild", async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const members = [createBox(0), createBox(2), createBox(4)];
    addToMergeGroup(groupId, members);
    await buildPendingMergeGroupsAsync();
    const groupMesh = getMesh(groupEntityId)!;
    const merged = groupMesh.geometry as MergedGeometry;
    const before = Float32Array.from(merged.getAttribute('position').array);
    const indexBefore = Array.from(merged.index!.array);
    for (const name in merged.attributes) getAttr(merged, name).clearUpdateRanges();

    // Moved and turned through its TRANSFORM only: the mesh isn't synced yet
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    world.setTransform(members[1], { pos: { x: 2, y: 3, z: 1 }, rot: q });
    updateMergeMember(members[1]);

    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
    expect(group.rebuilds).toBe(1);
    expect(groupMesh.geometry).toBe(merged);
    expectSameGeometry(merged, getFreshMerge(groupMesh, members));
    // Only its range written and marked for upload
    const { vertexStart, vertexCount } = merged.userData.mergeParts[1];
    const after = merged.getAttribute('position').array;
    for (let i = 0; i < before.length; i++) {
      if (i < vertexStart * 3 || i >= (vertexStart + vertexCount) * 3) {
        expect(after[i]).toBe(before[i]);
      }
    }
    for (const name of ['position', 'normal']) {
      expect(getAttr(merged, name).updateRanges).toEqual([
        { start: vertexStart * 3, count: vertexCount * 3 },
      ]);
    }
    expect(getAttr(merged, 'uv').updateRanges).toEqual([]);
    expect(Array.from(merged.index!.array)).toEqual(indexBefore);
    expect(merged.index!.updateRanges).toEqual([]);
  });

  test('turns a tangent the merge computed, and flips the winding of a mirrored member', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const withTangents = new THREE.BoxGeometry(1, 1, 1);
    withTangents.computeTangents();
    const members = [
      createMeshEntity({ geo: withTangents, mat: 'mergeTestMat', position: { x: -2 } }),
      createBox(2),
    ];
    addToMergeGroup(groupId, members);
    await buildPendingMergeGroupsAsync();
    const groupMesh = getMesh(groupEntityId)!;
    const merged = groupMesh.geometry as MergedGeometry;
    const indexBefore = Array.from(merged.index!.array);

    // The box without tangents mirrored and turned: its computed tangents turn, w and the
    // winding flip
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);
    world.setTransform(members[1], { pos: { x: 3, y: 1, z: 0 }, rot: q });
    setScale(members[1], -1, 2, 1);
    updateMergeMember(members[1]);
    expectSameGeometry(merged, getFreshMerge(groupMesh, members));
    const range = merged.userData.mergeParts[1];
    expect(merged.index!.updateRanges).toEqual([
      { start: range.indexStart, count: range.indexCount },
    ]);

    // Mirrored back: the winding as it was
    setScale(members[1], 1, 1, 1);
    updateMergeMember(members[1]);
    expectSameGeometry(merged, getFreshMerge(groupMesh, members));
    expect(Array.from(merged.index!.array)).toEqual(indexBefore);
  });

  test('grows the bounds and measures the spatial radius again only when it moved out', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const members = [createBox(0), createBox(4)];
    addToMergeGroup(groupId, members);
    await buildPendingMergeGroupsAsync();
    const merged = getMesh(groupEntityId)!.geometry;
    const rejoins = vi.fn();
    const remove = world.removeComponent.bind(world);
    const spy = vi.spyOn(world, 'removeComponent').mockImplementation((id, type) => {
      if (id === groupEntityId && type === ComponentType.SPATIAL_INDEXED) rejoins();
      return remove(id, type);
    });

    // Inside the bounds: nothing grows
    world.setTransform(members[1], { pos: { x: 3.5, y: 1, z: 0 } });
    updateMergeMember(members[1]);
    expect(rejoins).not.toHaveBeenCalled();

    world.setTransform(members[1], { pos: { x: 12, y: 1, z: 0 } });
    updateMergeMember(members[1]);
    spy.mockRestore();
    expect(rejoins).toHaveBeenCalledTimes(1);
    expect(world.hasComponent(groupEntityId, ComponentType.SPATIAL_INDEXED)).toBe(true);
    // In group space (the mesh at x 2): the moved box's far side at 12.5
    expect(merged.boundingBox!.max.x).toBeCloseTo(10.5, 6);
    const far = new THREE.Vector3(10.5, 0.5, 0.5);
    expect(merged.boundingSphere!.containsPoint(far)).toBe(true);
  });

  test('reads the pose from a typed transform store', async () => {
    const typedWorld = new ECSWorld({ id: 'mergeTypedWorld', storageMode: 'TYPED_ARRAY' });
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId }, typedWorld);
    const members = [0, 2].map((x) =>
      createMeshEntity(
        { geo: 'mergeTestBox', mat: 'mergeTestMat', position: { x } },
        { world: typedWorld }
      )
    );
    addToMergeGroup(groupId, members, typedWorld);
    await buildPendingMergeGroupsAsync(typedWorld);

    typedWorld.setTransform(members[0], { pos: { x: -3, y: 0, z: 0 } });
    updateMergeMember(members[0], typedWorld);
    const groupMesh = typedWorld.getComponent(groupEntityId, ComponentType.OBJECT3D)!
      .value as THREE.Mesh;
    const merged = groupMesh.geometry as MergedGeometry;
    // The group at x 1: the moved box spans -4.5 … -3.5 in its space
    merged.computeBoundingBox();
    expect(merged.boundingBox!.min.x).toBeCloseTo(-4.5, 6);
    ECSWorld.deleteWorld(typedWorld.id);
  });

  test('drops a running worker build, which builds again from the new pose', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const sphere = createMeshEntity({
      geo: new THREE.SphereGeometry(1, 300, 300),
      mat: 'mergeTestMat',
      position: { x: 0 },
    });
    addToMergeGroup(groupId, [sphere]);
    const build = buildPendingMergeGroupsAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    world.setTransform(sphere, { pos: { x: 5, y: 0, z: 0 } });
    updateMergeMember(sphere);
    await releaseWorkerBuildsAsync();
    await build;
    expect(getMesh(groupEntityId)).toBeUndefined();

    const next = buildPendingMergeGroupsAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await releaseWorkerBuildsAsync();
    await next;
    expect(getMesh(groupEntityId)!.position.x).toBeCloseTo(5, 6);
  });

  test('warns for a non-member, and builds again for a member whose geometry changed', async () => {
    const box = createBox(0);
    updateMergeMember(box);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining("isn't in a merge group"));

    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    addToMergeGroup(groupId, [box, createBox(2)]);
    await buildPendingMergeGroupsAsync();
    getMesh(box)!.geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
    updateMergeMember(box);
    expect(fns.lwarn).toHaveBeenLastCalledWith(expect.stringContaining('builds again'));
    await buildPendingMergeGroupsAsync();
    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
    expect(group.rebuilds).toBe(2);
  });
});

describe('leaving', () => {
  test('dissolving draws the members on their own again and deletes the group', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const members = [createBox(0), createBox(2)];
    addToMergeGroup(groupId, members);
    await buildPendingMergeGroupsAsync();

    dissolveMergeGroup(groupId);
    expect(world.isAlive(groupEntityId)).toBe(false);
    expect(getGeometry(`mergeGroup:${groupId}`)).toBeUndefined();
    for (const id of members) {
      expect(getMesh(id)!.visible).toBe(true);
      expect(world.hasComponent(id, ComponentType.SPATIAL_INDEXED)).toBe(true);
      expect(getMergeGroupOf(id)).toBeUndefined();
    }
    // The id is free again
    expect(() => createMergeGroup({ id: groupId })).not.toThrow();
  });

  test('a deleted member is built out; the last one leaves the mesh out of the scene', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId, persistent: true });
    const members = [createBox(0), createBox(2)];
    addToMergeGroup(groupId, members);
    await buildPendingMergeGroupsAsync();

    world.deleteEntity(members[0]);
    await buildPendingMergeGroupsAsync();
    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
    expect(group.members).toEqual([members[1]]);
    expect(getMesh(groupEntityId)!.geometry.getAttribute('position').count).toBe(24);

    // A scene exit takes the members, not the persistent group
    world.clearNonPersistent();
    await buildPendingMergeGroupsAsync();
    expect(world.isAlive(groupEntityId)).toBe(true);
    expect(getMesh(groupEntityId)!.parent).toBeNull();
    expect(group.members).toEqual([]);
  });

  test('a scene exit takes a group with its members', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    addToMergeGroup(groupId, [createBox(0), createBox(2)]);
    await buildPendingMergeGroupsAsync();
    const mesh = getMesh(groupEntityId)!;

    world.clearNonPersistent();
    expect(mesh.parent).toBeNull();
    expect(getGeometry(`mergeGroup:${groupId}`)).toBeUndefined();
    await expect(buildPendingMergeGroupsAsync()).resolves.toBeUndefined();
  });
});

describe('refusals', () => {
  test('warn and leave the entity on its own', async () => {
    const groupId = nextGroupId();
    createMergeGroup({ id: groupId });
    const member = createBox(0);
    const otherMaterial = createBox(2, 'mergeTestOtherMat');
    const transparent = createMeshEntity({
      geo: 'mergeTestBox',
      mat: new THREE.MeshBasicNodeMaterial({ transparent: true }),
    });
    const persistent = createBox(4);
    world.addComponent(persistent, ComponentType.PERSISTENT, true);
    const headless = world.createEntity();

    addToMergeGroup(groupId, [member, otherMaterial, transparent, persistent, headless, member]);
    const warnings = fns.lwarn.mock.calls.map((call) => String(call[0]));
    expect(warnings).toEqual([
      expect.stringContaining("material isn't the group's"),
      expect.stringContaining('transparent'),
      expect.stringContaining("persistent and the group isn't"),
      expect.stringContaining("isn't a mesh entity"),
      expect.stringContaining(`in the merge group "${groupId}" already`),
    ]);

    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(otherMaterial)).toBeUndefined();
    expect(getMesh(otherMaterial)!.visible).toBe(true);
    expect(getMesh(member)!.visible).toBe(false);
  });

  test('a group id is unique per world, and a group is made on first use', () => {
    const groupId = nextGroupId();
    createMergeGroup({ id: groupId });
    expect(() => createMergeGroup({ id: groupId })).toThrow(/already/);

    const other = nextGroupId();
    const box = createBox(0);
    addToMergeGroup(other, [box]);
    expect(getMergeGroupOf(box)).toBe(other);
  });
});

describe('worker builds', () => {
  /** A sphere mesh entity of 90,601 vertices: over the worker threshold alone. */
  const createBigSphere = (x: number) =>
    createMeshEntity({
      geo: new THREE.SphereGeometry(1, 300, 300),
      mat: 'mergeTestMat',
      position: { x },
    });

  test('keep the members drawn on their own until the merge is in', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const member = createBigSphere(0);
    addToMergeGroup(groupId, [member]);

    const build = buildPendingMergeGroupsAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fns.release).toHaveLength(1);
    expect(getMesh(groupEntityId)).toBeUndefined();
    expect(getMesh(member)!.visible).toBe(true);

    await releaseWorkerBuildsAsync();
    await build;
    expect(getMesh(groupEntityId)!.geometry.getAttribute('position').count).toBe(90_601);
    expect(getMesh(member)!.visible).toBe(false);
  });

  test("drop a merge whose member left while it ran, and the next build doesn't", async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const members = [createBigSphere(0), createBox(3)];
    addToMergeGroup(groupId, members);

    const build = buildPendingMergeGroupsAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    world.deleteEntity(members[1]);
    await releaseWorkerBuildsAsync();
    await build;
    expect(getMesh(groupEntityId)).toBeUndefined();
    expect(getMesh(members[0])!.visible).toBe(true);

    const next = buildPendingMergeGroupsAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await releaseWorkerBuildsAsync();
    await next;
    expect(getMesh(groupEntityId)!.geometry.getAttribute('position').count).toBe(90_601);
  });
});

describe('the build system', () => {
  test('loads the merge code on its first pending group, then builds once a frame', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    addToMergeGroup(groupId, [createBox(0), createBox(2)]);

    // The merge code may be in already (an earlier test): two frames build either way
    world.updateAppLoop(0.016);
    await new Promise((resolve) => setTimeout(resolve, 0));
    world.updateAppLoop(0.016);
    expect(getMesh(groupEntityId)!.parent).toBe(getRootScene());
    expect(world.getSystemOrder('APP_RENDER_SYNC' as never)).toContainEqual(
      expect.objectContaining({ id: 'mergeGroupBuildSystem', order: 0.5 })
    );
  });
});
