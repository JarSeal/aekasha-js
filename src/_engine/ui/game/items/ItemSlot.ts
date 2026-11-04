import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import type { GameItem } from './ItemTypes';
import { CMP, classes } from '../../core/CMP';
import { getSvgIcon } from '../../core/icons/SvgIcon';
import { createKbd } from '../../components/Kbd';
import { createCooldown, type Cooldown } from '../Cooldown';
import './ItemSlot.scss';
import '../../styles/kit.scss';

/** What {@link createItemSlot} shows. */
export type ItemSlotProps = {
  /** The item in it (default none: an empty slot). */
  item?: GameItem | null;
  /** `'sm'`, `'md'` (default) or `'lg'`; `--aek-item-slot-size` sets any size. */
  size?: 'sm' | 'md' | 'lg';
  /** The key that uses it, in its corner: keys as `createKbd` takes them (`'1'`), or a handle
   * whose `cmp` is drawn as it is (an input glyph, a Kbd of the app's). The slot removes it with
   * itself. */
  keyHint?: string | { cmp: CMPHandle };
  /** Makes it a toggle (`aria-pressed`) and whether it's pressed: the hotbar's selected slot.
   * Default none: a plain button. */
  selected?: boolean;
  /** Puts a cooldown on it (`slot.cooldown`), `onReady` called when a run ends by itself. */
  cooldown?: boolean | { onReady?: () => void };
  /** Its name while empty (default 'Empty slot'). */
  emptyLabel?: string;
  /** Called on a click, Enter or Space (it's a button). */
  onClick?: (e: MouseEvent) => void;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An item slot {@link createItemSlot} made: its CMP and its setters, each writing it in place. */
export type ItemSlot = {
  /** Its element (`button.aekItemSlot`): add it where it goes. */
  cmp: CMPHandle;
  /** Its cooldown (with the `cooldown` prop), else null: `slot.cooldown.start(4000)`. */
  cooldown: Cooldown | null;
  /** Shows another item, or none. Its picture is made again only when `icon` or `image` changed. */
  setItem: (item: GameItem | null) => void;
  /** The item shown (the object given), null when empty */
  getItem: () => GameItem | null;
  /** Shows another count for the item (a stack used up one by one) without changing the item
   * object. Writes nothing when it's the count shown. */
  setCount: (count: number) => void;
  /** Presses it or releases it; the first call makes a plain slot a toggle (`aria-pressed`). */
  setSelected: (isSelected: boolean) => void;
  /** Whether it's pressed */
  isSelected: () => boolean;
};

const SIZES = new Set(['sm', 'md', 'lg']);

const createPart = (className: string) => {
  const span = document.createElement('span');
  span.className = className;
  return span;
};

/**
 * The rarity's word: the item's `rarityLabel`, else the rarity with a capital ('Rare'); '' for
 * none. What the slot reads and the details show.
 * @internal
 */
export const getRarityLabel = (item: GameItem) =>
  item.rarityLabel ?? (item.rarity ? item.rarity[0].toUpperCase() + item.rarity.slice(1) : '');

/**
 * Creates an item slot (p808 D11): a square button showing an item's picture, its stack's count, its
 * rarity as a border, the key that uses it and, opt-in, a cooldown. The hotbar and the inventory are
 * made of them; alone it's an equipment slot or a quick-use button.
 * - Parts: `.aekItemSlot` (a `<button>`; `data-size`, `data-rarity`, `data-empty` while empty),
 *   `__icon` (the picture), `__count` (bottom right, tabular; empty below 2), `__key` (top left: the
 *   key hint), `__spoken` (the name read), and the cooldown's `.aekCooldown` over them.
 * - Custom properties (read on any ancestor): `--aek-item-slot-size` (default `--aek-space-7` ×
 *   1.75 at `md`), `--aek-item-slot-bg` (default the surface), `--aek-item-slot-rarity-color` (the
 *   border; set per `data-rarity`, default the strong border).
 * - Keys: a button's: Enter and Space click it.
 * - Assistive tech: its name is the item's name, count and rarity ('Health potion, 5, Rare') from a
 *   visually hidden text, the picture, count and key hint `aria-hidden`; a string key hint is its
 *   `aria-keyshortcuts`; `selected` makes it a toggle (`aria-pressed`). The rarity's colour is read
 *   in the name and shown as a word in the item's details: the border is never its only sign.
 * - Motion: none of its own (the cooldown's sweep).
 * @example
 * ```ts
 * import { createItemSlot } from 'aekasha/ui';
 *
 * const potion = { id: 'potion', name: 'Health potion', icon: 'heart', count: 5 };
 * const slot = createItemSlot({
 *   item: potion,
 *   keyHint: 'Q',
 *   cooldown: true,
 *   onClick: () => drink(),
 * });
 * const drink = () => {
 *   if (slot.cooldown?.isRunning()) return;
 *   slot.setCount(--potion.count);
 *   slot.cooldown?.start(3000);
 * };
 * ```
 */
export const createItemSlot = (props: ItemSlotProps): ItemSlot => {
  const emptyLabel = props.emptyLabel ?? 'Empty slot';
  let item: GameItem | null = null;
  let shownIcon: GameItem['icon'] | null = null;
  let shownImage: string | null = null;
  let shownCount = -1;
  let isSelected = props.selected === true;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'button',
    class: classes('aekItemSlot', props.class),
    attr: {
      ...props.attr,
      type: 'button',
      'data-size': props.size && SIZES.has(props.size) ? props.size : 'md',
    },
    onClick: props.onClick ? (e) => props.onClick?.(e as MouseEvent) : undefined,
  });
  const elem = cmp.elem;
  const icon = createPart('aekItemSlot__icon');
  const count = createPart('aekItemSlot__count');
  const spoken = createPart('aekItemSlot__spoken aekVisuallyHidden');
  icon.setAttribute('aria-hidden', 'true');
  count.setAttribute('aria-hidden', 'true');
  elem.append(icon, count, spoken);

  if (props.keyHint !== undefined) {
    const keyCmp = CMP({ tag: 'span', class: 'aekItemSlot__key', attr: { 'aria-hidden': 'true' } });
    cmp.add(keyCmp);
    if (typeof props.keyHint === 'string') {
      const kbd = createKbd({ keys: props.keyHint });
      keyCmp.add(kbd.cmp);
      elem.setAttribute('aria-keyshortcuts', kbd.getAriaKeyShortcuts());
    } else keyCmp.add(props.keyHint.cmp);
  }
  // Last: over the picture, under the count and the key (their z-index)
  const cooldown = props.cooldown
    ? createCooldown({
        target: elem,
        onReady: typeof props.cooldown === 'object' ? props.cooldown.onReady : undefined,
      })
    : null;
  if (cooldown) cmp.add(cooldown.cmp);

  const writeSpoken = () => {
    if (!item) {
      spoken.textContent = emptyLabel;
      return;
    }
    let text = item.name;
    if (shownCount > 1) text += `, ${shownCount}`;
    const rarity = getRarityLabel(item);
    if (rarity) text += `, ${rarity}`;
    spoken.textContent = text;
  };

  /** The picture, made again only when the item's `icon` or `image` isn't the one shown */
  const writeIcon = () => {
    const nextIcon = item?.icon ?? null;
    const nextImage = nextIcon ? null : item?.image ?? null;
    if (nextIcon === shownIcon && nextImage === shownImage) return;
    shownIcon = nextIcon;
    shownImage = nextImage;
    if (typeof nextIcon === 'function') icon.replaceChildren(nextIcon());
    else if (nextIcon) icon.innerHTML = getSvgIcon(nextIcon);
    else if (nextImage) {
      const img = document.createElement('img');
      img.src = nextImage;
      img.alt = '';
      // The inventory's drag is its own: no browser image drag
      img.draggable = false;
      icon.replaceChildren(img);
    } else icon.replaceChildren();
  };

  const writeCount = (next: number) => {
    if (next === shownCount) return false;
    shownCount = next;
    count.textContent = next > 1 ? String(next) : '';
    return true;
  };

  const setItem = (next: GameItem | null) => {
    item = next;
    writeIcon();
    writeCount(next?.count ?? 0);
    if (next?.rarity) elem.setAttribute('data-rarity', next.rarity);
    else elem.removeAttribute('data-rarity');
    if (next) elem.removeAttribute('data-empty');
    else elem.setAttribute('data-empty', '');
    writeSpoken();
  };

  const setSelected = (next: boolean) => {
    isSelected = next;
    elem.setAttribute('aria-pressed', String(next));
  };

  if (props.selected !== undefined) setSelected(props.selected);
  setItem(props.item ?? null);

  return {
    cmp,
    cooldown,
    setItem,
    getItem: () => item,
    setCount: (next) => {
      if (item && writeCount(Math.max(0, Math.round(next)))) writeSpoken();
    },
    setSelected,
    isSelected: () => isSelected,
  };
};
