import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createDropDown } from './DropDown';

beforeAll(() => stubKitDomAsync());

const OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const key = (elem: Element, type: 'keydown' | 'keyup', name: string) =>
  dispatchKey(elem, type, name);

const create = (onChange = vi.fn()) => {
  let value = 'mid';
  const dropDown = createDropDown({
    options: OPTIONS,
    value: () => value,
    onChange: (v) => {
      value = v;
      onChange(v);
    },
  });
  document.body.appendChild(dropDown.cmp.elem);
  return { dropDown, onChange };
};

const listOf = (dropDown: ReturnType<typeof createDropDown>) =>
  dropDown.cmp.elem.querySelector('ul')!;
const triggerOf = (dropDown: ReturnType<typeof createDropDown>) =>
  dropDown.cmp.elem.querySelector('button')!;

describe('drop-down', () => {
  it("shows the value's label, and opens the list on it", () => {
    const { dropDown } = create();
    expect(dropDown.cmp.elem.querySelector('.aekDropDownLabel')?.textContent).toBe('Medium');
    dropDown.open();
    expect(dropDown.isOpen()).toBe(true);
    const items = listOf(dropDown).querySelectorAll('li');
    expect(items[1].classList.contains('isCurrent')).toBe(true);
    expect(items[1].classList.contains('isHighlighted')).toBe(true);
    dropDown.close();
  });

  it('moves with the arrow keys and picks with Enter; the keys go no further', () => {
    const { dropDown, onChange } = create();
    dropDown.open();
    const list = listOf(dropDown);
    const arrow = key(list, 'keydown', 'ArrowDown');
    expect(arrow.defaultPrevented).toBe(true);
    key(list, 'keydown', 'Enter');
    expect(onChange).toHaveBeenCalledWith('high');
    expect(dropDown.isOpen()).toBe(false);
    // The pick refreshes the label itself
    expect(dropDown.cmp.elem.querySelector('.aekDropDownLabel')?.textContent).toBe('High');
  });

  it('setDisabled closes the list and ignores clicks; focusable, aria-disabled with its reason (p806 D7)', () => {
    const dropDown = createDropDown({
      options: OPTIONS,
      value: 'mid',
      onChange: vi.fn(),
      title: 'Quality',
      focusableWhenDisabled: true,
    });
    document.body.appendChild(dropDown.cmp.elem);
    const trigger = triggerOf(dropDown);
    dropDown.open();
    dropDown.setDisabled(true, 'Loading the scene…');
    expect(dropDown.isOpen()).toBe(false);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.hasAttribute('disabled')).toBe(false);
    expect(trigger.getAttribute('title')).toBe('Loading the scene…');
    trigger.dispatchEvent(new window.Event('click'));
    expect(dropDown.isOpen()).toBe(false);
    dropDown.open();
    expect(dropDown.isOpen()).toBe(false);
    dropDown.setDisabled(false);
    expect(trigger.hasAttribute('aria-disabled')).toBe(false);
    expect(trigger.getAttribute('title')).toBe('Quality');
    trigger.dispatchEvent(new window.Event('click'));
    expect(dropDown.isOpen()).toBe(true);
    dropDown.close();

    // Without the option: the native disabled
    const native = createDropDown({ options: OPTIONS, onChange: vi.fn() });
    native.setDisabled(true);
    expect(triggerOf(native).hasAttribute('disabled')).toBe(true);
    expect(triggerOf(native).hasAttribute('title')).toBe(false);
    native.setDisabled(false);
    expect(triggerOf(native).hasAttribute('disabled')).toBe(false);
  });

  it('refresh() shows a change made elsewhere', () => {
    let value = 'mid';
    const dropDown = createDropDown({ options: OPTIONS, value: () => value, onChange: () => {} });
    value = 'low';
    expect(dropDown.cmp.elem.querySelector('.aekDropDownLabel')?.textContent).toBe('Medium');
    dropDown.refresh();
    expect(dropDown.cmp.elem.querySelector('.aekDropDownLabel')?.textContent).toBe('Low');
  });

  it('closes on Escape without a change', () => {
    const { dropDown, onChange } = create();
    dropDown.open();
    key(listOf(dropDown), 'keydown', 'Escape');
    expect(dropDown.isOpen()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives the focus back to the trigger it opened from, after a pick or Escape', () => {
    const { dropDown } = create();
    const trigger = triggerOf(dropDown);
    trigger.focus();
    dropDown.open();
    expect(document.activeElement).toBe(listOf(dropDown));
    key(listOf(dropDown), 'keydown', 'Enter');
    expect(document.activeElement).toBe(trigger);
    dropDown.open();
    key(listOf(dropDown), 'keydown', 'Escape');
    expect(dropDown.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves the focus where it went when the list loses it', () => {
    const { dropDown } = create();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    triggerOf(dropDown).focus();
    dropDown.open();
    elsewhere.focus();
    expect(dropDown.isOpen()).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('searchable: the field filters the options, marks the matches and picks with Enter', () => {
    const onChange = vi.fn();
    const dropDown = createDropDown({
      options: OPTIONS,
      value: 'mid',
      onChange,
      searchable: true,
      searchPlaceholder: 'Filter',
    });
    document.body.appendChild(dropDown.cmp.elem);
    const trigger = triggerOf(dropDown);
    trigger.focus();
    dropDown.open();
    const field = dropDown.cmp.elem.querySelector('input')!;
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('aria-label')).toBe('Filter');
    expect(field.getAttribute('aria-controls')).toBe(listOf(dropDown).id);
    expect(field.getAttribute('aria-activedescendant')).toBe(`${listOf(dropDown).id}-1`);

    const type = (text: string) => {
      field.value = text;
      field.dispatchEvent(new window.Event('input'));
    };
    type('i');
    const items = () => [...listOf(dropDown).querySelectorAll('li')];
    expect(items().map((item) => item.textContent)).toEqual(['Medium', 'High']);
    expect(items()[0].querySelector('mark')?.textContent).toBe('i');
    // The first match is highlighted; Home and Space are the field's (the caret, a typed space)
    expect(field.getAttribute('aria-activedescendant')).toBe(`${listOf(dropDown).id}-1`);
    expect(key(field, 'keydown', 'Home').defaultPrevented).toBe(false);
    expect(key(field, 'keydown', ' ').defaultPrevented).toBe(false);
    key(field, 'keydown', 'ArrowDown');
    expect(field.getAttribute('aria-activedescendant')).toBe(`${listOf(dropDown).id}-2`);

    type('zz');
    expect(items()).toHaveLength(0);
    expect(dropDown.cmp.elem.querySelector('.aekDropDownEmpty')?.textContent).toBe('No matches');
    expect(field.hasAttribute('aria-activedescendant')).toBe(false);
    key(field, 'keydown', 'Enter');
    expect(onChange).not.toHaveBeenCalled();
    expect(dropDown.isOpen()).toBe(true);

    type('HIG');
    key(field, 'keydown', 'Enter');
    expect(onChange).toHaveBeenCalledWith('high');
    expect(dropDown.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
