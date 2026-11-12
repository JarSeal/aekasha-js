import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

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
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene } from '../../kernel/scene/Scene';
import { getBatchState } from './MergeBatch';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
} from './MergeGroups';
import { setMergeMemberColor } from './MergeMemberColor';
import { getGroups } from './MergeState';

// p375 Phase 3 S3 (docs/plans/_DONE_p375_batched-mesh-batches.md): a batched member's colour and opacity,
// its instance's colour in the batch. Written only on a change; a member waiting for its build
// gets it at the build; it follows the member through a compaction, a rebuild and the batch's
// growth; a new instance in a freed id is white and opaque (three resets only the RGB); the batch's
// first colour rebuilds its shader. A level fade's outgoing instance: MergeBatchLod.test.ts.

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'tintBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  saveBufferGeometry(new THREE.BoxGeometry(0.5, 0.5, 0.5), {
    id: 'tintBoxSmall',
    isPersistent: true,
  });
  createMaterial({ id: 'tintMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  world.clearWorld();
  fns.lwarn.mockClear();
});

let seq = 0;

const createMember = (x = 0, geo = 'tintBox') =>
  createMeshEntity({ geo, mat: 'tintMat', position: { x, y: 1, z: 0 } });

/** A batched group of `count` members (`geo(i)`'s geometry each), built. */
const createBuiltGroupAsync = async (
  count: number,
  geo: (i: number) => string = () => 'tintBox'
) => {
  const groupId = `tint${seq++}`;
  createMergeGroup({ id: groupId, mode: 'BATCHED' });
  const members = Array.from({ length: count }, (_, i) => createMember(i * 2, geo(i)));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  const groupEntityId = getGroups(world).get(groupId)!;
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
  return { groupId, members, state: () => getBatchState(group)! };
};

const getInstanceId = (entityId: number) =>
  world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId;

/** The entity's instance colour, rounded, as [r, g, b, a]. */
const colorOf = (batch: THREE.BatchedMesh, entityId: number) =>
  batch
    .getColorAt(getInstanceId(entityId), new THREE.Vector4())
    .toArray()
    .map((value) => Math.round(value * 100) / 100);

const RED = new THREE.Color(1, 0, 0);
const WHITE = [1, 1, 1, 1];

describe('setMergeMemberColor', () => {
  test("sets its instance's colour and opacity; one left out keeps the member's", async () => {
    const { members, state } = await createBuiltGroupAsync(2);
    setMergeMemberColor(members[0], { color: RED, opacity: 0.5 });
    expect(colorOf(state().batch, members[0])).toEqual([1, 0, 0, 0.5]);
    expect(colorOf(state().batch, members[1])).toEqual(WHITE);

    setMergeMemberColor(members[0], { opacity: 0.25 });
    expect(colorOf(state().batch, members[0])).toEqual([1, 0, 0, 0.25]);
    setMergeMemberColor(members[0], { color: 0xffffff });
    expect(colorOf(state().batch, members[0])).toEqual([1, 1, 1, 0.25]);
  });

  test('writes only on a change, and the first colour rebuilds the batch shader', async () => {
    const { members, state } = await createBuiltGroupAsync(1);
    const { batch } = state();
    const material = batch.material as THREE.Material;
    const writes = vi.spyOn(batch, 'setColorAt');
    // White and opaque: what it draws already, no colours made
    setMergeMemberColor(members[0], { color: 0xffffff, opacity: 1 });
    expect(writes).not.toHaveBeenCalled();

    const version = material.version;
    setMergeMemberColor(members[0], { opacity: 0.5 });
    expect(material.version).toBe(version + 1);
    setMergeMemberColor(members[0], { opacity: 0.5 });
    setMergeMemberColor(members[0], { opacity: 0.4 });
    expect(writes).toHaveBeenCalledTimes(2);
    expect(material.version).toBe(version + 1);
  });

  test('a member waiting for its build gets it at the build', async () => {
    const { groupId, state } = await createBuiltGroupAsync(1);
    const late = createMember(4);
    addToMergeGroup(groupId, [late]);
    setMergeMemberColor(late, { color: RED });
    await buildPendingMergeGroupsAsync();
    expect(colorOf(state().batch, late)).toEqual([1, 0, 0, 1]);
  });

  test("a newcomer in a faded-out member's freed id is white and opaque", async () => {
    const { groupId, members, state } = await createBuiltGroupAsync(2);
    setMergeMemberColor(members[0], { color: RED, opacity: 0 });
    const freed = getInstanceId(members[0]);
    world.deleteEntity(members[0]);
    const next = createMember(6);
    addToMergeGroup(groupId, [next]);
    await buildPendingMergeGroupsAsync();
    expect(getInstanceId(next)).toBe(freed);
    expect(colorOf(state().batch, next)).toEqual(WHITE);
  });

  test('follows its member through a compaction, a rebuild and the batch growing', async () => {
    // Alternating geometries, grouped: boxes 0-3, small boxes 4-7
    const { groupId, members, state } = await createBuiltGroupAsync(8, (i) =>
      i % 2 ? 'tintBoxSmall' : 'tintBox'
    );
    const tints = members.map((_, i) => new THREE.Color(i / 8, 0, 1 - i / 8));
    members.forEach((entityId, i) =>
      setMergeMemberColor(entityId, { color: tints[i], opacity: i / 8 })
    );
    const expected = (entityId: number) => {
      const i = members.indexOf(entityId);
      return [tints[i].r, 0, tints[i].b, i / 8].map((value) => Math.round(value * 100) / 100);
    };

    // Small boxes into the boxes' freed ids 0 and 2: 5 runs of 2 geometries, compacted
    world.deleteEntity(members[0]);
    world.deleteEntity(members[4]);
    const live = members.filter((_, i) => i !== 0 && i !== 4);
    addToMergeGroup(groupId, [createMember(20, 'tintBoxSmall'), createMember(22, 'tintBoxSmall')]);
    await buildPendingMergeGroupsAsync();
    world.updateMainLoop(0.016);
    world.updateAppLoop(0.016);
    expect(state().compactions).toBe(1);
    for (const entityId of live)
      expect(colorOf(state().batch, entityId)).toEqual(expected(entityId));

    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    for (const entityId of live)
      expect(colorOf(state().batch, entityId)).toEqual(expected(entityId));

    const capacity = state().batch.maxInstanceCount;
    const more = Array.from({ length: capacity }, (_, i) => createMember(30 + i));
    addToMergeGroup(groupId, more);
    await buildPendingMergeGroupsAsync();
    expect(state().batch.maxInstanceCount).toBeGreaterThan(capacity);
    for (const entityId of live)
      expect(colorOf(state().batch, entityId)).toEqual(expected(entityId));
    expect(colorOf(state().batch, more[0])).toEqual(WHITE);
  });

  test('warns for a baked member and an entity in no group', async () => {
    createMergeGroup({ id: 'tintBaked' });
    const baked = createMember();
    addToMergeGroup('tintBaked', [baked]);
    setMergeMemberColor(baked, { color: RED });
    setMergeMemberColor(createMember(), { opacity: 0 });
    expect(fns.lwarn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("isn't in a BATCHED merge group"),
      expect.stringContaining("isn't in a BATCHED merge group"),
    ]);
  });
});
