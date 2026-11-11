import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

// Whether lines() is installed, as the overlay asks it
const lines = vi.hoisted(() => ({ isInstalled: true }));
vi.mock(import('../../lines/Lines'), async (importOriginal) => ({
  ...(await importOriginal()),
  isLinesInstalledFor: () => lines.isInstalled,
}));

import * as THREE from 'three/webgpu';
import { getConfig, initEnvironment } from '../../../kernel/config/Config';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../../kernel/init/Features';
import { createGeometry } from '../../../kernel/assets/Geometry';
import { createMaterial } from '../../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../../kernel/mesh/Mesh';
import { createRootScene, runOnAllSceneExits } from '../../../kernel/scene/Scene';
import { BOX_EDGE_SEGMENT_COUNT } from '../../lines/LineBuilders';
import { getLine, installLines } from '../../lines/Lines';
import { createArrayWriteTarget, FLOATS_PER_SEGMENT, LineWriter } from '../../lines/LineWriter';
import { addToMergeGroup, buildPendingMergeGroupsAsync, installMergeGroups } from '../MergeGroups';
import { getGroups } from '../MergeState';
import { getMergeGroupListData, getMergeOverlayNote } from './_dbg__Merging';
import {
  getMergeGroupColorIndex,
  getMergeOverlayCounts,
  isMergeGroupHighlighted,
  isMergeHighlightAll,
  MAX_BOXES_PER_COLOR,
  MERGE_OVERLAY_COLORS,
  setMergeGroupHighlighted,
  setMergeHighlightAll,
  writeMergeOverlayBoxes,
} from './_dbg__MergingOverlay';

// p373 D3: the members' boxes of the highlighted groups, one line per colour

let world: ECSWorld;
beforeAll(() => {
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installLines(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'mergeOverlayBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeOverlayMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  setMergeHighlightAll(false);
  // Ends every highlight by id
  runOnAllSceneExits();
  world.clearWorld();
  lines.isInstalled = true;
});

let seq = 0;
const createBox = (
  x: number,
  pose: { rotation?: { y: number }; scale?: { x: number; y: number; z: number } } = {}
) => {
  const entityId = createMeshEntity({
    geo: 'mergeOverlayBox',
    mat: 'mergeOverlayMat',
    position: { x, y: 0, z: 0 },
    ...pose,
  });
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value.updateWorldMatrix(true, false);
  return entityId;
};

/** A built group of boxes at the given x. */
const createGroupAsync = async (xs = [0, 2, 4]) => {
  const groupId = `overlayGroup${seq++}`;
  const members = xs.map((x) => createBox(x));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, members };
};

/** A writer per colour, each as large as its line. */
const createWriters = () =>
  MERGE_OVERLAY_COLORS.map(
    () => new LineWriter(createArrayWriteTarget(MAX_BOXES_PER_COLOR * BOX_EDGE_SEGMENT_COUNT))
  );

/** A writer's points' bounds. */
const getWrittenBounds = (writer: LineWriter) => {
  const positions = (writer as unknown as { target: { positions: Float32Array } }).target.positions;
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < writer.segmentCount * FLOATS_PER_SEGMENT; i += 3) {
    box.expandByPoint(point.fromArray(positions, i));
  }
  return box;
};

const expectBox = (box: THREE.Box3, min: number[], max: number[]) => {
  box.min.toArray().forEach((v, i) => expect(v).toBeCloseTo(min[i], 5));
  box.max.toArray().forEach((v, i) => expect(v).toBeCloseTo(max[i], 5));
};

