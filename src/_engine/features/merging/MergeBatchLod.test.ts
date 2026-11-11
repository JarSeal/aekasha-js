import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// The main loop's frame and the main camera, set by each step; a renderer for the WebGL2 test
const loop = vi.hoisted(() => ({
  frame: 1,
  camera: undefined as unknown,
  renderer: null as unknown,
}));
vi.mock(import('../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: () => loop.renderer as never,
}));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainLoopFrame: () => loop.frame,
}));
vi.mock(import('../../kernel/camera/Camera'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainCamera: () => loop.camera as THREE.Camera | undefined,
}));

import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry, saveBufferGeometry } from '../../kernel/assets/Geometry';
import { createMaterial } from '../../kernel/assets/Material';
import {
  createMeshEntity,
  installMeshes,
  type MeshProps,
  setMeshLod,
} from '../../kernel/mesh/Mesh';
import { createRootScene, getRootScene } from '../../kernel/scene/Scene';
import { installLodSystem } from '../lod/LodSystem';
import { setLodDebugOptions } from '../lod/LodSettings';
import type { LodDef } from '../lod/LodTypes';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  getMergeGroupOf,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
} from './MergeGroups';
import { type BatchState, getBatchState, setBatchOrder } from './MergeBatch';
import { createBatchFades } from './MergeBatchFades';
import { isLodDitherEnabled, LOD_FADE_OPAQUE } from '../../kernel/render/LodFade';
import { getMaterial } from '../../kernel/assets/Material';
import { getGroups } from './MergeState';

// p375 Phase 2 (docs/plans/p375_batched-mesh-batches.md): a batched member's LOD levels. S2: a
// BAKED group still refuses a LOD; a BATCHED one takes a member whose levels its batch can draw
// (the mesh's material and castShadow, geometries agreeing exactly), checked at the join and when a
// LOD comes later. lod()'s install comes first, as in the template: merging's later-LOD check
// runs after the LOD's add hook resolved the levels. S3: the batch holds the levels, a level change
// swaps an instance's geometry in place, LOD culling hides it, and a member merged again takes what
// its own mesh shows. S4: the cross-fades (a level fade's second instance, the batch's fades, a
// cull's fade out and in) and what ends them.

const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx, installed } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installLodSystem(ctx);
  installed.add('lod');
  installMergeGroups(ctx);
  // Persistent: a deleted mesh's last ref would release them
  const box = { width: 1, height: 1, depth: 1 };
  createGeometry({ id: 'batchLodBox', type: 'BOX', params: box, isPersistent: true });
  createGeometry({
    id: 'batchLodBoxLow',
    type: 'BOX',
    params: { width: 0.5, height: 0.5, depth: 0.5 },
    isPersistent: true,
  });
  const extra = new THREE.BoxGeometry();
  extra.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3));
  saveBufferGeometry(extra, { id: 'batchLodBoxExtra', isPersistent: true });
  saveBufferGeometry(new THREE.BoxGeometry().toNonIndexed(), {
    id: 'batchLodBoxUnindexed',
    isPersistent: true,
  });
  createMaterial({ id: 'batchLodMat', type: 'BASIC', params: {}, isPersistent: true });
  createMaterial({ id: 'batchLodMatOther', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  setLodDebugOptions({ forceLevel: -1 });
  loop.renderer = null;
  world.clearWorld();
  fns.lwarn.mockClear();
});

let seq = 0;
const nextGroupId = () => `batchLod${seq++}`;

/** Two levels: the box, then a half-size one (the same attributes' layout) */
const LOD: LodDef = { levels: [{ screenSize: 0.5 }, { screenSize: 0.1, geo: 'batchLodBoxLow' }] };

/** A box mesh entity at x with `lod`, unless `props` say otherwise. */
const createLodMember = (x: number, props: Partial<MeshProps> = {}) =>
  createMeshEntity({
    geo: 'batchLodBox',
    mat: 'batchLodMat',
    position: { x, y: 1, z: 0 },
    lod: LOD,
    ...props,
  });

const warnings = () => fns.lwarn.mock.calls.map((call) => String(call[0]));

/** The group's id, made with `mode`, and `entityIds` added. */
const addToNewGroup = (entityIds: number[], mode: 'BAKED' | 'BATCHED' = 'BATCHED') => {
  const groupId = nextGroupId();
  createMergeGroup({ id: groupId, mode });
  addToMergeGroup(groupId, entityIds);
  return groupId;
};

