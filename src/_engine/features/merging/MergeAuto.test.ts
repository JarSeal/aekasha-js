import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry } from '../../kernel/assets/Geometry';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes, type MeshProps } from '../../kernel/mesh/Mesh';
import { createRootScene, type SceneData, setLoadingSceneId } from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  getMergeGroupOf,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
} from './MergeGroups';
import { keepSceneMergeSettings } from './MergeSceneSettings';
import type { MeshMergeDef } from './MergeTypes';

const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

// The default world and the root scene; the hooks are static, registered once for this file
let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  // Persistent: a deleted mesh's last ref would release them. A box has 24 vertices.
  createGeometry({
    id: 'autoTestBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  for (const id of ['autoTestMatA', 'autoTestMatB', 'autoTestMatC']) {
    createMaterial({ id, type: 'BASIC', params: {}, isPersistent: true });
  }
});

afterEach(() => {
  setLoadingSceneId(null);
  world.clearWorld();
  fns.lwarn.mockClear();
});

/** A box mesh entity at (x, 1, z) with a `merge`. */
const createBox = (
  x: number,
  z: number,
  merge: MeshMergeDef = 'AUTO',
  props: Partial<MeshProps> = {}
) =>
  createMeshEntity({
    geo: 'autoTestBox',
    mat: 'autoTestMatA',
    position: { x, y: 1, z },
    merge,
    ...props,
  });

const getMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

/** The world's merge groups' ids. */
const getGroupIds = () =>
  [...world.getStorage(ComponentType.MERGE_GROUP).entries()].map(([, group]) => group.id);

describe("a mesh's merge", () => {
  test('joins its group at the next build, not before', async () => {
    const id = createBox(0, 0, 'ruins');
    expect(getMergeGroupOf(id)).toBeUndefined();
    expect(getGroupIds()).toEqual([]);

    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(id)).toBe('ruins');
    expect(world.hasComponent(id, ComponentType.TAG_MERGED)).toBe(true);
    expect(getMesh(id).visible).toBe(false);
  });

  test("the object form's group, and an invalid merge warns and is drawn on its own", async () => {
    const id = createBox(0, 0, { group: 'ruins' });
    const invalid = [
      createBox(2, 0, ''),
      createBox(4, 0, 'auto:x'),
      createBox(6, 0, { cellSize: 0 }),
      createBox(8, 0, { maxVertices: Number.NaN }),
    ];
    expect(fns.lwarn).toHaveBeenCalledTimes(4);
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(id)).toBe('ruins');
    for (const other of invalid) expect(getMergeGroupOf(other)).toBeUndefined();
  });

  test('a mesh deleted before the build is dropped', async () => {
    const id = createBox(0, 0);
    const kept = createBox(1, 0);
    world.deleteEntity(id);
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(kept)).toMatch(/^auto:/);
    expect(fns.lwarn).not.toHaveBeenCalled();
  });

  test('waits for a physics body being created, then the refusals see it', async () => {
    // What createPhysicsEntity adds: its tag at once, the colliders and the body when it exists
    const fixed = createBox(0, 0);
    const dynamic = createBox(1, 0);
    for (const id of [fixed, dynamic]) {
      world.addComponent(id, ComponentType.TAG_IS_PHYSICS_OBJECT, true);
    }
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(fixed)).toBeUndefined();
    expect(getMergeGroupOf(dynamic)).toBeUndefined();

    // A stand-in body: physics isn't installed, so no hook reads it
    const body = {} as never;
    world.addComponent(fixed, ComponentType.COLLIDER, []);
    world.addComponent(fixed, ComponentType.BODY_STATIC, body);
    world.addComponent(dynamic, ComponentType.COLLIDER, []);
    world.addComponent(dynamic, ComponentType.BODY_DYNAMIC_VISUAL, body);
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(fixed)).toMatch(/^auto:/);
    expect(getMergeGroupOf(dynamic)).toBeUndefined();
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringMatching(/dynamic or kinematic body/));
  });

  test('addToMergeGroup wins over a queued merge, removeFromMergeGroup drops one', async () => {
    const moved = createBox(0, 0, 'ruins');
    const dropped = createBox(1, 0, 'ruins');
    addToMergeGroup('walls', [moved]);
    removeFromMergeGroup([dropped]);
    expect(fns.lwarn).not.toHaveBeenCalled();

    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(moved)).toBe('walls');
    expect(getMergeGroupOf(dropped)).toBeUndefined();
    expect(getGroupIds()).toEqual(['walls']);
  });

  test("addToMergeGroup('AUTO') queues like the prop, and the AUTO ids are reserved", async () => {
    const id = createMeshEntity({ geo: 'autoTestBox', mat: 'autoTestMatA' });
    addToMergeGroup('AUTO', [id]);
    expect(getMergeGroupOf(id)).toBeUndefined();
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(id)).toMatch(/^auto:/);

    expect(() => createMergeGroup({ id: 'AUTO' })).toThrow(/reserved/);
    expect(() => createMergeGroup({ id: 'auto:mine' })).toThrow(/reserved/);
    expect(() => addToMergeGroup('auto:mine', [id])).toThrow(/reserved/);
  });
});

