import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import type { GameItem } from './ItemTypes';
import { CMP, classes } from '../../core/CMP';
import { createRovingTabStop } from '../../components/RovingFocus';
import { swallowNextKeyUp } from '../../overlays/OverlayStack';
import {
  createItemDragGroup,
  useItemDragGroup,
  type InventoryMove,
  type ItemDragGroup,
  type ItemDragHost,
} from './ItemDragGroup';
import { createItemSlot, type ItemSlot, type ItemSlotProps } from './ItemSlot';
import './InventoryGrid.scss';
import '../../styles/kit.scss';

/** What {@link createInventoryGrid} shows. */
export type InventoryGridProps = {
  /** Its name ('Backpack', 'Chest'), read and said when an item lands in it from another grid. */
  label: string;
  /** Its slots per row. */
  columns: number;
  /** Its rows (default as many as `items` fills). */
  rows?: number;
  /** Its slots' items, row by row, null for an empty slot (the rest are empty). */
  items: readonly (GameItem | null)[];
  /** The group whose grids an item moves between (a chest and the bag). Default one of its own. */
  group?: ItemDragGroup;
  /** Vetoes a move landing in this grid (an equipment slot that takes helmets only): false keeps the
   * item held, and the slot shows `data-drop-target="blocked"` while it's the target. */
  canMove?: (move: InventoryMove) => boolean;
  /** A move landing in this grid (from it or another of its group): the app changes its records and
   * shows them with `setItems` on both grids. The grid moves nothing itself. */
  onMove?: (move: InventoryMove) => void;
  /** The slots' size (default `'md'`). */
  size?: ItemSlotProps['size'];
  /** An empty slot's name (default 'Empty slot'). */
  emptyLabel?: string;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An inventory grid {@link createInventoryGrid} made: its CMP, its slots and its items. */
export type InventoryGrid = {
  /** Its element (`.aekInventoryGrid`): add it where it goes. */
  cmp: CMPHandle;
  /** Its slots, row by row. */
  slots: readonly ItemSlot[];
  /** Its group (the one given, or its own): `group.cancel()` puts a held item back. */
  group: ItemDragGroup;
  /** Shows other items, row by row (the rest empty): after a move, a loot, a sort. */
  setItems: (items: readonly (GameItem | null)[]) => void;
  /** Shows another item in a slot, or none. */
  setItem: (index: number, item: GameItem | null) => void;
  /** The item in a slot, null when empty */
  getItem: (index: number) => GameItem | null;
  /** Moves the focus to a slot (default its tab stop): an inventory screen's open. */
  focus: (index?: number) => void;
};

/**
 * Creates an inventory grid (p808 D11): slots in rows and columns whose items move by the pointer,
 * the keys or a gamepad, within the grid or to another of its group (`createItemDragGroup`). A
 * click, Enter or Space picks an item up, and on another slot drops it there (a move, a swap, or a
 * merge of a stack); a drag does both in one go, with a ghost under the pointer. The app does the
 * move: `onMove` reports it, `canMove` vetoes it.
 * - Parts: `.aekInventoryGrid` (`role="grid"`), `__row`s (`role="row"`) of `__cell`s
 *   (`role="gridcell"`), each holding an item slot (`.aekItemSlot`, `data-index`; while an item is
 *   held, its own slot `data-held` and the target `data-drop-target="allowed" | "blocked"`), and
 *   `__ghost` (the held item following the pointer or over the target, in the HUD root).
 * - Custom properties (read on any ancestor): `--aek-inventory-grid-gap` (default
 *   `--aek-space-2`); the slots' own.
 * - Keys: the APG grid's: one tab stop, the arrows by row and column (an arrow at the grid's edge
 *   goes on, so a spatial navigation round the grids takes it to the next), Home and End in the
 *   row, Ctrl+Home and Ctrl+End the first and last slot; Enter and Space pick up and drop (kept
 *   from the action maps); Escape puts a held item back (the overlay stack's). A gamepad: the
 *   spatial navigation's `move`, `SOUTH` clicks the focused slot, `EAST` is `group.cancel()` (or
 *   the navigation's `back()`).
 * - Assistive tech: a pick says the item and the keys ('Iron sword picked up. Choose a slot…'),
 *   every slot is described as 'Holding Iron sword' while it's held, and a drop says what happened
 *   ('Iron sword moved to row 2, column 3', '… swapped with Bow', '… can't go there'), politely.
 * - Motion: none; the ghost follows the pointer as it moves (direct manipulation, under reduced
 *   motion too).
 * @example
 * ```ts
 * import { createInventoryGrid, getHUDRootCMP } from 'aekasha/ui';
 *
 * let bag: (GameItem | null)[] = [{ id: 'potion', name: 'Health potion', count: 3 }, null, null];
 * const grid = createInventoryGrid({
 *   label: 'Bag',
 *   columns: 3,
 *   items: bag,
 *   onMove: ({ fromIndex, toIndex }) => {
 *     bag = bag.slice();
 *     [bag[fromIndex], bag[toIndex]] = [bag[toIndex], bag[fromIndex]];
 *     grid.setItems(bag);
 *   },
 * });
 * getHUDRootCMP().add(grid.cmp);
 * ```
 */
export const createInventoryGrid = (props: InventoryGridProps): InventoryGrid => {
  const columns = Math.max(1, Math.floor(props.columns));
  const rows = Math.max(1, Math.floor(props.rows ?? Math.ceil(props.items.length / columns)));
  const count = rows * columns;
  const group = props.group ?? createItemDragGroup();
  const impl = useItemDragGroup(group);
  let unregister: (() => void) | null = null;

  const indexOf = (target: EventTarget | null) =>
    target ? elems.findIndex((elem) => elem.contains(target as Node)) : -1;

  /** Where a key moves the focus from `index`; null: not the grid's key, or an edge */
  const getKeyTarget = (key: string, index: number, isCtrl: boolean) => {
    const column = index % columns;
    const rowStart = index - column;
    if (key === 'ArrowLeft') return column > 0 ? index - 1 : null;
    if (key === 'ArrowRight') return column < columns - 1 ? index + 1 : null;
    if (key === 'ArrowUp') return index >= columns ? index - columns : null;
    if (key === 'ArrowDown') return index + columns < count ? index + columns : null;
    if (key === 'Home') return isCtrl ? 0 : rowStart;
    if (key === 'End') return isCtrl ? count - 1 : rowStart + columns - 1;
    return null;
  };

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    const index = elems.indexOf(ke.target as HTMLElement);
    if (index === -1 || ke.altKey || ke.metaKey || ke.shiftKey) return;
    if ((ke.key === 'Enter' || ke.key === ' ') && !ke.ctrlKey) {
      // The slot's own click picks up or drops: kept from the action maps only
      ke.stopPropagation();
      swallowNextKeyUp(ke.key);
      return;
    }
    const isHomeEnd = ke.key === 'Home' || ke.key === 'End';
    if (ke.ctrlKey && !isHomeEnd) return;
    const next = getKeyTarget(ke.key, index, ke.ctrlKey);
    if (next === null) return;
    ke.preventDefault();
    ke.stopPropagation();
    swallowNextKeyUp(ke.key);
    tabStop.setIndex(next);
    elems[next].focus();
  };

  const onClick = (e: Event) => {
    if (impl.takeClick()) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const index = indexOf(e.target);
    if (index !== -1) impl.activate(host, index);
  };

  const onPointerDown = (e: Event) => {
    const index = indexOf(e.target);
    if (index !== -1) impl.pointerDown(host, index, e as PointerEvent);
  };

  /** The mouse over a slot while an item is held: the drop's target */
  const onPointerOver = (e: Event) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    const index = indexOf(e.target);
    if (index !== -1) impl.setTarget(host, index);
  };

  const onFocusIn = (e: Event) => {
    tabStop.onFocusIn(e);
    const index = indexOf(e.target);
    if (index !== -1) impl.setTarget(host, index);
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekInventoryGrid', props.class),
    attr: {
      ...props.attr,
      role: 'grid',
      'aria-label': props.label,
    },
    listeners: [
      { type: 'keydown', fn: onKeyDown },
      { type: 'click', fn: onClick },
      { type: 'pointerdown', fn: onPointerDown },
      { type: 'pointerover', fn: onPointerOver },
      { type: 'focusin', fn: onFocusIn },
    ],
    onRemoveCmp: () => {
      unregister?.();
      unregister = null;
    },
  });

  const slots: ItemSlot[] = [];
  for (let row = 0; row < rows; row++) {
    const rowCmp = CMP({ class: 'aekInventoryGrid__row', attr: { role: 'row' } });
    cmp.add(rowCmp);
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const cell = CMP({ class: 'aekInventoryGrid__cell', attr: { role: 'gridcell' } });
      rowCmp.add(cell);
      const slot = createItemSlot({
        item: props.items[index] ?? null,
        size: props.size,
        emptyLabel: props.emptyLabel,
        attr: { 'data-index': String(index) },
      });
      cell.add(slot.cmp);
      slots.push(slot);
    }
  }
  const elems = slots.map((slot) => slot.cmp.elem);
  const tabStop = createRovingTabStop({ getElems: () => elems });
  tabStop.reset(0);

  const getItem = (index: number) => slots[index]?.getItem() ?? null;

  const grid: InventoryGrid = {
    cmp,
    slots,
    group,
    setItems: (items) => {
      for (let i = 0; i < count; i++) slots[i].setItem(items[i] ?? null);
    },
    setItem: (index, item) => slots[index]?.setItem(item),
    getItem,
    focus: (index) => {
      const target = index ?? tabStop.getIndex();
      if (!elems[target]) return;
      tabStop.setIndex(target);
      elems[target].focus();
    },
  };

  const host: ItemDragHost = {
    elem: cmp.elem,
    grid,
    label: props.label,
    getSlots: () => elems,
    getItem,
    describe: (index) => `row ${Math.floor(index / columns) + 1}, column ${(index % columns) + 1}`,
    canMove: props.canMove,
    onMove: props.onMove,
  };
  unregister = impl.register(host);

  return grid;
};
