import fs from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initEnvironment } from '../../../kernel/config/Config';
import { countListeners, dispatchKey, stubKitDomAsync } from '../../testing/KitDom';
import { CMP } from '../../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import { createDropDown } from '../../forms/DropDown';
import { DEBUGGER_ROOT_ATTR } from '../OverlayStack';
import { openDialog } from './DialogWindow';
import {
  closeDraggableWindow,
  getDraggableWindow,
  openDraggableWindow,
  removeDraggableWindow,
  Z_INDEX_BASES,
} from './DraggableWindow';

vi.mock(import('../../../kernel/scene/SceneHooks'), () => ({ addSceneHooks: () => () => {} }));
vi.mock(import('../../../kernel/init/BootHooks'), () => ({ addBootAfterStartHook: () => true }));

/** A button on the page outside the HUD root (an embed's host page, a Hub button) */
let pageButton: HTMLButtonElement;

/** Escape at `target`; whether a bubble listener on the window (the input system's) got it */
const escapeReachesWindow = (target: EventTarget, type: 'keydown' | 'keyup' = 'keydown') => {
  const binding = vi.fn();
  window.addEventListener(type, binding);
  dispatchKey(target, type, 'Escape');
  window.removeEventListener(type, binding);
  return binding.mock.calls.length > 0;
};

const isOpen = (id: string) => Boolean(getDraggableWindow(id)?.isOpen);
const getElem = (id: string) => getDraggableWindow(id)?.windowCMP?.elem as HTMLElement;

beforeAll(async () => {
  await stubKitDomAsync(
    '<!doctype html><html><head></head><body><button id="page">Page</button><div id="hudSlot"></div></body></html>'
  );
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
  pageButton = document.getElementById('page') as HTMLButtonElement;
});

describe('dialogs: Escape and focus on the overlay stack (p803 D7)', () => {
  it('adds no key listener before the first dialog, and none on the window (G1)', () => {
    const hud = getHUDRootCMP().elem;
    expect(countListeners(hud, 'keydown')).toBe(0);
    openDialog({ id: 'first', title: 'First', closeOnEscape: true });
    expect(countListeners(hud, 'keydown')).toBe(1);
    expect(countListeners(window, 'keydown')).toBe(0);
  });

  it('takes the focus, and Escape inside it closes it and goes no further', () => {
    pageButton.focus();
    openDialog({ id: 'second', title: 'Second', closeOnEscape: true });
    // Its first focusable element: the header's close button
    const focused = document.activeElement as HTMLElement;
    expect(getElem('second').contains(focused)).toBe(true);
    expect(escapeReachesWindow(focused)).toBe(false);
    expect(isOpen('second')).toBe(false);
    expect(isOpen('first')).toBe(true);
    // The focus goes back to its opener, and the press's keyup is swallowed there
    expect(document.activeElement).toBe(pageButton);
    expect(escapeReachesWindow(pageButton, 'keyup')).toBe(false);
    expect(escapeReachesWindow(pageButton, 'keyup')).toBe(true);
  });

  it('leaves Escape pressed outside the HUD root to the page', () => {
    openDialog({ id: 'other', title: 'Other', closeOnEscape: true });
    expect(escapeReachesWindow(pageButton)).toBe(true);
    expect(isOpen('other')).toBe(true);
    closeDraggableWindow('other');
  });

  it("stops Escape at a dialog without closeOnEscape, which stays open; its button's close returns the focus", () => {
    closeDraggableWindow('first');
    pageButton.focus();
    openDialog({ id: 'plain', title: 'Plain' });
    const closeButton = document.activeElement as HTMLElement;
    expect(escapeReachesWindow(closeButton)).toBe(false);
    expect(isOpen('plain')).toBe(true);
    escapeReachesWindow(pageButton, 'keyup');
    closeButton.click();
    expect(isOpen('plain')).toBe(false);
    expect(document.activeElement).toBe(pageButton);
  });

  it("closes a drop-down's list first, then the dialog (p803 1.2's item 1)", () => {
    const dropDown = createDropDown({
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      value: 'a',
      onChange: () => {},
    });
    pageButton.focus();
    openDialog({
      id: 'withList',
      title: 'With a list',
      closeOnEscape: true,
      content: () => dropDown.cmp,
    });
    const trigger = dropDown.cmp.elem.querySelector('button') as HTMLButtonElement;
    trigger.focus();
    dropDown.open();
    // In the HUD root: linkedom has no Popover API, so the list takes the fallback path
    const list = document.querySelector('.aekDropDownList') as HTMLElement;
    expect(list.parentElement).toBe(getHUDRootCMP().elem);
    expect(document.activeElement).toBe(list);

    dispatchKey(list, 'keydown', 'Escape');
    dispatchKey(list, 'keyup', 'Escape');
    expect(dropDown.isOpen()).toBe(false);
    expect(isOpen('withList')).toBe(true);
    expect(document.activeElement).toBe(trigger);

    dispatchKey(trigger, 'keydown', 'Escape');
    expect(isOpen('withList')).toBe(false);
    expect(document.activeElement).toBe(pageButton);
  });

  it('closes one dialog per press, not one per key repeat', () => {
    openDialog({ id: 'lower', title: 'Lower', closeOnEscape: true });
    openDialog({ id: 'upper', title: 'Upper', closeOnEscape: true });
    const focused = document.activeElement as HTMLElement;
    dispatchKey(focused, 'keydown', 'Escape', { repeat: true });
    expect(isOpen('upper')).toBe(true);
    dispatchKey(focused, 'keydown', 'Escape');
    expect(isOpen('upper')).toBe(false);
    expect(isOpen('lower')).toBe(true);
    closeDraggableWindow('lower');
  });
});