describe('AUTO', () => {
  test('groups by material and cell: 3 materials over 4 cells are 12 groups', async () => {
    const mats = ['autoTestMatA', 'autoTestMatB', 'autoTestMatC'];
    // The default cells are 32 m: (0, 0), (1, 0), (0, 1) and (1, 1), a few boxes in each
    const corners = [
      [0, 0],
      [40, 0],
      [0, 40],
      [40, 40],
    ];
    const ids: number[] = [];
    for (const mat of mats) {
      for (const [x, z] of corners) {
        for (let i = 0; i < 5; i++) ids.push(createBox(x + i * 2, z + i, 'AUTO', { mat }));
      }
    }
    await buildPendingMergeGroupsAsync();

    const groups = new Map<string, number[]>();
    for (const id of ids) {
      const groupId = getMergeGroupOf(id)!;
      groups.set(groupId, [...(groups.get(groupId) ?? []), id]);
    }
    expect(groups.size).toBe(12);
    for (const [groupId, members] of groups) {
      expect(members).toHaveLength(5);
      expect(new Set(members.map((id) => getMesh(id).material)).size).toBe(1);
      expect(groupId).toMatch(/^auto:[0-9a-z]+:[01],[01]:0$/);
    }
    for (const id of ids) expect(getMesh(id).visible).toBe(false);
  });

  test('the shadow flags and the attributes are part of the key', async () => {
    const plain = createBox(0, 0);
    const casting = createBox(1, 0, 'AUTO', { castShadow: true });
    const receiving = createBox(2, 0, 'AUTO', { receiveShadow: true });
    const noUvGeometry = createGeometry({
      id: 'autoTestNoUv',
      type: 'BOX',
      params: { width: 1, height: 1, depth: 1 },
    });
    noUvGeometry.deleteAttribute('uv');
    const noUv = createBox(3, 0, 'AUTO', { geo: noUvGeometry });
    await buildPendingMergeGroupsAsync();

    const groupIds = [plain, casting, receiving, noUv].map((id) => getMergeGroupOf(id));
    expect(new Set(groupIds).size).toBe(4);
  });

  test('the same meshes give the same group ids on every load', async () => {
    // A full bucket in the first load too: its next load starts again at :0
    const createAll = () => [
      createBox(0, 0),
      createBox(40, 0, 'AUTO', { mat: 'autoTestMatB' }),
      ...[0, 1, 2].map((i) => createBox(80 + i, 0, { maxVertices: 24 })),
    ];
    const first = createAll();
    await buildPendingMergeGroupsAsync();
    const firstIds = first.map((id) => getMergeGroupOf(id));
    world.clearWorld();

    const second = createAll();
    await buildPendingMergeGroupsAsync();
    expect(second.map((id) => getMergeGroupOf(id))).toEqual(firstIds);
  });

  test('a full bucket opens the next group in its cell', async () => {
    // Two boxes fit under 48 vertices; a box over the cap still gets a group (one each)
    const ids = [0, 1, 2, 3, 4].map((i) => createBox(i, 0, { maxVertices: 48 }));
    const big = [100, 101].map((x) => createBox(x, 0, { maxVertices: 10 }));
    await buildPendingMergeGroupsAsync();

    const last = (id: number) => getMergeGroupOf(id)!.split(':').pop();
    expect(ids.map(last)).toEqual(['0', '0', '1', '1', '2']);
    expect(big.map(last)).toEqual(['0', '1']);
  });

  test("a mesh's cell size, and its cell from its pose at the build", async () => {
    const wide = [createBox(0, 0, { cellSize: 64 }), createBox(40, 0, { cellSize: 64 })];
    const narrow = [createBox(0, 0), createBox(40, 0)];
    const moved = createBox(0, 0);
    world.setTransform(moved, { pos: { x: 40, y: 1, z: 0 } });
    await buildPendingMergeGroupsAsync();

    expect(getMergeGroupOf(wide[0])).toBe(getMergeGroupOf(wide[1]));
    expect(getMergeGroupOf(narrow[0])).not.toBe(getMergeGroupOf(narrow[1]));
    expect(getMergeGroupOf(moved)).toBe(getMergeGroupOf(narrow[1]));
  });

  test('a refused mesh warns and opens no group', async () => {
    const id = createBox(0, 0, 'AUTO', {
      mat: new THREE.MeshBasicNodeMaterial({ transparent: true }),
    });
    await buildPendingMergeGroupsAsync();
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringMatching(/^merge 'AUTO'.*transparent/));
    expect(getMergeGroupOf(id)).toBeUndefined();
    expect(getGroupIds()).toEqual([]);
  });

  test('a persistent mesh goes into a persistent group of its own', async () => {
    // createEntity doesn't read `persistent` (p619 S8): the component, before the build
    const persistent = createBox(0, 0);
    world.addComponent(persistent, ComponentType.PERSISTENT, true);
    const plain = createBox(0, 0);
    await buildPendingMergeGroupsAsync();

    const groupId = getMergeGroupOf(persistent)!;
    expect(groupId).not.toBe(getMergeGroupOf(plain));
    const [groupEntityId] = [...world.getStorage(ComponentType.MERGE_GROUP).entries()].find(
      ([, group]) => group.id === groupId
    )!;
    expect(world.hasComponent(groupEntityId, ComponentType.PERSISTENT)).toBe(true);

    // A scene switch keeps both, and the persistent member stays merged
    world.clearNonPersistent();
    expect(getGroupIds()).toEqual([groupId]);
    expect(getMergeGroupOf(persistent)).toBe(groupId);
  });

  test('a group whose members all left is deleted, and its id starts empty again', async () => {
    const ids = [createBox(0, 0), createBox(1, 0)];
    await buildPendingMergeGroupsAsync();
    const groupId = getMergeGroupOf(ids[0])!;

    removeFromMergeGroup(ids);
    await buildPendingMergeGroupsAsync();
    expect(getGroupIds()).toEqual([]);

    // Its bucket counted 48 vertices: with the group gone, a cap of 48 takes two more boxes
    const again = [createBox(2, 0, { maxVertices: 48 }), createBox(3, 0, { maxVertices: 48 })];
    await buildPendingMergeGroupsAsync();
    expect(again.map((id) => getMergeGroupOf(id))).toEqual([groupId, groupId]);
  });
});