/** `LOD` with its level 1 changed by `change`. */
const withLevel1 = (change: Partial<LodDef['levels'][number]>): LodDef => ({
  levels: [LOD.levels[0], { ...LOD.levels[1], ...change }],
});

describe('a LOD at the join', () => {
  test('a BAKED group refuses it, naming the BATCHED mode', () => {
    const entityId = createLodMember(0);
    addToNewGroup([entityId], 'BAKED');
    expect(getMergeGroupOf(entityId)).toBeUndefined();
    expect(warnings()).toEqual([
      expect.stringMatching(
        /entity \d+ is drawn on its own: it has a LOD \(a BATCHED group draws its levels\)/
      ),
    ]);
  });

  test('a BATCHED group takes it when its batch can draw every level', async () => {
    const entityId = createLodMember(0);
    const groupId = addToNewGroup([entityId]);
    expect(getMergeGroupOf(entityId)).toBe(groupId);
    await buildPendingMergeGroupsAsync();
    expect(world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId).toBe(0);
    expect(warnings()).toEqual([]);
  });

  test.each([
    [
      'another material',
      withLevel1({ mat: 'batchLodMatOther' }),
      "its LOD level 1's material isn't the mesh's (a batch draws one material)",
    ],
    [
      'another castShadow',
      withLevel1({ castShadow: true }),
      "its LOD level 1's castShadow isn't the mesh's (a batch casts shadows as a whole)",
    ],
    [
      'an extra attribute',
      withLevel1({ geo: 'batchLodBoxExtra' }),
      `its LOD level 1's geometry has a "color" attribute the mesh hasn't (a batch's geometries agree exactly)`,
    ],
    [
      'no index',
      withLevel1({ geo: 'batchLodBoxUnindexed' }),
      "its LOD level 1's geometry has an index where the mesh has none, or none where it has one (a batch's geometries agree exactly)",
    ],
  ])('a BATCHED group refuses a level with %s', (_kind, def, reason) => {
    const entityId = createLodMember(0, { lod: def });
    addToNewGroup([entityId]);
    expect(getMergeGroupOf(entityId)).toBeUndefined();
    expect(warnings()).toEqual([expect.stringContaining(`is drawn on its own: ${reason}.`)]);
  });

  test("AUTO's BATCHED merge refuses it before a bucket is picked", async () => {
    const entityId = createLodMember(0, {
      lod: withLevel1({ mat: 'batchLodMatOther' }),
      merge: { mode: 'BATCHED' },
    });
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(entityId)).toBeUndefined();
    expect(warnings()).toEqual([expect.stringContaining("its LOD level 1's material")]);
  });
});

describe('a LOD added to a batched member later', () => {
  test('stays when its batch can draw the levels', async () => {
    const entityId = createLodMember(0, { lod: undefined });
    const groupId = addToNewGroup([entityId]);
    await buildPendingMergeGroupsAsync();
    await setMeshLod(entityId, LOD, world);
    expect(getMergeGroupOf(entityId)).toBe(groupId);
    expect(warnings()).toEqual([]);
  });

  test("makes it leave when it can't, warned, drawn on its own with its LOD", async () => {
    const entityId = createLodMember(0, { lod: undefined });
    const groupId = addToNewGroup([entityId]);
    await buildPendingMergeGroupsAsync();
    await setMeshLod(entityId, withLevel1({ mat: 'batchLodMatOther' }), world);
    expect(getMergeGroupOf(entityId)).toBeUndefined();
    expect(world.hasComponent(entityId, ComponentType.LOD)).toBe(true);
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;
    expect(mesh.parent).toBe(getRootScene());
    expect(mesh.visible).toBe(true);
    expect(warnings()).toEqual([
      `Merge group "${groupId}": entity ${entityId} leaves it, drawn on its own: its LOD level 1's material isn't the mesh's (a batch draws one material).`,
    ]);
  });

  test("a BAKED member's is left alone (its LOD does nothing while it's merged)", async () => {
    const entityId = createLodMember(0, { lod: undefined });
    const groupId = addToNewGroup([entityId], 'BAKED');
    await buildPendingMergeGroupsAsync();
    await setMeshLod(entityId, withLevel1({ mat: 'batchLodMatOther' }), world);
    expect(getMergeGroupOf(entityId)).toBe(groupId);
    expect(warnings()).toEqual([]);
  });
});

