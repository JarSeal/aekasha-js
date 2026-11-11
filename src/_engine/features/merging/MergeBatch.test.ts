import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import type { ECSStorageMode } from '../../kernel/ecs/ECSComponentStorage';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
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
  dissolveMergeGroup,
  getMergeGroupOf,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
  updateMergeMember,
} from './MergeGroups';
import { COMPACT_RUNS_FACTOR, getBatchState } from './MergeBatch';
import { getMergeBatchModule, loadMergeBatchModuleAsync } from './MergeBatchFront';
import { beginMergeMemberEdit, isMergeMemberInEdit } from './MergeMemberEdit';
import { getAutoCompatibilityKey } from './MergeAuto';
import { keepSceneMergeSettings } from './MergeSceneSettings';
import { getGroups } from './MergeState';
import type { MeshMergeDef } from './MergeTypes';

// p375's batched groups (docs/plans/p375_batched-mesh-batches.md): the mode, its refusals and
// AUTO's batched buckets (Phase 1 S1); the batch build, leaving and visibility (S2); the sync
// and the growing bounds in both storage modes (S3); grouping and compaction (S4). The first test
// needs the loader not to have run yet (`getMergeBatchModule()` is the loader's: this file's static
// import of MergeBatch.ts for its figures doesn't set it): keep it first.

const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

// The default world and the root scene; the hooks are static, registered once for this file
let world: ECSWorld;
const spatialJoins: number[] = [];
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  // The spatial index's joins (spatial() isn't installed): a group re-joins when its sphere grew
  ctx.registerComponentHooks(ComponentType.SPATIAL_INDEXED, {
    onAddComponent: (entityId) => spatialJoins.push(entityId),
  });
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
const addBody = (
  entityId: number,
  kind: 'BODY_DYNAMIC_VISUAL' | 'PHYSICS_SIM_TIER',
  w: ECSWorld = world
) => {
  w.addComponent(entityId, ComponentType.TAG_IS_PHYSICS_OBJECT, true);
  w.addComponent(entityId, ComponentType.COLLIDER, []);
  w.addComponent(entityId, ComponentType[kind], {} as never);
};

/** The group's batch, once built. */
const getBatch = (groupId: string) => {
  const groupEntityId = getGroups(world).get(groupId);
  return (
    groupEntityId === undefined
      ? undefined
      : world.getComponent(groupEntityId, ComponentType.OBJECT3D)?.value
  ) as THREE.BatchedMesh | undefined;
};

const getMember = (entityId: number) => world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;

const getOwnMesh = (entityId: number) => getOwnMeshIn(world, entityId);

const getOwnMeshIn = (w: ECSWorld, entityId: number) =>
  w.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

/** A BATCHED group of members at x = 0, 2, 4, …, box and sphere alternating. */
const createBatchedGroup = (count: number, opts: { perMemberCulling?: boolean } = {}) => {
  const groupId = nextGroupId();
  createMergeGroup({ id: groupId, mode: 'BATCHED', ...opts });
  const members = Array.from({ length: count }, (_, i) =>
    createMember(i * 2, 0, { geo: i % 2 === 0 ? 'batchTestBox' : 'batchTestSphere' })
  );
  addToMergeGroup(groupId, members);
  return { groupId, members };
};

// First in the file: the batch code isn't loaded before the first batched build
describe('the batch code', () => {
  test("loads with the build system's first batched group, which the run after builds", async () => {
    const baked = nextGroupId();
    createMergeGroup({ id: baked });
    addToMergeGroup(baked, [createMember(-4)]);
    await buildPendingMergeGroupsAsync();
    expect(getMergeBatchModule()).toBeNull();

    const { groupId } = createBatchedGroup(2);
    world.updateAppLoop(0.016);
    expect(getBatch(groupId)).toBeUndefined();
    await loadMergeBatchModuleAsync();
    world.updateAppLoop(0.016);
    expect(getBatch(groupId)?.isBatchedMesh).toBe(true);
  });
});

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

