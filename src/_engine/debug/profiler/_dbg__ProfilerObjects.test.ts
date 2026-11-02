import { describe, expect, it, vi } from 'vitest';

// The tab renders DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);
vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

import { createBindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import type { CMPHandle } from '../../ui/core/CMPTypes';
import { initEnvironment } from '../../kernel/config/Config';
import { DEFAULT_PROFILER_SETTINGS, registerStatsSource, type ProfilerSettings } from '../Profiler';
import {
  CENSUS_KINDS,
  type CensusBucket,
  type CensusHeavyObject,
  type CensusKind,
  type SceneCensus,
} from './_dbg__Census';
import { createProfilerObjectsTabDef } from './_dbg__ProfilerObjects';
import { PROFILER_SOURCE, type DrawStats } from './_dbg__ProfilerSources';

initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });

const bucket = (objects: number, inView: number, triangles = 0): CensusBucket => ({
  objects: { inView, total: objects },
  instances: { inView: 0, total: 0 },
  primitives: { inView: triangles / 2, total: triangles },
  triangles: { inView: triangles / 2, total: triangles },
  vertices: { inView: triangles, total: triangles * 2 },
});

const heavy = (name: string, triangles: number): CensusHeavyObject => ({
  name,
  entityName: `${name} entity`,
  kind: 'MESH',
  triangles,
  instances: 1,
  entityId: -1,
  worldId: '',
});

/** A census of 4 meshes (2 in view, 4,000 triangles) and 2 lines, and its draw counters */
const createCensus = () => {
  const kinds = Object.fromEntries(CENSUS_KINDS.map((kind) => [kind, bucket(0, 0)])) as Record<
    CensusKind,
    CensusBucket
  >;
  kinds.MESH = bucket(4, 2, 4000);
  kinds.LINES = bucket(2, 2);
  return {
    kinds,
    owners: [{ key: 'SCENE', label: 'Scene', bucket: kinds.MESH }],
    heaviest: [heavy('Rock', 3000), heavy('Tree', 1000)],
    meshes: kinds.MESH,
    isDebugCamera: false,
    view: null,
    isApprox: false,
    excludesDebugHelpers: true,
    sampleMs: 0.25,
    sampledAt: 1,
  } as unknown as SceneCensus & { heaviest: CensusHeavyObject[]; sampledAt: number };
};

const draw = { drawCalls: { avg: 12, max: 14 } } as unknown as DrawStats;

/** An open Objects tab on a fake census: its sections, a refresh (the tab's, then its
 * scheduler's) and its settings' changes */
const openObjects = () => {
  const census = createCensus();
  const removeCensus = registerStatsSource({
    id: PROFILER_SOURCE.CENSUS,
    label: 'Census',
    read: () => census,
  });
  const removeDraw = registerStatsSource({
    id: PROFILER_SOURCE.DRAW,
    label: 'Draw',
    read: () => draw,
  });
  const settings: ProfilerSettings = { ...DEFAULT_PROFILER_SETTINGS, overviewMetrics: [] };
  const setSettings = vi.fn((partial: Partial<ProfilerSettings>) =>
    Object.assign(settings, partial)
  );
  const scheduler = createBindingScheduler({ visible: true });
  const def = createProfilerObjectsTabDef({ settings, setSettings });
  const root = document.createElement('div');
  const cmps = def.content({ scheduler }) as CMPHandle[];
  for (const cmp of cmps) root.append(cmp.elem);
  document.body.append(root);
  const close = def.onOpen?.();
  const refresh = () => {
    def.onRefresh?.();
    scheduler.refresh();
  };
  const table = (className: string) => root.querySelector(`.${className}`) as HTMLElement;
  const keys = (className: string, part = 'tbody') =>
    [...table(className).querySelectorAll(`${part} tr[data-key]`)].map((tr) =>
      tr.getAttribute('data-key')
    );
  return {
    def,
    root,
    census,
    settings,
    setSettings,
    refresh,
    table,
    keys,
    close: () => {
      if (typeof close === 'function') close();
      for (const cmp of cmps) cmp.remove();
      root.remove();
      scheduler.dispose();
      removeCensus();
      removeDraw();
    },
  };
};

