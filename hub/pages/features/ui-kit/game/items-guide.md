## Item slots

An item is plain data, a [`GameItem`](api:GameItem): `{ id, name, icon?, image?, count?, rarity?,
description?, stats? }`, `icon` a registered icon's name (or a function making the picture) and
`image` a URL. [`createItemSlot`](api:createItemSlot) shows one in a square button; the hotbar and
the inventory are made of slots.

```ts
const potion: GameItem = { id: 'potion', name: 'Health potion', icon: 'potion', count: 5, rarity: 'uncommon' };
const slot = createItemSlot({ item: potion, keyHint: '2', cooldown: true, onClick: () => drink() });
slot.setCount(4); // only the count is written
slot.cooldown?.start(4000);
```

::: demo itemSlot
:::

- **Rarity** is a border (`--aek-item-slot-rarity-color`, set per `data-rarity`: `uncommon`,
  `rare`, `epic`, `legendary`) and a word in the slot's name ("Health potion, 5, Uncommon") and
  in its [details](#item-details): never the colour alone. `rarityLabel` names one of your own.
- **A toggle only when selected.** `selected` (or the first `setSelected`) makes it a toggle
  (`aria-pressed`), so an inventory's slots aren't read as toggles.
- **A key hint** is keys for a key hint (`'1'`, and the slot's `aria-keyshortcuts`), or a handle
  whose `cmp` is drawn (an input glyph). `cooldown` puts a [cooldown](#cooldowns) on it.

| Item slot         |                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ItemSlotProps`](api:ItemSlotProps), [`GameItem`](api:GameItem)                                                                 |
| Parts             | `.aekItemSlot` (a `<button>`) holding `__icon`, `__count`, `__key` and `__spoken`                                                 |
| States            | `data-size` (`sm`, `md`, `lg`), `data-rarity`, `data-empty`, `aria-pressed`                                                       |
| Custom properties | `--aek-item-slot-size`, `--aek-item-slot-bg`, `--aek-item-slot-rarity-color`                                                      |
| Keys              | The button's Enter and Space                                                                                                      |
| Assistive tech    | Named by its hidden `__spoken` text (or `emptyLabel`, "Empty slot"); the picture, count and key hint `aria-hidden`              |

## Hotbars

[`createHotbar`](api:createHotbar) is a row of item slots at the bottom of the HUD, with a
selected slot and a cooldown per slot. It binds no keys: your action map calls `select` for the
number keys and `selectNext` for the wheel and the shoulder buttons.

```ts
const hotbar = createHotbar({
  slots: [sword, bow, potion, null],
  selected: 0,
  cooldowns: true,
  onUse: (index, item) => useItem(index, item), // a slot's click, Enter or Space
});
getHUDRootCMP().add(hotbar.cmp);
map.onPressed('item1', () => hotbar.select(0));
canvas.addEventListener('wheel', (e) => hotbar.selectNext(Math.sign(e.deltaY)), { passive: true });
```

::: demo hotbar
:::

- **Use or select.** `onUse` is the one callback: use the item (an ability bar), or call
  `select(index)` (a touch screen's hotbar). Without `selected` there's no selection and the slots
  are plain buttons.
- **The keys' hints** are '1' to '9' and '0' by default; `keyHints: false` for none, or your own
  keys or glyphs per slot.
- A selection made while the focus is elsewhere is announced ("Iron sword selected").
- `placement: 'bottom'` is fixed at `--aek-hotbar-inset` from the bounds' bottom; `'inline'` in
  your panel.

| Hotbar            |                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Props             | [`HotbarProps`](api:HotbarProps)                                                                               |
| Parts             | `.aekHotbar` (`data-placement`, `data-orientation`) of item slots                                              |
| Custom properties | `--aek-hotbar-inset`, `--aek-hotbar-bg`, `--aek-hotbar-z`; the slots'                                          |
| Keys              | ← → (↑ ↓ when vertical) round the slots, Home, End; Enter and Space use                                        |
| Assistive tech    | A `role="toolbar"` named by `label` ("Items"), one tab stop; the selected slot `aria-pressed`                |

## Inventory grids

[`createInventoryGrid`](api:createInventoryGrid) is a grid of item slots the player moves items
around in, by the pointer, the keys or a gamepad. The grid moves nothing itself: it reports the
move, your records change and `setItems` shows them.

```ts
let bag: (GameItem | null)[] = [sword, potion, null, null];
const grid = createInventoryGrid({
  label: 'Bag',
  columns: 4,
  items: bag,
  onMove: (move) => {
    bag = applyMove(bag, move); // a 'move', a 'swap' or a 'merge' of stacks
    grid.setItems(bag);
  },
  canMove: (move) => move.item.id !== 'questKey', // a veto keeps it held
});
```

::: demo inventoryGrid
:::

- **One action picks up and drops.** Enter, Space or a click picks the focused item up and, on
  another slot, drops it; on its own slot puts it back, and so do Escape and `group.cancel()`. So
  the mouse can click to carry too, and a gamepad's `SOUTH` is a click on the focused slot.
- **A drag.** A press moved 4 px drags the item under a ghost, the slot under the pointer marked
  (allowed, or blocked: struck through); touch drags too.
- **Several grids.** Grids given one [`createItemDragGroup`](api:createItemDragGroup) move items
  between them (a chest and the bag); the move goes to the grid it lands in. An arrow at a grid's
  edge isn't used, so a [spatial navigation](#spatial-navigation) round the grids takes the focus
  to the next one.
- **Merges.** A drop on an item with the same `id` and a `count` is a `merge`: you add the counts
  and keep any rest.
- **Details.** A gamepad hovers nothing: show the [details](#item-details) of the focused slot
  beside the grid (`focusin`), as the demo does.

| Inventory grid    |                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`InventoryGridProps`](api:InventoryGridProps), [`InventoryMove`](api:InventoryMove), [`ItemDragGroup`](api:ItemDragGroup)                              |
| Parts             | `.aekInventoryGrid` of `__row`s of `__cell`s (`data-index`), each an item slot; `__ghost` while dragged                                                 |
| States            | A slot's `data-held`, `data-drop-target` (`allowed`, `blocked`)                                                                                          |
| Custom properties | `--aek-inventory-grid-gap`; the slots'                                                                                                                   |
| Keys              | ↑ ↓ ← → in the grid, Home, End, Ctrl+Home, Ctrl+End; Enter, Space pick up and drop; Escape puts back                                                    |
| Assistive tech    | The APG grid, one tab stop; a pick says the item and the keys, every slot then described "Holding Iron sword", a drop says where it went ("… moved to Bag, row 2, column 1") |

## Item details

[`createItemDetails`](api:createItemDetails) is an item's name, rarity, description and stats,
each compared with another item's (the one in hand): the content for a slot's
[tooltip](hub:features/ui-kit/overlays#tooltips), or a panel beside an inventory.

```ts
const tooltip = createTooltip({
  anchor: slot.cmp.elem,
  content: () => createItemDetails({ item: slot.getItem(), compareTo: equipped }).cmp,
});
```

::: demo itemDetails
:::

- **A stat** is `{ id, label, value, format?, lowerIsBetter? }`; stats are compared by `id`. A
  difference shows an arrow (up better, down worse), a sign (which way the number went: "▼ +0.4
  s" is a longer attack time, worse) and the success or danger role, and says it in words
  ("0.4 s more, worse"). The same value is a muted "="; a stat only the other item has shows "–".
- `setItem(item, compareTo)` for a panel that follows the focused slot; `null` shows
  `emptyLabel`.

| Item details      |                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ItemDetailsProps`](api:ItemDetailsProps), [`ItemStat`](api:ItemStat)                                                                         |
| Parts             | `.aekItemDetails` holding `__header` (`__name`, `__rarity`), `__description`, `__stats` (a `dl` of `__stat`s: `__statLabel`, `__statValue` with `__value` and `__diff`) and `__compare` |
| States            | `data-rarity`, `data-state="empty"`; a stat's `data-change` (`better`, `worse`, `same`), `data-missing`                                       |
| Custom properties | `--aek-item-details-width`, `--aek-item-details-rarity-color`                                                                                  |
| Keys              | None                                                                                                                                           |
| Assistive tech    | Plain text, so a tooltip's description reads it all; a difference in words, its arrow and sign `aria-hidden`                                  |
