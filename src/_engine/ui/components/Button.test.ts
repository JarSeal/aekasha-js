import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createButton, type ButtonProps } from './Button';
import { createKbd } from './Kbd';

const HOLD_MS = 800;

const click = (target: EventTarget) => target.dispatchEvent(new window.Event('click'));
const pointer = (target: EventTarget, type: string, button = 0) =>
  target.dispatchEvent(Object.assign(new window.Event(type), { button, pointerId: 1 }));

/** A button added to the HUD root (so it's in the document) */
const addButton = (props: ButtonProps) => {
  const button = createButton(props);
  getHUDRootCMP().add(button.cmp);
  return button;
};

const getParts = (elem: HTMLElement) => [...elem.children].map((child) => child.className);

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('button (p803 D10)', () => {
  it('is a native button with its label, variant and size, and its id only when given', () => {
    const { cmp } = addButton({ label: 'Save', class: 'mine' });
    const elem = cmp.elem;
    expect(elem.tagName).toBe('BUTTON');
    expect(elem.getAttribute('type')).toBe('button');
    expect(elem.className).toBe('aekButton mine');
    expect(elem.getAttribute('data-variant')).toBe('secondary');
    expect(elem.getAttribute('data-size')).toBe('md');
    expect(elem.querySelector('.aekButton__label')?.textContent).toBe('Save');
    expect(elem.hasAttribute('id')).toBe(false);
    expect(elem.hasAttribute('aria-pressed')).toBe(false);
    cmp.remove();
    const withId = addButton({ label: 'Go', id: 'goButton', variant: 'primary', size: 'lg' });
    expect(withId.cmp.elem.id).toBe('goButton');
    expect(withId.cmp.elem.getAttribute('data-variant')).toBe('primary');
    expect(withId.cmp.elem.getAttribute('data-size')).toBe('lg');
    withId.cmp.remove();
  });

  it('puts the icon on its side; icon only, the label is its name and its tooltip', () => {
    const start = addButton({ label: 'Undo', icon: '<svg></svg>' });
    expect(getParts(start.cmp.elem)).toEqual(['aekButton__icon', 'aekButton__label']);
    expect(start.cmp.elem.querySelector('.aekButton__icon')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    start.cmp.remove();
    const end = addButton({ label: 'Next', icon: '<svg></svg>', iconPosition: 'end' });
    expect(getParts(end.cmp.elem)).toEqual(['aekButton__label', 'aekButton__icon']);
    end.cmp.remove();

    const only = addButton({ label: 'Settings', icon: '<svg></svg>', iconOnly: true });
    const elem = only.cmp.elem;
    expect(getParts(elem)).toEqual(['aekButton__icon']);
    expect(elem.getAttribute('aria-label')).toBe('Settings');
    expect(elem.hasAttribute('data-icon-only')).toBe(true);
    // Its tooltip repeats the name, so it describes nothing (the tooltip's rule)
    expect(elem.hasAttribute('aria-describedby')).toBe(false);
    expect(countListeners(elem, 'pointerenter')).toBe(1);
    only.setLabel('Preferences');
    expect(elem.getAttribute('aria-label')).toBe('Preferences');
    only.cmp.remove();
    expect(countListeners(elem)).toBe(0);
  });

  it('describes itself with a tooltip, and shows a Kbd it names in aria-keyshortcuts (p804 D13)', () => {
    const kbd = createKbd({ keys: 'Ctrl+S' });
    const removeKbd = vi.spyOn(kbd.cmp, 'remove');
    const { cmp } = addButton({ label: 'Save', tooltip: 'Saves the scene', kbd });
    const elem = cmp.elem;
    expect(elem.getAttribute('aria-describedby')).toMatch(/\S/);
    expect(elem.getAttribute('aria-keyshortcuts')).toBe('Control+S');
    expect(getParts(elem)).toEqual(['aekButton__label', 'aekKbd aekButton__kbd']);
    expect(kbd.cmp.elem.tagName).toBe('KBD');
    expect(kbd.cmp.elem.getAttribute('aria-hidden')).toBe('true');
    kbd.setKeys('Ctrl+Shift+S');
    expect(elem.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+S');
    cmp.remove();
    expect(elem.hasAttribute('aria-describedby')).toBe(false);
    expect(removeKbd).toHaveBeenCalledTimes(1);
    // Its keys' listener went with it
    kbd.setKeys('F5');
    expect(elem.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+S');
  });

  it('draws a string kbd (deprecated) once Kbd has loaded, before a hold’s fill', async () => {
    const { cmp } = addButton({ label: 'Delete', kbd: 'Del', holdToConfirmMs: HOLD_MS });
    const elem = cmp.elem;
    expect(elem.querySelector('.aekButton__kbd')).toBeNull();
    await vi.dynamicImportSettled();
    expect(getParts(elem)).toEqual([
      'aekButton__label',
      'aekKbd aekButton__kbd',
      'aekButton__hold',
      'aekButton__holdText',
    ]);
    expect(elem.getAttribute('aria-keyshortcuts')).toBe('Delete');
    cmp.remove();

    // Removed before Kbd loaded: nothing is drawn
    const early = addButton({ label: 'Save', kbd: 'Ctrl+S' });
    early.cmp.remove();
    await vi.dynamicImportSettled();
    expect(getParts(early.cmp.elem)).toEqual(['aekButton__label']);
    expect(early.cmp.elem.hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('clicks; while loading it is busy and ignores them; disabled it is disabled', () => {
    const onClick = vi.fn();
    const button = addButton({ label: 'Save', onClick });
    const elem = button.cmp.elem;
    click(elem);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.setLoading(true);
    expect(button.isLoading()).toBe(true);
    expect(elem.getAttribute('aria-busy')).toBe('true');
    click(elem);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.setLoading(false);
    expect(elem.hasAttribute('aria-busy')).toBe(false);
    click(elem);
    expect(onClick).toHaveBeenCalledTimes(2);
    button.setDisabled(true);
    expect(elem.hasAttribute('disabled')).toBe(true);
    button.setDisabled(false);
    expect(elem.hasAttribute('disabled')).toBe(false);
    button.cmp.remove();
  });

  it('focusable when disabled: aria-disabled, its clicks ignored, its reason the tooltip (p806 D7)', () => {
    const onClick = vi.fn();
    const onPressedChange = vi.fn();
    const button = addButton({
      label: 'Pause',
      icon: '<svg></svg>',
      iconOnly: true,
      pressed: false,
      focusableWhenDisabled: true,
      onClick,
      onPressedChange,
    });
    const elem = button.cmp.elem;
    button.setDisabled(true, 'Loading the scene…');
    expect(button.isDisabled()).toBe(true);
    expect(elem.getAttribute('aria-disabled')).toBe('true');
    expect(elem.hasAttribute('disabled')).toBe(false);
    // The reason isn't the name: it describes the button
    expect(elem.getAttribute('aria-describedby')).toMatch(/\S/);
    elem.focus();
    expect(document.activeElement).toBe(elem);
    click(elem);
    expect(onClick).not.toHaveBeenCalled();
    expect(onPressedChange).not.toHaveBeenCalled();
    expect(elem.getAttribute('aria-pressed')).toBe('false');
    button.setDisabled(false);
    expect(elem.hasAttribute('aria-disabled')).toBe(false);
    // The label is the tooltip again, which describes nothing
    expect(elem.hasAttribute('aria-describedby')).toBe(false);
    click(elem);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(elem.getAttribute('aria-pressed')).toBe('true');
    button.cmp.remove();

    const created = addButton({ label: 'Undo', disabled: true, focusableWhenDisabled: true });
    expect(created.cmp.elem.getAttribute('aria-disabled')).toBe('true');
    // A reason gives a button with no tooltip one, and enabling it takes it away
    created.setDisabled(true, 'Nothing to undo');
    expect(countListeners(created.cmp.elem, 'pointerenter')).toBe(1);
    created.setDisabled(false);
    expect(countListeners(created.cmp.elem, 'pointerenter')).toBe(0);
    created.cmp.remove();
  });

  it('as a toggle, a click flips aria-pressed and reports it; setPressed only writes it', () => {
    const onPressedChange = vi.fn();
    const onClick = vi.fn();
    const button = addButton({ label: 'Mute', pressed: false, onPressedChange, onClick });
    const elem = button.cmp.elem;
    expect(elem.getAttribute('aria-pressed')).toBe('false');
    click(elem);
    expect(elem.getAttribute('aria-pressed')).toBe('true');
    expect(button.isPressed()).toBe(true);
    expect(onPressedChange).toHaveBeenCalledWith(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.setPressed(false);
    expect(elem.getAttribute('aria-pressed')).toBe('false');
    expect(onPressedChange).toHaveBeenCalledTimes(1);
    button.cmp.remove();
  });

  it('holds to confirm with the pointer: an early release cancels, a click does nothing', () => {
    const onClick = vi.fn();
    const button = addButton({ label: 'Delete', holdToConfirmMs: HOLD_MS, onClick });
    const elem = button.cmp.elem;
    const description = document.getElementById(elem.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Hold to confirm');
    expect(description?.hasAttribute('hidden')).toBe(true);
    expect(elem.querySelector('.aekButton__hold')?.getAttribute('aria-hidden')).toBe('true');

    pointer(elem, 'pointerdown');
    expect(elem.getAttribute('data-holding')).toBe('filling');
    vi.advanceTimersByTime(HOLD_MS - 1);
    pointer(elem, 'pointerup');
    click(elem);
    expect(elem.hasAttribute('data-holding')).toBe(false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(onClick).not.toHaveBeenCalled();

    pointer(elem, 'pointerdown', 2); // Not the primary button
    expect(elem.hasAttribute('data-holding')).toBe(false);

    pointer(elem, 'pointerdown');
    vi.advanceTimersByTime(HOLD_MS);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(elem.getAttribute('data-holding')).toBe('confirmed');
    pointer(elem, 'pointerup');
    click(elem);
    expect(elem.hasAttribute('data-holding')).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.cmp.remove();
  });

  it('holds to confirm with Space or Enter, their repeats ignored and no click from them', () => {
    const onClick = vi.fn();
    const button = addButton({ label: 'Delete', holdToConfirmMs: HOLD_MS, onClick });
    const elem = button.cmp.elem;
    elem.focus();
    expect(dispatchKey(elem, 'keydown', 'Enter').defaultPrevented).toBe(true);
    vi.advanceTimersByTime(HOLD_MS / 2);
    dispatchKey(elem, 'keydown', 'Enter', { repeat: true });
    vi.advanceTimersByTime(HOLD_MS / 2);
    expect(onClick).toHaveBeenCalledTimes(1);
    dispatchKey(elem, 'keyup', 'Enter');
    expect(elem.hasAttribute('data-holding')).toBe(false);

    dispatchKey(elem, 'keydown', ' ');
    vi.advanceTimersByTime(HOLD_MS / 2);
    elem.blur();
    vi.advanceTimersByTime(HOLD_MS);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(dispatchKey(elem, 'keydown', 'a').defaultPrevented).toBe(false);
    button.cmp.remove();
  });

  it('calls onUnheldClick for a click no press started, never after a press or while loading', () => {
    const onClick = vi.fn();
    const onUnheldClick = vi.fn();
    const button = addButton({ label: 'Delete', holdToConfirmMs: HOLD_MS, onClick, onUnheldClick });
    const elem = button.cmp.elem;
    // Assistive tech's click, with no press
    click(elem);
    expect(onUnheldClick).toHaveBeenCalledTimes(1);

    // A pointer's release clicks after its press
    pointer(elem, 'pointerdown');
    vi.advanceTimersByTime(HOLD_MS - 1);
    pointer(elem, 'pointerup');
    click(elem);
    expect(onUnheldClick).toHaveBeenCalledTimes(1);

    // No click follows a cancel or a held key, so the next one is unheld
    pointer(elem, 'pointerdown');
    pointer(elem, 'pointercancel');
    click(elem);
    expect(onUnheldClick).toHaveBeenCalledTimes(2);
    elem.focus();
    dispatchKey(elem, 'keydown', ' ');
    dispatchKey(elem, 'keyup', ' ');
    click(elem);
    expect(onUnheldClick).toHaveBeenCalledTimes(3);

    button.setLoading(true);
    click(elem);
    expect(onUnheldClick).toHaveBeenCalledTimes(3);
    expect(onClick).not.toHaveBeenCalled();
    button.cmp.remove();
  });

  it('leaves no timer or listener after its removal, mid-hold', () => {
    const onClick = vi.fn();
    const button = addButton({ label: 'Delete', holdToConfirmMs: HOLD_MS, onClick });
    const elem = button.cmp.elem;
    pointer(elem, 'pointerdown');
    button.cmp.remove();
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onClick).not.toHaveBeenCalled();
    expect(countListeners(elem)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
