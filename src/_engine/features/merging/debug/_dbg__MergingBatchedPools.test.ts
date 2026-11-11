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

// A renderer for the WebGL2 test (none: a batch is drawn as on WebGPU)
const loop = vi.hoisted(() => ({ renderer: null as unknown }));
vi.mock(import('../../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: () => loop.renderer as never,
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'mergeBatchedPoolsScene',
}));
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
import { stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { getConfig, initEnvironment } from '../../../kernel/config/Config';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { installCoreSystems } from '../../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../../kernel/init/Features';
import { createGeometry, saveBufferGeometry } from '../../../kernel/assets/Geometry';
import { createMaterial } from '../../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../../kernel/mesh/Mesh';
import { createRootScene, runOnAllSceneExits } from '../../../kernel/scene/Scene';
import { _initUndoRedo } from '../../../debug/_dbg__UndoRedo';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  installMergeGroups,
  removeFromMergeGroup,
} from '../MergeGroups';
import { setMergeMemberColor } from '../MergeMemberColor';
import type { MergeGroupSettings } from '../MergeTypes';
import { getGroups } from '../MergeState';
import { getMergeGroupListData } from './_dbg__Merging';
import { getMergeSummary } from './_dbg__MergingInfo';
import { createGroupWindowContent, createMemberWindowContent } from './_dbg__MergingWindows';

// p375 Phase 3 S4 (docs/plans/p375_batched-mesh-batches.md): the debugger with a batch's geometry
// slots, its transparent order and its members' colours: the group window's Geometry slots,
// Colours and Draw runs rows, the tab's row and the summary's draws for a sorted batch, and the
// member window's Colour row (a batched member's only).

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'poolBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  saveBufferGeometry(new THREE.BoxGeometry(0.5, 0.5, 0.5), {
    id: 'poolBoxSmall',
    isPersistent: true,
  });
  createMaterial({ id: 'poolMat', type: 'BASIC', params: {}, isPersistent: true });
  createMaterial({
    id: 'poolGlass',
    type: 'BASIC',
    params: { transparent: true, opacity: 0.5 },
    isPersistent: true,
  });
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  runOnAllSceneExits();
  loop.renderer = null;
  world.clearWorld();
  fns.lwarn.mockClear();
  _initUndoRedo();
});

let seq = 0;

/** A built BATCHED group of a box and a small box (in `mat`), with `settings`. */
const createPoolAsync = async (
  mat = 'poolMat',
  settings: Omit<MergeGroupSettings, 'mode'> = {}
) => {
  const groupId = `pool${seq++}`;
  createMergeGroup({ id: groupId, mode: 'BATCHED', ...settings });
  const members = ['poolBox', 'poolBoxSmall', 'poolBox'].map((geo, i) =>
    createMeshEntity({ geo, mat, position: { x: i * 2, y: 0, z: 0 } })
  );
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, groupEntityId: getGroups(world).get(groupId)!, members };
};

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

const rowOf = (groupId: string) =>
  getMergeGroupListData(world).find((item) => item.title === groupId)!;

describe('geometry slots', () => {
  it("shows the slots held and free, and the group's reserve", async () => {
    const { groupEntityId, members } = await createPoolAsync();
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'Geometry slots')).toBe(
      "2 slots: 2 held, 0 free; each reserves each geometry's own size"
    );
    removeFromMergeGroup([members[1]]);
    const again = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(again, 'Geometry slots')).toBe(
      "2 slots: 1 held, 1 free; each reserves each geometry's own size"
    );

    const reserved = await createPoolAsync('poolMat', {
      geometryReserve: { vertices: 64, indices: 192 },
    });
    const window = show(createGroupWindowContent({ groupEntityId: reserved.groupEntityId }));
    expect(getMonitorText(window, 'Geometry slots')).toBe(
      '2 slots: 2 held, 0 free; each reserves 64 vertices, 192 indices'
    );
  });
});

describe('colours', () => {
  it("counts the coloured members, and shows a member's colour", async () => {
    const { groupEntityId, members } = await createPoolAsync();
    const member = show(createMemberWindowContent({ entityId: members[0] }));
    expect(getMonitorText(member, 'Colour')).toBe('white, opaque (none set)');
    const group = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(group, 'Colours')).toBe('none set');

    setMergeMemberColor(members[0], { color: 0xff8040, opacity: 0.5 });
    const coloured = show(createMemberWindowContent({ entityId: members[0] }));
    expect(getMonitorText(coloured, 'Colour')).toBe('#ff8040, opacity 0.5');
    const again = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(again, 'Colours')).toBe('1 member with a colour');
  });

  it("a baked member's window has no Colour row", async () => {
    const groupId = `bakedPool${seq++}`;
    const entityId = createMeshEntity({ geo: 'poolBox', mat: 'poolMat' });
    addToMergeGroup(groupId, [entityId]);
    await buildPendingMergeGroupsAsync();
    const root = show(createMemberWindowContent({ entityId }));
    expect(findField(root, 'Colour')).toBeUndefined();
  });
});

describe("a transparent batch's order", () => {
  it('shows its order and its draws at most, on WebGPU', async () => {
    const { groupId, groupEntityId } = await createPoolAsync('poolGlass', {
      transparentOrder: 'JOIN',
    });
    expect(rowOf(groupId).suffix).toBe('3 members (3 visible), up to 3 draws in join order');
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'Draw runs')).toBe(
      'transparent: in join order each pass, up to 3 draws'
    );
    expect(getMergeSummary(world).drawsNow).toBe(3);

    const depth = await createPoolAsync('poolGlass');
    expect(rowOf(depth.groupId).suffix).toBe(
      '3 members (3 visible), up to 3 draws sorted back to front'
    );
  });

  it('one multi-draw on WebGL2', async () => {
    loop.renderer = { backend: { isWebGPUBackend: false } };
    const { groupId, groupEntityId } = await createPoolAsync('poolGlass');
    expect(rowOf(groupId).suffix).toBe(
      '3 members (3 visible), one multi-draw sorted back to front'
    );
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'Draw runs')).toBe(
      'transparent: sorted back to front each pass, one multi-draw (WebGL2)'
    );
    expect(getMergeSummary(world).drawsNow).toBe(1);
  });
});
