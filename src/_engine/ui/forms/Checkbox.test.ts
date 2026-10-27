import { beforeAll, describe, expect, it } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import { createCheckbox, createSwitch, type CheckboxProps } from './Checkbox';
import type { FieldChange } from './Field';

beforeAll(async () => {
  await stubKitDomAsync();
});

type Change = { value: boolean; prev: boolean; last: boolean; source: string };

const makeCheckbox = (props: Partial<CheckboxProps> = {}, start = false) => {
  const target = { on: start };
  const calls: Change[] = [];
  const checkbox = createCheckbox({
    label: 'Shadows',
    target,
    key: 'on',
    onChange: (value: boolean, { prev, last, source }: FieldChange<boolean>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as CheckboxProps);
  document.body.append(checkbox.cmp.elem);
  const input = checkbox.cmp.elem.querySelector<HTMLInputElement>('input')!;
  return { checkbox, target, calls, input };
};

describe('the checkbox (p804 D7)', () => {
  it('is a native checkbox labelled by its label, checked as the bound value', () => {
    const { checkbox, input } = makeCheckbox({}, true);
    expect(input.getAttribute('type')).toBe('checkbox');
    expect(input.className).toBe('aekCheckbox');
    expect(input.hasAttribute('role')).toBe(false);
    expect(input.checked).toBe(true);
    const label = checkbox.cmp.elem.querySelector('label')!;
    expect(label.getAttribute('for')).toBe(input.id);
    expect(checkbox.cmp.elem.getAttribute('data-kind')).toBe('checkbox');
    checkbox.cmp.remove();
  });

  it('a click writes once with last: true; the field’s event names the checkbox', () => {
    let field: unknown = null;
    const { checkbox, target, calls, input } = makeCheckbox({
      onChange: (_value, change) => (field = change.field),
    });
    input.click();
    expect(target.on).toBe(true);
    expect(field).toBe(checkbox);
    checkbox.cmp.remove();
    const other = makeCheckbox();
    other.input.click();
    other.input.click();
    expect(other.calls).toEqual([
      { value: true, prev: false, last: true, source: 'user' },
      { value: false, prev: true, last: true, source: 'user' },
    ]);
    expect(calls).toEqual([]);
    other.checkbox.cmp.remove();
  });

  it('shows mixed until a click clears it', () => {
    const { checkbox, input } = makeCheckbox({ indeterminate: true });
    expect(input.indeterminate).toBe(true);
    expect(checkbox.isIndeterminate()).toBe(true);
    input.click();
    expect(checkbox.isIndeterminate()).toBe(false);
    checkbox.setIndeterminate(true);
    expect(input.indeterminate).toBe(true);
    checkbox.cmp.remove();
  });

  it('disabled: the input is, and a click does nothing', () => {
    const { checkbox, target, input } = makeCheckbox({ disabled: true });
    expect(input.hasAttribute('disabled')).toBe(true);
    input.click();
    expect(target.on).toBe(false);
    checkbox.setDisabled(false);
    input.click();
    expect(target.on).toBe(true);
    checkbox.cmp.remove();
  });

  it('a refresh checks it from the bound value, flashing, and fires nothing', () => {
    const scheduler = createBindingScheduler();
    const { checkbox, target, calls, input } = makeCheckbox({ scheduler });
    target.on = true;
    scheduler.refresh();
    expect(input.checked).toBe(true);
    expect(input.hasAttribute('data-flash')).toBe(true);
    expect(calls).toEqual([]);
    checkbox.cmp.remove();
    scheduler.dispose();
  });

  it('leaves no listener', () => {
    const { checkbox, input } = makeCheckbox();
    checkbox.cmp.remove();
    expect(countListeners(input)).toBe(0);
  });
});

describe('the switch (p804 D7)', () => {
  it('is a checkbox with role switch, after its label', () => {
    const target = { vsync: true };
    const toggle = createSwitch({ label: 'V-sync', target, key: 'vsync' });
    document.body.append(toggle.cmp.elem);
    const input = toggle.cmp.elem.querySelector<HTMLInputElement>('input')!;
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.className).toBe('aekSwitch');
    expect(input.checked).toBe(true);
    expect(toggle.cmp.elem.getAttribute('data-kind')).toBe('switch');
    input.click();
    expect(target.vsync).toBe(false);
    toggle.cmp.remove();
  });

  it('shows its on / off text, hidden from assistive tech', () => {
    const toggle = createSwitch({ label: 'Music', value: false, onText: 'On', offText: 'Off' });
    document.body.append(toggle.cmp.elem);
    const input = toggle.cmp.elem.querySelector<HTMLInputElement>('input')!;
    const text = toggle.cmp.elem.querySelector<HTMLElement>('.aekSwitch__text')!;
    expect(text.textContent).toBe('Off');
    expect(text.getAttribute('aria-hidden')).toBe('true');
    input.click();
    expect(text.textContent).toBe('On');
    expect(toggle.getValue()).toBe(true);
    // The label is still for the input inside the row
    expect(toggle.cmp.elem.querySelector('label')!.getAttribute('for')).toBe(input.id);
    toggle.cmp.remove();
  });
});
