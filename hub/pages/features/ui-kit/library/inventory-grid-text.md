## Inventory grid

`createInventoryGrid({ label, columns, items, onMove, canMove, group })` is a grid of item slots
(the APG grid, one tab stop). Enter, Space or a click picks the focused item up and drops it on
another slot (a move, a swap, or a merge of stacks), Escape puts it back, the arrows carry it; a
pointer drags it, touch too. Grids in one `createItemDragGroup` move items between them. The grid
moves nothing: `onMove` reports and the app's `setItems` shows it; `canMove` vetoes one.

- **States:** in the page: a bag and a chest in one group, the focused item's details beside
  them, and the bag focused. The picks and drops are the keyboard scripts'.
