import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry, saveBufferGeometry } from '../../kernel/assets/Geometry';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes, type MeshProps } from '../../kernel/mesh/Mesh';
import {
  createRootScene,
  getRootScene,
  type SceneData,
  setLoadingSceneId,
} from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  getMergeGroupOf,
  installMergeGroups,
} from './MergeGroups';
import { getAutoCompatibilityKey } from './MergeAuto';
import { keepSceneMergeSettings } from './MergeSceneSettings';
import { getGroups } from './MergeState';
import type { MeshMergeDef } from './MergeTypes';

// p375's batched groups (docs/plans/p375_batched-mesh-batches.md): the mode, its refusals and
// AUTO's batched buckets (Phase 1 S1).

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
    id: 'batchTestBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createGeometry({
    id: 'batchTestSphere',
    type: 'SPHERE',
    params: { radius: 0.5, widthSegments: 8, heightSegments: 6 },
    isPersistent: true,
  });
  // The box's attributes without an index; with a fourth attribute; with a normalized uv
  const box = new THREE.BoxGeometry();
  saveBufferGeometry(box.toNonIndexed(), { id: 'batchTestUnindexed', isPersistent: true });
  const extra = box.clone();
  extra.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3));
  saveBufferGeometry(extra, { id: 'batchTestExtra', isPersistent: true });
  const normalized = box.clone();
  normalized.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(24 * 2), 2, true));
  saveBufferGeometry(normalized, { id: 'batchTestNormalizedUv', isPersistent: true });
  createMaterial({ id: 'batchTestMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  setLoadingSceneId(null);
  world.clearWorld();
  fns.lwarn.mockClear();
});

let seq = 0;
const nextGroupId = () => `batch${seq++}`;

/** A mesh entity at (x, 1, z): the box unless `props` say otherwise. */
const createMember = (x: number, z = 0, props: Partial<MeshProps> = {}) =>
  createMeshEntity({
    geo: 'batchTestBox',
    mat: 'batchTestMat',
    position: { x, y: 1, z },
    ...props,
  });

/** The group's MERGE_GROUP, by id. */
const getGroup = (groupId: string) => {
  const groupEntityId = getGroups(world).get(groupId);
  return groupEntityId === undefined
    ? undefined
    : world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);
};

