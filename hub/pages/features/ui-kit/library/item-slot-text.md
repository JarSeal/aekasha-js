## Item slot

`createItemSlot({ item, size, keyHint, selected, cooldown })` is a square button holding an item:
its icon, a stack's count and a rarity's border and word, named by a hidden text ("Health potion,
5, Uncommon"). `selected` makes it a toggle, a key hint draws its key and `aria-keyshortcuts`, and
`cooldown` puts a cooldown on it. The hotbar and the inventory are made of slots.

- **States:** in the page: the sizes, the rarities, empty, a selected one with a key hint, a
  potion drunk (its count and cooldown), deselected and given another item.
