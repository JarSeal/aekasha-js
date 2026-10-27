Status: in progress | Phase 0 section 1 done
Category: UI, Accessibility, Debug
Epic: p800_debugger-ui-overhaul.md
Blocks: p806_debugger-migration.md, p807_stats-and-profiler-graphs.md (p800 §5; written when each starts)
Related: \_DONE_p803_ui-kit-structure-and-core.md (the folders, coding style, overlay layer and menu this builds on; its D1 moved the pie, the debugger list, the tab buttons and the context menu here), \_DONE_p804_forms-and-bindings.md (the binding scheduler, the field shell, `ValueText.ts`, the property grid's separator; its D1 moved the label's context menu and the monitor's graph view here; its D13's opt-in pattern: D8), \_DONE_p801_design-foundation.md (the tokens; its §4 left the table's stripe and the bars' roles to this plan), p808_game-ui-components.md (the list's reorder under its inventory, the tabs and splitter under its menus), p373_merge-debug-and-member-editing.md (a tree user, after p806), `hub/_assets/ts/_search.ts` (the Hub's ⌘K search, the command palette's model: D12)

# Data Display

p800's fifth child: the components that show data, public on `aekasha/ui`. The table, the list,
the tree, the graphs (static charts, the running time series, the stacked bar, the sparkline, the
donut), the stat tile, and the pieces around them: tabs, the accordion, the splitter, the context
menu with the menu's submenus, and the command palette. Each works with live data (a figure set
every frame writes one text node, nothing else), a keyboard and a screen reader, in both themes and
densities, in an embed.

The debugger doesn't move here: its tables, lists and tab menus stay until p806 and p807, which
start from this plan's census (§4) and the dev component library's "Debugger parity" box. One
exception, as p803 did with the scene loader: the percentage pie has one user, so the ray cast tab
moves to the donut and the pie goes. Nothing breaks.

---

## 1. As found (2026-10-27, `main` at `a858c060`, Engine 5.13.0)

### 1.1 p800's p805 sketch, checked

p800 §3 and §4.4 hold, with these differences and additions:

- **Moved in from the siblings:** p803 D1 the percentage pie (the donut), the debugger list (the
  list), the tab host's buttons (the tabs) and the context menu, which opens p803's menu at the
  pointer; p803 D10 left the menu's submenus "for p805's context menu, if it needs them". p804 D1
  the label's context menu (Reset, Copy, Paste) and the monitor's graph view.
- **The debugger's tables** (greps; Phase 0's census is exact): 33 `<table>` sites in the engine,
  all HTML strings written with `innerHTML` on every refresh. The profiler's Overview
  (`profiler/_dbg__ProfilerOverview.ts`: one table, an "App" `<tbody>` group with its header row,
  row classes, rows clickable through one handler on the table by metric id), its Objects tab
  (`_dbg__ProfilerObjects.ts`: the breakdown with an in-view / culled bar in a cell and a total
  row, the worlds table, the heaviest objects), GPU memory (`gpuMemory/_dbg__GPUMemory.ts`: eight
  tables, categories, peaks, last / min / avg / max, sources, owners, untracked, diffs; a budget
  bar) and the assets tab's `table()` helper (`kernel/assets/debug/_dbg__Assets.ts:582`: the info
  window, the atlas cells). None sorts or has a sticky header; zebra rows are
  `rgba(255,255,255,0.04)`, which p801 §4 mapped to `surface-hover` with "p805's table picks the
  strength", and the bars' in-view and culled parts to `text` and `border`.
