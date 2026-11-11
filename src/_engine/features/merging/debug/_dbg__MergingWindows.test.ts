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
  getCurrentSceneId: () => 'mergeScene',
}));
// The windows opened and closed, captured
const win = vi.hoisted(() => ({ toggle: vi.fn(), close: vi.fn() }));
vi.mock(import('../../../ui/overlays/windows/DraggableWindow'), async (importOriginal) => ({
  ...(await importOriginal()),
  toggleDraggableWindow: win.toggle,
  closeDraggableWindow: win.close,
}));
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

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
import { createRootScene, runOnAllSceneExits } from '../../../kernel/scene/Scene';
import {
  _getUndoRedoHistory,
  _initUndoRedo,
  _redoLastAction,
  _undoLastAction,
} from '../../../debug/_dbg__UndoRedo';
import { _getEntityManagerInfo } from '../../../debug/_dbg__ManagedEntities';
import { _getEntityWindowOpener } from '../../../debug/Profiler';
import { installLines } from '../../lines/Lines';
import { addToMergeGroup, buildPendingMergeGroupsAsync, installMergeGroups } from '../MergeGroups';
import { getGroups } from '../MergeState';
import {
  _registerMergingWindowLinks,
  createGroupWindowContent,
  createMemberWindowContent,
  getMemberPartText,
  getMemberStateText,
} from './_dbg__MergingWindows';
import { isMergeGroupHighlighted, setMergeGroupHighlighted } from './_dbg__MergingOverlay';
import { isMergeGroupUnmergedView, setMergeGroupUnmergedView } from './_dbg__MergingUnmerged';
import {
  MERGE_DISSOLVE_ACTION,
  MERGE_MEMBER_TRANSFORM_ACTION,
  MERGE_REMOVE_ACTION,
} from './_dbg__MergingUndo';
import { isMergeMemberInEdit } from '../MergeMemberEdit';

// p373 D2: the group and member windows, their links, and the dissolve and removal with undo

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
  createGeometry({
    id: 'mergeWinBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergeWinMat', type: 'BASIC', params: {}, isPersistent: true });
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  world.clearWorld();
  win.toggle.mockClear();
  win.close.mockClear();
  fns.lwarn.mockClear();
  _initUndoRedo();
});

let seq = 0;
const createBox = (x: number, merge?: string) =>
  createMeshEntity({
    geo: 'mergeWinBox',
    mat: 'mergeWinMat',
    position: { x, y: 0, z: 0 },
    ...(merge ? { merge } : {}),
  });

/** A built group of three boxes. */
const createGroupAsync = async () => {
  const groupId = `winGroup${seq++}`;
  const members = [createBox(0), createBox(2), createBox(4)];
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, members, groupEntityId: getGroups(world).get(groupId)! };
};

const show = (cmp: CMPHandle) => {
  document.body.append(cmp.elem);
  built.push(cmp);
  return cmp.elem;
};

const getField = (root: Element, label: string) => {
  const field = [...root.querySelectorAll<HTMLElement>('.aekField')].find(
    (elem) => elem.querySelector('.aekField__label')?.textContent === label
  );
  if (!field) throw new Error(`No field "${label}"`);
  return field;
};
const getMonitorText = (root: Element, label: string) =>
  getField(root, label).querySelector('.aekMonitor__value')?.textContent;
const getButton = (root: Element, text: string) => {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (elem) => elem.textContent?.trim() === text
  );
  if (!button) throw new Error(`No button "${text}"`);
  return button;
};
/** A field's spin buttons (a vector's axes, in order). */
const getInputs = (root: Element, label: string) => [
  ...getField(root, label).querySelectorAll<HTMLInputElement>('input'),
];
/** Typed text written with Enter: one `last: true` change. */
const type = (input: HTMLInputElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  dispatchKey(input, 'keydown', 'Enter');
};
const isVisible = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value.visible;
const getPosition = (entityId: number) =>
  world.getComponent(entityId, ComponentType.TRANSFORM)!.position.toArray();
