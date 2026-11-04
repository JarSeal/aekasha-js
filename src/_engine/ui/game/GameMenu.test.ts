import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createGameMenu, type GameMenuItem, type GameMenuProps } from './GameMenu';

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekGameMenu__${name}`) as HTMLElement;

/** The items of the page shown */
const getItems = (elem: Element) =>
  [
    ...elem.querySelectorAll('.aekGameMenu__page:not([hidden]) .aekGameMenu__item'),
  ] as HTMLButtonElement[];

const click = (target: Element) => dispatchPointer(target, 'click');

/** A game menu, and an opener in the HUD with the focus (what the focus goes back to) */
const addMenu = (props: Partial<GameMenuProps> = {}) => {
  const menu = createGameMenu({ title: 'Paused', items: ITEMS, ...props });
  const opener = document.createElement('button');
  getHUDRootCMP().elem.append(opener);
  opener.focus();
  return { menu, elem: menu.cmp.elem, opener };
};

const removeAll = (menu: { cmp: { remove: () => void } }, opener: HTMLElement) => {
  menu.cmp.remove();
  opener.remove();
};

const onResume = vi.fn();

const ITEMS: GameMenuItem[] = [
  { id: 'resume', label: 'Resume', onSelect: onResume },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Video, audio and controls',
    page: {
      title: 'Settings',
      items: [
        { id: 'video', label: 'Video' },
        { id: 'audio', label: 'Audio' },
      ],
    },
  },
  { id: 'load', label: 'Load game', disabled: true, description: 'No saves yet' },
];

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('game menu (p808 D8)', () => {
  it('is a modal dialog in the HUD root only while open, the focus on its first item', () => {
    const onOpen = vi.fn();
    const { menu, elem, opener } = addMenu({ onOpen });
    expect(elem.isConnected).toBe(false);
    const bystander = document.createElement('div');
    getHUDRootCMP().elem.append(bystander);
    menu.open();
    expect(elem.parentElement).toBe(getHUDRootCMP().elem);
    const panel = part(elem, 'panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Paused'
    );
    expect(document.activeElement).toBe(getItems(elem)[0]);
    expect(bystander.hasAttribute('inert')).toBe(true);
    expect(elem.hasAttribute('inert')).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);
    // An item's description: shown out of its name, read from a hidden copy
    const settings = getItems(elem)[1];
    expect(part(settings, 'itemDescription').getAttribute('aria-hidden')).toBe('true');
    const spoken = document.getElementById(settings.getAttribute('aria-describedby') ?? '');
    expect(spoken?.textContent).toBe('Video, audio and controls');
    expect(spoken?.hidden).toBe(true);
    expect(settings.hasAttribute('data-page')).toBe(true);
    expect(getItems(elem)[2].getAttribute('aria-disabled')).toBe('true');
    menu.close();
    expect(bystander.hasAttribute('inert')).toBe(false);
    bystander.remove();
    removeAll(menu, opener);
  });

  it('acts on a click, not a disabled item’s, and keeps Enter and Space from the action maps', () => {
    onResume.mockClear();
    const { menu, elem, opener } = addMenu();
    menu.open();
    click(part(getItems(elem)[0], 'itemLabel'));
    expect(onResume).toHaveBeenCalledWith('resume');
    click(getItems(elem)[2]);
    expect(menu.getDepth()).toBe(0);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const space = dispatchKey(getItems(elem)[0], 'keydown', ' ');
    // The button's own click: not prevented, only stopped
    expect(space.defaultPrevented).toBe(false);
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
    removeAll(menu, opener);
  });

  it('has no Back on its first page without onBack, and Escape does nothing there', () => {
    const { menu, elem, opener } = addMenu();
    menu.open();
    expect(part(elem, 'back').hidden).toBe(true);
    dispatchKey(getItems(elem)[0], 'keydown', 'Escape');
    expect(menu.isOpen()).toBe(true);
    removeAll(menu, opener);
  });

  it('opens a page in the panel’s place and goes back by Back, Escape and back()', () => {
    const onBack = vi.fn();
    const { menu, elem, opener } = addMenu({ onBack });
    menu.open();
    const back = part(elem, 'back');
    expect(back.hidden).toBe(false);
    expect(back.textContent).toBe('Back');
    const settings = getItems(elem)[1];
    settings.focus();
    click(settings);
    expect(menu.getDepth()).toBe(1);
    expect(part(elem, 'title').textContent).toBe('Settings');
    const page = elem.querySelector('.aekGameMenu__page:not([data-root])') as HTMLElement;
    expect(page.getAttribute('role')).toBe('group');
    expect(page.getAttribute('aria-label')).toBe('Settings');
    expect((elem.querySelector('[data-root]') as HTMLElement).hidden).toBe(true);
    expect(getItems(elem).map((item) => item.textContent)).toEqual(['Video', 'Audio']);
    expect(document.activeElement).toBe(getItems(elem)[0]);
    click(back);
    expect(menu.getDepth()).toBe(0);
    expect(page.isConnected).toBe(false);
    expect(part(elem, 'title').textContent).toBe('Paused');
    // The focus back on the item that opened it
    expect(document.activeElement).toBe(getItems(elem)[1]);
    click(getItems(elem)[1]);
    dispatchKey(getItems(elem)[0], 'keydown', 'Escape');
    expect(menu.getDepth()).toBe(0);
    expect(onBack).not.toHaveBeenCalled();
    // On the first page Back is onBack's
    menu.navigation.back();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(menu.isOpen()).toBe(true);
    removeAll(menu, opener);
  });

  it('makes a function page’s content on each open and keeps a CMP page’s', () => {
    const removed = vi.fn();
    const made = vi.fn(() =>
      CMP({ html: '<div><button>Apply</button></div>', onRemoveCmp: removed })
    );
    const kept = CMP({ html: '<div><button>Rebind</button></div>' });
    const audioPage = { title: 'Audio', content: made };
    const controlsPage = {
      title: 'Controls',
      items: [{ id: 'reset', label: 'Reset' }],
      content: kept,
    };
    const { menu, elem, opener } = addMenu({ onBack: () => {} });
    menu.open();
    menu.openPage(audioPage);
    expect(made).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent).toBe('Apply');
    menu.back();
    expect(removed).toHaveBeenCalledTimes(1);
    menu.openPage(audioPage);
    expect(made).toHaveBeenCalledTimes(2);
    menu.back();
    menu.openPage(controlsPage);
    const pageElem = kept.elem.parentElement as HTMLElement;
    // Its items first, then its content
    expect(document.activeElement?.textContent).toBe('Reset');
    menu.back();
    expect(pageElem.hidden).toBe(true);
    expect(kept.elem.isConnected).toBe(true);
    // A page over a page
    menu.openPage(controlsPage);
    expect(pageElem.hidden).toBe(false);
    expect(pageElem.parentElement?.lastElementChild).toBe(pageElem);
    menu.openPage(audioPage);
    expect(menu.getDepth()).toBe(2);
    expect(part(elem, 'title').textContent).toBe('Audio');
    menu.back();
    expect(part(elem, 'title').textContent).toBe('Controls');
    removeAll(menu, opener);
    expect(kept.elem.isConnected).toBe(false);
  });

  it('closes with the focus back and the pages gone, and opens again on its first page', () => {
    const onClose = vi.fn();
    const { menu, elem, opener } = addMenu({ onClose });
    menu.open();
    click(getItems(elem)[1]);
    menu.close();
    expect(menu.isOpen()).toBe(false);
    expect(elem.isConnected).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(menu.getDepth()).toBe(0);
    menu.open();
    expect(part(elem, 'title').textContent).toBe('Paused');
    expect(document.activeElement).toBe(getItems(elem)[0]);
    removeAll(menu, opener);
  });

  it('moves by position with the arrows and the navigation, round past Back', () => {
    const { menu, elem, opener } = addMenu({ onBack: () => {} });
    menu.open();
    const place = (target: Element, top: number) => {
      const box = { left: 0, top, right: 300, bottom: top + 40, width: 300, height: 40 };
      (target as HTMLElement).getBoundingClientRect = () => box as DOMRect;
    };
    const items = getItems(elem);
    items.forEach((item, i) => place(item, 100 + i * 50));
    place(part(elem, 'back'), 300);
    dispatchKey(items[0], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    // A disabled item is a stop: its description says why
    menu.navigation.move('down');
    expect(document.activeElement).toBe(items[2]);
    menu.navigation.move('down');
    expect(document.activeElement).toBe(part(elem, 'back'));
    menu.navigation.move('down');
    expect(document.activeElement).toBe(items[0]);
    removeAll(menu, opener);
  });

  it('replaces its first page’s items, the focus kept at its place', () => {
    const { menu, elem, opener } = addMenu();
    menu.open();
    getItems(elem)[1].focus();
    menu.setItems([
      { id: 'continue', label: 'Continue' },
      { id: 'new', label: 'New game' },
    ]);
    expect(getItems(elem).map((item) => item.textContent)).toEqual(['Continue', 'New game']);
    expect(document.activeElement).toBe(getItems(elem)[1]);
    removeAll(menu, opener);
  });

  it('adds a footer, and leaves no listener, entry or inert after its removal while open', () => {
    const footer = CMP({ class: 'hints', text: 'B Back' });
    const { menu, elem, opener } = addMenu({ footer });
    expect(part(elem, 'footer').contains(footer.elem)).toBe(true);
    const bystander = document.createElement('div');
    getHUDRootCMP().elem.append(bystander);
    menu.open();
    click(getItems(elem)[1]);
    const panel = part(elem, 'panel');
    const back = part(elem, 'back');
    menu.cmp.remove();
    expect(elem.isConnected).toBe(false);
    expect(footer.elem.isConnected).toBe(false);
    expect(countListeners(panel)).toBe(0);
    expect(countListeners(back)).toBe(0);
    expect(bystander.hasAttribute('inert')).toBe(false);
    expect(dispatchKey(opener, 'keydown', 'Escape').defaultPrevented).toBe(false);
    bystander.remove();
    opener.remove();
  });
});
