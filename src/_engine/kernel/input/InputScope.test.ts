import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollGamepads, readGamepadButton } from './GamepadInput';
import { setAllInputsEnabled, removeAllInputListeners, setInputScope } from './InputState';
import { createKeyBinding, deleteKeyBinding, isChordHeld } from './KeyboardInput';
import { createMouseBinding, deleteMouseBinding } from './MouseInput';

// The devices' DOM: window and the canvas are event targets, the gamepads a stubbed list
const dom = vi.hoisted(() => {
  const win = new EventTarget();
  const canvas = Object.assign(new EventTarget(), {
    tabIndex: -1,
    hasAttribute: () => false,
  });
  const doc = {
    activeElement: null as unknown,
    documentElement: new EventTarget(),
    getElementById: () => canvas,
    pointerLockElement: null,
  };
  const pads: (Gamepad | null)[] = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  return { win, canvas, doc, pads };
});

// The canvas exists from the start (the devices add their canvas listeners once it does)
vi.mock(import('../render/Renderer'), () => ({
  getCanvasElem: () => dom.canvas as unknown as HTMLElement,
  getRenderer: () => ({ domElement: dom.canvas }) as never,
  onRendererCreated: (fn: (renderer: never) => void) => fn({ domElement: dom.canvas } as never),
}));

const keyEvent = (target: EventTarget, type: 'keydown' | 'keyup', key: string) =>
  target.dispatchEvent(
    Object.assign(new Event(type), {
      key,
      repeat: false,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    })
  );

/** A wheel event whose target is the canvas, dispatched on `on` */
const wheelOnCanvas = (on: EventTarget) => {
  const e = Object.assign(new Event('wheel'), { deltaX: 0, deltaY: 1, deltaMode: 0 });
  Object.defineProperty(e, 'target', { value: dom.canvas });
  on.dispatchEvent(e);
};

let padTimestamp = 0;
const setSouthPressed = (pressed: boolean) => {
  dom.pads[0] = {
    index: 0,
    id: 'pad 0',
    connected: true,
    mapping: 'standard',
    timestamp: ++padTimestamp,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, b) => {
      const value = b === 0 && pressed ? 1 : 0;
      return { value, pressed: value >= 0.5, touched: value > 0 };
    }),
  } as unknown as Gamepad;
};

const bindKeyAndWheel = () => {
  const onKey = vi.fn();
  const onWheel = vi.fn();
  createKeyBinding({ id: 'scopeKey', type: 'KEY_DOWN', chord: { key: 'a' }, fn: onKey });
  createMouseBinding({ id: 'scopeWheel', type: 'MOUSE_WHEEL', fn: onWheel });
  return { onKey, onWheel };
};

afterEach(() => {
  deleteKeyBinding('scopeKey');
  deleteMouseBinding('scopeWheel');
  removeAllInputListeners();
  setInputScope('WINDOW');
  setAllInputsEnabled(true);
  dom.canvas.tabIndex = -1;
  dom.doc.activeElement = null;
  dom.pads.length = 0;
  pollGamepads();
});

describe('input scope: WINDOW (default)', () => {
  it('listens on the window', () => {
    const { onKey, onWheel } = bindKeyAndWheel();
    keyEvent(dom.win, 'keydown', 'a');
    wheelOnCanvas(dom.win);
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(dom.canvas.tabIndex).toBe(-1);
  });

  it('removeAllInputListeners removes them, and the next binding adds them again', () => {
    const { onKey } = bindKeyAndWheel();
    removeAllInputListeners();
    keyEvent(dom.win, 'keydown', 'a');
    expect(onKey).not.toHaveBeenCalled();
    const again = bindKeyAndWheel();
    keyEvent(dom.win, 'keydown', 'a');
    expect(again.onKey).toHaveBeenCalledTimes(1);
  });
});

describe('input scope: NONE', () => {
  it('adds no listeners', () => {
    setInputScope('NONE');
    const { onKey, onWheel } = bindKeyAndWheel();
    keyEvent(dom.win, 'keydown', 'a');
    keyEvent(dom.canvas, 'keydown', 'a');
    wheelOnCanvas(dom.win);
    wheelOnCanvas(dom.canvas);
    expect(onKey).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
  });

  it('reads no gamepad', () => {
    setInputScope('NONE');
    setSouthPressed(true);
    expect(pollGamepads()).toBe(false);
    expect(readGamepadButton(undefined, 'SOUTH')).toBe(0);
  });
});

describe('input scope: CANVAS', () => {
  it('listens on the canvas only, which takes focus', () => {
    setInputScope('CANVAS');
    const { onKey, onWheel } = bindKeyAndWheel();
    keyEvent(dom.win, 'keydown', 'a');
    wheelOnCanvas(dom.win);
    expect(onKey).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();

    keyEvent(dom.canvas, 'keydown', 'a');
    wheelOnCanvas(dom.canvas);
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(dom.canvas.tabIndex).toBe(0);
  });

  it("clears the held keys on the canvas's blur", () => {
    setInputScope('CANVAS');
    bindKeyAndWheel();
    keyEvent(dom.canvas, 'keydown', 'w');
    expect(isChordHeld({ key: 'w' })).toBe(true);
    dom.canvas.dispatchEvent(new Event('blur'));
    expect(isChordHeld({ key: 'w' })).toBe(false);
  });

  it('reads the gamepads while the canvas has focus, and releases them when it loses it', () => {
    setInputScope('CANVAS');
    setSouthPressed(true);
    expect(pollGamepads()).toBe(false);
    expect(readGamepadButton(undefined, 'SOUTH')).toBe(0);

    dom.doc.activeElement = dom.canvas;
    expect(pollGamepads()).toBe(true);
    expect(readGamepadButton(undefined, 'SOUTH')).toBe(1);

    dom.doc.activeElement = null;
    expect(pollGamepads()).toBe(true);
    expect(readGamepadButton(undefined, 'SOUTH')).toBe(0);
    expect(pollGamepads()).toBe(false);
  });
});
