import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHeldKeyPoller } from '../loop/MainLoop';
import { setAllInputsEnabled, setAppInputsSuspended } from './InputState';
import {
  createKeyBinding,
  deleteKeyBinding,
  doKeyChordsCollide,
  getKeyChordLabel,
  pollHeldKeyBindings,
  setKeyBindingEnabled,
  type KeyBinding,
} from './KeyboardInput';

// The window is an event target (the keys listen on it in the default WINDOW scope)
const dom = vi.hoisted(() => {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { documentElement: new EventTarget() });
  return { win };
});

const scene = vi.hoisted(() => ({ id: 'level1' as string | null }));
vi.mock(import('../scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => scene.id,
}));

// The loop's held-key hook (D5): set by the first KEY_HELD binding
vi.mock(import('../loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  setHeldKeyPoller: vi.fn(),
}));

type Mods = { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean; repeat?: boolean };

const keyEvent = (type: 'keydown' | 'keyup', key: string, mods: Mods = {}) =>
  dom.win.dispatchEvent(
    Object.assign(new Event(type), {
      key,
      repeat: !!mods.repeat,
      shiftKey: !!mods.shift,
      ctrlKey: !!mods.ctrl,
      altKey: !!mods.alt,
      metaKey: !!mods.meta,
    })
  );
const down = (key: string, mods?: Mods) => keyEvent('keydown', key, mods);
const up = (key: string, mods?: Mods) => keyEvent('keyup', key, mods);

const ids: string[] = [];
const bind = (binding: KeyBinding) => {
  ids.push(binding.id);
  createKeyBinding(binding);
  return binding;
};
const onDown = (id: string, chord: KeyBinding['chord'], extra: Partial<KeyBinding> = {}) => {
  const fn = vi.fn();
  bind({ id, type: 'KEY_DOWN', chord, fn, ...extra } as KeyBinding);
  return fn;
};

afterEach(() => {
  while (ids.length) deleteKeyBinding(ids.pop()!);
  // Releases whatever a test left held
  for (const key of ['a', 'w', 'W', 'Shift', 'z']) up(key);
  setAllInputsEnabled(true);
  setAppInputsSuspended(false);
  scene.id = 'level1';
});

describe("the loop's held-key poll", () => {
  // First in the file: the hook is set once per module
  it('is set by the first KEY_HELD binding only (the loop imports no keyboard code)', () => {
    onDown('notHeld', { key: 'a' });
    expect(setHeldKeyPoller).not.toHaveBeenCalled();
    bind({ id: 'held1', type: 'KEY_HELD', chord: { key: 'w' }, fn: () => {} });
    bind({ id: 'held2', type: 'KEY_HELD', chord: { key: 's' }, fn: () => {} });
    expect(setHeldKeyPoller).toHaveBeenCalledTimes(1);
    expect(setHeldKeyPoller).toHaveBeenCalledWith(pollHeldKeyBindings);
  });
});

