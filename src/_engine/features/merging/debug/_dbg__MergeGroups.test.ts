import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { getConfig } from '../../../kernel/config/Config';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../../kernel/init/Features';
import { createGeometry } from '../../../kernel/assets/Geometry';
import { createMaterial } from '../../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../../kernel/mesh/Mesh';
import { createRootScene } from '../../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  installMergeGroups,
  updateMergeMember,
} from '../MergeGroups';
import { beginMergeMemberEdit, endMergeMemberEdit } from '../MergeMemberEdit';
import {
  _checkMovedMergeMembers,
  _installMergeDebug,
  MOVE_CHECK_FRAMES,
} from './_dbg__MergeGroups';

const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../../utils/Logger'), async (importOriginal) => ({
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
  _installMergeDebug();
  createGeometry({
    id: 'mergeDebugBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeDebugMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  world.clearWorld();
  fns.lwarn.mockClear();
});

let seq = 0;
const createBox = (x: number) =>
  createMeshEntity({ geo: 'mergeDebugBox', mat: 'mergeDebugMat', position: { x, y: 0, z: 0 } });

/** A whole frame's stages: MAIN (object3DSyncSystem), the app loop, LATE_MAIN (the check). */
const runFrame = () => {
  world.updateMainLoop(0.016);
  world.updateAppLoop(0.016);
  world.updateLateMainLoop(0.016);
};

/** A built group of three boxes. */
const createGroupAsync = async () => {
  const groupId = `debugGroup${seq++}`;
  const members = [createBox(0), createBox(2), createBox(4)];
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, members };
};

describe('the moved-member check', () => {
  test('warns once about a member moved without updateMergeMember', async () => {
    const { groupId, members } = await createGroupAsync();
    // Out of the scene graph (p378): no render updates its world matrix, the check does
    expect(
      members.map((id) => world.getComponent(id, ComponentType.OBJECT3D)!.value.parent)
    ).toEqual([null, null, null]);
    expect(_checkMovedMergeMembers(world)).toEqual([]);

    // Moved and updated: no warning; moved only: one
    world.setTransform(members[0], { pos: { x: -1, y: 0, z: 0 } });
    updateMergeMember(members[0]);
    world.setTransform(members[2], { pos: { x: 6, y: 0, z: 0 } });
    // object3DSyncSystem's copy (MAIN), which the check reads
    runFrame();
    fns.lwarn.mockClear();
    expect(_checkMovedMergeMembers(world)).toEqual([members[2]]);
    expect(fns.lwarn).toHaveBeenCalledOnce();
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining(`"${groupId}"`));

    // Once per member
    world.setTransform(members[2], { pos: { x: 7, y: 0, z: 0 } });
    runFrame();
    expect(_checkMovedMergeMembers(world)).toEqual([]);
  });

  test('skips a member in an edit session: its end writes the range', async () => {
    const { members } = await createGroupAsync();
    beginMergeMemberEdit(members[1]);
    world.setTransform(members[1], { pos: { x: 3, y: 2, z: 0 } });
    runFrame();
    expect(_checkMovedMergeMembers(world)).toEqual([]);
    endMergeMemberEdit(members[1]);
    runFrame();
    expect(_checkMovedMergeMembers(world)).toEqual([]);
    expect(fns.lwarn).not.toHaveBeenCalled();
  });

  test('skips a member waiting for its build: the build reads its pose', () => {
    const member = createBox(0);
    addToMergeGroup(`debugGroup${seq++}`, [member]);
    world.setTransform(member, { pos: { x: 3, y: 0, z: 0 } });
    runFrame();
    expect(_checkMovedMergeMembers(world)).toEqual([]);
  });

  test(`runs every ${MOVE_CHECK_FRAMES} frames, in LATE_MAIN`, async () => {
    const { members } = await createGroupAsync();
    world.setTransform(members[1], { pos: { x: 3, y: 1, z: 0 } });
    expect(world.getSystemOrder('LATE_MAIN' as never)).toContainEqual(
      expect.objectContaining({ id: 'mergeMoveCheckSystem' })
    );
    /** The frames until the check warns (at most twice its interval). */
    const framesToWarning = () => {
      fns.lwarn.mockClear();
      for (let frame = 1; frame <= MOVE_CHECK_FRAMES * 2; frame++) {
        runFrame();
        if (fns.lwarn.mock.calls.length > 0) return frame;
      }
      return -1;
    };
    // The first check comes within an interval (earlier tests ran frames), the next one interval
    // after it
    const first = framesToWarning();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(MOVE_CHECK_FRAMES);
    world.setTransform(members[0], { pos: { x: -3, y: 1, z: 0 } });
    expect(framesToWarning()).toBe(MOVE_CHECK_FRAMES);
    expect(fns.lwarn).toHaveBeenCalledOnce();
  });
});
