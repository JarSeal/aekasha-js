import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

import { dispatchKey, stubKitDomAsync } from '../../ui/testing/KitDom';
import { createBindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import type { CMPHandle } from '../../ui/core/CMPTypes';
import { initEnvironment } from '../../kernel/config/Config';
import { DEFAULT_PROFILER_SETTINGS, registerStatsSource, type ProfilerSettings } from '../Profiler';
import { getDefaultOverviewMetrics, getOverviewMetricEntries } from './_dbg__ProfilerOverview';
import { createProfilerSettingsTabDef, moveOverviewMetric } from './_dbg__ProfilerSettings';

beforeAll(async () => {
  await stubKitDomAsync();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
});

const removers: (() => void)[] = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
});

const entry = (id: string, visible = true) => ({ id, visible });

describe('moveOverviewMetric', () => {
  const list = [entry('a'), entry('b'), entry('c'), entry('app:x'), entry('app:y')];

  it('moves a row to an index among its own group’s rows', () => {
    expect(moveOverviewMetric(list, 'a', 2).map((e) => e.id)).toEqual([
      'b',
      'c',
      'a',
      'app:x',
      'app:y',
    ]);
    expect(moveOverviewMetric(list, 'c', 0).map((e) => e.id)).toEqual([
      'c',
      'a',
      'b',
      'app:x',
      'app:y',
    ]);
    expect(moveOverviewMetric(list, 'app:y', 0).map((e) => e.id)).toEqual([
      'a',
      'b',
      'c',
      'app:y',
      'app:x',
    ]);
  });

  it('keeps a row in its group past the group’s end, and copies every row', () => {
    const moved = moveOverviewMetric(list, 'a', 9);
    expect(moved.map((e) => e.id)).toEqual(['b', 'c', 'a', 'app:x', 'app:y']);
    expect(moved[0]).not.toBe(list[1]);
    expect(moveOverviewMetric(list, 'nope', 0).map((e) => e.id)).toEqual(list.map((e) => e.id));
  });
});

/** The Settings tab's Overview rows editor, mounted, with its settings written by `setSettings` */
const mountEditor = () => {
  const settings: ProfilerSettings = {
    ...DEFAULT_PROFILER_SETTINGS,
    overviewMetrics: getDefaultOverviewMetrics(),
  };
  const scheduler = createBindingScheduler({ visible: true });
  const setSettings = vi.fn((partial: Partial<ProfilerSettings>) => {
    Object.assign(settings, partial);
    scheduler.refresh();
  });
  const def = createProfilerSettingsTabDef({
    settings,
    onChange: () => undefined,
    setSettings,
    onClearLS: () => undefined,
  });
  const sections = def.content({ scheduler });
  const editor = sections.find(
    (section): section is CMPHandle =>
      'elem' in section && section.elem.classList.contains('profilerMetricEditor')
  )!;
  document.body.append(editor.elem);
  removers.push(() => {
    editor.remove();
    scheduler.dispose();
  });
  const lists = () => [...editor.elem.querySelectorAll<HTMLElement>('.aekList')];
  const rowsOf = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>('[data-key]')];
  const reset = [...editor.elem.querySelectorAll('button')].find(
    (b) => b.textContent === 'Reset to default'
  )!;
  return { settings, setSettings, editor, lists, rowsOf, reset, scheduler };
};

describe('the Settings tab’s Overview rows (p806 D10)', () => {
  it('lists the engine rows with a visibility toggle each, the app group hidden without one', () => {
    const { lists, rowsOf, reset, editor } = mountEditor();
    const [engine, app] = lists();
    expect(engine.querySelector('[role="grid"]')?.getAttribute('aria-label')).toBe('Overview rows');
    expect(rowsOf(engine).map((row) => row.getAttribute('data-key'))).toEqual(
      getDefaultOverviewMetrics()
        .filter((e) => !e.id.startsWith('app:'))
        .map((e) => e.id)
    );
    const toggle = rowsOf(engine)[0].querySelector('[aria-pressed]');
    expect(toggle?.getAttribute('aria-label')).toBe('Show in the Overview');
    expect(app.closest('.profilerMetricAppGroup')?.hasAttribute('hidden')).toBe(true);
    expect(reset.disabled).toBe(true);
    expect(editor.elem.querySelector('h4')?.textContent).toBe('Overview rows');
  });

  it('moves a row by Alt + ArrowDown and flips its visibility by its toggle', () => {
    const { lists, rowsOf, setSettings, settings, reset } = mountEditor();
    const [engine] = lists();
    const [first, second] = rowsOf(engine).map((row) => row.getAttribute('data-key')!);
    const firstCell = rowsOf(engine)[0].querySelector<HTMLElement>('.aekList__main')!;
    firstCell.focus();
    dispatchKey(firstCell, 'keydown', 'ArrowDown', { altKey: true });
    dispatchKey(firstCell, 'keyup', 'ArrowDown', { altKey: true });
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(settings.overviewMetrics.slice(0, 2).map((e) => e.id)).toEqual([second, first]);
    expect(
      rowsOf(engine)
        .map((row) => row.getAttribute('data-key'))
        .slice(0, 2)
    ).toEqual([second, first]);
    expect(reset.disabled).toBe(false);

    const toggle = rowsOf(engine)[0].querySelector<HTMLButtonElement>('[aria-pressed]')!;
    const was = toggle.getAttribute('aria-pressed');
    toggle.click();
    expect(settings.overviewMetrics.find((e) => e.id === second)?.visible).toBe(was !== 'true');
    expect(toggle.getAttribute('aria-pressed')).toBe(String(was !== 'true'));

    reset.click();
    expect(settings.overviewMetrics).toEqual(getDefaultOverviewMetrics());
  });

  it('shows the app sources’ rows as a group of their own', () => {
    removers.push(registerStatsSource({ id: 'enemies', label: 'Enemies', read: () => 3 }));
    const { lists, rowsOf, settings } = mountEditor();
    const app = lists()[1];
    expect(app.closest('.profilerMetricAppGroup')?.hasAttribute('hidden')).toBe(false);
    expect(rowsOf(app).map((row) => row.getAttribute('data-key'))).toEqual(['app:enemies']);
    expect(getOverviewMetricEntries(settings).some((e) => e.id === 'app:enemies')).toBe(true);
  });
});
