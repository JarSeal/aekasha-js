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

// The main loop's frame and the main camera (the LOD selection's), set by each step
const loop = vi.hoisted(() => ({ frame: 1, camera: undefined as unknown }));
vi.mock(import('../../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainLoopFrame: () => loop.frame,
}));
vi.mock(import('../../../kernel/camera/Camera'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainCamera: () => loop.camera as THREE.Camera | undefined,
}));
// The current scene: the undo history's bucket
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'mergeBatchedLodScene',
}));
vi.mock(import('../../../ui/overlays/windows/DraggableWindow'), async (importOriginal) => ({
  ...(await importOriginal()),
  toggleDraggableWindow: vi.fn(),
  closeDraggableWindow: vi.fn(),
}));

import * as THREE from 'three/webgpu';
import { stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { getConfig, initEnvironment } from '../../../kernel/config/Config';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../../kernel/init/Features';
import { createGeometry } from '../../../kernel/assets/Geometry';
import { createMaterial } from '../../../kernel/assets/Material';
import { createMeshEntity, installMeshes, setMeshLod } from '../../../kernel/mesh/Mesh';
import { createRootScene, runOnAllSceneExits } from '../../../kernel/scene/Scene';
import { _initUndoRedo } from '../../../debug/_dbg__UndoRedo';
import { BOX_EDGE_SEGMENT_COUNT } from '../../lines/LineBuilders';
import { installLines } from '../../lines/Lines';
import { createArrayWriteTarget, FLOATS_PER_SEGMENT, LineWriter } from '../../lines/LineWriter';
import { installLodSystem } from '../../lod/LodSystem';
import { setLodDebugOptions } from '../../lod/LodSettings';
import type { LodDef } from '../../lod/LodTypes';
import { getLodEntityText } from '../../lod/debug/_dbg__LodEntityWindow';
import { LOD_OVERLAY_COLORS, writeLodOverlayBoxes } from '../../lod/debug/_dbg__LodOverlay';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  rebuildMergeGroup,
} from '../MergeGroups';
import { getMergeGroupListData } from './_dbg__Merging';
import { getMergeBatchFigures } from './_dbg__MergingInfo';
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
  getMemberLodText,
  getMemberStateText,
} from './_dbg__MergingWindows';

// p375 Phase 2 S5 (docs/plans/p375_batched-mesh-batches.md): the debugger with batched members'
// LOD: the group's LOD figures (its members with a LOD, its level geometries, level and cull fades,
// the outgoing instances, LOD culled), the tab's fading count, a member's level and the fade its
// batch draws, the merging overlay's boxes with level fades and LOD culling, and the LOD tab's
// overlay and window over members whose own meshes are out of the scene graph.

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  world = new ECSWorld();
  createRootScene();
  const { ctx, installed } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installLines(ctx);
  installLodSystem(ctx);
  installed.add('lod');
  installMergeGroups(ctx);
  // Persistent: a deleted mesh's last ref would release them
  const box = { width: 1, height: 1, depth: 1 };
  createGeometry({ id: 'batchedLodDbgBox', type: 'BOX', params: box, isPersistent: true });
  createGeometry({
    id: 'batchedLodDbgBoxLow',
    type: 'BOX',
    params: { width: 0.5, height: 0.5, depth: 0.5 },
    isPersistent: true,
  });
  createMaterial({ id: 'batchedLodDbgMat', type: 'BASIC', params: {}, isPersistent: true });
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  setLodDebugOptions({ forceLevel: -1 });
  // Ends every view and highlight
  runOnAllSceneExits();
  world.clearWorld();
});

let seq = 0;

/** Two levels (the box, then a half-size one), culled past ~43 m, 0.1 s fades (6 frames at DT) */
const FADED: LodDef = {
  levels: [{ screenSize: 0.5 }, { screenSize: 0.1, geo: 'batchedLodDbgBoxLow' }],
  cullScreenSize: 0.02,
  fadeSeconds: 0.1,
};