describe("a scene's settings", () => {
  /** Registers a scene's data, and makes it the one loading. */
  const loadSceneSettings = (sceneId: string, data: Partial<SceneData>) => {
    keepSceneMergeSettings(sceneId, { id: sceneId, sceneFile: `${sceneId}.ts`, ...data });
    setLoadingSceneId(sceneId);
  };

  const getGroupMesh = (groupId: string) => {
    const [groupEntityId] = [...world.getStorage(ComponentType.MERGE_GROUP).entries()].find(
      ([, group]) => group.id === groupId
    )!;
    return getMesh(groupEntityId);
  };

  test("its AUTO entry sets the defaults, a mesh's own options win", async () => {
    loadSceneSettings('autoDefaults', {
      mergeGroups: [{ id: 'AUTO', cellSize: 64, maxVertices: 24 }],
    });
    const wide = [createBox(0, 0), createBox(40, 0)];
    const own = [0, 1].map((x) => createBox(x, 10, { cellSize: 128, maxVertices: 48 }));
    await buildPendingMergeGroupsAsync();

    // One cell of 64 m, but a cap of one box
    const [a, b] = wide.map((id) => getMergeGroupOf(id)!);
    expect(a.split(':').slice(0, 3)).toEqual(b.split(':').slice(0, 3));
    expect(a).not.toBe(b);
    expect(getMergeGroupOf(own[0])).toBe(getMergeGroupOf(own[1]));
  });

  test("a group's entry gives its settings when it's made on first use", async () => {
    loadSceneSettings('groupEntry', { mergeGroups: [{ id: 'ruins', castShadow: true }] });
    createBox(0, 0, 'ruins');
    createBox(0, 0, 'walls');
    await buildPendingMergeGroupsAsync();
    expect(getGroupMesh('ruins').castShadow).toBe(true);
    expect(getGroupMesh('walls').castShadow).toBe(false);

    // Another scene's entry doesn't apply
    world.clearWorld();
    setLoadingSceneId('elsewhere');
    createBox(0, 0, 'ruins');
    await buildPendingMergeGroupsAsync();
    expect(getGroupMesh('ruins').castShadow).toBe(false);
  });

  test("warns once for an AUTO cell size that doesn't divide the streaming cell size", async () => {
    loadSceneSettings('streamedAuto', {
      streaming: { cellSize: 64 },
      mergeGroups: [{ id: 'AUTO', cellSize: 48 }],
    });
    createBox(0, 0);
    createBox(1, 0);
    createBox(2, 0, { cellSize: 32 });
    await buildPendingMergeGroupsAsync();
    const warnings = fns.lwarn.mock.calls.map((call) => String(call[0]));
    expect(warnings).toEqual([expect.stringMatching(/cell size 48 doesn't divide .* 64/)]);
  });

  test('warns once for a group whose members are in two streaming cells', async () => {
    loadSceneSettings('streamedGroup', { streaming: { cellSize: 64 } });
    const ids = [createBox(0, 0, 'ruins'), createBox(10, 0, 'ruins'), createBox(70, 0, 'ruins')];
    createBox(0, 5, 'walls');
    createBox(10, 5, 'walls');
    await buildPendingMergeGroupsAsync();
    rebuildMergeGroup('ruins');
    await buildPendingMergeGroupsAsync();
    const warnings = fns.lwarn.mock.calls.map((call) => String(call[0]));
    expect(warnings).toEqual([expect.stringMatching(/"ruins" .* cells 0,0 and 1,0/)]);
    expect(getMergeGroupOf(ids[2])).toBe('ruins');
  });
});