describe('profiler Objects tab on the kit (p807 D7)', () => {
  it('says it is measuring until the first census, then shows its rows', () => {
    const objects = openObjects();
    expect(objects.table('profilerBreakdown').textContent).toContain('measuring…');
    expect(objects.root.querySelector('.profilerObjectsNote')?.textContent).toBe('measuring…');

    objects.refresh();
    expect(objects.keys('profilerBreakdown')).toEqual(['MESH', 'LINES']);
    expect(objects.keys('profilerBreakdown', 'tfoot')).toEqual(['total']);
    expect(objects.root.querySelector('.profilerObjectsNote')?.textContent).toContain(
      'census 0.25 ms'
    );
    const mesh = objects.table('profilerBreakdown').querySelector('tr[data-key="MESH"]')!;
    expect(mesh.querySelector('th')?.textContent).toBe('Mesh');
    expect([...mesh.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      '2 / 4',
      '2,000 / 4,000',
      '4,000 / 8,000',
      '100.0 %',
    ]);
    // Lines have no triangles: a muted dash
    const lines = objects.table('profilerBreakdown').querySelector('tr[data-key="LINES"]')!;
    const linesTriangles = lines.querySelectorAll('td')[1];
    expect(linesTriangles.textContent).toBe('—');
    expect(linesTriangles.getAttribute('data-tone')).toBe('muted');
    objects.close();
  });

  it('switches the bars’ measure through the segmented control, which follows the setting', () => {
    const objects = openObjects();
    objects.refresh();
    const radios = [
      ...objects.root.querySelectorAll<HTMLInputElement>(
        '.profilerObjectsHead input[type="radio"]'
      ),
    ];
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
    radios[2].checked = true;
    radios[2].dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(objects.setSettings).toHaveBeenCalledWith({ objectsBarMeasure: 'OBJECTS' });

    // By objects, the lines are a third of the scene
    objects.refresh();
    const lines = objects.table('profilerBreakdown').querySelector('tr[data-key="LINES"]')!;
    expect(lines.querySelectorAll('td')[3].textContent).toBe('33.3 %');
    objects.close();
  });

  it('keeps a heaviest object’s row as its rank changes, its sub line written in place', () => {
    const objects = openObjects();
    objects.refresh();
    const [rockKey, treeKey] = objects.keys('profilerHeaviest');
    expect(rockKey).toContain('Rock');
    const rockRow = objects.table('profilerHeaviest').querySelector(`tr[data-key="${rockKey}"]`);
    const subNode = rockRow?.querySelector('.profilerName__sub')?.firstChild;
    expect(subNode?.textContent).toBe('Rock entity');

    const [rock, tree] = objects.census.heaviest;
    tree.triangles = 5000;
    rock.entityName = 'Boulder';
    objects.census.heaviest = [tree, rock];
    objects.census.sampledAt = 2;
    objects.refresh();
    expect(objects.keys('profilerHeaviest')).toEqual([treeKey, rockKey]);
    const movedRow = objects.table('profilerHeaviest').querySelector(`tr[data-key="${rockKey}"]`);
    expect(movedRow).toBe(rockRow);
    expect(movedRow?.querySelector('td')?.textContent).toBe('2');
    expect(movedRow?.querySelector('.profilerName__sub')?.firstChild).toBe(subNode);
    expect(subNode?.textContent).toBe('Boulder');
    objects.close();
  });

  it('draws a sample per census walk in the sparklines, with the latest and the max', () => {
    const objects = openObjects();
    objects.refresh();
    // A refresh between two walks reads the same census: no new sample
    objects.refresh();
    const triangles = objects.root.querySelector('.profilerSpark')!;
    expect(triangles.querySelector('.profilerSpark__latest')?.textContent).toBe('2,000');

    objects.census.meshes.triangles.inView = 3000;
    objects.census.sampledAt = 2;
    objects.refresh();
    expect(triangles.querySelector('.profilerSpark__latest')?.textContent).toBe('3,000');
    expect(triangles.querySelector('.profilerSpark__max')?.textContent).toBe('max 3,000');
    expect(triangles.querySelector('.aekSparkline')?.getAttribute('aria-hidden')).toBe('true');
    objects.close();
  });

  it('is kept on a scene change, its history starting again (p807 D9)', () => {
    const objects = openObjects();
    expect(objects.def.keepOnSceneChange).toBe(true);
    objects.refresh();
    objects.census.meshes.triangles.inView = 3000;
    objects.census.sampledAt = 2;
    objects.refresh();
    const triangles = objects.root.querySelector('.profilerSpark')!;
    expect(triangles.querySelector('.profilerSpark__max')?.textContent).toBe('max 3,000');

    // The next scene: the old samples forgotten, the same elements
    objects.def.onSceneChange?.();
    objects.census.meshes.triangles.inView = 500;
    objects.census.sampledAt = 3;
    objects.refresh();
    expect(objects.root.querySelector('.profilerSpark')).toBe(triangles);
    expect(triangles.querySelector('.profilerSpark__max')?.textContent).toBe('max 500');
    objects.close();
  });
});
