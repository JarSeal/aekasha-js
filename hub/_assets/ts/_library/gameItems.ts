/**
 * The component library's game item pieces (the Hub's `features/ui-kit/game/` page, p808): the
 * item slot, the hotbar, the inventory grid with its drag group, and the item details. Their
 * items' pictures are icons the demos register themselves (`registerIcon`), as an app does.
 */
import {
  createHotbar,
  createInventoryGrid,
  createItemDetails,
  createItemDragGroup,
  createItemSlot,
  createTooltip,
  registerIcon,
} from 'aekasha/ui';
import type { GameItem, InventoryGrid, InventoryMove } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';
import { createStatusLine } from './game';

// --- The items ---

const svg = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">${path}</svg>`;

const ITEM_ICONS = {
  hubDemoPotion: svg('<path d="M6 1h4v1H9v3.2a5 5 0 1 1-2 0V2H6zm-2.2 9a4.2 4.2 0 0 0 8.4 0z"/>'),
  hubDemoSword: svg('<path d="M13 1h2v2l-7 7 1.5 1.5-1 1L7 11l-3 3-2-2 3-3-1.5-1.5 1-1L6 8z"/>'),
  hubDemoDagger: svg('<path d="M12 2h2v2l-5 5 1 1-1 1-1.5-1.5L5 12l-1-1 2.5-2.5L5 7l1-1 1 1z"/>'),
  hubDemoShield: svg('<path d="M8 1 2 3v4c0 4 3 6.5 6 8 3-1.5 6-4 6-8V3z"/>'),
  hubDemoGem: svg('<path d="M4 2h8l3 4-7 9-7-9zm0 4h8L8 13z"/>'),
  hubDemoCoin: svg('<path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8"/>'),
  hubDemoKey: svg(
    '<path d="M5 3a4 4 0 0 1 3.9 3H15v2h-1.5v2h-2V8H8.9A4 4 0 1 1 5 3m0 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/>'
  ),
};

let iconsRegistered = false;
/** The items' icons, registered by the first demo that shows one */
const registerItemIcons = () => {
  if (iconsRegistered) return;
  iconsRegistered = true;
  for (const [name, icon] of Object.entries(ITEM_ICONS)) registerIcon(name, icon);
};

const SECONDS = (s: number) => `${s} s`;
const KG = (kg: number) => `${kg} kg`;

const IRON_SWORD: GameItem = {
  id: 'ironSword',
  name: 'Iron sword',
  icon: 'hubDemoSword',
  rarity: 'common',
  description: 'Plain, sharp, reliable.',
  stats: [
    { id: 'damage', label: 'Damage', value: 12 },
    { id: 'speed', label: 'Attack time', value: 1.2, format: SECONDS, lowerIsBetter: true },
    { id: 'weight', label: 'Weight', value: 3, format: KG, lowerIsBetter: true },
  ],
};
const SWIFT_DAGGER: GameItem = {
  id: 'dagger',
  name: 'Swift dagger',
  icon: 'hubDemoDagger',
  rarity: 'rare',
  description: 'Quick in the hand.',
  stats: [
    { id: 'damage', label: 'Damage', value: 7 },
    { id: 'speed', label: 'Attack time', value: 0.6, format: SECONDS, lowerIsBetter: true },
    { id: 'weight', label: 'Weight', value: 1, format: KG, lowerIsBetter: true },
    { id: 'crit', label: 'Critical chance', value: 15, format: (n) => `${n} %` },
  ],
};
const OAK_SHIELD: GameItem = {
  id: 'shield',
  name: 'Oak shield',
  icon: 'hubDemoShield',
  rarity: 'uncommon',
};
const POTIONS: GameItem = {
  id: 'potion',
  name: 'Health potion',
  icon: 'hubDemoPotion',
  count: 5,
  rarity: 'uncommon',
};
const GEMS: GameItem = {
  id: 'gem',
  name: 'Ember gem',
  icon: 'hubDemoGem',
  count: 2,
  rarity: 'epic',
};
const COINS: GameItem = { id: 'coin', name: 'Gold coin', icon: 'hubDemoCoin', count: 25 };
const BEACON_KEY: GameItem = {
  id: 'key',
  name: 'Beacon key',
  icon: 'hubDemoKey',
  rarity: 'legendary',
  description: 'A quest item: it stays in the bag.',
};

// --- Item slot ---

