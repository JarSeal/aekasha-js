import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createPopover } from './Popover';

let trigger: HTMLButtonElement;
let elsewhere: HTMLButtonElement;

/** A panel with two buttons, built on every open */
const createContent = vi.fn(() => {
  const panel = CMP({ class: 'panel' });
  panel.add({ tag: 'button', text: 'First' });
  panel.add({ tag: 'button', text: 'Second' });
  return panel;
});

const create = () => createPopover({ anchor: trigger, label: 'Filters', content: createContent });

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  trigger = document.createElement('button');
  elsewhere = document.createElement('button');
  getHUDRootCMP().elem.append(trigger, elsewhere);
  createContent.mockClear();
});

afterEach(() => {
  trigger.remove();
  elsewhere.remove();
});

describe('popover (p803 D10)', () => {
  it('gives its trigger the ARIA, and a click opens it with the focus in', () => {
    const popover = create();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(popover.cmp.id);

    trigger.focus();
    trigger.click();
    expect(popover.isOpen()).toBe(true);
    expect(popover.cmp.elem.parentElement).toBe(getHUDRootCMP().elem);
    expect(popover.cmp.elem.getAttribute('role')).toBe('dialog');
    expect(popover.cmp.elem.getAttribute('aria-label')).toBe('Filters');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('First');
    expect(createContent).toHaveBeenCalledTimes(1);

    // The trigger's click closes it again, and the content goes with it
    trigger.click();
    expect(popover.isOpen()).toBe(false);
    expect(popover.cmp.elem.isConnected).toBe(false);
    expect(popover.cmp.elem.children).toHaveLength(0);
    popover.cmp.remove();
  });

  it('closes on Escape, the press goes no further, and the focus is back on the trigger', () => {
    const popover = create();
    trigger.click();
    const binding = vi.fn();
    window.addEventListener('keydown', binding);
    dispatchKey(document.activeElement as HTMLElement, 'keydown', 'Escape');
    window.removeEventListener('keydown', binding);
    dispatchKey(trigger, 'keyup', 'Escape');
    expect(popover.isOpen()).toBe(false);
    expect(binding).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    popover.cmp.remove();
  });

  it('closes on a press outside it, or the focus leaving it, and leaves the focus there', () => {
    const popover = create();
    trigger.click();
    // A press on the trigger isn't outside: its click toggles
    trigger.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(popover.isOpen()).toBe(true);
    elsewhere.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(popover.isOpen()).toBe(false);

    popover.open();
    elsewhere.focus();
    expect(popover.isOpen()).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
    popover.cmp.remove();
  });

  it('removed, leaves no listener and no ARIA on its trigger', () => {
    const popover = create();
    popover.open();
    popover.cmp.remove();
    expect(popover.cmp.elem.isConnected).toBe(false);
    expect(countListeners(trigger)).toBe(0);
    expect(countListeners(document, 'pointerdown')).toBe(0);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
  });

  it('keeps a CMP given as its content across opens', () => {
    const content = CMP({ tag: 'button', text: 'Kept' });
    const popover = createPopover({ anchor: trigger, content });
    popover.open();
    popover.close();
    popover.open();
    expect(popover.cmp.elem.firstElementChild).toBe(content.elem);
    popover.cmp.remove();
  });
});
