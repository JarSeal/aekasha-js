import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLastInputDevice, onLastInputDeviceChange } from './InputDevice';
import { removeAllInputListeners, setInputScope } from './InputState';

// The tracker's DOM: window and the mount's root are event targets, the gamepads a stubbed list
// and requestAnimationFrame a queue the test runs by hand
const dom = vi.hoisted(() => {
  const win = Object.assign(new EventTarget(), {
    matchMedia: (query: string) => ({ matches: query === '(any-pointer: fine)' }),
  });
  const root = Object.assign(new EventTarget(), {
    contains: (elem: unknown) => elem === root || elem === dom.hudButton,
  });
  const doc = { activeElement: null as unknown };
  const pads: (Gamepad | null)[] = [];
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames.length = 0;
  });
  return { win, root, doc, pads, frames, hudButton: {} };
});

/** Runs the queued frames once */
const runFrame = () => {
  const queued = dom.frames.splice(0);
  for (const fn of queued) fn(0);
};

const pointer = (target: EventTarget, type: string, pointerType: string) =>
  target.dispatchEvent(Object.assign(new Event(type), { pointerType }));

let padTimestamp = 0;
const setPad = (id: string, southPressed: boolean, leftX = 0) => {
  dom.pads[0] = {
    index: 0,
    id,
    connected: true,
    mapping: 'standard',
    timestamp: ++padTimestamp,
    axes: [leftX, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, b) => ({
      value: b === 0 && southPressed ? 1 : 0,
      pressed: b === 0 && southPressed,
    })),
  } as unknown as Gamepad;
};

afterEach(() => {
  // Back to the keyboard and mouse for the next test, while the window's listeners are on
  removeAllInputListeners();
  setInputScope('WINDOW');
  getLastInputDevice();
  dom.win.dispatchEvent(new Event('keydown'));
  removeAllInputListeners();
  dom.pads.length = 0;
  dom.frames.length = 0;
  dom.doc.activeElement = null;
});

describe('the last input device', () => {
  it('starts on the keyboard and mouse where there is a fine pointer', () => {
    expect(getLastInputDevice()).toEqual({ device: 'KEYBOARD_MOUSE' });
  });

  it('switches to touch on a touch, and back on a key, a click or the wheel', () => {
    const fn = vi.fn();
    const remove = onLastInputDeviceChange(fn);
    pointer(dom.win, 'pointerdown', 'touch');
    expect(getLastInputDevice()).toEqual({ device: 'TOUCH' });
    dom.win.dispatchEvent(new Event('keydown'));
    pointer(dom.win, 'pointerdown', 'touch');
    pointer(dom.win, 'pointerdown', 'mouse');
    pointer(dom.win, 'pointerdown', 'touch');
    dom.win.dispatchEvent(new Event('wheel'));
    expect(fn.mock.calls.map(([d]) => d.device)).toEqual([
      'TOUCH',
      'KEYBOARD_MOUSE',
      'TOUCH',
      'KEYBOARD_MOUSE',
      'TOUCH',
      'KEYBOARD_MOUSE',
    ]);
    remove();
  });

  it('calls back only on a change', () => {
    getLastInputDevice();
    const fn = vi.fn();
    const remove = onLastInputDeviceChange(fn);
    dom.win.dispatchEvent(new Event('keydown'));
    pointer(dom.win, 'pointerdown', 'mouse');
    expect(fn).not.toHaveBeenCalled();
    remove();
  });

  it("switches to a gamepad on its button or a pushed stick, with the pad's family", () => {
    const fn = vi.fn();
    const remove = onLastInputDeviceChange(fn);
    setPad('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', false);
    dom.win.dispatchEvent(new Event('gamepadconnected'));
    runFrame();
    // Connected, untouched: still the keyboard's
    expect(getLastInputDevice().device).toBe('KEYBOARD_MOUSE');
    setPad('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', true);
    runFrame();
    expect(getLastInputDevice()).toEqual({ device: 'GAMEPAD', family: 'PLAYSTATION' });
    dom.win.dispatchEvent(new Event('keydown'));
    setPad('Xbox Wireless Controller', false, 0.9);
    runFrame();
    expect(getLastInputDevice()).toEqual({ device: 'GAMEPAD', family: 'XBOX' });
    expect(fn).toHaveBeenCalledTimes(3);
    remove();
  });

  it("doesn't take the prompts from a gamepad on a mouse move, only from touch", () => {
    setPad('Xbox Wireless Controller', true);
    getLastInputDevice();
    runFrame();
    expect(getLastInputDevice().device).toBe('GAMEPAD');
    pointer(dom.win, 'pointermove', 'mouse');
    expect(getLastInputDevice().device).toBe('GAMEPAD');
    pointer(dom.win, 'pointerdown', 'touch');
    pointer(dom.win, 'pointermove', 'mouse');
    expect(getLastInputDevice().device).toBe('KEYBOARD_MOUSE');
  });

  it("stops polling the pads when none is connected, and on the listeners' removal", () => {
    getLastInputDevice();
    runFrame();
    expect(dom.frames).toHaveLength(0);
    setPad('Xbox Wireless Controller', false);
    dom.win.dispatchEvent(new Event('gamepadconnected'));
    runFrame();
    expect(dom.frames).toHaveLength(1);
    removeAllInputListeners();
    expect(dom.frames).toHaveLength(0);
    // No listener left: a connection starts no poll
    setPad('Xbox Wireless Controller', true);
    dom.win.dispatchEvent(new Event('gamepadconnected'));
    expect(dom.frames).toHaveLength(0);
  });

  it("listens in the mount's root in the CANVAS scope, and reads the pads while the focus is in it", () => {
    removeAllInputListeners();
    setInputScope('CANVAS', dom.root as unknown as HTMLElement);
    const fn = vi.fn();
    const remove = onLastInputDeviceChange(fn);
    pointer(dom.win, 'pointerdown', 'touch');
    expect(fn).not.toHaveBeenCalled();
    pointer(dom.root, 'pointerdown', 'touch');
    expect(getLastInputDevice().device).toBe('TOUCH');

    setPad('Xbox Wireless Controller', true);
    dom.win.dispatchEvent(new Event('gamepadconnected'));
    runFrame();
    expect(getLastInputDevice().device).toBe('TOUCH');
    dom.doc.activeElement = dom.hudButton;
    setPad('Xbox Wireless Controller', true);
    runFrame();
    expect(getLastInputDevice().device).toBe('GAMEPAD');
    remove();
  });
});