- **The debugger list** (`debug/_dbg__DebuggerList.ts`, 157 lines; `DebuggerListDef` in
  `DebuggerGUI.ts:329`): a heading with the count, rows that are one `<button>` each (sub title,
  icon, badge, title, description, suffix, a `title` tooltip), per-row icon toggles as sibling
  buttons (`aria-pressed`, `iconOff`, a spacer keeping them aligned), selected and disabled rows
  by class, an empty text. It re-renders when `JSON.stringify(items)` changed, rebuilding every
  row, and finds the focused toggle again by a query. No list role and no arrow keys: Tab visits
  every button. 13 call sites in 11 files (camera, light, ECS, physics, character, PostFX, LOD,
  assets, and three app scenes' debug modules).
- **Tabs:** the drawer's and the profiler window's icon tab menus (`_debugTabButtons.scss`' mixins;
  three tab hosts, `_dbg__TabHost.ts`: the drawer, the profiler, the editor drawer) are buttons,
  not a tab list. The key shortcuts dialog's (`_dbg__DebugKeyShortcuts.ts:542`) is a
  `role="tablist"`.
- **Graphs:** the Objects tab's "Over time" sparklines (`_dbg__ProfilerObjects.ts:405`: an SVG
  polyline string per refresh, auto-scaled, gaps where there's no value, `aria-hidden`), the CSS
  bars, and the percentage pie (`debug/_dbg__PercentagePie.ts`, 61 lines: a `conic-gradient` on
  `--p`; one user, the ray cast tab, `kernel/render/debug/_dbg__Raycast.ts`). stats-gl's canvases
  (`_dbg__Stats.ts`) are p807's.
- **None yet:** no tree, splitter, accordion, context menu or command palette in the engine. The
  Hub's ⌘K search (`hub/_assets/ts/_search.ts`, 473 lines) is the palette's model: a native
  `<dialog>`, a combobox over a listbox grouped by section, MiniSearch, snippets with the match
  marked, the last query in `sessionStorage`, a chunk of its own loaded on first use.

### 1.2 The kit this builds on

- **The menu** (`overlays/Menu.ts`, 527 lines): the APG menu button, its typeahead an internal
  `createTypeahead` (`Menu.ts:324`), the items taking the real focus, no submenus, opened at an
  anchor element.
- **The anchor** (`overlays/Anchor.ts`): `computeAnchorPlacement` takes a rect (pure);
  `showAnchored` takes an `HTMLElement`, so a menu can't open at a point yet.
- **The property grid's label column** (`forms/PropertyGrid.ts`): a focusable `separator` moved
  by the arrows (Shift ×10, Alt ×0.1) and a drag (`forms/PointerDrag.ts`): the splitter's pattern,
  inside the grid.
- **The field shell** (`forms/Field.ts`): the label, the reset button, `reset()`; no context menu.
  `forms/binding/ValueText.ts` writes and parses values as text (p804 D6's copy and paste).
  `forms/Monitor.ts` shows text only.
- **`forms/PropertyGridItems.ts` imports every field statically** (lines 11-38): a declarative grid
  carries all of them. A graph item there would put the time series into every grid (D9).
- **The scheduler** (`forms/binding/BindingScheduler.ts`, p804 D4): one `requestAnimationFrame`
  tick per host for fields with an `interval`, shown fields only. Its entries are bindings;
  nothing else can join it yet (D3).
- **No theme signal:** nothing in `ui/` listens to `prefers-color-scheme` or to `data-aek-theme`
  changes. CSS follows the theme by itself; a canvas that reads the tokens doesn't (D9).
- Usable as they are: the button and button group, the empty state, the spinner, the skeleton,
  the tooltip (`onlyWhenTruncated`, a cut cell's whole text), the popover, the search text field,
  `Kbd` handles, the overlay stack and focus trap, `getMotionFactor`.

### 1.3 Around it

- **Layout:** `UI_KIT_FOLDERS` (`devTools/layout/layoutRules.ts:34`) has no `data`; its note says
  "p805 adds `data/`".
- **The Hub:** `features/ui-kit/` has `core/`, `forms/` (with `binding/`), `overlays/`, `styling/`
  and `library/`. The library's script `hub/_assets/ts/_components.ts` is 3401 lines and
  `_componentChecks.ts` 1764, neither with a header saying why (the coding standards' 800), and
  this plan adds about fifteen pieces to both (D15).
- **SBP** (`sbp.config.ts`): the app's `_engine/ui` group 7 KiB initial, the `uiKit` profile's
  6 KiB; `_engine/ui/forms/` is 0 in both profiles' `modules`; p804 D12's pattern for p800 D10's
  "later a form and a table" is a module the `uiKit` scene's dialog imports on first open
  (`uiKitEmbedForm.ts`, its chunk budget 19 KiB).
- **Versions:** engine 5.13.0 (Golden Hour), toolkit 2.2.1 (Half Moon), app 1.17.0
  (Preschooler).

---

## 2. Decisions (proposed 2026-10-27, for review)

### D1. Scope

- **In:** p800 §4.4's pieces: the table (D5), the list (D6), the tree (D7), the graphs and the
  stat tile (D9), the tabs, the accordion and the splitter (D10), the context menu (D11) and the
  command palette (D12); what they share: the data model (D3), the keys and ARIA (D4), virtual
  rows and reorder (D8). From the siblings: the menu's submenus, the fields' context menu (D11),
  the monitor's graph view (D9), the donut in place of the pie (D9).
- **The debugger doesn't move** (p806, p807), but the ray cast tab moves to the donut and
  `_dbg__PercentagePie.ts` and `PercentagePie.scss` go (D9): one user, as p803's scene loader.
  The debugger list, the tab menus and the profiler's tables are what §4 and the parity box hand
  over.
- **If the plan runs long,** the command palette and the static charts leave as a pair: the
  palette to p806 (the debugger's actions are its first app-side users), the charts to p807. p800
  §4.4 says so then.
- **Out:** editing in cells (a cell may hold any CMP, a field included, but there's no edit mode,
  no cell validation, no commit model); a treegrid (a tree with columns: a tree node's actions are
  its context menu; a later plan if p373's member list needs columns); multi-column sort; grouping
  and aggregation by the table itself (the app passes groups); a charting library; a storage
  layer (a piece reports its sort, selection, expanded keys and sizes through `on*`, its owner
  persists them: p804 D1's rule).

### D2. Layout

`ui/data/` is new (a layout rule); the other pieces go where their kind is, as p803 D2 put them:

| Path                                                    | What                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `data/Table.ts` (`TableRows.ts` if large)               | the table (D5)                                                                             |
| `data/List.ts`                                          | the list (D6)                                                                              |
| `data/Tree.ts`                                          | the tree (D7)                                                                              |
| `data/Filter.ts`                                        | matching and marking text (the list, the tree, the palette)                                |
| `data/VirtualRows.ts`, `data/Reorder.ts`                | the opt-in behaviours (D8)                                                                 |
| `data/graphs/`                                          | `Sparkline.ts`, `Donut.ts`, `StackedBar.ts`, `Chart.ts`, `ChartScale.ts`, `TimeSeries.ts`  |
| `data/StatTile.ts`                                      | (D9)                                                                                       |
| `components/Tabs.ts`, `Accordion.ts`, `Splitter.ts`     | general layout pieces, next to the button group (D10)                                      |
| `components/RovingFocus.ts`                             | `@internal`: roving focus and typeahead (D4); the menu's `createTypeahead` moves here      |
| `components/Announcer.ts`                               | `@internal`: one polite live region per kit root (D4), unless Phase 0 reuses the toaster's |
| `overlays/ContextMenu.ts`, `overlays/CommandPalette.ts` | on the overlay stack (D11, D12); the menu's submenus in `Menu.ts`                          |
| `forms/FieldContextMenu.ts`, `forms/GraphMonitor.ts`    | the fields' menu (D11), the monitor's graph view (D9)                                      |
| `core/ThemeWatch.ts`                                    | `@internal`: the theme signal a canvas needs (D9)                                          |

Each public module is on `aekasha/ui` by name (p803 D12: one entry). The Hub's pages follow the
folders: the table, list, tree, graphs and stat tile on a new data page; the tabs, accordion and
splitter on the core page; the context menu and palette on the overlays page (D15).

### D3. Data and updates

What every collection (table, list, tree) shares:

- **Rows are the app's objects**, identified by `getKey(row)` (default `row.id`). `setRows(rows)`
  diffs by key: a kept row keeps its element (focus, selection, scroll and hover stay), a cell is
  written only when its text changed, new keys are added in place and gone keys removed. No
  `innerHTML` rebuild (the profiler's today) and no `JSON.stringify` signature (the debugger
  list's).
- **Live figures:** `setCell(key, column, value)` (a table) and `setItem(key, item)` (a list, a
  tree) write one node when the shown text changed, with no allocation (the kit's setter rule: a
  HUD value set every frame). The text of a number goes through the column's `format` into a kept
  text node.
- **On the scheduler:** a collection given `scheduler` and `interval` re-reads `rows` (a getter)
  on the host's tick while it's shown, as a monitor does (p804 D4). The scheduler gets a generic
  entry for that (`addScheduledRefresh(scheduler, refresh, interval)`, `@internal`), so a tab, a
  window and an app panel keep one tick each.
- **Text is text:** every string is written with `textContent`; rich content is a renderer that
  returns a CMP (a cell, a row, a node), which the piece removes with its row.
- **Empty:** `empty` (a text, or `createEmptyState`'s props) shows in place of the rows; a
  filtered collection with no match says so ("No matches for …") with the filter's clear action.
- **Selection:** `selection: 'none' | 'single' | 'multiple'`, `selected` (keys),
  `onSelectionChange(keys)`; a kept key stays selected across `setRows`, a gone key leaves the
  selection (reported).

### D4. Keys and ARIA for collections (p800 D8)

- **One tab stop per composite**, the arrows inside (`components/RovingFocus.ts`, which the menu
  moves onto with its typeahead). The items take the real focus, as p803 D10's menu does; only a
  combobox (the palette, a filter field over a list) keeps the focus in its input and uses
  `aria-activedescendant` (the APG combobox).
- **The patterns:**

  | Piece                                | Pattern                                        | Keys besides Tab                                                                                                       |
  | ------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
  | static list                          | `<ul>`                                         | none                                                                                                                   |
  | selectable list                      | APG listbox                                    | arrows, Home / End, PageUp / PageDown, typeahead, Space, Shift+arrows, Ctrl / ⌘+A                                      |
  | list with row actions                | APG grid (one row per item, its actions cells) | as the listbox, plus Left / Right between a row's cells, Enter on a cell                                               |
  | tree                                 | APG tree                                       | Up / Down, Right opens or enters, Left closes or leaves, Home / End, `*`, typeahead, Space                             |
  | table                                | native `<table>`, sort buttons in the headers  | none (Tab reaches the sort buttons and the cells' controls)                                                            |
  | table with selection or active cells | APG grid on the `<table>`                      | arrows over cells, Home / End, Ctrl+Home / End, PageUp / PageDown, Space, Enter / F2 into a cell's control, Escape out |
  | tabs                                 | APG tabs                                       | arrows (by orientation), Home / End; Enter / Space with manual activation                                              |
  | accordion                            | APG accordion                                  | Enter / Space; Up / Down / Home / End between headers                                                                  |
  | splitter                             | APG window splitter                            | arrows (Shift ×10), Home / End, Enter collapses and restores                                                           |
  | context menu, submenus               | APG menu                                       | the menu's, plus Right / Left into and out of a submenu                                                                |
  | command palette                      | APG combobox with a grouped listbox, modal     | Up / Down, PageUp / PageDown, Home / End in the list, Enter, Escape clears then closes                                 |

- **Announcements:** a sort ("Sorted by Size, descending"), a filter's count ("12 of 340"), a
  move ("Lamp moved to 3 of 8") and a lazy load's end go to one polite live region per kit root
  (`Announcer.ts`), never `assertive`.
- **Colour is never alone** (p800 D6): a cell's `tone` adds the status role and an icon or a word;
  a delta has its sign and an arrow; a series has its name in a legend and in the chart's table.
- **Rows are at least 24 px high** in the compact density at UI scale 1 (p800 D8), a row's action
  buttons too.
- **Reduced motion:** a reorder's lift has no movement (an outline instead), the accordion opens
  without the height animation, a chart's first draw doesn't grow.

### D5. The table

`createTable({ columns, rows, getKey?, caption, captionHidden?, groups?, footer?, selection?,
sort?, onSortChange?, sticky?, striped?, highlight?, stackBelow?, virtual?, empty?, contextMenu?,
onRowActivate?, scheduler?, interval? })` → `{ cmp, setRows, setCell, setSort, getSort,
setSelected, getSelected, scrollToKey, refresh }`.

- **Columns:** `{ key, label, value?(row), format?(value, row), align? ('start' | 'center' | 'end';
a number defaults to `end` with tabular figures), sortable?, compare?, width?, minWidth?,
tone?(row) (a status role, D4), cell?(row) (a CMP), kind?: 'bar' (D9's stacked bar in the cell,
its number as text), headerTooltip?, hidden? }`.
- **Sort:** a header's button cycles ascending, descending (and back to the rows' order with
  `sortUnset: true`); `aria-sort` on its `<th>`, the change announced; stable; `sort` given makes
  it controlled (the app sorts, the table shows), otherwise the table sorts its copy of the order.
- **Groups and footer:** `groups: [{ key, label, rows }]` as `<tbody>`s, each with a header row
  (the profiler's "App"); `footer` rows in `<tfoot>` (the breakdown's total).
- **Highlight:** `highlight: 'row' | 'column' | 'cell' | 'cross'` on hover and focus (the
  `surface-hover` role; a column through `data-highlight` on its cells); `striped` with
  `--aek-table-stripe`, its strength Phase 0's (p801 §4's open item) in both themes under the
  contrast test.
- **Sticky:** `sticky: { header?, firstColumn? }` inside the table's scroll box.
- **Responsive:** the table sits in a scroll box (`role="region"` named by the caption and a tab
  stop only while it overflows: axe's `scrollable-region-focusable`); `stackBelow: <px>` turns each
  row into a card of "label: value" lines below that container width (a container query, so an
  embed and a window measure their own box), with the table roles kept as attributes (a
  `display` change drops them in some browsers).
- **Virtual:** D8 (a spacer row before and after, `aria-rowcount`, `aria-rowindex`).

### D6. The list

`createList({ items, getKey?, title?, subTitle?, description?, icon?, badge?, suffix?, tooltip?,
render?, heading?, selection?, actions?, onActivate?, filter?, reorder?, virtual?, empty?,
contextMenu?, scheduler?, interval? })` → `{ cmp, setItems, setItem, setSelected, getSelected,
setQuery, focusKey, scrollToKey, refresh }`.

- **Rows:** the debugger list's parts, each a function of the item (`title(item)`, …) or a
  `render(item)` CMP; `heading` with the count (the shown count while filtered: "12 of 340").
- **Modes** (D4): static, selectable (a listbox: no control inside a row), or with `actions`
  (`[{ key, icon, label, pressed?(item), iconOff?, disabled?(item), onPress(item) }]`: the debugger
  list's toggles, as a grid's cells). A row's activation (`onActivate`: a click, Enter) is the
  debugger list's row click.
- **Filter:** `filter: { query?, match?, field? }`: by default every word of the query found in
  the row's text, case and accents ignored (`Filter.ts`), the matches marked with `<mark>` (text
  nodes split, no HTML); `field: true` puts a search field above the list whose ArrowDown enters
  it; the count announced.
- **Reorder:** D8.

### D7. The tree

`createTree({ roots, getKey?, getChildren?, loadChildrenAsync?, hasChildren?, label, icon?,
badge?, render?, expanded?, onExpandedChange?, selection?, onActivate?, filter?, virtual?,
contextMenu? })` → `{ cmp, setRoots, setNode, expand, collapse, focusKey, scrollToKey,
getExpanded, setSelected, getSelected, refresh }`.

- **APG tree keys** (D4) and `aria-expanded`, `aria-level`, `aria-setsize`, `aria-posinset`,
  `aria-selected`.
- **Flat or nested:** rendered as one flat `role="tree"` (the levels as attributes, which the
  APG allows), so virtual rows work the same as in a list. Phase 0 checks the flat form in
  VoiceOver and axe; if it reads worse than nested `role="group"`s, the tree nests and is virtual
  only in its flat form.
- **Lazy children:** `loadChildrenAsync(node)` shows a loading row (a spinner, `aria-busy` on the
  node) while it runs; a failure shows an error row with a retry; a node collapsed or removed
  before the promise ends drops the result (the coding standards' re-check after `await`).
- **Filter:** the matches with their ancestors, expanded while filtering, the expanded keys
  restored after.
- **First user:** the example's scene outline (D15); p806's scene and entity inspectors and p373
  later.

### D8. Opt-in behaviours: virtual rows and reorder

p804 D13's lesson: what a piece doesn't always need is a value the app passes, not an import in
the piece. A list without them carries neither.

- **Virtual rows:** `virtual: createVirtualRows({ rowHeight?, overscan? })` (`VirtualRows.ts`).
  Fixed row heights (the density's row token, or given), a spacer before and after the shown
  window, computed from the scroll box's `scrollTop` and height (a `ResizeObserver`); rows recycled
  by key; the focused row kept rendered so the focus never drops; `aria-setsize` /
  `aria-posinset` (list, tree) or `aria-rowcount` / `aria-rowindex` (table). The browser's find
  can't see rows not rendered: the guide says so, and points at the filter. No automatic
  threshold: the guide suggests it past about 200 rows. The window's math is a pure function
  (`getVirtualWindow`), tested alone.
- **Reorder:** `reorder: createListReorder({ onReorder })` (`Reorder.ts`), lists only (a tree's
  move is out). A pointer drag lifts the row (`--aek-motion-fast`; reduced motion: an outline, no
  movement), shows a drop line, scrolls at the edges; Alt+ArrowUp / Alt+ArrowDown move the focused
  row; each move announced; `onReorder({ key, from, to })`, and the app sets the new order (or the
  list keeps it, `optimistic: true`). The touch path is a drag handle (a pointer drag on the row
  would fight the scroll).

### D9. Graphs and figures

- **Sparkline** (`createSparkline({ values?, capacity?, min?, max?, label?, tone? })`): SVG, a
  polyline with gaps at `NaN`, a dot on the last value, auto or fixed scale; `push(value)` into a
  kept ring buffer or `setValues`. `aria-hidden` with its figure as text beside it (p800 D8's
  written deviation), or `label` for `role="img"`. Updated at the scheduler's rate, not per frame:
  the points' string allocates, which the perf-auditor weighs against a canvas in Phase 0.
- **Donut** (`createDonut({ value? | parts?, label, centre?, size? })`): the pie's
  `conic-gradient`, generalised: one value (0..1, `role="meter"` with `aria-valuenow`) or parts
  (`role="img"`, its label listing them, a legend). Its track `surface-hover`, its fill `text` or a
  part's colour (p801 §4). The ray cast tab moves onto it and the pie goes (D1).
- **Stacked bar** (`createStackedBar({ parts, total?, label, legend? })`): 100 % or against a
  total, flex segments with their names in `title`, `role="img"` and a label; a table cell's
  `kind: 'bar'` (D5), the profiler's frame by stage and memory by category (p807).
- **Static charts** (`createChart({ type: 'line' | 'bar', series, categories?, x?, title,
description?, yFormat?, xFormat?, stacked? })`): SVG, axes with nice ticks (`ChartScale.ts`), a
  legend, `role="img"` named by its title and description, and the values in a visually hidden
  `<table>` with a "Show as table" button that shows it. Updated with `setSeries`.
- **Series colours:** p801's tokens have no categorical set. `--aek-chart-1` … `--aek-chart-6` in
  both themes: 3:1 against `surface` (the contrast test), told apart under the common colour
  vision deficiencies (Phase 0's check), named in the design document's colour section (a group in
  `devTools/hub/generated/design.ts`). The status roles stay for status (p800 D6): a threshold
  line or a budget bar uses them, a series doesn't.
- **Time series** (`createTimeSeries({ series, capacity, min?, max?, unit?, format?, height?,
thresholds? })` → `{ cmp, push, pushAll, clear, setRange, pause, resume }`): a canvas, one
  `Float32Array` ring buffer per series, `push(seriesIndex, value)` or `pushAll(values)` per frame,
  drawn at most once per animation frame while it's shown (an `IntersectionObserver` and the
  host's visibility), sized for the device pixel ratio. No allocation per push or draw (the
  perf-auditor, D14). `aria-hidden`, with a text summary beside it (latest, min, max) updated at
  the scheduler's rate. The renderer (a path per frame or a shifted bitmap) is Phase 0's probe's
  pick. p807's stats panels build on it after the perf-auditor's pass (p800 §5).
- **The canvas's colours:** CSS follows the theme by itself; a canvas reads the tokens once and
  again on a change. `core/ThemeWatch.ts` (`onKitThemeChange(elem, fn)`, `@internal`): one
  `matchMedia('(prefers-color-scheme: dark)')` listener and one `MutationObserver` on the document
  for `data-aek-theme` and `data-aek-density`, shared by every subscriber, started by the first
  and stopped by the last. Never a style read per frame.
- **Stat tile** (`createStatTile({ label, value, unit?, format?, delta?, goodDirection?,
sparkline? })` → `{ cmp, setValue, setDelta }`): a figure in tabular figures, its unit, a delta
  with its sign and an arrow (the success or danger role only when `goodDirection` says which is
  good, and the words "up 12 %" for screen readers), an optional sparkline.
- **The monitor's graph view** (p804 D1): `createGraphMonitor` (`forms/GraphMonitor.ts`): the
  field shell with a time series of one value read at its `interval`, `min` / `max`, its value as
  text. The property grid's monitor item with `view: 'graph'` loads it with `import()` on first use
  (the grid imports every field statically, §1.2: a time series in every grid would repeat the
  colour picker's case), the row showing the text monitor until then. Phase 0 measures both ways.

### D10. Tabs, the accordion, the splitter

- **Tabs** (`createTabs({ tabs, selected?, onSelect?, activation?, orientation?, keepMounted?,
label })` → `{ cmp, select, getSelected, setTabs, setBadge }`): a tab is `{ key, label, icon?,
iconOnly? (the label as `aria-label` and a tooltip), badge?, disabled?, content: CMP | () =>
CMP }`; panels built on first show (`() => CMP`) and kept (`keepMounted`) or removed;
  `aria-controls`, `aria-labelledby`; automatic activation by default, manual for panels that
  cost something to build; an overflowing tab list scrolls with faded edges (no "more" menu here).
  The drawer's and profiler's icon menus are p806's (the tab host keeps mounting content into a
  panel the tabs give it: p806 decides).
- **Accordion** (`createAccordion({ items, level, multiple?, expanded?, onExpandedChange? })`):
  each header a heading of `level` holding a button (`aria-expanded`, `aria-controls`), each panel
  a `role="region"` while there are at most six; one or several open; the folder's motion. Not the
  folder: no field semantics, no label column, a heading level of its own.
- **Splitter** (`createSplitter({ first, second, orientation?, size?, unit?, min?, max?,
collapsible?, onSizeChange?, label })` → `{ cmp, setSize, getSize, collapse, restore }`): the
  APG window splitter (`role="separator"`, focusable, `aria-valuenow` / `-min` / `-max`,
  `aria-controls` the first pane), the keys of D4, a drag with `forms/PointerDrag.ts`. The property
  grid's label column moves onto it inside (no API change; the grid's tests pin it).

### D11. The context menu, submenus and the fields' menu

- **Submenus:** a menu item `type: 'submenu'` with `items`: ArrowRight, Enter or Space opens it
  with the focus on its first item, ArrowLeft or Escape closes it back to its item; a hover opens
  it after `--aek-submenu-delay` (150 ms) and keeps it open while the pointer travels toward it
  (the pointer's direction checked against the submenu's box); anchored to the item, flipped at
  the bounds; each level an overlay stack entry, so Escape closes one level.
- **At a point:** `showAnchored` takes `anchor: HTMLElement | { x, y }` (a zero-size rect), so a
  menu opens at the pointer.
- **Context menu** (`createContextMenu({ target, items, onOpen?, onClose? })`, `items` an array or
  `(event target) => items`): the `contextmenu` event (the browser's own menu only stays when
  there are no items; Shift+right click keeps it, as in most apps), the ContextMenu key and
  Shift+F10 on a focused element in `target` (opened at the element's corner), a touch long press
  (500 ms without moving). The focus goes back to that element. One context menu serves a whole
  collection: the table, list and tree take `contextMenu: (key) => items` and find the row from
  the event.
- **The fields' menu** (`createFieldContextMenu({ container })`, `forms/FieldContextMenu.ts`): one
  delegated context menu over the fields inside a container (a grid, a form): Reset (disabled at
  the default or read-only), Copy (`ValueText`), Paste (read on choose; a value that doesn't
  parse is the field's message; disabled where the clipboard can't be read), and "Copy as" a
  submenu for colours (hex, `rgb()`, a float triple) and vectors. Opened from the label (a right
  click) or the ContextMenu key on the control. The shell keeps each field's handle in an internal
  `WeakMap` by element, which the menu reads. An app opts in per container; p806 does for every
  debugger grid.

### D12. The command palette

- `createCommandPalette({ commands?, source?, label, placeholder?, groups?, recent?,
onRecentChange?, emptyText?, onSelect? })` → `{ cmp, open, close, isOpen, setCommands }`. A
  command is `{ id, label, group?, keywords?, description?, icon?, kbd? (a Kbd handle), disabled?,
run() }`; `source(query)` may be async (debounced, a spinner, a stale result dropped).
- A modal on the overlay layer (p803 D7: the focus trap, `inert`, the focus returned), near the
  top of the HUD bounds; an input as a combobox over a grouped listbox; ranked by `Filter.ts`'
  scorer (word starts, consecutive letters, the label before keywords) with the matches marked;
  the recent commands first on an empty query (`recent` is the app's: no storage here).
- **No key of its own:** the kit doesn't read input (it runs without the engine). The guide shows
  Ctrl / ⌘+K through an action map, the example binds it.
- **The Hub's search moves onto it** (proposed: Phase 7 section 2): its source is MiniSearch's
  results, its groups the sections, its rows the breadcrumb and the marked snippet (a row
  renderer). The Hub's own `<dialog>` code goes. If its rows, its speed or its chunk size don't
  fit, the search stays as it is and the reason is written here.

### D13. Size

- Each piece is its own module, nothing at load; `_engine/ui/data/` is 0 in the first download
  in both profiles' `modules`, as `forms/` is.
- Virtual rows and reorder are passed in (D8); the grid's graph monitor is an `import()` (D9).
- **Budgets:** the `uiKit` profile's scene gets a data window loaded on its first open
  (`uiKitEmbedData.ts`: a sortable, selectable table, a list with actions, tabs, a sparkline and a
  stat tile), with a chunk line set from `suggestBudget`: p800 D10's "later a form and a table",
  the number the Hub's size table shows. The time series and the static chart get module lines
  from Phase 5's measure.
- The ray cast tab's donut costs production nothing (debug).

### D14. Tests and checks

- **Unit tests** (Node, `KitDom`, next to each module): each piece's keys and ARIA after each
  action, its disposal (`countListeners`); `setRows`' diff (a kept row's element is the same
  object, an unchanged cell isn't written); sort stability; the selection models; `Filter.ts`'
  matches and marks; `getVirtualWindow`; `ChartScale.ts`' ticks; the time series' ring buffer and
  its draw calls against a fake 2D context; the context menu's keys and the submenus; the
  palette's combobox; the fields' menu per field state.
- **`KitDom`'s gaps** (Phase 0 lists them; p804's shims are the model): linkedom has no
  `ResizeObserver`, `IntersectionObserver`, canvas or clipboard, and its table API may lack
  `rows`, `tBodies`, `insertRow` (the pieces build with `createElement` either way). Fakes the test
  drives for the observers, a recording 2D context, a clipboard stub. What stays a browser check:
  layout (sticky, the container query's stacking, virtual rows' scroll), a real drag, the canvas'
  pixels.
- **`yarn verify:ui`:** each piece's box with its states, both themes and densities, axe, a
  keyboard script each (sort, select, the grid's cells, a reorder by keys, a tree's expand and
  lazy load, the tabs, the splitter's keys, the context menu by Shift+F10 and a submenu, the
  palette), screenshots (the time series from a fixed data set, paused); the table's stacked
  layout at a narrow box.
- **The "Debugger parity" box** (dev page only), as p804's Tweakpane parity box: one row per shape
  in Phase 0's census (each table, list, tab menu, sparkline, bar and the pie) built from the new
  pieces, so p806 and p807 start from a page that shows each.
- **The perf-auditor agent:** a table of 500 live rows refreshed at 10 Hz (`setCell` against
  today's `innerHTML`), 8 time series of 600 samples each pushed every frame, a virtual list of
  10 000 rows scrolled; on a dev page with a measuring box (`performance.now` per update, the
  frame's long tasks).

### D15. Documentation and the example

- **The Hub's UI kit section:** `features/ui-kit/data/` (the table, list, tree, graphs and stat
  tile, each with `::: demo`, its parts, custom properties and keys; a guide, "Showing live data":
  `setRows` and `setCell`, the scheduler, virtual rows, the canvas' colours, which chart for what);
  the tabs, accordion and splitter on `core/`; the context menu, submenus and palette on
  `overlays/`; the fields' menu and the graph monitor on `forms/`.
- **The component library's script is split by group first** (Phase 1): `hub/_assets/ts/_components.ts`
  and `_componentChecks.ts` into one module per group (core, forms, overlays, data) beside a
  shared one, no change to what they draw (`verify:ui` passes against the same shots). Then each
  piece's box, `DEMOS`, `COMPONENT_USES` and checks as `hub/CLAUDE.md` says.
- **The example** (proposed, the user's call per `docs/plans/CLAUDE.md`): `examples/uiKit/` gets
  an "Inspector" window: the example scene's objects in a tree beside a splitter, and tabs:
  Properties (p804's grid bound to the selected object, with the fields' menu) and Stats (stat
  tiles, a frame time series, a table of the scene's meshes sortable by triangles); a context
  menu on the tree (Focus, Hide, Copy name); Ctrl / ⌘+K opens a palette of the example's actions.
  No new scene: p808's `gameHud` builds the game pieces.
- `src/_engine/ui/CLAUDE.md` gets a `## Data display` section (an `aek:covers` on the data page)
  and lines in the overlay layer's; the root `CLAUDE.md`'s Three-folder split line for `ui/` names
  `data/`; `readme.md`'s UI kit bullet; `layoutRules.ts`' note; the design document's chart
  colours; `debug/CLAUDE.md` only for the pie's removal.

### D16. Versions

- **Engine minor** (5.14.0, or the next minor if another branch merges first): the new
  components, the menu's submenus, the chart tokens, the ray cast tab's donut. No restyle of an
  existing piece (the property grid's separator moves onto the splitter without a visible change;
  the menu's look is the same).
- **App minor** (the example's inspector, the `uiKit` profile's data window). **Toolkit:** none.
  **Project:** the Hub's data page, the library script's split, the Hub's search on the palette.
- p800 §6: branch `p805-data-display` from `main`, one PR into `main`.

---

## 3. Phases

Branch `p805-data-display` from `main`. Verification of each phase: `yarn test`,
`yarn verify:scenes` (baselines recorded on `main` before the first run), `yarn verify:baselines`,
`yarn verify:embed`, `yarn verify:ui`, `yarn sbp --profile all`, plus the phase's own checks. Each
section of a component phase: the modules with their stylesheet and test, their names on
`aekasha/ui` with JSDoc and an `@example`, their boxes on both library pages with the keyboard
scripts, the kit's `CLAUDE.md`; then `yarn test`, `tsc`, ESLint, `yarn hub:build`,
`verify:ui --only <pieces>`, `verify:baselines` (the new names recorded). Each phase stops after
each section for review.

### Phase 0: baselines and checks

1. On `main`: `yarn verify:scenes --update`, `yarn verify:embed`, `yarn verify:ui`,
   `yarn sbp --profile all` (the `_engine/ui` groups, the `uiKitEmbed` chunks: noted here).

   As found (2026-10-27, `main` at `8f4d77ed`, the code as at `a858c060`: only plans changed):

   - **`yarn sbp --profile all`:** passed, every diff unchanged, every budget within (one well
     under: the app group, 12.0 kB of 14.0). Gzip, initial / lazy:

     | Profile  | First download | `_engine/ui` group | Its budget | `uiKitEmbed` chunks (budget)                                           |
     | -------- | -------------- | ------------------ | ---------- | ---------------------------------------------------------------------- |
     | `app`    | 384.2 kB       | 5.4 kB / 42.2 kB   | 7 KiB      | –                                                                      |
     | `banner` | 287.3 kB       | 4.0 kB / –         | 5 KiB      | –                                                                      |
     | `uiKit`  | 286.4 kB       | 4.3 kB / 33.2 kB   | 6 KiB      | `uiKitEmbed.js` 16.0 kB (18 KiB), `uiKitEmbedForm.js` 17.2 kB (19 KiB) |

     `_engine/ui/forms/` is 0 initial in `app` and `uiKit` (its `modules` lines): `data/` gets the
     same lines.

   - **`yarn verify:embed`:** every check passed (banner and uiKit, `INLINE` and `BACKGROUND`, the
     UI kit at a 16 px and a 62.5 % root, the Hub's example page).
   - **`yarn verify:ui`:** every state and keyboard script passed (81 boxes and states, axe clean),
     but no screenshot baselines existed locally (87 new), so it was run again with
     `--no-build --update` on `main` to record them: Phase 1's library split compares against
     those.
   - **`yarn verify:scenes --update`:** 101 recorded; `thirdPersonGymScene` fails in its three
     debug configurations on WSL2 (SwiftShader), "the physics probe didn't reach step 600 in 300
     s". It predates this plan: its `probeSteps: 600` came with `9e15d60d` (2026-10-13) and its
     local baseline is still a 120-step entry (2026-10-22, `532910a+dirty`). The branch's runs read
     those three as known, not as p805's; a `--headed` run on a real GPU (or a longer probe
     timeout) is the fix, outside this plan.

2. **The debugger's data display census** (a one-off script in the scratchpad, not committed):
   every table (its columns, groups, footer, row classes, clickable rows or cells, bars in cells,
   refresh rate, the most rows seen in the large scenes), every debugger list (each
   `DebuggerListDef` field used, the most rows seen), each tab menu, sparkline, bar and the pie,
   with file and line. The result goes into §4 and the parity box's rows.
3. **Probes** (scratchpad pages, Chromium on WebGPU and Firefox): the time series' renderer (8
   series × 600 samples pushed each frame: a path redrawn per frame against a bitmap shifted by
   `drawImage`, at a device pixel ratio of 1 and 2), the sparkline (SVG string against a small
   canvas at 4 Hz with 40 of them), the table (500 rows at 10 Hz: `setCell` against today's
   `innerHTML`). The picks into D9 and D5.
4. **Checks that decide details:** linkedom 0.18.13's table API, observers, canvas and clipboard
   (D14's shims); the menu's typeahead and roving focus extracted with no behaviour change (its
   tests); whether the toaster's live regions can be the announcer (D2); the flat tree against
   nested groups in VoiceOver and axe (D7); container queries in the browsers `verify:ui` and
   `verify:embed` run (D5); the chart colours (six, both themes, 3:1, the common colour vision
   deficiencies simulated) and the table's stripe strength (D5, D9); the grid's graph monitor as an
   `import()` against a static import (D9); the scheduler's generic entry against its tests (D3).
5. **The Hub's search against the palette** (D12): each of its features (grouping, breadcrumbs,
   snippets, the stored query, the API entries, its chunk's size) mapped to a palette prop or a
   row renderer, or written down as a reason to keep it.

### Phase 1: groundwork

1. **The folders and the library split:** `ui/data/` and its layout rule; the library's script and
   checks split by group (D15), no change in what they draw.
2. **Shared pieces:** `RovingFocus.ts` (the menu moves onto it), `Filter.ts`, the announcer, the
   scheduler's generic entry (D3).
3. **The menu at a point and its submenus** (D11).
4. **The context menu and the fields' menu** (D11), with the shell's handle map.

### Phase 2: tabs, the accordion, the splitter

1. Tabs (D10).
2. The accordion (D10).
3. The splitter, and the property grid's label column on it (D10).

### Phase 3: the list and the tree

1. The list: static, selectable, with actions; the filter (D6).
2. Virtual rows and reorder (D8), on the list.
3. The tree: lazy children, the filter, virtual rows (D7).

### Phase 4: the table

1. The table: columns, formats and alignment, groups, footer, caption, sticky parts, stripes,
   highlight, the empty state, the scroll box and the stacked layout (D5).
2. Sort, selection, the grid mode, the context menu, cell renderers and bar cells (D5).
3. Live data: `setRows`' diff, `setCell`, the scheduler, virtual rows (D3, D8); the perf-auditor's
   pass (D14).

### Phase 5: graphs and figures

1. The sparkline, the donut (the ray cast tab moved onto it, the pie removed), the stacked bar,
   the stat tile; the chart tokens and the design document's colours (D9).
2. The static charts and their scale (D9).
3. The time series and `ThemeWatch.ts`, the graph monitor and the grid's `view: 'graph'` item; the
   perf-auditor's pass (D9, D14).

### Phase 6: the command palette

1. The palette (D12).

### Phase 7: the Hub, the example, `CLAUDE.md`, readme

1. The Hub's data page and its guide, the core, overlays and forms pages' additions, every box on
   both library pages, the "Debugger parity" box (D14, D15).
2. The Hub's search on the palette, or the reason it stays (D12).
3. The example's inspector, the `uiKit` profile's data window and its budget lines (D13, D15).
4. `src/_engine/ui/CLAUDE.md`, the root `CLAUDE.md`, `readme.md`, `layoutRules.ts`' note,
   `debug/CLAUDE.md`; p800's §5 entry for p805 (what the later plans build on) and §4 below
   completed for p806 and p807.

### Phase 8: versions and done

Engine minor, app minor, the Project entry (D16); `yarn checkVersions --against main`; the plan
marked done and renamed, with the references to its old name (p800's `Blocks`, p806's and p807's
when written, p804's and p803's `Related` / `Blocks`).

---

## 4. For p806 and p807

Filled by Phase 0's census and the later phases: what the port needs that isn't a rename. Known
now:

- **The debugger list → `createList`** with `actions` (p806): `DebuggerListDef`'s `heading`,
  `emptyText`, `perItemConfig.toggles` (`actions` with `pressed` and `iconOff`), `onClick`
  (`onActivate`), `selectedItemId` (`selected`), `data` as a function (`items` on the tab's
  scheduler), and each item's `subTitle`, `icon`, `badge`, `title`, `titlePlaceholder`,
  `description`, `suffix`, `tooltip`, `disabled`. The keys change from Tab through every button to
  one tab stop with arrows (D4): a visible change the debug suite's page says.
- **The tab menus → `createTabs`** (p806): the drawer's and profiler's icon menus (`iconOnly`), the
  key shortcuts dialog's tab list; `_debugTabButtons.scss` goes.
- **The profiler's and GPU memory's tables → `createTable`** (p807), with `setCell` for the live
  figures; the Objects tab's sparklines → `createSparkline` or the time series; the breakdown's bars
  → bar cells.

---

## 5. Risks

- **Scope:** about fifteen pieces. The phases put what p806 and p807 need first (the menu, tabs,
  list, table, graphs) and the palette last, and D1 says what leaves if it runs long.
- **Live data cost:** the profiler and GPU memory tabs show hundreds of changing figures. D3's
  diff and `setCell`, Phase 0's probes and the perf-auditor's two passes.
- **Composite widgets and screen readers:** a list with actions as a grid, the flat tree and the
  table's grid mode are where the APG patterns read differently across screen readers. Phase 0
  checks the flat tree; `verify:ui`'s axe and keyboard scripts check every box; VoiceOver by hand
  for the list, tree and table grid in their sections.
- **The canvas and the theme:** a time series drawn in the wrong colours after a theme switch.
  `ThemeWatch.ts`, and a `verify:ui` shot after a switch.
- **The Hub's search** is public and used: D12 moves it only if Phase 0's mapping fits, and keeps
  its checks.

---

## Done when

- `ui/data/` holds the table, list, tree, graphs and stat tile; `components/` the tabs, accordion
  and splitter; `overlays/` the context menu (and the menu's submenus) and the palette (or D1's
  moves are written in p800), each with tests, demos, keyboard scripts and its Hub section, and
  `yarn verify:ui` passes with no allowed violations.
- A table of 500 live rows and 8 running time series passed the perf-auditor's review; the
  scheduler serves collections as well as fields.
- The fields' context menu and the monitor's graph view are in, closing p804 D1's moves; the pie
  is gone and the ray cast tab shows the donut.
- The "Debugger parity" box shows every shape of Phase 0's census, and §4 lists what p806 and p807
  rewrite by hand.
- The Hub's data page, the library's boxes and the example's inspector are live, the `uiKit`
  profile's data window has its budget, and `yarn hub:build` passes in both modes.
- Engine minor and app minor, `yarn checkVersions --against main`.