/** A content of two buttons, so the trap has a first and a last */
const twoButtons = () => {
  const panel = CMP();
  panel.add({ tag: 'button', text: 'Cancel', class: 'cancel' });
  panel.add({ tag: 'button', text: 'Delete', class: 'delete' });
  return panel;
};

describe('dialogs: modal (p803 D7)', () => {
  it('is a modal dialog, an alertdialog with alert, focused at initialFocus', () => {
    openDialog({ id: 'modal', title: 'Modal' });
    expect(getElem('modal').getAttribute('role')).toBe('dialog');
    expect(getElem('modal').getAttribute('aria-modal')).toBe('true');
    closeDraggableWindow('modal');

    openDialog({
      id: 'confirm',
      title: 'Delete the save?',
      alert: true,
      initialFocus: '.delete',
      content: twoButtons,
    });
    expect(getElem('confirm').getAttribute('role')).toBe('alertdialog');
    expect(document.activeElement?.className).toBe('delete');
    closeDraggableWindow('confirm');
  });

  it('keeps Tab and Shift+Tab inside it, and leaves no trap after its close', () => {
    openDialog({ id: 'trap', title: 'Trap', content: twoButtons });
    const elem = getElem('trap');
    const close = elem.querySelector('.aekWindow__close') as HTMLElement;
    const last = elem.querySelector('.delete') as HTMLElement;
    last.focus();
    expect(dispatchKey(last, 'keydown', 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    dispatchKey(close, 'keydown', 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
    closeDraggableWindow('trap');
    expect(countListeners(elem, 'keydown')).toBe(0);
  });

  it('makes the rest of the HUD inert while open, the backdrop and the debugger’s roots aside', () => {
    openDraggableWindow({ id: 'behind', title: 'Behind', focusFirstElement: false });
    const behind = getElem('behind');
    const debuggerRoot = getHUDRootCMP().add({ attr: { [DEBUGGER_ROOT_ATTR]: '' } }).elem;
    openDialog({ id: 'pause', title: 'Paused' });
    const backdrop = getDraggableWindow('pause')!.backDropCMP!.elem;
    expect(behind.hasAttribute('inert')).toBe(true);
    expect(getElem('pause').hasAttribute('inert')).toBe(false);
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(debuggerRoot.hasAttribute('inert')).toBe(false);
    closeDraggableWindow('pause');
    expect(behind.hasAttribute('inert')).toBe(false);
    removeDraggableWindow('behind');
    debuggerRoot.remove();
  });

  it('stacks an app’s dialog above its windows and below the debugger, a debug one above all', () => {
    openDraggableWindow({ id: 'win', title: 'Window', focusFirstElement: false });
    openDialog({ id: 'appDialog', title: 'App' });
    expect(Number(getElem('win').style.zIndex)).toBeLessThan(Z_INDEX_BASES.DIALOG);
    expect(Number(getElem('appDialog').style.zIndex)).toBe(Z_INDEX_BASES.DIALOG);
    expect(Number(getDraggableWindow('appDialog')!.backDropCMP!.elem.style.zIndex)).toBe(
      Z_INDEX_BASES.DIALOG - 1
    );

    // A debug dialog (the debug env's) inerts the debugger's roots too
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    const debuggerRoot = getHUDRootCMP().add({ attr: { [DEBUGGER_ROOT_ATTR]: '' } }).elem;
    openDialog({ id: 'debugDialog', title: 'Keys', isDebugWindow: true });
    expect(Number(getElem('debugDialog').style.zIndex)).toBe(Z_INDEX_BASES.DEBUG_DIALOG);
    // A debugger root in the debugger's theme and the compact density (p806 D8), its backdrop too
    for (const elem of [
      getElem('debugDialog'),
      getDraggableWindow('debugDialog')!.backDropCMP!.elem,
    ]) {
      expect(elem.hasAttribute(DEBUGGER_ROOT_ATTR)).toBe(true);
      expect(elem.getAttribute('data-aek-theme')).toBe('dark');
      expect(elem.getAttribute('data-aek-density')).toBe('compact');
    }
    expect(getElem('appDialog').hasAttribute('data-aek-density')).toBe(false);
    expect(debuggerRoot.hasAttribute('inert')).toBe(true);
    expect(getElem('appDialog').hasAttribute('inert')).toBe(true);
    closeDraggableWindow('debugDialog');
    expect(debuggerRoot.hasAttribute('inert')).toBe(false);
    closeDraggableWindow('appDialog');
    removeDraggableWindow('win');
    debuggerRoot.remove();
  });

  it('has the z bases of the tokens', () => {
    const css = fs.readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
    const token = (name: string) => Number(css.match(new RegExp(`--aek-z-${name}: (\\d+);`))?.[1]);
    expect(Z_INDEX_BASES).toEqual({
      APP: token('window'),
      DIALOG: token('dialog'),
      DEBUG: token('debug-window'),
      DEBUG_DIALOG: token('debug-dialog'),
    });
  });
});
