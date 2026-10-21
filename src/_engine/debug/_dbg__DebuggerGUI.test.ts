import { describe, expect, it, vi } from 'vitest';

// The drawer builds DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);
vi.stubGlobal('HTMLInputElement', (await dom).window.HTMLInputElement);

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

// The drawer goes in the HUD root; the debugger's scene loader isn't this test's
const hud = vi.hoisted(() => ({ root: null as TCMP | null }));
vi.mock(import('../ui/HUD'), async (importOriginal) => ({
  ...(await importOriginal()),
  getHUDRootCMP: () => hud.root as TCMP,
}));
vi.mock(import('../kernel/scene/debug/_dbg__DebuggerSceneLoader'), () => ({
  createDebuggerSceneLoader: vi.fn(),
}));
vi.mock(import('../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: vi.fn(),
  lwarn: vi.fn(),
}));

import type { TCMP } from '../ui/CMPTypes';
import { CMP } from '../ui/CMP';
import { initEnvironment } from '../kernel/config/Config';
import type { AnyDebuggerTabDef } from './DebuggerGUI';
import {
  _createDebuggerTab,
  _isDebuggerTabOpen,
  _setDrawerSuspendedByView,
  _toggleDrawer,
  _updateDebuggerSceneTitle,
} from './_dbg__DebuggerGUI';

initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
hud.root = CMP();
document.body.appendChild(hud.root.elem);

const LS_KEY = 'AEK_debugDrawerState';
/** The drawer's element (CMP ids aren't DOM ids): the HUD root's only child. */
const getDrawerElem = () => hud.root?.elem.firstElementChild ?? null;
const contentCalls = { working: 0 };

const workingTab: AnyDebuggerTabDef = {
  id: 'working',
  title: 'Working',
  icon: 'gear',
  content: () => {
    contentCalls.working++;
    return [CMP({ text: 'working tab' })];
  },
};

const throwingTab: AnyDebuggerTabDef = {
  id: 'broken',
  title: 'Broken',
  icon: 'gear',
  content: () => {
    throw new Error('content failed');
  },
};

// One drawer for the whole file, in order: its state is the module's
describe('debug drawer (p618 §1.4)', () => {
  // F4: the read had no try, so a malformed value threw in the drawer's build
  it('builds with a malformed saved state, on the defaults (F4)', () => {
    ls.setItem(LS_KEY, '{not json');
    _createDebuggerTab(workingTab);
    expect(() => _updateDebuggerSceneTitle('Scene A')).not.toThrow();
    expect(getDrawerElem()).not.toBeNull();
    expect(_isDebuggerTabOpen('working')).toBe(false);
  });

  it('saves its state as an object, read back by the next build (F4)', () => {
    _toggleDrawer('OPEN');
    const saved: unknown = JSON.parse(ls.getItem(LS_KEY) as string);
    expect(saved).toMatchObject({ isOpen: true });
    expect(_isDebuggerTabOpen('working')).toBe(true);
  });

  // F1: every scene change rebuilt the whole drawer
  it('changes the title in place on a scene change, rebuilding only the open tab (F1)', () => {
    const drawer = getDrawerElem();
    const callsBefore = contentCalls.working;
    _updateDebuggerSceneTitle('Scene B');
    expect(getDrawerElem()).toBe(drawer);
    expect(document.querySelector('.debugCurrentSceneTitleText')?.textContent).toBe('Scene B');
    expect(contentCalls.working).toBe(callsBefore + 1);
  });

  // F2: updateDebuggerTab refreshed the hidden tab during an editor view
  it("doesn't count the tab as open while an editor view hides the drawer (F2)", () => {
    _setDrawerSuspendedByView(true);
    expect(_isDebuggerTabOpen('working')).toBe(false);
    _setDrawerSuspendedByView(false);
    expect(_isDebuggerTabOpen('working')).toBe(true);
  });

  // B3: a throwing saved tab made every drawer build, and with it setCurrentScene, throw
  it('survives a saved tab whose content throws (B3)', () => {
    ls.setItem(
      LS_KEY,
      JSON.stringify({ isOpen: true, currentTabId: 'broken', currentScrollPos: 0 })
    );
    expect(() => _createDebuggerTab(throwingTab)).not.toThrow();
    expect(() => _updateDebuggerSceneTitle('Scene C')).not.toThrow();
    expect(getDrawerElem()?.textContent).toContain('failed to build');
  });
});
