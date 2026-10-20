import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAllInputsEnabled } from './InputState';
import {
  CLICK_MAX_MOVE_PX,
  createMouseBinding,
  deleteMouseBinding,
  type MouseBinding,
} from './MouseInput';

// The window and the canvas are event targets (the default WINDOW scope listens on the window)
const dom = vi.hoisted(() => {
  const win = new EventTarget();
  const canvas = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { documentElement: new EventTarget(), pointerLockElement: null });
  return { win, canvas };
});

vi.mock(import('../render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCanvasElem: () => dom.canvas as unknown as HTMLElement,
}));

// Picking: whatever `pick.hit` is, wherever the pointer is
const pick = vi.hoisted(() => ({ hit: undefined as { object: { uuid: string } } | undefined }));
vi.mock(import('./InputPicking'), () => ({ pickTargetsAt: () => pick.hit as never }));

// The hover system: run by hand
const hover = vi.hoisted(() => ({ system: null as (() => void) | null }));
vi.mock(import('../ecs/ECS'), async (importOriginal) => ({
  ...(await importOriginal()),
  getECSWorld: () =>
    ({
      addSystem: (_stage: unknown, _id: string, fn: () => void) => {
        hover.system = fn;
      },
    }) as never,
}));

const now = vi.hoisted(() => ({ ms: 1000 }));
vi.spyOn(performance, 'now').mockImplementation(() => now.ms);

/** A mouse event whose target is `target` (the canvas by default), dispatched on the window */
const mouseEvent = (type: string, fields: object, target: EventTarget = dom.canvas) => {
  const e = Object.assign(new Event(type, { cancelable: true }), fields);
  Object.defineProperty(e, 'target', { value: target });
  dom.win.dispatchEvent(e);
  return e;
};
const press = (button: number, x = 10, y = 10, target?: EventTarget) =>
  mouseEvent('mousedown', { button, clientX: x, clientY: y }, target);
const release = (button: number, x = 10, y = 10, target?: EventTarget) =>
  mouseEvent('mouseup', { button, clientX: x, clientY: y }, target);
const click = (button: number, x?: number, y?: number) => {
  press(button, x, y);
  release(button, x, y);
};

const ids: string[] = [];
const bind = (binding: MouseBinding) => {
  ids.push(binding.id);
  createMouseBinding(binding);
};
const target = { uuid: 'target' };

afterEach(() => {
  while (ids.length) deleteMouseBinding(ids.pop()!);
  pick.hit = undefined;
  setAllInputsEnabled(true);
});

describe('mouse bindings: clicks', () => {
  it('fires a click on a target with the hit, for its button only', () => {
    const fn = vi.fn();
    bind({ id: 'click', type: 'MOUSE_CLICK', button: 'LEFT', targets: [], fn });
    click(0);
    expect(fn).not.toHaveBeenCalled(); // no hit
    pick.hit = { object: target };
    click(2);
    expect(fn).not.toHaveBeenCalled();
    click(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][1]).toBe(pick.hit);
  });

  it('is a drag, not a click, past CLICK_MAX_MOVE_PX', () => {
    const fn = vi.fn();
    pick.hit = { object: target };
    bind({ id: 'click', type: 'MOUSE_CLICK', button: 'LEFT', targets: [], fn });
    press(0, 10, 10);
    release(0, 10 + CLICK_MAX_MOVE_PX + 1, 10);
    expect(fn).not.toHaveBeenCalled();
    press(0, 10, 10);
    release(0, 10 + CLICK_MAX_MOVE_PX, 10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('starts and ends on the canvas', () => {
    const fn = vi.fn();
    const hud = new EventTarget();
    pick.hit = { object: target };
    bind({ id: 'click', type: 'MOUSE_CLICK', button: 'LEFT', targets: [], fn });
    press(0, 10, 10, hud);
    release(0);
    press(0);
    release(0, 10, 10, hud);
    expect(fn).not.toHaveBeenCalled();
  });

  it('times a right double-click; a third click starts a new pair', () => {
    const fn = vi.fn();
    bind({ id: 'dbl', type: 'MOUSE_DBLCLICK', button: 'RIGHT', maxIntervalMs: 300, fn });
    click(2);
    now.ms += 200;
    click(2);
    expect(fn).toHaveBeenCalledTimes(1);
    now.ms += 100;
    click(2);
    expect(fn).toHaveBeenCalledTimes(1);
    now.ms += 400;
    click(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('takes the native dblclick for the left button', () => {
    const fn = vi.fn();
    bind({ id: 'dbl', type: 'MOUSE_DBLCLICK', button: 'LEFT', fn });
    mouseEvent('dblclick', { button: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][1]).toBeUndefined(); // no targets: no hit passed
  });

  it('fires nothing while the inputs are off', () => {
    const fn = vi.fn();
    pick.hit = { object: target };
    bind({ id: 'click', type: 'MOUSE_CLICK', button: 'LEFT', targets: [], fn });
    setAllInputsEnabled(false);
    click(0);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('mouse bindings: wheel, context menu, hover', () => {
  it('fires the wheel over the canvas only', () => {
    const fn = vi.fn();
    bind({ id: 'wheel', type: 'MOUSE_WHEEL', fn });
    mouseEvent('wheel', { deltaY: 1 }, new EventTarget());
    mouseEvent('wheel', { deltaY: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("prevents the canvas' context menu while a binding uses the right button", () => {
    expect(mouseEvent('contextmenu', {}).defaultPrevented).toBe(false);
    bind({ id: 'right', type: 'MOUSE_CLICK', button: 'RIGHT', targets: [], fn: () => {} });
    expect(mouseEvent('contextmenu', {}).defaultPrevented).toBe(true);
  });

  it('enters and leaves a target, once per frame the pointer moved', () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    bind({ id: 'hover', type: 'MOUSE_HOVER', targets: [], onEnter, onLeave });
    pick.hit = { object: target };
    mouseEvent('mousemove', { clientX: 1, clientY: 1 });
    hover.system!();
    hover.system!(); // not moved: no new raycast, no new call
    expect(onEnter).toHaveBeenCalledTimes(1);
    pick.hit = undefined;
    mouseEvent('mousemove', { clientX: 2, clientY: 1 });
    hover.system!();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