describe('a batch build', () => {
  test('draws the members as instances grouped by geometry, at their places from the centre', async () => {
    const { groupId, members } = createBatchedGroup(4);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;

    expect(batch.parent).toBe(getRootScene());
    expect(batch.sortObjects).toBe(false);
    expect(batch.perObjectFrustumCulled).toBe(true);
    expect(batch.instanceCount).toBe(4);
    // Boxes (members 0, 2) first, then spheres: one run per geometry
    expect(members.map((id) => getMember(id).instanceId)).toEqual([0, 2, 1, 3]);
    expect([0, 1, 2, 3].map((id) => batch.getGeometryIdAt(id))).toEqual([0, 0, 1, 1]);
    // The bounds' centre: x from -0.5 (the first box) to 6.5 (the last sphere)
    expect(batch.position.toArray()).toEqual([3, 1, 0]);
    const matrix = new THREE.Matrix4();
    members.forEach((id, i) => {
      batch.getMatrixAt(getMember(id).instanceId, matrix);
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([
        i * 2 - 3,
        0,
        0,
      ]);
    });
    // Its geometry's sphere is the members' around the batch (the spatial index measures a mesh by
    // the sphere's centre distance plus radius): the field's 3.5 m half-length, not one geometry's
    const sphere = batch.geometry.boundingSphere!;
    expect(sphere.center.length() + sphere.radius).toBeGreaterThanOrEqual(3.5);
    expect(sphere.center.length() + sphere.radius).toBeLessThan(4.5);
    const groupEntityId = getGroups(world).get(groupId)!;
    expect(world.hasComponent(groupEntityId, ComponentType.SPATIAL_INDEXED)).toBe(true);
    for (const id of members) {
      expect(getOwnMesh(id).visible).toBe(false);
      expect(getMember(id).partIndex).toBe(-1);
      expect(world.hasComponent(id, ComponentType.SPATIAL_INDEXED)).toBe(false);
    }
  });

  test('takes the culling and shadow settings, and members with bodies', async () => {
    const { groupId, members } = createBatchedGroup(0, { perMemberCulling: false });
    const moving = createMember(0, 0, { castShadow: true });
    addBody(moving, 'BODY_DYNAMIC_VISUAL');
    addToMergeGroup(groupId, [...members, moving]);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;
    expect(batch.perObjectFrustumCulled).toBe(false);
    expect(batch.castShadow).toBe(true);
    expect(getMember(moving).instanceId).toBe(0);
  });

  test('adds members that join later, growing its buffers for more instances and a new geometry', async () => {
    const groupId = nextGroupId();
    createMergeGroup({ id: groupId, mode: 'BATCHED' });
    const first = createMember(0);
    addToMergeGroup(groupId, [first]);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;
    const maxInstances = batch.maxInstanceCount;

    const boxes = Array.from({ length: 40 }, (_, i) => createMember(i, 4));
    const sphere = createMember(0, 8, { geo: 'batchTestSphere' });
    addToMergeGroup(groupId, [...boxes, sphere]);
    await buildPendingMergeGroupsAsync();
    // The same batch, grown
    expect(getBatch(groupId)).toBe(batch);
    expect(batch.maxInstanceCount).toBeGreaterThan(maxInstances);
    expect(batch.instanceCount).toBe(42);
    expect(batch.getGeometryIdAt(getMember(sphere).instanceId)).toBe(1);
    expect(boxes.every((id) => batch.getGeometryIdAt(getMember(id).instanceId) === 0)).toBe(true);
    // The sphere's vertices were copied in where the grown buffers have room
    const range = batch.getGeometryRangeAt(1);
    const sphereGeometry = getOwnMesh(sphere).geometry;
    expect(range.vertexCount).toBe(sphereGeometry.getAttribute('position').count);
    expect(batch.geometry.getAttribute('position').getX(range.vertexStart)).toBeCloseTo(
      sphereGeometry.getAttribute('position').getX(0)
    );
  });

  test('a rebuild makes a new batch, regrouping the ids a leave and a join split', async () => {
    const { groupId, members } = createBatchedGroup(4);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;
    // A box leaves (id 0), a sphere joins into its freed id: the runs are box, sphere, sphere…
    removeFromMergeGroup([members[0]]);
    const sphere = createMember(10, 0, { geo: 'batchTestSphere' });
    addToMergeGroup(groupId, [sphere]);
    await buildPendingMergeGroupsAsync();
    expect(getMember(sphere).instanceId).toBe(0);

    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    const rebuilt = getBatch(groupId)!;
    expect(rebuilt).not.toBe(batch);
    expect(batch.parent).toBeNull();
    expect(rebuilt.instanceCount).toBe(4);
    // The spheres first (members[1] is the first member left), then the box
    const ids = [members[1], members[3], sphere, members[2]].map((id) => getMember(id).instanceId);
    expect(ids).toEqual([0, 1, 2, 3]);
  });

  test('updateMergeMember does nothing for a batched member, and an edit session warns', async () => {
    const { members } = createBatchedGroup(1);
    await buildPendingMergeGroupsAsync();
    updateMergeMember(members[0]);
    beginMergeMemberEdit(members[0]);
    expect(isMergeMemberInEdit(members[0])).toBe(false);
    expect(warnings()).toEqual([expect.stringContaining('needs no session')]);
  });
});

