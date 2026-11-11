import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// localStorage before anything reads it (the storage helpers check it once)
vi.hoisted(() => {
  const items: { [key: string]: string } = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items[key] ?? null,
    setItem: (key: string, value: string) => (items[key] = String(value)),
    removeItem: (key: string) => delete items[key],
  });
});

// The current scene: the undo history's bucket
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'mergeBatchedScene',
}));
// The windows a row opens, captured
vi.mock(import('../../../ui/overlays/windows/DraggableWindow'), async (importOriginal) => ({
  ...(await importOriginal()),
  toggleDraggableWindow: vi.fn(),
  closeDraggableWindow: vi.fn(),
}));
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

import * as THREE from 'three/webgpu';
import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { getConfig, initEnvironment } from '../../../kernel/config/Config';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../../kernel/init/Features';
import { createGeometry } from '../../../kernel/assets/Geometry';
import { createMaterial } from '../../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../../kernel/mesh/Mesh';
import { createRootScene, getRootScene, runOnAllSceneExits } from '../../../kernel/scene/Scene';
import { _getUndoRedoHistory, _initUndoRedo, _undoLastAction } from '../../../debug/_dbg__UndoRedo';
import { BOX_EDGE_SEGMENT_COUNT } from '../../lines/LineBuilders';
import { installLines } from '../../lines/Lines';
import { createArrayWriteTarget, FLOATS_PER_SEGMENT, LineWriter } from '../../lines/LineWriter';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
} from '../MergeGroups';
import { getGroups } from '../MergeState';
import { _checkMovedMergeMembers } from './_dbg__MergeGroups';
import { formatMergeSummary, getMergeGroupListData } from './_dbg__Merging';
import { getMergeSummary } from './_dbg__MergingInfo';
import {
  getMergeGroupColorIndex,
  MAX_BOXES_PER_COLOR,
  MERGE_OVERLAY_COLORS,
  setMergeGroupHighlighted,
  writeMergeOverlayBoxes,
} from './_dbg__MergingOverlay';
import { setMergeGroupUnmergedView } from './_dbg__MergingUnmerged';
import {
  createGroupWindowContent,
  createMemberWindowContent,
  getGroupStateText,
  getMemberPartText,
  getMemberStateText,
} from './_dbg__MergingWindows';
import { MERGE_MEMBER_TRANSFORM_ACTION } from './_dbg__MergingUndo';

