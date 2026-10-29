import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../ui/testing/KitDom';

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
const hud = vi.hoisted(() => ({ root: null as CMPHandle | null }));
vi.mock(import('../ui/core/HUD'), async (importOriginal) => ({
  ...(await importOriginal()),
  getHUDRootCMP: () => hud.root as CMPHandle,
}));
vi.mock(import('../kernel/scene/debug/_dbg__DebuggerSceneLoader'), () => ({
  createDebuggerSceneLoader: vi.fn(),
}));
vi.mock(import('../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: vi.fn(),
  lwarn: vi.fn(),
}));

import type { CMPHandle } from '../ui/core/CMPTypes';
import { CMP } from '../ui/core/CMP';
import { initEnvironment } from '../kernel/config/Config';
import { setDebuggerTheme } from '../ui/overlays/DebuggerRoot';
import type { AnyDebuggerTabDef } from './DebuggerGUI';
import {
  _createDebuggerTab,
  _disableDebugger,
  _getDrawerTestInfo,
  _isDebuggerTabOpen,
  _openDebuggerTab,
  _readSavedDrawerState,
  _removeDebuggerTab,
  _setDrawerSuspendedByView,
  _toggleDrawer,
  _updateDebuggerSceneTitle,
} from './_dbg__DebuggerGUI';

const LS_KEY = 'AEK_debugDrawerState';
/** The drawer's root (CMP ids aren't DOM ids): the HUD root's only child. */
const getDrawerElem = () => hud.root?.elem.firstElementChild as HTMLElement | null;
const query = <T extends HTMLElement = HTMLElement>(selector: string) =>
  getDrawerElem()?.querySelector<T>(selector) ?? null;
