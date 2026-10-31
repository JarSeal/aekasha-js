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

// The tab's definition, captured; the impostors and their export, and the dev server's answer
const tab = vi.hoisted(() => ({ def: null as unknown, update: vi.fn() }));
vi.mock(import('../../../debug/DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  createDebuggerTab: (def: unknown) => {
    tab.def = def;
  },
  updateDebuggerTab: tab.update,
  debuggerListCMP: vi.fn() as never,
}));
const imp = vi.hoisted(() => ({ records: [] as unknown[] }));
vi.mock(import('../impostors/ImpostorRegistry'), async (importOriginal) => ({
  ...(await importOriginal()),
  getImpostorRecords: () => imp.records as never,
}));
vi.mock(import('./_dbg__ImpostorExport'), async (importOriginal) => ({
  ...(await importOriginal()),
  getImpostorExportState: () => 'EXPORTED',
  isImpostorExportRunning: () => false,
  exportImpostorsAsync: vi.fn(() => Promise.resolve()),
}));
vi.mock(import('../../../debug/DevFiles'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDevFilesStatus: () => Promise.resolve({ available: false, message: 'no dev server' } as never),
}));

import { stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import type { AnyDebuggerTabDef } from '../../../debug/DebuggerGUI';
import { _buildDebuggerPane } from '../../../debug/_dbg__DebuggerPaneBuilder';
import { createBindingScheduler } from '../../../ui/forms/binding/BindingScheduler';
import type { LodData } from '../LodTypes';
import { _createLodDebugGUI, formatLodCounts, getLodMeshListData } from './_dbg__LOD';

// p806 D11: the LOD tab split into its folders' builders: the counts and the mesh list, the
// impostors as rows that fit the value column, the dev files note, and the rebuild a new level
// count asks for

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  world = new ECSWorld();
  _createLodDebugGUI();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  tab.update.mockClear();
  imp.records = [];
});

/** A LOD entity showing `applied` of `levels` levels; `target` makes it a pool instance */
const addLod = (w: ECSWorld, applied: number, levels = 3, target = false) => {
  const entityId = w.createEntity();
  w.addComponent(entityId, ComponentType.LOD, {
    def: { levels: [] },
    level: applied,
    applied,
    radius: 1,
    _levels: Array.from({ length: levels }, () => ({ geometry: { userData: {} } })),
    ...(target ? { _target: {} } : {}),
  } as unknown as LodData);
  return entityId;
};

const getDef = () => tab.def as AnyDebuggerTabDef;
const buildTab = () => {
  const def = getDef();
  const [section] = def.content({ scheduler: createBindingScheduler() }) as Parameters<
    typeof _buildDebuggerPane
  >[1][];
  const pane = _buildDebuggerPane(def, section);
  document.body.append(pane.cmp.elem);
  built.push(pane.cmp);
  return pane;
};
const getFolder = (root: Element, title: string) =>
  [...root.querySelectorAll('.aekFolder')].find(
    (folder) => folder.querySelector('.aekFolder__title')?.textContent === title
  ) as HTMLElement;
const getRows = (folder: Element) =>
  [...folder.querySelectorAll('.aekField')].map((field) => [
    field.querySelector('.aekField__label')?.textContent,
    field.querySelector('.aekMonitor__value')?.textContent,
  ]);
const getButtons = (root: Element) =>
  [...root.querySelectorAll('button.aekButton')].map((button) => button.textContent);
const getNotes = (root: Element) => [...root.querySelectorAll('p')].map((p) => p.textContent);

describe('the LOD tab (p806 D11)', () => {
  it('counts the entities by the level they show and why the others are hidden', () => {
    const w = new ECSWorld({ id: 'counts' });
    const shown = addLod(w, 2);
    addLod(w, 0);
    addLod(w, 1, 2, true);
    w.addComponent(addLod(w, 1), ComponentType.TAG_LOD_CULLED, true);
    w.addComponent(addLod(w, 1), ComponentType.TAG_FRUSTUM_CULLED, true);

    const counts = formatLodCounts(w);
    expect(counts.levelCount).toBe(3);
    expect(counts.text.split('\n')).toEqual([
      'Level 0           1',
      'Level 1           1',
      'Level 2           1',
      'LOD culled        1',
      'Out of view       1',
      'Total             5',
    ]);
    // The list leaves the pool instance out
    const rows = getLodMeshListData(w);
    expect(rows.map((row) => row.suffix)).toEqual(['L2', 'L0', 'culled', 'out of view']);
    expect(rows[0].itemId).toBe(String(shown));
  });

  it('lists the first 100 meshes and how many more there are', () => {
    const w = new ECSWorld({ id: 'many' });
    for (let i = 0; i < 103; i++) addLod(w, 0);
    const rows = getLodMeshListData(w);
    expect(rows).toHaveLength(101);
    expect(rows[100]).toMatchObject({ itemId: 'more', title: '…and 3 more', disabled: true });
  });

  it('says there are no impostors, and what Export does once the dev server answers', async () => {
    const pane = buildTab();
    const folder = getFolder(pane.cmp.elem, 'Impostors');
    expect(getNotes(folder)).toEqual([
      'Checking the dev files…',
      'No impostors generated in this scene.',
    ]);
    expect(getButtons(folder)).not.toContain('Export all');

    const cleanup = getDef().onOpen?.();
    await vi.waitFor(() => expect(tab.update).toHaveBeenCalledWith('lodControls'));
    pane.refresh();
    expect(getNotes(folder)[0]).toBe('Export downloads the files: no dev server.');
    if (typeof cleanup === 'function') cleanup();
  });

  it("shows an impostor's kind, source, export, atlas and bake as rows with its Export", () => {
    imp.records = [
      { id: 'treeImpostor', kind: 'CROSS_QUADS', origin: 'BAKED', source: {}, bakeMs: 91.4 },
    ];
    const pane = buildTab();
    const folder = getFolder(pane.cmp.elem, 'treeImpostor');
    expect(getRows(folder)).toEqual([
      ['Kind', 'Cross-quads'],
      ['Source', 'Baked'],
      ['Export', 'Up to date'],
      ['Atlas', 'None'],
      ['Bake', '91 ms'],
    ]);
    expect(getButtons(folder)).toEqual(['Re-export']);
    expect(getButtons(getFolder(pane.cmp.elem, 'Impostors'))).toContain('Export all');
    expect(getNotes(getFolder(pane.cmp.elem, 'Impostors'))).not.toContain(
      'No impostors generated in this scene.'
    );
  });

  it('rebuilds the tab when an entity with more levels appears', async () => {
    addLod(world, 0, 2);
    // Built for the world's level count: a refresh asks for nothing
    getDef().onRefresh?.();
    buildTab();
    await Promise.resolve();
    tab.update.mockClear();
    getDef().onRefresh?.();
    await Promise.resolve();
    expect(tab.update).not.toHaveBeenCalled();

    addLod(world, 0, 4);
    getDef().onRefresh?.();
    await Promise.resolve();
    expect(tab.update).toHaveBeenCalledWith('lodControls', { rebuild: true });
  });
});
