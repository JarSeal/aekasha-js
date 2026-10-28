## List

`createList({ items, title })` shows an app's items as rows: a title, and optionally an icon, a
badge, a sub title above it, a description under it, a suffix at the end and a tooltip (or a CMP of
`render`). Rows are kept by key, so new items write only the parts whose text changed. It's a
plain list, a listbox (`selection` `'single'` or `'multiple'`, or `onActivate`) or, with `actions`
(a button on every row, such as a visibility toggle), a grid. A listbox or a grid is one tab stop:
Up and Down move between the rows without wrapping, Home, End, PageUp and PageDown too, a letter
goes to the next title starting with it; Space selects, Enter activates; with a multiple selection
Shift + a move or a click selects a range, Ctrl / ⌘ + click toggles a row and Ctrl / ⌘ + A selects
every row. In a grid, Left and Right move between a row's cells. A `filter` shows only the rows
matching a query, the matches marked, with a search field above (`field: true`) whose ArrowDown
enters the list. `virtual: createVirtualRows()` renders only the rows the box shows (a long
list), and `reorder: createListReorder({ onReorder })` lets the user move the rows: Alt + ArrowUp /
ArrowDown or a drag (on a touch screen by the row's handle), the drop shown by a line.

- **States:** drawn in the page: the heaviest meshes (static: an icon, a badge, a sub title, a
  description, a suffix and an unnamed mesh's stand-in title), twelve scene objects (single
  selection, the filter field, the box scrolling past its height), five layers (multiple, two
  selected) and four lights (a grid with an on toggle and an animate toggle, which a directional
  light has no cell for, and a disabled baked light), 5,000 assets (virtual rows: End goes to the
  last, the filter finds one far down) and a draw order to move (reorder: the row's handle, Alt +
  arrows, a drag). **Filter by “zz”** shows the no match line
  with its clear button, **Empty the lights** the empty text. The status line says what the user
  selected, opened or pressed.
- **What the page can't show:** the drag's lift and the edge scroll are a pointer's (the
  keyboard scripts move a row with Alt + arrows); a context menu over the rows is the app's (`createContextMenu` on
  the list's element, the row found with `getKeyAt`); the context menu box shows one.
