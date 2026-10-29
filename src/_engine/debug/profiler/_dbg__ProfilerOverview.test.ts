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
  APP_METRIC_PREFIX,
  createProfilerOverviewTabDef,
  getOverviewMetricEntries,
  getOverviewMetricLabel,
  sanitizeOverviewMetrics,
} from './_dbg__ProfilerOverview';

initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });

const createSettings = (): ProfilerSettings => ({
  ...DEFAULT_PROFILER_SETTINGS,
  overviewMetrics: sanitizeOverviewMetrics([]),
});

/** The Overview's text, as one render shows it. */
const renderOverview = (settings: ProfilerSettings) => {
  const scheduler = createBindingScheduler({ visible: false });
  const [table] = createProfilerOverviewTabDef(settings).content({ scheduler }) as CMPHandle[];
  const text = table.elem.textContent ?? '';
  table.remove();
  return text;
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

  it('shows "measuring…" before a first value, and the n/a reason', () => {
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
    expect(text).toContain('n/a (no world loaded)');
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