const getRebuilds = (groupEntityId: number) =>
  world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!.rebuilds;

const click = (target: Element) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

describe('the group window', () => {
  it('shows the group, its members as rows that open their windows, and its entity', async () => {
    const { groupId, members, groupEntityId } = await createGroupAsync();
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'State')).toBe('built');
    expect(getMonitorText(root, 'Kind')).toBe('explicit (named)');
    expect(getMonitorText(root, 'Material')).toBe('mergeWinMat');
    expect(getMonitorText(root, 'Palette')).toBe('none');
    expect(getMonitorText(root, 'Members')).toBe('3 (3 merged)');
    expect(getMonitorText(root, 'Vertices')).toBe('72');
    expect(getMonitorText(root, 'Name')).toBe(groupId);

    const rows = [...root.querySelectorAll<HTMLElement>('.aekList__row')];
    expect(rows.map((row) => row.getAttribute('data-key'))).toEqual(members.map(String));
    click(rows[1].querySelector('.aekList__title')!);
    expect(win.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mergeMember', data: { entityId: members[1] } })
    );
  });

  it("highlights its members from its checkbox, as the tab's row does", async () => {
    const { groupId, groupEntityId } = await createGroupAsync();
    const root = show(createGroupWindowContent({ groupEntityId }));
    const checkbox = getField(root, 'Highlight members').querySelector('input')!;
    expect(checkbox.checked).toBe(false);
    checkbox.click();
    expect(isMergeGroupHighlighted(groupId)).toBe(true);
    setMergeGroupHighlighted(groupId, false);
  });

  it('shows the group unmerged from its checkbox', async () => {
    const { groupEntityId } = await createGroupAsync();
    const root = show(createGroupWindowContent({ groupEntityId }));
    const checkbox = getField(root, 'Show unmerged').querySelector('input')!;
    expect(checkbox.disabled).toBe(false);
    checkbox.click();
    expect(isMergeGroupUnmergedView(groupEntityId)).toBe(true);
    setMergeGroupUnmergedView(groupEntityId, false);
  });

  it('dissolves the group, closes its window, and undo merges the same members again', async () => {
    const { groupId, members, groupEntityId } = await createGroupAsync();
    const root = show(createGroupWindowContent({ groupEntityId }));
    click(getButton(root, 'Dissolve'));
    expect(getGroups(world).has(groupId)).toBe(false);
    expect(members.some((id) => world.hasComponent(id, ComponentType.MERGE_MEMBER))).toBe(false);
    expect(win.close).toHaveBeenCalledWith(`mergeGroup_${groupEntityId}`);
    expect(_getUndoRedoHistory().at(-1)?.actionType).toBe(MERGE_DISSOLVE_ACTION);

    expect(_undoLastAction()).toBe(true);
    await buildPendingMergeGroupsAsync();
    const again = getGroups(world).get(groupId)!;
    expect(world.getComponent(again, ComponentType.MERGE_GROUP)?.members).toEqual(members);
    expect(members.every((id) => world.hasComponent(id, ComponentType.TAG_MERGED))).toBe(true);

    expect(_redoLastAction()).toBe(true);
    expect(getGroups(world).has(groupId)).toBe(false);
  });

  it('makes an AUTO group again under its own id, as an AUTO group', async () => {
    const members = [createBox(0, 'AUTO'), createBox(1, 'AUTO')];
    await buildPendingMergeGroupsAsync();
    const [[groupId, groupEntityId]] = [...getGroups(world)];
    expect(groupId).toMatch(/^auto:/);
    const root = show(createGroupWindowContent({ groupEntityId }));
    expect(getMonitorText(root, 'Kind')).toMatch(/^AUTO, cell 0, 0 \(#0\)$/);
    click(getButton(root, 'Dissolve'));
    _undoLastAction();
    await buildPendingMergeGroupsAsync();
    const again = world.getComponent(getGroups(world).get(groupId)!, ComponentType.MERGE_GROUP);
    expect(again).toMatchObject({ _isAuto: true, members });
  });
});

