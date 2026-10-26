import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { FieldChange } from './Field';
import { createSelectField, type SelectFieldProps, type SelectValue } from './SelectField';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: SelectValue; prev: SelectValue; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** A select field bound to `target.size`, in the HUD root, with its onChange calls */
const makeSelect = <T extends SelectValue>(props: Partial<SelectFieldProps<T>>, start: T) => {
  const target = { size: start };
  const calls: Change[] = [];
  const field = createSelectField<T>({
    label: 'Shadow map',
    target,
    key: 'size',
    options: { '512': 512, '1024': 1024, '2048': 2048 },
    onChange: (value: T, { prev, last, source }: FieldChange<T>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as SelectFieldProps<T>);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const trigger = root.querySelector<HTMLButtonElement>('.aekDropDownTrigger')!;
  const shown = () => root.querySelector('.aekDropDownLabel')!.textContent;
  // An open list: without the Popover API (linkedom) showAnchored moves it to the HUD root
  const list = () => document.querySelector<HTMLElement>('#hudRoot .aekDropDownList');
  const items = () => [...(list()?.querySelectorAll<HTMLElement>('li') ?? [])];
  return { field, target, calls, root, trigger, shown, list, items };
};

describe('the select field (p804 D7)', () => {
  it('the drop-down on the binding: the value’s text, a trigger named by label and value', () => {
    const { root, trigger, shown } = makeSelect<number>({ id: 'shadowMap' }, 1024);
    const label = root.querySelector('.aekField__label')!;
    const value = root.querySelector('.aekDropDownLabel')!;
    expect(root.getAttribute('data-kind')).toBe('select');
    expect(label.tagName).toBe('SPAN');
    expect(shown()).toBe('1024');
    expect(trigger.id).toBe('shadowMap');
    expect(trigger.getAttribute('aria-labelledby')).toBe(`${label.id} ${value.id}`);
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    // The label names it, not a native tooltip
    expect(trigger.hasAttribute('title')).toBe(false);
  });

  it('a pick writes the option’s own value once, with last: true', () => {
    const { trigger, target, calls, list, items, shown } = makeSelect<number>({}, 1024);
    dispatchPointer(trigger, 'click');
    expect(list()!.getAttribute('aria-label')).toBe('Shadow map');
    expect(items().map((item) => item.textContent)).toEqual(['512', '1024', '2048']);
    dispatchKey(list()!, 'keydown', 'ArrowDown');
    dispatchKey(list()!, 'keydown', 'Enter');
    expect(target.size).toBe(2048);
    expect(shown()).toBe('2048');
    expect(calls).toEqual([{ value: 2048, prev: 1024, last: true, source: 'user' }]);
  });

  it('takes Tweakpane’s array form and the kit’s, booleans too', () => {
    const { target, trigger, items, shown } = makeSelect<string | boolean>(
      {
        options: [
          { text: 'Off', value: false },
          { label: 'On', value: true },
          { text: 'Auto', value: 'auto' },
        ],
      },
      true
    );
    expect(shown()).toBe('On');
    dispatchPointer(trigger, 'click');
    dispatchPointer(items()[0], 'click');
    expect(target.size).toBe(false);
    expect(shown()).toBe('Off');
  });

  it('a value no option has shows the placeholder', () => {
    const { field, trigger, shown } = makeSelect<number>({ placeholder: 'Pick a size' }, 300);
    expect(shown()).toBe('Pick a size');
    expect(trigger.hasAttribute('data-placeholder')).toBe(true);
    field.setValue(512);
    expect(shown()).toBe('512');
    expect(trigger.hasAttribute('data-placeholder')).toBe(false);
  });

  it('a getter’s options are read again on open and on refresh', () => {
    const sizes: Record<string, number> = { '512': 512 };
    const { field, target, trigger, items, shown } = makeSelect<number>(
      { options: () => sizes },
      4096
    );
    expect(shown()).toBe('');
    sizes['4096'] = 4096;
    field.refresh();
    expect(shown()).toBe('4096');
    dispatchPointer(trigger, 'click');
    expect(items().map((item) => item.textContent)).toEqual(['512', '4096']);
    dispatchPointer(items()[0], 'click');
    expect(target.size).toBe(512);
  });

  it('a change from outside shows and flashes, without onChange', () => {
    const scheduler = createBindingScheduler();
    const { target, trigger, shown, calls } = makeSelect<number>({ scheduler }, 1024);
    target.size = 512;
    scheduler.refresh();
    expect(shown()).toBe('512');
    expect(trigger.hasAttribute('data-flash')).toBe(true);
    expect(calls).toEqual([]);
    scheduler.dispose();
  });

  it('disabling closes the list and disables the trigger; a click on the label focuses it', () => {
    const { field, root, trigger, list } = makeSelect<number>({}, 1024);
    dispatchPointer(trigger, 'click');
    expect(list()).not.toBe(null);
    field.setDisabled(true);
    expect(list()).toBe(null);
    expect(trigger.hasAttribute('disabled')).toBe(true);
    field.setDisabled(false);
    expect(trigger.hasAttribute('disabled')).toBe(false);
    root.querySelector('.aekField__label')!.dispatchEvent(new window.Event('click'));
    expect(document.activeElement).toBe(trigger);
  });

  it('an error marks the trigger; removed with its list open, nothing is left', () => {
    const { field, trigger, list } = makeSelect<number>({}, 1024);
    field.setError('Too large');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    dispatchPointer(trigger, 'click');
    const open = list()!;
    field.cmp.remove();
    expect(open.isConnected).toBe(false);
    expect(countListeners(trigger)).toBe(0);
  });
});
