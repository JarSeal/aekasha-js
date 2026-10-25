import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwarn } from '../utils/Logger';
import { initEnvironment, type AppConfig } from '../kernel/config/Config';
import { createActionMap, getActionMap, getActionMaps } from '../kernel/input/Actions';
import { createKeyBinding, deleteKeyBinding } from '../kernel/input/KeyboardInput';
import { toggleAppPlay, toggleMainPlay } from '../kernel/loop/MainLoop';
import { toggleActiveViewDrawer } from '../kernel/render/Views';
import { toggleEnvBall } from './DebugTools';
import {
  APP_DEBUG_KEYS_ACTION_MAP_ID,
  DEBUG_KEYS_ACTION_MAP_ID,
  registerDefaultDebugKeyBindings,
  registerDefaultProdTestKeyBindings,
} from './DefaultDebugKeyBindings';
import { toggleProfilerWindow } from './Profiler';
import { redoLastAction, undoLastAction } from './UndoRedo';

// The keyboard's DOM: window is an event target, nothing has focus
const dom = vi.hoisted(() => {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { activeElement: null });
  return { win, config: { debugKeys: [] } as AppConfig };
});

vi.mock(import('../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: vi.fn(),
}));
// A spread copies the flags' values at mock time: getters keep them live bindings, which
// initEnvironment (below) sets
vi.mock(import('../kernel/config/Config'), async (importOriginal) => {
  const original = await importOriginal();
  return Object.defineProperties(
    { ...original, getConfig: () => dom.config },
    {
      IS_DEBUG_ENV: { get: () => original.IS_DEBUG_ENV, enumerable: true },
      IS_PROD_TEST_MODE: { get: () => original.IS_PROD_TEST_MODE, enumerable: true },
    }
  );
});
vi.mock(import('../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  toggleMainPlay: vi.fn(),
  toggleAppPlay: vi.fn(),
  getReadOnlyLoopState: () => ({ masterPlay: true }) as never,
}));
vi.mock(import('../kernel/render/Views'), () => ({
  getActiveView: () => null,
  isRuntimeViewActive: () => true,
  isViewPlaying: () => true,
  toggleActiveViewDrawer: vi.fn(),
  toggleViewPlay: vi.fn(),
}));
vi.mock(import('./DebuggerGUI'), () => ({ addDebugToast: vi.fn() }));
vi.mock(import('./OnScreenTools'), () => ({
  playInProdTestMode: vi.fn(),
  stopProdTestMode: vi.fn(),
  toggleDebugCameraWithToast: vi.fn(),
  toggleOnScreenDropDown: vi.fn(),
  updateOnScreenTools: vi.fn(),
}));
vi.mock(import('./DebugTools'), () => ({
  openDebugKeyShortcutsDialog: vi.fn(),
  toggleAxesGizmo: vi.fn(),
  toggleEnvBall: vi.fn(),
  toggleOnScreenToolsDisabled: vi.fn(),
}));
vi.mock(import('./Profiler'), () => ({ toggleProfilerWindow: vi.fn() }));
vi.mock(import('./UndoRedo'), () => ({ undoLastAction: vi.fn(), redoLastAction: vi.fn() }));
vi.mock(import('../ui/core/icons/SvgIcon'), () => ({ getSvgIcon: () => '' }));

const held = new Set<string>();

const key = (
  type: 'keydown' | 'keyup',
  k: string,
  opts: { meta?: boolean; ctrl?: boolean; repeat?: boolean } = {}
) => {
  if (type === 'keydown') held.add(k);
  else held.delete(k);
  const e = Object.assign(new Event(type, { cancelable: true }), {
    key: k,
    repeat: !!opts.repeat,
    shiftKey: held.has('Shift'),
    ctrlKey: !!opts.ctrl || held.has('Control'),
    altKey: false,
    metaKey: !!opts.meta || held.has('Meta'),
  });
  dom.win.dispatchEvent(e);
  return e;
};
const down = (k: string, opts?: { meta?: boolean; ctrl?: boolean; repeat?: boolean }) =>
  key('keydown', k, opts);
const up = (k: string) => key('keyup', k);

beforeEach(() => {
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of [...held]) up(k);
  for (const map of getActionMaps()) map.delete();
  dom.config = { debugKeys: [] };
});