describe('the member window', () => {
  it('shows its group with a link to its window, its part and pose', async () => {
    const { groupId, members, groupEntityId } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[1] }));
    expect(getMonitorText(root, 'Merged into')).toBe(groupId);
    expect(getMonitorText(root, 'State')).toBe('merged');
    expect(getMonitorText(root, 'Geometry')).toBe('mergeWinBox');
    expect(getMonitorText(root, 'Palette index')).toBe('none (a group of one material)');
    // A box: 24 vertices, 36 indices; the second part
    expect(getMemberPartText(members[1], world)).toBe('#1: vertices 24-47, indices 36-71');
    click(getButton(root, 'Open the group’s window'));
    expect(win.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mergeGroup', data: { groupEntityId } })
    );
  });

  it('removes the member, and undo adds it back', async () => {
    const { groupId, members } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[0] }));
    click(getButton(root, 'Remove from group'));
    expect(world.hasComponent(members[0], ComponentType.MERGE_MEMBER)).toBe(false);
    expect(_getUndoRedoHistory().at(-1)?.actionType).toBe(MERGE_REMOVE_ACTION);

    _undoLastAction();
    expect(world.getComponent(members[0], ComponentType.MERGE_MEMBER)?.groupId).toBe(groupId);
    await buildPendingMergeGroupsAsync();
    expect(world.hasComponent(members[0], ComponentType.TAG_MERGED)).toBe(true);
    _redoLastAction();
    expect(world.hasComponent(members[0], ComponentType.MERGE_MEMBER)).toBe(false);
  });

  it("doesn't undo across a scene exit: the entity ids mean other entities", async () => {
    const { groupId, members } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[0] }));
    click(getButton(root, 'Remove from group'));
    runOnAllSceneExits();
    _undoLastAction();
    expect(world.hasComponent(members[0], ComponentType.MERGE_MEMBER)).toBe(false);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining(`"${groupId}"`));
  });
});

