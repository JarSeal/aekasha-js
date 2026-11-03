import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
} from '../../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import { createInventoryGrid, type InventoryGridProps } from './InventoryGrid';
import { createItemDragGroup } from './ItemDragGroup';
import type { GameItem } from './ItemTypes';

const SWORD: GameItem = { id: 'sword', name: 'Iron sword' };
const BOW: GameItem = { id: 'bow', name: 'Bow' };
const POTION: GameItem = { id: 'potion', name: 'Health potion', count: 3 };

/** A 3 × 2 grid added to the HUD root */
const addGrid = (props: Partial<InventoryGridProps> = {}) => {
  const grid = createInventoryGrid({
    label: 'Bag',
    columns: 3,
    rows: 2,
    items: [SWORD, BOW, null, POTION],
    ...props,
  });
  getHUDRootCMP().add(grid.cmp);
  return { grid, elem: grid.cmp.elem, slots: grid.slots.map((slot) => slot.cmp.elem) };
};

const click = (target: Element) => dispatchPointer(target, 'click');

const getRegion = () =>
  [...getHUDRootCMP().elem.children].find((child) => child.getAttribute('role') === 'status');

/** What the announcer reads after its delay */
const readAnnouncement = () => {
  vi.advanceTimersByTime(50);
  return getRegion()?.textContent;
};

const getGhost = () => getHUDRootCMP().elem.querySelector('.aekInventoryGrid__ghost');

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

