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
});
