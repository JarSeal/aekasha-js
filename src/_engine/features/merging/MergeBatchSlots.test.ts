import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { saveBufferGeometry } from '../../kernel/assets/Geometry';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene } from '../../kernel/scene/Scene';
import { getBatchState } from './MergeBatch';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
  updateMergeMember,
} from './MergeGroups';
import type { MergeGroupSettings } from './MergeTypes';
import { getGroups } from './MergeState';

// p375 Phase 3 S1 (docs/plans/_DONE_p375_batched-mesh-batches.md, D5): a batch's geometry slots. A
// geometry no instance uses frees its slot (the batch lets go of it), the next geometry that fits
// takes the best-fitting free slot (`setGeometryAt`) before a new one is added, `geometryReserve`
// sizes every slot alike so a FIFO pool's buffers stop growing, and `updateMergeMember` writes a
// batched member's geometry again (in its slot, a slot that fits, or its mesh's new geometry).
// The LOD levels' slots are MergeBatchLod.test.ts'.

const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  createMaterial({ id: 'slotTestMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  world.clearWorld();
  fns.lwarn.mockClear();
});

let seq = 0;

/** A registered plane of `segments` × 1 segments: (segments + 1) × 2 vertices, 6 × segments
 * indices, its x stretched by `width`. */
const createPlane = (segments: number, width = 1) => {
  const geometry = new THREE.PlaneGeometry(width, 1, segments, 1);
  return saveBufferGeometry(geometry, { id: `slotPlane${seq++}` });
};

const createMember = (geometry: THREE.BufferGeometry, x = 0) =>
  createMeshEntity({ geo: geometry, mat: 'slotTestMat', position: { x, y: 1, z: 0 } });

/** A batched group of `geometries`' members, built. */
const createBuiltGroupAsync = async (
  geometries: THREE.BufferGeometry[],
  settings: Omit<MergeGroupSettings, 'mode'> = {}
) => {
  const groupId = `slots${seq++}`;
  createMergeGroup({ id: groupId, mode: 'BATCHED', ...settings });
  const members = geometries.map((geometry, i) => createMember(geometry, i * 2));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, members };
};

const state = (groupId: string) => {
  const groupEntityId = getGroups(world).get(groupId)!;
  return getBatchState(world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!)!;
};

const getInstanceId = (entityId: number) =>
  world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId;

/** The slot an entity's instance draws. */
const slotOf = (groupId: string, entityId: number) =>
  state(groupId).geometryAt[getInstanceId(entityId)];

/** A slot's range in the batch. */
const rangeOf = (groupId: string, slot: number) => state(groupId).batch.getGeometryRangeAt(slot);

/** The batch's first vertex x of a slot. */
const firstXOf = (groupId: string, slot: number) => {
  const { batch } = state(groupId);
  return batch.geometry.getAttribute('position').getX(rangeOf(groupId, slot).vertexStart);
};

/** Deletes `entityId` and builds (its replacement, when given, joins first). */
const replaceAsync = async (groupId: string, entityId: number, next?: number) => {
  world.deleteEntity(entityId);
  if (next !== undefined) addToMergeGroup(groupId, [next]);
  await buildPendingMergeGroupsAsync();
};

