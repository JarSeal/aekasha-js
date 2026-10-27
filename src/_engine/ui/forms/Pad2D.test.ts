import { Vector2 } from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { FieldChange } from './Field';
import { createPad2D, type Pad2DProps, type Pad2DValue } from './Pad2D';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: Pad2DValue; prev: Pad2DValue; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** A pad bound to `target.value`, 200 px square from the page's origin (linkedom lays nothing
 * out), with its onChange calls (plain copies) */
const makePad = (props: Partial<Pad2DProps> = {}, start: Pad2DValue = new Vector2(0.25, -0.5)) => {
  const target = { value: start };
  const calls: Change[] = [];
  const field = createPad2D({
    label: 'Offset',
    target,
    key: 'value',
    onChange: (value: Pad2DValue, { prev, last, source }: FieldChange<Pad2DValue>) =>
      calls.push({
        value: { x: value.x, y: value.y },
        prev: { x: prev.x, y: prev.y },
        last,
        source,
      }),
    ...props,
  } as Pad2DProps);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const pad = root.querySelector<HTMLElement>('.aekPad2D__pad')!;
  if (pad) {
    pad.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      }) as DOMRect;
  }
  const point = root.querySelector<HTMLElement>('.aekPad2D__point')!;
  const inputs = [...root.querySelectorAll<HTMLInputElement>('input')];
  const label = root.querySelector<HTMLElement>('.aekField__label')!;
  return { field, target, calls, root, pad, point, inputs, label };
};

const user = (x: number, y: number, prev: [number, number], last: boolean) => ({
  value: { x: expect.closeTo(x, 10), y: expect.closeTo(y, 10) },
  prev: { x: expect.closeTo(prev[0], 10), y: expect.closeTo(prev[1], 10) },
  last,
  source: 'user',
});

