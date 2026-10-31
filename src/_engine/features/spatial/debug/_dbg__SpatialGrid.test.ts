import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
const ls = vi.hoisted(() => {
  type Items = { [key: string]: string };
  const storage = Object.create({
    getItem(this: Items, key: string) {
      return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
    },
    setItem(this: Items, key: string, value: string) {
      this[key] = String(value);
    },
    removeItem(this: Items, key: string) {
      delete this[key];
    },
  }) as Storage & Items;
  vi.stubGlobal('localStorage', storage);
  return storage;
});

// The tab's definition, captured; the current scene
const tab = vi.hoisted(() => ({ def: null as unknown, update: vi.fn(), persist: vi.fn() }));
vi.mock(import('../../../debug/DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  createDebuggerTab: (def: unknown) => {
    tab.def = def;
  },
  updateDebuggerTab: tab.update,
  persistDebuggerTabValue: tab.persist,
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'sceneA',
}));

import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { initEnvironment } from '../../../kernel/config/Config';
import type { AnyDebuggerTabDef } from '../../../debug/DebuggerGUI';
import { _buildDebuggerPane } from '../../../debug/_dbg__DebuggerPaneBuilder';
import { createBindingScheduler } from '../../../ui/forms/binding/BindingScheduler';
import { getSpatialDomainOptions, registerSpatialDomain } from '../SpatialDomains';
import { _createSpatialGridDebugGUI } from './_dbg__SpatialGrid';
import {
  migrateLegacySpatialGridSettings,
  SPATIAL_GRID_LS_KEY,
  spatialGridTabState,
} from './_dbg__SpatialGridSettings';
import { formatOccupancy } from './_dbg__SpatialGridReadouts';

// p806 D11: the Spatial index tab split into its settings, overlays, rows and figures: the
// single-grid LS migrated, a cell size edited and reset in the scope it's used in, the occupancy
// and the domains' rows that fit the value column

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  // The tab's cell size override applies in the debug env only
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  world = new ECSWorld();
  // A scene's settings for FOLIAGE, which win over its world ones
  registerSpatialDomain(world, { id: 'FOLIAGE', cellSize: 30, maxMembers: 16, update: 'STATIC' });
  registerSpatialDomain(world, {
    id: 'FOLIAGE',
    cellSize: 10,
    maxMembers: 16,
    update: 'STATIC',
    sceneId: 'sceneA',
  });
  _createSpatialGridDebugGUI();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  tab.update.mockClear();
  tab.persist.mockClear();
});

const getDef = () => tab.def as AnyDebuggerTabDef;
const buildTab = () => {
  const def = getDef();
  def.onRefresh?.();
  const [section] = def.content({ scheduler: createBindingScheduler() }) as Parameters<
    typeof _buildDebuggerPane
  >[1][];
  const pane = _buildDebuggerPane(def, section);
  document.body.append(pane.cmp.elem);
  built.push(pane.cmp);
  return pane;
};
const getField = (root: Element, label: string) =>
  [...root.querySelectorAll('.aekField')].find(
    (field) => field.querySelector('.aekField__label')?.textContent === label
  ) as HTMLElement;
const getText = (root: Element, label: string) =>
  getField(root, label).querySelector('.aekMonitor__value')?.textContent;
const getButton = (root: Element, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === text
  )!;

describe('the Spatial index tab (p806 D11)', () => {
  it("migrates the single-grid tab's LS into DEFAULT's entry", () => {
    const saved = spatialGridTabState.domains;
    ls.setItem(
      SPATIAL_GRID_LS_KEY,
      JSON.stringify({ cellSize: 24, visualizerEnabled: true, visualizerColor: 0x00ff00 })
    );
    migrateLegacySpatialGridSettings();
    expect(JSON.parse(ls.getItem(SPATIAL_GRID_LS_KEY)!)).toEqual({
      domains: {
        DEFAULT: {
          showCells: true,
          cellsColor: 0x00ff00,
          showOversized: false,
          oversizedColor: 0xffaa00,
          cellSize: 24,
        },
      },
    });
    // The old default cell size isn't an override
    ls.setItem(SPATIAL_GRID_LS_KEY, JSON.stringify({ cellSize: 20 }));
    migrateLegacySpatialGridSettings();
    expect(JSON.parse(ls.getItem(SPATIAL_GRID_LS_KEY)!).domains.DEFAULT.cellSize).toBeUndefined();
    ls.removeItem(SPATIAL_GRID_LS_KEY);
    spatialGridTabState.domains = saved;
  });

  it("saves a cell size in the scene's scope it's used in, and resets that scope only", () => {
    spatialGridTabState.selectedDomain = 'FOLIAGE';
    spatialGridTabState.domains.FOLIAGE = {
      cellSize: 40,
      showCells: false,
      cellsColor: 0,
      showOversized: false,
      oversizedColor: 0,
    };
    const pane = buildTab();
    const root = pane.cmp.elem;
    expect(getText(root, 'Scope')).toBe('scene: sceneA');
    const reset = getButton(root, "Reset to the app's cell size");
    expect(reset.disabled).toBe(true);

    const input = getField(root, 'Cell size').querySelector('input')!;
    input.focus();
    dispatchKey(input, 'keydown', 'ArrowUp');
    expect(tab.persist).not.toHaveBeenCalled();
    dispatchKey(input, 'keyup', 'ArrowUp');
    expect(tab.persist).toHaveBeenCalledWith('spatialGridControls', 'domains');
    expect(spatialGridTabState.domains.FOLIAGE.cellSizeByScene).toEqual({ sceneA: 10.5 });
    // The world settings' saved value is untouched, and the scene's applies
    expect(spatialGridTabState.domains.FOLIAGE.cellSize).toBe(40);
    expect(getSpatialDomainOptions(world, 'FOLIAGE')?.cellSize).toBe(10.5);

    pane.refresh();
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(spatialGridTabState.domains.FOLIAGE.cellSizeByScene).toBeUndefined();
    expect(spatialGridTabState.domains.FOLIAGE.cellSize).toBe(40);
    expect(getSpatialDomainOptions(world, 'FOLIAGE')?.cellSize).toBe(10);
    expect(tab.update).toHaveBeenCalledWith('spatialGridControls', { rebuild: true });
  });

  it('shows a row per domain with its policy, and the occupancy as short lines', () => {
    const pane = buildTab();
    const root = pane.cmp.elem;
    expect(getText(root, 'FOLIAGE')).toMatch(/^STATIC, /);
    expect(getText(root, 'DEFAULT')).toBe('DYNAMIC, no grid');

    expect(formatOccupancy([])).toEqual({ cells: 'None occupied', histogram: '' });
    expect(formatOccupancy([1, 1, 1, 2, 4])).toEqual({
      cells: '5, 1-4 members each, 1.80 on average',
      histogram: ['  1 ########## 3', '  2 ###        1', '  4 ###        1'].join('\n'),
    });
  });
});