describe('a freed slot', () => {
  test("a leaving member's own geometry frees its slot; a shared one stays while used", async () => {
    const shared = createPlane(2);
    const own = createPlane(3);
    const { groupId, members } = await createBuiltGroupAsync([shared, shared, own]);
    const ownSlot = slotOf(groupId, members[2]);

    removeFromMergeGroup([members[2]]);
    expect(state(groupId).geometryIds.has(own)).toBe(false);
    expect(state(groupId).freeSlots).toEqual([ownSlot]);

    removeFromMergeGroup([members[0]]);
    expect(state(groupId).geometryIds.has(shared)).toBe(true);
    expect(state(groupId).slotInstances[slotOf(groupId, members[1])]).toBe(1);
  });

  test('a geometry that fits takes it in place: its data written, the buffers unchanged', async () => {
    const { groupId, members } = await createBuiltGroupAsync([createPlane(4), createPlane(2)]);
    const slot = slotOf(groupId, members[0]);
    const { maxVertexCount, maxIndexCount } = state(groupId);
    const unused = state(groupId).batch.unusedVertexCount;

    const smaller = createPlane(3, 8);
    await replaceAsync(groupId, members[0], createMember(smaller));
    const next = getGroups(world).get(groupId)!;
    const member = world.getComponent(next, ComponentType.MERGE_GROUP)!.members[1];
    expect(slotOf(groupId, member)).toBe(slot);
    expect(state(groupId).freeSlots).toEqual([]);
    expect(rangeOf(groupId, slot).vertexCount).toBe(8);
    expect(rangeOf(groupId, slot).reservedVertexCount).toBe(10);
    expect(firstXOf(groupId, slot)).toBe(-4);
    expect([state(groupId).maxVertexCount, state(groupId).maxIndexCount]).toEqual([
      maxVertexCount,
      maxIndexCount,
    ]);
    expect(state(groupId).batch.unusedVertexCount).toBe(unused);
  });

  test('the best fit is taken (the fewest reserved vertices); none fits: a new slot', async () => {
    const { groupId, members } = await createBuiltGroupAsync([
      createPlane(8),
      createPlane(4),
      createPlane(6),
    ]);
    const slots = members.map((id) => slotOf(groupId, id));
    removeFromMergeGroup(members);
    // A member left: each geometry freed
    expect(state(groupId).freeSlots.sort()).toEqual([...slots].sort());

    const groupEntityId = getGroups(world).get(groupId)!;
    const three = createMember(createPlane(3));
    addToMergeGroup(groupId, [three]);
    await buildPendingMergeGroupsAsync();
    expect(slotOf(groupId, three)).toBe(slots[1]);

    const big = createMember(createPlane(12));
    addToMergeGroup(groupId, [big]);
    await buildPendingMergeGroupsAsync();
    expect(slots).not.toContain(slotOf(groupId, big));
    expect(world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!.members).toEqual([
      three,
      big,
    ]);
  });

  test('a full build lets go of the free slots', async () => {
    const { groupId, members } = await createBuiltGroupAsync([createPlane(2), createPlane(3)]);
    removeFromMergeGroup([members[0]]);
    expect(state(groupId).freeSlots).toHaveLength(1);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expect(state(groupId).freeSlots).toEqual([]);
    expect(state(groupId).geometryIds.size).toBe(1);
    expect(slotOf(groupId, members[1])).toBe(0);
  });

  test("a freed slot isn't drawn: three's merged draws are the live instances'", async () => {
    // Not culled: three's per-member culling would hide them from the default camera
    const { groupId, members } = await createBuiltGroupAsync([createPlane(2), createPlane(3)], {
      perMemberCulling: false,
    });
    removeFromMergeGroup([members[0]]);
    const { batch } = state(groupId);
    const camera = new THREE.PerspectiveCamera();
    const internal = batch as unknown as {
      _visibilityChanged: boolean;
      _mergedDrawCount: number;
      _updateDrawParameters(...args: unknown[]): void;
    };
    internal._visibilityChanged = true;
    internal._updateDrawParameters(camera, batch.geometry, batch.material, 'merged');
    expect(internal._mergedDrawCount).toBe(1);
  });
});

describe('a FIFO pool', () => {
  /** Churns a pool of `size` members: `rounds` times the oldest deleted and a new member of
   * `segments(round)` segments added. The buffers' sizes after each round. */
  const churnAsync = async (
    settings: Omit<MergeGroupSettings, 'mode'>,
    size: number,
    rounds: number,
    segments: (round: number) => number
  ) => {
    const { groupId, members } = await createBuiltGroupAsync(
      Array.from({ length: size }, (_, i) => createPlane(segments(i))),
      settings
    );
    const live = [...members];
    const sizes: number[] = [];
    for (let round = 0; round < rounds; round++) {
      const next = createMember(createPlane(segments(size + round)), round % 7);
      await replaceAsync(groupId, live.shift()!, next);
      live.push(next);
      sizes.push(state(groupId).maxVertexCount);
    }
    return { groupId, live, sizes };
  };

  test('with geometryReserve, slots are reused and the buffers never grow', async () => {
    const segments = (round: number) => 1 + ((round * 5) % 9);
    const { groupId, live, sizes } = await churnAsync(
      { geometryReserve: { vertices: 20, indices: 54 } },
      16,
      200,
      segments
    );
    expect(new Set(sizes).size).toBe(1);
    expect(state(groupId).geometryIds.size).toBe(16);
    expect(state(groupId).freeSlots).toEqual([]);
    // Every slot the reserve's size, each member drawing its own geometry
    for (const entityId of live) {
      const slot = slotOf(groupId, entityId);
      expect(rangeOf(groupId, slot).reservedVertexCount).toBe(20);
      const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;
      expect(state(groupId).slotGeometries[slot]).toBe(mesh.geometry);
      expect(rangeOf(groupId, slot).vertexCount).toBe(mesh.geometry.getAttribute('position').count);
    }
  });

  test('without it, geometries of one size reuse their slots too', async () => {
    const { groupId, sizes } = await churnAsync({}, 8, 100, () => 4);
    expect(new Set(sizes).size).toBe(1);
    expect(state(groupId).geometryIds.size).toBe(8);
  });

  test('a geometry past the reserve gets a slot of its own size', async () => {
    const { groupId, members } = await createBuiltGroupAsync([createPlane(2)], {
      geometryReserve: { vertices: 12 },
    });
    expect(rangeOf(groupId, slotOf(groupId, members[0])).reservedVertexCount).toBe(12);
    const big = createMember(createPlane(10));
    addToMergeGroup(groupId, [big]);
    await buildPendingMergeGroupsAsync();
    const range = rangeOf(groupId, slotOf(groupId, big));
    expect(range.reservedVertexCount).toBe(22);
    expect(range.reservedIndexCount).toBe(60);
  });
});