describe('the boxes', () => {
  test("outline a highlighted group's members in its colour only", async () => {
    const { groupId } = await createGroupAsync();
    const other = await createGroupAsync([10]);
    setMergeGroupHighlighted(groupId, true);
    const writers = createWriters();
    writeMergeOverlayBoxes(world, null, writers);

    const color = getMergeGroupColorIndex(groupId);
    expect(writers[color].segmentCount).toBe(3 * BOX_EDGE_SEGMENT_COUNT);
    expectBox(getWrittenBounds(writers[color]), [-0.5, -0.5, -0.5], [4.5, 0.5, 0.5]);
    const otherCount = writers.reduce((sum, w, i) => sum + (i === color ? 0 : w.segmentCount), 0);
    expect(otherCount).toBe(0);
    expect(isMergeGroupHighlighted(other.groupId)).toBe(false);
    expect(getMergeOverlayCounts()).toEqual({ drawn: 3, skipped: 0 });
  });

  test('a colour is the same for an id every time, and one of the palette', () => {
    const index = getMergeGroupColorIndex('ruins');
    expect(getMergeGroupColorIndex('ruins')).toBe(index);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(MERGE_OVERLAY_COLORS.length);
  });

  test('a built member is outlined where it was merged, a waiting one where it is', async () => {
    const { groupId, members } = await createGroupAsync([0]);
    // Moved without updateMergeMember: the group still draws it at 0
    world.setTransform(members[0], { pos: { x: 5, y: 0, z: 0 } });
    world.getComponent(members[0], ComponentType.OBJECT3D)!.value.position.set(5, 0, 0);
    const waiting = createBox(-3);
    addToMergeGroup(groupId, [waiting]);
    setMergeGroupHighlighted(groupId, true);
    const writers = createWriters();
    writeMergeOverlayBoxes(world, null, writers);
    expectBox(
      getWrittenBounds(writers[getMergeGroupColorIndex(groupId)]),
      [-3.5, -0.5, -0.5],
      [0.5, 0.5, 0.5]
    );
  });

  test("follows a member's rotation and scale", async () => {
    const groupId = `overlayGroup${seq++}`;
    const member = createBox(0, { rotation: { y: Math.PI / 2 }, scale: { x: 2, y: 1, z: 1 } });
    addToMergeGroup(groupId, [member]);
    await buildPendingMergeGroupsAsync();
    setMergeGroupHighlighted(groupId, true);
    const writers = createWriters();
    writeMergeOverlayBoxes(world, null, writers);
    // 2 m along its own x, which the turn puts along z
    expectBox(
      getWrittenBounds(writers[getMergeGroupColorIndex(groupId)]),
      [-0.5, -0.5, -1],
      [0.5, 0.5, 1]
    );
  });

  test('skips the groups and members outside the frustum, and the disabled members', async () => {
    const { groupId, members } = await createGroupAsync();
    setMergeGroupHighlighted(groupId, true);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const frustum = new THREE.Frustum();
    const look = (x: number, z: number) => {
      camera.position.set(0, 0, 10);
      camera.lookAt(x, 0, z);
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      );
    };
    const color = getMergeGroupColorIndex(groupId);

    look(0, 20); // away from the group
    let writers = createWriters();
    writeMergeOverlayBoxes(world, frustum, writers);
    expect(writers[color].segmentCount).toBe(0);

    look(0, 0);
    world.setDisabled(members[1], true);
    writers = createWriters();
    writeMergeOverlayBoxes(world, frustum, writers);
    expect(writers[color].segmentCount).toBe(2 * BOX_EDGE_SEGMENT_COUNT);
  });

  test("counts the boxes over a colour's cap and doesn't write them", async () => {
    const groupId = `overlayGroup${seq++}`;
    const members = Array.from({ length: MAX_BOXES_PER_COLOR + 3 }, (_, i) => createBox(i));
    // Waiting members are outlined too: no build needed
    addToMergeGroup(groupId, members);
    setMergeGroupHighlighted(groupId, true);
    const writers = createWriters();
    writeMergeOverlayBoxes(world, null, writers);
    expect(writers[getMergeGroupColorIndex(groupId)].segmentCount).toBe(
      MAX_BOXES_PER_COLOR * BOX_EDGE_SEGMENT_COUNT
    );
    expect(getMergeOverlayCounts()).toEqual({ drawn: MAX_BOXES_PER_COLOR, skipped: 3 });
    expect(getMergeOverlayNote()).toBe(
      "3 member boxes in view aren't outlined: each colour draws 1,024 at most."
    );
  });
});

describe('the highlight', () => {
  test('all groups; turning one off keeps the others', async () => {
    const a = await createGroupAsync([0]);
    const b = await createGroupAsync([5]);
    expect(setMergeHighlightAll(true)).toBe(true);
    expect(isMergeGroupHighlighted(a.groupId) && isMergeGroupHighlighted(b.groupId)).toBe(true);
    expect(getMergeGroupListData(world).map((row) => row.toggleValues?.[0])).toEqual([true, true]);

    setMergeGroupHighlighted(a.groupId, false);
    expect(isMergeHighlightAll()).toBe(false);
    expect(isMergeGroupHighlighted(a.groupId)).toBe(false);
    expect(isMergeGroupHighlighted(b.groupId)).toBe(true);
  });

  test('fills the lines at once and hides them when nothing is highlighted', async () => {
    const { groupId } = await createGroupAsync([0, 2]);
    setMergeGroupHighlighted(groupId, true);
    const line = getLine(`MERGE_DEBUG_OVERLAY_${getMergeGroupColorIndex(groupId)}`)!;
    expect(line.segmentCount).toBe(2 * BOX_EDGE_SEGMENT_COUNT);
    expect(line.object3D.visible).toBe(true);
    expect(line.object3D.userData).toMatchObject({ aekDebugHelper: true });

    setMergeGroupHighlighted(groupId, false);
    expect(line.object3D.visible).toBe(false);
  });

  test('a scene exit ends the highlights by id, not "all"', async () => {
    const { groupId } = await createGroupAsync([0]);
    setMergeGroupHighlighted(groupId, true);
    runOnAllSceneExits();
    expect(isMergeGroupHighlighted(groupId)).toBe(false);

    setMergeHighlightAll(true);
    runOnAllSceneExits();
    expect(isMergeHighlightAll()).toBe(true);
  });

  test('a rebuilt group keeps its highlight (by id)', async () => {
    const { groupId } = await createGroupAsync([0]);
    setMergeGroupHighlighted(groupId, true);
    const groupEntityId = getGroups(world).get(groupId)!;
    world.deleteEntity(groupEntityId);
    await createGroupAsync([0]);
    expect(isMergeGroupHighlighted(groupId)).toBe(true);
  });

  test('stays off without lines()', async () => {
    const { groupId } = await createGroupAsync([0]);
    lines.isInstalled = false;
    expect(setMergeHighlightAll(true)).toBe(false);
    expect(setMergeGroupHighlighted(groupId, true)).toBe(false);
    expect(isMergeGroupHighlighted(groupId)).toBe(false);
  });
});
