import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import type { FieldChange } from './Field';
import { createNumberField, type NumberFieldProps } from './NumberField';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: number; prev: number; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** A number field bound to `target.value`, in the HUD root, with its onChange calls */
const makeNumber = (props: Partial<NumberFieldProps> = {}, start = 1) => {
  const target = { value: start };
  const calls: Change[] = [];
  const field = createNumberField({
    label: 'Speed',
    target,
    key: 'value',
    onChange: (value: number, { prev, last, source }: FieldChange<number>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as NumberFieldProps);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const input = root.querySelector<HTMLInputElement>('.aekNumberField__input')!;
  const label = root.querySelector<HTMLElement>('.aekField__label')!;
  const message = root.querySelector<HTMLElement>('.aekField__message')!;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const press = (key: string, init = {}) => {
    const down = dispatchKey(input, 'keydown', key, init);
    dispatchKey(input, 'keyup', key, init);
    return down;
  };
  return { field, target, calls, root, input, label, message, type, press };
};

const user = (value: number, prev: number, last: boolean) => ({
  value,
  prev,
  last,
  source: 'user',
});

describe('the number field’s spin button (p804 D7)', () => {
  it('is a text input with role spinbutton and its values', () => {
    const { input, label } = makeNumber({ min: 0, max: 10, step: 0.5, unit: 'ms' }, 2);
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('role')).toBe('spinbutton');
    expect(input.getAttribute('aria-valuenow')).toBe('2');
    expect(input.getAttribute('aria-valuemin')).toBe('0');
    expect(input.getAttribute('aria-valuemax')).toBe('10');
    expect(input.getAttribute('aria-valuetext')).toBe('2.0 ms');
    expect(input.value).toBe('2.0');
    expect(label.getAttribute('for')).toBe(input.id);
  });

  it('shows format’s text, and says it', () => {
    const { input } = makeNumber({ format: (v) => `${Math.round(v * 100)} %` }, 0.25);
    expect(input.value).toBe('25 %');
    expect(input.getAttribute('aria-valuetext')).toBe('25 %');
  });
});

describe('the number field’s keys (p804 D6)', () => {
  it('ArrowUp steps with last: false, its keyup with last: true; 1 + 0.1 is 1.1', () => {
    const { input, target, calls } = makeNumber({ step: 0.1 });
    const down = dispatchKey(input, 'keydown', 'ArrowUp');
    expect(down.defaultPrevented).toBe(true);
    expect(target.value).toBe(1.1);
    expect(input.value).toBe('1.1');
    expect(input.getAttribute('aria-valuenow')).toBe('1.1');
    dispatchKey(input, 'keyup', 'ArrowUp');
    expect(calls).toEqual([user(1.1, 1, false), user(1.1, 1, true)]);
  });

  it('a held key writes each repeat, and commits once on its keyup', () => {
    const { input, calls } = makeNumber({ step: 1 });
    dispatchKey(input, 'keydown', 'ArrowDown');
    dispatchKey(input, 'keydown', 'ArrowDown', { repeat: true });
    dispatchKey(input, 'keydown', 'ArrowDown', { repeat: true });
    dispatchKey(input, 'keyup', 'ArrowDown');
    expect(calls).toEqual([
      user(0, 1, false),
      user(-1, 0, false),
      user(-2, -1, false),
      user(-2, 1, true),
    ]);
  });

  it('Shift is ×10, Alt ×0.1 (off the grid), PageUp / PageDown ×10', () => {
    const { target, press } = makeNumber({ step: 0.1 });
    press('ArrowUp', { shiftKey: true });
    expect(target.value).toBe(2);
    press('ArrowUp', { altKey: true });
    expect(target.value).toBe(2.01);
    press('PageUp');
    expect(target.value).toBe(3);
    press('PageDown', { shiftKey: true });
    expect(target.value).toBe(-7);
  });

  it('steps by 1 without a step, and stays in the range', () => {
    const { target, press } = makeNumber({ min: 0, max: 2 });
    press('ArrowUp');
    press('ArrowUp');
    expect(target.value).toBe(2);
    press('ArrowDown', { shiftKey: true });
    expect(target.value).toBe(0);
  });

  it('Home and End go to min and max when set; else they’re the caret’s', () => {
    const { target, press } = makeNumber({ min: -5, max: 5, step: 1 });
    expect(press('End').defaultPrevented).toBe(true);
    expect(target.value).toBe(5);
    press('Home');
    expect(target.value).toBe(-5);
    const open = makeNumber({ step: 1 });
    expect(open.press('Home').defaultPrevented).toBe(false);
    expect(open.target.value).toBe(1);
  });

  it('wraps at the range with wrap', () => {
    const { target, press } = makeNumber({ min: -180, max: 180, step: 10, wrap: true }, 170);
    press('ArrowUp');
    expect(target.value).toBe(-180);
  });

  it('keeps the keys it uses from going further, their keyups too', () => {
    const { input, press } = makeNumber({ step: 1 });
    const outside: string[] = [];
    const onKey = (e: Event) => outside.push(`${e.type} ${(e as KeyboardEvent).key}`);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    press('ArrowUp');
    press('a');
    dispatchKey(input, 'keydown', 'ArrowUp', { ctrlKey: true });
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKey);
    expect(outside).toEqual(['keydown a', 'keyup a', 'keydown ArrowUp']);
  });
});

