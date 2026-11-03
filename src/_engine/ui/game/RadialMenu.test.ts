import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createRadialMenu, type RadialMenuItem, type RadialMenuProps } from './RadialMenu';

const ITEMS: RadialMenuItem[] = [
  { id: 'potion', label: 'Potion', description: 'Restores 50 health' },
  { id: 'torch', label: 'Torch' },
  { id: 'map', label: 'Map' },
  { id: 'bomb', label: 'Bomb', disabled: true, description: 'None left' },
];

/** The layer's bounds (1000 × 800 at 100, 50), the ring 300 px, the centre 100 px: linkedom lays
 * nothing out */
const layOut = (elem: HTMLElement) => {
  const bounds = { left: 100, top: 50, right: 1100, bottom: 850, width: 1000, height: 800 };
  elem.getBoundingClientRect = () => bounds as DOMRect;
  Object.defineProperty(part(elem, 'ring'), 'offsetWidth', { value: 300 });
  Object.defineProperty(part(elem, 'ring'), 'offsetHeight', { value: 300 });
  Object.defineProperty(part(elem, 'centre'), 'offsetWidth', { value: 100 });
};

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekRadialMenu__${name}`) as HTMLElement;

const getItems = (elem: Element) =>
  [...elem.querySelectorAll('.aekRadialMenu__item')] as HTMLButtonElement[];

/** A radial menu added to the HUD root, laid out, and an opener with the focus */
const addMenu = (props: Partial<RadialMenuProps> = {}) => {
  const menu = createRadialMenu({ label: 'Quick items', items: ITEMS, ...props });
  getHUDRootCMP().add(menu.cmp);
  layOut(menu.cmp.elem);
  const opener = document.createElement('button');
  getHUDRootCMP().elem.append(opener);
  opener.focus();
  return { menu, elem: menu.cmp.elem, opener };
};

const removeAll = (menu: { cmp: { remove: () => void } }, opener: HTMLElement) => {
  menu.cmp.remove();
  opener.remove();
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('radial menu (p808 D8)', () => {
  it('is a hidden menu of menuitems round a ring until it opens, the ring then focused', () => {
    const onOpen = vi.fn();
    const { menu, elem, opener } = addMenu({ onOpen });
    expect(elem.hasAttribute('hidden')).toBe(true);
    const ring = part(elem, 'ring');
    expect(ring.getAttribute('role')).toBe('menu');
    expect(ring.getAttribute('aria-label')).toBe('Quick items');
    const items = getItems(elem);
    expect(items.map((item) => item.getAttribute('role'))).toEqual(Array(4).fill('menuitem'));
    expect(items.map((item) => item.style.getPropertyValue('--aek-radial-menu-angle'))).toEqual([
      '0deg',
      '90deg',
      '180deg',
      '270deg',
    ]);
    expect(items[3].getAttribute('aria-disabled')).toBe('true');
    const description = document.getElementById(items[0].getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Restores 50 health');
    const centre = part(elem, 'centre');
    expect(centre.getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'centreLabel').textContent).toBe('Quick items');
    expect(centre.hasAttribute('data-empty')).toBe(true);

    menu.open();
    expect(menu.isOpen()).toBe(true);
    expect(elem.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(ring);
    expect(menu.getHighlighted()).toBe(-1);
    expect(elem.style.getPropertyValue('--aek-radial-menu-x')).toBe('500px');
    expect(onOpen).toHaveBeenCalledTimes(1);
    removeAll(menu, opener);
  });

  it('keeps the ring inside the bounds at a point', () => {
    const { menu, elem, opener } = addMenu();
    menu.open({ point: { x: 120, y: 840 } });
    expect(elem.style.getPropertyValue('--aek-radial-menu-x')).toBe('150px');
    expect(elem.style.getPropertyValue('--aek-radial-menu-y')).toBe('650px');
    menu.open({ point: { x: 600, y: 300 }, highlight: 2 });
    expect(elem.style.getPropertyValue('--aek-radial-menu-x')).toBe('500px');
    expect(elem.style.getPropertyValue('--aek-radial-menu-y')).toBe('250px');
    expect(document.activeElement).toBe(getItems(elem)[2]);
    removeAll(menu, opener);
  });

  it('goes round the ring with the arrows, the focus and the centre following', () => {
    const { menu, elem, opener } = addMenu();
    menu.open();
    const ring = part(elem, 'ring');
    const items = getItems(elem);
    expect(dispatchKey(ring, 'keydown', 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].hasAttribute('data-highlighted')).toBe(true);
    expect(part(elem, 'centreLabel').textContent).toBe('Potion');
    expect(part(elem, 'centreDescription').textContent).toBe('Restores 50 health');
    dispatchKey(items[0], 'keydown', 'ArrowUp');
    // A disabled item is reached: its description says why
    expect(document.activeElement).toBe(items[3]);
    expect(items[0].hasAttribute('data-highlighted')).toBe(false);
    dispatchKey(items[3], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    dispatchKey(items[0], 'keydown', 'End');
    expect(menu.getHighlighted()).toBe(3);
    removeAll(menu, opener);
  });

  it('picks by a click and by Enter on the ring, closing first; a disabled item picks nothing', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { menu, elem, opener } = addMenu({ onSelect, onClose });
    menu.open({ highlight: 3 });
    dispatchPointer(getItems(elem)[3], 'click');
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu.isOpen()).toBe(true);
    // Enter on an item is its own click's: stopped, not prevented
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const enter = dispatchKey(getItems(elem)[3], 'keydown', 'Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
    onSelect.mockImplementation(() => {
      expect(menu.isOpen()).toBe(false);
    });
    dispatchPointer(part(getItems(elem)[1], 'label'), 'click');
    expect(onSelect).toHaveBeenCalledWith('torch', 1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(elem.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(opener);
    menu.open({ highlight: 2 });
    part(elem, 'ring').focus();
    dispatchKey(part(elem, 'ring'), 'keydown', 'Enter');
    expect(onSelect).toHaveBeenLastCalledWith('map', 2);
    removeAll(menu, opener);
  });

  it('closes on Escape and Tab with the focus back, nothing picked', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { menu, elem, opener } = addMenu({ onSelect, onClose });
    menu.open({ highlight: 0 });
    dispatchKey(getItems(elem)[0], 'keydown', 'Escape');
    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    menu.open();
    expect(dispatchKey(part(elem, 'ring'), 'keydown', 'Tab').defaultPrevented).toBe(true);
    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
    // Closed: a select picks nothing
    expect(menu.select()).toBe(false);
    removeAll(menu, opener);
  });

  it('highlights by a stick past its dead zone, keeps it on the release, and picks on select', () => {
    const onSelect = vi.fn();
    const { menu, elem, opener } = addMenu({ onSelect });
    menu.open();
    menu.setDirection(0.3, -0.3);
    expect(menu.getHighlighted()).toBe(-1);
    menu.setDirection(0.9, 0.1);
    expect(menu.getHighlighted()).toBe(1);
    expect(document.activeElement).toBe(getItems(elem)[1]);
    // The same direction every frame writes nothing
    const spies = getItems(elem).map((item) => vi.spyOn(item, 'setAttribute'));
    const centreSpy = vi.spyOn(part(elem, 'centre'), 'toggleAttribute');
    menu.setDirection(0.95, 0.05);
    menu.setDirection(0, 0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(centreSpy).not.toHaveBeenCalled();
    expect(menu.getHighlighted()).toBe(1);
    menu.setDirection(-0.1, -1);
    expect(menu.getHighlighted()).toBe(0);
    menu.setDirection(-1, 0);
    expect(menu.select()).toBe(false);
    expect(menu.isOpen()).toBe(true);
    menu.setDirection(0, 1);
    expect(menu.select()).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('map', 2);
    removeAll(menu, opener);
  });

  it('highlights by the pointer’s direction, none in the centre, and a click there closes', () => {
    const onSelect = vi.fn();
    const { menu, elem, opener } = addMenu({ onSelect });
    menu.open();
    // The centre is at (600, 450)
    dispatchPointer(elem, 'pointermove', { clientX: 600, clientY: 300 });
    expect(menu.getHighlighted()).toBe(0);
    dispatchPointer(elem, 'pointermove', { clientX: 620, clientY: 460 });
    expect(menu.getHighlighted()).toBe(-1);
    expect(document.activeElement).toBe(part(elem, 'ring'));
    // A touch picks where it lifts
    dispatchPointer(elem, 'pointerdown', { pointerType: 'touch', clientX: 450, clientY: 450 });
    expect(menu.getHighlighted()).toBe(3);
    dispatchPointer(elem, 'click', { clientX: 600, clientY: 600 });
    expect(onSelect).toHaveBeenCalledWith('map', 2);
    menu.open();
    dispatchPointer(part(elem, 'centre'), 'click', { clientX: 610, clientY: 440 });
    expect(menu.isOpen()).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
    removeAll(menu, opener);
  });

  it('replaces its items, keeping the highlight and the focus', () => {
    const { menu, elem, opener } = addMenu();
    menu.open({ highlight: 1 });
    menu.setItems(ITEMS.slice(0, 3));
    expect(getItems(elem)).toHaveLength(3);
    expect(menu.getHighlighted()).toBe(1);
    expect(document.activeElement).toBe(getItems(elem)[1]);
    expect(getItems(elem)[2].style.getPropertyValue('--aek-radial-menu-angle')).toBe('240deg');
    menu.setItems(ITEMS.slice(0, 1));
    expect(menu.getHighlighted()).toBe(-1);
    expect(document.activeElement).toBe(part(elem, 'ring'));
    removeAll(menu, opener);
  });

  it('leaves no listener or overlay entry after its removal while open', () => {
    const { menu, elem, opener } = addMenu();
    menu.open({ highlight: 0 });
    menu.cmp.remove();
    expect(countListeners(elem)).toBe(0);
    // Its entry went: Escape in the HUD is no one's
    expect(dispatchKey(opener, 'keydown', 'Escape').defaultPrevented).toBe(false);
    opener.remove();
  });
});