describe('leaving a batch', () => {
  test('a removed or deleted member loses its instance and is drawn on its own again', async () => {
    const { groupId, members } = createBatchedGroup(3);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;

    removeFromMergeGroup([members[0]]);
    expect(batch.instanceCount).toBe(2);
    expect(getMergeGroupOf(members[0])).toBeUndefined();
    expect(getOwnMesh(members[0]).visible).toBe(true);
    expect(world.hasComponent(members[0], ComponentType.SPATIAL_INDEXED)).toBe(true);

    world.deleteEntity(members[1]);
    expect(batch.instanceCount).toBe(1);
    expect(getGroup(groupId)!.members).toEqual([members[2]]);
  });

  test("the last member's leave takes an explicit group's batch out of the scene, and deletes an AUTO one", async () => {
    const { groupId, members } = createBatchedGroup(1);
    const auto = createMember(0, 0, { merge: { mode: 'BATCHED' } });
    await buildPendingMergeGroupsAsync();
    const autoId = getMergeGroupOf(auto)!;
    expect(getBatch(autoId)).toBeDefined();

    removeFromMergeGroup([members[0], auto]);
    await buildPendingMergeGroupsAsync();
    expect(getBatch(groupId)!.parent).toBeNull();
    expect(getGroups(world).has(autoId)).toBe(false);

    // A member joining again puts it back
    addToMergeGroup(groupId, [createMember(4)]);
    await buildPendingMergeGroupsAsync();
    expect(getBatch(groupId)!.parent).toBe(getRootScene());
  });

  test('dissolving deletes the batch and draws the members on their own', async () => {
    const { groupId, members } = createBatchedGroup(2);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;
    dissolveMergeGroup(groupId);
    expect(batch.parent).toBeNull();
    expect(members.map((id) => getOwnMesh(id).visible)).toEqual([true, true]);
    expect(members.map((id) => getMergeGroupOf(id))).toEqual([undefined, undefined]);
  });
});

