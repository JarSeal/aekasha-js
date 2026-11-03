import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import type { GameItem, ItemStat } from './ItemTypes';
import { CMP, classes } from '../../core/CMP';
import { getRarityLabel } from './ItemSlot';
import './ItemDetails.scss';
import '../../styles/kit.scss';

/** What {@link createItemDetails} shows. */
export type ItemDetailsProps = {
  /** The item (null: `emptyLabel` alone, a panel following an empty slot). */
  item: GameItem | null;
  /** The item it's compared with (the one equipped): each stat shows the difference, better or
   * worse. None, or the item itself: no comparison. */
  compareTo?: GameItem | null;
  /** The comparison's line under the stats (default `Compared with ${compareTo.name}`). */
  compareLabel?: (compareTo: GameItem) => string;
  /** What it says with no item (default 'Empty slot'). */
  emptyLabel?: string;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An item's details {@link createItemDetails} made: its CMP and its setter. */
export type ItemDetails = {
  /** Its element (`.aekItemDetails`): a tooltip's or a panel's content. */
  cmp: CMPHandle;
  /** Shows another item, and what it's compared with (none: no comparison). */
  setItem: (item: GameItem | null, compareTo?: GameItem | null) => void;
};

/** U+2212, the minus sign: a hyphen reads as a dash */
const MINUS = '−';

const formatDefault = (value: number) => String(Math.round(value * 100) / 100);

const createPart = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = ''
) => {
  const elem = document.createElement(tag);
  elem.className = className;
  if (text) elem.textContent = text;
  return elem;
};

/** A stat's row: its label, its value and, compared, the difference shown with an arrow and a sign
 * and said in words ('3 more, better') */
const createStatRow = (stat: ItemStat, other: ItemStat | undefined, isMissing: boolean) => {
  const format = stat.format ?? other?.format ?? formatDefault;
  const row = createPart('div', 'aekItemDetails__stat');
  const value = createPart('dd', 'aekItemDetails__statValue');
  value.append(createPart('span', 'aekItemDetails__value', isMissing ? '–' : format(stat.value)));
  if (isMissing) row.setAttribute('data-missing', '');
  row.append(createPart('dt', 'aekItemDetails__statLabel', stat.label), value);
  if (!other) return row;
  // Rounded: 1.2 - 0.8 is 0.3999…, which an app's format would show as it is
  const diff = Math.round(((isMissing ? 0 : stat.value) - other.value) * 1e6) / 1e6;
  if (diff === 0) {
    row.setAttribute('data-change', 'same');
    const same = createPart('span', 'aekItemDetails__diff', '=');
    same.setAttribute('aria-hidden', 'true');
    value.append(same, createPart('span', 'aekVisuallyHidden', ', the same'));
    return row;
  }
  const isBetter = stat.lowerIsBetter ? diff < 0 : diff > 0;
  row.setAttribute('data-change', isBetter ? 'better' : 'worse');
  const shown = createPart('span', 'aekItemDetails__diff');
  shown.setAttribute('aria-hidden', 'true');
  const arrow = createPart('span', 'aekItemDetails__arrow');
  arrow.setAttribute('data-direction', isBetter ? 'up' : 'down');
  shown.append(arrow, `${diff > 0 ? '+' : MINUS}${format(Math.abs(diff))}`);
  const spoken = `, ${format(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}, ${
    isBetter ? 'better' : 'worse'
  }`;
  value.append(shown, createPart('span', 'aekVisuallyHidden', spoken));
  return row;
};

/**
 * Creates an item's details (p808 D11): its name, rarity, description and stats, each stat compared
 * with another item's (the one equipped) by an arrow, a sign and the difference, better in the
 * success role and worse in the danger role. The content for a tooltip on its slot (`createTooltip`'s
 * `content`), or for a panel beside an inventory that follows the focused slot (a gamepad's, which
 * hovers nothing).
 * - Parts: `.aekItemDetails` (`data-rarity`; `data-state="empty"` with no item), `__header` with
 *   `__name` and `__rarity`, `__description`, `__stats` (a `dl`) of `__stat` rows (`data-change="better"
 *   | "worse" | "same"`, `data-missing` for a stat only the other item has) with `__statLabel` (`dt`),
 *   `__statValue` (`dd`: `__value`, `__diff` with its `__arrow`), and `__compare` (the comparison's
 *   line).
 * - Custom properties (read on any ancestor): `--aek-item-details-rarity-color` (the header's
 *   stripe; set per `data-rarity` as the slot's), `--aek-item-details-width` (default 18em).
 * - Assistive tech: plain text, so a tooltip's description reads it all; a difference is said in
 *   words ('Damage 15, 3 more, better'), its arrow and sign `aria-hidden`: never colour alone.
 * - Motion: none.
 * @example
 * ```ts
 * import { createItemDetails, createItemSlot, createTooltip } from 'aekasha/ui';
 *
 * const sword: GameItem = {
 *   id: 'sword',
 *   name: 'Iron sword',
 *   rarity: 'rare',
 *   stats: [{ id: 'damage', label: 'Damage', value: 15 }],
 * };
 * const slot = createItemSlot({ item: sword });
 * createTooltip({
 *   anchor: slot.cmp.elem,
 *   // Built on each show: the slot's item then, against the one equipped
 *   content: () => createItemDetails({ item: slot.getItem(), compareTo: equipped }).cmp,
 * });
 * ```
 */
export const createItemDetails = (props: ItemDetailsProps): ItemDetails => {
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekItemDetails', props.class),
    attr: props.attr,
  });
  const elem = cmp.elem;

  const setItem = (item: GameItem | null, compareTo?: GameItem | null) => {
    if (item?.rarity) elem.setAttribute('data-rarity', item.rarity);
    else elem.removeAttribute('data-rarity');
    if (!item) {
      elem.setAttribute('data-state', 'empty');
      elem.replaceChildren(
        createPart('p', 'aekItemDetails__name', props.emptyLabel ?? 'Empty slot')
      );
      return;
    }
    elem.removeAttribute('data-state');
    const header = createPart('div', 'aekItemDetails__header');
    header.append(createPart('p', 'aekItemDetails__name', item.name));
    const rarity = getRarityLabel(item);
    if (rarity) header.append(createPart('p', 'aekItemDetails__rarity', rarity));
    const parts: HTMLElement[] = [header];
    if (item.description) {
      parts.push(createPart('p', 'aekItemDetails__description', item.description));
    }
    const other = compareTo && compareTo !== item ? compareTo : null;
    const stats = item.stats ?? [];
    const otherStats = other?.stats ?? [];
    if (stats.length || otherStats.length) {
      const list = createPart('dl', 'aekItemDetails__stats');
      if (other) list.setAttribute('data-compared', '');
      for (const stat of stats) {
        const match = other ? otherStats.find((candidate) => candidate.id === stat.id) : undefined;
        list.append(createStatRow(stat, match, false));
      }
      // A stat only the other item has: lost by the change
      for (const stat of otherStats) {
        if (!stats.some((own) => own.id === stat.id)) list.append(createStatRow(stat, stat, true));
      }
      parts.push(list);
    }
    if (other) {
      const label = props.compareLabel?.(other) ?? `Compared with ${other.name}`;
      parts.push(createPart('p', 'aekItemDetails__compare', label));
    }
    elem.replaceChildren(...parts);
  };

  setItem(props.item, props.compareTo);
  return { cmp, setItem };
};