// p375 S5: the debugger with BATCHED groups (docs/plans/p375_batched-mesh-batches.md): the moved-
// member check skips their members, the overlay outlines them where their own meshes are, the tab
// and the windows show their batch's figures, "Show unmerged" holds the batch, and the pose fields
// move a member without an edit session

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  // The highlight's lines
  installLines(ctx);
  installMergeGroups(ctx);
  // A box has 24 vertices, the sphere (8 × 6 segments) 63
  createGeometry({
    id: 'mergeBatchedBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createGeometry({
    id: 'mergeBatchedSphere',
    type: 'SPHERE',
    params: { radius: 0.5, widthSegments: 8, heightSegments: 6 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeBatchedMat', type: 'BASIC', params: {}, isPersistent: true });
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  // Ends every view and highlight
  runOnAllSceneExits();
  world.clearWorld();
  fns.lwarn.mockClear();
  _initUndoRedo();
});

let seq = 0;

/** A member at (x, 0, 0): a box, or a sphere. */
const createMember = (x: number, isSphere = false) =>
  createMeshEntity({
    geo: isSphere ? 'mergeBatchedSphere' : 'mergeBatchedBox',
    mat: 'mergeBatchedMat',
    position: { x, y: 0, z: 0 },
  });

const frame = () => {
  world.updateMainLoop(0.016);
  world.updateAppLoop(0.016);
};

/** A built BATCHED group: boxes at x 0 and 4, spheres at 2 and 6, one frame run (the sync's run
 * count). Its batch sits at (3, 0, 0). */
const createBatchedGroupAsync = async () => {
  const groupId = `batchedDbg${seq++}`;
  const groupEntityId = createMergeGroup({ id: groupId, mode: 'BATCHED' });
  const members = [0, 2, 4, 6].map((x, i) => createMember(x, i % 2 === 1));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  frame();
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
  const batch = world.getComponent(groupEntityId, ComponentType.OBJECT3D)!
    .value as THREE.BatchedMesh;
  return { groupId, groupEntityId, group, members, batch };
};

const getOwnMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;
const getInstanceId = (entityId: number) =>
  world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.instanceId;
const getBatch = (groupEntityId: number) =>
  world.getComponent(groupEntityId, ComponentType.OBJECT3D)!.value as THREE.BatchedMesh;
/** An instance's x in world space. */
const getInstanceX = (batch: THREE.BatchedMesh, entityId: number) =>
  new THREE.Vector3()
    .setFromMatrixPosition(batch.getMatrixAt(getInstanceId(entityId), new THREE.Matrix4()))
    .add(batch.position).x;

describe('the moved-member check', () => {
  it("skips a batched member: it moves by contract, its batch's sync draws it", async () => {
    const { members } = await createBatchedGroupAsync();
    world.setTransform(members[0], { pos: { x: 9, y: 0, z: 0 } });
    frame();
    expect(_checkMovedMergeMembers(world)).toEqual([]);
    expect(fns.lwarn).not.toHaveBeenCalled();
  });
});

describe('the overlay', () => {
  /** A writer's points' bounds. */
  const getWrittenBounds = (writer: LineWriter) => {
    const { positions } = (writer as unknown as { target: { positions: Float32Array } }).target;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < writer.segmentCount * FLOATS_PER_SEGMENT; i += 3) {
      box.expandByPoint(point.fromArray(positions, i));
    }
    return box;
  };

  it("outlines a batched member where its own mesh is now, before the render's matrices", async () => {
    const { groupId, members } = await createBatchedGroupAsync();
    // Moved after the frame: its own mesh's matrixWorld is still at 0 (the render updates it)
    getOwnMesh(members[0]).position.set(-5, 0, 0);
    setMergeGroupHighlighted(groupId, true);
    const writers = MERGE_OVERLAY_COLORS.map(
      () => new LineWriter(createArrayWriteTarget(MAX_BOXES_PER_COLOR * BOX_EDGE_SEGMENT_COUNT))
    );
    writeMergeOverlayBoxes(world, null, writers);
    const writer = writers[getMergeGroupColorIndex(groupId)];
    expect(writer.segmentCount).toBe(4 * BOX_EDGE_SEGMENT_COUNT);
    const bounds = getWrittenBounds(writer);
    expect(bounds.min.x).toBeCloseTo(-5.5, 5);
    expect(bounds.max.x).toBeCloseTo(6.5, 5);
  });
});

describe('the tab', () => {
  it("counts a batch's members as merged, its vertices as its instances draw, its runs as draws", async () => {
    const { groupEntityId, batch } = await createBatchedGroupAsync();
    const summary = getMergeSummary(world);
    expect(summary).toMatchObject({ groups: 1, drawnGroups: 1, members: 4, builtMembers: 4 });
    expect(summary.mergedVertices).toBe(2 * 24 + 2 * 63);
    // Grouped by geometry at the build: a run each
    expect(summary.drawsNow).toBe(2);
    expect(summary.drawsUnmerged).toBe(4);
    expect(summary.shadowDrawsNow).toBe(batch.castShadow ? 2 : 0);
    expect(formatMergeSummary(world, { builds: 0, updates: 0 }).members).toBe(
      '4 (4 merged, 0 waiting, 0 queued)'
    );
    expect(getGroupStateText(groupEntityId, world)).toBe('built');
  });

  it("badges a batched group's row and shows its visible members, runs and compactions", async () => {
    const { groupId, members } = await createBatchedGroupAsync();
    world.setDisabled(members[1], true);
    const row = getMergeGroupListData(world).find((item) => item.title === groupId)!;
    expect(row.badge).toBe('BATCHED');
    expect(row.suffix).toBe('4 members (3 visible), 2 runs, 0 compactions');
  });

  it("badges an AUTO batched group's row with both", async () => {
    const entityId = createMeshEntity({
      geo: 'mergeBatchedBox',
      mat: 'mergeBatchedMat',
      position: { x: 0, y: 0, z: 0 },
      merge: { mode: 'BATCHED' },
    });
    await buildPendingMergeGroupsAsync();
    frame();
    const groupId = world.getComponent(entityId, ComponentType.MERGE_MEMBER)!.groupId;
    const row = getMergeGroupListData(world).find((item) => item.title === groupId)!;
    expect(row.badge).toBe('AUTO · BATCHED');
    expect(row.suffix).toBe('1 member (1 visible), 1 run, 0 compactions');
  });

  it("leaves a baked group's row as it was", async () => {
    const groupId = `bakedDbg${seq++}`;
    addToMergeGroup(groupId, [createMember(0), createMember(2)]);
    await buildPendingMergeGroupsAsync();
    const row = getMergeGroupListData(world).find((item) => item.title === groupId)!;
    expect(row.badge).toBeUndefined();
    expect(row.suffix).toBe('2 members, 48 v');
  });
});

