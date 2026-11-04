import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
} from '../../testing/KitDom';
import { CMP } from '../../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import { createHotbar, type HotbarProps } from './Hotbar';
import type { GameItem } from './ItemTypes';

const SWORD: GameItem = { id: 'sword', name: 'Iron sword' };
const BOW: GameItem = { id: 'bow', name: 'Bow' };
const POTION: GameItem = { id: 'potion', name: 'Health potion', count: 3 };

/** A hotbar added to the HUD root */
const addHotbar = (props: Partial<HotbarProps> = {}) => {
  const hotbar = createHotbar({ slots: [SWORD, BOW, null, POTION], ...props });
  getHUDRootCMP().add(hotbar.cmp);
  return { hotbar, elem: hotbar.cmp.elem, slots: hotbar.slots.map((slot) => slot.cmp.elem) };
};

const getRegion = () =>
  [...getHUDRootCMP().elem.children].find((child) => child.getAttribute('role') === 'status');

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // The announcer's region outlives a test: its pending text is written before the fake clock goes
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('hotbar (p808 D11)', () => {
  it('is a named toolbar of slots with the number keys’ hints and one tab stop', () => {
    const { hotbar, elem, slots } = addHotbar({ selected: 1 });
    expect(elem.getAttribute('role')).toBe('toolbar');
    expect(elem.getAttribute('aria-label')).toBe('Hotbar');
    expect(elem.getAttribute('data-placement')).toBe('bottom');
    expect(elem.hasAttribute('aria-orientation')).toBe(false);
    expect(slots.map((slot) => slot.getAttribute('aria-keyshortcuts'))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(slots.map((slot) => slot.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    // The selected slot is the tab stop
    expect(slots.map((slot) => slot.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
    expect(hotbar.getSelected()).toBe(1);
    expect(hotbar.getSelectedItem()).toBe(BOW);
    hotbar.cmp.remove();
  });

  it('is an ability bar of plain buttons without a selection, until the first select', () => {
    const { hotbar, slots } = addHotbar({ keyHints: ['Q', null, { cmp: CMP({ text: 'E' }) }] });
    expect(slots.some((slot) => slot.hasAttribute('aria-pressed'))).toBe(false);
    expect(slots.map((slot) => slot.getAttribute('aria-keyshortcuts'))).toEqual([
      'Q',
      null,
      null,
      null,
    ]);
    expect(slots[2].querySelector('.aekItemSlot__key')?.textContent).toBe('E');
    expect(slots[0].getAttribute('tabindex')).toBe('0');
    hotbar.select(2);
    expect(slots.map((slot) => slot.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    hotbar.cmp.remove();
    const plain = addHotbar({ keyHints: false });
    expect(plain.elem.querySelector('.aekItemSlot__key')).toBeNull();
    plain.hotbar.cmp.remove();
  });

  it('moves the focus with the arrows round, Home and End, kept from the window', () => {
    const { hotbar, slots } = addHotbar({ selected: 0 });
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    slots[0].focus();
    expect(dispatchKey(slots[0], 'keydown', 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(slots[1]);
    expect(slots[1].getAttribute('tabindex')).toBe('0');
    expect(slots[0].getAttribute('tabindex')).toBe('-1');
    dispatchKey(slots[1], 'keydown', 'ArrowLeft');
    dispatchKey(slots[0], 'keydown', 'ArrowLeft');
    expect(document.activeElement).toBe(slots[3]);
    dispatchKey(slots[3], 'keydown', 'Home');
    expect(document.activeElement).toBe(slots[0]);
    dispatchKey(slots[0], 'keydown', 'End');
    expect(document.activeElement).toBe(slots[3]);
    // The other axis isn't the bar's
    expect(dispatchKey(slots[3], 'keydown', 'ArrowDown').defaultPrevented).toBe(false);
    expect(onWindowKey).toHaveBeenCalledTimes(1);
    // Moving the focus selects nothing
    expect(hotbar.getSelected()).toBe(0);
    window.removeEventListener('keydown', onWindowKey);
    hotbar.cmp.remove();
  });

  it('takes the vertical arrows when vertical', () => {
    const { hotbar, elem, slots } = addHotbar({ orientation: 'vertical', placement: 'inline' });
    expect(elem.getAttribute('aria-orientation')).toBe('vertical');
    expect(elem.getAttribute('data-placement')).toBe('inline');
    slots[0].focus();
    dispatchKey(slots[0], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(slots[1]);
    hotbar.cmp.remove();
  });

  it('calls onUse on a click, Enter and Space staying the button’s and off the action maps', () => {
    const onUse = vi.fn();
    const { hotbar, slots } = addHotbar({ onUse });
    dispatchPointer(slots[3].querySelector('.aekItemSlot__icon') as Element, 'click');
    expect(onUse).toHaveBeenCalledWith(3, POTION);
    dispatchPointer(slots[2], 'click');
    expect(onUse).toHaveBeenLastCalledWith(2, null);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const space = dispatchKey(slots[0], 'keydown', ' ');
    expect(space.defaultPrevented).toBe(false);
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
    hotbar.cmp.remove();
  });

  it('selects round with selectNext, writes nothing when unchanged, and announces from afar', () => {
    const { hotbar, slots } = addHotbar();
    hotbar.selectNext(-1);
    expect(hotbar.getSelected()).toBe(3);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Health potion selected');
    hotbar.selectNext(1);
    expect(hotbar.getSelected()).toBe(0);
    hotbar.selectNext(2);
    expect(hotbar.getSelected()).toBe(2);
    expect(slots[2].getAttribute('tabindex')).toBe('0');
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Empty slot selected');
    hotbar.selectNext(0.5);
    expect(hotbar.getSelected()).toBe(2);
    slots[2].setAttribute('aria-pressed', 'marked');
    hotbar.select(2);
    expect(slots[2].getAttribute('aria-pressed')).toBe('marked');
    // With the focus on the bar: no announcement, the tab stop where the player is
    slots[0].focus();
    vi.advanceTimersByTime(100);
    hotbar.select(1);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Empty slot selected');
    expect(slots[0].getAttribute('tabindex')).toBe('0');
    hotbar.select(-1);
    expect(hotbar.getSelectedItem()).toBeNull();
    expect(slots.filter((slot) => slot.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
    hotbar.cmp.remove();
  });

  it('sets a slot’s item, runs its cooldowns and leaves no listener or timer after removal', () => {
    const onCooldownReady = vi.fn();
    const { hotbar, elem, slots } = addHotbar({ cooldowns: true, onCooldownReady });
    hotbar.setItem(2, SWORD);
    expect(slots[2].querySelector('.aekItemSlot__spoken')?.textContent).toBe('Iron sword');
    hotbar.slots[1].cooldown?.start(1000);
    vi.advanceTimersByTime(1000);
    expect(onCooldownReady).toHaveBeenCalledWith(1);
    hotbar.slots[1].cooldown?.start(1000);
    hotbar.cmp.remove();
    expect(countListeners(elem)).toBe(0);
    expect(slots.every((slot) => countListeners(slot) === 0)).toBe(true);
    vi.runAllTimers();
    expect(onCooldownReady).toHaveBeenCalledTimes(1);
  });
});