// --- S3: the levels in the batch ---

const DT = 1 / 60;

/** Runs `frames` frames of the world's loop (the LOD's systems, the batch sync) with the camera
 * at (0, 1, `distance`), looking down -z: k = 1 (fov 90°), so a box (radius ~0.87) is level 0
 * nearer than ~1.9 m and level 1 farther. */
const stepAt = (distance: number, frames = 1) => {
  const camera = new THREE.PerspectiveCamera(90);
  camera.position.set(0, 1, distance);
  loop.camera = camera;
  for (let i = 0; i < frames; i++) {
    loop.frame++;
    world.updateAppLoop(DT);
  }
};

/** One frame with every LOD forced to level 0 (each member's first apply, which never fades). */
const stepNear = () => {
  setLodDebugOptions({ forceLevel: 0 });
  stepAt(1);
  setLodDebugOptions({ forceLevel: -1 });
};

/** A built BATCHED group of LOD boxes at x = 0, 2, 4, …; `defs` gives each one's LOD. */
const createBuiltLodGroupAsync = async (defs: (LodDef | undefined)[]) => {
  const groupId = nextGroupId();
  createMergeGroup({ id: groupId, mode: 'BATCHED' });
  const members = defs.map((def, i) => createLodMember(i * 2, { lod: def }));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  const groupEntityId = getGroups(world).get(groupId)!;
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
  const batch = world.getComponent(groupEntityId, ComponentType.OBJECT3D)!
    .value as THREE.BatchedMesh;
  return { groupId, groupEntityId, group, batch, members, state: () => getBatchState(group)! };
};

const getInstanceId = (entityId: number) =>
  world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId;
const getOwnMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

/** The batch's geometry id of a registered geometry. */
const batchGeometryId = (state: ReturnType<typeof getBatchState>, geometryId: string) => {
  for (const [geometry, id] of state!.geometryIds)
    if (geometry.userData.id === geometryId) return id;
  return undefined;
};

/** A LOD that keeps level 0 at any distance here */
const NEAR_ONLY: LodDef = { ...LOD, bias: 100 };
/** Instant switches, culled past ~43 m */
const INSTANT: LodDef = { ...LOD, cullScreenSize: 0.02, fadeSeconds: 0 };