describe('show unmerged', () => {
  const isOwnVisible = (entityId: number) => getOwnMesh(entityId).visible;
  /** Its own mesh under the root scene (out of the scene graph while its batch draws it) */
  const isOwnInScene = (entityId: number) => getOwnMesh(entityId).parent === getRootScene();

  it("holds the batch and draws the members' own meshes, then merges them again", async () => {
    const { groupEntityId, members, batch } = await createBatchedGroupAsync();
    expect(setMergeGroupUnmergedView(groupEntityId, true)).toBe(true);
    expect(batch.visible).toBe(false);
    expect(members.every(isOwnVisible)).toBe(true);
    expect(members.every(isOwnInScene)).toBe(true);
    expect(getMemberStateText(members[0], world)).toBe('merged, drawn on its own (shown unmerged)');
    expect(getMergeSummary(world).drawsNow).toBe(4);

    setMergeGroupUnmergedView(groupEntityId, false);
    expect(batch.visible).toBe(true);
    expect(members.some(isOwnVisible)).toBe(false);
    expect(members.some(isOwnInScene)).toBe(false);
    expect(members.every((id) => world.hasComponent(id, ComponentType.TAG_MERGED))).toBe(true);
  });

  it('keeps a member that joins during the view drawn on its own, and a rebuilt batch held', async () => {
    const { groupId, groupEntityId, members } = await createBatchedGroupAsync();
    setMergeGroupUnmergedView(groupEntityId, true);
    const late = createMember(8);
    addToMergeGroup(groupId, [late]);
    await buildPendingMergeGroupsAsync();
    expect(getInstanceId(late)).toBeGreaterThanOrEqual(0);
    expect(isOwnVisible(late)).toBe(true);

    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    const rebuilt = getBatch(groupEntityId);
    expect(rebuilt.visible).toBe(false);
    expect([...members, late].every(isOwnVisible)).toBe(true);
    expect([...members, late].every(isOwnInScene)).toBe(true);

    setMergeGroupUnmergedView(groupEntityId, false);
    expect(rebuilt.visible).toBe(true);
    expect([...members, late].some(isOwnVisible)).toBe(false);
    expect([...members, late].some(isOwnInScene)).toBe(false);
  });

  it('a rebuild of a disabled batched group keeps its new batch hidden', async () => {
    const { groupId, groupEntityId } = await createBatchedGroupAsync();
    world.setDisabled(groupEntityId, true);
    rebuildMergeGroup(groupId);
    await buildPendingMergeGroupsAsync();
    expect(getBatch(groupEntityId).visible).toBe(false);
  });
});

