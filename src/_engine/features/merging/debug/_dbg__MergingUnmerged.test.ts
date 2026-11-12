import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { getConfig, initEnvironment } from '../../../kernel/config/Config';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../../kernel/init/Features';
import { createGeometry } from '../../../kernel/assets/Geometry';
import { createMaterial } from '../../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../../kernel/mesh/Mesh';
import { createRootScene, getRootScene, runOnAllSceneExits } from '../../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  dissolveMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
  removeFromMergeGroup,
} from '../MergeGroups';
import { beginMergeMemberEdit, endMergeMemberEdit } from '../MergeMemberEdit';
import { getGroupMesh, getGroups } from '../MergeState';
import { formatMergeSummary, getMergeGroupListData } from './_dbg__Merging';
import { getMergeSummary } from './_dbg__MergingInfo';
import {
  getUnmergedViewCount,
  getUnmergedViewRefusal,
  isMergeGroupUnmergedView,
  setMergeGroupUnmergedView,
} from './_dbg__MergingUnmerged';
import { getGroupStateText, getMemberStateText } from './_dbg__MergingWindows';

// p373 D3: a group shown unmerged, the Merging tab's A/B

let world: ECSWorld;
beforeAll(() => {
  // applyBuild reads the view in the debug env only
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'mergeAbBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeAbMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  // Ends every view
  runOnAllSceneExits();
  world.clearWorld();
});

let seq = 0;
const createBox = (x: number) => {
  const entityId = createMeshEntity({
    geo: 'mergeAbBox',
    mat: 'mergeAbMat',
    position: { x, y: 0, z: 0 },
  });
  // In the DEFAULT spatial domain, as a mesh is with spatial(): merging takes it out
  world.addComponent(entityId, ComponentType.SPATIAL_INDEXED, true);
  return entityId;
};

/** A built group of three boxes. */
const createGroupAsync = async () => {
  const groupId = `abGroup${seq++}`;
  const members = [createBox(0), createBox(2), createBox(4)];
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, members, groupEntityId: getGroups(world).get(groupId)! };
};

const isVisible = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value.visible;
/** Its own mesh under the root scene (out of the scene graph while its group draws it, p378) */
const isInScene = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value.parent === getRootScene();

