import { describe, expect, it, vi } from 'vitest';

// The view renders DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);

// The registries' walks over a renderer: what the test's assets and sources say
const collected = vi.hoisted(() => ({
  assets: [] as unknown[],
  sources: [] as unknown[],
}));
vi.mock('./_dbg__GPUMemoryOwners', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_dbg__GPUMemoryOwners')>()),
  collectGPUAssets: () => collected.assets,
}));
vi.mock('./_dbg__GPUMemorySources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_dbg__GPUMemorySources')>()),
  collectGPUMemorySources: () => collected.sources,
}));

import type { Renderer } from 'three/webgpu';
import { createBindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import type { GPUAssetRow } from './_dbg__GPUMemoryOwners';
import type { GPUMemorySourceRow } from './_dbg__GPUMemorySources';
import { createGPUMemoryView, FRAME_METRICS, type GPUMemoryViewOpts } from './_dbg__GPUMemoryView';

const MB = 1024 * 1024;

const asset = (id: string, owner: string, kind: GPUAssetRow['kind'], mb: number): GPUAssetRow => ({
  key: `${kind}:${id}`,
  id,
  kind,
  owner,
  bytes: mb * MB,
  uncounted: 0,
});

const source = (id: string, label: string, mb: number, count: number): GPUMemorySourceRow => ({
  id,
  label,
  owner: 'engine',
  bytes: mb * MB,
  bySize: { texturesSize: mb * MB },
  count,
  uncounted: 0,
});

/** 300 MB: 200 MB of textures (150 of them assets', 20 a source's), 100 MB of attributes (60 of
 * them assets'), nothing else */
const createMemory = () => ({
  total: 300 * MB,
  textures: 12,
  texturesSize: 200 * MB,
  attributes: 40,
  attributesSize: 100 * MB,
  indexAttributes: 0,
  indexAttributesSize: 0,
  storageAttributes: 0,
  storageAttributesSize: 0,
  indirectStorageAttributes: 0,
  indirectStorageAttributesSize: 0,
  uniformBuffers: 0,
  uniformBuffersSize: 0,
  programs: 0,
  programsSize: 0,
  readbackBuffers: 0,
  readbackBuffersSize: 0,
  renderTargets: 3,
  geometries: 20,
});

/** An open GPU memory view over a fake renderer: its sections in the page, a refresh (the tab's,
 * then its scheduler's), and the figures it reads */
const openView = ({ refreshFirst = true } = {}) => {
  const memory = createMemory();
  const renderer = { info: { memory }, backend: { isWebGPUBackend: true } } as unknown as Renderer;
  collected.assets = [
    asset('rock', 'sceneA', 'texture', 100),
    asset('rock', 'sceneA', 'geometry', 60),
    asset('tile', 'sceneA#north', 'texture', 50),
  ];
  collected.sources = [source('engine.shadows', 'Shadow maps', 20, 2)];
  let paused = false;
  const opts: GPUMemoryViewOpts & { renderer: Renderer | null; sceneId: string } = {
    renderer,
    sceneId: 'sceneA',
    getRenderer: () => opts.renderer,
    getCurrentSceneId: () => opts.sceneId,
    getBudgetMB: () => 512,
    bootPeak: { bytes: 320 * MB, at: 0 },
    scenePeak: { bytes: 300 * MB, at: 0 },
    frameLast: new Float64Array([12, 3400, 2, 0]),
    frameWindow: {
      min: new Float64Array([10, 3000, 2, 0]),
      max: new Float64Array([14, 3800, 2, 0]),
      avg: new Float64Array([12, 3400, 2, 0]),
      frames: 30,
    },
    frameWindowMs: 500,
    isPaused: () => paused,
  };
  const scheduler = createBindingScheduler({ visible: true });
  const view = createGPUMemoryView(opts, scheduler);
  const root = document.createElement('div');
  for (const cmp of view.cmps) root.append(cmp.elem);
  document.body.append(root);
  const refresh = () => {
    view.update();
    scheduler.refresh();
  };
  if (refreshFirst) refresh();
  const table = (className: string) => root.querySelector(`.${className}`) as HTMLElement;
  const keys = (className: string, part = 'tbody') =>
    [...table(className).querySelectorAll(`${part} tr[data-key]`)].map((tr) =>
      tr.getAttribute('data-key')
    );
  const row = (className: string, key: string) =>
    table(className).querySelector(`tr[data-key="${key}"]`) as HTMLElement;
  const cells = (className: string, key: string) =>
    [...row(className, key).querySelectorAll('td')].map((td) => td.textContent);
  return {
    opts,
    memory,
    root,
    refresh,
    table,
    keys,
    row,
    cells,
    setPaused: (on: boolean) => (paused = on),
    close: () => {
      for (const cmp of view.cmps) cmp.remove();
      root.remove();
      scheduler.dispose();
    },
  };
};

describe('GPU memory tab’s live sections on the kit (p807 D8)', () => {
  it('shows the total against the budget, the categories by size and the peaks', () => {
    const tab = openView();
    expect(tab.root.querySelector('strong')?.textContent).toBe('300.0 MB');
    const bar = tab.root.querySelector('.aekStackedBar')!;
    expect(bar.getAttribute('aria-label')).toBe('GPU memory against the budget: In use 300.0 MB');
    expect(bar.hasAttribute('data-over')).toBe(false);
    expect(tab.root.textContent).toContain('59 % of the 512 MB budget');

    // By size, largest first; the two counted elsewhere in their group, their size a muted word
    expect(tab.keys('gpuMemoryCategories').slice(0, 2)).toEqual(['textures', 'attributes']);
    const targets = tab.row('gpuMemoryCategories', 'renderTargets');
    expect(targets.closest('tbody')?.getAttribute('data-key')).toBe('elsewhere');
    expect(tab.cells('gpuMemoryCategories', 'renderTargets')).toEqual(['in textures', '3']);
    expect(targets.querySelector('td')?.getAttribute('data-tone')).toBe('muted');

    expect(tab.cells('gpuMemoryPeaks', 'boot')).toEqual(['320.0 MB', '—']);
    expect(tab.root.textContent).toContain('WebGPU backend.');
    tab.close();
  });

  it('shows the figures as it is built, before the tab host’s first refresh', () => {
    const tab = openView({ refreshFirst: false });
    expect(tab.cells('gpuMemoryCategories', 'textures')).toEqual(['200.0 MB', '12']);
    expect(tab.keys('gpuMemoryOwners')[0]).toBe('owner:sceneA');
    expect(tab.cells('gpuMemorySources', 'engine.shadows')).toEqual(['20.0 MB', '2']);
    tab.close();
  });

  it('writes a changed figure in place, and says so past the budget', () => {
    const tab = openView();
    const textures = tab.row('gpuMemoryCategories', 'textures');
    const sizeText = textures.querySelector('td')?.firstChild;
    tab.memory.texturesSize = 700 * MB;
    tab.memory.total = 800 * MB;
    tab.refresh();
    expect(tab.row('gpuMemoryCategories', 'textures')).toBe(textures);
    expect(textures.querySelector('td')?.firstChild).toBe(sizeText);
    expect(sizeText?.textContent).toBe('700.0 MB');

    expect(tab.root.querySelector('.aekStackedBar')?.hasAttribute('data-over')).toBe(true);
    const budgetText = [...tab.root.querySelectorAll('p')].find((p) =>
      p.textContent?.includes('budget')
    );
    expect(budgetText?.textContent).toBe('156 % of the 512 MB budget (over budget)');
    expect(budgetText?.hasAttribute('data-over')).toBe(true);
    tab.close();
  });

  it('keeps a sort the user picked through a refresh (D9)', () => {
    const tab = openView();
    const countSort = tab
      .table('gpuMemoryCategories')
      .querySelector('th[data-key="count"] button') as HTMLButtonElement;
    countSort.click();
    // The main rows by count, ascending (the group "Counted elsewhere" sorted apart, after them)
    const sorted = () => tab.keys('gpuMemoryCategories', 'tbody:not([data-key])');
    expect(sorted().slice(-2)).toEqual(['textures', 'attributes']);
    tab.memory.attributes = 41;
    tab.refresh();
    expect(sorted().slice(-2)).toEqual(['textures', 'attributes']);
    expect(
      tab
        .table('gpuMemoryCategories')
        .querySelector('th[data-key="count"]')
        ?.getAttribute('aria-sort')
    ).toBe('ascending');
    tab.close();
  });

  it('shows the frame counters and the paused main loop on a line of its own', () => {
    const tab = openView();
    expect(tab.keys('gpuMemoryFrame')).toEqual([...FRAME_METRICS]);
    expect(tab.cells('gpuMemoryFrame', 'Triangles')).toEqual(['3,400', '3,000', '3,400', '3,800']);
    const paused = tab.root.querySelector('.gpuMemoryPaused') as HTMLElement;
    expect(paused.hidden).toBe(true);
    tab.setPaused(true);
    tab.opts.frameLast[1] = 3500;
    tab.refresh();
    expect(paused.hidden).toBe(false);
    expect(paused.textContent).toContain('paused');
    expect(tab.cells('gpuMemoryFrame', 'Triangles')[0]).toBe('3,500');
    tab.close();
  });

  it('lists the owners with their cells, the current scene’s badge, the untracked and the total', () => {
    const tab = openView();
    expect(tab.keys('gpuMemoryOwners')).toEqual([
      'owner:sceneA',
      'owner:sceneA#north',
      'owner:engine',
      'untracked',
    ]);
    const scene = tab.row('gpuMemoryOwners', 'owner:sceneA');
    const badgeOf = (key: string) =>
      tab.row('gpuMemoryOwners', key).querySelector('.aekBadge') as HTMLElement;
    expect(scene.querySelector('th')?.textContent).toBe('sceneA current');
    expect(badgeOf('owner:sceneA').hidden).toBe(false);
    expect(badgeOf('owner:engine').hidden).toBe(true);
    expect(tab.cells('gpuMemoryOwners', 'owner:sceneA')).toEqual([
      '150.0 MB',
      '60.0 MB',
      '210.0 MB',
      '3',
    ]);
    const cell = tab.row('gpuMemoryOwners', 'owner:sceneA#north').querySelector('th span');
    expect(cell?.getAttribute('data-level')).toBe('1');
    expect(cell?.textContent).toBe('north');
    expect(
      tab.row('gpuMemoryOwners', 'owner:engine').querySelector('th span span')?.textContent
    ).toBe('engine (no scene)');
    // 300 MB less the 230 MB counted
    expect(tab.cells('gpuMemoryOwners', 'untracked')).toEqual(['', '', '70.0 MB', '23 %']);
    expect(
      tab.row('gpuMemoryOwners', 'untracked').querySelector('td')?.getAttribute('data-tone')
    ).toBe('muted');
    expect(tab.keys('gpuMemoryOwners', 'tfoot')).toEqual(['total']);

    // The next scene: the badge moves in place
    const badge = badgeOf('owner:sceneA');
    tab.opts.sceneId = 'sceneB';
    tab.refresh();
    expect(tab.row('gpuMemoryOwners', 'owner:sceneA')).toBe(scene);
    expect(badge.hidden).toBe(true);

    // The untracked: what neither the assets nor the sources count, by size
    expect(tab.keys('gpuMemoryUntracked')).toEqual(['Attributes + index', 'Textures']);
    expect(tab.cells('gpuMemoryUntracked', 'Textures')).toEqual(['30.0 MB']);
    tab.close();
  });

  it('names a source with its owner and id, muted while it holds nothing', () => {
    const tab = openView();
    const shadows = tab.row('gpuMemorySources', 'engine.shadows');
    expect(shadows.querySelector('.profilerName__sub')?.textContent).toBe(
      'engine (no scene) · engine.shadows'
    );
    expect(tab.cells('gpuMemorySources', 'engine.shadows')).toEqual(['20.0 MB', '2']);
    expect(tab.cells('gpuMemorySources', 'total')).toEqual(['20.0 MB', '']);

    collected.sources = [source('engine.shadows', 'Shadow maps', 0, 0)];
    tab.refresh();
    expect(tab.row('gpuMemorySources', 'engine.shadows')).toBe(shadows);
    expect(shadows.querySelector('td')?.getAttribute('data-tone')).toBe('muted');

    collected.sources = [];
    tab.refresh();
    expect(tab.table('gpuMemorySources').textContent).toContain('No sources registered.');
    expect(tab.keys('gpuMemorySources', 'tfoot')).toEqual([]);
    tab.close();
  });

  it('says there is no renderer yet in place of the figures', () => {
    const tab = openView();
    tab.opts.renderer = null;
    tab.refresh();
    expect(tab.root.textContent).toContain('No renderer yet.');
    expect(
      (tab.root.querySelector('.gpuMemoryCategories')?.parentElement as HTMLElement).hidden
    ).toBe(true);
    tab.close();
  });
});
