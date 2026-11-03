// The item moves the inventory grids share (p808 D11): one held item for every grid of a group, so
// an item picked up in the chest drops in the bag. A pick and a drop by a click, Enter or Space
// (a gamepad's SOUTH clicks the focused slot), or a pointer drag with a ghost under the pointer;
// Escape puts it back. The grids are its hosts: each registers what the group reads through it.
// `createItemDragGroup` is one closure over 150 lines: the hold, the press and the ghost are one
// state every step reads and ends together, as the list's reorder keeps its drag.
import type { GameItem } from './ItemTypes';
import type { InventoryGrid } from './InventoryGrid';
import { announce } from '../../components/Announcer';
import { getHUDRootCMP, hasHudRoot } from '../../core/HUD';
import { pushOverlay } from '../../overlays/OverlayStack';

/** How far (px) a press moves before it's a drag, not a click */
const DRAG_THRESHOLD = 4;

/** A move of an item from one slot to another, in one grid or between two of a group. */
export type InventoryMove = {
  /** The item moved */
  item: GameItem;
  /** What was in the slot it lands on (null: empty) */
  target: GameItem | null;
  /** `'move'` into an empty slot, `'swap'` with the target, `'merge'` onto a stack of the same id
   * (the item has a `count`): the app adds the counts and keeps any rest where it came from. */
  kind: 'move' | 'swap' | 'merge';
  /** The grid it comes from */
  from: InventoryGrid;
  /** Its slot there */
  fromIndex: number;
  /** The grid it lands in (`from` itself for a move inside one grid) */
  to: InventoryGrid;
  /** Its slot there */
  toIndex: number;
};

/** The item a group holds: picked up and not dropped yet. */
export type HeldItem = {
  /** The item */
  item: GameItem;
  /** The grid it was picked up from */
  grid: InventoryGrid;
  /** Its slot there */
  index: number;
};

/** A drag group {@link createItemDragGroup} made: give it to each grid as its `group`. */
export type ItemDragGroup = {
  /** Puts a held item back where it came from (a gamepad's `EAST`; Escape does it too). */
  cancel: () => void;
  /** Whether an item is held */
  isHolding: () => boolean;
  /** The item held, or null */
  getHeld: () => HeldItem | null;
};

/**
 * What a grid gives its group.
 * @internal
 */
export type ItemDragHost = {
  /** The grid's element */
  elem: HTMLElement;
  /** Its handle, for the moves */
  grid: InventoryGrid;
  /** Its name, said when an item lands in it from another grid */
  label: string;
  /** Its slots' elements, by index */
  getSlots: () => readonly HTMLElement[];
  /** The item in a slot */
  getItem: (index: number) => GameItem | null;
  /** A slot's place, as it's said ('row 2, column 3') */
  describe: (index: number) => string;
  /** The grid's veto */
  canMove?: (move: InventoryMove) => boolean;
  /** The grid's report of a move that lands in it */
  onMove?: (move: InventoryMove) => void;
};

/**
 * A group as its grids use it.
 * @internal
 */
export type ItemDragGroupImpl = {
  /** Adds a grid; returns its remover (a held item of its own put back) */
  register: (host: ItemDragHost) => () => void;
  /** A slot's click, Enter or Space: picks its item up, or drops the held one there */
  activate: (host: ItemDragHost, index: number) => void;
  /** The slot the focus or the mouse is on while an item is held: marked as a drop's target */
  setTarget: (host: ItemDragHost, index: number) => void;
  /** A press on a slot: a drag once it moves */
  pointerDown: (host: ItemDragHost, index: number, e: PointerEvent) => void;
  /** Whether a click is the end of a drag (the grid ignores it) */
  takeClick: () => boolean;
};

const impls = new WeakMap<ItemDragGroup, ItemDragGroupImpl>();

/**
 * The code of a group, for its grids.
 * @internal
 */
export const useItemDragGroup = (group: ItemDragGroup) => impls.get(group) as ItemDragGroupImpl;

type Held = HeldItem & { host: ItemDragHost; isDragging: boolean };

type Press = {
  host: ItemDragHost;
  index: number;
  pointerId: number;
  startX: number;
  startY: number;
  isStarted: boolean;
};

let descriptionCount = 0;

/**
 * Creates a drag group (p808 D11): the grids given it share one held item, so an item moves between
 * them (a chest and the bag, the equipment's slots and the backpack), by the pointer, the keys or a
 * gamepad. A grid without a group has one of its own. The move is reported to the grid it lands
 * in (its `onMove`, vetoed by its `canMove`).
 * @example
 * ```ts
 * import { createInventoryGrid, createItemDragGroup } from 'aekasha/ui';
 *
 * const group = createItemDragGroup();
 * const onMove = (move: InventoryMove) => applyMove(move); // the app's records, then setItems
 * const chest = createInventoryGrid({ label: 'Chest', columns: 4, items: chestItems, group, onMove });
 * const bag = createInventoryGrid({ label: 'Bag', columns: 6, items: bagItems, group, onMove });
 * // The app's menu map: EAST calls group.cancel() while group.isHolding()
 * ```
 */