describe("a batched member's visibility", () => {
  test('DISABLED, the engine frustum culling and a draw hold hide its instance, never its batch', async () => {
    const { groupId, members } = createBatchedGroup(2);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;
    const [member] = members;
    const id = getMember(member).instanceId;
    for (const tag of ['DISABLED', 'TAG_FRUSTUM_CULLED', 'TAG_DRAW_HELD'] as const) {
      world.addComponent(member, ComponentType[tag], true);
      expect(batch.getVisibleAt(id)).toBe(false);
      world.removeComponent(member, ComponentType[tag]);
      expect(batch.getVisibleAt(id)).toBe(true);
      // Its own mesh stays hidden (TAG_MERGED)
      expect(getOwnMesh(member).visible).toBe(false);
    }
    // Two reasons: shown again only when both are gone
    world.addComponent(member, ComponentType.DISABLED, true);
    world.addComponent(member, ComponentType.TAG_DRAW_HELD, true);
    world.removeComponent(member, ComponentType.DISABLED);
    expect(batch.getVisibleAt(id)).toBe(false);
    world.removeComponent(member, ComponentType.TAG_DRAW_HELD);
    expect(batch.getVisibleAt(id)).toBe(true);
    expect(batch.visible).toBe(true);
  });

  test('a member hidden before its build is added hidden, and shown when its hold goes', async () => {
    const { groupId, members } = createBatchedGroup(2);
    world.addComponent(members[0], ComponentType.TAG_DRAW_HELD, true);
    world.addComponent(members[1], ComponentType.DISABLED, true);
    await buildPendingMergeGroupsAsync();
    const batch = getBatch(groupId)!;
    const ids = members.map((id) => getMember(id).instanceId);
    expect(ids.map((id) => batch.getVisibleAt(id))).toEqual([false, false]);
    world.removeComponent(members[0], ComponentType.TAG_DRAW_HELD);
    expect(batch.getVisibleAt(ids[0])).toBe(true);
  });
});

