import { Vector3 } from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { FieldChange } from './Field';
import { createVectorField, type VectorFieldProps, type VectorValue } from './VectorField';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: unknown; prev: unknown; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
  vi.restoreAllMocks();
});

/** A vector field bound to `target.value`, in the HUD root, with its onChange calls */
const makeVector = <T extends VectorValue>(start: T, props: Partial<VectorFieldProps<T>> = {}) => {
  const target = { value: start };
  const calls: Change[] = [];
  const field = createVectorField<T>({
    label: 'Position',
    target,
    key: 'value',
    onChange: (value: T, { prev, last, source }: FieldChange<T>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as VectorFieldProps<T>);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const inputs = [...root.querySelectorAll<HTMLInputElement>('.aekVectorField input')];
  const group = root.querySelector<HTMLElement>('.aekVectorField')!;
  const link = root.querySelector<HTMLButtonElement>('.aekVectorField__link');
  const press = (input: HTMLInputElement, key: string, init = {}) => {
    const down = dispatchKey(input, 'keydown', key, init);
    dispatchKey(input, 'keyup', key, init);
    return down;
  };
  const type = (input: HTMLInputElement, text: string) => {
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    dispatchKey(input, 'keydown', 'Enter');
  };
  return { field, target, calls, root, inputs, group, link, press, type };
};

const clipboardEvent = (type: string, text = '') => {
  const data = new Map([['text/plain', text]]);
  return Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), {
    clipboardData: {
      getData: (format: string) => data.get(format) ?? '',
      setData: (format: string, value: string) => data.set(format, value),
    },
    data,
  });
};

