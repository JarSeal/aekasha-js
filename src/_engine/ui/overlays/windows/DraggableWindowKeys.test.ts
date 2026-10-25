import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../../testing/KitDom';
import { CMP } from '../../core/CMP';
import { createHudRoot } from '../../core/HUD';
import {
  closeDraggableWindow,
  getDraggableWindow,
  isDraggableWindowOnTop,
  openDraggableWindow,
  removeDraggableWindow,
} from './DraggableWindow';
import { parseKeyChord, setWindowCycleKeys } from './DraggableWindowKeys';

vi.mock(import('../../../kernel/scene/SceneHooks'), () => ({ addSceneHooks: () => () => {} }));
vi.mock(import('../../../kernel/init/BootHooks'), () => ({ addBootAfterStartHook: () => true }));

/** A button on the page outside the HUD root (the canvas, a Hub button) */
let pageButton: HTMLButtonElement;

const getElem = (id: string) => getDraggableWindow(id)?.windowCMP?.elem as HTMLElement;
const getPart = (id: string, selector: string) =>
  getElem(id).querySelector(selector) as HTMLElement;

/** A key at `target`; whether a bubble listener on the window (the input system's) got it */
const keyReachesWindow = (
  target: EventTarget,
  key: string,
  init: Parameters<typeof dispatchKey>[3] = {}
) => {
  const binding = vi.fn();
  window.addEventListener('keydown', binding);
  dispatchKey(target, 'keydown', key, init);
  window.removeEventListener('keydown', binding);
  return binding.mock.calls.length > 0;
};

/** linkedom has no layout: the window's box is its inline size */
const measureByStyle = (elem: HTMLElement) => {
  elem.getBoundingClientRect = () => {
    const width = parseFloat(elem.style.width) || 0;
    const height = parseFloat(elem.style.height) || 0;
    return { left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, width, height } as DOMRect;
  };
};

beforeAll(async () => {
  await stubKitDomAsync(
    '<!doctype html><html><head></head><body><button id="page">Page</button><div id="hudSlot"></div></body></html>'
  );
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
  pageButton = document.getElementById('page') as HTMLButtonElement;
});

describe('window cycle chords', () => {
  it('parse modifiers in any case and order, and a + key', () => {
    expect(parseKeyChord('F6')).toEqual({
      key: 'f6',
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    });
    expect(parseKeyChord('shift+F6')).toMatchObject({ key: 'f6', shift: true, ctrl: false });
    expect(parseKeyChord('Cmd+Option+K')).toMatchObject({ key: 'k', meta: true, alt: true });
    expect(parseKeyChord('Ctrl++')).toMatchObject({ key: '+', ctrl: true });
  });
});

