import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry } from '../../kernel/assets/Geometry';
import type { MergedGeometry } from '../../kernel/assets/GeometryMergeCore';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene } from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
  updateMergeMember,
} from './MergeGroups';

// A group of more than WORKER_BUILD_VERTICES built in the assets worker (i080): held while it
// runs, and changed meanwhile

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

/** Lets a started build reach the (held) worker merge. */
const tickAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

// The default world (the API's default) and the root scene; the hooks are static, registered once
// for this file: the kernel's, then the feature's
let world: ECSWorld;
beforeAll(async () => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  // Persistent: a deleted mesh's last ref would release them
  createGeometry({
    id: 'mergeWorkerBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeWorkerMat', type: 'BASIC', params: {}, isPersistent: true });
  // The merge code loaded by a main-thread build: a test's one tick then reaches the held merge
  addToMergeGroup('workerWarmUp', [createBox(0)]);
  await buildPendingMergeGroupsAsync();
  world.clearWorld();
});

afterEach(() => {
  world.clearWorld();
  fns.lwarn.mockClear();
  fns.release.length = 0;
});

let seq = 0;
const nextGroupId = () => `workerGroup${seq++}`;

/** A box mesh entity of 24 vertices at x. */
const createBox = (x: number) =>
  createMeshEntity({ geo: 'mergeWorkerBox', mat: 'mergeWorkerMat', position: { x, y: 1 } });

/** A sphere mesh entity of 90,601 vertices: over the worker threshold alone. */
const createBigSphere = (x: number) =>
  createMeshEntity({
    geo: new THREE.SphereGeometry(1, 300, 300),
    mat: 'mergeWorkerMat',
    position: { x },
  });

const getMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Mesh | undefined;
const getGroup = (groupEntityId: number) =>
  world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
const getVertexCount = (mesh: THREE.Mesh) => mesh.geometry.getAttribute('position').count;

/** A member's part of a group mesh's geometry, in world space. */
const getPartWorldBox = (
  groupMesh: THREE.Mesh,
  geometry: THREE.BufferGeometry,
  entityId: number
) => {
  const { partIndex } = world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;
  const { vertexStart, vertexCount } = (geometry as MergedGeometry).userData.mergeParts[partIndex];
  const position = geometry.getAttribute('position');
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (let i = vertexStart; i < vertexStart + vertexCount; i++) {
    box.expandByPoint(vertex.fromBufferAttribute(position, i));
  }
  groupMesh.updateWorldMatrix(true, false);
  return box.applyMatrix4(groupMesh.matrixWorld);
};

