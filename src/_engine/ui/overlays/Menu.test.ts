import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createKbd } from '../components/Kbd';
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
      {
        label: 'Save',
        kbd: createKbd({ keys: 'Ctrl+S' }),
        onSelect: () => states.push(menu.isOpen()),
      },
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

  it('draws its items’ hints: a getter’s removed at each close, an array’s with the menu (p804 D13)', async () => {
    const kept = createKbd({ keys: 'Ctrl+S' });
    const removeKept = vi.spyOn(kept.cmp, 'remove');
    const menu = addMenu([
      { label: 'Save', kbd: kept },
      { type: 'group', label: 'Edit', items: [{ label: 'Undo', kbd: 'Ctrl+Z' }] },
    ]);
    menu.open();
    const [save, undo] = getItems();
    expect(save.getAttribute('aria-keyshortcuts')).toBe('Control+S');
    expect(kept.cmp.elem.parentElement).toBe(save);
    expect(kept.cmp.elem.getAttribute('aria-hidden')).toBe('true');
    kept.setKeys('Ctrl+Shift+S');
    expect(save.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+S');
    // The deprecated string: drawn once Kbd has loaded
    expect(undo.querySelector('.aekMenu__kbd')).toBeNull();
    await vi.dynamicImportSettled();
    expect(undo.getAttribute('aria-keyshortcuts')).toBe('Control+Z');
    expect(undo.querySelector('.aekMenu__kbd')?.getAttribute('aria-hidden')).toBe('true');
    menu.close();
    menu.open();
    expect(kept.cmp.elem.parentElement).toBe(getItems()[0]);
    expect(removeKept).not.toHaveBeenCalled();
    menu.cmp.remove();
    expect(removeKept).toHaveBeenCalledTimes(1);

    const removes: (() => void)[] = [];
    const fromGetter = addMenu(() => {
      const kbd = createKbd({ keys: 'F2' });
      removes.push(vi.spyOn(kbd.cmp, 'remove'));
      return [{ label: 'Rename', kbd }];
    });
    fromGetter.open();
    fromGetter.close();
    fromGetter.open();
    expect(removes).toHaveLength(2);
    expect(removes[0]).toHaveBeenCalledTimes(1);
    expect(removes[1]).not.toHaveBeenCalled();
    fromGetter.cmp.remove();
    expect(removes[1]).toHaveBeenCalledTimes(1);
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

describe('submenus (p805 D11)', () => {
  const getMenus = () => [...getHUDRootCMP().elem.querySelectorAll<HTMLElement>('.aekMenu')];
  const getItemsOf = (menu: HTMLElement | undefined) => [
    ...(menu?.querySelectorAll<HTMLElement>(
      ':scope > .aekMenu__item, :scope > [role="group"] > .aekMenu__item'
    ) ?? []),
  ];
  const move = (target: HTMLElement, clientX = 0, clientY = 0) =>
    dispatchPointer(target, 'pointermove', { clientX, clientY });
  const viewItems = (onSelect = vi.fn()): MenuItem[] => [
    {
      type: 'submenu',
      label: 'Zoom',
      items: [
        { label: 'In', onSelect },
        { label: 'Out', onSelect },
      ],
    },
    {
      type: 'submenu',
      label: 'Panels',
      items: [
        { type: 'checkbox', label: 'Outline', checked: false },
        { type: 'submenu', label: 'Layout', items: [{ label: 'Default' }, { label: 'Compact' }] },
      ],
    },
    { type: 'submenu', label: 'Locked', disabled: true, items: [{ label: 'Never' }] },
    { label: 'Full screen' },
  ];

  it('ArrowRight opens a submenu on its first item; ArrowLeft closes it back to its item', () => {
    const menu = addMenu(viewItems());
    trigger.focus();
    menu.open();
    const zoom = getItems()[0];
    expect(zoom.getAttribute('role')).toBe('menuitem');
    expect(zoom.getAttribute('aria-haspopup')).toBe('menu');
    expect(zoom.getAttribute('aria-expanded')).toBe('false');
    expect(zoom.querySelector('.aekMenu__submenuMark')?.getAttribute('aria-hidden')).toBe('true');
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    const [, sub] = getMenus();
    expect(sub.getAttribute('role')).toBe('menu');
    expect(sub.hasAttribute('data-submenu')).toBe(true);
    expect(sub.getAttribute('aria-label')).toBe('Zoom');
    expect(zoom.getAttribute('aria-expanded')).toBe('true');
    expect(zoom.getAttribute('aria-controls')).toBe(sub.id);
    expect(getFocusedLabel()).toBe('In');
    key('ArrowDown');
    expect(getFocusedLabel()).toBe('Out');
    expect(key('ArrowLeft').defaultPrevented).toBe(true);
    expect(getMenus()).toHaveLength(1);
    expect(document.activeElement).toBe(zoom);
    expect(zoom.getAttribute('aria-expanded')).toBe('false');
    expect(zoom.hasAttribute('aria-controls')).toBe(false);
    // ArrowRight on an item without a submenu, ArrowLeft in the root: not the menu's keys
    key('End');
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    expect(key('ArrowLeft').defaultPrevented).toBe(false);
    menu.cmp.remove();
  });

  it('Enter and Space open it too; Escape closes one level at a time, the last to the trigger', () => {
    const menu = addMenu(viewItems());
    trigger.focus();
    menu.open();
    key('ArrowDown');
    key('Enter');
    expect(getFocusedLabel()).toBe('Outline');
    key('End');
    key(' ');
    expect(getMenus()).toHaveLength(3);
    expect(getFocusedLabel()).toBe('Default');
    key('Escape');
    expect(getMenus()).toHaveLength(2);
    expect(getFocusedLabel()).toBe('Layout');
    key('Escape');
    expect(getFocusedLabel()).toBe('Panels');
    key('Escape');
    expect(menu.isOpen()).toBe(false);
    expect(getMenus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
    menu.cmp.remove();
  });

  it('a pick in a submenu closes every level first; Tab there closes them all', () => {
    const states: number[] = [];
    const onClose = vi.fn();
    const menu = addMenu(viewItems(vi.fn(() => states.push(getMenus().length))), { onClose });
    trigger.focus();
    menu.open();
    key('ArrowRight');
    key('Enter');
    expect(states).toEqual([0]);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledTimes(1);
    menu.open();
    key('ArrowRight');
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(getMenus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
    menu.cmp.remove();
  });

  it('a click opens a submenu on its first item; a disabled one opens nothing', () => {
    const menu = addMenu(viewItems());
    menu.open();
    const [, panels, locked] = getItems();
    click(panels);
    expect(getMenus()).toHaveLength(2);
    expect(getFocusedLabel()).toBe('Outline');
    locked.focus();
    key('ArrowRight');
    click(locked);
    expect(getMenus()).toHaveLength(1);
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    menu.cmp.remove();
  });

  it('the typeahead and the arrows stay in the level the focus is in', () => {
    const menu = addMenu(viewItems());
    trigger.focus();
    menu.open();
    key('ArrowDown');
    key('ArrowRight');
    key('l');
    expect(getFocusedLabel()).toBe('Layout');
    key('ArrowDown');
    expect(getFocusedLabel()).toBe('Outline');
    menu.cmp.remove();
  });

  it('a hover opens a submenu after the delay, the focus staying on its item', () => {
    const menu = addMenu(viewItems());
    menu.open();
    const [zoom, panels] = getItems();
    move(zoom, 50, 10);
    expect(document.activeElement).toBe(zoom);
    vi.advanceTimersByTime(149);
    expect(getMenus()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getMenus()).toHaveLength(2);
    expect(document.activeElement).toBe(zoom);
    // ArrowRight on its item enters the open submenu
    key('ArrowRight');
    expect(getFocusedLabel()).toBe('In');
    // Hovering another item, not toward the submenu: it closes, and that item's opens later
    move(panels, 40, 30);
    expect(getMenus()).toHaveLength(1);
    expect(document.activeElement).toBe(panels);
    vi.advanceTimersByTime(150);
    expect(getMenus()[1]?.getAttribute('aria-label')).toBe('Panels');
    menu.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays open while the pointer heads for it across its level’s other items', () => {
    const menu = addMenu(viewItems());
    menu.open();
    const [zoom, panels] = getItems();
    move(zoom, 100, 10);
    vi.advanceTimersByTime(150);
    const sub = getMenus()[1];
    sub.getBoundingClientRect = () => ({ left: 200, right: 300, top: 0, bottom: 100 }) as DOMRect;
    // Toward the submenu: the focus stays, and the item under the pointer acts after the delay
    move(panels, 150, 30);
    expect(getMenus()).toHaveLength(2);
    expect(document.activeElement).toBe(zoom);
    // Reaching the submenu keeps it
    move(getItemsOf(sub)[0], 210, 20);
    vi.advanceTimersByTime(150);
    expect(getMenus()).toHaveLength(2);
    expect(getFocusedLabel()).toBe('In');
    // Back across the parent: away from the submenu, so it closes at once
    move(panels, 150, 40);
    expect(getMenus()).toHaveLength(1);
    expect(document.activeElement).toBe(panels);
    menu.cmp.remove();
  });

  it('a stop on the way to the submenu acts on the item under the pointer after the delay', () => {
    const menu = addMenu(viewItems());
    menu.open();
    const [zoom, panels] = getItems();
    move(zoom, 100, 10);
    vi.advanceTimersByTime(150);
    getMenus()[1].getBoundingClientRect = () =>
      ({ left: 200, right: 300, top: 0, bottom: 100 }) as DOMRect;
    move(panels, 150, 30);
    vi.advanceTimersByTime(150);
    expect(document.activeElement).toBe(panels);
    expect(getMenus()[1]?.getAttribute('aria-label')).not.toBe('Zoom');
    menu.cmp.remove();
  });

  it('a press or the focus in a submenu keeps the menu; a press outside closes every level', () => {
    const outside = document.createElement('button');
    getHUDRootCMP().elem.appendChild(outside);
    const menu = addMenu(viewItems());
    trigger.focus();
    menu.open();
    key('ArrowRight');
    const sub = getMenus()[1];
    getItemsOf(sub)[0].dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(getMenus()).toHaveLength(2);
    outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(getMenus()).toHaveLength(0);
    expect(menu.isOpen()).toBe(false);
    outside.remove();
    menu.cmp.remove();
  });

  it('a submenu’s hints: an array’s kept for the next open, a getter’s removed at the close, drawn or not', () => {
    const kept = createKbd({ keys: 'Ctrl+Plus' });
    const removeKept = vi.spyOn(kept.cmp, 'remove');
    const menu = addMenu([{ type: 'submenu', label: 'Zoom', items: [{ label: 'In', kbd: kept }] }]);
    trigger.focus();
    menu.open();
    key('ArrowRight');
    expect(getItemsOf(getMenus()[1])[0].getAttribute('aria-keyshortcuts')).toBe('Control+Plus');
    key('ArrowLeft');
    key('ArrowRight');
    expect(kept.cmp.elem.parentElement).toBe(getItemsOf(getMenus()[1])[0]);
    menu.close();
    expect(removeKept).not.toHaveBeenCalled();
    menu.cmp.remove();
    expect(removeKept).toHaveBeenCalledTimes(1);

    const removes: (() => void)[] = [];
    const fromGetter = addMenu(() => {
      const kbd = createKbd({ keys: 'F2' });
      removes.push(vi.spyOn(kbd.cmp, 'remove'));
      return [{ type: 'submenu', label: 'Edit', items: [{ label: 'Rename', kbd }] }];
    });
    fromGetter.open();
    fromGetter.close();
    expect(removes[0]).toHaveBeenCalledTimes(1);
    fromGetter.cmp.remove();
  });

  it('leaves no listener, timer or element after its removal with submenus open', () => {
    const menu = addMenu(viewItems());
    trigger.focus();
    menu.open();
    key('ArrowDown');
    key('ArrowRight');
    key('End');
    key('ArrowRight');
    const subs = getMenus().slice(1);
    expect(subs).toHaveLength(2);
    move(getItemsOf(subs[1])[1], 5, 5);
    menu.cmp.remove();
    expect(getMenus()).toHaveLength(0);
    for (const sub of subs) expect(countListeners(sub)).toBe(0);
    expect(countListeners(document, 'pointerdown')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