/** FNV-1a, 32 bits, base 36: MergeAuto.ts' id hash, written again here. */
const fnv1a = (key: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const warnings = () => fns.lwarn.mock.calls.map((call) => String(call[0]));

/** A stand-in body of a kind: physics isn't installed, so no hook reads it. */
const addBody = (entityId: number, kind: 'BODY_DYNAMIC_VISUAL' | 'PHYSICS_SIM_TIER') => {
  world.addComponent(entityId, ComponentType.TAG_IS_PHYSICS_OBJECT, true);
  world.addComponent(entityId, ComponentType.COLLIDER, []);
  world.addComponent(entityId, ComponentType[kind], {} as never);
};

describe('the mode', () => {
  test('is a setting: BAKED by default, BATCHED kept with its culling setting', () => {
    const baked = nextGroupId();
    const batched = nextGroupId();
    createMergeGroup({ id: baked });
    createMergeGroup({ id: batched, mode: 'BATCHED', perMemberCulling: false });
    expect(getGroup(baked)!.settings.mode).toBeUndefined();
    expect(getGroup(batched)!.settings).toMatchObject({ mode: 'BATCHED', perMemberCulling: false });
  });

  test('createMergeGroup throws for an unknown mode and for a BATCHED palette group', () => {
    expect(() => createMergeGroup({ id: nextGroupId(), mode: 'MERGED' as never })).toThrow(
      /isn't BAKED or BATCHED/
    );
    expect(() =>
      createMergeGroup({ id: nextGroupId(), mode: 'BATCHED', palette: 'anyPalette' })
    ).toThrow(/can't be BATCHED/);
  });

  test("a mesh's merge makes its group on first use with its mode; the other mode is refused", async () => {
    const groupId = nextGroupId();
    const first = createMember(0, 0, { merge: { group: groupId, mode: 'BATCHED' } });
    const plain = createMember(2, 0, { merge: groupId });
    const other = createMember(4, 0, { merge: { group: groupId, mode: 'BAKED' } });
    await buildPendingMergeGroupsAsync();

    expect(getGroup(groupId)!.settings.mode).toBe('BATCHED');
    expect(getMergeGroupOf(first)).toBe(groupId);
    expect(getMergeGroupOf(plain)).toBe(groupId);
    expect(getMergeGroupOf(other)).toBeUndefined();
    expect(warnings()).toEqual([
      expect.stringContaining(`asks for a BAKED group and "${groupId}" is BATCHED`),
    ]);
  });

  test("the scene entry's mode wins over a mesh's", async () => {
    keepSceneMergeSettings('batchEntry', {
      id: 'batchEntry',
      sceneFile: 'batchEntry.ts',
      mergeGroups: [{ id: 'props', mode: 'BAKED' }],
    } as SceneData);
    setLoadingSceneId('batchEntry');
    const asked = createMember(0, 0, { merge: { group: 'props', mode: 'BATCHED' } });
    await buildPendingMergeGroupsAsync();
    expect(getGroup('props')!.settings.mode).toBe('BAKED');
    expect(getMergeGroupOf(asked)).toBeUndefined();
  });

  test('an invalid mode in a merge warns and is dropped', async () => {
    const id = createMember(0, 0, { merge: { group: 'x', mode: 'MERGED' } as never });
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(id)).toBeUndefined();
    expect(warnings()[0]).toMatch(/invalid/);
  });
});

describe("a BATCHED group's refusals", () => {
  test('takes kinematic and dynamic bodies and tiered ones, which a BAKED group refuses', () => {
    const batched = nextGroupId();
    const baked = nextGroupId();
    createMergeGroup({ id: batched, mode: 'BATCHED' });
    createMergeGroup({ id: baked });
    const moving = [createMember(0), createMember(2)];
    addBody(moving[0], 'BODY_DYNAMIC_VISUAL');
    addBody(moving[1], 'PHYSICS_SIM_TIER');
    const movingBaked = [createMember(4), createMember(6)];
    addBody(movingBaked[0], 'BODY_DYNAMIC_VISUAL');
    addBody(movingBaked[1], 'PHYSICS_SIM_TIER');

    addToMergeGroup(batched, moving);
    addToMergeGroup(baked, movingBaked);
    expect(moving.map((id) => getMergeGroupOf(id))).toEqual([batched, batched]);
    expect(movingBaked.map((id) => getMergeGroupOf(id))).toEqual([undefined, undefined]);
    expect(warnings()).toEqual([
      expect.stringContaining('dynamic or kinematic body'),
      expect.stringContaining('dynamic or kinematic body'),
    ]);
  });

  test("refuses a mesh that isn't directly under the root scene", () => {
    const groupId = nextGroupId();
    createMergeGroup({ id: groupId, mode: 'BATCHED' });
    const outside = createMeshEntity(
      { geo: 'batchTestBox', mat: 'batchTestMat' },
      { doNotAddToScene: true }
    );
    const parented = createMember(0);
    const parent = new THREE.Group();
    getRootScene()!.add(parent);
    parent.add(world.getComponent(parented, ComponentType.OBJECT3D)!.value);

    addToMergeGroup(groupId, [outside, parented]);
    expect(getMergeGroupOf(outside)).toBeUndefined();
    expect(getMergeGroupOf(parented)).toBeUndefined();
    expect(warnings()).toEqual([
      expect.stringContaining("isn't directly under the root scene"),
      expect.stringContaining("isn't directly under the root scene"),
    ]);
    parent.removeFromParent();
  });

  test("refuses a geometry whose index or attributes aren't the group's exactly", () => {
    const groupId = nextGroupId();
    createMergeGroup({ id: groupId, mode: 'BATCHED' });
    const sphere = createMember(0, 0, { geo: 'batchTestSphere' });
    const geos = ['batchTestUnindexed', 'batchTestExtra', 'batchTestNormalizedUv'];
    const refused = geos.map((geo, i) => createMember(2 + i * 2, 0, { geo }));

    addToMergeGroup(groupId, [sphere, ...refused]);
    // Another geometry with the same attributes is a batch's point
    expect(getMergeGroupOf(sphere)).toBe(groupId);
    expect(refused.map((id) => getMergeGroupOf(id))).toEqual([undefined, undefined, undefined]);
    expect(warnings()).toEqual([
      expect.stringContaining('an index where the group has none, or none where it has one'),
      expect.stringContaining('a "color" attribute the group hasn\'t'),
      expect.stringContaining('a "uv" attribute of another item size or normalization'),
    ]);
  });

  test('refuses a missing attribute the other way round too', () => {
    const groupId = nextGroupId();
    createMergeGroup({ id: groupId, mode: 'BATCHED' });
    const extra = createMember(0, 0, { geo: 'batchTestExtra' });
    const box = createMember(2);
    addToMergeGroup(groupId, [extra, box]);
    expect(getMergeGroupOf(box)).toBeUndefined();
    expect(warnings()[0]).toContain('no "color" attribute, which the group has');
  });
});

describe("AUTO's BATCHED groups", () => {
  const auto = (extra: Partial<Exclude<MeshMergeDef, string>> = {}): MeshMergeDef => ({
    group: 'AUTO',
    mode: 'BATCHED',
    ...extra,
  });

  test('keep the modes apart in a cell, a BAKED id unchanged by the mode', async () => {
    const baked = createMember(0, 0, { merge: 'AUTO' });
    const batched = createMember(1, 0, { merge: auto() });
    const moving = createMember(2, 0, { merge: auto() });
    addBody(moving, 'BODY_DYNAMIC_VISUAL');
    await buildPendingMergeGroupsAsync();

    const batchedId = getMergeGroupOf(batched)!;
    expect(getMergeGroupOf(baked)).not.toBe(batchedId);
    expect(getMergeGroupOf(moving)).toBe(batchedId);
    expect(getGroup(batchedId)!.settings.mode).toBe('BATCHED');
    // The id a BAKED box in this cell had before p375: its key has no mode
    const bakedMesh = world.getComponent(baked, ComponentType.OBJECT3D)!.value as THREE.Mesh;
    const bakedKey = `${getAutoCompatibilityKey(bakedMesh, false)}|32`;
    expect(getMergeGroupOf(baked)).toBe(`auto:${fnv1a(bakedKey)}:0,0:0`);
    expect(getGroup(getMergeGroupOf(baked)!)!.settings.mode).toBeUndefined();
  });

  test('count each geometry once against the cap', async () => {
    // 24 vertices a box: five boxes are one batch under 48, where BAKED opens three groups
    const batched = [0, 1, 2, 3, 4].map((x) =>
      createMember(x, 0, { merge: auto({ maxVertices: 48 }) })
    );
    const baked = [0, 1, 2, 3, 4].map((x) => createMember(x, 0, { merge: { maxVertices: 48 } }));
    // A sphere (63 vertices) passes 48 with the box in: the next group
    const sphere = createMember(5, 0, { geo: 'batchTestSphere', merge: auto({ maxVertices: 48 }) });
    await buildPendingMergeGroupsAsync();

    const last = (id: number) => getMergeGroupOf(id)!.split(':').pop();
    expect(batched.map(last)).toEqual(['0', '0', '0', '0', '0']);
    expect(baked.map(last)).toEqual(['0', '0', '1', '1', '2']);
    expect(last(sphere)).toBe('1');
  });

  test('refuse a parented mesh before a bucket is picked', async () => {
    const id = createMeshEntity(
      { geo: 'batchTestBox', mat: 'batchTestMat', merge: auto() },
      { doNotAddToScene: true }
    );
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(id)).toBeUndefined();
    expect(getGroups(world).size).toBe(0);
    expect(warnings()[0]).toMatch(/^merge 'AUTO': .*directly under the root scene/);
  });
});
