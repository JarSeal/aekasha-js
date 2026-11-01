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

// The tab's definition, captured; the Three.js counter's snapshot, the physics world and the ray
// testers (their windows aren't this test's)
const tab = vi.hoisted(() => ({ def: null as unknown }));
vi.mock(import('../../../debug/DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  createDebuggerTab: (def: unknown) => {
    tab.def = def;
  },
  updateDebuggerTab: vi.fn(),
}));
const stats = vi.hoisted(() => ({
  enabled: false,
  snapshot: {
    current: 0,
    lastFrame: 4,
    maxEver: 12,
    windows: [
      {
        id: 'a3',
        intervalMs: 3000,
        kind: 'AVERAGE',
        min: 0,
        max: 0,
        average: 2.345,
        progress: 0.5,
      },
      { id: 'm3', intervalMs: 3000, kind: 'MIN_MAX', min: 1, max: 7, average: 0, progress: 0.25 },
    ],
  },
}));
vi.mock(import('../Raycast'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRayCastStats: () => stats.snapshot as never,
  isRayCastStatsEnabled: () => stats.enabled,
  setRayCastStatsEnabled: vi.fn(),
}));
vi.mock(import('../../../features/physics/PhysicsState'), async (importOriginal) => ({
  ...(await importOriginal()),
  isPhysicsWorldEnabled: () => false,
}));
vi.mock(import('./_dbg__RayTester'), () => ({
  _createClearRayTestersLSButton: vi.fn() as never,
  _refreshRayTesterHelperNotices: vi.fn(),
  _toggleRayTesterWindow: vi.fn(),
}));

import { stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { initEnvironment } from '../../config/Config';
import type { AnyDebuggerTabDef } from '../../../debug/DebuggerGUI';
import { _buildDebuggerPane } from '../../../debug/_dbg__DebuggerPaneBuilder';
import { createBindingScheduler } from '../../../ui/forms/binding/BindingScheduler';
import { _initRayCastingDebugger } from './_dbg__Raycast';

// p806 D10: the Ray cast tab's statistics, a table per counter in a folder of the tab's pane, its
// figures written by the tab's refresh

beforeAll(async () => {
  await stubKitDomAsync();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  _initRayCastingDebugger();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
});

const buildTab = () => {
  const def = tab.def as AnyDebuggerTabDef;
  const [section] = def.content({ scheduler: createBindingScheduler() }) as Parameters<
    typeof _buildDebuggerPane
  >[1][];
  const pane = _buildDebuggerPane(def, section);
  document.body.append(pane.cmp.elem);
  built.push(pane.cmp);
  return { pane, elem: pane.cmp.elem };
};

const readTable = (table: Element) =>
  [...table.querySelectorAll('tbody tr')].map((row) =>
    [...row.children].map((cell) => cell.textContent)
  );

describe('the statistics', () => {
  it('are a table per counter, dimmed with "-" while off, its figures written on a refresh', () => {
    const { pane, elem } = buildTab();
    const table = elem.querySelector('table') as HTMLTableElement;
    const box = table.closest('.aekTable') as HTMLElement;
    expect(table.querySelector('caption')?.textContent).toBe('Three.js ray stats');
    expect(box.hasAttribute('data-inactive')).toBe(true);
    expect(readTable(table)).toEqual([
      ['Last frame', '-'],
      ['Max ever', '-'],
      ['Average, last 3 s', '-'],
      ['Max / min, last 3 s', '-'],
    ]);
    stats.enabled = true;
    pane.refresh();
    expect(box.hasAttribute('data-inactive')).toBe(false);
    expect(readTable(table)).toEqual([
      ['Last frame', '4'],
      ['Max ever', '12'],
      ['Average, last 3 s', '2.35'],
      ['Max / min, last 3 s', '7 / 1'],
    ]);
    // Each window's progress, a decorative donut beside its name
    const donut = table.querySelectorAll('tbody tr')[2].querySelector('.aekDonut') as HTMLElement;
    expect(donut.getAttribute('aria-hidden')).toBe('true');
    expect(donut.style.getPropertyValue('--aek-donut-value')).toBe('50');
    stats.enabled = false;
  });

  it('say so when there is no physics world', () => {
    const { elem } = buildTab();
    // The Three.js table only
    expect(elem.querySelectorAll('table')).toHaveLength(1);
    expect(elem.textContent).toContain('No physics world');
  });
});