describe('inventory grid (p808 D11)', () => {
  it('is a named grid of rows of cells holding slots, one tab stop', () => {
    const { grid, elem, slots } = addGrid();
    expect(elem.getAttribute('role')).toBe('grid');
    expect(elem.getAttribute('aria-label')).toBe('Bag');
    const rows = [...elem.children];
    expect(rows.map((row) => row.getAttribute('role'))).toEqual(['row', 'row']);
    expect(rows[0].children[0].getAttribute('role')).toBe('gridcell');
    expect(rows[0].children[0].firstElementChild).toBe(slots[0]);
    expect(slots).toHaveLength(6);
    expect(slots.map((slot) => slot.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
    ]);
    expect(grid.getItem(3)).toBe(POTION);
    expect(grid.getItem(5)).toBeNull();
    // Plain buttons, not toggles
    expect(slots[0].hasAttribute('aria-pressed')).toBe(false);
    grid.setItems([null, SWORD]);
    expect(grid.getItem(0)).toBeNull();
    expect(grid.getItem(3)).toBeNull();
    grid.cmp.remove();
  });

  it('moves the focus by row and column, leaving an edge’s arrow to what’s around it', () => {
    const { grid, slots } = addGrid();
    grid.focus();
    expect(document.activeElement).toBe(slots[0]);
    expect(dispatchKey(slots[0], 'keydown', 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(slots[1]);
    dispatchKey(slots[1], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(slots[4]);
    expect(slots[4].getAttribute('tabindex')).toBe('0');
    expect(slots[1].getAttribute('tabindex')).toBe('-1');
    // The edges: not used
    expect(dispatchKey(slots[4], 'keydown', 'ArrowDown').defaultPrevented).toBe(false);
    dispatchKey(slots[4], 'keydown', 'Home');
    expect(document.activeElement).toBe(slots[3]);
    expect(dispatchKey(slots[3], 'keydown', 'ArrowLeft').defaultPrevented).toBe(false);
    dispatchKey(slots[3], 'keydown', 'End');
    expect(document.activeElement).toBe(slots[5]);
    expect(dispatchKey(slots[5], 'keydown', 'ArrowRight').defaultPrevented).toBe(false);
    dispatchKey(slots[5], 'keydown', 'Home', { ctrlKey: true });
    expect(document.activeElement).toBe(slots[0]);
    dispatchKey(slots[0], 'keydown', 'End', { ctrlKey: true });
    expect(document.activeElement).toBe(slots[5]);
    expect(dispatchKey(slots[5], 'keydown', 'ArrowUp', { shiftKey: true }).defaultPrevented).toBe(
      false
    );
    // Enter and Space: the slot's own click, kept from the window
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    expect(dispatchKey(slots[5], 'keydown', 'Enter').defaultPrevented).toBe(false);
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
    grid.focus(2);
    expect(document.activeElement).toBe(slots[2]);
    grid.cmp.remove();
  });

  it('picks up and drops by click or Enter, describing every slot while held', () => {
    const onMove = vi.fn();
    const { grid, slots } = addGrid({ onMove });
    slots[0].focus();
    click(slots[0]);
    expect(grid.group.isHolding()).toBe(true);
    expect(grid.group.getHeld()).toEqual({ item: SWORD, grid, index: 0 });
    expect(slots[0].hasAttribute('data-held')).toBe(true);
    expect(getGhost()).not.toBeNull();
    expect(readAnnouncement()).toBe(
      'Iron sword picked up. Choose a slot and press Enter to drop it, or Escape to put it back'
    );
    const describedBy = slots[4].getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Holding Iron sword');
    // The focus on another slot makes it the target
    dispatchKey(slots[0], 'keydown', 'ArrowRight');
    dispatchKey(slots[1], 'keydown', 'ArrowRight');
    expect(slots[2].getAttribute('data-drop-target')).toBe('allowed');
    dispatchKey(slots[2], 'keydown', 'ArrowDown');
    expect(slots[2].hasAttribute('data-drop-target')).toBe(false);
    expect(slots[5].getAttribute('data-drop-target')).toBe('allowed');
    click(slots[5]);
    expect(onMove).toHaveBeenCalledWith({
      item: SWORD,
      target: null,
      kind: 'move',
      from: grid,
      fromIndex: 0,
      to: grid,
      toIndex: 5,
    });
    expect(readAnnouncement()).toBe('Iron sword moved to row 2, column 3');
    expect(grid.group.isHolding()).toBe(false);
    expect(slots[0].hasAttribute('data-held')).toBe(false);
    expect(slots[5].hasAttribute('data-drop-target')).toBe(false);
    expect(slots.some((slot) => slot.hasAttribute('aria-describedby'))).toBe(false);
    expect(getGhost()).toBeNull();
    // The grid moved nothing itself
    expect(grid.getItem(0)).toBe(SWORD);
    // An empty slot picks nothing up
    click(slots[2]);
    expect(grid.group.isHolding()).toBe(false);
    grid.cmp.remove();
  });

  it('swaps, merges a stack, and keeps a vetoed item held', () => {
    const onMove = vi.fn();
    const canMove = vi.fn(({ toIndex }: { toIndex: number }) => toIndex !== 2);
    const { grid, slots } = addGrid({
      onMove,
      canMove,
      items: [SWORD, BOW, null, POTION, { ...POTION, count: 2 }],
    });
    click(slots[0]);
    click(slots[1]);
    expect(onMove.mock.lastCall?.[0]).toMatchObject({ kind: 'swap', target: BOW });
    expect(readAnnouncement()).toBe('Iron sword swapped with Bow');
    click(slots[3]);
    click(slots[4]);
    expect(onMove.mock.lastCall?.[0]).toMatchObject({ kind: 'merge', fromIndex: 3, toIndex: 4 });
    expect(readAnnouncement()).toBe('Health potion stacked');
    click(slots[0]);
    slots[2].focus();
    expect(slots[2].getAttribute('data-drop-target')).toBe('blocked');
    onMove.mockClear();
    click(slots[2]);
    expect(onMove).not.toHaveBeenCalled();
    expect(grid.group.isHolding()).toBe(true);
    expect(readAnnouncement()).toBe("Iron sword can't go there");
    grid.cmp.remove();
  });

  it('puts the item back on Escape, a click on its own slot and cancel()', () => {
    const { grid, slots } = addGrid();
    slots[0].focus();
    click(slots[0]);
    slots[4].focus();
    expect(dispatchKey(slots[4], 'keydown', 'Escape').defaultPrevented).toBe(true);
    expect(grid.group.isHolding()).toBe(false);
    expect(document.activeElement).toBe(slots[0]);
    expect(readAnnouncement()).toBe('Iron sword put back');
    click(slots[1]);
    click(slots[1]);
    expect(grid.group.isHolding()).toBe(false);
    click(slots[1]);
    grid.group.cancel();
    expect(grid.group.isHolding()).toBe(false);
    expect(getGhost()).toBeNull();
    // No entry left: Escape goes on
    expect(dispatchKey(slots[1], 'keydown', 'Escape').defaultPrevented).toBe(false);
    grid.cmp.remove();
  });

  it('moves between the grids of a group, reported to the grid it lands in', () => {
    const group = createItemDragGroup();
    const onChestMove = vi.fn();
    const onBagMove = vi.fn();
    const chest = addGrid({ label: 'Chest', group, onMove: onChestMove });
    const bag = addGrid({ label: 'Bag', group, onMove: onBagMove, items: [] });
    expect(bag.grid.group).toBe(group);
    click(chest.slots[1]);
    bag.slots[3].focus();
    expect(bag.slots[3].getAttribute('data-drop-target')).toBe('allowed');
    // Every grid's slots say what's held
    expect(bag.slots[0].getAttribute('aria-describedby')).toBeTruthy();
    click(bag.slots[3]);
    expect(onChestMove).not.toHaveBeenCalled();
    expect(onBagMove).toHaveBeenCalledWith(
      expect.objectContaining({ item: BOW, from: chest.grid, fromIndex: 1, to: bag.grid })
    );
    expect(readAnnouncement()).toBe('Bow moved to Bag, row 2, column 1');
    // The grid an item is held from goes: the hold ends
    click(bag.slots[3]);
    click(chest.slots[0]);
    expect(group.isHolding()).toBe(true);
    chest.grid.cmp.remove();
    bag.grid.cmp.remove();
    click(chest.slots[1]);
    expect(group.isHolding()).toBe(false);
  });

  it('drags with the pointer: a ghost, the target under it, the click after ignored', () => {
    const onMove = vi.fn();
    const { grid, slots } = addGrid({ onMove });
    let under: Element | null = null;
    const elementFromPoint = vi.fn(() => under);
    vi.stubGlobal('document', Object.assign(document, { elementFromPoint }));
    dispatchPointer(slots[1], 'pointerdown', { clientX: 10, clientY: 10 });
    expect(countListeners(window, 'pointermove')).toBe(1);
    // Under the threshold: still a click
    dispatchPointer(window, 'pointermove', { clientX: 12, clientY: 10 });
    expect(grid.group.isHolding()).toBe(false);
    under = slots[2].querySelector('.aekItemSlot__icon');
    dispatchPointer(window, 'pointermove', { clientX: 90, clientY: 10 });
    expect(grid.group.isHolding()).toBe(true);
    expect(slots[1].hasAttribute('data-held')).toBe(true);
    expect((getGhost() as HTMLElement).style.transform).toContain('translate3d(');
    expect(slots[2].getAttribute('data-drop-target')).toBe('allowed');
    expect(readAnnouncement()).toBe('Bow picked up');
    dispatchPointer(slots[2], 'pointerup', { clientX: 90, clientY: 10 });
    expect(onMove.mock.lastCall?.[0]).toMatchObject({ kind: 'move', fromIndex: 1, toIndex: 2 });
    // The click the release makes: not a pick
    click(slots[2]);
    expect(grid.group.isHolding()).toBe(false);
    expect(countListeners(window, 'pointermove')).toBe(0);
    // Released over nothing: put back
    onMove.mockClear();
    dispatchPointer(slots[0], 'pointerdown');
    under = null;
    dispatchPointer(window, 'pointermove', { clientX: 40, clientY: 40 });
    dispatchPointer(window, 'pointerup', { clientX: 40, clientY: 40 });
    expect(onMove).not.toHaveBeenCalled();
    expect(grid.group.isHolding()).toBe(false);
    // Escape mid-drag puts it back, and the release after picks nothing
    dispatchPointer(slots[0], 'pointerdown');
    dispatchPointer(window, 'pointermove', { clientX: 40, clientY: 40 });
    slots[0].focus();
    dispatchKey(slots[0], 'keydown', 'Escape');
    expect(grid.group.isHolding()).toBe(false);
    dispatchPointer(window, 'pointerup', { clientX: 40, clientY: 40 });
    vi.runAllTimers();
    expect(grid.group.isHolding()).toBe(false);
    expect(countListeners(window, 'pointerup')).toBe(0);
    grid.cmp.remove();
  });

  it('leaves no listener, ghost or entry after its removal mid-drag', () => {
    const { grid, elem, slots } = addGrid();
    dispatchPointer(slots[0], 'pointerdown');
    dispatchPointer(window, 'pointermove', { clientX: 40, clientY: 40 });
    expect(getGhost()).not.toBeNull();
    grid.cmp.remove();
    expect(getGhost()).toBeNull();
    expect(countListeners(elem)).toBe(0);
    expect(countListeners(window, 'pointermove')).toBe(0);
    const opener = document.createElement('button');
    getHUDRootCMP().elem.append(opener);
    expect(dispatchKey(opener, 'keydown', 'Escape').defaultPrevented).toBe(false);
    opener.remove();
  });
});
