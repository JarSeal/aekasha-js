import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTouchBinding, deleteTouchBinding, type TouchBinding } from './TouchInput';

// The window and the canvas are event targets (the default WINDOW scope listens on the window)
const dom = vi.hoisted(() => {
  const win = new EventTarget();
  const canvas = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { documentElement: new EventTarget() });
  return { win, canvas };
});

vi.mock(import('../render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCanvasElem: () => dom.canvas as unknown as HTMLElement,
}));

const pick = vi.hoisted(() => ({ hit: undefined as object | undefined }));
vi.mock(import('./InputPicking'), () => ({ pickTargetsAt: () => pick.hit as never }));

const now = vi.hoisted(() => ({ ms: 1000 }));
vi.spyOn(performance, 'now').mockImplementation(() => now.ms);

type Point = { id: number; x: number; y: number };
const toList = (points: Point[]) =>
  Object.assign(
    points.map((p) => ({ identifier: p.id, clientX: p.x, clientY: p.y })),
    { item: (i: number) => points[i] }
  );

/** A touch event on the canvas: `touches` are the fingers down after it, `changed` the ones it's
 * about */
const touchEvent = (type: string, touches: Point[], changed: Point[] = touches) => {
  const e = Object.assign(new Event(type, { cancelable: true }), {
    touches: toList(touches),
    changedTouches: toList(changed),
  });
  Object.defineProperty(e, 'target', { value: dom.canvas });
  dom.win.dispatchEvent(e);
  return e;
};
const finger = (x: number, y: number, id = 1): Point => ({ id, x, y });

const ids: string[] = [];
const bind = (binding: TouchBinding) => {
  ids.push(binding.id);
  createTouchBinding(binding);
};

afterEach(() => {
  while (ids.length) deleteTouchBinding(ids.pop()!);
  pick.hit = undefined;
});

describe('touch bindings', () => {
  it('taps on a quick release without moving, with the hit on a target', () => {
    const fn = vi.fn();
    bind({ id: 'tap', type: 'TOUCH_TAP', targets: [], fn });
    pick.hit = { object: 'target' };
    touchEvent('touchstart', [finger(10, 10)]);
    now.ms += 100;
    touchEvent('touchend', [], [finger(12, 10)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][1]).toBe(pick.hit);
  });

  it("isn't a tap held too long, or moved too far", () => {
    const fn = vi.fn();
    bind({ id: 'tap', type: 'TOUCH_TAP', fn });
    touchEvent('touchstart', [finger(10, 10)]);
    now.ms += 300; // over the default 250 ms
    touchEvent('touchend', [], [finger(10, 10)]);
    touchEvent('touchstart', [finger(10, 10)]);
    touchEvent('touchmove', [finger(30, 10)]);
    touchEvent('touchend', [], [finger(30, 10)]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('drags one finger past the tap distance, in CSS pixel deltas', () => {
    const onStart = vi.fn();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    bind({ id: 'drag', type: 'TOUCH_DRAG', onStart, onMove, onEnd });
    touchEvent('touchstart', [finger(10, 10)]);
    const small = touchEvent('touchmove', [finger(15, 10)]);
    expect(onStart).not.toHaveBeenCalled();
    expect(small.defaultPrevented).toBe(true); // no native scrolling while a drag binding is on
    touchEvent('touchmove', [finger(30, 10)]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][1]).toEqual({ x: 20, y: 0 });
    touchEvent('touchmove', [finger(30, 25)]);
    expect(onMove.mock.calls[1][1]).toEqual({ x: 0, y: 15 });
    touchEvent('touchend', [], [finger(30, 25)]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('pinches two fingers: the distance and its change, and no tap', () => {
    const onPinch = vi.fn();
    const onTap = vi.fn();
    bind({ id: 'pinch', type: 'TOUCH_PINCH', onPinch });
    bind({ id: 'tap', type: 'TOUCH_TAP', fn: onTap });
    touchEvent('touchstart', [finger(0, 0)]);
    touchEvent('touchstart', [finger(0, 0), finger(100, 0, 2)], [finger(100, 0, 2)]);
    const move = touchEvent('touchmove', [finger(0, 0), finger(120, 0, 2)]);
    expect(onPinch).toHaveBeenCalledWith(move, 120, 20);
    expect(move.defaultPrevented).toBe(true); // no native page zoom
    touchEvent('touchend', [finger(0, 0)], [finger(120, 0, 2)]);
    touchEvent('touchend', [], [finger(0, 0)]);
    expect(onTap).not.toHaveBeenCalled();
  });
});