describe('show unmerged', () => {
  test('hides the group mesh and draws the members, still in their group, and back', async () => {
    const { members, groupEntityId } = await createGroupAsync();
    const parts = members.map(
      (id) => world.getComponent(id, ComponentType.MERGE_MEMBER)!.partIndex
    );
    expect(members.some(isInScene)).toBe(false);
    expect(setMergeGroupUnmergedView(groupEntityId, true)).toBe(true);
    expect(isMergeGroupUnmergedView(groupEntityId)).toBe(true);
    expect(getGroupMesh(groupEntityId, world)!.visible).toBe(false);
    expect(members.every(isVisible)).toBe(true);
    expect(members.every(isInScene)).toBe(true);
    expect(members.some((id) => world.hasComponent(id, ComponentType.TAG_MERGED))).toBe(false);
    expect(
      members.map((id) => world.getComponent(id, ComponentType.MERGE_MEMBER)!.partIndex)
    ).toEqual(parts);
    // The draws: the group's one gone, the members' three drawn
    expect(getMergeSummary(world)).toMatchObject({ drawnGroups: 0, drawsNow: 3, drawsUnmerged: 3 });
    expect(getGroupStateText(groupEntityId, world)).toBe(
      'shown unmerged: its members are drawn on their own'
    );
    expect(getMemberStateText(members[0], world)).toBe('merged, drawn on its own (shown unmerged)');

    expect(setMergeGroupUnmergedView(groupEntityId, false)).toBe(false);
    expect(getGroupMesh(groupEntityId, world)!.visible).toBe(true);
    expect(members.some(isVisible)).toBe(false);
    expect(members.some(isInScene)).toBe(false);
    expect(world.hasComponent(groupEntityId, ComponentType.TAG_DRAW_HELD)).toBe(false);
    expect(getMergeSummary(world)).toMatchObject({ drawnGroups: 1, drawsNow: 1, drawsUnmerged: 3 });
  });

  test('a build during the view leaves the members drawn and their spatial membership kept', async () => {
    const { groupId, members, groupEntityId } = await createGroupAsync();
    const wasIndexed = members.map(
      (id) => world.getComponent(id, ComponentType.MERGE_MEMBER)!._wasSpatialIndexed
    );
    expect(wasIndexed).toEqual([true, true, true]);
    setMergeGroupUnmergedView(groupEntityId, true);
    const joined = createBox(6);
    addToMergeGroup(groupId, [joined]);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();

    const all = [...members, joined];
    expect(
      all.every((id) => world.getComponent(id, ComponentType.MERGE_MEMBER)!.partIndex >= 0)
    ).toBe(true);
    expect(all.every(isVisible)).toBe(true);
    expect(all.every(isInScene)).toBe(true);
    expect(getGroupMesh(groupEntityId, world)!.visible).toBe(false);
    expect(
      members.map((id) => world.getComponent(id, ComponentType.MERGE_MEMBER)!._wasSpatialIndexed)
    ).toEqual(wasIndexed);

    setMergeGroupUnmergedView(groupEntityId, false);
    expect(all.every((id) => world.hasComponent(id, ComponentType.TAG_MERGED))).toBe(true);
    expect(all.some(isInScene)).toBe(false);
    // Let go, a member gets its spatial membership back
    removeFromMergeGroup([members[0]]);
    expect(world.hasComponent(members[0], ComponentType.SPATIAL_INDEXED)).toBe(true);
  });

  test('a disabled member stays hidden, and a hold made elsewhere stays', async () => {
    const { members, groupEntityId } = await createGroupAsync();
    world.setDisabled(members[1], true);
    world.addComponent(groupEntityId, ComponentType.TAG_DRAW_HELD, true);
    setMergeGroupUnmergedView(groupEntityId, true);
    expect(isVisible(members[1])).toBe(false);
    expect(isVisible(members[0])).toBe(true);
    setMergeGroupUnmergedView(groupEntityId, false);
    expect(world.hasComponent(groupEntityId, ComponentType.TAG_DRAW_HELD)).toBe(true);
  });

  test("an edit session's member stays drawn on its own past the view's end, and its end keeps the view", async () => {
    const { members, groupEntityId } = await createGroupAsync();
    setMergeGroupUnmergedView(groupEntityId, true);
    beginMergeMemberEdit(members[0]);
    setMergeGroupUnmergedView(groupEntityId, false);
    expect(isVisible(members[0])).toBe(true);
    expect(isVisible(members[1])).toBe(false);
    endMergeMemberEdit(members[0]);
    expect(isVisible(members[0])).toBe(false);

    // Ended while the group is shown unmerged: drawn on its own with the others
    setMergeGroupUnmergedView(groupEntityId, true);
    beginMergeMemberEdit(members[1]);
    endMergeMemberEdit(members[1]);
    expect(members.every(isVisible)).toBe(true);
    expect(world.hasComponent(members[1], ComponentType.TAG_MERGED)).toBe(false);
  });

  test('refuses a group not built yet', () => {
    const groupId = `abGroup${seq++}`;
    addToMergeGroup(groupId, [createBox(0)]);
    const groupEntityId = getGroups(world).get(groupId)!;
    expect(getUnmergedViewRefusal(groupEntityId, world)).toBe('The group isn’t built yet.');
    expect(setMergeGroupUnmergedView(groupEntityId, true)).toBe(false);
    expect(getMergeGroupListData(world)[0].toggleValues).toEqual([false, null]);
  });

  test('a dissolve ends the view; its members are drawn on their own', async () => {
    const { groupId, members, groupEntityId } = await createGroupAsync();
    setMergeGroupUnmergedView(groupEntityId, true);
    expect(formatMergeSummary(world, { builds: 0, updates: 0 }).groups).toBe(
      '1 (0 drawn, 0 pending, 1 shown unmerged)'
    );
    dissolveMergeGroup(groupId);
    expect(getUnmergedViewCount()).toBe(0);
    expect(members.every(isVisible)).toBe(true);
    expect(setMergeGroupUnmergedView(groupEntityId, false)).toBe(false);
  });

  test('a scene exit ends every view', async () => {
    const { members, groupEntityId } = await createGroupAsync();
    setMergeGroupUnmergedView(groupEntityId, true);
    expect(getMergeGroupListData(world)[0].toggleValues).toEqual([false, true]);
    runOnAllSceneExits();
    expect(isMergeGroupUnmergedView(groupEntityId)).toBe(false);
    expect(members.every((id) => world.hasComponent(id, ComponentType.TAG_MERGED))).toBe(true);
    expect(getGroupMesh(groupEntityId, world)!.visible).toBe(true);
  });
});
