import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../ui/testing/KitDom';

// The dialog's content is captured from openDialog; the bindings are this test's
const dialog = vi.hoisted(() => ({ props: null as { content: () => unknown } | null }));
vi.mock(import('../ui/overlays/windows/DialogWindow'), () => ({
  openDialog: (props: unknown) => {
    dialog.props = props as { content: () => unknown };
  },
}));
const closed = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock(import('../ui/overlays/windows/DraggableWindow'), async (importOriginal) => ({
  ...(await importOriginal()),
  closeDraggableWindow: (id: string) => {
    closed.ids.push(id);
  },
}));
vi.mock(import('../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'sceneA',
}));
const input = vi.hoisted(() => ({
  keyBindings: [] as unknown[],
  maps: [] as unknown[],
}));
vi.mock(import('../kernel/input/KeyboardInput'), async (importOriginal) => ({
  ...(await importOriginal()),
  getKeyBindings: () => input.keyBindings as never,
}));
vi.mock(import('../kernel/input/Actions'), async (importOriginal) => ({
  ...(await importOriginal()),
  getActionMaps: () => input.maps as never,
  getActionMap: (id: string) =>
    (input.maps as { id: string }[]).find((map) => map.id === id) as never,
}));

import type { CMPHandle } from '../ui/core/CMPTypes';
import { CMP } from '../ui/core/CMP';
import type { ActionBinding } from '../kernel/input/ActionTypes';
import { DEBUG_KEYS_ACTION_MAP_ID, getDefaultDebugKeyBindings } from './DefaultDebugKeyBindings';
import { openDebugKeyShortcutsDialog } from './_dbg__DebugKeyShortcuts';

type FakeAction = { name?: string; type?: string; bindings: ActionBinding[] };

/** An action map as the dialog reads it */
const createMap = (
  id: string,
  actions: { [id: string]: FakeAction },
  opts: { sceneId?: string; context?: string } = {}
) => ({
  id,
  sceneId: opts.sceneId,
  context: opts.context ?? 'GAME',
  actions: Object.fromEntries(
    Object.entries(actions).map(([key, a]) => [key, { name: a.name, type: a.type ?? 'BUTTON' }])
  ),
  getBindings: (actionId: string) => actions[actionId]?.bindings ?? [],
  isActive: () => true,
});

/** The engine's debug keys' map, bound as defined */
const createDebugMap = () =>
  createMap(
    DEBUG_KEYS_ACTION_MAP_ID,
    Object.fromEntries(
      getDefaultDebugKeyBindings().debug.map((def) => [
        def.id,
        {
          bindings: [
            {
              device: 'KEYBOARD',
              keys: Array.isArray(def.chord) ? def.chord : [def.chord],
            } as ActionBinding,
          ],
        },
      ])
    ),
    { context: 'DEBUG' }
  );

let root: CMPHandle;

const open = (tab?: 'APP' | 'AEKASHA') => {
  root?.remove();
  openDebugKeyShortcutsDialog(tab);
  root = (dialog.props as { content: (data?: unknown) => CMPHandle }).content({ tab });
  document.body.appendChild(root.elem);
  return root.elem;
};
const getTabs = (elem: HTMLElement) => [...elem.querySelectorAll<HTMLElement>('[role="tab"]')];
const getShownPanel = (elem: HTMLElement) =>
  elem.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])') as HTMLElement;
const getHeadings = (elem: HTMLElement) =>
  [...getShownPanel(elem).querySelectorAll('h4')].map((h) => h.textContent);
/** A row's element by its name's text (without its id) */
const getRow = (elem: HTMLElement, name: string) =>
  [...getShownPanel(elem).querySelectorAll<HTMLElement>('.aekList__row')].find(
    (row) => row.querySelector('p')?.firstChild?.textContent === name
  ) as HTMLElement;
const getKbds = (row: HTMLElement) =>
  [...row.querySelectorAll('kbd.aekKbd')].map((kbd) =>
    [...kbd.querySelectorAll('kbd.aekKbd__key')].map((key) => key.textContent).join('+')
  );
const getBadges = (row: HTMLElement) =>
  [...row.querySelectorAll('.aekBadge')].map((badge) => badge.textContent);

beforeAll(async () => {
  await stubKitDomAsync();
  // A root for the dialog's content (the overlay stack's listeners need a kit root's element)
  document.body.appendChild(CMP({ id: 'hudRoot', idAttr: true, class: 'aekUi' }).elem);
});

beforeEach(() => {
  input.keyBindings = [];
  input.maps = [createDebugMap()];
  closed.ids = [];
});