describe('a batched member LOD: levels', () => {
  test("the batch holds every member's level geometries, the ones no member shows too", async () => {
    const { state, batch, members } = await createBuiltLodGroupAsync([LOD]);
    expect(batchGeometryId(state(), 'batchLodBox')).toBeDefined();
    expect(batchGeometryId(state(), 'batchLodBoxLow')).toBeDefined();
    expect(batch.getGeometryIdAt(getInstanceId(members[0]))).toBe(
      batchGeometryId(state(), 'batchLodBox')
    );
  });

  test("a level change swaps the instance's geometry in place, and on its own mesh", async () => {
    const { state, batch, members } = await createBuiltLodGroupAsync([INSTANT]);
    stepNear();
    const instanceId = getInstanceId(members[0]);
    stepAt(5);
    expect(getInstanceId(members[0])).toBe(instanceId);
    expect(batch.getGeometryIdAt(instanceId)).toBe(batchGeometryId(state(), 'batchLodBoxLow'));
    expect(getOwnMesh(members[0]).geometry.userData.id).toBe('batchLodBoxLow');
    expect(getOwnMesh(members[0]).children).toEqual([]);
    expect(batch.instanceCount).toBe(1);

    stepAt(1);
    expect(batch.getGeometryIdAt(instanceId)).toBe(batchGeometryId(state(), 'batchLodBox'));
  });

  /** Five members alternating: the even ones go to level 1 at 8 m, the odd ones keep level 0 */
  const ALTERNATING = [INSTANT, NEAR_ONLY, INSTANT, NEAR_ONLY, INSTANT].map((def) => ({
    ...def,
    fadeSeconds: 0,
  }));

  test('a LOD batch sorts each pass by geometry range: swaps split the runs, no compaction', async () => {
    const { state, batch } = await createBuiltLodGroupAsync(ALTERNATING);
    expect(state().order).toBe('RANGE_SORT');
    expect(batch.sortObjects).toBe(true);
    stepNear();
    stepAt(8, 2);
    // [low, box, low, box, low]: 5 runs of 2 geometries, left so
    expect(state().runs).toBe(5);
    expect(state().compactions).toBe(0);
    // The sort puts each geometry's draws together (r187 merges them), front to back within one
    const list = [
      { start: 30, count: 3, z: 2, index: 0 },
      { start: 0, count: 3, z: 5, index: 1 },
      { start: 30, count: 3, z: 1, index: 2 },
      { start: 0, count: 3, z: 4, index: 3 },
    ];
    batch.customSort!.call(batch, list, new THREE.PerspectiveCamera());
    expect(list.map((item) => item.index)).toEqual([3, 1, 2, 0]);
  });

  test('compacting (a LOD batch forced to), swaps past twice the geometries compact the next frame', async () => {
    const { state, members } = await createBuiltLodGroupAsync(ALTERNATING);
    setBatchOrder(state() as BatchState, 'COMPACT');
    stepNear();
    expect(state().runs).toBe(1);
    stepAt(8);
    // The sync runs before the LOD's apply (APP_RENDER_SYNC_ORDER), so it counts and compacts
    // them in the next frame
    expect(state().compactions).toBe(0);
    stepAt(8);
    expect(state().compactions).toBe(1);
    expect(state().runs).toBe(2);
    const low = batchGeometryId(state(), 'batchLodBoxLow');
    const geometryOf = (entityId: number) =>
      state().geometryAt[getInstanceId(entityId)] === low ? 'low' : 'box';
    expect(members.map(geometryOf)).toEqual(['low', 'box', 'low', 'box', 'low']);
  });

  test('on WebGL2 a batch neither sorts nor compacts: its multi-draw is one draw in any order', async () => {
    loop.renderer = { backend: { isWebGPUBackend: false } };
    const { state, batch } = await createBuiltLodGroupAsync(ALTERNATING);
    expect(state().order).toBe('NONE');
    expect(batch.sortObjects).toBe(false);
    stepNear();
    stepAt(8, 2);
    expect(state().runs).toBe(5);
    expect(state().compactions).toBe(0);
  });

  test('on WebGPU a batch without a LOD compacts, and sorts by range from its first LOD', async () => {
    loop.renderer = { backend: { isWebGPUBackend: true } };
    const { state, batch, members } = await createBuiltLodGroupAsync([undefined]);
    expect(state().order).toBe('COMPACT');
    expect(batch.sortObjects).toBe(false);
    await setMeshLod(members[0], INSTANT, world);
    stepNear();
    expect(state().order).toBe('RANGE_SORT');
    expect(batch.sortObjects).toBe(true);
  });

  test("a LOD added after the member's build adds its levels at its first apply", async () => {
    const { state, batch, members } = await createBuiltLodGroupAsync([undefined]);
    expect(batchGeometryId(state(), 'batchLodBoxLow')).toBeUndefined();
    await setMeshLod(members[0], INSTANT, world);
    stepNear();
    stepAt(5);
    expect(batch.getGeometryIdAt(getInstanceId(members[0]))).toBe(
      batchGeometryId(state(), 'batchLodBoxLow')
    );
  });

  test('a rebuild keeps the level each member shows; a leave shows it on its own mesh', async () => {
    const { groupId, groupEntityId, state, members } = await createBuiltLodGroupAsync([
      INSTANT,
      INSTANT,
    ]);
    stepNear();
    stepAt(5);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    const rebuilt = world.getComponent(groupEntityId, ComponentType.OBJECT3D)!
      .value as THREE.BatchedMesh;
    const low = batchGeometryId(state(), 'batchLodBoxLow');
    expect(members.map((id) => rebuilt.getGeometryIdAt(getInstanceId(id)))).toEqual([low, low]);

    removeFromMergeGroup([members[0]]);
    expect(getOwnMesh(members[0]).geometry.userData.id).toBe('batchLodBoxLow');
    expect(getOwnMesh(members[0]).visible).toBe(true);
  });

  test('merged again, an instance takes the level its own mesh got meanwhile', async () => {
    const { state, batch, members } = await createBuiltLodGroupAsync([INSTANT]);
    stepNear();
    // Drawn on its own (as "Show unmerged" does): the LOD's plain path, the batch not told
    world.removeComponent(members[0], ComponentType.TAG_MERGED);
    stepAt(5);
    const instanceId = getInstanceId(members[0]);
    expect(batch.getGeometryIdAt(instanceId)).toBe(batchGeometryId(state(), 'batchLodBox'));
    world.addComponent(members[0], ComponentType.TAG_MERGED, true);
    expect(batch.getGeometryIdAt(instanceId)).toBe(batchGeometryId(state(), 'batchLodBoxLow'));
  });
});

