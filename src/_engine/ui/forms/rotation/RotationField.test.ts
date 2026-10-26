import { Euler, Quaternion } from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
} from '../../testing/KitDom';
import type { FieldChange } from '../Field';
import {
  createQuaternionField,
  type QuaternionFieldProps,
  type QuaternionValue,
} from './QuaternionField';
import { createRotationField, type EulerValue, type RotationFieldProps } from './RotationField';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: unknown; prev: unknown; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** The field's parts, typing into one and the clipboard */
const getParts = (root: HTMLElement) => {
  const inputs = [...root.querySelectorAll<HTMLInputElement>('.aekVectorField input')];
  const type = (input: HTMLInputElement, text: string) => {
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    dispatchKey(input, 'keydown', 'Enter');
  };
  const press = (input: HTMLInputElement, key: string) => {
    dispatchKey(input, 'keydown', key);
    dispatchKey(input, 'keyup', key);
  };
  return { inputs, type, press };
};

const makeRotation = <T extends EulerValue>(
  start: T,
  props: Partial<RotationFieldProps<T>> = {}
) => {
  const target = { rotation: start };
  const calls: Change[] = [];
  const field = createRotationField<T>({
    label: 'Rotation',
    target,
    key: 'rotation',
    onChange: (value: T, { prev, last, source }: FieldChange<T>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as RotationFieldProps<T>);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  return { field, target, calls, root: field.cmp.elem, ...getParts(field.cmp.elem) };
};

const makeQuaternion = <T extends QuaternionValue>(
  start: T,
  props: Partial<QuaternionFieldProps<T>> = {}
) => {
  const target = { quaternion: start };
  const calls: Change[] = [];
  const field = createQuaternionField<T>({
    label: 'Facing',
    target,
    key: 'quaternion',
    onChange: (value: T, { prev, last, source }: FieldChange<T>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as QuaternionFieldProps<T>);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  return { field, target, calls, root: field.cmp.elem, ...getParts(field.cmp.elem) };
};

describe('the rotation field (p804 D8)', () => {
  it('an Euler’s radians in degrees: a group of three spin buttons, their text in degrees', () => {
    const { root, inputs } = makeRotation(new Euler(0, Math.PI / 4, -Math.PI / 2));
    expect(root.getAttribute('data-kind')).toBe('rotation');
    expect(root.querySelector('.aekRotationField')!.getAttribute('role')).toBe('group');
    expect(inputs.map((input) => input.getAttribute('aria-label'))).toEqual(['X', 'Y', 'Z']);
    expect(inputs.map((input) => input.value)).toEqual(['0', '45', '-90']);
    expect(inputs[1].getAttribute('aria-valuetext')).toContain('45');
    expect(inputs[1].getAttribute('aria-valuetext')).toContain('°');
  });

  it('a radian step (Tweakpane’s π / 8) steps 22.5°, written in radians in place', () => {
    const euler = new Euler(0, 0, 0, 'YXZ');
    const { target, inputs, press, calls } = makeRotation(euler, { step: Math.PI / 8 });
    press(inputs[1], 'ArrowUp');
    expect(target.rotation).toBe(euler);
    expect(euler.y).toBeCloseTo(Math.PI / 8, 12);
    expect(euler.order).toBe('YXZ');
    expect(inputs[1].value).toBe('22.5');
    expect(calls.map(({ last }) => last)).toEqual([false, true]);
  });

  it('typed angles: degrees, °, rad and turn; each wraps at ±180°', () => {
    const { target, inputs, type } = makeRotation({ x: 0, y: 0, z: 0 });
    type(inputs[0], '0.25turn');
    expect(target.rotation.x).toBeCloseTo(Math.PI / 2, 12);
    type(inputs[1], '270°');
    expect(target.rotation.y).toBeCloseTo(-Math.PI / 2, 12);
    type(inputs[2], 'pi rad / 2');
    expect(target.rotation.z).toBeCloseTo(Math.PI / 2, 12);
  });

  it('copies its angles in degrees; a pasted list sets them in radians', () => {
    const { target, inputs } = makeRotation({ x: 0, y: Math.PI / 4, z: Math.PI / 2 });
    const data = new Map([['text/plain', '']]);
    const clipboard = (type: string, text = '') => {
      data.set('text/plain', text);
      return Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), {
        clipboardData: {
          getData: (format: string) => data.get(format) ?? '',
          setData: (format: string, value: string) => data.set(format, value),
        },
      });
    };
    inputs[0].dispatchEvent(clipboard('copy'));
    expect(data.get('text/plain')).toBe('0, 45, 90');
    inputs[0].dispatchEvent(clipboard('paste', '10, 20, 30'));
    expect(target.rotation.x).toBeCloseTo(Math.PI / 18, 12);
    expect(target.rotation.z).toBeCloseTo(Math.PI / 6, 12);
  });

  it('showOrder: a select named "Order" and its value; a pick keeps the angles', () => {
    const euler = new Euler(0.5, 0, 0, 'XYZ');
    const { root, target, calls } = makeRotation(euler, { showOrder: true });
    const trigger = root.querySelector<HTMLButtonElement>('.aekDropDownTrigger')!;
    const ids = trigger.getAttribute('aria-labelledby')!.split(' ');
    expect(ids.map((id) => document.getElementById(id)!.textContent)).toEqual(['Order', 'XYZ']);
    dispatchPointer(trigger, 'click');
    const list = document.querySelector<HTMLElement>('#hudRoot .aekDropDownList')!;
    dispatchKey(list, 'keydown', 'End');
    dispatchKey(list, 'keydown', 'Enter');
    expect(target.rotation).toBe(euler);
    expect(euler.order).toBe('XZY');
    expect(euler.x).toBe(0.5);
    expect(calls.map(({ last }) => last)).toEqual([true]);
    expect(document.getElementById(ids[1])!.textContent).toBe('XZY');
  });

  it('readonly: a monitor of the angles; disabled: the angles and the order', () => {
    const monitor = createRotationField({
      label: 'Facing',
      get: () => ({ x: 0, y: Math.PI / 4, z: Math.PI / 2 }),
      readonly: true,
    });
    getHUDRootCMP().add(monitor.cmp);
    expect(monitor.cmp.elem.querySelector('.aekMonitor__value')!.textContent).toBe('0°, 45°, 90°');
    monitor.cmp.remove();
    const { field, root, inputs } = makeRotation(new Euler(), { showOrder: true });
    field.setDisabled(true);
    expect(inputs.every((input) => input.hasAttribute('disabled'))).toBe(true);
    expect(root.querySelector('.aekDropDownTrigger')!.hasAttribute('disabled')).toBe(true);
  });

  it('is removed with no listener left, its order select with it', () => {
    const { field, root, inputs } = makeRotation(new Euler(), { showOrder: true });
    const trigger = root.querySelector<HTMLButtonElement>('.aekDropDownTrigger')!;
    dispatchPointer(trigger, 'click');
    field.cmp.remove();
    for (const input of inputs) expect(countListeners(input)).toBe(0);
    expect(document.querySelector('#hudRoot .aekDropDownList')).toBe(null);
  });
});

describe('the quaternion field (p804 D8)', () => {
  it('Euler degrees by default: a step writes a unit quaternion in place', () => {
    const q = new Quaternion();
    const { root, target, inputs, press, calls } = makeQuaternion(q);
    expect(root.getAttribute('data-kind')).toBe('quaternion');
    expect(inputs.map((input) => input.value)).toEqual(['0', '0', '0']);
    press(inputs[1], 'ArrowUp');
    expect(target.quaternion).toBe(q);
    const expected = new Quaternion().setFromEuler(new Euler(0, Math.PI / 180, 0));
    expect(q.y).toBeCloseTo(expected.y, 12);
    expect(q.w).toBeCloseTo(expected.w, 12);
    expect(q.length()).toBeCloseTo(1, 12);
    expect(calls.map(({ last }) => last)).toEqual([false, true]);
  });

  it('keeps the user’s own angles while the quaternion is theirs; re-derives one from outside', () => {
    const { field, target, inputs, type } = makeQuaternion({ x: 0, y: 0, z: 0, w: 1 });
    // Past ±90° on the middle axis: derived, three would read 180, 60, 180
    type(inputs[1], '120');
    field.refresh();
    expect(inputs.map((input) => input.value)).toEqual(['0', '120', '0']);
    const derived = new Euler().setFromQuaternion(
      new Quaternion(
        target.quaternion.x,
        target.quaternion.y,
        target.quaternion.z,
        target.quaternion.w
      )
    );
    expect(Math.round((derived.y * 180) / Math.PI)).toBe(60);
    // From outside: derived (three's conventions)
    target.quaternion = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 4));
    field.refresh();
    expect(inputs.map((input) => input.value)).toEqual(['0', '0', '45']);
  });

  it('an order of its own; a non-unit quaternion shows as its unit one', () => {
    const q = new Quaternion().setFromEuler(new Euler(0.2, 0.4, 0.6, 'ZYX'));
    const { inputs } = makeQuaternion(
      { x: q.x * 2, y: q.y * 2, z: q.z * 2, w: q.w * 2 },
      { order: 'ZYX', precision: 2 }
    );
    expect(inputs.map((input) => Number(input.value))).toEqual([
      Number(((0.2 * 180) / Math.PI).toFixed(2)),
      Number(((0.4 * 180) / Math.PI).toFixed(2)),
      Number(((0.6 * 180) / Math.PI).toFixed(2)),
    ]);
  });

  it('axis-angle: an axis (kept as typed) and an angle in degrees, normalised on write', () => {
    const { target, inputs, type, root } = makeQuaternion(
      { x: 0, y: 0, z: 0, w: 1 },
      { edit: 'axisAngle' }
    );
    expect(inputs.map((input) => input.getAttribute('aria-label'))).toEqual([
      'X',
      'Y',
      'Z',
      'Angle',
    ]);
    expect(inputs.map((input) => input.value)).toEqual(['1.00', '0.00', '0.00', '0']);
    type(inputs[3], '90');
    expect(target.quaternion.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(target.quaternion.w).toBeCloseTo(Math.SQRT1_2, 12);
    type(inputs[1], '1');
    const expected = new Quaternion().setFromAxisAngle(
      { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 } as never,
      Math.PI / 2
    );
    expect(target.quaternion.y).toBeCloseTo(expected.y, 12);
    // The axis as typed, not normalised
    expect(inputs.map((input) => input.value)).toEqual(['1.00', '1.00', '0.00', '90']);
    expect(root.querySelector('.aekQuaternionField__raw')).toBe(null);
  });

  it('showRaw: the components as text; readonly: a monitor of the angles', () => {
    const { root, inputs, type } = makeQuaternion({ x: 0, y: 0, z: 0, w: 1 }, { showRaw: true });
    const raw = root.querySelector('.aekQuaternionField__raw')!;
    expect(raw.textContent).toBe('x 0.000, y 0.000, z 0.000, w 1.000');
    type(inputs[2], '90');
    expect(raw.textContent).toBe('x 0.000, y 0.000, z 0.707, w 0.707');
    const monitor = createQuaternionField({
      label: 'Facing',
      get: () => ({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }),
      readonly: true,
    });
    getHUDRootCMP().add(monitor.cmp);
    expect(monitor.cmp.elem.querySelector('.aekMonitor__value')!.textContent).toBe('0°, 90°, 0°');
    monitor.cmp.remove();
  });
});