export const createItemDragGroup = (): ItemDragGroup => {
  const hosts: ItemDragHost[] = [];
  let held: Held | null = null;
  let target: { host: ItemDragHost; index: number } | null = null;
  let press: Press | null = null;
  let ghost: HTMLElement | null = null;
  /** The HUD root's corner: a fixed ghost inside it is placed from there (an embed's container) */
  let ghostOrigin = { x: 0, y: 0 };
  /** The picked slot's corner (read once, at the pick), and where in it a drag grabbed it: the
   * ghost keeps that point under the pointer */
  const grab = { left: 0, top: 0, x: 0, y: 0 };
  let removeEntry: ((returnFocus?: boolean) => void) | null = null;
  let isClickStopped = false;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  const description = document.createElement('span');
  description.id = `aekItemDragHeld_${++descriptionCount}`;
  description.hidden = true;

  const getSlot = (host: ItemDragHost, index: number) => host.getSlots()[index] ?? null;

  const findSlot = (elem: Element | null) => {
    if (!elem) return null;
    for (const host of hosts) {
      if (!host.elem.contains(elem)) continue;
      const index = host.getSlots().findIndex((slot) => slot.contains(elem));
      return index === -1 ? null : { host, index };
    }
    return null;
  };

  const makeMove = (current: Held, host: ItemDragHost, index: number): InventoryMove => {
    const landing = host.getItem(index);
    const isStack = landing?.id === current.item.id && current.item.count !== undefined;
    return {
      item: current.item,
      target: landing,
      kind: landing ? (isStack ? 'merge' : 'swap') : 'move',
      from: current.grid,
      fromIndex: current.index,
      to: host.grid,
      toIndex: index,
    };
  };

  const isAllowed = (move: InventoryMove, host: ItemDragHost) => host.canMove?.(move) !== false;

  /** Every slot of every grid described by "Holding …", or not */
  const describeSlots = (isOn: boolean) => {
    for (const host of hosts) {
      for (const slot of host.getSlots()) {
        const ids = (slot.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter((id) => id && id !== description.id);
        if (isOn) ids.push(description.id);
        if (ids.length) slot.setAttribute('aria-describedby', ids.join(' '));
        else slot.removeAttribute('aria-describedby');
      }
    }
  };

  const placeGhost = (x: number, y: number) => {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${Math.round(x - ghostOrigin.x)}px, ${Math.round(
      y - ghostOrigin.y
    )}px, 0)`;
  };

  /** A held (not dragged) item's ghost: over the target slot's corner, else its own */
  const placeGhostAtSlot = () => {
    if (!held || held.isDragging || !ghost) return;
    const slot = target ? getSlot(target.host, target.index) : getSlot(held.host, held.index);
    if (!slot) return;
    const box = slot.getBoundingClientRect();
    placeGhost(box.left + box.width * 0.4, box.top - box.height * 0.4);
  };

  const makeGhost = (slot: HTMLElement) => {
    const box = slot.getBoundingClientRect();
    const clone = slot.cloneNode(true) as HTMLElement;
    for (const name of ['id', 'aria-describedby', 'aria-pressed', 'tabindex', 'data-held']) {
      clone.removeAttribute(name);
    }
    ghost = document.createElement('div');
    ghost.className = 'aekInventoryGrid__ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('inert', '');
    ghost.style.setProperty('--aek-item-slot-size', `${box.width}px`);
    grab.left = box.left;
    grab.top = box.top;
    ghost.append(clone);
    const parent = hasHudRoot() ? getHUDRootCMP().elem : document.body;
    const corner = parent.getBoundingClientRect();
    ghostOrigin = { x: corner.left, y: corner.top };
    parent.append(ghost);
  };

  const clearTarget = () => {
    if (target) getSlot(target.host, target.index)?.removeAttribute('data-drop-target');
    target = null;
  };

  const markTarget = (host: ItemDragHost, index: number) => {
    if (!held) return;
    if (target?.host === host && target.index === index) return;
    clearTarget();
    target = { host, index };
    if (host !== held.host || index !== held.index) {
      const allowed = isAllowed(makeMove(held, host, index), host);
      getSlot(host, index)?.setAttribute('data-drop-target', allowed ? 'allowed' : 'blocked');
    }
    placeGhostAtSlot();
  };

  const begin = (host: ItemDragHost, index: number, isDragging: boolean) => {
    const item = host.getItem(index);
    const slot = getSlot(host, index);
    if (!item || !slot) return false;
    held = { item, grid: host.grid, index, host, isDragging };
    slot.setAttribute('data-held', '');
    makeGhost(slot);
    description.textContent = `Holding ${item.name}`;
    host.elem.append(description);
    describeSlots(true);
    removeEntry = pushOverlay({ elem: host.elem, close: () => cancel(), returnFocus: null });
    announce(
      host.elem,
      isDragging
        ? `${item.name} picked up`
        : `${item.name} picked up. Choose a slot and press Enter to drop it, or Escape to put it back`
    );
    target = null;
    placeGhostAtSlot();
    return true;
  };

  /** Ends a hold: the marks, the ghost, the descriptions, the Escape entry */
  const end = () => {
    if (!held) return;
    clearTarget();
    getSlot(held.host, held.index)?.removeAttribute('data-held');
    describeSlots(false);
    description.remove();
    ghost?.remove();
    ghost = null;
    removeEntry?.(false);
    removeEntry = null;
    held = null;
  };

  /** Puts the held item back; the focus back on its slot when it was in a grid */
  function cancel() {
    if (!held) return;
    const { host, index, item } = held;
    const active = document.activeElement;
    const hadFocus = hosts.some((other) => other.elem.contains(active));
    end();
    if (hadFocus) getSlot(host, index)?.focus();
    announce(host.elem, `${item.name} put back`);
  }

  /** Drops the held item in a slot: its own slot puts it back; a vetoed one keeps it held */
  const drop = (host: ItemDragHost, index: number) => {
    if (!held) return false;
    if (host === held.host && index === held.index) {
      cancel();
      return true;
    }
    const move = makeMove(held, host, index);
    if (!isAllowed(move, host)) {
      announce(host.elem, `${move.item.name} can't go there`);
      return false;
    }
    end();
    host.onMove?.(move);
    const place = host.describe(index);
    announce(
      host.elem,
      move.kind === 'swap'
        ? `${move.item.name} swapped with ${move.target?.name}`
        : move.kind === 'merge'
          ? `${move.item.name} stacked`
          : `${move.item.name} moved to ${move.from === move.to ? place : `${host.label}, ${place}`}`
    );
    return true;
  };

  const stopNextClick = () => {
    isClickStopped = true;
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      isClickStopped = false;
    }, 0);
  };

  const onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    if (!press || pe.pointerId !== press.pointerId) return;
    if (!press.isStarted) {
      const distance = Math.hypot(pe.clientX - press.startX, pe.clientY - press.startY);
      if (distance < DRAG_THRESHOLD) return;
      press.isStarted = true;
      if (held || !begin(press.host, press.index, true)) return;
      grab.x = press.startX - grab.left;
      grab.y = press.startY - grab.top;
    }
    if (!held?.isDragging || !ghost) return;
    pe.preventDefault();
    placeGhost(pe.clientX - grab.x, pe.clientY - grab.y);
    // The ghost lets the pointer through: what's under it is the target
    const found = findSlot(document.elementFromPoint?.(pe.clientX, pe.clientY) ?? null);
    if (found) markTarget(found.host, found.index);
    else clearTarget();
  };

  const endPress = () => {
    press = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  };

  function onPointerUp(e: Event) {
    const pe = e as PointerEvent;
    if (!press || pe.pointerId !== press.pointerId) return;
    const wasDrag = press.isStarted;
    endPress();
    if (!wasDrag) return;
    // The click the release makes isn't a pick or a drop
    stopNextClick();
    if (!held?.isDragging) return;
    if (!target || !drop(target.host, target.index)) cancel();
  }

  function onPointerCancel(e: Event) {
    if (!press || (e as PointerEvent).pointerId !== press.pointerId) return;
    endPress();
    if (held?.isDragging) cancel();
  }

  const group: ItemDragGroup = {
    cancel,
    isHolding: () => held !== null,
    getHeld: () => (held ? { item: held.item, grid: held.grid, index: held.index } : null),
  };

  impls.set(group, {
    register: (host) => {
      hosts.push(host);
      return () => {
        if (held?.host === host) end();
        else if (target?.host === host) clearTarget();
        if (press?.host === host) endPress();
        hosts.splice(hosts.indexOf(host), 1);
        if (!hosts.length && clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          isClickStopped = false;
        }
      };
    },
    activate: (host, index) => {
      if (held) {
        if (!held.isDragging) drop(host, index);
      } else begin(host, index, false);
    },
    setTarget: (host, index) => {
      if (held && !held.isDragging) markTarget(host, index);
    },
    pointerDown: (host, index, e) => {
      if (press || held || e.button !== 0 || e.isPrimary === false) return;
      if (!host.getItem(index)) return;
      press = {
        host,
        index,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        isStarted: false,
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    },
    takeClick: () => {
      if (!isClickStopped) return false;
      isClickStopped = false;
      return true;
    },
  });
  return group;
};