describe('a batched member LOD: culling', () => {
  test('hides and shows the instance, never the batch', async () => {
    const { batch, members } = await createBuiltLodGroupAsync([INSTANT, NEAR_ONLY]);
    stepNear();
    stepAt(100);
    expect(world.hasComponent(members[0], ComponentType.TAG_LOD_CULLED)).toBe(true);
    expect(members.map((id) => batch.getVisibleAt(getInstanceId(id)))).toEqual([false, true]);
    expect(batch.visible).toBe(true);
    stepAt(5);
    expect(members.map((id) => batch.getVisibleAt(getInstanceId(id)))).toEqual([true, true]);
  });

  test('a cull fading out keeps the instance until its fade ends', async () => {
    const { batch, members } = await createBuiltLodGroupAsync([
      { ...LOD, cullScreenSize: 0.02, fadeSeconds: 0.1 },
    ]);
    stepNear();
    stepAt(5, 7);
    const instanceId = getInstanceId(members[0]);
    stepAt(100);
    expect(world.hasComponent(members[0], ComponentType.TAG_LOD_TRANSITIONING)).toBe(true);
    expect(batch.getVisibleAt(instanceId)).toBe(true);
    stepAt(100, 5);
    expect(world.hasComponent(members[0], ComponentType.TAG_LOD_TRANSITIONING)).toBe(false);
    expect(batch.getVisibleAt(instanceId)).toBe(false);
  });

  test('a culled member stays hidden through a compaction and a DISABLED round trip', async () => {
    // At 8 m the INSTANT ones go to level 1, the NEAR_ONLY ones stay, the last is culled: 6 runs
    const cullEarly: LodDef = { ...LOD, cullScreenSize: 0.2, fadeSeconds: 0 };
    const { batch, state, members } = await createBuiltLodGroupAsync([
      INSTANT,
      NEAR_ONLY,
      INSTANT,
      NEAR_ONLY,
      INSTANT,
      cullEarly,
    ]);
    setBatchOrder(state() as BatchState, 'COMPACT');
    stepNear();
    stepAt(8);
    const culled = members[5];
    expect(world.hasComponent(culled, ComponentType.TAG_LOD_CULLED)).toBe(true);
    expect(batch.getVisibleAt(getInstanceId(culled))).toBe(false);
    // The next frame's sync compacts, writing every instance's visibility again
    stepAt(8);
    expect(state().compactions).toBe(1);
    expect(members.map((id) => batch.getVisibleAt(getInstanceId(id)))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    world.addComponent(culled, ComponentType.DISABLED, true);
    world.removeComponent(culled, ComponentType.DISABLED);
    expect(batch.getVisibleAt(getInstanceId(culled))).toBe(false);
  });
});

// --- S4: the cross-fades ---

/** 0.1 s: 6 frames at DT */
const FADED: LodDef = { ...LOD, cullScreenSize: 0.02, fadeSeconds: 0.1 };

/** The batch's fade at an instance. */
const fadeAt = (state: ReturnType<typeof getBatchState>, instanceId: number) =>
  state!.fades.data[instanceId];
const getMember = (entityId: number) => world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;

describe('a batched member LOD: a level fade', () => {
  test('draws the outgoing level as a second instance, the two dithering into each other', async () => {
    const { state, batch, members } = await createBuiltLodGroupAsync([FADED]);
    stepNear();
    stepAt(5);
    const member = getMember(members[0]);
    const { instanceId: id, _fadeInstanceId: fadeId } = member;
    expect(fadeId).toBeGreaterThanOrEqual(0);
    expect(member._lodFade).toBe('LEVEL');
    expect(batch.instanceCount).toBe(2);
    expect(batch.getGeometryIdAt(id)).toBe(batchGeometryId(state(), 'batchLodBoxLow'));
    expect(batch.getGeometryIdAt(fadeId)).toBe(batchGeometryId(state(), 'batchLodBox'));
    expect(batch.getVisibleAt(fadeId)).toBe(true);
    // The apply and the first step in one frame: 1/6 in, 1/6 - 1 out
    expect(fadeAt(state(), id)).toBeCloseTo(1 / 6, 6);
    expect(fadeAt(state(), fadeId)).toBeCloseTo(1 / 6 - 1, 6);
    stepAt(5, 2);
    expect(fadeAt(state(), id)).toBeCloseTo(3 / 6, 6);
    expect(fadeAt(state(), fadeId)).toBeCloseTo(3 / 6 - 1, 6);

    stepAt(5, 3);
    expect(world.hasComponent(members[0], ComponentType.TAG_LOD_TRANSITIONING)).toBe(false);
    expect(member._fadeInstanceId).toBe(-1);
    expect(member._lodFade).toBeUndefined();
    expect(batch.instanceCount).toBe(1);
    expect([fadeAt(state(), id), fadeAt(state(), fadeId)]).toEqual([1, 1]);
  });

  test('dithers the group material: the LOD enabled it on its levels', async () => {
    await createBuiltLodGroupAsync([FADED]);
    expect(isLodDitherEnabled(getMaterial('batchLodMat')!)).toBe(true);
  });

  test('its second instance moves with the member and hides with it', async () => {
    const { batch, members } = await createBuiltLodGroupAsync([FADED]);
    stepNear();
    stepAt(5);
    const { instanceId: id, _fadeInstanceId: fadeId } = getMember(members[0]);
    const transform = world.getComponent(members[0], ComponentType.TRANSFORM)!;
    transform.position.set(0.5, 1.5, 0);
    transform.setDirty();
    world.commitTransform(members[0], transform);
    stepAt(5);
    const at = (instanceId: number) => batch.getMatrixAt(instanceId, new THREE.Matrix4()).elements;
    expect(at(fadeId)).toEqual(at(id));

    world.addComponent(members[0], ComponentType.DISABLED, true);
    expect([batch.getVisibleAt(id), batch.getVisibleAt(fadeId)]).toEqual([false, false]);
    world.removeComponent(members[0], ComponentType.DISABLED);
    expect([batch.getVisibleAt(id), batch.getVisibleAt(fadeId)]).toEqual([true, true]);
  });

  test("a compaction mid-fade carries each member's fade to its new id; the second instances stay", async () => {
    const nearOnly = { ...FADED, bias: 100 };
    const { state, members } = await createBuiltLodGroupAsync([
      FADED,
      nearOnly,
      FADED,
      nearOnly,
      FADED,
    ]);
    setBatchOrder(state() as BatchState, 'COMPACT');
    stepNear();
    stepAt(8);
    const faded = [members[0], members[2], members[4]];
    const fadeIds = faded.map((id) => getMember(id)._fadeInstanceId);
    // The next frame's sync compacts: [low, box, low, box, low, box, box, box] is 6 runs of 2
    stepAt(8);
    expect(state().compactions).toBe(1);
    expect(faded.map((id) => getMember(id)._fadeInstanceId)).toEqual(fadeIds);
    for (const entityId of faded) {
      const { instanceId, _fadeInstanceId: fadeId } = getMember(entityId);
      expect(fadeAt(state(), instanceId)).toBeCloseTo(2 / 6, 6);
      expect(fadeAt(state(), fadeId)).toBeCloseTo(2 / 6 - 1, 6);
    }
    for (const entityId of [members[1], members[3]]) {
      expect(fadeAt(state(), getMember(entityId).instanceId)).toBe(LOD_FADE_OPAQUE);
    }
  });

  test('a leave, a delete, "Show unmerged" and a rebuild mid-fade take its second instance', async () => {
    const { groupId, batch, state, members } = await createBuiltLodGroupAsync([
      FADED,
      FADED,
      FADED,
      FADED,
    ]);
    stepNear();
    stepAt(5);
    expect(batch.instanceCount).toBe(8);

    removeFromMergeGroup([members[0]]);
    expect(batch.instanceCount).toBe(6);
    world.deleteEntity(members[1]);
    expect(batch.instanceCount).toBe(4);
    // Drawn on its own: the LOD no longer tells the batch
    world.removeComponent(members[2], ComponentType.TAG_MERGED);
    expect(batch.instanceCount).toBe(3);
    expect(getMember(members[2])._lodFade).toBeUndefined();
    expect(fadeAt(state(), getMember(members[2]).instanceId)).toBe(LOD_FADE_OPAQUE);

    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    const rebuilt = state();
    expect(rebuilt.batch.instanceCount).toBe(2);
    expect(getMember(members[3])._fadeInstanceId).toBe(-1);
    expect(fadeAt(rebuilt, getMember(members[3]).instanceId)).toBe(LOD_FADE_OPAQUE);
    // The rest of its fade draws it whole, and its end changes nothing
    stepAt(5, 6);
    expect(rebuilt.batch.instanceCount).toBe(2);
    expect(fadeAt(rebuilt, getMember(members[3]).instanceId)).toBe(LOD_FADE_OPAQUE);
  });
});

describe('a batched member LOD: a cull fade', () => {
  test('dithers the instance out, hiding it at the end, and back in', async () => {
    const { state, batch, members } = await createBuiltLodGroupAsync([FADED]);
    stepNear();
    stepAt(5, 7);
    const id = getInstanceId(members[0]);
    stepAt(100);
    expect(getMember(members[0])._lodFade).toBe('OUT');
    expect(batch.getVisibleAt(id)).toBe(true);
    expect(fadeAt(state(), id)).toBeCloseTo(1 / 6 - 1, 6);
    expect(batch.instanceCount).toBe(1);
    stepAt(100, 5);
    expect(batch.getVisibleAt(id)).toBe(false);
    expect(fadeAt(state(), id)).toBe(LOD_FADE_OPAQUE);

    stepAt(5);
    expect(getMember(members[0])._lodFade).toBe('IN');
    expect(batch.getVisibleAt(id)).toBe(true);
    expect(fadeAt(state(), id)).toBeCloseTo(1 / 6, 6);
    stepAt(5, 5);
    expect(getMember(members[0])._lodFade).toBeUndefined();
    expect(fadeAt(state(), id)).toBe(LOD_FADE_OPAQUE);
  });
});

describe("a batch's fades", () => {
  test('are a square float texture of its capacity, opaque, grown with their values kept', () => {
    const batch = new THREE.BatchedMesh(10, 24, 36);
    const fades = createBatchFades(batch, 10);
    expect([fades.texture.image.width, fades.texture.image.height]).toEqual([4, 4]);
    expect(Array.from(fades.data).every((fade) => fade === LOD_FADE_OPAQUE)).toBe(true);
    fades.data[3] = 0.5;
    const disposed = vi.fn();
    fades.texture.addEventListener('dispose', disposed);
    const grown = createBatchFades(batch, 40, fades);
    expect(grown.texture.image.width).toBe(7);
    expect(grown.data[3]).toBe(0.5);
    expect(grown.data[48]).toBe(LOD_FADE_OPAQUE);
    expect(disposed).toHaveBeenCalledOnce();
    // One node a batch: it reads the grown texture at the grown width (the same shader code)
    expect(grown.textureNode).toBe(fades.textureNode);
    expect(grown.textureNode.value).toBe(grown.texture);
    expect(grown.width.value).toBe(7);
  });

  test("a batch grown past its capacity rebuilds at its next draw: its material's version", async () => {
    const { groupId, state } = await createBuiltLodGroupAsync([FADED]);
    const material = getMaterial('batchLodMat')!;
    const { maxInstanceCount } = state().batch;
    const version = material.version;
    const fadesNode = state().fades.textureNode;
    // three (r187) keeps a drawn batch's render objects, reading the textures setInstanceCount
    // replaced, until its material's version changes
    addToMergeGroup(
      groupId,
      Array.from({ length: maxInstanceCount }, (_, i) => createLodMember(i * 2 + 2))
    );
    await buildPendingMergeGroupsAsync();
    expect(state().batch.maxInstanceCount).toBeGreaterThan(maxInstanceCount);
    expect(material.version).toBeGreaterThan(version);
    expect(state().fades.textureNode).toBe(fadesNode);
    expect(state().fades.texture.image.width ** 2).toBeGreaterThanOrEqual(
      state().batch.maxInstanceCount
    );
  });

  test('go with the batch', async () => {
    const { groupId, state } = await createBuiltLodGroupAsync([FADED]);
    const disposed = vi.fn();
    state().fades.texture.addEventListener('dispose', disposed);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expect(disposed).toHaveBeenCalledOnce();
  });
});