describe('the sync', () => {
  const syncWorlds: ECSWorld[] = [];
  afterEach(() => {
    for (const w of syncWorlds.splice(0)) ECSWorld.deleteWorld(w.id);
  });

  /** A world of its own, two boxes at x 0 and 2 (y 1) in one built BATCHED group: its batch sits
   * at (1, 1, 0). */
  const createSyncedBatchAsync = async (storageMode: ECSStorageMode) => {
    const w = new ECSWorld({ id: `batchSync${seq++}`, storageMode });
    syncWorlds.push(w);
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId, mode: 'BATCHED' }, w);
    const members = [0, 2].map((x) =>
      createMeshEntity(
        { geo: 'batchTestBox', mat: 'batchTestMat', position: { x, y: 1, z: 0 } },
        { world: w }
      )
    );
    addToMergeGroup(groupId, members, w);
    await buildPendingMergeGroupsAsync(w);
    const batch = w.getComponent(groupEntityId, ComponentType.OBJECT3D)!.value as THREE.BatchedMesh;
    const frame = () => {
      w.updateMainLoop(0.016);
      w.updateAppLoop(0.016);
    };
    /** The instance's place in world space. */
    const placeOf = (entityId: number) => {
      const matrix = new THREE.Matrix4();
      batch.getMatrixAt(w.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId, matrix);
      return new THREE.Vector3().setFromMatrixPosition(matrix).add(batch.position).toArray();
    };
    return { w, groupEntityId, members, batch, frame, placeOf };
  };

  test.each(['MAP', 'TYPED_ARRAY'] as const)(
    "writes a moved member's instance when its own mesh moves, and none for one that stayed (%s)",
    async (storageMode) => {
      const { w, members, batch, frame, placeOf } = await createSyncedBatchAsync(storageMode);
      frame(); // the meshes' first sync
      const writes = vi.spyOn(batch, 'setMatrixAt');
      frame();
      expect(writes).not.toHaveBeenCalled();

      w.setTransform(members[0], { pos: { x: -4, y: 1, z: 3 } });
      frame();
      expect(writes).toHaveBeenCalledTimes(1);
      expect(placeOf(members[0])).toEqual([-4, 1, 3]);
      expect(placeOf(members[1])).toEqual([2, 1, 0]);

      // Moved after MAIN: its own mesh is moved at the next frame's MAIN, and so is its instance
      // (in TYPED_ARRAY that MAIN clears the dirty flag: the version says it moved)
      writes.mockClear();
      w.updateMainLoop(0.016);
      w.setTransform(members[1], { pos: { x: 6, y: 1, z: 0 } });
      w.updateAppLoop(0.016);
      expect(placeOf(members[1])).toEqual([2, 1, 0]);
      frame();
      expect(placeOf(members[1])).toEqual([6, 1, 0]);
      expect(writes).toHaveBeenCalledTimes(1);
    }
  );

  test("a body's member follows its mesh every frame, after the pose producers", async () => {
    const { w, members, frame, placeOf } = await createSyncedBatchAsync('MAP');
    addBody(members[0], 'BODY_DYNAMIC_VISUAL', w);
    const mesh = getOwnMeshIn(w, members[0]);
    // physics' interpolation: it moves the mesh, not the TRANSFORM, at POSE_PRODUCERS
    let x = 0;
    w.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'fakeInterpolation',
      () => {
        mesh.position.x = x;
      },
      APP_RENDER_SYNC_ORDER.POSE_PRODUCERS
    );
    for (x of [0.5, 1, 1.5]) {
      frame();
      expect(placeOf(members[0])).toEqual([x, 1, 0]);
    }
    expect(w.getSystemOrder(ECSSystemStage.APP_RENDER_SYNC)).toContainEqual(
      expect.objectContaining({
        id: 'mergeBatchSync',
        order: APP_RENDER_SYNC_ORDER.MERGE_BATCH_SYNC,
      })
    );
  });

  test('grows the batch sphere for a member moved out of it, never shrinks it, and re-joins the spatial index', async () => {
    const { w, groupEntityId, members, batch, frame } = await createSyncedBatchAsync('MAP');
    frame();
    const radius = batch.boundingSphere!.radius;
    const joins = spatialJoins.filter((id) => id === groupEntityId).length;

    w.setTransform(members[0], { pos: { x: 50, y: 1, z: 0 } });
    frame();
    const grown = batch.boundingSphere!.radius;
    expect(grown).toBeGreaterThan(radius);
    expect(batch.boundingSphere!.containsPoint(new THREE.Vector3(49, 0, 0))).toBe(true);
    expect(batch.geometry.boundingSphere!.equals(batch.boundingSphere!)).toBe(true);
    expect(spatialJoins.filter((id) => id === groupEntityId).length).toBe(joins + 1);

    w.setTransform(members[0], { pos: { x: 0, y: 1, z: 0 } });
    frame();
    expect(batch.boundingSphere!.radius).toBe(grown);
    expect(spatialJoins.filter((id) => id === groupEntityId).length).toBe(joins + 1);
  });

  test("a deleted group's batch leaves the sync", async () => {
    const { w, groupEntityId, members, batch, frame } = await createSyncedBatchAsync('MAP');
    w.deleteEntity(groupEntityId);
    const writes = vi.spyOn(batch, 'setMatrixAt');
    w.setTransform(members[0], { pos: { x: 5, y: 1, z: 0 } });
    frame();
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('grouping and compaction (D1)', () => {
  /** three r187's merged draws for the batch (its WebGPU path): consecutive instances of one
   * geometry, freed and hidden ids skipped, are one draw. */
  const countMergedDraws = (batch: THREE.BatchedMesh) => {
    const internals = batch as unknown as {
      _visibilityChanged: boolean;
      _mergedDrawCount: number;
      _updateDrawParameters: (
        camera: THREE.Camera,
        geometry: THREE.BufferGeometry,
        material: THREE.Material,
        drawFormat: 'merged'
      ) => void;
    };
    internals._visibilityChanged = true;
    internals._updateDrawParameters(
      new THREE.PerspectiveCamera(),
      batch.geometry,
      batch.material as THREE.Material,
      'merged'
    );
    return internals._mergedDrawCount;
  };

  const frame = () => {
    world.updateMainLoop(0.016);
    world.updateAppLoop(0.016);
  };

  /** Eight members, four boxes then four spheres by id (createBatchedGroup alternates them, the
   * build groups them), culled as a whole only, so three's count sees every instance. */
  const createGroupedAsync = async () => {
    const { groupId, members } = createBatchedGroup(8, { perMemberCulling: false });
    await buildPendingMergeGroupsAsync();
    frame();
    const batch = getBatch(groupId)!;
    const group = getGroup(groupId)!;
    const boxes = members.filter((_, i) => i % 2 === 0);
    const spheres = members.filter((_, i) => i % 2 === 1);
    return { groupId, batch, group, boxes, spheres };
  };

  test('a build adds the members grouped: one run, and one merged draw, per geometry', async () => {
    const { batch, group, boxes, spheres } = await createGroupedAsync();
    expect(boxes.map((id) => getMember(id).instanceId)).toEqual([0, 1, 2, 3]);
    expect(spheres.map((id) => getMember(id).instanceId)).toEqual([4, 5, 6, 7]);
    expect(getBatchState(group)!.runs).toBe(2);
    expect(countMergedDraws(batch)).toBe(2);
  });

  test(`joins into freed ids split the runs; under ${COMPACT_RUNS_FACTOR}× the geometries nothing moves`, async () => {
    const { groupId, batch, group, boxes } = await createGroupedAsync();
    // A box leaves id 0, a sphere joins into it: sphere, box ×3, sphere ×4
    removeFromMergeGroup([boxes[0]]);
    const sphere = createMember(20, 0, { geo: 'batchTestSphere' });
    addToMergeGroup(groupId, [sphere]);
    await buildPendingMergeGroupsAsync();
    frame();
    const state = getBatchState(group)!;
    expect(getMember(sphere).instanceId).toBe(0);
    expect(state.runs).toBe(3);
    expect(countMergedDraws(batch)).toBe(3);
    expect(state.compactions).toBe(0);
  });

  test('past it, the sync compacts in place: the same ids regrouped, each instance where its member is', async () => {
    const { groupId, batch, group, boxes, spheres } = await createGroupedAsync();
    // Boxes leave ids 0 and 2, spheres join into them: sphere, box, sphere, box, sphere ×4 is
    // five runs, past twice the two geometries
    removeFromMergeGroup([boxes[0], boxes[2]]);
    const joined = [
      createMember(20, 0, { geo: 'batchTestSphere' }),
      createMember(22, 0, { geo: 'batchTestSphere' }),
    ];
    world.addComponent(spheres[1], ComponentType.DISABLED, true);
    addToMergeGroup(groupId, joined);
    await buildPendingMergeGroupsAsync();
    frame();

    const state = getBatchState(group)!;
    expect(state.compactions).toBe(1);
    expect(state.runs).toBe(2);
    expect(countMergedDraws(batch)).toBe(2);
    // The ids in use are the same eight; the boxes (geometry 0) first, by their ids before
    const remainingBoxes = [boxes[1], boxes[3]];
    expect(remainingBoxes.map((id) => getMember(id).instanceId)).toEqual([0, 1]);
    const allIds = [...remainingBoxes, ...spheres, ...joined].map((id) => getMember(id).instanceId);
    expect(allIds.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Each instance is its member's geometry, place and visibility
    const matrix = new THREE.Matrix4();
    for (const id of [...remainingBoxes, ...spheres, ...joined]) {
      const instanceId = getMember(id).instanceId;
      const geometryId = getOwnMesh(id).geometry === getOwnMesh(boxes[1]).geometry ? 0 : 1;
      expect(batch.getGeometryIdAt(instanceId)).toBe(geometryId);
      batch.getMatrixAt(instanceId, matrix);
      const place = new THREE.Vector3().setFromMatrixPosition(matrix).add(batch.position);
      expect(place.distanceTo(getOwnMesh(id).position)).toBeLessThan(1e-6);
      expect(batch.getVisibleAt(instanceId)).toBe(id !== spheres[1]);
    }
    // The sync keeps writing them where they are now
    world.setTransform(joined[0], { pos: { x: 30, y: 1, z: 0 } });
    frame();
    batch.getMatrixAt(getMember(joined[0]).instanceId, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).add(batch.position).x).toBeCloseTo(30);
  });

  test('a leave alone never splits a run (three skips the freed id)', async () => {
    const { batch, group, boxes } = await createGroupedAsync();
    removeFromMergeGroup([boxes[1], boxes[2]]);
    frame();
    expect(getBatchState(group)!.runs).toBe(2);
    expect(countMergedDraws(batch)).toBe(2);
  });
});