describe('the Debug key shortcuts dialog (p806 D10)', () => {
  it('is two kit tabs, the asked one selected, with a kit close button', () => {
    const elem = open('AEKASHA');
    const tabs = getTabs(elem);
    expect(tabs.map((t) => t.textContent)).toEqual(['App (current scene)', 'Ækasha']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(elem.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Key shortcuts'
    );
    expect(getHeadings(elem)).toEqual([
      'Debugger',
      'Camera',
      'Loops and modes',
      'Viewport helpers and tools',
      'Production test mode',
      'Pointer and context',
    ]);
    const close = [...elem.querySelectorAll<HTMLElement>('button.aekButton')].find(
      (b) => b.textContent === 'Close'
    ) as HTMLElement;
    close.click();
    expect(closed.ids).toEqual(['debugKeyShortcutsDialog']);
  });

  it("shows an engine key's chord as key hints, its state as a badge and the app's sharing as a note", () => {
    input.keyBindings = [
      { id: 'appH', name: 'App help', type: 'KEY_UP', chord: { key: 'h' }, fn: () => {} },
    ];
    const elem = open('AEKASHA');
    const row = getRow(elem, 'Toggle debug drawer (an editor view: its own drawer)');
    expect(getKbds(row)).toEqual(['H']);
    expect(row.querySelector('.aekKbd')?.tagName).toBe('KBD');
    // The key cap's name (the kit's), the id after the name, set as text
    expect(row.textContent).toContain('sc-toggle-debug-drawer');
    expect(getBadges(row)).toEqual(['Shared with app']);
    expect(row.querySelector('.aekBadge')?.getAttribute('data-tone')).toBe('warning');
    expect(row.textContent).toContain('Also bound by the app: “App help” (both run).');
    // Shared, not inactive: both run
    expect(row.firstElementChild?.hasAttribute('data-inactive')).toBe(false);
  });

  it('marks a key the app unbound inactive, its badge saying why', () => {
    const map = createDebugMap();
    const getBindings = map.getBindings;
    map.getBindings = (id) => (id === 'sc-toggle-debug-drawer' ? [] : getBindings(id));
    input.maps = [map];
    const row = getRow(open('AEKASHA'), 'Toggle debug drawer (an editor view: its own drawer)');
    expect(getBadges(row)).toEqual(['Unbound by app']);
    expect(row.querySelector('[data-inactive]')).toBeTruthy();
  });

  it('writes pointer input as text and a context key as a key hint', () => {
    const elem = open('AEKASHA');
    const orbit = getRow(elem, 'Pan the debug camera');
    expect(getKbds(orbit)).toEqual([]);
    expect(orbit.textContent).toContain('Right drag');
    expect(getBadges(orbit)).toEqual(['Debug camera']);
    expect(getKbds(getRow(elem, 'Cancel the pick'))).toEqual(['Esc']);
    // Each chord its own key hint, so the column wraps between them
    const undo = getRow(elem, 'Undo debugger action');
    expect(getKbds(undo).length).toBe(2);
    const between = undo.querySelector('kbd.aekKbd')?.nextElementSibling;
    expect(between?.tagName).toBe('SPAN');
    expect(between?.textContent).toBe('or');
  });

  it("lists the app's keys by scope, an action's bindings with 'or' between them", () => {
    input.keyBindings = [
      {
        id: 'jump',
        name: 'Jump',
        type: 'KEY_DOWN',
        chord: { key: 'j' },
        sceneId: 'sceneA',
        description: 'Up we go',
        fn: () => {},
      },
      {
        id: 'mute',
        type: 'KEY_UP',
        chord: { key: 'm', ctrl: true },
        enabled: false,
        fn: () => {},
      },
      { id: 'other', type: 'KEY_UP', chord: { key: 'q' }, sceneId: 'sceneB', fn: () => {} },
    ];
    input.maps.push(
      createMap('game', {
        fire: {
          name: 'Fire',
          bindings: [
            { device: 'KEYBOARD', keys: ['f'] } as ActionBinding,
            { device: 'MOUSE', button: 'LEFT' } as ActionBinding,
          ],
        },
      })
    );
    const elem = open('APP');
    expect(getHeadings(elem)).toEqual([
      'This scene (sceneA)',
      'All scenes',
      'Debug keys (CONFIG.ts)',
    ]);
    const jump = getRow(elem, 'Jump');
    expect(getKbds(jump)).toEqual(['J']);
    expect(jump.textContent).toContain('Up we go');
    expect(getBadges(jump)).toEqual(['Key down', 'Works with debug camera']);
    // Named by its id: no id after it
    const mute = getRow(elem, 'mute');
    expect(getKbds(mute)).toEqual(['Ctrl+M']);
    expect(getBadges(mute)).toContain('Disabled');
    expect(mute.querySelector('[data-inactive]')).toBeTruthy();
    const fire = getRow(elem, 'Fire');
    expect(getKbds(fire)).toEqual(['F']);
    expect(fire.textContent).toContain('orMouse left');
    expect(getShownPanel(elem).textContent).toContain('1 key of other scenes not listed.');
    expect(getShownPanel(elem).textContent).toContain('No key bindings.');
  });

  it('builds a tab again on each selection, and the arrows move between the tabs', () => {
    const elem = open('AEKASHA');
    const [appTab, aekashaTab] = getTabs(elem);
    aekashaTab.focus();
    dispatchKey(aekashaTab, 'keydown', 'ArrowLeft');
    expect(document.activeElement).toBe(appTab);
    expect(appTab.getAttribute('aria-selected')).toBe('true');
    expect(getRow(elem, 'Late')).toBeUndefined();
    input.keyBindings = [{ id: 'late', name: 'Late', type: 'KEY_UP', chord: { key: 'l' } }];
    dispatchKey(appTab, 'keydown', 'ArrowRight');
    dispatchKey(aekashaTab, 'keydown', 'ArrowLeft');
    expect(getRow(elem, 'Late')).toBeTruthy();
  });
});