const getAside = () => query('aside');
const getToggler = () => query<HTMLButtonElement>('.debugDrawerToggler');
const getRailTabs = () => [
  ...(getDrawerElem()?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
];
const getRailKeys = () => getRailTabs().map((tab) => tab.getAttribute('data-tab-key'));
const findButton = (text: string) =>
  [...(getDrawerElem()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text);
const contentCalls = { working: 0 };

const workingTab: AnyDebuggerTabDef = {
  id: 'working',
  title: 'Working',
  icon: 'gear',
  content: () => {
    contentCalls.working++;
    return [CMP({ text: 'working tab', tag: 'button' })];
  },
};

const otherTab: AnyDebuggerTabDef = {
  id: 'other',
  title: 'Other',
  icon: 'info',
  content: () => [CMP({ text: 'other tab' })],
};

const throwingTab: AnyDebuggerTabDef = {
  id: 'broken',
  title: 'Broken',
  icon: 'gear',
  content: () => {
    throw new Error('content failed');
  },
};

beforeAll(async () => {
  await stubKitDomAsync();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  hud.root = CMP();
  document.body.appendChild(hud.root.elem);
});

describe('the drawer state (p806 D6, D14)', () => {
  it('reads a 5.x state: its one scroll position becomes the saved tab’s', () => {
    ls.setItem(
      LS_KEY,
      JSON.stringify({ isOpen: true, currentTabId: 'lights', currentScrollPos: 120 })
    );
    expect(_readSavedDrawerState()).toEqual({
      isOpen: true,
      currentTabId: 'lights',
      scrollPos: { lights: 120 },
    });
    // 6.0's own fields, a malformed width and position left out
    ls.setItem(
      LS_KEY,
      JSON.stringify({
        isOpen: false,
        currentTabId: 'stats',
        currentScrollPos: 5,
        scrollPos: { stats: 30, lights: 'x' },
        width: 520,
      })
    );
    expect(_readSavedDrawerState()).toEqual({
      isOpen: false,
      currentTabId: 'stats',
      scrollPos: { stats: 30 },
      width: 520,
    });
    ls.removeItem(LS_KEY);
  });
});

// One drawer for the rest of the file, in order: its state is the module's
describe('debug drawer (p618 §1.4, p806 D6)', () => {
  // F4: the read had no try, so a malformed value threw in the drawer's build
  it('builds with a malformed saved state, on the defaults (F4)', () => {
    ls.setItem(LS_KEY, '{not json');
    _createDebuggerTab(workingTab);
    expect(() => _updateDebuggerSceneTitle('Scene A')).not.toThrow();
    expect(getDrawerElem()).not.toBeNull();
    expect(_isDebuggerTabOpen('working')).toBe(false);
  });

  it('is a labelled aside with a disclosure toggler and its key hint, inert while closed', () => {
    const aside = getAside();
    const toggler = getToggler();
    expect(aside?.getAttribute('aria-label')).toBe('Debugger');
    expect(aside?.hasAttribute('inert')).toBe(true);
    expect(toggler?.getAttribute('aria-expanded')).toBe('false');
    expect(toggler?.getAttribute('aria-controls')).toBe(aside?.id);
    expect(toggler?.querySelector('kbd')?.textContent).toContain('H');
    const rail = query('[role="tablist"]');
    expect(rail?.getAttribute('aria-orientation')).toBe('vertical');
    expect(rail?.getAttribute('aria-label')).toBe('Debugger tabs');
  });

  it('is a debugger root in its theme and the compact density, changed live (p806 D8)', () => {
    const drawer = getDrawerElem();
    expect(drawer?.hasAttribute('data-aek-debugger')).toBe(true);
    expect(drawer?.getAttribute('data-aek-theme')).toBe('dark');
    expect(drawer?.getAttribute('data-aek-density')).toBe('compact');
    setDebuggerTheme('light');
    expect(drawer?.getAttribute('data-aek-theme')).toBe('light');
    setDebuggerTheme('dark');
  });

  it('the toggler’s click opens it on the rail’s tab; a close from inside gives the focus back (D12)', () => {
    getToggler()?.click();
    expect(_isDebuggerTabOpen('working')).toBe(true);
    expect(getAside()?.hasAttribute('inert')).toBe(false);
    expect(getToggler()?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(getRailTabs()[0]);
    const saved: unknown = JSON.parse(ls.getItem(LS_KEY) as string);
    expect(saved).toMatchObject({ isOpen: true });

    query<HTMLButtonElement>('button[aria-label="Close the debugger"]')?.click();
    expect(_isDebuggerTabOpen('working')).toBe(false);
    expect(document.activeElement).toBe(getToggler());
    expect(getAside()?.hasAttribute('inert')).toBe(true);
  });

  it('the key path opens it without moving the focus (D12)', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    _toggleDrawer();
    expect(_isDebuggerTabOpen('working')).toBe(true);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  // F1: every scene change rebuilt the whole drawer
  it('changes the title in place on a scene change, rebuilding only the open tab (F1)', () => {
    const drawer = getDrawerElem();
    const callsBefore = contentCalls.working;
    _updateDebuggerSceneTitle('Scene B');
    expect(getDrawerElem()).toBe(drawer);
    expect(query('.debugCurrentSceneTitleText')?.textContent).toBe('Scene B');
    expect(contentCalls.working).toBe(callsBefore + 1);
  });

  // D5: a tab created or removed changed the menu by rebuilding the whole drawer
  it('changes the menu in place: the open tab, its content and the focus stay (D5)', () => {
    const drawer = getDrawerElem();
    const callsBefore = contentCalls.working;
    const content = findButton('working tab');
    content?.focus();
    _createDebuggerTab(otherTab);
    expect(getDrawerElem()).toBe(drawer);
    expect(getRailKeys()).toEqual(['working', 'other']);
    expect(contentCalls.working).toBe(callsBefore);
    expect(findButton('working tab')).toBe(content);
    expect(document.activeElement).toBe(content);
    _removeDebuggerTab('other');
    expect(getRailKeys()).toEqual(['working']);
    expect(contentCalls.working).toBe(callsBefore);
  });

  it('puts the scene tabs last, after a divider, saying so in their names', () => {
    _createDebuggerTab({ ...otherTab, id: 'sceneTab', title: 'Boxes', sceneId: 'unknownScene' });
    _createDebuggerTab(otherTab);
    expect(getRailKeys()).toEqual(['working', 'other', 'sceneTab']);
    const sceneTab = getRailTabs()[2];
    expect(sceneTab.hasAttribute('data-separator-before')).toBe(true);
    expect(getRailTabs()[1].hasAttribute('data-separator-before')).toBe(false);
    expect(sceneTab.textContent).toContain('Boxes (scene tab)');
    expect(_getDrawerTestInfo().tabIds).toEqual(['working', 'other', 'sceneTab']);
    _removeDebuggerTab('sceneTab');
    _removeDebuggerTab('other');
  });

  it('a rail pick mounts the tab in its own container and saves it; the arrows only move', () => {
    _createDebuggerTab(otherTab);
    const [working, other] = getRailTabs();
    working.focus();
    dispatchKey(working, 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(other);
    expect(_isDebuggerTabOpen('working')).toBe(true);
    other.click();
    expect(_isDebuggerTabOpen('other')).toBe(true);
    expect(_getDrawerTestInfo().contentElement?.textContent).toContain('other tab');
    // The other tab's container emptied
    expect(findButton('working tab')).toBeUndefined();
    expect(JSON.parse(ls.getItem(LS_KEY) as string)).toMatchObject({ currentTabId: 'other' });
    _openDebuggerTab('working');
    _removeDebuggerTab('other');
  });

  // F2: updateDebuggerTab refreshed the hidden tab during an editor view
  it("doesn't count the tab as open while an editor view hides the drawer (F2)", () => {
    _setDrawerSuspendedByView(true);
    expect(_isDebuggerTabOpen('working')).toBe(false);
    _setDrawerSuspendedByView(false);
    expect(_isDebuggerTabOpen('working')).toBe(true);
  });

  it('is inert, busy and dimmed during a scene load (D6)', () => {
    _disableDebugger(true);
    const drawer = getDrawerElem();
    expect(drawer?.hasAttribute('inert')).toBe(true);
    expect(drawer?.getAttribute('aria-busy')).toBe('true');
    expect(drawer?.hasAttribute('data-disabled')).toBe(true);
    _disableDebugger(false);
    expect(drawer?.hasAttribute('inert')).toBe(false);
    expect(drawer?.hasAttribute('aria-busy')).toBe(false);
  });

  // B3: a throwing tab made every drawer build, and with it setCurrentScene, throw
  it('survives a tab whose content throws (B3)', () => {
    expect(() => _createDebuggerTab(throwingTab)).not.toThrow();
    expect(() => _openDebuggerTab('broken')).not.toThrow();
    expect(() => _updateDebuggerSceneTitle('Scene C')).not.toThrow();
    expect(getDrawerElem()?.textContent).toContain('failed to build');
  });
});