/** A box mesh entity at (x, 1, 0) with `lod` (none when undefined). */
const createLodMember = (x: number, lod: LodDef | undefined) =>
  createMeshEntity({
    geo: 'batchedLodDbgBox',
    mat: 'batchedLodDbgMat',
    position: { x, y: 1, z: 0 },
    lod,
  });

/** A built BATCHED group of boxes at x = 0, 2, 4, …; `defs` gives each one's LOD. */
const createBuiltLodGroupAsync = async (defs: (LodDef | undefined)[]) => {
  const groupId = `batchedLodDbg${seq++}`;
  const groupEntityId = createMergeGroup({ id: groupId, mode: 'BATCHED' });
  const members = defs.map((def, i) => createLodMember(i * 2, def));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
  const batch = world.getComponent(groupEntityId, ComponentType.OBJECT3D)!
    .value as THREE.BatchedMesh;
  return { groupId, groupEntityId, group, batch, members };
};

const DT = 1 / 60;

/** Runs `frames` frames with the camera at (0, 1, `distance`), looking down -z: k = 1 (fov 90°),
 * so a box is level 0 nearer than ~1.9 m, level 1 farther, culled past ~43 m. */
const stepAt = (distance: number, frames = 1) => {
  const camera = new THREE.PerspectiveCamera(90);
  camera.position.set(0, 1, distance);
  camera.updateMatrixWorld();
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

const getMember = (entityId: number) => world.getComponent(entityId, ComponentType.MERGE_MEMBER)!;
const getOwnMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

describe("a batched group's LOD figures", () => {
  it('count its LOD members, level geometries, fades with their outgoing instances, and LOD culled', async () => {
    const { group, groupId } = await createBuiltLodGroupAsync([FADED, FADED, undefined]);
    stepNear();
    const row = () => getMergeGroupListData(world).find((item) => item.title === groupId)!;
    expect(getMergeBatchFigures(group, world)).toMatchObject({
      instances: 3,
      batchInstances: 3,
      geometries: 2,
      levelGeometries: 2,
      lodMembers: 2,
      levelFades: 0,
      cullFades: 0,
      lodCulled: 0,
    });
    // A LOD batch sorts by range: a draw per geometry in use
    expect(getMergeBatchFigures(group, world)).toMatchObject({ order: 'RANGE_SORT' });
    expect(row().suffix).toBe('3 members (3 visible)');
    expect(row().description).toMatch(/ · \d+ draws? sorted by range$/);

    // Both LOD members fade to level 1: an outgoing instance each
    stepAt(5);
    expect(getMergeBatchFigures(group, world)).toMatchObject({
      instances: 3,
      batchInstances: 5,
      levelFades: 2,
      cullFades: 0,
    });
    expect(row().description).toMatch(/, 2 fading$/);
    stepAt(5, 6);
    expect(getMergeBatchFigures(group, world)).toMatchObject({ batchInstances: 3, levelFades: 0 });
    expect(row().description).not.toMatch(/fading/);

    // Culled: fading out, drawn until the fade ends, then hidden
    stepAt(100);
    expect(getMergeBatchFigures(group, world)).toMatchObject({ cullFades: 2, lodCulled: 0 });
    stepAt(100, 6);
    expect(getMergeBatchFigures(group, world)).toMatchObject({
      cullFades: 0,
      lodCulled: 2,
      visible: 1,
    });
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

  it("the group's: its level geometries, its instances with the outgoing ones, its LOD row", async () => {
    const { groupEntityId } = await createBuiltLodGroupAsync([FADED, FADED, undefined]);
    stepNear();
    stepAt(5);
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'Batch')).toMatch(
      /^2 geometries \(2 LOD levels\), \d+ of \d+ vertices, 5 of \d+ instances$/
    );
    expect(getMonitorText(root, 'LOD')).toBe(
      '2 members with a LOD: 2 level fades, 0 cull fades, 0 LOD culled'
    );
  });

  it("the group's LOD row without a LOD member", async () => {
    const { groupEntityId } = await createBuiltLodGroupAsync([undefined]);
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'LOD')).toBe('no member has a LOD');
    expect(getMonitorText(root, 'Batch')).toMatch(/^1 geometry, /);
  });

  it("a member's: its level, the fade its batch draws with the outgoing instance, LOD culled", async () => {
    const { members } = await createBuiltLodGroupAsync([FADED]);
    const [entityId] = members;
    stepNear();
    expect(getMemberLodText(entityId, world)).toBe('level 0 of 2');
    stepAt(5);
    const { _fadeInstanceId: fadeId } = getMember(entityId);
    expect(getMemberLodText(entityId, world)).toBe(
      `level 1 of 2, fading from level 0 (instance #${fadeId}), 17%`
    );
    const root = show(createMemberWindowContent({ entityId }));
    expect(getMonitorText(root, 'LOD')).toBe(getMemberLodText(entityId, world));
    stepAt(5, 6);
    expect(getMemberLodText(entityId, world)).toBe('level 1 of 2');

    stepAt(100);
    expect(getMemberLodText(entityId, world)).toBe('level 1 of 2, fading out to LOD culled, 17%');
    expect(getMemberStateText(entityId, world)).toBe('merged');
    stepAt(100, 6);
    expect(getMemberLodText(entityId, world)).toBe('level 1 of 2, LOD culled');
    expect(getMemberStateText(entityId, world)).toBe('LOD culled: its instance hidden');
    stepAt(5);
    expect(getMemberLodText(entityId, world)).toBe('level 1 of 2, fading in from LOD culled, 17%');
  });

  it("a member's fade it came with (a rebuild mid-fade) draws whole until it ends", async () => {
    const { groupId, members } = await createBuiltLodGroupAsync([FADED]);
    stepNear();
    stepAt(5);
    rebuildMergeGroup(groupId, world);
    await buildPendingMergeGroupsAsync();
    expect(getMemberLodText(members[0], world)).toBe(
      'level 1 of 2, a fade it came with: drawn whole until it ends'
    );
  });

  it("a baked member's later LOD: on its own mesh, not drawn; no LOD row without one", async () => {
    const groupId = `bakedLodDbg${seq++}`;
    const groupEntityId = createMergeGroup({ id: groupId });
    const members = [createLodMember(0, undefined), createLodMember(2, undefined)];
    addToMergeGroup(groupId, members);
    await buildPendingMergeGroupsAsync();
    await setMeshLod(members[0], FADED, world);
    expect(getMemberLodText(members[0], world)).toBe(
      'level 0 of 2 on its own mesh (not drawn: its group draws the geometry it joined with)'
    );
    expect(findField(show(createMemberWindowContent({ entityId: members[1] })), 'LOD')).toBe(
      undefined
    );
    expect(getMonitorText(show(createGroupWindowContent({ groupEntityId })), 'Mode')).toMatch(
      /^BAKED/
    );
  });
});