describe('key bindings: matching', () => {
  it('matches the chord exactly: a plain key fires without modifiers only', () => {
    const fn = onDown('plain', { key: 'h' });
    down('h', { shift: true });
    expect(fn).not.toHaveBeenCalled();
    down('h');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][1]).toEqual(expect.any(Number)); // the event's time
  });

  it('needs its modifiers held', () => {
    const fn = onDown('undo', { key: 'z', ctrl: true });
    down('z');
    down('z', { ctrl: true, shift: true });
    expect(fn).not.toHaveBeenCalled();
    down('z', { ctrl: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores the modifiers with ignoreModifiers', () => {
    const fn = onDown('move', { key: 'w' }, { ignoreModifiers: true });
    down('w', { shift: true, ctrl: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("matches a modifier key's own chord, whose event sets its flag", () => {
    const fn = onDown('run', { key: 'Shift' });
    down('Shift', { shift: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive by default, and case-sensitive on request', () => {
    const anyCase = onDown('anyCase', { key: 'a' });
    const exact = onDown('exact', { key: 'a' }, { caseInsensitive: false });
    down('A');
    expect(anyCase).toHaveBeenCalledTimes(1);
    expect(exact).not.toHaveBeenCalled();
  });

  it('fires for any chord of a list, and KEY_UP on the release', () => {
    const onPress = onDown('either', [{ key: 'a' }, { key: 'b' }]);
    const onRelease = vi.fn();
    bind({ id: 'release', type: 'KEY_UP', chord: { key: 'b' }, fn: onRelease });
    down('b');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    up('b');
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('replaces a binding with the same id', () => {
    const first = onDown('same', { key: 'a' });
    const second = onDown('same', { key: 'a' });
    down('a');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('key bindings: when they run', () => {
  it('skips a disabled binding (setKeyBindingEnabled writes the passed object)', () => {
    const fn = vi.fn();
    const binding = bind({ id: 'toggled', type: 'KEY_DOWN', chord: { key: 'a' }, fn });
    setKeyBindingEnabled('toggled', false);
    expect(binding.enabled).toBe(false);
    down('a');
    expect(fn).not.toHaveBeenCalled();
    setKeyBindingEnabled('toggled', true);
    down('a');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs only in its scene', () => {
    const fn = onDown('scoped', { key: 'a' }, { sceneId: 'level2' });
    down('a');
    expect(fn).not.toHaveBeenCalled();
    scene.id = 'level2';
    down('a');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('follows the master switches: a debug key runs while app inputs are suspended', () => {
    const app = onDown('app', { key: 'a' });
    const debugKey = onDown('debugKey', { key: 'a' }, { isDebugKey: true });
    setAppInputsSuspended(true); // an editor view
    down('a');
    expect(app).not.toHaveBeenCalled();
    expect(debugKey).toHaveBeenCalledTimes(1);
    setAllInputsEnabled(false); // a scene load
    down('a');
    expect(debugKey).toHaveBeenCalledTimes(1);
  });

  it('a yielding binding gives way to another that fires for the event', () => {
    const yielding = onDown('yielding', { key: 'a' }, { yieldToOtherBindings: true });
    down('a');
    expect(yielding).toHaveBeenCalledTimes(1);
    const other = onDown('other', { key: 'a' });
    down('a');
    expect(other).toHaveBeenCalledTimes(1);
    expect(yielding).toHaveBeenCalledTimes(1);
  });
});

describe('held keys', () => {
  it('polls a KEY_HELD binding with the delta while its chord is held', () => {
    const fn = vi.fn();
    bind({ id: 'held', type: 'KEY_HELD', chord: { key: 'w' }, ignoreModifiers: true, fn });
    pollHeldKeyBindings(0.016);
    expect(fn).not.toHaveBeenCalled();
    down('w');
    pollHeldKeyBindings(0.016);
    pollHeldKeyBindings(0.016);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(0.016);
    up('w');
    pollHeldKeyBindings(0.016);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('releases a letter pressed with Shift and released after it', () => {
    const fn = vi.fn();
    bind({ id: 'held', type: 'KEY_HELD', chord: { key: 'w' }, ignoreModifiers: true, fn });
    down('Shift', { shift: true });
    down('W', { shift: true });
    up('Shift');
    up('w');
    pollHeldKeyBindings(0.016);
    expect(fn).not.toHaveBeenCalled();
  });

  it('polls nothing while app inputs are off', () => {
    const fn = vi.fn();
    bind({ id: 'held', type: 'KEY_HELD', chord: { key: 'w' }, fn });
    down('w');
    setAllInputsEnabled(false);
    pollHeldKeyBindings(0.016);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('chords', () => {
  it('labels a chord, its alternatives joined', () => {
    expect(getKeyChordLabel({ key: 'z', ctrl: true, shift: true })).toBe('Ctrl+Shift+Z');
    expect(getKeyChordLabel([{ key: ' ' }, { key: 'Enter' }])).toBe('Space / Enter');
  });

  it('collides on the same key (any case) and the same modifiers', () => {
    expect(
      doKeyChordsCollide({ key: 'Z', ctrl: true }, [{ key: 'x' }, { key: 'z', ctrl: true }])
    ).toBe(true);
    expect(doKeyChordsCollide({ key: 'z' }, { key: 'z', ctrl: true })).toBe(false);
  });
});