describe('the debug keys', () => {
  it('are a DEBUG action map: a KEY_DOWN key runs at its press, a KEY_UP key at its release', () => {
    registerDefaultDebugKeyBindings();
    expect(getActionMap(DEBUG_KEYS_ACTION_MAP_ID)?.context).toBe('DEBUG');
    down('F6');
    down('F6', { repeat: true });
    expect(toggleMainPlay).toHaveBeenCalledTimes(1);
    down('h');
    expect(toggleActiveViewDrawer).not.toHaveBeenCalled();
    up('h');
    expect(toggleActiveViewDrawer).toHaveBeenCalledTimes(1);
  });

  it('do not run for an edge a modifier made', () => {
    registerDefaultDebugKeyBindings();
    down('h');
    down('Shift'); // releases h's action (an exact chord), on Shift's keydown
    up('h');
    up('Shift');
    expect(toggleActiveViewDrawer).not.toHaveBeenCalled();
  });

  it('undo on every ⌘Z while ⌘ is held (macOS sends no keyup for Z), and redo with Shift', () => {
    registerDefaultDebugKeyBindings();
    down('Meta');
    down('z', { meta: true });
    down('z', { meta: true });
    expect(undoLastAction).toHaveBeenCalledTimes(2);
    expect(redoLastAction).not.toHaveBeenCalled();
    up('Meta');
    down('Control');
    down('Shift');
    down('Z', { ctrl: true });
    expect(redoLastAction).toHaveBeenCalledTimes(1);
    expect(undoLastAction).toHaveBeenCalledTimes(2);
  });

  it('prevent the default of their keys outside a text field, key-repeats included', () => {
    registerDefaultDebugKeyBindings();
    expect(down('F5').defaultPrevented).toBe(true);
    expect(down('F5', { repeat: true }).defaultPrevented).toBe(true);
    expect(down('x').defaultPrevented).toBe(false);
  });

  it('apply the CONFIG.ts overrides: a new chord, turned off, a replaced fn', () => {
    const fn = vi.fn();
    dom.config = {
      debugKeys: [
        { id: 'sc-toggle-debug-drawer', chord: { key: 'j' } },
        { id: 'sc-toggle-profiler', enabled: false },
        { id: 'sc-toggle-env-ball', fn },
      ],
    };
    registerDefaultDebugKeyBindings();
    const map = getActionMap(DEBUG_KEYS_ACTION_MAP_ID)!;
    expect(map.actions['sc-toggle-profiler']).toBeUndefined();
    down('h');
    up('h');
    down('j');
    up('j');
    expect(toggleActiveViewDrawer).toHaveBeenCalledTimes(1);
    down('F8');
    expect(toggleProfilerWindow).not.toHaveBeenCalled();
    down('F9');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toggleEnvBall).not.toHaveBeenCalled();
  });

  it("add the app's own debugKeys as a map of their own, warning on a reserved chord", () => {
    const fn = vi.fn();
    dom.config = { debugKeys: [{ id: 'app-key', chord: { key: 'h' }, fn }] };
    registerDefaultDebugKeyBindings();
    expect(getActionMap(APP_DEBUG_KEYS_ACTION_MAP_ID)?.actions['app-key']).toBeDefined();
    expect(vi.mocked(lwarn).mock.calls[0][0]).toContain('"sc-toggle-debug-drawer"');
    down('h');
    up('h');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toggleActiveViewDrawer).toHaveBeenCalledTimes(1); // both run
  });

  it('warn when an app key binding or action map binds a debug key', () => {
    registerDefaultDebugKeyBindings();
    createKeyBinding({ id: 'app-o', type: 'KEY_DOWN', chord: { key: 'o' }, fn: () => {} });
    deleteKeyBinding('app-o');
    createActionMap({
      id: 'game',
      actions: { inventory: { type: 'BUTTON' } },
      // A gameplay map ignores modifiers: 'i' with any of them
      bindings: { inventory: [{ device: 'KEYBOARD', keys: ['i'] }] },
    });
    const messages = vi.mocked(lwarn).mock.calls.map((c) => c[0]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('the key binding "app-o"');
    expect(messages[1]).toContain('the action "inventory" of the action map "game"');
  });
});

describe('the production test mode keys', () => {
  it('give way to an app key binding or action map of the same key', () => {
    registerDefaultProdTestKeyBindings();
    down('F6');
    up('F6');
    expect(toggleMainPlay).toHaveBeenCalledTimes(1);

    const appFn = vi.fn();
    createKeyBinding({ id: 'app-f6', type: 'KEY_DOWN', chord: { key: 'F6' }, fn: appFn });
    down('F6');
    up('F6');
    expect(appFn).toHaveBeenCalledTimes(1);
    expect(toggleMainPlay).toHaveBeenCalledTimes(1);
    deleteKeyBinding('app-f6');

    createActionMap({
      id: 'game',
      actions: { pause: { type: 'BUTTON' } },
      bindings: { pause: [{ device: 'KEYBOARD', keys: ['F7'] }] },
    });
    down('F7');
    expect(toggleAppPlay).not.toHaveBeenCalled();
  });
});