describe('the merging overlay', () => {
  const createWriters = () =>
    MERGE_OVERLAY_COLORS.map(
      () => new LineWriter(createArrayWriteTarget(MAX_BOXES_PER_COLOR * BOX_EDGE_SEGMENT_COUNT))
    );

  it("doesn't outline a member the LOD culled; one fading out still is", async () => {
    const { groupId, members } = await createBuiltLodGroupAsync([FADED, undefined]);
    setMergeGroupHighlighted(groupId, true);
    stepNear();
    stepAt(5, 7);
    stepAt(100);
    const fading = createWriters();
    writeMergeOverlayBoxes(world, null, fading);
    expect(fading[getMergeGroupColorIndex(groupId)].segmentCount).toBe(2 * BOX_EDGE_SEGMENT_COUNT);
    stepAt(100, 6);
    expect(world.hasComponent(members[0], ComponentType.TAG_LOD_CULLED)).toBe(true);
    const culled = createWriters();
    writeMergeOverlayBoxes(world, null, culled);
    expect(culled[getMergeGroupColorIndex(groupId)].segmentCount).toBe(BOX_EDGE_SEGMENT_COUNT);
  });

  it("culls a batched group whole by its members' instances, not the batch's (its level fades')", async () => {
    // A level fade: 2 members, 3 instances
    const { groupId } = await createBuiltLodGroupAsync([FADED, undefined]);
    setMergeGroupHighlighted(groupId, true);
    stepNear();
    stepAt(5);
    // A third member waits for its build far from the batch, in a view that doesn't hold the batch
    const waiting = createLodMember(50, undefined);
    addToMergeGroup(groupId, [waiting]);
    getOwnMesh(waiting).updateMatrixWorld();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(50, 1, 10);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    const writers = createWriters();
    writeMergeOverlayBoxes(world, frustum, writers);
    // The waiting member's box: the group isn't skipped whole
    expect(writers[getMergeGroupColorIndex(groupId)].segmentCount).toBe(BOX_EDGE_SEGMENT_COUNT);
  });
});

