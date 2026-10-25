import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createMenu, type MenuItem, type MenuProps } from './Menu';

let trigger: HTMLButtonElement;

const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));

const getMenuElem = () => getHUDRootCMP().elem.querySelector<HTMLElement>('.aekMenu');
const getItems = () => [...(getMenuElem()?.querySelectorAll<HTMLElement>('.aekMenu__item') ?? [])];
const getFocusedLabel = () =>
  (document.activeElement as HTMLElement).querySelector('.aekMenu__label')?.textContent;
const key = (name: string) => dispatchKey(document.activeElement as HTMLElement, 'keydown', name);

const addMenu = (items: MenuItem[] | (() => MenuItem[]), props: Partial<MenuProps> = {}) =>
  createMenu({ anchor: trigger, items, ...props });

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
  trigger = document.createElement('button');
  trigger.textContent = 'File';
  getHUDRootCMP().elem.appendChild(trigger);
});

afterEach(() => {
  trigger.remove();
  vi.useRealTimers();
});

describe('menu (p803 D10)', () => {
  it('names its trigger’s popup, and opens on a click with the focus on its first item', () => {
    const menu = addMenu([{ label: 'New' }, { label: 'Open' }]);
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.cmp.id);
    trigger.focus();
    click(trigger);
    expect(menu.isOpen()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const elem = getMenuElem();
    expect(elem?.getAttribute('role')).toBe('menu');
    expect(elem?.getAttribute('aria-label')).toBe('File');
    expect(getItems().map((item) => item.getAttribute('role'))).toEqual(['menuitem', 'menuitem']);
    expect(getFocusedLabel()).toBe('New');
    click(trigger);
    expect(menu.isOpen()).toBe(false);
    expect(getMenuElem()).toBeNull();
    menu.cmp.remove();
  });

  it('opens from the trigger’s arrows; the arrows, Home and End move in it, wrapping', () => {
    const menu = addMenu([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    trigger.focus();
    expect(dispatchKey(trigger, 'keydown', 'ArrowUp').defaultPrevented).toBe(true);
    expect(getFocusedLabel()).toBe('C');
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(getFocusedLabel()).toBe('A');
    key('ArrowUp');
    expect(getFocusedLabel()).toBe('C');
    key('Home');
    expect(getFocusedLabel()).toBe('A');
    key('End');
    expect(getFocusedLabel()).toBe('C');
    menu.close();
    dispatchKey(trigger, 'keydown', 'ArrowDown');
    expect(getFocusedLabel()).toBe('A');
    menu.cmp.remove();
  });

  it('Enter picks an action after closing, with the focus back on the trigger', () => {
    const states: boolean[] = [];
    const menu = addMenu([
      { label: 'Save', kbd: 'Ctrl+S', onSelect: () => states.push(menu.isOpen()) },
    ]);
    trigger.focus();
    menu.open();
    const item = getItems()[0];
    expect(item.getAttribute('aria-keyshortcuts')).toBe('Control+S');
    expect(item.querySelector('.aekMenu__kbd')?.getAttribute('aria-hidden')).toBe('true');
    key('Enter');
    expect(states).toEqual([false]);
    expect(document.activeElement).toBe(trigger);
    menu.cmp.remove();
  });

  it('Space flips an on / off item and keeps it open; Enter flips it and closes', () => {
    const onCheckedChange = vi.fn();
    const menu = addMenu([{ type: 'checkbox', label: 'Grid', checked: false, onCheckedChange }]);
    trigger.focus();
    menu.open();
    const item = getItems()[0];
    expect(item.getAttribute('role')).toBe('menuitemcheckbox');
    expect(item.getAttribute('aria-checked')).toBe('false');
    key(' ');
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(menu.isOpen()).toBe(true);
    key('Enter');
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    expect(menu.isOpen()).toBe(false);
    menu.cmp.remove();
  });

  it('a choice: Space picks an option and keeps it open; the same option again reports nothing', () => {
    const onValueChange = vi.fn();
    const menu = addMenu([
      {
        type: 'radio',
        label: 'Sort by',
        value: 'name',
        options: [
          { value: 'name', label: 'Name' },
          { value: 'size', label: 'Size' },
        ],
        onValueChange,
      },
      { type: 'separator' },
      { type: 'group', label: 'View', items: [{ label: 'Zoom in' }] },
    ]);
    trigger.focus();
    menu.open();
    const groups = getMenuElem()?.querySelectorAll('[role="group"]') ?? [];
    expect([...groups].map((g) => g.getAttribute('aria-label'))).toEqual(['Sort by', 'View']);
    expect(groups[0]?.getAttribute('data-label')).toBe('Sort by');
    expect(getMenuElem()?.querySelector('[role="separator"]')).not.toBeNull();
    // The choice's check marks make a column the plain item lines its label up with
    expect(getMenuElem()?.hasAttribute('data-has-leading')).toBe(true);
    expect(getItems()[2].hasAttribute('data-leading')).toBe(false);
    expect(getItems()[0].hasAttribute('data-leading')).toBe(true);
    const [name, size] = getItems();
    expect(name.getAttribute('aria-checked')).toBe('true');
    key('ArrowDown');
    key(' ');
    expect(size.getAttribute('aria-checked')).toBe('true');
    expect(name.getAttribute('aria-checked')).toBe('false');
    expect(onValueChange).toHaveBeenCalledWith('size');
    key(' ');
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(menu.isOpen()).toBe(true);
    menu.cmp.remove();
  });

  it('a disabled item is focusable and picks nothing', () => {
    const onSelect = vi.fn();
    const menu = addMenu([{ label: 'Paste', disabled: true, onSelect }]);
    trigger.focus();
    menu.open();
    expect(getItems()[0].getAttribute('aria-disabled')).toBe('true');
    expect(getFocusedLabel()).toBe('Paste');
    key('Enter');
    click(getItems()[0]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu.isOpen()).toBe(true);
    menu.cmp.remove();
  });

  it('typeahead: a letter goes to the next item starting with it, letters typed quickly to one', () => {
    const menu = addMenu(['Save', 'Save as', 'Settings', 'Open'].map((label) => ({ label })));
    trigger.focus();
    menu.open();
    key('s');
    expect(getFocusedLabel()).toBe('Save as');
    key('s');
    expect(getFocusedLabel()).toBe('Settings');
    vi.advanceTimersByTime(500);
    key('o');
    expect(getFocusedLabel()).toBe('Open');
    vi.advanceTimersByTime(500);
    key('s');
    key('e');
    key('t');
    expect(getFocusedLabel()).toBe('Settings');
    menu.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Escape and Tab close it with the focus back on the trigger', () => {
    const onClose = vi.fn();
    const menu = addMenu([{ label: 'A' }], { onClose });
    trigger.focus();
    menu.open();
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    menu.open();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledTimes(2);
    menu.cmp.remove();
  });

  it('a press outside or the focus leaving closes it and leaves the focus where it went', () => {
    const outside = document.createElement('button');
    getHUDRootCMP().elem.appendChild(outside);
    const menu = addMenu([{ label: 'A' }]);
    menu.open();
    outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
    menu.open();
    outside.focus();
    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    menu.cmp.remove();
  });

  it('the pointer: hovering focuses an item, a click picks it', () => {
    const onSelect = vi.fn();
    const menu = addMenu([{ label: 'A' }, { label: 'B', onSelect }]);
    menu.open();
    const b = getItems()[1];
    b
      .querySelector('.aekMenu__label')
      ?.dispatchEvent(new window.Event('pointermove', { bubbles: true }));
    expect(document.activeElement).toBe(b);
    click(b);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu.isOpen()).toBe(false);
    menu.cmp.remove();
  });

  it('re-reads a getter on every open', () => {
    let checked = false;
    const menu = addMenu(() => [
      { type: 'checkbox', label: 'Grid', checked, onCheckedChange: (on) => (checked = on) },
    ]);
    menu.open();
    key('Enter');
    menu.open();
    expect(getItems()[0].getAttribute('aria-checked')).toBe('true');
    menu.cmp.remove();
  });

  it('leaves no listener, timer or ARIA after its removal, open', () => {
    const menu = addMenu([{ label: 'A' }]);
    menu.open();
    key('a');
    menu.cmp.remove();
    expect(getMenuElem()).toBeNull();
    expect(countListeners(trigger)).toBe(0);
    expect(countListeners(document, 'pointerdown')).toBe(0);
    expect(trigger.hasAttribute('aria-haspopup')).toBe(false);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