describe('the windows', () => {
  const show = (cmp: CMPHandle) => {
    document.body.append(cmp.elem);
    built.push(cmp);
    return cmp.elem;
  };
  const findField = (root: Element, label: string) =>
    [...root.querySelectorAll<HTMLElement>('.aekField')].find(
      (elem) => elem.querySelector('.aekField__label')?.textContent === label
    );
  const getMonitorText = (root: Element, label: string) => {
    const field = findField(root, label);
    if (!field) throw new Error(`No field "${label}"`);
    return field.querySelector('.aekMonitor__value')?.textContent;
  };

  it("shows a batched group's mode and batch figures in place of the palette and the waste", async () => {
    const { groupEntityId, members } = await createBatchedGroupAsync();
    world.setDisabled(members[0], true);
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'Mode')).toBe('BATCHED: instances of one BatchedMesh');
    expect(getMonitorText(root, 'Members')).toBe('4 (4 batched, 3 visible)');
    expect(getMonitorText(root, 'Vertices')).toBe('174');
    expect(getMonitorText(root, 'Batch')).toMatch(
      /^2 geometries, 87 of \d+ vertices, 4 of \d+ instances$/
    );
    expect(getMonitorText(root, 'Draw runs')).toBe('2 (2 geometries in use), 0 compactions');
    expect(getMonitorText(root, 'Per-member culling')).toBe('yes');
    expect(findField(root, 'Palette')).toBeUndefined();
    expect(findField(root, 'Wasted vertices')).toBeUndefined();
  });

  it("says a baked group's mode", async () => {
    const groupId = `bakedWin${seq++}`;
    addToMergeGroup(groupId, [createMember(0)]);
    await buildPendingMergeGroupsAsync();
    const root = show(createGroupWindowContent({ groupEntityId: getGroups(world).get(groupId)! }));
    expect(getMonitorText(root, 'Mode')).toBe('BAKED: one merged geometry, culled whole');
    expect(findField(root, 'Batch')).toBeUndefined();
  });

  it("gives a batched member's state by its instance, and its instance as its part", async () => {
    const { groupId, members } = await createBatchedGroupAsync();
    const [box, sphere] = members;
    expect(getMemberStateText(box, world)).toBe('merged');
    // Grouped by geometry: the boxes are ids 0 and 1 of geometry 0, the spheres 2 and 3 of 1
    expect(getMemberPartText(sphere, world)).toBe('instance #2, geometry #1');

    world.setDisabled(box, true);
    expect(getMemberStateText(box, world)).toBe('disabled: its instance hidden');
    world.setDisabled(box, false);
    world.addComponent(box, ComponentType.TAG_DRAW_HELD, true);
    expect(getMemberStateText(box, world)).toBe('held: its instance hidden');
    world.removeComponent(box, ComponentType.TAG_DRAW_HELD);
    world.addComponent(box, ComponentType.TAG_FRUSTUM_CULLED, true);
    expect(getMemberStateText(box, world)).toBe('frustum-culled: its instance hidden');

    const late = createMember(10);
    addToMergeGroup(groupId, [late]);
    expect(getMemberStateText(late, world)).toBe("waiting for its group's build");
    expect(getMemberPartText(late, world)).toBe('none yet');
  });

  it('moves a batched member without an edit session, its instance following, one undo entry per gesture', async () => {
    const { groupEntityId, members, batch } = await createBatchedGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[1] }));
    const y = [...findField(root, 'Position')!.querySelectorAll<HTMLInputElement>('input')][1];
    dispatchKey(y, 'keydown', 'ArrowUp');
    dispatchKey(y, 'keydown', 'ArrowUp');
    dispatchKey(y, 'keyup', 'ArrowUp');
    expect(fns.lwarn).not.toHaveBeenCalled();
    expect(getOwnMesh(members[1]).visible).toBe(false);
    frame();
    const matrix = batch.getMatrixAt(getInstanceId(members[1]), new THREE.Matrix4());
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeCloseTo(2, 5);

    const moves = _getUndoRedoHistory().filter(
      (entry) => entry.actionType === MERGE_MEMBER_TRANSFORM_ACTION
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].payload).toMatchObject({
      entityId: members[1],
      prev: { position: [2, 0, 0] },
      next: { position: [2, 2, 0] },
    });
    expect(_undoLastAction()).toBe(true);
    frame();
    expect(getInstanceX(batch, members[1])).toBeCloseTo(2, 5);
    const undone = batch.getMatrixAt(getInstanceId(members[1]), new THREE.Matrix4());
    expect(new THREE.Vector3().setFromMatrixPosition(undone).y).toBeCloseTo(0, 5);
    expect(world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!.rebuilds).toBe(1);
  });
});