describe('updateMergeMember on a batched member', () => {
  test("rewrites its geometry's slot in place, every instance of it drawing the new data", async () => {
    const shared = createPlane(4);
    const { groupId, members } = await createBuiltGroupAsync([shared, shared], {
      geometryReserve: { vertices: 20, indices: 60 },
    });
    const slot = slotOf(groupId, members[0]);
    const radius = state(groupId).batch.boundingSphere!.radius;

    // Fewer vertices, and wider: its slot holds it
    const next = new THREE.PlaneGeometry(10, 1, 2, 1);
    shared.setAttribute('position', next.getAttribute('position'));
    shared.setAttribute('normal', next.getAttribute('normal'));
    shared.setAttribute('uv', next.getAttribute('uv'));
    shared.setIndex(next.getIndex());
    updateMergeMember(members[0]);

    expect(slotOf(groupId, members[1])).toBe(slot);
    expect(rangeOf(groupId, slot).vertexCount).toBe(6);
    expect(rangeOf(groupId, slot).indexCount).toBe(12);
    expect(firstXOf(groupId, slot)).toBe(-5);
    // Its bounds measured again: three's copy and the batch's sphere
    expect(state(groupId).batch.getBoundingSphereAt(slot, new THREE.Sphere())!.radius).toBeCloseTo(
      Math.hypot(5, 0.5)
    );
    expect(state(groupId).batch.boundingSphere!.radius).toBeGreaterThan(radius);
  });

  test('a geometry past its slot moves to one that fits, its instances with it', async () => {
    const shared = createPlane(2);
    const { groupId, members } = await createBuiltGroupAsync([shared, shared, createPlane(3)]);
    const slot = slotOf(groupId, members[0]);

    const next = new THREE.PlaneGeometry(1, 1, 6, 1);
    for (const name of ['position', 'normal', 'uv'])
      shared.setAttribute(name, next.getAttribute(name));
    shared.setIndex(next.getIndex());
    updateMergeMember(members[1]);

    const moved = slotOf(groupId, members[0]);
    expect(moved).not.toBe(slot);
    expect(slotOf(groupId, members[1])).toBe(moved);
    expect(rangeOf(groupId, moved).vertexCount).toBe(14);
    expect(state(groupId).freeSlots).toEqual([slot]);
    expect(state(groupId).slotInstances[moved]).toBe(2);
    expect(state(groupId).geometryIds.get(shared)).toBe(moved);
  });

  test('a mesh given another geometry: its instance takes it, the old slot freed', async () => {
    const old = createPlane(2);
    const { groupId, members } = await createBuiltGroupAsync([old, createPlane(3)]);
    const slot = slotOf(groupId, members[0]);
    const mesh = world.getComponent(members[0], ComponentType.OBJECT3D)!.value as THREE.Mesh;
    const replacement = createPlane(5);
    mesh.geometry = replacement;
    updateMergeMember(members[0]);

    const next = slotOf(groupId, members[0]);
    expect(state(groupId).slotGeometries[next]).toBe(replacement);
    expect(state(groupId).geometryIds.has(old)).toBe(false);
    expect(state(groupId).freeSlots).toEqual([slot]);
  });

  test('does nothing for a member waiting for its build, and warns for a non-member', async () => {
    const { groupId } = await createBuiltGroupAsync([createPlane(2)]);
    const waiting = createMember(createPlane(2));
    addToMergeGroup(groupId, [waiting]);
    updateMergeMember(waiting);
    expect(getInstanceId(waiting)).toBe(-1);
    updateMergeMember(createMember(createPlane(1)));
    expect(fns.lwarn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("isn't in a merge group"),
    ]);
  });
});

describe('geometryReserve', () => {
  test("createMergeGroup throws without BATCHED, or for counts that aren't positive integers", () => {
    const reserve = { vertices: 8 };
    expect(() => createMergeGroup({ id: 'reserveBaked', geometryReserve: reserve })).toThrow(
      "geometryReserve is a BATCHED group's setting"
    );
    for (const geometryReserve of [
      { vertices: 0 },
      { vertices: 1.5 },
      { vertices: 4, indices: -1 },
    ]) {
      expect(() =>
        createMergeGroup({ id: `reserve${seq++}`, mode: 'BATCHED', geometryReserve })
      ).toThrow('positive integers');
    }
    expect(() =>
      createMergeGroup({ id: 'reserveOk', mode: 'BATCHED', geometryReserve: reserve })
    ).not.toThrow();
  });
});
