import { beforeAll, describe, expect, it } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { getPrimitiveValueKind } from './binding/Binding';
import { createBindingScheduler } from './binding/BindingScheduler';
import { createField, type FieldChange, type FieldProps } from './Field';

beforeAll(async () => {
  await stubKitDomAsync();
});

/** A field on a plain input that shows the value as its text, with what the shell asked of it */
const makeField = (props: Partial<FieldProps<string>> = {}, isGroup = false) => {
  const control = document.createElement(isGroup ? 'div' : 'input');
  const log = { draws: [] as string[], disabled: [] as boolean[], removed: 0 };
  const target = { value: 'a' };
  const shell = createField<string>(
    { label: 'Name', target, key: 'value', ...props } as FieldProps<string>,
    {
      kind: 'test',
      valueKind: getPrimitiveValueKind<string>(),
      control,
      isGroup,
      draw: (value) => log.draws.push(value),
      applyDisabled: (on) => log.disabled.push(on),
      onRemove: () => log.removed++,
    }
  );
  document.body.append(shell.cmp.elem);
  const part = (name: string) => shell.cmp.elem.querySelector<HTMLElement>(`.aekField__${name}`)!;
  return { shell, control, log, target, part, field: shell.field };
};

describe('the field shell (p804 D5)', () => {
  it('labels its control with a <label for>, its id the `id` prop’s', () => {
    const { shell, control, part } = makeField({ id: 'speedInput' });
    const label = part('label');
    expect(label.tagName).toBe('LABEL');
    expect(control.id).toBe('speedInput');
    expect(label.getAttribute('for')).toBe('speedInput');
    expect(label.textContent).toBe('Name');
    expect(shell.cmp.elem.getAttribute('data-kind')).toBe('test');
    shell.cmp.remove();
  });

  it('names a group by its label, and keeps a hidden label as the name only', () => {
    const { shell, control, part } = makeField({ labelHidden: true }, true);
    const label = part('label');
    expect(label.tagName).toBe('SPAN');
    expect(control.getAttribute('role')).toBe('group');
    expect(control.getAttribute('aria-labelledby')).toBe(label.id);
    expect(label.classList.contains('aekVisuallyHidden')).toBe(true);
    shell.cmp.remove();
  });

  it('shows the reset button only while the value isn’t the default, and resets as the user', () => {
    const calls: FieldChange<string>[] = [];
    const { shell, part, field, target, control } = makeField({
      default: 'a',
      onChange: (_, change) => calls.push(change),
    });
    const reset = part('reset');
    expect(reset.getAttribute('aria-label')).toBe('Reset Name');
    expect(reset.hasAttribute('hidden')).toBe(true);
    shell.binding.change('b');
    expect(reset.hasAttribute('hidden')).toBe(false);
    reset.focus();
    reset.click();
    expect(target.value).toBe('a');
    expect(reset.hasAttribute('hidden')).toBe(true);
    // Hidden with the focus on it: the focus goes to the control
    expect(document.activeElement).toBe(control);
    expect(calls.map(({ prev, last, source }) => ({ prev, last, source }))).toEqual([
      { prev: 'a', last: true, source: 'user' },
      { prev: 'b', last: true, source: 'user' },
    ]);
    expect(calls[1].field).toBe(field);
    shell.cmp.remove();
  });

  it('takes the value at creation as the default', () => {
    const { shell, field, target } = makeField();
    field.setValue('z');
    field.reset();
    expect(target.value).toBe('a');
    shell.cmp.remove();
  });

  it('shows the hint, or an error with aria-invalid, as the control’s description', () => {
    const { shell, control, part, field } = makeField({ hint: 'Your name' });
    const message = part('message');
    expect(message.textContent).toBe('Your name');
    expect(message.getAttribute('data-type')).toBe('hint');
    expect(control.getAttribute('aria-describedby')).toBe(message.id);
    expect(control.hasAttribute('aria-invalid')).toBe(false);
    field.setError('Too short');
    expect(message.textContent).toBe('Too short');
    expect(message.getAttribute('data-type')).toBe('error');
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(shell.cmp.elem.hasAttribute('data-invalid')).toBe(true);
    // The field's own error (a typed expression's) comes first
    shell.setOwnError('Unexpected “x”');
    expect(message.textContent).toBe('Unexpected “x”');
    shell.setOwnError(null);
    field.setError(null);
    expect(message.textContent).toBe('Your name');
    expect(control.hasAttribute('aria-invalid')).toBe(false);
    shell.cmp.remove();
  });

  it('hides its message line and the description without a hint or an error', () => {
    const { shell, control, part } = makeField();
    expect(part('message').hasAttribute('hidden')).toBe(true);
    expect(control.hasAttribute('aria-describedby')).toBe(false);
    shell.cmp.remove();
  });

  it('re-reads hidden and disabled functions on refresh; the setters replace them', () => {
    let isHidden = false;
    let isDisabled = true;
    const { shell, log, part, field } = makeField({
      hidden: () => isHidden,
      disabled: () => isDisabled,
    });
    const root = shell.cmp.elem;
    expect(root.hasAttribute('data-disabled')).toBe(true);
    expect(log.disabled).toEqual([true]);
    expect(part('reset').hasAttribute('disabled')).toBe(true);
    isDisabled = false;
    isHidden = true;
    field.refresh();
    expect(log.disabled).toEqual([true, false]);
    expect(root.hasAttribute('hidden')).toBe(true);
    field.setHidden(false);
    isHidden = true;
    field.refresh();
    expect(root.hasAttribute('hidden')).toBe(false);
    shell.cmp.remove();
  });

  it('doesn’t read a hidden field, and reads it once when it shows', () => {
    const { shell, log, field, target } = makeField({ hidden: true });
    const drawsAtStart = log.draws.length;
    target.value = 'b';
    field.refresh();
    expect(log.draws).toHaveLength(drawsAtStart);
    field.setHidden(false);
    expect(log.draws.at(-1)).toBe('b');
    expect(shell.cmp.elem.querySelector('[data-flash]')).toBeNull();
    shell.cmp.remove();
  });

  it('draws a silent setValue, which fires nothing', () => {
    const calls: string[] = [];
    const { shell, log, field } = makeField({ onChange: (value) => calls.push(value) });
    field.setValue('q', { silent: true });
    expect(log.draws.at(-1)).toBe('q');
    expect(calls).toEqual([]);
    field.setValue('r');
    expect(calls).toEqual(['r']);
    shell.cmp.remove();
  });
});

describe('the field and its scheduler (p804 D4)', () => {
  it('draws and flashes a value changed from outside on refresh, and nothing when unchanged', () => {
    const scheduler = createBindingScheduler();
    const { shell, log, control, target } = makeField({ scheduler });
    const drawsAtStart = log.draws.length;
    scheduler.refresh();
    expect(log.draws).toHaveLength(drawsAtStart);
    expect(control.hasAttribute('data-flash')).toBe(false);
    target.value = 'b';
    scheduler.refresh();
    expect(log.draws.at(-1)).toBe('b');
    expect(control.hasAttribute('data-flash')).toBe(true);
    shell.cmp.remove();
    scheduler.dispose();
  });

  it('leaves its scheduler when removed, with no listener left', () => {
    const scheduler = createBindingScheduler();
    const { shell, log, part, target } = makeField({ scheduler });
    const label = part('label');
    shell.cmp.remove();
    expect(log.removed).toBe(1);
    const draws = log.draws.length;
    target.value = 'b';
    scheduler.refresh();
    expect(log.draws).toHaveLength(draws);
    expect(countListeners(label)).toBe(0);
    scheduler.dispose();
  });
});