describe("the member window's pose", () => {
  it('moves the member in place through one session per change, and undo and redo move it', async () => {
    const { members, groupEntityId } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[1] }));
    type(getInputs(root, 'Position')[1], '3');

    expect(getPosition(members[1])).toEqual([2, 3, 0]);
    expect(isMergeMemberInEdit(members[1])).toBe(false);
    expect(isVisible(members[1])).toBe(false);
    expect(getRebuilds(groupEntityId)).toBe(1);
    const member = world.getComponent(members[1], ComponentType.MERGE_MEMBER)!;
    expect(member._bakedMatrix.elements[13]).toBe(3);
    const entry = _getUndoRedoHistory().at(-1)!;
    expect(entry.actionType).toBe(MERGE_MEMBER_TRANSFORM_ACTION);
    expect(entry.payload).toMatchObject({
      entityId: members[1],
      prev: { position: [2, 0, 0] },
      next: { position: [2, 3, 0] },
    });

    expect(_undoLastAction()).toBe(true);
    expect(getPosition(members[1])).toEqual([2, 0, 0]);
    expect(member._bakedMatrix.elements[13]).toBe(0);
    expect(_redoLastAction()).toBe(true);
    expect(getPosition(members[1])).toEqual([2, 3, 0]);
    expect(member._bakedMatrix.elements[13]).toBe(3);
    expect(getRebuilds(groupEntityId)).toBe(1);
  });

  it('keeps a key gesture in one session, drawn on its own, until its keyup', async () => {
    const { members } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[0] }));
    const y = getInputs(root, 'Position')[1];
    dispatchKey(y, 'keydown', 'ArrowUp');
    dispatchKey(y, 'keydown', 'ArrowUp');
    expect(isMergeMemberInEdit(members[0])).toBe(true);
    expect(isVisible(members[0])).toBe(true);
    expect(getMemberStateText(members[0], world)).toBe(
      'being moved: drawn on its own until the move ends'
    );
    // The grid's refresh reads the button's reason
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(getButton(root, 'Remove from group').getAttribute('aria-disabled')).toBe('true');

    dispatchKey(y, 'keyup', 'ArrowUp');
    expect(isMergeMemberInEdit(members[0])).toBe(false);
    expect(isVisible(members[0])).toBe(false);
    expect(getPosition(members[0])).toEqual([0, 2, 0]);
    const moves = _getUndoRedoHistory().filter(
      (e) => e.actionType === MERGE_MEMBER_TRANSFORM_ACTION
    );
    expect(moves).toHaveLength(1);
  });

  it('ends a session its window closed on, and records it', async () => {
    const { members } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[2] }));
    dispatchKey(getInputs(root, 'Position')[0], 'keydown', 'ArrowDown');
    expect(isMergeMemberInEdit(members[2])).toBe(true);
    built.pop()!.remove();
    expect(isMergeMemberInEdit(members[2])).toBe(false);
    expect(isVisible(members[2])).toBe(false);
    expect(_getUndoRedoHistory().at(-1)?.actionType).toBe(MERGE_MEMBER_TRANSFORM_ACTION);
  });

  it('turns it by degrees and scales it; a member with a body keeps its scale', async () => {
    const { members } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[0] }));
    type(getInputs(root, 'Rotation')[1], '90');
    const quaternion = world.getComponent(members[0], ComponentType.TRANSFORM)!.quaternion;
    expect(quaternion.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(quaternion.w).toBeCloseTo(Math.SQRT1_2, 6);
    type(getInputs(root, 'Scale')[0], '2');
    expect(world.getComponent(members[0], ComponentType.TRANSFORM)!.scale.x).toBe(2);
    expect(
      _getUndoRedoHistory().filter((e) => e.actionType === MERGE_MEMBER_TRANSFORM_ACTION)
    ).toHaveLength(2);

    // A fixed body's stand-in: the scale field is disabled with its reason
    world.addComponent(members[1], ComponentType.BODY_STATIC, {} as never);
    const bodyRoot = show(createMemberWindowContent({ entityId: members[1] }));
    expect(getField(bodyRoot, 'Scale').hasAttribute('data-disabled')).toBe(true);
    expect(getField(root, 'Scale').hasAttribute('data-disabled')).toBe(false);
    expect(getField(bodyRoot, 'Scale').textContent).toContain('colliders don’t scale');
    world.removeComponent(members[1], ComponentType.BODY_STATIC);
  });

  it("disables the fields of a member that left its group, and doesn't undo a deleted one", async () => {
    const { members } = await createGroupAsync();
    const root = show(createMemberWindowContent({ entityId: members[0] }));
    type(getInputs(root, 'Position')[2], '5');
    world.deleteEntity(members[0]);
    _undoLastAction();
    expect(fns.lwarn).toHaveBeenCalledWith(
      `Merging: can't undo the move of entity ${members[0]}: it was deleted.`
    );

    const other = show(createMemberWindowContent({ entityId: members[1] }));
    expect(getField(other, 'Position').hasAttribute('data-disabled')).toBe(false);
    click(getButton(other, 'Remove from group'));
    // The grid's refresh reads the disabled state
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(getField(other, 'Position').hasAttribute('data-disabled')).toBe(true);
  });
});

describe('the links from other tools', () => {
  it('names the group entity’s manager and opens both kinds from the profiler', async () => {
    _registerMergingWindowLinks();
    const { members, groupEntityId } = await createGroupAsync();
    expect(_getEntityManagerInfo(groupEntityId, world)).toMatchObject({
      label: 'Merge group',
      tabId: 'mergingControls',
    });
    expect(_getEntityWindowOpener(world, groupEntityId)?.id).toBe('mergeGroup');
    expect(_getEntityWindowOpener(world, members[0])?.id).toBe('mergeMember');
  });
});