describe('the 2D pad (p804 D8)', () => {
  it('a pad with its point at the value over the two axes, described by its value', () => {
    const { root, pad, point, inputs, label } = makePad();
    expect(root.getAttribute('data-kind')).toBe('pad2d');
    const row = root.querySelector('.aekVectorField.aekPad2D')!;
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-labelledby')).toBe(label.id);
    expect(pad.getAttribute('role')).toBe('group');
    expect(pad.getAttribute('aria-roledescription')).toBe('2D pad');
    expect(pad.getAttribute('tabindex')).toBe('0');
    expect(pad.getAttribute('aria-labelledby')).toBe(label.id);
    const text = document.getElementById(pad.getAttribute('aria-describedby')!)!;
    expect(text.textContent).toBe('X 0.25, Y -0.50');
    expect(text.classList.contains('aekVisuallyHidden')).toBe(true);
    expect(inputs.map((input) => input.getAttribute('aria-label'))).toEqual(['X', 'Y']);
    expect(inputs.map((input) => input.value)).toEqual(['0.25', '-0.50']);
    // The default range, -1 to 1: y upwards
    expect(point.style.left).toBe('62.5%');
    expect(point.style.top).toBe('75%');
    const line = root.querySelector('.aekPad2D__line line')!;
    expect([line.getAttribute('x1'), line.getAttribute('y1')]).toEqual(['50', '50']);
    expect([line.getAttribute('x2'), line.getAttribute('y2')]).toEqual(['62.5', '75']);
  });

  it('a drag puts the point under the pointer, written in place in D3’s order', () => {
    const { pad, target, calls, point } = makePad();
    const vector = target.value;
    dispatchPointer(pad, 'pointerdown', { clientX: 150, clientY: 50 });
    expect(pad.hasAttribute('data-dragging')).toBe(true);
    expect(document.activeElement).toBe(pad);
    dispatchPointer(pad, 'pointermove', { clientX: 20, clientY: 190 });
    expect(point.style.left).toBe('10%');
    // Clamped to the pad
    dispatchPointer(pad, 'pointermove', { clientX: -40, clientY: 260 });
    dispatchPointer(pad, 'pointerup', { clientX: -40, clientY: 260 });
    expect(target.value).toBe(vector);
    expect(calls).toEqual([
      user(0.5, 0.5, [0.25, -0.5], false),
      user(-0.8, -0.9, [0.5, 0.5], false),
      user(-1, -1, [-0.8, -0.9], false),
      user(-1, -1, [0.25, -0.5], true),
    ]);
  });

  it('a press on the point drags it from where it was grabbed; Alt on a tenth of the step', () => {
    const { pad, point, target } = makePad({ step: 0.1 }, { x: 0, y: 0 });
    point.getBoundingClientRect = () =>
      ({ left: 88, top: 88, right: 112, bottom: 112, width: 24, height: 24 }) as DOMRect;
    dispatchPointer(point, 'pointerdown', { clientX: 105, clientY: 95 });
    expect(target.value).toEqual({ x: 0, y: 0 });
    dispatchPointer(pad, 'pointermove', { clientX: 128, clientY: 95, altKey: true });
    expect(target.value.x).toBeCloseTo(0.23, 10);
    dispatchPointer(pad, 'pointerup', { clientX: 128, clientY: 95 });
  });

  it('the arrows move the point by each axis’ step, Shift ×10; each keyup last: true', () => {
    const { pad, target, calls } = makePad({ axes: { y: { step: 0.25 } } });
    dispatchKey(pad, 'keydown', 'ArrowRight');
    expect(target.value.x).toBeCloseTo(0.26, 10);
    dispatchKey(pad, 'keyup', 'ArrowRight');
    dispatchKey(pad, 'keydown', 'ArrowUp');
    expect(target.value.y).toBeCloseTo(-0.25, 10);
    dispatchKey(pad, 'keydown', 'ArrowLeft', { shiftKey: true });
    expect(target.value.x).toBeCloseTo(0.16, 10);
    dispatchKey(pad, 'keyup', 'ArrowLeft');
    expect(calls.map((call) => call.last)).toEqual([false, true, false, true, false, true]);
    // Not with Ctrl / ⌘, and any other key goes on
    const ctrl = dispatchKey(pad, 'keydown', 'ArrowRight', { ctrlKey: true });
    expect(ctrl.defaultPrevented).toBe(false);
    expect(target.value.x).toBeCloseTo(0.16, 10);
  });

  it('invertY: y grows downwards, on the pad and by the arrows', () => {
    const { pad, point, target } = makePad({ invertY: true });
    expect(point.style.top).toBe('25%');
    dispatchKey(pad, 'keydown', 'ArrowUp');
    expect(target.value.y).toBeCloseTo(-0.51, 10);
    dispatchKey(pad, 'keyup', 'ArrowUp');
    dispatchPointer(pad, 'pointerdown', { clientX: 100, clientY: 150 });
    expect(target.value.y).toBeCloseTo(0.5, 10);
    dispatchPointer(pad, 'pointerup', { clientX: 100, clientY: 150 });
  });

  it('no lines through 0 unless it’s inside the range (not at an end); the axes’ own ranges', () => {
    const { root, point, inputs } = makePad(
      { min: 1, max: 11, step: 1, axes: { y: { min: 0, max: 100 } } },
      { x: 6, y: 25 }
    );
    for (const axis of root.querySelectorAll('.aekPad2D__axis')) {
      expect(axis.hasAttribute('hidden')).toBe(true);
    }
    expect(root.querySelector('.aekPad2D__line')!.hasAttribute('hidden')).toBe(true);
    expect([point.style.left, point.style.top]).toEqual(['50%', '75%']);
    expect(inputs[1].getAttribute('aria-valuemax')).toBe('100');
  });

  it('a press ends typed text in an axis; a change from outside flashes the row', () => {
    const scheduler = createBindingScheduler();
    removers.push(() => scheduler.dispose());
    const { pad, inputs, target, root } = makePad({ scheduler });
    inputs[0].value = '0.9';
    inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    dispatchPointer(pad, 'pointerdown', { clientX: 100, clientY: 100 });
    dispatchPointer(pad, 'pointerup', { clientX: 100, clientY: 100 });
    expect(inputs[0].value).toBe('0.00');
    target.value.x = 1;
    scheduler.refresh();
    expect(root.querySelector('.aekPad2D')!.hasAttribute('data-flash')).toBe(true);
    expect(root.querySelector<HTMLElement>('.aekPad2D__point')!.style.left).toBe('100%');
    expect(document.getElementById(pad.getAttribute('aria-describedby')!)!.textContent).toBe(
      'X 1.00, Y 0.00'
    );
  });

  it('disabled, the pad is out of the tab order and takes nothing', () => {
    const { field, pad, target } = makePad({}, { x: 0, y: 0 });
    field.setDisabled(true);
    expect(pad.getAttribute('aria-disabled')).toBe('true');
    expect(pad.hasAttribute('tabindex')).toBe(false);
    dispatchKey(pad, 'keydown', 'ArrowRight');
    dispatchPointer(pad, 'pointerdown', { clientX: 200, clientY: 0 });
    expect(target.value).toEqual({ x: 0, y: 0 });
    field.setDisabled(false);
    expect(pad.getAttribute('tabindex')).toBe('0');
  });

  it('readonly is a monitor of the axes', () => {
    const { root } = makePad({ readonly: true });
    expect(root.getAttribute('data-kind')).toBe('monitor');
    expect(root.textContent).toContain('0.25, -0.50');
  });

  it('removed mid-drag, it leaves no listener and writes nothing more', () => {
    const { field, pad, inputs, calls } = makePad();
    dispatchPointer(pad, 'pointerdown', { clientX: 10, clientY: 10 });
    field.cmp.remove();
    expect(countListeners(pad)).toBe(0);
    for (const input of inputs) expect(countListeners(input)).toBe(0);
    expect(calls.map((call) => call.last)).toEqual([false]);
  });
});
