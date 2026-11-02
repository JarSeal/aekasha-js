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

/** The `setCell` calls of the tables the tab made, newest table last */
const setCellCalls = vi.hoisted(() => [] as [string, string, unknown][][]);

// The kit's table, with its `setCell` calls recorded
vi.mock('../../ui/data/Table', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/data/Table')>();
  return {
    ...actual,
    createTable: <T>(props: Parameters<typeof actual.createTable<T>>[0]) => {
      const table = actual.createTable<T>(props);
      const calls: [string, string, unknown][] = [];
      setCellCalls.push(calls);
      return {
        ...table,
        setCell: (key: string, column: string, value: unknown) => {
          calls.push([key, column, value]);
          table.setCell(key, column, value);
        },
      };
    },
  };
});

import { createBindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import type { CMPHandle } from '../../ui/core/CMPTypes';
import { initEnvironment } from '../../kernel/config/Config';
import { DEFAULT_PROFILER_SETTINGS, registerStatsSource, type ProfilerSettings } from '../Profiler';
import {
  APP_METRIC_PREFIX,
  createProfilerOverviewTabDef,
  getOverviewMetricEntries,
  getOverviewMetricLabel,
  isAppMetricId,
  sanitizeOverviewMetrics,
} from './_dbg__ProfilerOverview';

initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });

const createSettings = (): ProfilerSettings => ({
  ...DEFAULT_PROFILER_SETTINGS,
  overviewMetrics: sanitizeOverviewMetrics([]),
});

/** Settings showing the app rows only (an open tab holds no engine source, which needs a renderer) */
const createAppOnlySettings = (): ProfilerSettings => ({
  ...DEFAULT_PROFILER_SETTINGS,
  overviewMetrics: sanitizeOverviewMetrics([]).map((e) => ({ ...e, visible: isAppMetricId(e.id) })),
});

/** The Overview's text, as one render shows it. */
const renderOverview = (settings: ProfilerSettings) => {
  const scheduler = createBindingScheduler({ visible: false });
  const [table] = createProfilerOverviewTabDef(settings).content({ scheduler }) as CMPHandle[];
  const text = table.elem.textContent ?? '';
  table.remove();
  return text;
};

/** An open Overview tab: its table, a refresh, and its rows' keys and value cells */
const openOverview = (settings: ProfilerSettings) => {
  const def = createProfilerOverviewTabDef(settings);
  const [table] = def.content({
    scheduler: createBindingScheduler({ visible: false }),
  }) as CMPHandle[];
  const close = def.onOpen?.();
  const calls = setCellCalls[setCellCalls.length - 1];
  const rowElems = () => [...table.elem.querySelectorAll('tbody tr[data-key]')] as HTMLElement[];
  const valueCell = (key: string) =>
    table.elem.querySelector(`tr[data-key="${key}"] td`) as HTMLElement;
  return {
    table,
    calls,
    refresh: () => def.onRefresh?.(),
    keys: () => rowElems().map((row) => row.getAttribute('data-key')),
    rowElem: (key: string) => rowElems().find((row) => row.getAttribute('data-key') === key),
    valueCell,
    close: () => {
      if (typeof close === 'function') close();
      table.remove();
    },
  };
};

describe('profiler Overview: app stats sources (p618 D14)', () => {
  it('shows a registered source in the App group, formatted', () => {
    const removeCount = registerStatsSource({ id: 'test.boxes', label: 'Boxes', read: () => 12 });
    const removeName = registerStatsSource({
      id: 'test.level',
      label: 'Level',
      read: () => ({ world: 1, stage: 2 }),
      format: (value) => `world ${value.world}-${value.stage}`,
    });
    const settings = createSettings();

    const text = renderOverview(settings);
    expect(text).toContain('App');
    expect(text).toContain('Boxes12.00');
    expect(text).toContain('Levelworld 1-2');
    // After the engine's rows
    expect(text.indexOf('Boxes')).toBeGreaterThan(text.indexOf('FPS'));

    removeCount();
    removeName();
  });

  it('shows "measuring…" before a first value, and "n/a" with its reason', () => {
    const removePending = registerStatsSource({
      id: 'test.pending',
      label: 'Pending',
      read: () => null,
    });
    const removeNa = registerStatsSource({
      id: 'test.na',
      label: 'Streaming',
      read: () => 1,
      availability: () => 'no world loaded',
    });
    const text = renderOverview(createSettings());
    expect(text).toContain('measuring…');
    expect(text).toContain('Streamingn/ano world loaded');
    removePending();
    removeNa();
  });

  it('adds a row for a source registered after the list was sanitized, shown', () => {
    const settings = createSettings();
    const remove = registerStatsSource({ id: 'test.late', label: 'Late', read: () => 'ready' });

    const entries = getOverviewMetricEntries(settings);
    expect(entries.at(-1)).toEqual({ id: `${APP_METRIC_PREFIX}test.late`, visible: true });
    expect(renderOverview(settings)).toContain('Lateready');

    // Hidden in the settings: not shown
    settings.overviewMetrics = entries.map((e) =>
      e.id === `${APP_METRIC_PREFIX}test.late` ? { ...e, visible: false } : e
    );
    expect(renderOverview(settings)).not.toContain('Late');
    remove();
  });

  it('keeps a saved app row while its source is away, and puts app rows last', () => {
    const saved = [
      { id: `${APP_METRIC_PREFIX}test.away`, visible: false },
      { id: 'fps', visible: true },
      { id: 'unknown', visible: true },
    ];
    const list = sanitizeOverviewMetrics(saved);
    expect(list.at(-1)).toEqual({ id: `${APP_METRIC_PREFIX}test.away`, visible: false });
    expect(list[0]).toEqual({ id: 'fps', visible: true });
    expect(list.some((e) => e.id === 'unknown')).toBe(false);
    expect(getOverviewMetricLabel(`${APP_METRIC_PREFIX}test.away`)).toBe(
      'test.away (not registered)'
    );
  });
});