describe('a window’s roles and names (p803 D8)', () => {
  it('is a dialog named by its title, its header a described tab stop, its buttons labelled', () => {
    openDraggableWindow({ id: 'named', title: 'Settings' });
    const elem = getElem('named');
    expect(elem.getAttribute('role')).toBe('dialog');
    expect(elem.getAttribute('aria-modal')).toBeNull();
    expect(elem.getAttribute('aria-labelledby')).toBe('named__title');
    expect(getPart('named', '#named__title').textContent).toBe('Settings');
    expect(elem.getAttribute('data-state')).toBe('expanded');
    expect(elem.hasAttribute('data-draggable')).toBe(true);
    expect(elem.getAttribute('data-resizable')).toBe('both');

    const header = getPart('named', '.aekWindow__header');
    expect(header.tagName).toBe('DIV'); // not a <header>: no second banner landmark
    expect(header.getAttribute('tabindex')).toBe('0');
    expect(header.getAttribute('aria-roledescription')).toBe('movable window');
    expect(getPart('named', `#${header.getAttribute('aria-describedby')}`).textContent).toContain(
      'Arrow keys move the window.'
    );

    const collapse = getPart('named', '.aekWindow__collapse');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.getAttribute('aria-controls')).toBe('named__content');
    expect(collapse.getAttribute('aria-labelledby')).toBe('named__title');
    // Its tooltip ("Collapse") describes it; the close button's repeats its label, so doesn't
    expect(collapse.getAttribute('aria-describedby')).toBeTruthy();
    const close = getPart('named', '.aekWindow__close');
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(close.getAttribute('aria-describedby')).toBeNull();
    expect(close.getAttribute('title')).toBeNull();
    removeDraggableWindow('named');
  });

  it('is named by its ariaLabel without a title, and hides the empty heading', () => {
    openDraggableWindow({ id: 'unnamed', ariaLabel: 'Inventory' });
    expect(getElem('unnamed').getAttribute('aria-label')).toBe('Inventory');
    expect(getElem('unnamed').getAttribute('aria-labelledby')).toBeNull();
    expect(getPart('unnamed', '.aekWindow__title').getAttribute('aria-hidden')).toBe('true');
    // A reopen with a title: the title names it
    openDraggableWindow({ id: 'unnamed', title: 'Bag' });
    expect(getElem('unnamed').getAttribute('aria-labelledby')).toBe('unnamed__title');
    expect(getElem('unnamed').getAttribute('aria-label')).toBeNull();
    removeDraggableWindow('unnamed');
  });

  it('has no header tab stop when the header has no key to act on (a fixed window)', () => {
    openDraggableWindow({
      id: 'fixed',
      title: 'Fixed',
      disableDragging: true,
      disableVertResize: true,
      disableHoriResize: true,
      disableCollapseBtn: true,
    });
    const header = getPart('fixed', '.aekWindow__header');
    expect(header.hasAttribute('tabindex')).toBe(false);
    expect(header.hasAttribute('role')).toBe(false);
    expect(getElem('fixed').hasAttribute('data-resizable')).toBe(false);
    removeDraggableWindow('fixed');
  });

  it('makes a content without controls a tab stop, and leaves one with a control alone', () => {
    openDraggableWindow({ id: 'text', title: 'Text', content: CMP({ tag: 'p', text: 'Words' }) });
    expect(getPart('text', '.aekWindow__content').getAttribute('tabindex')).toBe('0');
    const panel = CMP();
    panel.add({ tag: 'button', text: 'OK' });
    openDraggableWindow({ id: 'controls', title: 'Controls', content: panel });
    expect(getPart('controls', '.aekWindow__content').hasAttribute('tabindex')).toBe(false);
    removeDraggableWindow('text');
    removeDraggableWindow('controls');
  });
});

