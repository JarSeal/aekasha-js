import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// A renderer for the WebGL2 test (none: a batch is drawn as on WebGPU)
const loop = vi.hoisted(() => ({ renderer: null as unknown }));
vi.mock(import('../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: () => loop.renderer as never,
}));

const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry, saveBufferGeometry } from '../../kernel/assets/Geometry';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes, type MeshProps } from '../../kernel/mesh/Mesh';
import { createRootScene } from '../../kernel/scene/Scene';
import { getBatchState, noteBatchLodMember } from './MergeBatch';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
  updateMergeMember,
} from './MergeGroups';
import type { MergeTransparentOrder } from './MergeTypes';
import { getGroups } from './MergeState';

// p375 Phase 3 S2 (docs/plans/p375_batched-mesh-batches.md): transparent batched groups. A BAKED
// group still refuses a transparent material; a BATCHED one takes it and sorts its batch every
// pass on both backends, never compacting: `DEPTH` (three's back-to-front sort) or `JOIN` (the
// members' join order, the newest last: decals). A batch is drawn at its members' renderOrder,
// and a member of another is refused.

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'glassBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  saveBufferGeometry(new THREE.PlaneGeometry(1, 1), { id: 'glassPlane', isPersistent: true });
  createMaterial({
    id: 'glassMat',
    type: 'BASIC',
    params: { transparent: true, opacity: 0.5, depthWrite: false },
    isPersistent: true,
  });
  createMaterial({ id: 'opaqueMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  loop.renderer = null;
  world.clearWorld();
  fns.lwarn.mockClear();
});

let seq = 0;

const warnings = () => fns.lwarn.mock.calls.map((call) => String(call[0]));

/** A transparent member at z (the camera looks down -z from z 20). */
const createGlass = (geo: string, z: number, props: Partial<MeshProps> = {}) =>
  createMeshEntity({ geo, mat: 'glassMat', position: { x: 0, y: 0, z }, ...props });

/** A BATCHED group of `members` (culled as a whole only, so every instance is in the list),
 * built. */
const createBuiltGroupAsync = async (
  members: number[],
  transparentOrder?: MergeTransparentOrder
) => {
  const groupId = `glass${seq++}`;
  createMergeGroup({ id: groupId, mode: 'BATCHED', perMemberCulling: false, transparentOrder });
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  const groupEntityId = getGroups(world).get(groupId)!;
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
  return { groupId, groupEntityId, state: () => getBatchState(group)! };
};

const getInstanceId = (entityId: number) =>
  world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId;

/** The instance ids in the order three draws them this pass (its multi-draw list's indirect
 * ids), seen from z 20. */
const getDrawOrder = (batch: THREE.BatchedMesh) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 20);
  camera.updateMatrixWorld();
  batch.updateMatrixWorld();
  const internals = batch as unknown as {
    _visibilityChanged: boolean;
    _indirectTexture: THREE.DataTexture;
    _updateDrawParameters: (...args: unknown[]) => void;
  };
  internals._visibilityChanged = true;
  internals._updateDrawParameters(camera, batch.geometry, batch.material, 'multiDraw');
  return Array.from(
    (internals._indirectTexture.image.data as Uint32Array).slice(0, batch.instanceCount)
  );
};

describe('a transparent member', () => {
  test('a BAKED group refuses it, naming BATCHED; a BATCHED one takes it', async () => {
    createMergeGroup({ id: 'glassBaked' });
    const baked = createGlass('glassBox', 0);
    addToMergeGroup('glassBaked', [baked]);
    expect(warnings()).toEqual([
      expect.stringMatching(/transparent.*a BATCHED group sorts its members/),
    ]);
    expect(world.hasComponent(baked, ComponentType.MERGE_MEMBER)).toBe(false);

    const glass = [createGlass('glassBox', 0), createGlass('glassPlane', -2)];
    const { state } = await createBuiltGroupAsync(glass);
    expect(glass.map(getInstanceId)).toEqual([0, 1]);
    expect(state().batch.material.transparent).toBe(true);
  });
});