describe('worker builds', () => {
  test('keep the members drawn on their own until the merge is in', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const member = createBigSphere(0);
    addToMergeGroup(groupId, [member]);

    const build = buildPendingMergeGroupsAsync();
    await tickAsync();
    expect(fns.release).toHaveLength(1);
    expect(getMesh(groupEntityId)).toBeUndefined();
    expect(getMesh(member)!.visible).toBe(true);

    await releaseWorkerBuildsAsync();
    await build;
    expect(getVertexCount(getMesh(groupEntityId)!)).toBe(90_601);
    expect(getMesh(member)!.visible).toBe(false);
  });

  test("drop a merge whose member left while it ran, and the next build doesn't", async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const members = [createBigSphere(0), createBox(3)];
    addToMergeGroup(groupId, members);

    const build = buildPendingMergeGroupsAsync();
    await tickAsync();
    world.deleteEntity(members[1]);
    await releaseWorkerBuildsAsync();
    await build;
    expect(getMesh(groupEntityId)).toBeUndefined();
    expect(getMesh(members[0])!.visible).toBe(true);

    const next = buildPendingMergeGroupsAsync();
    await tickAsync();
    await releaseWorkerBuildsAsync();
    await next;
    expect(getVertexCount(getMesh(groupEntityId)!)).toBe(90_601);
  });

  test("a member updated every frame doesn't drop it: it lands with the member's latest pose", async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const sphere = createBigSphere(0);
    addToMergeGroup(groupId, [sphere]);
    const build = buildPendingMergeGroupsAsync();
    await tickAsync();

    // Updated every frame while the merge runs
    for (let frame = 1; frame <= 5; frame++) {
      world.setTransform(sphere, { pos: { x: frame, y: 0, z: 0 } });
      updateMergeMember(sphere);
      world.updateAppLoop(0.016);
    }
    expect(fns.release).toHaveLength(1);
    await releaseWorkerBuildsAsync();
    await build;

    // Built at the build's start (centred at 0), then written where the member is now
    const groupMesh = getMesh(groupEntityId)!;
    const group = getGroup(groupEntityId);
    expect(group.rebuilds).toBe(1);
    expect(group._isPending).toBe(false);
    expect(groupMesh.position.x).toBeCloseTo(0, 6);
    const box = getPartWorldBox(groupMesh, groupMesh.geometry, sphere);
    expect(box.min.x).toBeCloseTo(4, 5);
    expect(box.max.x).toBeCloseTo(6, 5);
    expect(world.getComponent(sphere, ComponentType.MERGE_MEMBER)!._isMovedInBuild).toBe(false);
    expect(getMesh(sphere)!.visible).toBe(false);
  });

  test('a rebuild of a member updated every frame: the mesh drawn is written now, the new one lands with the latest pose', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const box = createBox(3);
    addToMergeGroup(groupId, [createBigSphere(0), box]);
    const first = buildPendingMergeGroupsAsync();
    await tickAsync();
    await releaseWorkerBuildsAsync();
    await first;
    const groupMesh = getMesh(groupEntityId)!;
    const drawn = groupMesh.geometry;

    rebuildMergeGroup(groupId);
    const rebuild = buildPendingMergeGroupsAsync();
    await tickAsync();
    for (let frame = 1; frame <= 5; frame++) {
      world.setTransform(box, { pos: { x: 3 + frame, y: 1, z: 0 } });
      updateMergeMember(box);
      world.updateAppLoop(0.016);
    }
    expect(fns.release).toHaveLength(1);
    // The mesh drawn meanwhile follows the moves
    expect(getPartWorldBox(groupMesh, drawn, box).max.x).toBeCloseTo(8.5, 5);

    await releaseWorkerBuildsAsync();
    await rebuild;
    expect(groupMesh.geometry).not.toBe(drawn);
    expect(getGroup(groupEntityId).rebuilds).toBe(2);
    const landed = getPartWorldBox(groupMesh, groupMesh.geometry, box);
    expect(landed.min.x).toBeCloseTo(7.5, 5);
    expect(landed.max.x).toBeCloseTo(8.5, 5);
  });

  test('a member whose geometry was replaced while it ran: it lands, and the group builds again', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const box = createBox(3);
    addToMergeGroup(groupId, [createBigSphere(0), box]);
    const build = buildPendingMergeGroupsAsync();
    await tickAsync();

    const replaced = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
    getMesh(box)!.geometry = replaced;
    updateMergeMember(box);
    await releaseWorkerBuildsAsync();
    await build;
    expect(getVertexCount(getMesh(groupEntityId)!)).toBe(90_601 + 24);
    expect(fns.lwarn).toHaveBeenLastCalledWith(expect.stringContaining('builds again'));
    expect(getGroup(groupEntityId)._isPending).toBe(true);

    const next = buildPendingMergeGroupsAsync();
    await tickAsync();
    await releaseWorkerBuildsAsync();
    await next;
    expect(getVertexCount(getMesh(groupEntityId)!)).toBe(
      90_601 + replaced.getAttribute('position').count
    );
  });

  test("a member joining every frame doesn't drop it: the newcomers are built after it lands", async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    addToMergeGroup(groupId, [createBigSphere(0)]);
    const build = buildPendingMergeGroupsAsync();
    await tickAsync();

    const boxes: number[] = [];
    for (let frame = 1; frame <= 5; frame++) {
      boxes.push(createBox(frame * 3));
      addToMergeGroup(groupId, [boxes[frame - 1]]);
      world.updateAppLoop(0.016);
    }
    expect(fns.release).toHaveLength(1);

    // A build asked for meanwhile (the scene step's) waits for the running one
    let hasWaited = false;
    const waiting = buildPendingMergeGroupsAsync().then(() => (hasWaited = true));
    await tickAsync();
    expect(hasWaited).toBe(false);
    await releaseWorkerBuildsAsync();
    await build;
    await waiting;
    expect(getVertexCount(getMesh(groupEntityId)!)).toBe(90_601);
    expect(boxes.every((id) => getMesh(id)!.visible)).toBe(true);
    expect(getGroup(groupEntityId)._isPending).toBe(true);

    const next = buildPendingMergeGroupsAsync();
    await tickAsync();
    await releaseWorkerBuildsAsync();
    await next;
    expect(getVertexCount(getMesh(groupEntityId)!)).toBe(90_601 + 5 * 24);
    expect(boxes.some((id) => getMesh(id)!.visible)).toBe(false);
  });
});