describe('the header’s keys (p803 D8)', () => {
  it('move the window by a step (four with Shift), and the press goes no further', () => {
    openDraggableWindow({ id: 'mover', title: 'Mover', position: { x: 100, y: 100 } });
    const header = getPart('mover', '.aekWindow__header');
    header.focus();
    const start = { ...getDraggableWindow('mover')!.geometry };
    expect(keyReachesWindow(header, 'ArrowRight')).toBe(false);
    dispatchKey(header, 'keydown', 'ArrowDown', { shiftKey: true });
    const moved = getDraggableWindow('mover')!.geometry;
    expect(moved.x).toBe(start.x + 16);
    expect(moved.y).toBe(start.y + 64);
    expect(getElem('mover').style.left).toBe(`${moved.x}px`);
    // A key on one of its buttons is the button's
    const close = getPart('mover', '.aekWindow__close');
    expect(keyReachesWindow(close, 'ArrowLeft')).toBe(true);
    expect(getDraggableWindow('mover')!.geometry.x).toBe(moved.x);
    removeDraggableWindow('mover');
  });

  it('resize it with Alt, in px from then on, and not the height of a collapsed one', () => {
    openDraggableWindow({ id: 'sizer', title: 'Sizer', size: { w: 300, h: 200 } });
    measureByStyle(getElem('sizer'));
    const header = getPart('sizer', '.aekWindow__header');
    dispatchKey(header, 'keydown', 'ArrowRight', { altKey: true });
    dispatchKey(header, 'keydown', 'ArrowUp', { altKey: true });
    expect(getDraggableWindow('sizer')!.geometry).toMatchObject({ w: 316, h: 184 });
    expect(getDraggableWindow('sizer')!.units?.size).toEqual({ w: 'px', h: 'px' });

    dispatchKey(header, 'keydown', 'Enter');
    expect(getDraggableWindow('sizer')!.isCollapsed).toBe(true);
    dispatchKey(header, 'keydown', 'ArrowDown', { altKey: true });
    expect(getDraggableWindow('sizer')!.geometry.h).toBe(184);
    removeDraggableWindow('sizer');
  });

  it('collapse and expand it with Enter: the state, aria-expanded and the tooltip follow', () => {
    openDraggableWindow({ id: 'folder', title: 'Folder' });
    const header = getPart('folder', '.aekWindow__header');
    const collapse = getPart('folder', '.aekWindow__collapse');
    const tooltipId = collapse.getAttribute('aria-describedby')!;
    dispatchKey(header, 'keydown', 'Enter');
    expect(getElem('folder').getAttribute('data-state')).toBe('collapsed');
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    vi.useFakeTimers();
    collapse.dispatchEvent(new window.Event('pointerenter'));
    vi.advanceTimersByTime(600);
    expect(document.getElementById(tooltipId)?.textContent).toBe('Expand');
    vi.useRealTimers();
    dispatchKey(header, 'keydown', 'Enter');
    expect(getElem('folder').getAttribute('data-state')).toBe('expanded');
    removeDraggableWindow('folder');
  });
});

describe('the window cycle keys (p803 D8)', () => {
  it('focus the windows in their open order from the page, and bring each to the front', () => {
    openDraggableWindow({ id: 'cycleA', title: 'A' });
    openDraggableWindow({ id: 'cycleB', title: 'B' });
    openDraggableWindow({ id: 'cycleC', title: 'C' });
    pageButton.focus();

    expect(keyReachesWindow(pageButton, 'F6')).toBe(false);
    expect(getElem('cycleA').contains(document.activeElement)).toBe(true);
    expect(isDraggableWindowOnTop('cycleA')).toBe(true);
    dispatchKey(document.activeElement!, 'keydown', 'F6');
    expect(getElem('cycleB').contains(document.activeElement)).toBe(true);
    // The order is the open order, not the z-order the cycle changes
    dispatchKey(document.activeElement!, 'keydown', 'F6');
    dispatchKey(document.activeElement!, 'keydown', 'F6');
    expect(getElem('cycleA').contains(document.activeElement)).toBe(true);
    dispatchKey(document.activeElement!, 'keydown', 'F6', { shiftKey: true });
    expect(getElem('cycleC').contains(document.activeElement)).toBe(true);
  });

  it('skip an inert window, and are off with null', () => {
    getElem('cycleB').setAttribute('inert', '');
    getElem('cycleA').querySelector<HTMLElement>('.aekWindow__header')!.focus();
    dispatchKey(document.activeElement!, 'keydown', 'F6');
    expect(getElem('cycleC').contains(document.activeElement)).toBe(true);
    getElem('cycleB').removeAttribute('inert');

    setWindowCycleKeys(null);
    pageButton.focus();
    expect(keyReachesWindow(pageButton, 'F6')).toBe(true);
    expect(document.activeElement).toBe(pageButton);
    setWindowCycleKeys({ next: 'Ctrl+F6', previous: 'Ctrl+Shift+F6' });
    dispatchKey(pageButton, 'keydown', 'F6', { ctrlKey: true, shiftKey: true });
    expect(getElem('cycleC').contains(document.activeElement)).toBe(true);
    setWindowCycleKeys({ next: 'F6', previous: 'Shift+F6' });
  });

  it('leave the key alone with no window open', () => {
    for (const id of ['cycleA', 'cycleB', 'cycleC']) closeDraggableWindow(id);
    pageButton.focus();
    expect(keyReachesWindow(pageButton, 'F6')).toBe(true);
  });
});