describe("a transparent batch's order", () => {
  test('DEPTH by default: three sorts back to front each pass', async () => {
    const members = [
      createGlass('glassBox', 0),
      createGlass('glassPlane', -6),
      createGlass('glassBox', -3),
    ];
    const { state } = await createBuiltGroupAsync(members);
    expect(state().order).toBe('DEPTH');
    expect(state().batch.sortObjects).toBe(true);
    expect(state().batch.customSort).toBeNull();
    // Ids grouped by geometry (0: z 0, 1: z -3, 2: z -6); drawn farthest first
    expect(getDrawOrder(state().batch)).toEqual(
      [members[1], members[2], members[0]].map(getInstanceId)
    );
  });

  test('JOIN draws in the order the members joined, a later one on top of a freed id', async () => {
    const members = [
      createGlass('glassBox', 0),
      createGlass('glassPlane', -6),
      createGlass('glassBox', -3),
    ];
    const { groupId, state } = await createBuiltGroupAsync(members, 'JOIN');
    expect(state().order).toBe('JOIN');
    // Grouped by geometry, the ids aren't the join order: box 0, box 1, plane 2
    expect(members.map(getInstanceId)).toEqual([0, 2, 1]);
    expect(getDrawOrder(state().batch)).toEqual([0, 2, 1]);

    // The first goes; a newcomer takes its id (0) and is drawn last
    world.deleteEntity(members[0]);
    const late = createGlass('glassPlane', 4);
    addToMergeGroup(groupId, [late]);
    await buildPendingMergeGroupsAsync();
    expect(getInstanceId(late)).toBe(0);
    expect(getDrawOrder(state().batch)).toEqual([2, 1, 0]);

    // A rebuild groups the ids by geometry again, and keeps the order
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    const order = [members[1], members[2], late].map(getInstanceId);
    expect(order).not.toEqual([0, 1, 2]);
    expect(getDrawOrder(state().batch)).toEqual(order);
  });

  test('JOIN draws a member updateMergeMember rewrote last, as a newcomer (a FIFO pool)', async () => {
    // A geometry each, as a decal pool's patches
    const geometries = [0, 1, 2].map((i) => saveBufferGeometry(new THREE.PlaneGeometry(1, 1 + i)));
    const members = geometries.map((geo, i) => createGlass('', -i, { geo }));
    const { state } = await createBuiltGroupAsync(members, 'JOIN');
    const ids = members.map(getInstanceId);
    expect(getDrawOrder(state().batch)).toEqual(ids);

    // The oldest is respawned in place: its patch rewritten, its slot kept, drawn on top
    const position = geometries[0].getAttribute('position') as THREE.BufferAttribute;
    position.setY(0, position.getY(0) + 0.25);
    updateMergeMember(members[0]);
    expect(getInstanceId(members[0])).toBe(ids[0]);
    expect(getDrawOrder(state().batch)).toEqual([ids[1], ids[2], ids[0]]);
    updateMergeMember(members[1]);
    expect(getDrawOrder(state().batch)).toEqual([ids[2], ids[0], ids[1]]);
  });

  test("sorted on WebGL2 too, never compacted, and a member's LOD doesn't change it", async () => {
    loop.renderer = { backend: { isWebGPUBackend: false } };
    // Boxes 0-3, planes 4-7 (grouped by geometry)
    const members = Array.from({ length: 8 }, (_, i) =>
      createGlass(i % 2 ? 'glassPlane' : 'glassBox', -i)
    );
    const { groupId, state } = await createBuiltGroupAsync(members, 'JOIN');
    expect([state().order, state().batch.sortObjects]).toEqual(['JOIN', true]);

    // Planes into the boxes' freed ids 0 and 2: plane, box, plane, box, planes (5 runs, past
    // twice the 2 geometries, which compacts an opaque WebGPU batch)
    loop.renderer = { backend: { isWebGPUBackend: true } };
    world.deleteEntity(members[0]);
    world.deleteEntity(members[4]);
    addToMergeGroup(groupId, [createGlass('glassPlane', 1), createGlass('glassPlane', 2)]);
    await buildPendingMergeGroupsAsync();
    world.updateMainLoop(0.016);
    world.updateAppLoop(0.016);
    expect(state().runs).toBeGreaterThan(4);
    expect(state().compactions).toBe(0);

    noteBatchLodMember(state());
    expect(state().order).toBe('JOIN');
  });

  test('an opaque batch keeps its order: COMPACT on WebGPU, NONE on WebGL2', async () => {
    const opaque = () => createMeshEntity({ geo: 'glassBox', mat: 'opaqueMat' });
    const { state } = await createBuiltGroupAsync([opaque()], 'JOIN');
    expect([state().order, state().batch.sortObjects]).toEqual(['COMPACT', false]);
    loop.renderer = { backend: { isWebGPUBackend: false } };
    const { state: webgl } = await createBuiltGroupAsync([opaque()]);
    expect(webgl().order).toBe('NONE');
  });
});

describe('renderOrder', () => {
  test("the batch takes its members'; a member of another is refused", async () => {
    const first = createGlass('glassBox', 0, { castShadow: false });
    const mesh = world.getComponent(first, ComponentType.OBJECT3D)!.value as THREE.Mesh;
    mesh.renderOrder = 10;
    const { groupId, state } = await createBuiltGroupAsync([first], 'JOIN');
    expect(state().batch.renderOrder).toBe(10);

    const other = createGlass('glassBox', -1);
    addToMergeGroup(groupId, [other]);
    expect(warnings()).toEqual([expect.stringContaining("its renderOrder isn't the group's")]);
    expect(world.hasComponent(other, ComponentType.MERGE_MEMBER)).toBe(false);
  });
});

describe('transparentOrder', () => {
  test('createMergeGroup throws without BATCHED, or for another value', () => {
    expect(() => createMergeGroup({ id: 'orderBaked', transparentOrder: 'JOIN' })).toThrow(
      "transparentOrder is a BATCHED group's setting"
    );
    expect(() =>
      createMergeGroup({
        id: 'orderOther',
        mode: 'BATCHED',
        transparentOrder: 'SPAWN' as MergeTransparentOrder,
      })
    ).toThrow('DEPTH or JOIN');
  });
});