const SLOT_ID = (name: string) => `${ID_PREFIX}Slot${name}`;

/** In the page: slots in each size and rarity, an empty one, a selected one with a key hint, and
 * one with a cooldown the Hub buttons start */
const initItemSlotDemo: Demo = (box) => {
  registerItemIcons();
  const root = addKitRoot(box);
  const sizes = addGroup(root, 'Sizes: sm, md and lg; a stack’s count');
  for (const size of ['sm', 'md', 'lg'] as const) {
    sizes.append(createItemSlot({ item: POTIONS, size }).cmp.elem);
  }
  const rarities = addGroup(root, 'Rarities: a border and a word (read in the name), and empty');
  for (const item of [IRON_SWORD, OAK_SHIELD, SWIFT_DAGGER, GEMS, BEACON_KEY]) {
    rarities.append(createItemSlot({ item }).cmp.elem);
  }
  rarities.append(createItemSlot({ item: null }).cmp.elem);
  const toggles = addGroup(root, 'A toggle with a key hint, and a cooldown');
  const status = createStatusLine(SLOT_ID('Status'));
  const selected = createItemSlot({
    id: SLOT_ID('Selected'),
    item: IRON_SWORD,
    keyHint: '1',
    selected: true,
  });
  let count = POTIONS.count ?? 0;
  const potion = createItemSlot({
    id: SLOT_ID('Potion'),
    item: POTIONS,
    keyHint: '2',
    cooldown: { onReady: () => (status.textContent = 'The potion is ready') },
    onClick: () => usePotion(),
  });
  const usePotion = () => {
    if (potion.cooldown?.isRunning() || count === 0) return;
    count--;
    potion.setCount(count);
    potion.cooldown?.start(1000);
    status.textContent = `Drank a potion: ${count} left`;
  };
  toggles.append(selected.cmp.elem, potion.cmp.elem);
  root.append(status);
  const actions = addGroup(root, 'From code');
  addButton(actions, 'Drink a potion (1 s cooldown)', usePotion);
  addButton(actions, 'Deselect the sword', () => selected.setSelected(false));
  addButton(actions, 'Swap the sword for the dagger', () => selected.setItem(SWIFT_DAGGER));
};

// --- Hotbar ---

const HOTBAR_ID = (name: string) => `${ID_PREFIX}Hotbar${name}`;

/** In the page: a hotbar with a selection and a cooldown per slot; a slot's use (a click, Enter or
 * Space) selects it and starts its cooldown, as an app's `onUse` might */
const initHotbarDemo: Demo = (box) => {
  registerItemIcons();
  const root = addKitRoot(box);
  const status = createStatusLine(HOTBAR_ID('Status'));
  const hotbar = createHotbar({
    id: HOTBAR_ID('Bar'),
    label: 'Items',
    slots: [IRON_SWORD, SWIFT_DAGGER, POTIONS, null, GEMS],
    selected: 0,
    cooldowns: true,
    placement: 'inline',
    onUse: (index, item) => {
      hotbar.select(index);
      if (item?.id === 'potion') hotbar.slots[index].cooldown?.start(1000);
      status.textContent = item ? `Used: ${item.name}` : 'An empty slot';
    },
    onCooldownReady: (index) => (status.textContent = `Slot ${index + 1} ready`),
  });
  const group = addGroup(root, 'A toolbar: the arrows between the slots; the numbers are hints');
  group.append(hotbar.cmp.elem);
  root.append(status);
  const keys = addGroup(root, 'The app’s map calls select and selectNext');
  addButton(keys, 'The wheel: next', () => hotbar.selectNext(1));
  addButton(keys, 'The wheel: previous', () => hotbar.selectNext(-1));
  addButton(keys, 'Key 3', () => hotbar.select(2));
};

// --- Inventory grid ---

const INVENTORY_ID = (name: string) => `${ID_PREFIX}Inventory${name}`;

/**
 * In the page: a bag and a chest in one drag group, and the details of the focused (or hovered)
 * item beside them. The grids move nothing: `onMove` changes the records and `setItems` shows
 * them; the beacon key can't go in the chest (`canMove`).
 */
