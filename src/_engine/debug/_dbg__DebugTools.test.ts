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

// CONFIG.ts' debug keys, read by the key hints; the tab's own calls and the dev server's answer
const cfg = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock(import('../kernel/config/Config'), async (importOriginal) => {
  const original = await importOriginal();
  return Object.defineProperties(
    { ...original, getConfig: () => cfg.config as never },
    { IS_DEBUG_ENV: { get: () => original.IS_DEBUG_ENV, enumerable: true } }
  );
});
const tab = vi.hoisted(() => ({ update: vi.fn(), persist: vi.fn() }));
vi.mock(import('./DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  updateDebuggerTab: tab.update,
  persistDebuggerTabValue: tab.persist,
}));
const dev = vi.hoisted(() => ({ status: null as unknown }));
vi.mock(import('./DevFiles'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDevFilesStatus: () => Promise.resolve(dev.status as never),
}));

import { stubKitDomAsync } from '../ui/testing/KitDom';
import type { CMPHandle } from '../ui/core/CMPTypes';
import type { DebuggerPaneItem } from './DebuggerGUI';
import type { DebugToolsState } from './DebugTools';
import { _buildDebuggerPane } from './_dbg__DebuggerPaneBuilder';
import {
  _getDebugToolsState,
  DEBUG_TOOLS_LS_KEY,
  DEBUG_TOOLS_TAB_ID,
  markDebugToolsTabRegistered,
  persistShortcutValue,
} from './_dbg__DebugToolsState';
import {
  getFileServerFolder,
  getHelpersFolder,
  getOnScreenToolsFolder,
  refreshDevFilesRow,
  withDebugKeyHint,
} from './_dbg__DebugToolsFolders';

// p806 D11: the Debug tools tab split into its state and its folders' builders: the 5.x LS still
// loads, a shortcut's change is saved before and after the tab exists, the key hints are the
// bindings', and the file server's row shows the dev server's answer

beforeAll(async () => {
  await stubKitDomAsync();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  tab.update.mockClear();
  tab.persist.mockClear();
  cfg.config = {};
});

const build = (items: DebuggerPaneItem<DebugToolsState>[]) => {
  const pane = _buildDebuggerPane(
    { id: DEBUG_TOOLS_TAB_ID, lsKey: DEBUG_TOOLS_LS_KEY, state: _getDebugToolsState() },
    { pane: true, content: items }
  );
  document.body.append(pane.cmp.elem);
  built.push(pane.cmp);
  return pane;
};
const getLabels = (root: Element) =>
  [...root.querySelectorAll('.aekField__label')].map((label) => label.textContent);
const getMonitorText = (root: Element, label: string) =>
  [...root.querySelectorAll('.aekField')]
    .find((field) => field.querySelector('.aekField__label')?.textContent === label)
    ?.querySelector('.aekMonitor__value')?.textContent;

describe('the Debug tools tab (p806 D11)', () => {
  // These two run first: the state is read from LS only until the tab is registered
  it("reads a 5.x save's prodTestMode into onScreenTools and writes it back", () => {
    ls.setItem(
      DEBUG_TOOLS_LS_KEY,
      JSON.stringify({ prodTestMode: { showOnScreenToolsInProdTest: false } })
    );
    const state = _getDebugToolsState(true);
    expect(state.onScreenTools.showOnScreenToolsInProdTest).toBe(false);
    expect(state.onScreenTools.disabledOnScreenToolsOpacity).toBe(0.5);
    const saved = JSON.parse(ls.getItem(DEBUG_TOOLS_LS_KEY)!);
    expect(saved.prodTestMode).toBeUndefined();
    expect(saved.onScreenTools.showOnScreenToolsInProdTest).toBe(false);
  });

  it("saves a shortcut's change to LS before the tab is registered, through the tab after", () => {
    const state = _getDebugToolsState();
    state.envBall.show = false;
    persistShortcutValue('envBall');
    const saved = JSON.parse(ls.getItem(DEBUG_TOOLS_LS_KEY)!);
    expect(saved.envBall.show).toBe(false);
    // The earlier key is kept
    expect(saved.onScreenTools.showOnScreenToolsInProdTest).toBe(false);
    expect(tab.persist).not.toHaveBeenCalled();

    markDebugToolsTabRegistered();
    persistShortcutValue('axesGizmo');
    expect(tab.persist).toHaveBeenCalledWith(DEBUG_TOOLS_TAB_ID, 'axesGizmo');
    expect(tab.update).toHaveBeenCalledWith(DEBUG_TOOLS_TAB_ID);
    expect(JSON.parse(ls.getItem(DEBUG_TOOLS_LS_KEY)!).axesGizmo).toBeUndefined();
  });

  it("shows each debug key's chord in its label, CONFIG.ts' rebinding included", () => {
    cfg.config = { debugKeys: [{ id: 'sc-toggle-env-ball', chord: { key: 'F4', shift: true } }] };
    const pane = build([getOnScreenToolsFolder(), getHelpersFolder()]);
    const labels = getLabels(pane.cmp.elem);
    expect(labels).toContain('Disable on-screen tools [§]');
    expect(labels).toContain('Show environment ball [Shift+F4]');
    expect(labels).toContain('Show axes gizmo [F10]');
    // A key without a chord has no hint
    expect(withDebugKeyHint('Nothing', 'sc-no-such-key')).toBe('Nothing');
  });

  it("shows the dev server's answer in the file server's row on the next refresh", async () => {
    dev.status = { available: true, server: { writesFromLAN: false } };
    const pane = build([getFileServerFolder()]);
    // The folder starts shut: a refresh would only mark its rows stale
    pane.cmp.elem.querySelector<HTMLButtonElement>('.aekFolder__toggle')!.click();
    expect(getMonitorText(pane.cmp.elem, 'Dev files')).toBe('Checking…');
    expect(getMonitorText(pane.cmp.elem, 'Saving into __saveData')).toMatch(/^On|^Off/);

    refreshDevFilesRow();
    await vi.waitFor(() => expect(tab.update).toHaveBeenCalledWith(DEBUG_TOOLS_TAB_ID));
    // A refresh-only monitor: read by the tab's refresh, not the tick
    expect(getMonitorText(pane.cmp.elem, 'Dev files')).toBe('Checking…');
    pane.refresh();
    expect(getMonitorText(pane.cmp.elem, 'Dev files')).toBe('On (localhost only)');
  });
});