describe('the vector field (p804 D8)', () => {
  it('is a group named by the label: a spin button per axis, named by its letter', () => {
    const { root, group, inputs } = makeVector({ x: 1, y: 2.5, z: -3 }, { step: 0.1 });
    expect(root.getAttribute('data-kind')).toBe('vector');
    expect(group.getAttribute('role')).toBe('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Position'
    );
    expect(inputs.map((input) => input.getAttribute('role'))).toEqual([
      'spinbutton',
      'spinbutton',
      'spinbutton',
    ]);
    expect(inputs.map((input) => input.getAttribute('aria-label'))).toEqual(['X', 'Y', 'Z']);
    expect(inputs.map((input) => input.value)).toEqual(['1.0', '2.5', '-3.0']);
    const letters = [...root.querySelectorAll('.aekVectorField__letter')];
    expect(letters.map((letter) => letter.textContent)).toEqual(['X', 'Y', 'Z']);
    expect(letters.every((letter) => letter.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(root.querySelector('.aekVectorField__link')).toBe(null);
  });

  it('a key step writes the whole vector in place, in D3’s order', () => {
    const vector = new Vector3(1, 2, 3);
    const { target, inputs, calls, press } = makeVector(vector, { step: 0.5 });
    press(inputs[1], 'ArrowUp');
    expect(target.value).toBe(vector);
    expect(vector.toArray()).toEqual([1, 2.5, 3]);
    expect(calls).toEqual([
      { value: { x: 1, y: 2.5, z: 3 }, prev: { x: 1, y: 2, z: 3 }, last: false, source: 'user' },
      { value: { x: 1, y: 2.5, z: 3 }, prev: { x: 1, y: 2, z: 3 }, last: true, source: 'user' },
    ]);
  });

  it('typed expressions write their axis; an axis’ own rules over the shared ones', () => {
    const { target, inputs, type, press } = makeVector(
      { x: 1, y: 2, z: 3 },
      { step: 1, axes: { y: { min: 0, label: 'Height' } } }
    );
    type(inputs[2], '2 * 4');
    expect(target.value).toEqual({ x: 1, y: 2, z: 8 });
    expect(inputs[1].getAttribute('aria-label')).toBe('Height');
    press(inputs[1], 'Home');
    expect(target.value.y).toBe(0);
    // No min on x: Home is the caret's
    expect(press(inputs[0], 'Home').defaultPrevented).toBe(false);
    expect(target.value.x).toBe(1);
  });

  it('an array of numbers: its axes by place, written in place; a held one stays an array', () => {
    const array = [1, 2];
    const { target, inputs, press, field } = makeVector(array, { step: 1 });
    expect(inputs).toHaveLength(2);
    press(inputs[0], 'ArrowUp');
    expect(target.value).toBe(array);
    expect(array).toEqual([2, 2]);
    expect(Array.isArray(field.getValue())).toBe(true);
    const held = createVectorField({ label: 'Held', value: [0, 0, 0, 1] });
    removers.push(() => held.cmp.remove());
    expect(held.getValue()).toEqual([0, 0, 0, 1]);
    expect(
      [...held.cmp.elem.querySelectorAll('.aekVectorField__letter')].map((l) => l.textContent)
    ).toEqual(['X', 'Y', 'Z', 'W']);
  });

  it('warns for a value that isn’t a vector', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    makeVector({ a: 1 } as unknown as VectorValue);
    makeVector([1, 2, 3, 4, 5]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('the vector field’s link (p804 D8)', () => {
  it('a toggle: pressed while linked; a change scales the other axes by its factor', () => {
    const changes: boolean[] = [];
    const { link, target, inputs, press, field } = makeVector(
      { x: 1, y: 2, z: 0 },
      { step: 1, linkable: true, onLinkedChange: (on) => changes.push(on) }
    );
    expect(link!.getAttribute('aria-pressed')).toBe('false');
    expect(link!.getAttribute('aria-label')).toBe('Link axes');
    link!.click();
    expect(link!.getAttribute('aria-pressed')).toBe('true');
    expect(field.isLinked()).toBe(true);
    expect(changes).toEqual([true]);
    press(inputs[0], 'ArrowUp');
    expect(target.value).toEqual({ x: 2, y: 4, z: 0 });
    field.setLinked(false);
    expect(link!.getAttribute('aria-pressed')).toBe('false');
    expect(changes).toEqual([true]);
    press(inputs[0], 'ArrowUp');
    expect(target.value).toEqual({ x: 3, y: 4, z: 0 });
  });

  it('an axis that was 0 moves the others by the same amount, each kept to its rules', () => {
    const { target, inputs, type } = makeVector(
      { x: 1, y: 2, z: 0 },
      { step: 0.5, linked: true, axes: { y: { max: 2.5 } } }
    );
    type(inputs[2], '1');
    expect(target.value).toEqual({ x: 2, y: 2.5, z: 1 });
  });
});

describe('the vector field’s clipboard (p804 D6)', () => {
  it('copies the whole vector; a pasted list sets it, a number the axis', () => {
    const { inputs, target, calls } = makeVector({ x: 1, y: 2.5, z: -3 }, { step: 0.5 });
    inputs[1].setSelectionRange(1, 1);
    const copy = clipboardEvent('copy');
    inputs[1].dispatchEvent(copy);
    expect(copy.data.get('text/plain')).toBe('1, 2.5, -3');
    const list = clipboardEvent('paste', '(4, 5, 6)');
    inputs[0].dispatchEvent(list);
    expect(list.defaultPrevented).toBe(true);
    expect(target.value).toEqual({ x: 4, y: 5, z: 6 });
    expect(calls.map(({ last }) => last)).toEqual([true]);
    const single = clipboardEvent('paste', '7');
    inputs[2].dispatchEvent(single);
    expect(target.value).toEqual({ x: 4, y: 5, z: 7 });
    const short = clipboardEvent('paste', '1 2');
    inputs[2].dispatchEvent(short);
    expect(short.defaultPrevented).toBe(false);
    expect(target.value).toEqual({ x: 4, y: 5, z: 7 });
  });
});

describe('the vector field’s states (p804 D8)', () => {
  it('flashes its boxes on a refresh that reads a change from outside', () => {
    const scheduler = createBindingScheduler();
    const { target, group, inputs } = makeVector({ x: 1, y: 2 }, { scheduler, step: 1 });
    target.value.y = 5;
    scheduler.refresh();
    expect(inputs[1].value).toBe('5');
    expect(group.hasAttribute('data-flash')).toBe(true);
    scheduler.dispose();
  });

  it('readonly: a monitor of the axes', () => {
    const field = createVectorField({
      label: 'Velocity',
      get: () => ({ x: 1, y: -2.5, z: 0 }),
      readonly: true,
      precision: 2,
    });
    getHUDRootCMP().add(field.cmp);
    expect(field.cmp.elem.getAttribute('data-kind')).toBe('monitor');
    expect(field.cmp.elem.querySelector('.aekMonitor__value')!.textContent).toBe(
      '1.00, -2.50, 0.00'
    );
    field.cmp.remove();
  });

  it('disabled: every axis and the link, the group too', () => {
    const { field, inputs, link, group } = makeVector({ x: 1, y: 2 }, { linkable: true });
    field.setDisabled(true);
    expect(inputs.every((input) => input.hasAttribute('disabled'))).toBe(true);
    expect(link!.hasAttribute('disabled')).toBe(true);
    expect(group.getAttribute('aria-disabled')).toBe('true');
    field.setDisabled(false);
    expect(inputs.some((input) => input.hasAttribute('disabled'))).toBe(false);
  });

  it('an error marks every axis; focus() goes to the first', () => {
    const { field, inputs } = makeVector({ x: 1, y: 2, z: 3 });
    field.setError('Out of the level');
    expect(inputs.every((input) => input.getAttribute('aria-invalid') === 'true')).toBe(true);
    field.focus();
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('is removed with no listener left', () => {
    const { field, inputs, link } = makeVector({ x: 1, y: 2 }, { linkable: true });
    inputs[0].value = '9';
    inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    field.cmp.remove();
    for (const input of inputs) expect(countListeners(input)).toBe(0);
    expect(countListeners(link!)).toBe(0);
  });
});
