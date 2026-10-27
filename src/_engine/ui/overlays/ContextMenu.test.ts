import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createContextMenu, type ContextMenuProps } from './ContextMenu';

let panel: HTMLElement;
let row: HTMLButtonElement;

const getMenus = () => [...getHUDRootCMP().elem.querySelectorAll<HTMLElement>('.aekMenu')];
const getFocusedLabel = () =>
  (document.activeElement as HTMLElement).querySelector('.aekMenu__label')?.textContent;

/** A right click: a `contextmenu` event at a point, cancelable as a browser's */
const rightClick = (
  target: EventTarget,
  init: { x?: number; y?: number; shiftKey?: boolean } = {}
) =>
  target.dispatchEvent(
    Object.assign(new window.Event('contextmenu', { bubbles: true, cancelable: true }), {
      clientX: init.x ?? 0,
      clientY: init.y ?? 0,
      shiftKey: Boolean(init.shiftKey),
    })
  );

const addMenu = (props: Partial<ContextMenuProps> = {}) =>
  createContextMenu({
    target: panel,
    items: [{ label: 'Focus' }, { label: 'Hide' }],
    ...props,
  });

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
  panel = document.createElement('div');
  row = document.createElement('button');
  row.textContent = 'Lamp';
  panel.append(row);
  getHUDRootCMP().elem.appendChild(panel);
});

afterEach(() => {
  panel.remove();
  vi.useRealTimers();
});

describe('context menu (p805 D11)', () => {
  it('a right click opens it at the pointer, on its first item, in place of the browser’s', () => {
    const menu = addMenu();
    const allowed = rightClick(row, { x: 120, y: 80 });
    expect(allowed).toBe(false);
    expect(menu.isOpen()).toBe(true);
    const [elem] = getMenus();
    expect(elem.getAttribute('role')).toBe('menu');
    expect(elem.getAttribute('aria-label')).toBe('Context menu');
    expect(getFocusedLabel()).toBe('Focus');
    // Nothing on the target: a context menu has no trigger
    expect(panel.hasAttribute('aria-haspopup')).toBe(false);
    menu.cmp.remove();
  });

  it('Shift+right click, or a right click where there are no items, keeps the browser’s menu', () => {
    const items = vi.fn((elem: Element) => (elem === row ? [{ label: 'Focus' }] : []));
    const menu = addMenu({ items });
    expect(rightClick(row, { shiftKey: true })).toBe(true);
    expect(menu.isOpen()).toBe(false);
    expect(rightClick(panel)).toBe(true);
    expect(menu.isOpen()).toBe(false);
    expect(rightClick(row)).toBe(false);
    expect(items).toHaveBeenLastCalledWith(row, 'pointer');
    menu.cmp.remove();
  });

  it('the ContextMenu key and Shift+F10 open it on the focused element, the focus going back', () => {
    const items = vi.fn(() => [{ label: 'Focus' }, { label: 'Hide' }]);
    const menu = addMenu({ items, label: (elem) => `${elem.textContent} actions` });
    row.focus();
    expect(dispatchKey(row, 'keydown', 'ContextMenu').defaultPrevented).toBe(true);
    expect(items).toHaveBeenLastCalledWith(row, 'keyboard');
    expect(getMenus()[0].getAttribute('aria-label')).toBe('Lamp actions');
    expect(getFocusedLabel()).toBe('Focus');
    dispatchKey(document.activeElement as HTMLElement, 'keydown', 'Escape');
    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(row);
    expect(dispatchKey(row, 'keydown', 'F10', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(menu.isOpen()).toBe(true);
    menu.close();
    // F10 alone, or with Ctrl, isn't the menu's
    expect(dispatchKey(row, 'keydown', 'F10').defaultPrevented).toBe(false);
    expect(
      dispatchKey(row, 'keydown', 'F10', { shiftKey: true, ctrlKey: true }).defaultPrevented
    ).toBe(false);
    menu.cmp.remove();
  });

  it('drops the browser’s own contextmenu right after the key opened it', () => {
    const menu = addMenu();
    row.focus();
    dispatchKey(row, 'keydown', 'ContextMenu');
    const focused = document.activeElement;
    // The browser's event for the key: no second open, the focus kept in the menu
    expect(rightClick(row)).toBe(false);
    expect(getMenus()).toHaveLength(1);
    expect(document.activeElement).toBe(focused);
    // The next right click is the pointer's again
    menu.close();
    expect(rightClick(row, { x: 5, y: 5 })).toBe(false);
    expect(menu.isOpen()).toBe(true);
    menu.cmp.remove();
  });

  it('a touch held still for 500 ms opens it; a move or a release before cancels', () => {
    const items = vi.fn(() => [{ label: 'Focus' }]);
    const menu = addMenu({ items });
    const touch = { pointerType: 'touch', clientX: 50, clientY: 50 };
    const press = (init = {}) =>
      row.dispatchEvent(
        Object.assign(new window.Event('pointerdown', { bubbles: true }), {
          ...touch,
          pointerId: 3,
          isPrimary: true,
          ...init,
        })
      );
    press();
    vi.advanceTimersByTime(499);
    expect(menu.isOpen()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(menu.isOpen()).toBe(true);
    expect(items).toHaveBeenLastCalledWith(row, 'touch');
    // The browser's own contextmenu for the long press is dropped
    expect(rightClick(row)).toBe(false);
    expect(getMenus()).toHaveLength(1);
    menu.close();

    press();
    dispatchPointer(row, 'pointermove', { pointerId: 3, clientX: 70, clientY: 50 });
    vi.advanceTimersByTime(500);
    expect(menu.isOpen()).toBe(false);
    press();
    dispatchPointer(row, 'pointerup', { pointerId: 3 });
    vi.advanceTimersByTime(500);
    expect(menu.isOpen()).toBe(false);
    // A mouse's press is no long press
    press({ pointerType: 'mouse' });
    vi.advanceTimersByTime(500);
    expect(menu.isOpen()).toBe(false);
    menu.cmp.remove();
  });

  it('reads a function’s items at each open; a pick runs after the close', () => {
    const picked: boolean[] = [];
    let count = 0;
    const menu = addMenu({
      items: () => [{ label: `Item ${++count}`, onSelect: () => picked.push(menu.isOpen()) }],
    });
    rightClick(row);
    expect(getFocusedLabel()).toBe('Item 1');
    dispatchKey(document.activeElement as HTMLElement, 'keydown', 'Enter');
    expect(picked).toEqual([false]);
    rightClick(row);
    expect(getFocusedLabel()).toBe('Item 2');
    menu.cmp.remove();
  });

  it('a right click while it’s open opens it again where the pointer is', () => {
    const menu = addMenu();
    rightClick(row, { x: 10, y: 10 });
    rightClick(row, { x: 40, y: 40 });
    expect(getMenus()).toHaveLength(1);
    expect(menu.isOpen()).toBe(true);
    menu.cmp.remove();
  });

  it('leaves no listener or timer on its target after its removal, mid-press too', () => {
    const menu = addMenu();
    row.dispatchEvent(
      Object.assign(new window.Event('pointerdown', { bubbles: true }), {
        pointerType: 'touch',
        pointerId: 1,
        isPrimary: true,
      })
    );
    rightClick(row);
    menu.cmp.remove();
    expect(getMenus()).toHaveLength(0);
    expect(countListeners(panel)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
