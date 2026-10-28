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

## Graphs

Small graphs that sit beside a figure or in a panel, and charts of a few series. Each takes its colours from the theme: a
line in the text colour unless you give one, a whole's parts in the chart series, `--aek-chart-1`
to `--aek-chart-6` (blue, orange, violet, aqua, yellow, magenta), in an order that keeps
neighbours apart for readers with the common colour vision deficiencies. A series is never a
status: a budget's over part or a warning takes `var(--aek-warning)` or `var(--aek-danger)`, and
every graph has its words, its label or a figure beside it, so colour is never the only signal.

### Sparklines

[`createSparkline`](api:createSparkline) draws recent values as a small line: an "over time"
beside a figure.

```ts
const drawCalls = createSparkline({ capacity: 60, min: 0, area: true });
const figure = CMP({ tag: 'span', text: '0' });
statsRow.add(figure);
statsRow.add(drawCalls.cmp);
setInterval(() => {
  const calls = getDrawCallCount();
  drawCalls.push(calls); // at a panel's rate: the points are a string per update
  figure.updateText(String(calls));
}, 250);
```

::: demo sparkline
:::

- **Values.** `push(value)` adds one at the right, the oldest dropped past `capacity` (default
  `values`' length, else 60); fewer values sit at the right, the newest at the edge. `setValues`
  replaces them all, `clear` empties it. A `NaN` is a gap (a frame not measured), and the last
  value has a dot unless it's a gap.
- **Scale.** From the smallest value shown to the largest; `min` or `max` fixes that end (0 for a
  count, so a dip doesn't look like a drop to nothing). One value repeated is a line across the
  middle.
- **Looks.** `area` fills under the line, faintly; `color` is any CSS colour (a series,
  `var(--aek-chart-2)`), else `--aek-sparkline-color`, else the text colour.
- **Live.** It's SVG (the stroke stays sharp and follows the theme), and each update builds its
  points as a string: update it at a panel's rate, a few times a second. A figure set every frame
  belongs on a time series.
- **Assistive tech.** Without a `label` it's hidden: the figure beside it says what it shows. With
  one it's an image named by it ("Frame time over the last minute, 16 to 33 ms").

| Sparkline         |                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`SparklineProps`](api:SparklineProps)                                                                                                                  |
| Parts             | `.aekSparkline` holding `svg.aekSparkline__svg`: `__area`, `__line`, `__dot`                                                                            |
| States            | `data-area`; the dot's `display="none"` on a gap                                                                                                        |
| Custom properties | `--aek-sparkline-color`, `--aek-sparkline-width`, `--aek-sparkline-height`, `--aek-sparkline-stroke` (the line's width), `--aek-sparkline-area-opacity` |
| Keys              | None                                                                                                                                                    |
| Assistive tech    | `aria-hidden` without a `label`; with one `role="img"` named by it                                                                                      |

### Donuts

[`createDonut`](api:createDonut) is a ring that fills to one value from 0 to 1, or shows the parts
of a whole.

```ts
// How far a measuring window has run, beside its figure: decorative
const progress = createDonut({ size: 14 });
row.add(progress.cmp);
progress.setValue(elapsedMs / windowMs); // one custom property, only when it changed

const memory = createDonut({
  label: 'GPU memory',
  parts: [
    { label: 'Textures', value: 182 },
    { label: 'Geometry', value: 64 },
  ],
  total: 512, // the rest of the ring is the track
  centre: '48 %',
  format: (megabytes) => `${megabytes} MB`,
});
```

::: demo donut
:::

- **One value.** `setValue(0.62)` writes one custom property, and only when the value to a
  thousandth changed: set it every frame if you like. With a `label` it's a meter, its value
  read as `format` says (default "62 %").
- **Parts.** `parts` (`{ label, value, color? }`) go round clockwise from the top, each its share
  of their sum or of `total`, in the chart series unless a part has its `color`. With a `label`
  it's an image whose label lists them ("GPU memory: Textures 182 MB, Geometry 64 MB"), and the
  legend (`legend: false` leaves it out) shows the same. `setParts(parts, total?)` changes them.
- **Looks.** `size` (px or a length), `centre` (a short text in the middle, `setCentre`), and
  `--aek-donut-thickness` (the ring's share of the radius; 100 % is a pie).
- **Decorative.** Without a `label` it's hidden from assistive tech, for a figure beside it that
  says the same.

| Donut             |                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`DonutProps`](api:DonutProps), a part's [`GraphPart`](api:GraphPart)                                                                                                                               |
| Parts             | `.aekDonut` holding `__ring` (`__disc`, `__centre`) and, with parts, `.aekGraphLegend` (`__item`: `__swatch`, `__label`, `__value`)                                                                 |
| States            | `data-mode` (`value`, `parts`)                                                                                                                                                                      |
| Custom properties | `--aek-donut-size`, `--aek-donut-thickness`, `--aek-donut-color` (one value's fill), `--aek-donut-track`                                                                                            |
| Keys              | None                                                                                                                                                                                                |
| Assistive tech    | With a `label`: one value a `role="meter"` (`aria-valuenow` in percent, `aria-valuetext`), parts a `role="img"` whose label lists them; the legend and centre `aria-hidden`. Without: `aria-hidden` |

### Stacked bars

[`createStackedBar`](api:createStackedBar) shows the parts of a whole in one bar, or one part
against a budget.

```ts
const memory = createStackedBar({
  label: 'GPU memory against its budget',
  parts: [{ label: 'Used', value: 318 }],
  total: 512, // a budget: the rest is the empty track
  format: (megabytes) => `${megabytes} MB`,
});
memoryPanel.add(memory.cmp);
memory.setParts([{ label: 'Used', value: getUsedMegabytes() }]); // the total is kept
```

::: demo stackedBar
:::

- **Parts.** Each part's width is its share of their sum (a full bar) or of `total` (a budget),
  in the chart series unless it has its `color`; a part of nothing isn't drawn. Each segment's
  tooltip gives its part, and `legend` puts the swatches under the bar.
- **Over the budget.** Parts past `total` are cut at the bar's end and the bar gets `data-over`
  and a danger outline. Say it in the figure beside it too ("117 % of the budget"): the outline
  isn't the only signal.
- **Updates.** `setParts(parts, total?)` writes a segment's width only when its share to a
  thousandth changed, eased over the fast motion token (none under reduced motion).
- **Not a table's bar.** A table column's `kind: 'bar'` draws its own bars (a measure in the
  text's shades), so a table carries none of this module.

| Stacked bar       |                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Props             | [`StackedBarProps`](api:StackedBarProps), a part's [`GraphPart`](api:GraphPart)                   |
| Parts             | `.aekStackedBar` holding `__track` (a `__segment` per part) and, with `legend`, `.aekGraphLegend` |
| States            | `data-over`; a segment's `hidden` when it's nothing                                               |
| Custom properties | `--aek-stacked-bar-height`, `--aek-stacked-bar-track`, `--aek-stacked-bar-over-color`             |
| Keys              | None                                                                                              |
| Assistive tech    | `role="img"` named by `label` and every part's amount; the legend `aria-hidden`                   |

### Charts

[`createChart`](api:createChart) draws lines or bars of a few series, with a y axis, a legend and
the values as a table.

```ts
const results = createChart({
  type: 'bar',
  title: 'Frame time by scene',
  description: 'The gym spends most of its frame in physics.', // the trend, in words
  categories: ['Space', 'Gym', 'Large world'],
  series: [
    { label: 'Physics', values: [1.2, 6.8, 3.1] },
    { label: 'Render', values: [5.4, 4.9, 9.7] },
  ],
  stacked: true,
  yFormat: (ms) => `${ms} ms`,
});
benchmarkPanel.add(results.cmp);
```

::: demo chart
:::

- **Bars** (`type: 'bar'`): a band per category, the series side by side, or with `stacked`
  piled up (positives up from 0, negatives down). The y axis always includes 0.
- **Lines** (`type: 'line'`): a point per category, or over a numeric `x` (seconds, metres) with
  its own nice ticks; `null` or `NaN` is a gap, and up to 40 points each get a dot.
- **The y axis.** From the values' range widened to nice ticks (1, 2, 2.5 or 5 times a power of
  ten), or `yMin` / `yMax`. `yFormat` writes its ticks and the table's values, `xFormat` a
  numeric x's.
- **Series.** Each in the chart series' colours in order unless it has its `color`; the legend
  names them (with more than one series, or `legend`). Keep a chart to a few series: past two in
  a chart where any line can cross any other, the dark theme's blue and violet come close.
- **Assistive tech.** The chart is an image named by its `title` and described by its
  `description`: write the trend a reader should see there ("doubled for one sample at 6 s").
  The values are a `<table>` (captioned by the title, a row per category, a column per series)
  that a screen reader always has; "Show as table" shows it on the page too.
- **Updates.** `setSeries(series, { categories, x })` draws it again whole: a chart is for
  figures that change now and then (a benchmark's results, a level's history). A line drawn every
  frame is a time series.

| Chart             |                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ChartProps`](api:ChartProps), a series' [`ChartSeries`](api:ChartSeries), the axis' [`ChartAxis`](api:ChartAxis)                                                                                                                                                    |
| Parts             | `.aekChart` holding `__title`, `__description`, `__figure` (`__yAxis` and `__xAxis` with their `__tick`s, `__plot` with `__svg`: `__grid`s, a `__series` group each with `__bar`s or `__line` and `__points`), the legend, `__toggle` and `__tableBox` with `__table` |
| States            | `data-type` (`line`, `bar`); a grid line's `data-zero`; an x tick's `data-edge`; `__tableBox`'s `data-shown`                                                                                                                                                          |
| Custom properties | `--aek-chart-height` (the plot's), `--aek-chart-grid-color`, `--aek-chart-line-width`, `--aek-chart-color` (a series' group's, written by the chart)                                                                                                                  |
| Keys              | The toggle is a button (Enter, Space)                                                                                                                                                                                                                                 |
| Assistive tech    | The figure `role="img"`, `aria-labelledby` the title and `aria-describedby` the description; the values' table always read, visually hidden until the toggle (`aria-expanded`, `aria-controls`) shows it; the legend `aria-hidden`                                    |

### Time series

[`createTimeSeries`](api:createTimeSeries) draws figures that change every frame (a frame's
stages, draw calls, memory) as lines over their last samples, on a canvas.

```ts
const frame = createTimeSeries({
  series: [{ label: 'Physics' }, { label: 'Render' }],
  capacity: 600, // 10 s at 60 Hz
  unit: 'ms',
  thresholds: [{ value: 16.7, label: 'Budget 16.7 ms' }],
});
statsPanel.add(frame.cmp);

const sample = new Float64Array(2); // reused: nothing allocated per frame
const tick = () => {
  sample[0] = getPhysicsMs();
  sample[1] = getRenderMs();
  frame.pushAll(sample);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

::: demo timeSeries
:::

- **Samples.** `push(value)` adds one to a single series, `pushAll(values)` one to each, in
  `series`' order (a missing value or a `NaN` is a gap): as often as every frame, with no
  allocation. Past `capacity` (default 300) the oldest go. `clear` empties it.
- **Drawing.** At most once per animation frame, and only while it shows: scrolled into view, in a
  shown panel, not `pause`d (the samples are kept meanwhile, and `resume` draws them). A frame
  draws only the new samples, moving the last image left by their width; it draws whole after a
  resize, a rescale, a theme change or a show.
- **Range.** From `min` (default 0) to `max` (default a nice ceiling over the values and the
  thresholds, with some room). An automatic top grows when a value passes it and shrinks only
  after a whole buffer under a lower one, so a spike doesn't make it jump back and forth.
  `setRange({ min, max })` fixes an end, or frees it with `undefined`.
- **Thresholds** are lines at a value in a status colour (`tone`, default warning), each with its
  text: a budget, a limit. A series is never a status, so its colours are the chart series'.
- **Colours.** A canvas can't follow the theme by itself as CSS does: the time series reads the
  tokens when it first draws and again when the theme or the density changes (the system's
  colour scheme, or `data-aek-theme` / `data-aek-density` written on an element around it).
- **Assistive tech.** The plot is hidden; the summary under it (each series' latest value, min and
  max, `format`'s text with `unit`) is what a screen reader reads. It's written at most four
  times a second while samples come, in view or not, held while paused, and isn't a live region. `summary: false` leaves it out, for a figure beside it
  that says what it shows; `ticks: false` leaves out the grid's values.
- **Which graph.** A [sparkline](#sparklines) for a few values a second beside a figure, a
  [chart](#charts) for figures that change now and then, a time series for a figure every frame:
  [which piece for what](#which-piece-for-what) compares them all.

| Time series       |                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`TimeSeriesProps`](api:TimeSeriesProps), a series' [`TimeSeriesSeries`](api:TimeSeriesSeries), a threshold's [`TimeSeriesThreshold`](api:TimeSeriesThreshold)                                                                               |
| Parts             | `.aekTimeSeries` holding `__plot` (the `__grid`'s `__gridLine`s with their `__tick`, the `__canvas`, the `__threshold`s with their `__thresholdLabel`) and `__summary` (an `__item` per series: `__swatch`, `__label`, `__value`, `__range`) |
| States            | `data-paused`; a threshold's `data-tone` and, out of the range, `hidden`                                                                                                                                                                     |
| Custom properties | `--aek-time-series-height` (the plot's), `--aek-time-series-line-width` (read with the colours), `--aek-time-series-grid-color`, `--aek-time-series-swatch` (a summary line's, written by it)                                                |
| Keys              | None                                                                                                                                                                                                                                         |
| Assistive tech    | The plot `aria-hidden`; the summary plain text in reading order, not live                                                                                                                                                                    |

## Stat tiles

[`createStatTile`](api:createStatTile) shows one figure that matters, large, with its unit, its
change since the last period and, if you give it one, a sparkline.

```ts
const frameTime = createStatTile({
  label: 'Frame time',
  unit: 'ms',
  format: (ms) => ms.toFixed(1),
  goodDirection: 'down', // a drop is good: the success colour
  sparkline: createSparkline({ capacity: 60, min: 0 }),
});
hudPanel.add(frameTime.cmp);
frameTime.setValue(16.6); // one text node, written when the text changed
frameTime.setDelta(-4.2); // "−4.2 %", read as "down 4.2 %"
```

::: demo statTile
:::

- **The figure.** `setValue` takes a number (through `format`, default `String`), a text, or
  `null` for none yet (a dash). It formats only when the value changed and writes one text node
  only when the text did: a figure set every frame is fine. The tile isn't a live region, so it
  isn't read out on every change.
- **The change.** `setDelta(delta)` shows its sign, an arrow and the size (`formatDelta`, default
  a percent to a tenth); a screen reader hears "up 12 %" or "no change". With `goodDirection`
  (`'up'` or `'down'`) a change that way is in the success colour and the other way in the danger
  colour; without it, neutral. `null` hides it.
- **A sparkline.** `sparkline` takes one you made with `createSparkline`, so a tile without one
  carries none of its code; it goes under the figure and is removed with the tile.

| Stat tile         |                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Props             | [`StatTileProps`](api:StatTileProps)                                                                                   |
| Parts             | `.aekStatTile` holding `__label`, `__figure` (`__value`, `__unit`), `__delta` (`__arrow`, `__deltaText`) and `__spark` |
| States            | `data-trend` (`up`, `down`, `flat`), `data-tone` (`success`, `danger`); `__delta`'s `hidden`                           |
| Custom properties | `--aek-stat-tile-bg`, `--aek-stat-tile-padding`, `--aek-stat-tile-value-size`                                          |
| Keys              | None                                                                                                                   |
| Assistive tech    | Plain text in reading order, the change in words; the arrow and the signed text `aria-hidden`; not live                |

## Showing live data

Every piece here can show figures that change while the app runs: a profiler's, a HUD's, an
object's state in a panel. A change reaches the screen one of three ways.

- **Read everything again.** Give `rows` (a list's `items`, a tree's `roots`) as a function and
  call `refresh()`, or pass new data to `setRows` (`setItems`, `setRoots`). The piece reads every
  row and matches it to what it shows by key: a kept row keeps its element (its focus, selection
  and scroll stay), a new row is added in its place, a gone one removed, and only a cell whose
  text changed is written. The cost grows with the rows read: for data whose rows come and go, a
  few times a second.
- **Set one figure.** `setCell(key, column, value)` on a table, `setItem(key, item)` on a list,
  `setNode(key, node)` on a tree, `setValue` on a stat tile or a donut, `push` on a time series:
  one value, written to one text node (or drawn) only when it changed, with nothing of the
  piece's own allocated. As often as the figure changes, every frame included. A table doesn't
  sort again on `setCell` (a row doesn't jump under the pointer); its next read does.
- **On a panel's scheduler.** A panel that refreshes as a whole (a window, a tab) makes one
  [`createBindingScheduler`](api:createBindingScheduler) and gives it to its pieces with an
  `interval` (in ms; 0 every frame). Its tick reads each piece at its interval, and only while
  the piece shows: a closed tab, a shut accordion section or a hidden window costs nothing. Its
  `refresh()` reads them all at once (after a change you made), and `setVisible(false)` stops the
  tick while the panel is away. An `interval` without a `scheduler` uses the page's own. A
  panel's fields and monitors share it ([the scheduler](hub:features/ui-kit/forms/binding#refresh-and-the-scheduler)).

```ts
const scheduler = createBindingScheduler(); // one per panel
const memory = createTable<Category>({
  caption: 'GPU memory',
  columns,
  rows: () => getMemoryCategories(), // read every 500 ms while it shows
  scheduler,
  interval: 500,
});
const frameTime = createStatTile({
  label: 'Frame time',
  unit: 'ms',
  format: (ms) => ms.toFixed(1),
});
const stages = createTimeSeries({
  series: [{ label: 'Physics' }, { label: 'Render' }],
  unit: 'ms',
});
statsPanel.add(frameTime.cmp);
statsPanel.add(stages.cmp);
statsPanel.add(memory.cmp);

const sample = new Float64Array(2); // reused: nothing allocated per frame
const tick = () => {
  frameTime.setValue(getFrameMs()); // one text node, when its text changed
  sample[0] = getPhysicsMs();
  sample[1] = getRenderMs();
  stages.pushAll(sample); // drawn once this frame, if it shows
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

### Which piece for what

| Piece                          | For                                                            | Updating it                                                                                        |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Stat tile](#stat-tiles)       | One figure that matters, with its change                       | `setValue` as often as it changes; `setDelta` per period                                           |
| [Sparkline](#sparklines)       | A few values a second beside a figure                          | `push` at a scheduler's rate, not every frame: each push redraws its SVG                           |
| [Donut](#donuts)               | A share or a progress beside a figure; a whole of a few parts  | `setValue` as often as it changes; `setParts` now and then                                         |
| [Stacked bar](#stacked-bars)   | A whole's parts, a budget                                      | `setParts` now and then                                                                            |
| [Chart](#charts)               | A few series that change now and then, their values as a table | `setSeries`, which draws it whole                                                                  |
| [Time series](#time-series)    | Figures that change every frame                                | `push` / `pushAll` every frame: drawn at most once a frame, only while it shows                    |
| [Table](#tables)               | Figures in columns                                             | `setCell` for the figures that changed; `rows` a function on a scheduler for rows that come and go |
| [List](#lists), [tree](#trees) | An app's objects                                               | `setItem` / `setNode` for one; `items` / `roots` a function on a scheduler                         |

A field's value as a graph is a [graph monitor](hub:features/ui-kit/forms#graph-monitors).

### Long and busy collections

Each changed figure is text the browser lays out again. In a table of 500 rows, setting a tenth of
them takes a few milliseconds and every figure about 15, most of it that layout, whether by
`setCell` or a `refresh`. Past a few hundred changing rows, or about 200 rows of any kind,
`virtual: createVirtualRows()` renders only the rows the box shows (give a table's columns a
`width`, so the rows on screen don't size them); a long list or tree gets a `filter` too, since
the browser's find can't see the rows not rendered.

### Colours on a canvas

The pieces in HTML and SVG follow the theme by themselves. The time series draws on a canvas,
which can't: it reads its colours (any CSS colour, a token or a `color-mix()`) when it first
draws and again when the theme or the density changes (the system's colour scheme, or
`data-aek-theme` / `data-aek-density` written on any element), never once per frame. A canvas of
your own beside the kit's pieces does the same: give it the token as its CSS `color`, read
`getComputedStyle(canvas).color` at its first draw, and again on a
`matchMedia('(prefers-color-scheme: dark)')` change and on a `MutationObserver` of the document
for those two attributes.

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
- [`createSparkline`](api:createSparkline) ([`Sparkline`](api:Sparkline)),
  [`createDonut`](api:createDonut) ([`Donut`](api:Donut)),
  [`createStackedBar`](api:createStackedBar) ([`StackedBar`](api:StackedBar)),
  [`createChart`](api:createChart) ([`Chart`](api:Chart), [`ChartSeries`](api:ChartSeries)),
  [`createTimeSeries`](api:createTimeSeries) ([`TimeSeries`](api:TimeSeries),
  [`TimeSeriesThreshold`](api:TimeSeriesThreshold)), the parts'
  [`GraphPart`](api:GraphPart) and [`GraphPartFormat`](api:GraphPartFormat), and
  [`createStatTile`](api:createStatTile) ([`StatTile`](api:StatTile)).
- [`createContextMenu`](api:createContextMenu) for a menu over the rows, and
  [`createBindingScheduler`](api:createBindingScheduler) for a panel's live lists, trees and
  tables ([showing live data](#showing-live-data)).

## Read more

- [The UI kit](hub:features/ui-kit): components, the HUD root, styling.
- [Core components](hub:features/ui-kit/core): the badges, the tabs and the empty states a list
  sits among.
- [Windows and overlays](hub:features/ui-kit/overlays): the context menu.
- [The component library](hub:features/ui-kit/library): every piece in every state.
