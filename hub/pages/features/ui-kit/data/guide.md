## Lists

[`createList`](api:createList) shows your items as rows. You pass the items and a function per
part: its `title`, and optionally an `icon`, a `badge`, a `subTitle` above the title, a
`description` under it, a `suffix` at the row's end and a `tooltip`. Each row is kept by its key
(`getKey`, by default the item's `id`), so new items write only the parts whose text changed.

```ts
type Light = { id: string; name: string; kind: string; visible: boolean };

const lights = createList<Light>({
  heading: 'Lights', // with the count: "Lights 12", "Lights 3 of 12" while filtered
  items: () => getSceneLights(), // a function: read again on refresh and on the scheduler
  title: (light) => light.name,
  badge: (light) => light.kind,
  selection: 'single',
  onActivate: (light) => openLightWindow(light.id), // a click or Enter
  actions: [
    {
      key: 'visible',
      label: 'Visible',
      icon: getSvgIcon('lightBulb'),
      pressed: (light) => light.visible, // a toggle: aria-pressed
      onPress: (light) => setLightVisible(light.id, !light.visible),
    },
  ],
  filter: { field: true },
  empty: 'No lights in this scene',
  scheduler, // the panel's: read every 500 ms while it shows
  interval: 500,
});
lightsPanel.add(lights.cmp);
```

::: demo list
:::

- **Three kinds.** With no `selection`, `onActivate` or `actions` it's a plain list (`<ul>`), for
  rows to read. With a `selection` (`'single'` or `'multiple'`) or an `onActivate` it's a listbox:
  one tab stop, the arrows between the rows. With `actions`, a button on every row (a visibility
  toggle, a lock), it's a grid: each row's content and its buttons are its cells, Left and Right
  move between them.
- **Selecting and activating.** A click or Space selects; a click or Enter activates
  (`onActivate`: open the object's window), which selects in a single selection too. With
  `'multiple'`, Ctrl / ⌘ + click and Space toggle a row, Shift + click or Shift + an arrow
  selects the range from the last row picked, and Ctrl / ⌘ + A every row (again: none).
  `onSelectionChange` gets the user's changes and the selected rows the items lost; `setSelected`
  sets it from code without calling it. Keeping the selection across visits is yours.
- **Actions.** An action's `pressed` makes it a toggle, read again after each press, so an
  `onPress` that changes the item in place shows the change; `iconOff` is its icon while not
  pressed. `hidden` leaves a row's cell empty, keeping the other buttons aligned, and `disabled`
  disables it (a disabled row's actions are disabled too).
- **Filtering.** `filter` shows only the rows matching a query: by default every word of it is
  in the row's text (the title, sub title, description, suffix and badge), case and accents
  ignored, the matches marked. `field: true` puts a search field above the list (ArrowDown enters
  the list, Escape empties it); without it, call `setQuery` from a search box of your own.
  `match` replaces the matching, and the count ("3 of 12", "No matches for …") is announced to
  screen readers.
- **Live data.** `setItems` replaces the items, `setItem(key, item)` one of them: a figure that
  changes every frame writes one text node. Give `items` as a function and a `scheduler` (with
  `interval` for a live list) and the list reads it on the scheduler's tick while it shows.
- **Long lists** render only the rows their box shows with `virtual: createVirtualRows()`, a
  spacer standing in for the others: worth it past about 200 rows. Every row is one height then
  (`rowHeight`, or the first row's, measured), and the box needs a height to scroll in
  (`--aek-list-max-height`, 12 rows by default). The focused row stays rendered however far the
  box scrolls, and screen readers hear each row's place ("12 of 5000"). The browser's find can't
  see the rows not rendered: give such a list a `filter`.
- **Reordering.** `reorder: createListReorder({ onReorder })` lets the user move a row with
  Alt + ArrowUp / ArrowDown or a drag (on a touch screen by the row's handle, since a drag on the
  row scrolls): a line shows where it drops, the box scrolls near its edges, Escape cancels, and
  each move is announced. `onReorder({ key, from, to })` is yours to apply (or `optimistic: true`
  has the list move the row first). Not while the list is filtered.

```ts
let layers = getLayers();
const layerList = createList<Layer>({
  label: 'Layers',
  items: () => layers,
  title: (layer) => layer.name,
  reorder: createListReorder({
    onReorder: ({ from, to }) => {
      const next = layers.slice();
      next.splice(to, 0, ...next.splice(from, 1));
      layers = next;
      layerList.refresh(); // the rows follow, the focus stays on the moved one
    },
  }),
});
```

- **Virtual rows and reorder are values you pass**, as the context menu is something you add: a
  list without them carries none of their code.
- **A context menu** is yours to add, over the whole list: `createContextMenu` on `cmp.elem`,
  finding the row with `getKeyAt` (a list without one carries none of the menu's code).

```ts
createContextMenu({
  target: lights.cmp.elem,
  items: (elem) => {
    const key = lights.getKeyAt(elem); // the row right-clicked or focused
    return key ? [{ label: 'Focus', onSelect: () => focusLight(key) }] : [];
  },
});
```

| List              |                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ListProps`](api:ListProps), an action's [`ListAction`](api:ListAction), the filter's [`ListFilter`](api:ListFilter)                                                                                                                                                                                                                                                                                                            |
| Parts             | `.aekList` with `__header` (`__heading`, `__headingText`, `__count`), `__filter` (`__search`), `__rows` (virtual rows' `__spacer`s, a drag's `__dropLine`), each `__row` (`__main` in a grid, a reorder's `__handle`, `__content`: `__icon`, `__badge`, `__text` with `__subTitle`, `__title`, `__description`; `__suffix`; a grid's `__actionCell` and `__action`), `__empty`, `__noMatch` (`__clear`); the matches' `.aekMark` |
| States            | the rows' `data-mode` (`static`, `listbox`, `grid`); a row's `data-key`, `aria-selected`, `aria-disabled` (`data-disabled` in a plain list), `hidden` while filtered out; a row's `data-dragging`, `data-pinned` (a virtual row kept at its offset); the rows' `data-virtual`, `data-reorder`; a title's `data-placeholder`; an action's `aria-pressed`, `disabled`, `hidden`                                                    |
| Custom properties | `--aek-list-max-height` (the rows' box scrolls past it; 12 rows with virtual rows), `--aek-list-selected-color` (the selected row's bar), `--aek-list-row-height` (virtual rows' height, the list's)                                                                                                                                                                                                                             |
| Keys              | One tab stop; Up and Down between the shown rows (no wrapping), Home, End, PageUp, PageDown, a letter to the next title starting with it; Space selects, Enter activates; Shift + a move, Ctrl / ⌘ + A (multiple); Left and Right between a grid row's cells; Alt + ArrowUp / ArrowDown move a row (reorder); the search field's ArrowDown into the list and Escape empties it                                                   |
| Assistive tech    | `role="listbox"` of `option`s (`aria-multiselectable`), or `role="grid"` of `row`s and `gridcell`s, named by the heading or `label`; `aria-selected`, `aria-disabled`; a toggle's `aria-pressed`; virtual rows' `aria-setsize` / `aria-posinset` (`aria-rowcount` / `aria-rowindex` in a grid); the filter's count and a move read politely                                                                                      |

## Trees

[`createTree`](api:createTree) shows nested nodes, a row per shown node: the user opens and closes
them. You pass the roots, how to find a node's children and a function per part, as for a list:
its `title`, and optionally an `icon`, a `badge`, a `suffix` and a `tooltip`. Each row is kept by
its key (unique in the whole tree), so new nodes write only what changed, and a kept key keeps its
open state and selection.

```ts
type SceneNode = { id: string; name: string; children: SceneNode[] };

const outline = createTree<SceneNode>({
  label: 'Scene',
  roots: () => [getSceneRoot()], // a function: read again on refresh and on the scheduler
  getChildren: (node) => node.children,
  title: (node) => node.name,
  suffix: (node) => (node.children.length ? String(node.children.length) : null),
  selection: 'single',
  expanded: savedExpandedKeys, // yours to keep: onExpandedChange reports the user's changes
  onExpandedChange: (keys) => saveExpandedKeys(keys),
  onActivate: (node) => openNodeWindow(node.id), // a click or Enter
  filter: { field: true },
});
outlinePanel.add(outline.cmp);

outline.focusKey(pickedNodeId); // opens its ancestors, scrolls it into the box, focuses it
```

::: demo tree
:::

- **Opening and closing.** Right opens a node, or goes to its first child when it's open; Left
  closes it, or goes to its parent; `*` opens its siblings; a click on the chevron opens and closes
  it. Enter activates (`onActivate`); without it Enter opens and closes, and so does a click in a
  tree with no `selection`. `onExpandedChange` gets the user's changes, `expand` and `collapse`
  change them from code without calling it, and `expanded` restores them, keys of nodes not known
  yet included.
- **Lazy children.** Where `getChildren` returns nothing, `loadChildrenAsync` loads a node's
  children on its first open: a loading row under it meanwhile (the node `aria-busy`), the end
  announced, the result kept (`reloadChildren` loads it again). A failure shows an error row
  (`errorText`) that Enter, Space or a click retries. A node closed or removed before its load ends
  drops the result. `hasChildren` says which nodes not loaded yet show as ones that open (a file
  doesn't).
- **Selecting** is the list's: `selection` `'single'` or `'multiple'` (Space, Shift + a move or a
  click for a range across levels, Ctrl / ⌘ + A every shown node), `onSelectionChange`,
  `setSelected`.
- **Filtering.** `filter` shows the matching nodes with their ancestors, opened, the matches
  marked; the filter's opens and closes are its own, and your expanded keys come back when the
  query is cleared (with the focused node's ancestors opened, so it stays where you found it). The
  filter searches the nodes the tree knows: a lazy node's children once loaded.
- **Live data and big trees** as the list: `setRoots`, `setNode(key, node)` for one node's
  figures, `roots` as a function with a `scheduler` and `interval`, and
  `virtual: createVirtualRows()` (the same handle) for a tree that shows hundreds of rows. The tree
  reads every node it knows on a refresh.
- **A context menu** is yours to add, as for a list: `createContextMenu` on `cmp.elem`, finding the
  node with `getKeyAt`.

| Tree              |                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`TreeProps`](api:TreeProps), the filter's [`TreeFilter`](api:TreeFilter)                                                                                                                                                                                                                                                                                  |
| Parts             | `.aekTree` with `__header` (`__heading`, `__headingText`, `__count`), `__filter` (`__search`), `__rows` (virtual rows' `__spacer`s), each `__row` (`__twisty`, `__content`: `__icon`, `__badge`, `__title`, `__suffix`), a lazy node's `__status` (`__statusMark`, `__statusText`, `__retry`), `__empty`, `__noMatch` (`__clear`); the matches' `.aekMark` |
| States            | a row's `data-key`, `aria-expanded`, `aria-selected`, `aria-disabled`, `aria-busy` (its children loading), `data-pinned` (a virtual row kept at its offset); a status row's `data-status` (`loading`, `error`); the rows' `data-virtual`; a title's `data-placeholder`                                                                                     |
| Custom properties | `--aek-tree-max-height` (the rows' box scrolls past it; 12 rows with virtual rows), `--aek-tree-indent` (each level's step), `--aek-tree-selected-color` (the selected row's bar), `--aek-tree-row-height` (virtual rows' height, the tree's), `--aek-tree-level` (a row's level, the tree's)                                                              |
| Keys              | One tab stop; Up and Down between the shown rows (no wrapping), Home, End, PageUp, PageDown; Right opens or enters, Left closes or leaves, `*` opens the siblings, a letter to the next title starting with it; Enter activates (or opens and closes), Space selects; Shift + a move, Ctrl / ⌘ + A (multiple); Enter or Space on an error row retries      |
| Assistive tech    | One flat `role="tree"` (`aria-multiselectable`) of `treeitem`s named by the heading or `label`, each with `aria-level`, `aria-setsize` and `aria-posinset` among its shown siblings, `aria-expanded`, `aria-selected`, `aria-disabled`, `aria-busy`; an error row is a tree item; the filter's count and a load's end read politely                        |

## Tables

[`createTable`](api:createTable) shows rows under columns. A column has a `key` and a `label`, and
reads a row's value (`value`, by default the row's own key of that name) and writes it as text
(`format`). A number is aligned to the end; every figure is in tabular figures, so digits line up.

```ts
type Category = { id: string; name: string; bytes: number; count: number };

const memory = createTable<Category>({
  caption: 'GPU memory by category', // names the table (captionHidden: a heading above says it)
  columns: [
    { key: 'name', label: 'Category', rowHeader: true, sortable: true },
    {
      key: 'bytes',
      label: 'Size',
      format: (bytes) => formatBytes(bytes as number),
      sortable: true,
    },
    { key: 'count', label: 'Count', sortable: true },
  ],
  rows: () => getMemoryCategories(), // a function: read again on refresh
  footer: () => [getMemoryTotal()], // a <tfoot>, never sorted
  sort: { key: 'bytes', direction: 'descending' },
  striped: true,
  sticky: { header: true },
});
memoryPanel.add(memory.cmp);
memory.refresh(); // the figures again: only the cells whose text changed are written
```

::: demo table
:::

- **Rows by key.** Each row is kept by its key (`getKey`, by default the row's `id`), across the
  rows, the groups and the footer: `setRows`, `setGroups`, `setFooter` and `refresh` move a kept
  row's element, and write a cell's text node only when its text changed.
- **Live figures.** `setCell(key, column, value)` sets one cell's value and writes its text node
  when the text changed, allocating nothing of the table's own: a profiler's figures, set as often
  as they change. The value holds until the row is read again (`refresh`), and the rows aren't
  sorted again until then (a row doesn't jump under the pointer each frame). With `rows` a
  function, `scheduler` and `interval` read them again on a panel's scheduler (its `refresh()`, and
  its tick every `interval` ms while the table shows), as a list's: one tick for a whole panel.
  Updating a tenth of 500 rows costs a few milliseconds; every figure of 500 rows at once, mostly
  the browser's layout of the new text, about 15: past a few hundred changing rows, use virtual
  rows.
- **Long tables.** `virtual: createVirtualRows()` renders only the rows the table's box shows (and
  the focused one), spacer rows standing in for the others: past about 200 rows. Every row is one
  height (`rowHeight`, or the first one's, measured) with its cells on one line, and the box needs
  a height (`--aek-table-max-height`); give every column a `width`, or the columns' widths follow
  the rows on screen. Only the ungrouped rows are virtual (the groups and the footer always
  render), sorting still sorts them all, and the browser's find can't see the rows not rendered.
  A virtual table doesn't stack (`stackBelow`).
- **Groups and a total.** `groups` (`{ key, label, rows }`) come after the rows, a `<tbody>` each
  under a header row (an empty one isn't shown); `footer` rows are a `<tfoot>`, the total.
- **Columns.** `rowHeader` makes a column's cells the rows' headers (a name column, what a screen
  reader says with each cell); `align` overrides the alignment; `width` and `minWidth` size it (when
  every shown column has a `width`, the table's layout is fixed, which lays out faster); `hidden`
  leaves it out; `headerTooltip` says what it holds. `tone` gives a cell a status (`'info'`,
  `'success'`, `'warning'`, `'danger'`): its colour and a mark before the text, never the colour
  alone, so let the text say it too.
- **Sorting.** A `sortable` column's header is a button: ascending, then descending (then the
  rows' own order with `sortUnset`), its mark the direction and `aria-sort` on the header, the
  change announced ("Sorted by Size, descending"). The rows and each group are sorted apart, the
  footer never, and rows that compare equal keep their order. By default the values compare as
  numbers, or as text with its numbers as numbers (`Item 9` before `Item 10`), empty values last
  either way; `compare(a, b)` is a column's own. `sort` is the sort at the start, `setSort` and
  `getSort` the code's, `onSortChange` the user's (keeping it is yours). With `manualSort` the
  table only shows the sort and reports it: you sort the rows (a sorted query, a paged source).
- **Cells.** `cell(row)` puts a CMP in a column's cells in place of the text (two lines, a button,
  a badge); it's made again when the row is another object and removed with the row. The value
  still sorts the column.
- **Bars.** `kind: 'bar'` draws a bar before a cell's text: the value as a number, or an array of
  numbers for its segments (in view and culled), against the column's largest total (the
  footer's included, so a total row in the footer makes every bar its share) or `barMax`. The bar
  is decorative: the text says the figures (`format`; an array's are joined by `/`, or `''` when
  another column says them).
- **Selecting and opening rows.** `selection: 'single'` or `'multiple'` and `onRowActivate` make
  the table a grid ([keys below](#keys-in-a-grid)): the user selects rows (`selected`,
  `onSelectionChange`, `setSelected`, `getSelected`) and opens one (a click, Enter). The footer's
  rows are neither.
- **A context menu.** As on a list: make one on the table's element and find the row from the
  element it opens on, `createContextMenu({ target: table.cmp.elem, items: (elem) =>
rowItems(table.getKeyAt(elem)) })`. In a grid, Shift+F10 or the ContextMenu key on a cell opens
  it.
- **Looks.** `striped` tints every other row; `highlight` tints the `'row'`, the `'column'`, the
  `'cell'` or both row and column (`'cross'`) under the pointer and the focus. Both are the text
  colour, at 3 % and 8 %, over whatever the table sits on. A selected row has the accent's tint and
  a bar at its start.
- **The box.** The table sits in a box that scrolls past `--aek-table-max-height` (and sideways
  when the columns don't fit). While it overflows, the box is a tab stop named by the caption, so a
  keyboard can scroll it (a grid's cells do that themselves). `sticky: { header, firstColumn }`
  keeps those in view as it scrolls: they need an opaque background, `--aek-table-bg` (by default
  the surface): set it to the surface the table is on.
- **Narrow boxes.** `stackBelow: 480` turns each row into a card of "label: value" lines whenever
  the table's own box is narrower than 480 px (a window's, an embed's): the header is hidden but
  still read, a sortable column's header stays as a chip to sort the cards by, and every part
  keeps its table role.
- **Empty.** `empty` (a text, or a CMP such as `createEmptyState`'s) shows in a row across every
  column when there are no rows.

### Keys in a grid

A plain table has no keys of its own: Tab reaches its sort buttons and its cells' controls. A grid
is one tab stop, as the APG data grid:

| Key                             | In a grid                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Arrows                          | The next cell, the headers' row included (a sortable header's button); no wrap |
| Home / End                      | The row's first or last cell                                                   |
| Ctrl / ⌘ + Home / End           | The first cell of the header row, the last of the last row                     |
| PageUp / PageDown               | By the rows the box shows                                                      |
| Space                           | Selects the row (toggles it in a multiple selection)                           |
| Enter                           | Opens the row (`onRowActivate`; selects it in a single selection)              |
| Shift + a move, Shift + click   | Selects the range from the last row picked                                     |
| Ctrl / ⌘ + click, Ctrl / ⌘ + A  | Toggles a row; every row, or none                                              |
| Enter or F2 on a cell's control | Into the control (the cell's button); Escape or F2 back to the cell            |

| Table             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`TableProps`](api:TableProps), a column's [`TableColumn`](api:TableColumn), a group's [`TableGroup`](api:TableGroup), a sort's [`TableSort`](api:TableSort)                                                                                                                                                                                                                                                                                                                                                                |
| Parts             | `.aekTable` with `__scroll` (the box) and `table.aekTable__table`: `__caption`, `__col`s, `__head` with `__header`s (a sortable one's `__sort` button: `__headerLabel`, `__sortMark`), `__body` (virtual rows' `__spacer`s), a `__group` per group with its `__groupRow` (`__groupHeader`), `__foot`; each `__row` of `__cell`s (a stacked layout's `__cellLabel`; a bar's `__barBox`: `__bar` with its `__barPart`s, `__barText`); `__emptyRow` with `__empty`                                                             |
| States            | the table's `data-striped`, `data-highlight`, `data-sticky-header`, `data-sticky-column`, `data-stacked`, `data-grid`; `data-fixed` on the `<table>`; `__body`'s `data-virtual`; a header's `data-sortable` and `aria-sort`; a cell's or header's `data-align`, a cell's `data-tone` and `data-kind`; a bar part's `data-part`; a `<col>`'s `data-highlight`; a row's `data-key` and `aria-selected`, a virtual row's `data-stripe` and `data-pinned`                                                                       |
| Custom properties | `--aek-table-max-height` (the box scrolls past it), `--aek-table-bg` (the box's and the sticky parts' background), `--aek-table-stripe`, `--aek-table-highlight`, `--aek-table-cell-padding`, `--aek-table-selected-color` (a selected row's bar), `--aek-table-bar-height`, `--aek-table-bar-track`, `--aek-table-bar-1` to `-4` (a bar's segments), `--aek-table-row-height` (virtual rows' height, written once measured), `--aek-table-row-tint` (a row's tint, the table's own)                                        |
| Keys              | A sortable header's button (Enter, Space). A plain table has no others; while it overflows, its box is a tab stop the arrows scroll. A grid's are [above](#keys-in-a-grid)                                                                                                                                                                                                                                                                                                                                                  |
| Assistive tech    | A native `<table>` named by its caption, `scope` on its headers (`col`, `row` for a row header, `rowgroup` for a group's), `aria-sort` on the sorted column's header; a grid is `role="grid"` (`aria-multiselectable`) with `aria-selected` on its rows; virtual rows' `aria-rowcount` and `aria-rowindex`; while it overflows, its box is a `role="region"` named by the caption; with `stackBelow` every part has its table role as an attribute; a tone's mark and a bar are said as nothing; a user's sort is announced |

## Key APIs

- [`createList`](api:createList) ([`List`](api:List), [`ListProps`](api:ListProps),
  [`ListAction`](api:ListAction), [`ListFilter`](api:ListFilter)).
- [`createVirtualRows`](api:createVirtualRows) ([`VirtualRows`](api:VirtualRows)), for a list, a
  tree or a table, and [`createListReorder`](api:createListReorder) ([`ListReorder`](api:ListReorder),
  [`ListReorderChange`](api:ListReorderChange)).
- [`createTree`](api:createTree) ([`Tree`](api:Tree), [`TreeProps`](api:TreeProps),
  [`TreeFilter`](api:TreeFilter)).
- [`createTable`](api:createTable) ([`Table`](api:Table), [`TableProps`](api:TableProps),
  [`TableColumn`](api:TableColumn), [`TableGroup`](api:TableGroup), [`TableSort`](api:TableSort),
  [`TableTone`](api:TableTone)).
- [`createContextMenu`](api:createContextMenu) for a menu over the rows, and
  [`createBindingScheduler`](api:createBindingScheduler) for a panel's live lists and trees.

## Read more

- [The UI kit](hub:features/ui-kit): components, the HUD root, styling.
- [Core components](hub:features/ui-kit/core): the badges, the tabs and the empty states a list
  sits among.
- [Windows and overlays](hub:features/ui-kit/overlays): the context menu.
- [The component library](hub:features/ui-kit/library): every piece in every state.
