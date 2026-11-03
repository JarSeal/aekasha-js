import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import type { GameItem } from './ItemTypes';
import { CMP, classes } from '../../core/CMP';
import { announce } from '../../components/Announcer';
import { createRovingTabStop, getMoveTarget } from '../../components/RovingFocus';
import { swallowNextKeyUp } from '../../overlays/OverlayStack';
import { createItemSlot, type ItemSlot, type ItemSlotProps } from './ItemSlot';
import './Hotbar.scss';
import '../../styles/kit.scss';

/** What {@link createHotbar} shows. */
export type HotbarProps = {
  /** Its slots' items, null for an empty slot: the slot count is set here. */
  slots: readonly (GameItem | null)[];
  /** Its name (default 'Hotbar'). */
  label?: string;
  /** The selected slot (the item in hand). None: no slot is selected and the slots are plain
   * buttons (an ability bar), until the first `select`. */
  selected?: number;
  /** The slots' key hints, by index (keys as `createKbd` takes them, or a handle such as an input
   * glyph; null for none). Default the number keys, '1' to '9' then '0'; false for none. The keys
   * are the app's to bind: the hints only show them. */
  keyHints?: false | readonly (string | { cmp: CMPHandle } | null)[];
  /** Puts a cooldown on every slot (`hotbar.slots[i].cooldown`). */
  cooldowns?: boolean;
  /** A slot's cooldown ended by itself. */
  onCooldownReady?: (index: number) => void;
  /** A slot was clicked, or Enter or Space pressed on it: use its item, or `select(index)` (a
   * touch screen's hotbar). A running cooldown doesn't stop it: check `slots[index].cooldown`. */
  onUse?: (index: number, item: GameItem | null) => void;
  /** The slots' size (default `'md'`). */
  size?: ItemSlotProps['size'];
  /** `'horizontal'` (default) or `'vertical'`: the row's direction and its arrow keys. */
  orientation?: 'horizontal' | 'vertical';
  /** `'bottom'` (default): centred at the bottom of the HUD's bounds, fixed there; `'inline'`: in
   * the flow of what it's added to (a panel). */
  placement?: 'bottom' | 'inline';
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A hotbar {@link createHotbar} made: its CMP, its slots and its selection. */
export type Hotbar = {
  /** Its element (`.aekHotbar`): add it where it goes (the HUD root for `'bottom'`). */
  cmp: CMPHandle;
  /** Its slots, by index: `slots[2].cooldown?.start(4000)`, `slots[0].setCount(3)`. */
  slots: readonly ItemSlot[];
  /** Shows another item in a slot, or none. */
  setItem: (index: number, item: GameItem | null) => void;
  /** Selects a slot (-1: none): its `aria-pressed`, the tab stop, and, while the focus isn't on
   * the bar, an announcement ('Iron sword selected'). Writes nothing when it's the selected one. */
  select: (index: number) => void;
  /** Selects the slot `step` from the selected one, round (the wheel's ±1, a shoulder button's);
   * from none, 1 is the first and -1 the last. */
  selectNext: (step: number) => void;
  /** The selected slot's index, -1 for none */
  getSelected: () => number;
  /** The selected slot's item, null for none or an empty slot */
  getSelectedItem: () => GameItem | null;
};

/** The number keys' order on a keyboard: 1 to 9, then 0 */
const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * Creates a hotbar (p808 D11): a row of item slots, one of them selected (the item in hand) or none
 * (an ability bar), with the number keys' hints. The app binds the keys: a number selects or uses
 * its slot, the wheel and the shoulder buttons call `selectNext(±1)`, a click calls `onUse`.
 * - Parts: `.aekHotbar` (`data-placement`, `data-orientation`) holding the slots (`.aekItemSlot`,
 *   `data-index`; see `createItemSlot`).
 * - Custom properties (read on any ancestor): `--aek-hotbar-bg` (default the surface at 60 %),
 *   `--aek-hotbar-inset` (its distance from the bottom, default `--aek-space-5`), `--aek-hotbar-z`
 *   (default `--aek-z-window`); the slots' own.
 * - Keys: the APG toolbar's: one tab stop (the selected slot, else the first), the arrows along its
 *   orientation round, Home and End; Enter and Space click a slot (`onUse`), kept from the action
 *   maps (a game's Space shouldn't jump as a slot is used).
 * - Assistive tech: `role="toolbar"` named by `label` (`aria-orientation` when vertical); with a
 *   selection every slot is a toggle, the selected one `aria-pressed="true"`; a selection made while
 *   the focus is elsewhere (the wheel) is announced politely ('Iron sword selected').
 * - Motion: none of its own (the slots' cooldowns).
 * @example
 * ```ts
 * import { createHotbar, getHUDRootCMP } from 'aekasha/ui';
 *
 * const hotbar = createHotbar({
 *   slots: [{ id: 'sword', name: 'Iron sword', icon: 'sword' }, null, null],
 *   selected: 0,
 *   cooldowns: true,
 *   onUse: (index) => hotbar.select(index),
 * });
 * getHUDRootCMP().add(hotbar.cmp);
 * // The app's map: the wheel calls hotbar.selectNext(Math.sign(delta)), '2' hotbar.select(1)
 * ```
 */
export const createHotbar = (props: HotbarProps): Hotbar => {
  const orientation = props.orientation ?? 'horizontal';
  const keyHints = props.keyHints === false ? [] : props.keyHints ?? NUMBER_KEYS;
  let selected = -1;
  let hasSelection = false;

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    const index = elems.indexOf(ke.target as HTMLElement);
    if (index === -1 || ke.ctrlKey || ke.metaKey || ke.altKey) return;
    if (ke.key === 'Enter' || ke.key === ' ') {
      // The button's own click uses it: kept from the action maps only
      ke.stopPropagation();
      swallowNextKeyUp(ke.key);
      return;
    }
    const next = getMoveTarget(ke.key, index, { count: elems.length, orientation, wrap: true });
    if (next === null) return;
    ke.preventDefault();
    ke.stopPropagation();
    swallowNextKeyUp(ke.key);
    if (next === -1) return;
    tabStop.setIndex(next);
    elems[next].focus();
  };

  const onClick = (e: Event) => {
    const index = elems.findIndex((elem) => elem.contains(e.target as Node));
    if (index !== -1) props.onUse?.(index, slots[index].getItem());
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekHotbar', props.class),
    attr: {
      ...props.attr,
      role: 'toolbar',
      'aria-label': props.label ?? 'Hotbar',
      'data-orientation': orientation,
      'data-placement': props.placement ?? 'bottom',
      ...(orientation === 'vertical' ? { 'aria-orientation': 'vertical' } : {}),
    },
    listeners: [
      { type: 'keydown', fn: onKeyDown },
      { type: 'click', fn: onClick, options: { capture: false } },
      // The focus moving in some other way (a click, code) moves the tab stop with it
      { type: 'focusin', fn: (e) => tabStop.onFocusIn(e) },
    ],
  });

  const slots: ItemSlot[] = props.slots.map((item, index) => {
    const slot = createItemSlot({
      item,
      size: props.size,
      keyHint: keyHints[index] ?? undefined,
      cooldown: props.cooldowns ? { onReady: () => props.onCooldownReady?.(index) } : undefined,
      attr: { 'data-index': String(index) },
    });
    cmp.add(slot.cmp);
    return slot;
  });
  const elems = slots.map((slot) => slot.cmp.elem);
  const tabStop = createRovingTabStop({ getElems: () => elems });

  const select = (index: number) => {
    const next = index >= 0 && index < slots.length ? index : -1;
    if (next === selected) return;
    if (!hasSelection) {
      // Every slot a toggle from now on, not only the selected one
      hasSelection = true;
      for (const slot of slots) slot.setSelected(false);
    }
    if (selected !== -1) slots[selected].setSelected(false);
    selected = next;
    if (next === -1) return;
    slots[next].setSelected(true);
    const hasFocus = cmp.elem.contains(document.activeElement);
    if (hasFocus) return;
    // The tab stop follows, unless the player is on the bar (the stop is where they are)
    tabStop.setIndex(next);
    const item = slots[next].getItem();
    announce(cmp.elem, `${item?.name ?? 'Empty slot'} selected`);
  };

  if (props.selected !== undefined) {
    hasSelection = true;
    selected = props.selected >= 0 && props.selected < slots.length ? props.selected : -1;
    slots.forEach((slot, i) => slot.setSelected(i === selected));
  }
  tabStop.reset(selected === -1 ? 0 : selected);

  return {
    cmp,
    slots,
    setItem: (index, item) => slots[index]?.setItem(item),
    select,
    selectNext: (step) => {
      const count = slots.length;
      const whole = Math.trunc(step);
      if (!count || !whole) return;
      const from = selected === -1 ? (whole > 0 ? -1 : count) : selected;
      select((((from + whole) % count) + count) % count);
    },
    getSelected: () => selected,
    getSelectedItem: () => (selected === -1 ? null : slots[selected].getItem()),
  };
};
