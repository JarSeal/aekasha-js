import type { SvgIconKey } from '../../core/icons/SvgIcon';

/**
 * An item as the item pieces show it (a slot, the hotbar, the inventory, the details): plain data
 * the app makes from its own item records.
 */
export type GameItem = {
  /** Its id (the app's: which record it is). */
  id: string;
  /** Its name, read as the slot's name and shown in its details ('Iron sword'). */
  name: string;
  /** A registered icon's name (`registerIcon`), or a function that makes its picture (a canvas, an
   * app's SVG): called each time a slot shows the item, so one item can be in several slots. */
  icon?: SvgIconKey | (() => HTMLElement);
  /** An image's URL, drawn when there's no `icon`. */
  image?: string;
  /** How many there are in the stack: shown from 2. */
  count?: number;
  /** Its rarity: the slot's `data-rarity` and border colour (the stylesheet colours `uncommon`,
   * `rare`, `epic` and `legendary`; an app adds its own), and read after its name. */
  rarity?: string;
  /** The rarity's word as it's read and shown in the details (default the rarity with a capital:
   * 'Rare'). */
  rarityLabel?: string;
  /** A line or two about it, shown in its details ('A plain blade, well kept.'). */
  description?: string;
  /** Its numbers, shown in its details as rows and compared with another item's of the same id. */
  stats?: readonly ItemStat[];
};

/** One of an item's numbers ('Damage 12'), as its details show and compare it. */
export type ItemStat = {
  /** Which stat it is: two items' stats of the same id are compared. */
  id: string;
  /** Its name ('Damage'). */
  label: string;
  /** Its value. */
  value: number;
  /** Writes a value and a difference's size ('12', '1.5 s', '8 %'); default the number, rounded
   * to two decimals. */
  format?: (value: number) => string;
  /** Whether less is better (a weight, a cast time): the comparison's better and worse turn round.
   * Default false. */
  lowerIsBetter?: boolean;
};