describe('profiler Overview: the table updated in place (p807 D6)', () => {
  it('is one table with a hidden caption, its columns and the engine rows by metric id', () => {
    expect(createProfilerOverviewTabDef(createSettings()).keepOnSceneChange).toBe(true);
    const { table, keys, close } = openOverview(createSettings());
    const caption = table.elem.querySelector('caption');
    expect(caption?.textContent).toBe('Overview');
    expect(caption?.classList.contains('aekVisuallyHidden')).toBe(true);
    const headers = [...table.elem.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['Metric', 'Value', 'Detail']);
    expect(keys().slice(0, 3)).toEqual(['tfps', 'fps', 'frameTime']);
    expect(table.elem.querySelector('tr[data-key="fps"] th')?.getAttribute('scope')).toBe('row');
    close();
  });

  it('writes only the figures that changed on a refresh, in the same row and text node', () => {
    let boxes = 12;
    let away: string | null = null;
    const removeBoxes = registerStatsSource({
      id: 'test.live',
      label: 'Live',
      read: () => boxes,
      availability: () => away ?? true,
    });
    const removeStill = registerStatsSource({ id: 'test.still', label: 'Still', read: () => 'on' });
    const overview = openOverview(createAppOnlySettings());
    const liveKey = `${APP_METRIC_PREFIX}test.live`;
    const row = overview.rowElem(liveKey);
    const textNode = overview.valueCell(liveKey).firstChild;
    expect(overview.valueCell(liveKey).textContent).toBe('12.00');
    expect(overview.calls).toEqual([]);

    // Nothing changed: no cell written
    overview.refresh();
    expect(overview.calls).toEqual([]);

    boxes = 13;
    overview.refresh();
    expect(overview.calls).toEqual([[liveKey, 'value', '13.00']]);
    expect(overview.valueCell(liveKey).textContent).toBe('13.00');
    expect(overview.rowElem(liveKey)).toBe(row);
    expect(overview.valueCell(liveKey).firstChild).toBe(textNode);

    // n/a: the value's word, its reason the detail's text
    overview.calls.length = 0;
    away = 'no world loaded';
    overview.refresh();
    expect(overview.calls).toEqual([
      [liveKey, 'value', 'n/a'],
      [liveKey, 'detail', 'no world loaded'],
    ]);
    expect(overview.valueCell(liveKey).getAttribute('data-tone')).toBe('muted');
    overview.close();
    removeBoxes();
    removeStill();
  });

  it('keeps the rows by key through a reorder and a hidden row, and the App group', () => {
    const removeA = registerStatsSource({ id: 'test.a', label: 'A', read: () => 1 });
    const removeB = registerStatsSource({ id: 'test.b', label: 'B', read: () => 2 });
    const settings = createAppOnlySettings();
    const overview = openOverview(settings);
    const a = `${APP_METRIC_PREFIX}test.a`;
    const b = `${APP_METRIC_PREFIX}test.b`;
    expect(overview.keys()).toEqual([a, b]);
    expect(overview.table.elem.querySelector('.aekTable__groupHeader')?.textContent).toBe('App');
    const rowA = overview.rowElem(a);

    // The Settings tab's reorder: the same rows, moved
    const entries = settings.overviewMetrics;
    const indexA = entries.findIndex((e) => e.id === a);
    const indexB = entries.findIndex((e) => e.id === b);
    const moved = [...entries];
    [moved[indexA], moved[indexB]] = [moved[indexB], moved[indexA]];
    settings.overviewMetrics = moved;
    overview.refresh();
    expect(overview.keys()).toEqual([b, a]);
    expect(overview.rowElem(a)).toBe(rowA);

    // Hidden: its row goes
    settings.overviewMetrics = moved.map((e) => (e.id === b ? { ...e, visible: false } : e));
    overview.refresh();
    expect(overview.keys()).toEqual([a]);
    overview.close();
    removeA();
    removeB();
  });

  it('says how to show rows when none is shown', () => {
    const settings: ProfilerSettings = {
      ...DEFAULT_PROFILER_SETTINGS,
      overviewMetrics: sanitizeOverviewMetrics([]).map((e) => ({ ...e, visible: false })),
    };
    expect(renderOverview(settings)).toContain('No rows are shown. Pick them in the Settings tab.');
  });
});