const initInventoryGridDemo: Demo = (box) => {
  registerItemIcons();
  const root = addKitRoot(box);
  const status = createStatusLine(INVENTORY_ID('Status'));
  const records = new Map<InventoryGrid, (GameItem | null)[]>();
  const group = createItemDragGroup();
  const panel = document.createElement('div');
  panel.className = 'hubDemoInventory';
  const grids = document.createElement('div');
  grids.className = 'hubDemoInventoryGrids';
  const details = createItemDetails({ item: null, emptyLabel: 'Nothing here' });
  panel.append(grids, details.cmp.elem);

  const applyMove = (move: InventoryMove) => {
    const from = records.get(move.from);
    const to = records.get(move.to);
    if (!from || !to) return;
    if (move.kind === 'merge' && move.target) {
      to[move.toIndex] = {
        ...move.target,
        count: (move.target.count ?? 1) + (move.item.count ?? 1),
      };
      from[move.fromIndex] = null;
    } else {
      from[move.fromIndex] = move.target;
      to[move.toIndex] = move.item;
    }
    move.from.setItems(from);
    if (move.to !== move.from) move.to.setItems(to);
    status.textContent = `${move.kind}: ${move.item.name}`;
  };
  const makeGrid = (label: string, columns: number, items: (GameItem | null)[]) => {
    const grid = createInventoryGrid({
      id: INVENTORY_ID(label),
      label,
      columns,
      items,
      group,
      onMove: applyMove,
      canMove: (move) => !(label === 'Chest' && move.item.id === 'key'),
    });
    records.set(grid, items);
    const heading = document.createElement('h3');
    heading.className = 'hubDemoInventoryHeading';
    heading.textContent = label;
    grids.append(heading, grid.cmp.elem);
    return grid;
  };
  const bag = makeGrid('Bag', 4, [
    IRON_SWORD,
    SWIFT_DAGGER,
    POTIONS,
    null,
    GEMS,
    COINS,
    BEACON_KEY,
    null,
  ]);
  makeGrid('Chest', 4, [{ ...COINS, count: 10 }, OAK_SHIELD, null, null]);
  // A gamepad hovers nothing: the details follow the focused slot, and the pointer
  const showSlotOf = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    for (const [grid, items] of records) {
      const index = grid.slots.findIndex((slot) => slot.cmp.elem.contains(target));
      if (index >= 0) details.setItem(items[index], items[index]?.stats ? IRON_SWORD : null);
    }
  };
  panel.addEventListener('focusin', (e) => showSlotOf(e.target));
  panel.addEventListener('pointerover', (e) => showSlotOf(e.target));
  const row = addGroup(
    root,
    'Enter, Space or a click picks up and drops; a drag; Escape puts it back'
  );
  row.append(panel);
  root.append(status);
  const actions = addGroup(root, 'From code');
  addButton(actions, 'Focus the bag', () => bag.focus(0));
};

// --- Item details ---

const DETAILS_ID = (name: string) => `${ID_PREFIX}Details${name}`;

/** In the page: an item's details, one compared with the item in hand, an empty one, and a slot
 * whose tooltip is its item's details */
const initItemDetailsDemo: Demo = (box) => {
  registerItemIcons();
  const root = addKitRoot(box);
  const panels = addGroup(root, 'Alone, compared with the iron sword, and empty');
  panels.classList.add('hubDemoDetails');
  panels.append(
    createItemDetails({ id: DETAILS_ID('Alone'), item: IRON_SWORD }).cmp.elem,
    createItemDetails({
      id: DETAILS_ID('Compared'),
      item: SWIFT_DAGGER,
      compareTo: IRON_SWORD,
      compareLabel: (other) => `Compared with ${other.name}, in hand`,
    }).cmp.elem,
    createItemDetails({ id: DETAILS_ID('Empty'), item: null }).cmp.elem
  );
  const tooltip = addGroup(root, 'In a tooltip: hover the slot or focus it with Tab');
  const slot = createItemSlot({ id: DETAILS_ID('Slot'), item: SWIFT_DAGGER });
  const tip = createTooltip({
    anchor: slot.cmp.elem,
    content: () => createItemDetails({ item: SWIFT_DAGGER, compareTo: IRON_SWORD }).cmp,
  });
  tooltip.append(slot.cmp.elem);
  addButton(tooltip, 'Show the slot’s tooltip', () => tip.show());
};

/** The game items group's demos by their box's key (`data-hub-demo`) */
export const GAME_ITEMS_DEMOS: Record<string, Demo> = {
  itemSlot: initItemSlotDemo,
  hotbar: initHotbarDemo,
  inventoryGrid: initInventoryGridDemo,
  itemDetails: initItemDetailsDemo,
};
