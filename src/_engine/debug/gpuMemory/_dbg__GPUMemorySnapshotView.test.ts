import { describe, expect, it, vi } from 'vitest';

// The view renders DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);

// The snapshot and its diff: what the test says
const snapshots = vi.hoisted(() => ({
  snapshot: null as unknown,
  diff: null as unknown,
  /** The assets each diff read was given */
  diffAssets: [] as unknown[],
}));
vi.mock('./_dbg__GPUMemorySnapshots', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_dbg__GPUMemorySnapshots')>()),
  getGPUMemorySnapshot: () => snapshots.snapshot,
  getGPUMemoryDiff: (_renderer: unknown, assets?: unknown) => {
    snapshots.diffAssets.push(assets);
    return snapshots.diff;
  },
}));

import type { Renderer } from 'three/webgpu';
import { createBindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import type { AllocationGroup, AssetChange, GPUMemoryDiff } from './_dbg__GPUMemorySnapshots';
import { createGPUMemorySnapshotView } from './_dbg__GPUMemorySnapshotView';

const MB = 1024 * 1024;

const leftGroup = (i: number): AllocationGroup => ({
  kind: 'texture',
  label: `Texture ${i}`,
  scene: 'sceneB',
  visit: 2,
  site: i === 0 ? 'Lanes.ts:88' : undefined,
  count: 1,
  bytes: MB,
  collected: 0,
});

const assetChange = (id: string, before: number, after: number): AssetChange => ({
  key: `texture:${id}`,
  id,
  kind: 'texture',
  owner: 'sceneA',
  before: before * MB,
  after: after * MB,
});

/** A diff since a snapshot in sceneA: textures grew by 4 MB and 2, 13 groups left behind (one
 * more than a table shows), a new asset and a gone one */
const createDiff = (): GPUMemoryDiff => ({
  memory: [
    { key: 'total', before: 100 * MB, after: 104 * MB },
    { key: 'texturesSize', before: 60 * MB, after: 64 * MB },
    { key: 'textures', before: 10, after: 12 },
    { key: 'attributesSize', before: 30 * MB, after: 30 * MB },
  ],
  assets: [assetChange('rock', 0, 5), assetChange('castle', 2, 0)],
  leftBehind: Array.from({ length: 13 }, (_, i) => leftGroup(i)),
  currentVisit: { count: 3, bytes: 2 * MB },
  freed: { count: 1, bytes: MB },
});

/** An open snapshot section over a fake renderer: its element, a refresh (the tab's, then its
 * scheduler's) and its parts */
const openSnapshot = () => {
  let recordSites = false;
  const scheduler = createBindingScheduler({ visible: true });
  const view = createGPUMemorySnapshotView(
    { getRenderer: () => ({}) as Renderer, isRecordingSites: () => recordSites },
    scheduler
  );
  const root = view.cmp.elem;
  document.body.append(root);
  const refresh = () => {
    view.update();
    scheduler.refresh();
  };
  const table = (className: string) => root.querySelector(`.${className}`) as HTMLElement;
  const keys = (className: string, part = 'tbody') =>
    [...table(className).querySelectorAll(`${part} tr[data-key]`)].map((tr) =>
      tr.getAttribute('data-key')
    );
  const cells = (className: string, key: string) =>
    [...table(className).querySelectorAll(`tr[data-key="${key}"] td`)].map((td) => td.textContent);
  return {
    root,
    refresh,
    table,
    keys,
    cells,
    setRecordSites: (on: boolean) => (recordSites = on),
    close: () => {
      view.cmp.remove();
      scheduler.dispose();
    },
  };
};

describe('GPU memory tab’s snapshot section on the kit (p807 D8)', () => {
  it('says how to take one while there is no snapshot', () => {
    snapshots.snapshot = null;
    snapshots.diff = null;
    const section = openSnapshot();
    expect(section.root.querySelector('h4')?.textContent).toBe('Snapshot');
    expect(section.root.textContent).toContain('No snapshot. For leak hunting');
    expect((section.table('gpuMemoryLeftBehind').parentElement as HTMLElement).hidden).toBe(true);
    section.close();
  });

  it('lists the diff since a snapshot, at most 12 rows with the rest in the footer', () => {
    snapshots.snapshot = { sceneId: 'sceneA', at: 0 };
    snapshots.diff = createDiff();
    const section = openSnapshot();
    expect(section.root.querySelector('h4')?.textContent).toBe('Since the snapshot in sceneA at —');
    expect(section.root.querySelector('strong')?.textContent).toBe('+4.00 MB');

    // Only the categories that changed, signed
    expect(section.keys('gpuMemorySnapshotCategories')).toEqual(['textures']);
    expect(section.cells('gpuMemorySnapshotCategories', 'textures')).toEqual(['+4.00 MB', '+2']);

    const left = section.keys('gpuMemoryLeftBehind');
    expect(left).toHaveLength(12);
    const first = section.table('gpuMemoryLeftBehind').querySelector(`tr[data-key="${left[0]}"]`)!;
    expect(first.querySelector('th')?.textContent).toBe(
      'Texture: Texture 0sceneB, visit 2 · Lanes.ts:88'
    );
    expect(section.keys('gpuMemoryLeftBehind', 'tfoot')).toEqual(['more', 'total']);
    expect(section.table('gpuMemoryLeftBehind').querySelector('tfoot th')?.textContent).toBe(
      '+1 more (Log diff lists all)'
    );
    expect(section.cells('gpuMemoryLeftBehind', 'total')).toEqual(['13', '13.0 MB']);

    // The assets: their counts on a line, a new one and a gone one, the kind and owner under the id
    expect(section.root.textContent).toContain('Registered assets: 1 new, 1 gone, net +3.00 MB.');
    expect(section.cells('gpuMemoryAssetDiff', 'texture:rock')).toEqual([
      'new',
      '5.00 MB',
      '+5.00 MB',
    ]);
    expect(section.cells('gpuMemoryAssetDiff', 'texture:castle')).toEqual([
      '2.00 MB',
      'gone',
      '−2.00 MB',
    ]);
    expect(
      section.table('gpuMemoryAssetDiff').querySelector('.profilerName__sub')?.textContent
    ).toBe('texture, sceneA');
    expect(section.keys('gpuMemoryAssetDiff', 'tfoot')).toEqual([]);
    expect(section.root.textContent).toContain('Turn on "Call sites"');
    section.close();
  });

  it('keeps a row through a refresh, and goes back to the note when the snapshot is cleared', () => {
    snapshots.snapshot = { sceneId: 'sceneA', at: 0 };
    snapshots.diff = createDiff();
    const section = openSnapshot();
    const rock = section.table('gpuMemoryAssetDiff').querySelector('tr[data-key="texture:rock"]');

    const diff = createDiff();
    diff.assets[0].after = 6 * MB;
    diff.leftBehind = [];
    snapshots.diff = diff;
    section.setRecordSites(true);
    section.refresh();
    expect(section.table('gpuMemoryAssetDiff').querySelector('tr[data-key="texture:rock"]')).toBe(
      rock
    );
    expect(section.cells('gpuMemoryAssetDiff', 'texture:rock')).toEqual([
      'new',
      '6.00 MB',
      '+6.00 MB',
    ]);
    // Nothing left behind: the table's empty text with its headers, no footer
    expect(section.table('gpuMemoryLeftBehind').textContent).toContain(
      'No earlier scene visit since the snapshot left anything allocated.'
    );
    expect(section.keys('gpuMemoryLeftBehind', 'tfoot')).toEqual([]);
    expect(section.root.textContent).not.toContain('Turn on "Call sites"');

    snapshots.snapshot = null;
    snapshots.diff = null;
    section.refresh();
    expect(section.root.querySelector('h4')?.textContent).toBe('Snapshot');
    expect(section.root.textContent).toContain('No snapshot.');
    section.close();
  });
  it("reads the diff with the live view's assets when the refresh has them (one walk)", () => {
    snapshots.snapshot = {};
    snapshots.diff = null;
    const view = createGPUMemorySnapshotView(
      { getRenderer: () => ({}) as Renderer, isRecordingSites: () => false },
      createBindingScheduler({ visible: true })
    );
    const assets = [
      { key: 'texture:a', kind: 'texture', id: 'a', owner: 'x', bytes: 1, uncounted: 0 },
    ];
    snapshots.diffAssets.length = 0;
    view.update(assets as never);
    view.update();
    expect(snapshots.diffAssets).toEqual([assets, undefined]);
    view.cmp.remove();
  });
});