describe("the LOD tab's overlay and window with batched members", () => {
  /** Each level writer's boxes' centres' x. */
  const getBoxCentresX = (writer: LineWriter) => {
    const { positions } = (writer as unknown as { target: { positions: Float32Array } }).target;
    const xs: number[] = [];
    const floatsPerBox = BOX_EDGE_SEGMENT_COUNT * FLOATS_PER_SEGMENT;
    for (let box = 0; box < writer.segmentCount / BOX_EDGE_SEGMENT_COUNT; box++) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = box * floatsPerBox; i < (box + 1) * floatsPerBox; i += 3) {
        min = Math.min(min, positions[i]);
        max = Math.max(max, positions[i]);
      }
      xs.push(Math.round(((min + max) / 2) * 1000) / 1000);
    }
    return xs.sort((a, b) => a - b);
  };
  const writeLodBoxes = () => {
    const writers = LOD_OVERLAY_COLORS.map(
      () => new LineWriter(createArrayWriteTarget(16 * BOX_EDGE_SEGMENT_COUNT))
    );
    writeLodOverlayBoxes(world, writers);
    return writers;
  };

  it('boxes each member where its own mesh is (out of the scene graph), by the level it shows', async () => {
    const { members } = await createBuiltLodGroupAsync([FADED, FADED]);
    expect(getOwnMesh(members[0]).parent).toBeNull();
    // Moved (MAIN copies it to its own mesh): the sphere follows its own mesh
    world.setTransform(members[1], { pos: { x: 3, y: 1, z: 0 } });
    world.updateMainLoop(DT);
    stepNear();
    // Seen from 10 m back (the near camera's view holds only the first), no frame run
    stepAt(10, 0);
    let writers = writeLodBoxes();
    expect(getBoxCentresX(writers[0])).toEqual([0, 3]);
    expect(writers[1].segmentCount).toBe(0);
    stepAt(5, 7);
    writers = writeLodBoxes();
    expect(writers[0].segmentCount).toBe(0);
    expect(getBoxCentresX(writers[1])).toEqual([0, 3]);
    // Culled: none
    stepAt(100, 7);
    writers = writeLodBoxes();
    expect(writers.every((writer) => writer.segmentCount === 0)).toBe(true);
  });

  it("the window says its batch draws it, and reads its fade; shown unmerged it's a plain mesh", async () => {
    const { groupEntityId, members } = await createBuiltLodGroupAsync([FADED]);
    stepNear();
    stepAt(5);
    const text = getLodEntityText(members[0], world);
    expect(text).toMatch(/^Kind {9}mesh, drawn by its merge batch$/m);
    expect(text).toMatch(/^State {8}fading level 0 → 1, 17%$/m);
    expect(text).toMatch(/^Distance {5}5\.00 m$/m);
    setMergeGroupUnmergedView(groupEntityId, true, world);
    expect(getLodEntityText(members[0], world)).toMatch(/^Kind {9}mesh$/m);
  });
});