describe('typed text (p804 D6)', () => {
  it('writes an expression on Enter, once with last: true', () => {
    const typed: string[] = [];
    const { input, target, calls, type, press } = makeNumber({
      step: 0.01,
      onInput: (text) => typed.push(text),
    });
    type('1/');
    type('1/4');
    expect(target.value).toBe(1);
    expect(typed).toEqual(['1/', '1/4']);
    press('Enter');
    expect(target.value).toBe(0.25);
    expect(input.value).toBe('0.25');
    expect(calls).toEqual([user(0.25, 1, true)]);
  });

  it('shows an invalid expression’s error and keeps the value and the text', () => {
    const { input, target, calls, message, type, press } = makeNumber();
    type('2 +');
    press('Enter');
    expect(target.value).toBe(1);
    expect(calls).toEqual([]);
    expect(input.value).toBe('2 +');
    expect(message.textContent).toBe('Incomplete expression');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    type('2 + 1');
    press('Enter');
    expect(target.value).toBe(3);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('uses the field’s expression units', () => {
    const { target, type, press } = makeNumber({ expressionUnits: { '%': 0.01 } });
    type('50%');
    press('Enter');
    expect(target.value).toBe(0.5);
  });

  it('writes on a blur; an invalid text is put back then', () => {
    const { input, target, type } = makeNumber();
    input.focus();
    type('4');
    input.blur();
    expect(target.value).toBe(4);
    input.focus();
    type('nope');
    input.blur();
    expect(target.value).toBe(4);
    expect(input.value).toBe('4.00');
  });

  it('Escape puts the text back through the overlay stack, so it goes no further', () => {
    const { input, target, type } = makeNumber();
    const outside: string[] = [];
    const onKey = (e: Event) => outside.push((e as KeyboardEvent).key);
    document.addEventListener('keydown', onKey);
    input.focus();
    type('9');
    const escape = dispatchKey(input, 'keydown', 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(input.value).toBe('1.00');
    expect(target.value).toBe(1);
    // Nothing typed: Escape is the page's (a dialog closes)
    expect(dispatchKey(input, 'keydown', 'Escape').defaultPrevented).toBe(false);
    document.removeEventListener('keydown', onKey);
    expect(outside).toEqual(['Escape']);
  });

  it('Escape puts the text back outside a HUD root too', () => {
    const field = createNumberField({ label: 'Outside', value: 3 });
    document.body.append(field.cmp.elem);
    const input = field.cmp.elem.querySelector<HTMLInputElement>('input')!;
    input.value = '7';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(dispatchKey(input, 'keydown', 'Escape').defaultPrevented).toBe(true);
    expect(input.value).toBe('3.00');
    field.cmp.remove();
  });

  it('with live, writes each valid keystroke; Enter commits, Escape undoes them', () => {
    const { target, calls, type, press } = makeNumber({ live: true, step: 1 });
    type('5');
    type('5*');
    type('5*2');
    expect(target.value).toBe(10);
    press('Enter');
    expect(calls).toEqual([user(5, 1, false), user(10, 5, false), user(10, 1, true)]);
    calls.length = 0;
    type('7');
    press('Escape');
    expect(target.value).toBe(10);
    expect(calls).toEqual([user(7, 10, false), user(10, 7, false), user(10, 10, true)]);
  });

  it('a refresh doesn’t write over typed text', () => {
    const { field, input, target, type } = makeNumber();
    type('8');
    target.value = 2;
    field.refresh();
    expect(input.value).toBe('8');
    expect(input.getAttribute('aria-valuenow')).toBe('2');
  });

  it('steps from a typed number with the arrows', () => {
    const { target, type, press } = makeNumber({ step: 1 });
    type('10');
    press('ArrowUp');
    expect(target.value).toBe(11);
  });
});

describe('copy and paste (p804 D6)', () => {
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

  it('copies the value with no text selected; a selection copies as usual', () => {
    const { input } = makeNumber({ step: 0.01 }, 1.5);
    input.setSelectionRange(2, 2);
    const copy = clipboardEvent('copy');
    input.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(copy.data.get('text/plain')).toBe('1.5');
    input.select();
    const selected = clipboardEvent('copy');
    input.dispatchEvent(selected);
    expect(selected.defaultPrevented).toBe(false);
  });

  it('a pasted number is the value, with one last: true; other text pastes', () => {
    const { input, target, calls } = makeNumber({ step: 0.1 });
    const paste = clipboardEvent('paste', ' 2.5 ');
    input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(target.value).toBe(2.5);
    expect(calls).toEqual([user(2.5, 1, true)]);
    const text = clipboardEvent('paste', 'x2');
    input.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
  });
});

describe('the label’s scrub (p804 D6)', () => {
  it('drags past 3 px change the value per pixel, last: true on the release', () => {
    const { label, root, target, calls } = makeNumber({ step: 1 }, 10);
    dispatchPointer(label, 'pointerdown', { clientX: 100 });
    dispatchPointer(label, 'pointermove', { clientX: 102 });
    expect(calls).toEqual([]);
    expect(root.hasAttribute('data-scrubbing')).toBe(false);
    // Step 1: 0.1 per pixel, on the grid of 1
    dispatchPointer(label, 'pointermove', { clientX: 120 });
    expect(root.hasAttribute('data-scrubbing')).toBe(true);
    expect(target.value).toBe(12);
    dispatchPointer(label, 'pointermove', { clientX: 130, shiftKey: true });
    expect(target.value).toBe(22);
    dispatchPointer(label, 'pointerup', { clientX: 130 });
    expect(root.hasAttribute('data-scrubbing')).toBe(false);
    expect(calls).toEqual([user(12, 10, false), user(22, 12, false), user(22, 10, true)]);
    // Its click doesn't focus the input; the next plain click does
    const click = dispatchPointer(label, 'click');
    expect(click.defaultPrevented).toBe(true);
    expect(dispatchPointer(label, 'click').defaultPrevented).toBe(false);
  });

  it('a press without a drag writes nothing', () => {
    const { label, calls } = makeNumber({ step: 1 });
    dispatchPointer(label, 'pointerdown', { clientX: 10 });
    dispatchPointer(label, 'pointerup', { clientX: 11 });
    expect(calls).toEqual([]);
    expect(dispatchPointer(label, 'click').defaultPrevented).toBe(false);
  });

  it('ends on a lost capture, and doesn’t start disabled', () => {
    const { field, label, target, calls } = makeNumber({ step: 1 }, 0);
    dispatchPointer(label, 'pointerdown', { clientX: 0 });
    dispatchPointer(label, 'pointermove', { clientX: 50 });
    label.releasePointerCapture(1);
    expect(calls.at(-1)).toEqual(user(5, 0, true));
    field.setDisabled(true);
    dispatchPointer(label, 'pointerdown', { clientX: 0 });
    dispatchPointer(label, 'pointermove', { clientX: 50 });
    expect(target.value).toBe(5);
  });
});

describe('the number field disabled and removed', () => {
  it('disabled: the input is, and the keys do nothing', () => {
    const { field, input, target, press } = makeNumber({ step: 1, disabled: true });
    expect(input.hasAttribute('disabled')).toBe(true);
    press('ArrowUp');
    expect(target.value).toBe(1);
    field.setDisabled(false);
    press('ArrowUp');
    expect(target.value).toBe(2);
  });

  it('disabling mid-gesture commits it', () => {
    const { field, input, calls } = makeNumber({ step: 1 });
    dispatchKey(input, 'keydown', 'ArrowUp');
    field.setDisabled(true);
    expect(calls).toEqual([user(2, 1, false), user(2, 1, true)]);
  });

  it('leaves no listener, its typing entry included', () => {
    const { field, input, label, type } = makeNumber();
    type('3');
    field.cmp.remove();
    expect(countListeners(input)).toBe(0);
    expect(countListeners(label)).toBe(0);
    // The typing entry went with it: Escape in the HUD is nobody's
    const escape = dispatchKey(getHUDRootCMP().elem, 'keydown', 'Escape');
    expect(escape.defaultPrevented).toBe(false);
  });
});
