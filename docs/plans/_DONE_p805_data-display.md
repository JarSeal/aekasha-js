Status: implemented (Phases 0-8)
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

| Path                                                    | What                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `data/Table.ts` (`TableRows.ts` if large)               | the table (D5)                                                                            |
| `data/List.ts`                                          | the list (D6)                                                                             |
| `data/Tree.ts`                                          | the tree (D7)                                                                             |
| `data/Filter.ts`                                        | matching and marking text (the list, the tree, the palette)                               |
| `data/VirtualRows.ts`, `data/Reorder.ts`                | the opt-in behaviours (D8)                                                                |
| `data/graphs/`                                          | `Sparkline.ts`, `Donut.ts`, `StackedBar.ts`, `Chart.ts`, `ChartScale.ts`, `TimeSeries.ts` |
| `data/StatTile.ts`                                      | (D9)                                                                                      |
| `components/Tabs.ts`, `Accordion.ts`, `Splitter.ts`     | general layout pieces, next to the button group (D10)                                     |
| `components/RovingFocus.ts`                             | `@internal`: roving focus and typeahead (D4); the menu's `createTypeahead` moves here     |
| `components/Announcer.ts`                               | `@internal`: one polite live region per kit root (D4; Phase 0: not the toaster's)         |
| `overlays/ContextMenu.ts`, `overlays/CommandPalette.ts` | on the overlay stack (D11, D12); the menu's submenus in `Menu.ts`                         |
| `forms/FieldContextMenu.ts`, `forms/GraphMonitor.ts`    | the fields' menu (D11), the monitor's graph view (D9)                                     |
| `core/ThemeWatch.ts`                                    | `@internal`: the theme signal a canvas needs (D9)                                         |

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
  entry for that (`addScheduledRefresh(scheduler, refresh, { interval?, isShown })`, `@internal`,
  a wrapper over `addScheduledBinding`, whose entry Phase 0 found generic already), so a tab, a
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
  | command palette                      | APG combobox with a grouped listbox, modal     | Up / Down, PageUp / PageDown, Enter, Escape closes (Home / End stay the input's caret; Phase 0 step 5)                 |

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
- **Highlight:** `highlight: 'row' | 'column' | 'cell' | 'cross'` on hover and focus
  (`--aek-table-highlight`, the text colour at 8 %: Phase 0 found `surface-hover` too close to the
  stripe in dark and darker than a window's surface; a column through `data-highlight` on its
  cells); `striped` with `--aek-table-stripe`, the text colour at 3 % over any surface (Phase 0
  step 4, closing p801 §4's open item).
- **Sticky:** `sticky: { header?, firstColumn? }` inside the table's scroll box.
- **Responsive:** the table sits in a scroll box (`role="region"` named by the caption and a tab
  stop only while it overflows: axe's `scrollable-region-focusable`); `stackBelow: <px>` turns each
  row into a card of "label: value" lines below that container width (a container query, so an
  embed and a window measure their own box), with the table roles kept as attributes (a
  `display` change drops them in some browsers).
- **Virtual:** D8 (a spacer row before and after, `aria-rowcount`, `aria-rowindex`).
- **Layout:** `table-layout: fixed` when every shown column has a `width` (Phase 0's probe: a
  tenth off a full refresh's layout in Chromium), the browser's auto layout otherwise.

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
  the points' string allocates, which Phase 0's probe accepted against a canvas (same cost, and
  the stroke stays in CSS). `area: true` fills under the line (the census' "Over time" ones).
- **Donut** (`createDonut({ value? | parts?, label?, centre?, size? })`): the pie's
  `conic-gradient`, generalised: one value (0..1, `role="meter"` with `aria-valuenow`) or parts
  (`role="img"`, its label listing them, a legend). Without `label` it's decorative
  (`aria-hidden`, no role): a figure beside it already says what it shows, as the sparkline's
  `aria-hidden` form (p800 D8's written deviation). Its track `surface-hover`, its fill `text` or a
  part's colour (p801 §4). The ray cast tab moves onto it and the pie goes (D1): its 12 pies show
  how far each measuring window has run, beside the row's figure, so it uses the decorative form
  (§4.1).
- **Stacked bar** (`createStackedBar({ parts, total?, label, legend? })`): 100 % or against a
  total, flex segments with their names in `title`, `role="img"` and a label; a table cell's
  `kind: 'bar'` (D5), the profiler's frame by stage and memory by category (p807).
- **Static charts** (`createChart({ type: 'line' | 'bar', series, categories?, x?, title,
description?, yFormat?, xFormat?, stacked? })`): SVG, axes with nice ticks (`ChartScale.ts`), a
  legend, `role="img"` named by its title and description, and the values in a visually hidden
  `<table>` with a "Show as table" button that shows it. Updated with `setSeries`.
- **Series colours** (Phase 0 step 4 picked the six and their order: blue, orange, violet, aqua,
  yellow, magenta): p801's tokens have no categorical set. `--aek-chart-1` … `--aek-chart-6` in
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
  the scheduler's rate. The renderer is a shifted bitmap (Phase 0's probe: the new segments
  stroked on the moved image, the path redrawn whole only on a resize, a rescale, a theme change
  or a resume), the auto range growing to a nice ceiling and shrinking only after a whole buffer
  under it. p807's stats panels build on it after the perf-auditor's pass (p800 §5).
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
onRecentChange?, hint?, emptyText?, loadingText?, errorText?, hints?, renderRow?, onQueryChange?,
onSelect?, onOpen?, onClose? })` → `{ cmp, open({ query? }), close, isOpen, setCommands }`,
  generic over its command type (`@template`, so `renderRow` reads the app's own fields). A
  command is `{ id, label, group?, keywords?, description?, icon?, kbd? (a Kbd handle), disabled?,
href?, matchTerms?, run? }` (`run` or `href`: an `href` row is an `<a>`, a modified click left to
  the browser). `source(query)` returns `Command[]` or `{ commands, total }` ("50 of 214"), or a
  promise of either: a promise is debounced with a spinner (`loadingText`) and dropped when stale,
  a rejection shows `errorText`; a result returned at once renders at once.
- A modal on the overlay layer (p803 D7: the focus trap, `inert` on the HUD root's other children,
  the focus returned), near the top of the HUD bounds and the whole of them below a width, with a
  Close button, a backdrop that closes on a click and a footer of key hints (`hints`, hidden
  without hover); an input as a combobox over a grouped listbox (the groups in order of first
  appearance unless `groups` fixes one, their labels sticky); `commands` ranked by `Filter.ts`'
  scorer (word starts, consecutive letters, the label before keywords), a `source`'s results kept
  in its order; the matches marked (`matchTerms`, else the query's words; a `renderRow` marks with
  the `appendMarked` it's given); the recent commands first on an empty query, else `hint`
  (`recent` is the app's: no storage here, the query neither: `onQueryChange`, `open({ query })`,
  the query selected on open). Escape closes, never clears first.
- **No key of its own:** the kit doesn't read input (it runs without the engine). The guide shows
  Ctrl / ⌘+K through an action map, the example binds it.
- **The Hub's search moves onto it** (Phase 7 section 2; Phase 0 step 5 mapped every feature):
  its source is MiniSearch's results (`total` the full count, `matchTerms` its matched terms),
  its groups the sections, its rows the breadcrumb, the API kind badge and the marked snippet
  (`renderRow`), its stored query through `onQueryChange` and `open({ query })`, the page made
  inert and its scroll locked in `onOpen` / `onClose`. One HUD root shared with the library pages'
  chunk (`_kitRoot.ts`), above the Hub's header. The Hub's `<dialog>` code goes. If the measured
  chunk or the look don't hold up there, the search stays and the reason is written here.

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

### Phase 0: baselines and checks — done

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

   As found (2026-10-27; a scratchpad page per probe, Playwright's Chromium and Firefox, headless
   and headed under WSLg, 5 s measured after a 1 s warm-up; script time per update, the table's
   with the forced style and layout of its change). Under WSL2 both browsers rasterize in
   software, so the figures are this machine's and the comparisons are what carries over; headed
   and headless agreed. Chromium records canvas 2D calls and rasterizes them later, so its script
   time leaves the raster out: a canvas pick rests on the frame rate and on Firefox, which
   rasterizes in step (its clock has a 1 ms resolution).

   | Probe                                                                  | Chromium (median / p95 ms, fps)                     | Firefox (median / p95 ms, fps) |
   | ---------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------ |
   | Time series, 8 × 600, path per frame, DPR 1 / 2                        | 0.0 / 0.1, 60 · 0.0 / 0.1, 60                       | 0 / 1, 60 · 3 / 6, 60          |
   | Time series, 8 × 600, shifted bitmap, DPR 1 / 2                        | 0.1 / 0.2, 60 · 0.2 / 0.4, 60                       | 0 / 1, 60 · 0 / 1, 60          |
   | Time series, 8 panels (64 series), path, DPR 1 / 2                     | 0.2 / 0.4, 60 · 0.2 / 0.4, **47** (p95 frame 33 ms) | 2 / 3, 60 · **19 / 33, 46**    |
   | Time series, 8 panels (64 series), shifted bitmap, DPR 1 / 2           | 0.6 / 0.8, 60 · 1.7 / 2.4, 60                       | 1 / 2, 60 · 3 / 5, 60          |
   | Sparklines, 40 × 60 at 4 Hz, SVG `points` / canvas, DPR 2              | 0.2 / 0.5 · 0.1 / 0.3                               | 0 / 1 · 1 / 2                  |
   | Table, 500 × 6 at 10 Hz, every figure changed: `innerHTML` / `setCell` | 17.0 / 19.8 · 12.5 / 16.1                           | 21 / 24 · 12 / 16              |
   | The same with `table-layout: fixed`                                    | 15.1 / 17.5 · 10.7 / 14.1                           | 20 / 23 · 12 / 16              |
   | Table, a tenth of the rows changed: `innerHTML` / `setCell`            | 16.0 / 18.6 · 3.9 / 4.6                             | 19 / 23 · 3 / 5                |

   No case had a long task. The picks:

   - **The time series draws a shifted bitmap** (D9): each frame the drawn canvas moves one sample
     left by `drawImage` (through a back canvas) and only the new segment of each series is
     stroked. The path redraw is its full draw (a resize, a rescale, a theme change, a resume).
     The path per frame is free at one panel, but at p807's scale (several panels at DPR 2) it
     drops to ~46 fps in both browsers, the bitmap holding 60. A rescale costs a full redraw, so
     the auto range grows to a nice ceiling with headroom (`ChartScale.ts`) and shrinks only after
     a whole buffer under it, never on every new max.
   - **The sparkline stays SVG** (D9): 40 of them at 4 Hz cost ~0.2 ms either way, and SVG keeps
     its stroke in CSS (the theme without `ThemeWatch.ts`), sharp at any DPR and the census' area
     fill a `<polygon>`. The points' string allocates a few hundred bytes per update at the
     scheduler's rate, not per frame: accepted.
   - **The table writes kept text nodes** (D3, D5): `setCell` and `setRows`' cell diff are 4-5 times
     cheaper than `innerHTML` when a tenth of the rows change (the live case: a profiler's figures
     don't all move each tick), and still a quarter to a half cheaper when every figure changes.
     What remains then is the table's layout of 500 rows of new text; `table-layout: fixed` takes
     10-15 % of it in Chromium, none in Firefox, so it's what a table with every column's `width`
     given uses, not a default. A table that big refreshing every figure at 10 Hz costs ~11-12 ms a
     tick, about 12 % of the main thread: D8's virtual rows are its answer (the guide says so),
     and D14's perf-auditor pass measures it.

4. **Checks that decide details:** linkedom 0.18.13's table API, observers, canvas and clipboard
   (D14's shims); the menu's typeahead and roving focus extracted with no behaviour change (its
   tests); whether the toaster's live regions can be the announcer (D2); the flat tree against
   nested groups in VoiceOver and axe (D7); container queries in the browsers `verify:ui` and
   `verify:embed` run (D5); the chart colours (six, both themes, 3:1, the common colour vision
   deficiencies simulated) and the table's stripe strength (D5, D9); the grid's graph monitor as an
   `import()` against a static import (D9); the scheduler's generic entry against its tests (D3).

   As found (2026-10-27; scratch scripts and pages, Chromium 153 and Firefox 155 through
   Playwright, the dataviz validator for the colours):

   - **linkedom 0.18.13** has no table API (`rows`, `tBodies`, `tHead`, `insertRow`, `cells`,
     `rowIndex`, `cellIndex`, `colSpan` are all undefined), no `ResizeObserver`,
     `IntersectionObserver`, `matchMedia`, `navigator.clipboard`, 2D context (`getContext` returns
     null), `Text.splitText`, `<dialog>.showModal`, `CSS` or ARIA property reflection (`ariaSelected`
     writes no attribute); it has `MutationObserver`, settable `scrollTop`, SVG `createElementNS`,
     `Text.data` writes, `normalize('NFD')` and `Intl.Collator`. `KitDom` adds focus, the event
     order, form controls, pointer capture and shadow roots, none of these. So: the pieces build
     tables with `createElement` and read rows from their own maps, never the table API; `Filter.ts`
     marks matches by building the text nodes and `<mark>`s itself (no `splitText`); ARIA is
     written as attributes (the kit's rule already). D14's shims go into `KitDom` (Phase 1
     section 2): `stubResizeObserver` and `stubIntersectionObserver` (fakes the test fires with
     sizes and intersections), `stubMatchMedia` (a query list the test flips, `ThemeWatch.ts`'),
     `createRecording2dContext` (a canvas whose `getContext('2d')` records calls: the time series'
     draws) and `stubClipboard` (`readText` / `writeText`, the fields' menu's Paste).
   - **The menu's keys move out unchanged:** `findTypedEntry` and `getMoveTarget` (`Menu.ts:266`,
     `:294`) are pure, and the typeahead reads only each entry's lowercased `text`;
     `Menu.test.ts` pins the arrows' wrap, Home / End, a repeated letter, several letters, the
     500 ms reset and the timer cleared on removal. `RovingFocus.ts` takes them (a `getText(index)`
     in place of `Entry`, a `wrap` option: the menu and tabs wrap, a list and a tree don't, plus
     PageUp / PageDown) and the button group's roving tab stop (`ButtonGroup.ts:83-140`:
     `tabindex` 0 / -1, `focusin` keeping the last one, skipping disabled), which a list, a tree
     and tabs need and the menu doesn't (its items take the focus with `tabindex="-1"`). The button
     group moves onto it too, its tests pinning it.
   - **The announcer is its own** (D2's `Announcer.ts`): the toaster's two live regions belong to
     a toaster, which an app doesn't have to make (the engine's is debug only), and one is
     assertive. `announce(elem, text)` finds the kit root from `elem` (`closest('.aekUi')`) and
     makes one polite `role="status"` region there on first use (`aekVisuallyHidden`), emptying it
     and writing 50 ms later as the toaster does (`Toaster.ts:364`), so the same text is read again.
   - **The flat tree passes:** a flat `role="tree"` (as `<ul>` / `<li>` and as `<div>`s, with
     `aria-level`, `-setsize`, `-posinset`, `-expanded`, `-selected`) and a nested one with
     `role="group"`s both have no axe violation (WCAG 2.2 AA and best practice) in Chromium and
     Firefox, and both browsers expose the flat one's levels in their accessibility tree. VoiceOver
     can't run here (Linux): D7's flat form stands, and the VoiceOver pass is by hand in Phase 3
     section 3 (§5).
   - **Container queries** work in both browsers (`container-type: inline-size` and an
     `@container` rule computed as expected); `verify:ui` and `verify:embed` run Chromium. D5's
     `stackBelow` stands.
   - **The chart colours** (D9; validator: lightness band, chroma, adjacent CVD ΔE ≥ 8, normal-vision
     ΔE ≥ 15, 3:1 on the surface). The reference palette's first six fail 3:1 on white for aqua,
     yellow and magenta (2.82, 2.17, 2.69), and darkening them brings aqua next to orange under
     protan (ΔE 6.3); green fails in every order (next to yellow under protan, ΔE 3.0), and it's
     the success role's hue anyway. Of the 120 orders with blue first, four pass every check in
     both themes; the pick:

     | Token           | Hue     | Dark (on `#0c1321`) | Light (on `#ffffff`) |
     | --------------- | ------- | ------------------- | -------------------- |
     | `--aek-chart-1` | blue    | `#3987e5`           | `#2a78d6`            |
     | `--aek-chart-2` | orange  | `#d95926`           | `#eb6834`            |
     | `--aek-chart-3` | violet  | `#9085e9`           | `#4a3aa7`            |
     | `--aek-chart-4` | aqua    | `#199e70`           | `#16956a`            |
     | `--aek-chart-5` | yellow  | `#c98500`           | `#b07c00`            |
     | `--aek-chart-6` | magenta | `#d55181`           | `#d4508a`            |

     Worst adjacent CVD ΔE 8.3 (light, yellow and aqua, protan), 8.4 (dark); normal vision 17.1 /
     19.3; all six at least 3:1 on `surface` in both themes and on the dark `surface-raised`
     (`#141e31`). Not on the light `surface-hover` (orange 2.82): a chart doesn't sit there. The
     check is adjacent pairs, which is what D9's forms need (lines, bars, stacks). With every pair
     in play (a scatter, which D9 doesn't have), the light theme's first three pass but the dark
     blue and violet don't (normal vision ΔE 9.8; violet reads as blue under protan and deutan
     whatever its step: four tried). So a future scatter caps at two series or adds shapes. The
     status roles stay apart (no green or red series). `Tokens.test.ts` gets the six with their
     3:1 pairs on `surface` (and the dark `surface-raised`).

   - **The table's stripe and highlight** (D5): the stripe is the text colour at 3 % over whatever
     surface the table is on (`--aek-table-stripe: color-mix(in srgb, var(--aek-text) 3%,
transparent)`), the old debugger's `rgba(255,255,255,0.04)` made theme-aware: `surface-hover`
     can't be it (in dark it's darker than `surface-raised`, so it would darken a window's rows,
     and a hover on a striped row would match it: 1.01). The highlight (hover and focus) is the
     text colour at 8 % (`--aek-table-highlight`), not D5's `surface-hover`: it stays apart from the
     stripe on every surface (1.11 to 1.15) and from the surface (1.18 to 1.23). The muted text
     keeps 5.18:1 or more on both, the text more. Both are translucent: `Tokens.test.ts` gives
     them a reason (a background under text whose contrast the table's test computes over each
     surface).
   - **The graph monitor's `import()`** can't be measured before the time series exists. D9's
     `import()` stays; Phase 5 section 3 measures the time series' gzip in the grid's chunk both
     ways and makes it static only if it adds under 0.5 kB to every declarative grid.
   - **The scheduler needs no change:** its entry (`ScheduledBinding`, `BindingScheduler.ts:27`)
     is `{ read(fromRefresh), readState?, isShown, interval? }`, nothing a binding's. D3's
     `addScheduledRefresh(scheduler, refresh, { interval?, isShown })` is a thin wrapper over
     `addScheduledBinding` (the entry type renamed `ScheduledEntry`, an internal rename), so a
     collection gets `refresh()`, the tick and the read when it shows again with no new code in
     the scheduler; its tests stay as they are, plus one for a collection's entry.

5. **The Hub's search against the palette** (D12): each of its features (grouping, breadcrumbs,
   snippets, the stored query, the API entries, its chunk's size) mapped to a palette prop or a
   row renderer, or written down as a reason to keep it.

   As found (2026-10-27; `hub/_assets/ts/_search.ts`, `hub.ts`' search part, `_search.scss`,
   `devTools/hub/searchProtocol.ts`; the sizes from a scratch build with `buildScripts`' Vite
   config): **every feature maps**, none is a reason to keep the search, so it moves onto the
   palette in Phase 7 section 2 (D12). What it takes:

   | The search today                                                                                                                                                  | On the palette                                                                                                                                                                                                                                                          |
   | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | The chunk on first use (the button's focus or hover preloads; a click, ⌘K / Ctrl+K, `/` opens), then the payload by `<meta>`; a failed load tried again           | Stays `hub.ts`' (D12: no key of its own): the chunk is the palette with the Hub's source                                                                                                                                                                                |
   | "Loading the search…" until the payload is in, then the query run again                                                                                           | `source` returns a promise until then (the spinner, `loadingText`), its results once loaded synchronously: a returned array renders in the same input event, no debounce, no spinner; only a promise is debounced and dropped when stale                                |
   | "The search could not load…", tried again on the next open                                                                                                        | A rejected `source` shows `errorText` in the status; the next query calls it again                                                                                                                                                                                      |
   | MiniSearch's ranking, 50 at most                                                                                                                                  | With a `source`, the palette keeps its order (no `Filter.ts` scoring); `source` returns `{ commands, total }`, the status "50 of 214 results" (better than today's "50+")                                                                                               |
   | Groups by top-level section, ordered by each one's best result, labelled by the menu ("Home" for none); `role="group"` named by a presentation label, kept sticky | A command's `group` (a label); the groups in order of first appearance unless `groups` fixes one; the same ARIA; the labels sticky                                                                                                                                      |
   | A row: the breadcrumb (`›`), the title (or an API result's kind badge and `<code>` name), a two-line snippet around the first match                               | `renderRow(command, { appendMarked })`, the palette generic over its command type (`@template`), so the Hub's renderer reads its own fields (crumbs, kind, snippet); the breadcrumb, the snippet window and the kind badge's classes stay the Hub's                     |
   | The marks are MiniSearch's matched terms (prefix and fuzzy: `mes` marks `meshes`), longest first                                                                  | A command's `matchTerms` (default: the query's words), which `appendMarked` marks through `Filter.ts` (longest first, case and accents ignored)                                                                                                                         |
   | A row is an `<a role="option">`: Enter clicks it, a plain click closes the dialog (a same-page anchor only scrolls), a modified or middle click opens a tab       | A command's `href` (its `run` optional then): an `<a>` row, Enter follows it, a plain click closes and follows, a modified click is left to the browser with the palette open                                                                                           |
   | `aria-activedescendant`, the arrows wrap, the first result active without scrolling, the pointer's row active without scrolling                                   | The palette's (D4); Home / End stay the input's caret (the APG's editable combobox), so D4's row changes                                                                                                                                                                |
   | Escape closes and keeps the query (its first Escape would only clear a search input); the last query in `sessionStorage`, reopened selected                       | Escape closes, never clears first (D4's row changes: the reopened query is selected, so typing replaces it); `onQueryChange(query)` and `open({ query })`, the storage the Hub's (D12: none in the kit)                                                                 |
   | The status: a hint on an empty query, the count, "No results for …" with "Did you mean" links (a fuzzy title search)                                              | `hint` (an empty query with no `recent`); `emptyText` a text or `(query) => CMP` (the Hub's links); the count the palette's own, in its `role="status"` line                                                                                                            |
   | A Close button; a click on the backdrop closes; the hints footer (`↑↓`, `↵`, `esc`, `aria-hidden`), hidden under `(hover: none)`; the whole screen under 640 px   | All needed by a touch HUD too: the palette has the Close button, the backdrop click, a hints footer of `Kbd`s with the app's verbs (`hints: { select: 'to open' }`, default "to run") hidden without hover, and the whole HUD bounds below a width (a container query)  |
   | A native `<dialog>`: the top layer, the whole page inert, `::backdrop` (`--aek-backdrop`, `tokens.test.ts` checks its fallback), the page's scroll locked         | The kit's modal makes only the HUD root's other children inert (it doesn't own a host page): the Hub sets `inert` on its own page and locks its scroll in `onOpen` / `onClose` (two props D12 adds); the backdrop the palette's, `tokens.test.ts`' check moving with it |

   Besides the props, the Hub needs:

   - **One HUD root for two chunks:** `createHudRoot` throws on a second call, a Hub page has no
     `#hudRoot`, and the library pages' chunk makes one at load (`_components.ts:3397`). A ⌘K
     before that chunk ran would make it first, so both use a small `_kitRoot.ts`: the root made
     once in a slot at the end of `<body>`, by whichever runs first.
   - **Above the header:** the HUD root is `position: fixed` with no `z-index`, under the Hub's
     sticky header (`z-index: 50`): the Hub's stylesheet gives `#hudRoot` one above it (the
     library's windows and dialogs get it too).
   - **The library pages' switches:** the palette is in the HUD root, which their theme and
     density switches set, so there it follows them, as the demos' windows do: accepted.
   - **What goes from the Hub:** `_search.ts`' dialog code (the source, the rows and the snippet
     stay), most of `_search.scss` (the rows' parts stay), `hub.ts`' two `<dialog>` workarounds
     (the Escape listener's `closest('dialog')`, `isEditable`'s `dialog:not([open])`: the stack
     stops Escape and returns the focus itself).
   - **The look becomes the kit's:** the chrome on the kit's type scale and density, not the
     Hub's `rem` sizes (the colours are the same roles: `--hub-*` alias the kit's). Phase 7
     section 2 shows before and after screenshots for review.
   - **Checks:** today the dialog has none in a browser (`search.test.ts` round-trips the payload
     only). Phase 7 section 2 adds a Node test of the Hub's source against the built payload
     (groups, crumbs, marks, API rows) and a `verify:ui` script on its public Hub build's header
     search (⌘K, a query, the arrows, Enter lands on the page and anchor, Escape returns the
     focus to the button).

   **Size** (gzip): today's chunk is 9.2 kB (26.3 kB raw): MiniSearch and the protocol 6.4, the
   dialog 2.8; its styles are in `hub.css`. The kit pieces the palette will import, measured as
   stand-ins: the HUD root with `kit.scss` adds 3.9 kB of script and 1.9 kB of CSS (mostly
   `tokens.css` again, which `hub.css` has: harmless), the popover's set (the stack, the anchor,
   the focus trap, the spinner) 6.5 + 2.2, the menu's (with the typeahead and `Kbd`) 9.5 + 2.8.
   So the first search loads about 9-12 kB more, less the part of the dialog's 2.8 that goes,
   against the 373 KiB payload it loads anyway (2-3 %): accepted; on the library pages the kit's
   modules are shared with `_components`' chunk. Phase 7 section 2 measures the real chunk. Seen
   on the way, not this plan's: the payload is 373 KiB gzipped (p619: 256), its warning at 450.

### Phase 1: groundwork — done

1. **The folders and the library split:** `ui/data/` and its layout rule; the library's script and
   checks split by group (D15), no change in what they draw.
2. **Shared pieces:** `RovingFocus.ts` (the menu moves onto it), `Filter.ts`, the announcer, the
   scheduler's generic entry (D3).
3. **The menu at a point and its submenus** (D11).
4. **The context menu and the fields' menu** (D11), with the shell's handle map.

As built (section 1):

- **The layout rule:** `UI_KIT_FOLDERS` has `data` (after `forms`), its note saying what the folder
  holds (Phase 7 section 4's `layoutRules.ts` note is done). The folder itself comes with its
  first file (section 2's `Filter.ts`), and with it the SBP `modules` lines
  (`'_engine/ui/data/': 0` in `app` and `uiKit`): `sbp.config.ts` refuses a key naming no folder.
- **The library split:** `_components.ts` stays the chunk's entry (`HUB_COMPONENTS_FILE`, the
  `_components-*.js` chunk `scripts.test.ts` checks): `DEMOS` merging the group maps, the settings
  and `initComponents`. `_componentChecks.ts` keeps the step types and merges `UI_DEMO_CHECKS`, so
  `devTools/verify/*` import it as before. The groups are modules in `hub/_assets/ts/_library/`,
  each exporting its map (`CORE_DEMOS`, `CORE_CHECKS`):
  - `page.ts`: `Demo`, `ID_PREFIX`, `TOASTER_ID`, `openedIds`, `kitRoots` and the page's parts
    (`addGroup`, `addButton`, `addKitRoot`, `createPanel`, `addPanelButton`).
  - `core.ts` (the kit's `core/` and `components/`: the Hub's core page) and `overlays.ts`.
  - **Forms in three, not one** (one module would be about 2100 lines): by the Hub's three forms
    guides, `fields.ts` (855 lines), `editors.ts` and `containers.ts` (the parity box in it), and
    `stress.ts`, the dev page's two stress boxes, out of `fields.ts`.
  - `<group>Checks.ts` beside each (`stress.ts` has none). Two cross-group imports: the dialog's
    drop-down state takes `createDemoDropDown` from `fields.ts`, `overlaysChecks.ts` takes `LIST`
    from `fieldsChecks.ts`.
  - The data group's `data.ts` and `dataChecks.ts` come with Phase 3's first piece; the tabs,
    accordion and splitter go into `core.ts`, the context menu and palette into `overlays.ts`, the
    fields' menu and graph monitor into `fields.ts` (D2's pages).
- **Docs:** `hub/CLAUDE.md` (the sources and the component library: a new piece's demo in its
  group's map, its checks in the group's checks module), `docs/techniques/hub-authoring.md`,
  `devTools/verify/CLAUDE.md`, `src/_engine/ui/CLAUDE.md`'s "With it" line and the dev library
  page's intro.
- **Checked:** the moved code is the old code (a sorted-lines diff of both splits: only the
  imports, headers, group maps, `export`s and the checks' comments naming `<group>.ts` in place of
  `_components.ts`); `yarn test`, both `tsc`s, ESLint and `yarn hub:build` pass; `yarn verify:ui`
  passes against Phase 0's screenshots (every box, state and keyboard script, no new shot).

As built (section 2):

- **`components/RovingFocus.ts`** (`@internal`): `getMoveTarget(key, from, { count, orientation?,
wrap?, pageSize?, isSkipped? })` (null for another key, -1 for a move key with nowhere to go,
  which the caller still uses up; PageUp / PageDown only with `pageSize`, never wrapping, to the
  nearest item not skipped), `createTypeahead({ getCount, getText })` → `{ type(letter, from),
clear }`, `isTypeaheadKey(e)`, and `createRovingTabStop({ getElems, indexOf? })` → `{ reset,
setIndex, getIndex, onFocusIn }` (`setIndex` writes only the old stop and the new, `reset` every
  item: a long list's arrows don't rewrite every row; `onFocusIn` is the composite's listener, so
  it has nothing to dispose). The menu and the button group are on it with no behaviour change
  (their tests as they were). A disabled menu item stays focusable (no `isSkipped`); the button
  group skips disabled buttons.
- **`components/Announcer.ts`** (`@internal`): `announce(elem, text)` as Phase 0 said, the region in
  a `WeakMap` by kit root (made again if it was taken out), the body for no kit root or the Hub's
  `<html>`. Found on the way: a modal's `inert` covers the HUD root's other children, which would
  silence a region there, so the overlay stack has `KEEP_LIVE_ATTR` (`data-aek-keep-live`,
  `@internal`): a child carrying it is never made inert, and the region carries it.
- **`data/Filter.ts`** (`@internal`, with `Filter.scss`: `.aekMark`, the drop-down's match look):
  `foldText`, `getQueryWords`, `matchesWords`, `findMatchRanges(text, terms)` (ranges in the text's
  own indices through a per-character origin map: a match ends past its letters' accents, composed
  or decomposed, and surrogate pairs stay whole; overlapping and touching ranges merged, so no
  longest-first order is needed) and `appendMarked(parent, text, terms)`. **The palette's scorer**
  (D12: word starts, consecutive letters, the label before keywords) comes with the palette in
  Phase 6, which is its only user. The drop-down keeps its own match (case only), as D6 leaves it.
- **The scheduler:** `ScheduledBinding` is `ScheduledEntry`; `addScheduledRefresh(scheduler,
refresh, { interval?, isShown })` wraps `addScheduledBinding` (`refresh` gets `fromRefresh`); one
  new test.
- **`ui/data/` exists**, so `sbp.config.ts` has `'_engine/ui/data/': 0` in `app` and `uiKit`, and
  the root `CLAUDE.md`'s `ui/` line names `data/` (Phase 7 section 4's line, done here). The kit's
  `CLAUDE.md` has the three pieces as bullets of its UI kit section; Phase 7 section 4 moves the
  filter into the `## Data display` section with its `aek:covers`.
- Nothing new on `aekasha/ui` (all `@internal`), so no library box or Hub text in this section.
- **Size:** the UI kit example's lazy chunk (`exampleUiKit.js`) grew 11.5 → 11.8 kB gzip: `Menu.ts`
  lost 183 B and `RovingFocus.ts` brought 677 B (each module gzipped alone), the general move
  (skipped items, page keys, `wrap`) the list, tree and tabs will share. No initial chunk and no
  budget moved (`yarn sbp --profile all`); the baselines are recorded (`verify:baselines --update`).

As built (section 3):

- **`showAnchored` at a point:** `anchor: HTMLElement | AnchorPoint` (`{ x, y }`, viewport px), a
  box of no size that a scroll doesn't move, no anchor watch, no `matchAnchorWidth`; a new
  `themeFrom` element gives a point's overlay the forced theme and density (the context menu passes
  its target).
- **The menu's split:** `overlays/MenuItems.ts` (`@internal`) builds a level's items
  (`buildMenuItems`, `MenuEntry`), finds the hint handles of a tree of items
  (`findMenuHintHandles`) and holds `isInPointerPath`. `Menu.ts` keeps the types and
  `createMenuSurface` (`@internal`): the menu without a trigger, `open({ anchor, focus?,
returnFocus?, themeFrom? })` at an element or a point, its levels, keys, pointer and hints.
  `createMenu` is the surface with its trigger wired (no API change). Section 4's context menu
  opens the surface at the pointer.
- **Submenus** (`MenuSubmenuItem`, `type: 'submenu'`, public; also inside a group): as D11, each
  level an `.aekMenu[data-submenu]` next to the root with its own stack entry, typeahead and
  listeners. A click opens a submenu on its first item, as the keys do; a hover keeps the focus on
  the item. Hovering another item closes an open submenu at once unless the pointer is heading for
  it (the triangle from the move's start to the submenu's near edge), when the item under the
  pointer is acted on after the delay. **Hints:** a getter's handles are removed at the close from
  the open's whole item tree (a submenu never opened included), so a submenu's level stops its
  hints without removing them.
- **`--aek-submenu-delay`** (150 ms) is in `tokens.css` beside the tooltip's; the design
  document's motion table shows every `*-delay` already, and the Styling page's token row names it.
- **The library:** the menu box has a "View" menu button (submenus two levels deep, a disabled
  one, a checkbox and a choice inside), a state with a submenu open in a submenu, and two
  keyboard scripts; the File menu and the split button are unchanged (their scripts and shots
  too, the box's own shot aside).
- **Size:** the menu's code went from 5.6 to 9.3 kB minified (`Menu.ts` 6.2, `MenuItems.ts`
  3.0), so the UI kit example's lazy chunk grew 11.8 → 13.2 kB gzip; no first download and no
  budget moved. Submenus are in every menu (not opt-in, as D8's behaviours are): kept at the
  review (the context menu, the fields' menu and the debugger's menus all use them).

As built (section 4):

- **`createContextMenu`** (`overlays/ContextMenu.ts`, public with `ContextMenuProps`,
  `ContextMenuSource`, `ContextMenu`): as D11, on `createMenuSurface`. `items` a function gets the
  element and the source (`'pointer'`, `'keyboard'`, `'touch'`); `label` a string or a function of
  the element. The keys open it anchored to the focused element (below its start), not at a point.
  The browser's own `contextmenu` after the key or a long press is dropped until the menu closes
  (1 s at most): Chromium fires one for the key, at once or on its keyup.
- **The fields' copy and paste aren't `ValueText.ts`'** (it formats numbers only, §1.2 overstated
  it): each field's own clipboard code is. The shell takes a `FieldSpec.clipboard`
  (`FieldClipboard`: `getText`, `parse`, `copyAs`) and keeps a `FieldMenuEntry` per field, monitors
  included (`getFieldMenuEntry`; the form's `getFormField` stays as it was). Fields with their own:
  the number field and slider (an expression, kept to the rules), the vector, rotation, quaternion
  and pad (the parts' list; the vector's Copy as Array and Object), the colour field (Copy as Hex,
  `rgb()`, sRGB floats), the radio, segmented and select (the option's label or value) and the
  monitor (its text). The default: a string's and a boolean's both ways, a number's and an
  object's (JSON) copied only, which the range slider, angle dial, gradient and curve editors keep.
- **`createFieldContextMenu`** (`forms/FieldContextMenu.ts`, public with `FieldContextMenuProps`):
  as D11; the pointer opens it on a field's label only, the keys anywhere in the field.
- **KitDom:** `stubClipboard` only. Phase 0 put all of D14's shims into section 2, which added none
  of them: each comes with its first user (`stubResizeObserver` with Phase 3's virtual rows,
  `stubIntersectionObserver`, `stubMatchMedia` and `createRecording2dContext` with Phase 5's time
  series).
- **`yarn verify:ui`'s steps** gained `contextClickInBox` (a right click, so a state shows a context
  menu opened by the browser's own event).
- **The library:** a context menu box (`overlays.ts`: rows sharing one menu, with a checkbox and a
  submenu) and a fields' menu box (`containers.ts`, not `fields.ts`, which is at 855 lines: the menu
  is a container's opt-in; on the forms fields guide), each with states and keyboard scripts.

### Phase 2: tabs, the accordion, the splitter — done

1. Tabs (D10).
2. The accordion (D10).
3. The splitter, and the property grid's label column on it (D10).

As built (section 1):

- **`createTabs`** (`components/Tabs.ts`, `Tabs.scss`, public with `TabsProps`, `TabDef`,
  `TabBadge`, `Tabs`): as D10, plus `class`, `attr` and `id`. On `RovingFocus.ts` (the tab stop on
  the selected tab, `wrap: true`, disabled tabs skipped). Decided on the way:
  - **Every panel element exists from the start** (`role="tabpanel"`, `hidden`), so a tab's
    `aria-controls` always names one; only the content is built on first show. A CMP given as
    `content` is always kept; `keepMounted` (default true) applies to a function's.
  - **An icon-only tab's label is visually hidden text**, not D10's `aria-label`, so a badge stays
    in its name ("Lights 3"); the label is its tooltip too.
  - **`onSelect` is the user's selections** (a click, an arrow with automatic activation, Enter or
    Space); `select` and the initial `selected` don't call it, as the button group's
    `setPressedIndex`. `setTabs` removing the selected tab does: the first enabled tab takes its
    place.
  - **Manual activation**: the arrows move the focus only, the button's own click on Enter / Space
    selects, and a `focusout` leaving the list puts the tab stop back on the selected tab (the APG
    example leaves it on the last focused one, so Tab from there could land on the selected tab).
  - **A disabled tab** is the native `disabled` (not focusable, passed over by the arrows). No
    typeahead and no Delete (the APG's optional keys).
  - **The overflow:** a passive `scroll` listener and a `ResizeObserver` write `data-overflow`
    (`start`, `end`, `both`), a CSS mask fades those edges (`--aek-tabs-fade-size`, with
    `scroll-padding` so a focused tab clears it); `select` and a resize centre a tab that's cut or
    under a fade by scrolling the list itself (never `scrollIntoView`, which scrolls the page too). The focus ring is inset: the scroll box would
    cut an outer one. No `wrap` option (§4.1's drawer: p806 decides).
- **The library:** the tabs, accordion and splitter are a group module of their own,
  `_library/layout.ts` and `layoutChecks.ts` (`LAYOUT_DEMOS`, `LAYOUT_CHECKS`), not `core.ts`: it
  was at 633 lines, and the three would pass the coding standards' 800. The tabs box: automatic
  with a badge and a disabled tab, manual with a panel built on first selection, vertical icon-only,
  and ten tabs in a narrow box ("Select Layer 6": both edges faded); four keyboard scripts.
- **The Hub:** the core page's `## Tabs` section (after the loading overlays: the accordion and
  splitter join it), its intro, tags and key APIs; both library pages' box and texts;
  `COMPONENT_USES`. The root `CLAUDE.md`'s `components/` list names the tabs.

As built (section 2):

- **`createAccordion`** (`components/Accordion.ts`, `Accordion.scss`, public with `AccordionProps`,
  `AccordionItem`, `Accordion`): as D10, which named no handle: `{ cmp, expand, collapse,
isExpanded, getExpanded }` (D7's tree names). An item is `{ key, title, content, disabled? }`,
  its content built on its first open (a function's) and kept. `onExpandedChange(keys)` is the
  user's clicks only (as the tabs' `onSelect`); `expand` without `multiple` shuts the open one.
  Each header is a tab stop (the APG accordion), Up / Down / Home / End between the enabled ones,
  wrapping. The folder's height motion, copied (a grid row, a timer per section), not shared: the
  folder's is tied to its scheduler and form revealer. Shut with the focus inside, the focus goes
  to its header.
- **The library:** in `layout.ts` (a help list with one open, settings with several, a disabled
  section and a panel built on first open; "Open every section"), two keyboard scripts. The core
  page's `## Accordions` section, after the tabs. The demos' text panel (`createTextPanel`) is
  shared by the tabs and the accordion, padded only inside a tab panel.

As built (section 3):

- **`createSplitter`** (`components/Splitter.ts`, `Splitter.scss`, public with `SplitterProps`,
  `Splitter`): as D10, plus `step`, `collapsed` and `onCollapsedChange` (a collapse isn't a size:
  `onSizeChange` reporting 0 would be persisted and restored as one), and `isCollapsed`.
  `orientation` is the panes' (side by side by default: the separator's `aria-orientation` is
  vertical). Defaults: 50 % from 10 to 90 by 1, or 240 px from 0 to the measured room (a
  `ResizeObserver` only without a `max`) by 10. Collapsed, the first pane is `hidden` and its size
  kept; an arrow or a drag restores it. The gutter is `--aek-splitter-gutter` (`--aek-space-3`),
  its pointer target a 24 px `::after` over the panes' edges (a 24 px gutter, the grid's, would be
  too wide between panes).
- **`components/SeparatorInput.ts`** (`@internal`): the keys and the drag, the value its owner's
  to keep and draw; no styles, so the property grid carries none of the splitter's. **The
  property grid's label column is on it** with no API or behaviour change (its tests as they
  were, `getStepModifier` no longer imported there); it uses `forms/PointerDrag.ts`, as D10 said
  (the grid had its own pointer code).
- **The library:** in `layout.ts`: a collapsible outline beside its properties in percent and a
  stacked editor and console in px ("Collapse the outline"), two keyboard scripts. The core page's
  `## Splitters` section, after the accordions.

### Phase 3: the list and the tree — done

1. The list: static, selectable, with actions; the filter (D6).
2. Virtual rows and reorder (D8), on the list.
3. The tree: lazy children, the filter, virtual rows (D7).

As built (section 1):

- **`createList<T>`** (`data/List.ts`, `List.scss`, public with `ListProps`, `ListAction`,
  `ListFilter`, `List`; the rows' parts in `data/ListRow.ts`, `@internal`, so `List.ts` stays under
  800 lines): as D6, minus `reorder` and `virtual` (section 2), plus `label` (the name without a
  heading), `headingLevel`, `isPlaceholder` (the debugger's `titlePlaceholder`), `disabled`,
  `selected`, `onSelectionChange`, `getQuery` and `getKeyAt`. Decided on the way:
  - **No `contextMenu` prop** (D6, D11 named one): the list would import the menu (about 10 kB
    minified) whatever the app does with it, which D8's lesson rules out. The app makes
    `createContextMenu` on `list.cmp.elem` and finds the row with `getKeyAt(elem)` (one context
    menu over the whole list, as D11 wanted); the tree and the table do the same. The JSDoc, the
    Hub page and the context menu's dev note say so.
  - **`empty`** is a text or a CMP the app made (`createEmptyState`'s), not its props: the list
    imports neither the empty state nor the button. No match is the list's own line and a "Clear
    the filter" link-styled button.
  - **The modes** (D4): `static` (`<ul>`) without `selection`, `onActivate` or `actions`; a listbox
    with a `selection` or `onActivate` (a list with only `onActivate`, the debugger's row click,
    is a listbox with no `aria-selected`); a grid with `actions`. Each action cell holds its own
    `<button>` (not `createButton`: its toggle flips itself and has no icon setter), `aria-pressed`
    from `pressed`, re-read after a press; `hidden` keeps the cell's width (`visibility`); a
    disabled row's actions are disabled.
  - **Selection doesn't follow the focus** (the arrows move only): Space selects (toggles in a
    multiple selection), Enter and a click activate and, in a single selection, select. Shift + a
    move or a click selects the range from the anchor, Ctrl / ⌘ + click toggles, Ctrl / ⌘ + A the
    shown rows in place of the selection (again: none). A disabled row stays focusable (the menu's
    rule) and is never selected or activated. Home / End go to the first / last row in a grid too
    (D4's "as the listbox"), keeping the column like Up / Down.
  - **The selection model is shared:** `data/Selection.ts` (`@internal` but `SelectionMode`, public:
    `ListProps` names it, and the tree and table take it), `createSelection({ mode, getOrder })`
    with the gestures, the anchor and `retain`; no DOM.
  - **The tab stop is the list's own** (element based: a grid's stop can be an action button), not
    `createRovingTabStop` (index based over one element per item); the keys use `getMoveTarget`
    and the typeahead.
  - **The filter field is a searchbox, not D4's combobox:** the focus moves into the list on
    ArrowDown (D6), so no `aria-activedescendant`. Escape empties it through an overlay stack entry
    while it has a query and the focus (a dialog around it stays open). The matched text is the
    title, sub title, description, suffix and the badge's label; all but the badge are marked.
  - **`BadgeValue`** (`Badge.ts`, public) is the badge prop's type the tabs and the list share,
    written by `updateBadge` (`@internal`); `TabBadge` is its alias (no API change).
  - **Focus kept:** `setItems` moves only the rows out of place (a moved focused row keeps the
    focus); a removed or filtered out focused row gives it to the row now at its place.
- **The library:** `_library/data.ts` and `dataChecks.ts` (`DATA_DEMOS`, `DATA_CHECKS`): static
  parts, twelve scene objects (single, the filter field, a scrolling box; "Filter by “zz”"), five
  layers (multiple) and four lights (a grid; "Empty the lights"); a clicked-row state and four
  keyboard scripts.
- **The Hub:** the data page is new now (`features/ui-kit/data/`, order 18, a `table` icon from
  lucide), with its `## Lists` section; Phase 7 section 1 adds its "Showing live data" guide and
  the other pieces. The UI kit overview's pieces table and intro link it. No `aek:covers` yet:
  the kit's `CLAUDE.md` has the list and the selection as bullets of its UI kit section, which
  Phase 7 section 4 moves into `## Data display`.

As built (section 2):

- **Opt-in by handle, not by import** (D8): `createVirtualRows({ rowHeight?, overscan? })`
  (`data/VirtualRows.ts`) and `createListReorder({ onReorder, optimistic? })` (`data/Reorder.ts`)
  return opaque handles (`{ kind }`: `VirtualRows`, `ListReorder`), their code kept in a `WeakMap`
  by handle in their own module; the list calls `useVirtualRows(props.virtual)` /
  `useListReorder(props.reorder)` (`@internal`, a lookup each), so a list without them carries
  none of their code (the scheduler's states' pattern). Public on `aekasha/ui` with
  `VirtualRowsProps`, `ListReorderProps`, `ListReorderChange`. The tree (section 3) takes the same
  `virtual`.
- **Entries and rows:** the list now keeps an entry per item (`ListEntry`: the parts as last read,
  the folds for the filter and the typeahead, the selected and shown state) and a row
  (`ListRow`, the elements) per rendered entry: every entry without virtual rows (as section 1),
  the window's with them, a row let go of pooled and bound to another entry (writing only what
  differs). The tab stop is kept by key and cell, not by element (a recycled element may show
  another key). `ListTypes.ts` holds the public types, so `List.ts` stays under 800 lines.
- **Virtual rows:** as D8, the window from `getVirtualWindow` (pure, tested alone), the box's
  `scrollTop` and height kept from a passive `scroll` listener and a `ResizeObserver` (no layout
  read per scroll). One height for every row: `rowHeight`, or the first rendered row's measured
  once (28 px until then), written as `--aek-list-row-height`; the box defaults to 12 rows tall
  (`--aek-list-max-height`). The tab stop's row and a dragged one stay rendered out of the window,
  `data-pinned` at their offset (absolute, after the bottom spacer), so the focus never drops.
  `aria-setsize` / `aria-posinset` on each rendered row (a grid: `aria-rowcount` on the box,
  `aria-rowindex` on the rows). A move key, the typeahead and `focusKey` scroll to the row and
  render it before focusing it. KitDom's `stubResizeObserver` came with it (Phase 1's note).
- **Reorder:** as D8 (Alt + ArrowUp / ArrowDown; a pointer drag past 4 px, on a touch screen from
  the row's `.aekList__handle`, `touch-action: none`; the lifted row `data-dragging`, following by
  a `translateY` unless the motion factor was 0 at the start, a dashed outline either way; the
  drop line; the edge scroll within 32 px; Escape cancels through an overlay stack entry; the
  click after a drop stopped; each move announced). Decided on the way: not while filtered (a
  move among hidden rows has no clear place) nor on a disabled row; a list with `reorder` is a
  listbox at least (keys need a focusable row); `optimistic` moves the entry by a `setItems` of
  the list's own items, so the app's next `setItems` wins.
- **Found on the way:** moving the focused row's element (a reorder, any `setItems` that moves
  it) blurs it in a browser, and a focus given back by script shows no ring in Chromium. The
  placement now keeps the focused row in place and moves the others around it. Also, Chromium
  doesn't switch to keyboard focus rings for a key pressed with Alt, Ctrl or ⌘: the reorder's
  keyboard script starts with a plain arrow, as a keyboard user does.
- **The library:** the list box gained 5,000 virtual assets with a filter field and a
  reorderable draw order, and two keyboard scripts (End to the last of 5,000 with its place, the
  filter finding one far down; Alt + arrows with the focus kept). The drag is a pointer's: unit
  tests only (`Reorder.test.ts`).
- **Size:** no first download moved (`verify:baselines`' bundles unchanged; nothing in the app or
  the embeds uses the list yet). Phase 7 section 3's data window measures the list's chunk.

As built (section 3):

- **`createTree<T>`** (`data/Tree.ts`, `Tree.scss`, public with `TreeProps`, `TreeFilter`, `Tree`;
  its model in `data/TreeNodes.ts`, no DOM, and its rows in `data/TreeRow.ts`, both `@internal`,
  so `Tree.ts` stays under 800 lines): as D7, with the list's names where D7 differs: `title` for a
  node's text (D7's per-node `label`; `label` is the tree's accessible name, as the list's), plus
  `suffix`, `tooltip`, `isPlaceholder`, `disabled`, `heading`, `headingLevel`, `selected`,
  `onSelectionChange`, `empty`, `loadingText`, `errorText`, `scheduler`, `interval`, and on the
  handle `isExpanded`, `reloadChildren`, `setQuery`, `getQuery`, `getKeyAt`. No `contextMenu` prop
  (section 1's reason). Decided on the way:
  - **The children:** `getChildren(node)` returning an array is the children (read on every
    refresh); `null` / `undefined` hands the node to `loadChildrenAsync` (without it a leaf), so a
    tree can mix both. `hasChildren` says whether a node not loaded yet shows as one that opens
    (default true); once loaded, its children say.
  - **The tree reads every known node on a refresh** (the filter matches them all): the nodes
    `getChildren` gives and the lazy nodes' loaded children, never starting a load. A repeated key
    is passed over (its first place wins), so a cycle ends.
  - **Only the shown lines have rows**, with or without `virtual` (a closed subtree has no
    elements; the rows go to a pool and are bound again). `aria-setsize` / `aria-posinset` count
    the shown siblings (while filtering, the shown ones).
  - **Lazy loads:** a record per load; a close before the end, the node's removal, `reloadChildren`
    or the tree's removal drops the record, and the result is dropped when it comes (checked after
    the `await`). A loaded result is kept (closed and opened again: no second load) until
    `reloadChildren`. The loading row is `aria-hidden` (the node's `aria-busy` says it, and the end
    is announced: "Props: 3 items", or the error text); the error row is a `treeitem` one level
    down whose Enter, Space or click retries (a row, not a button: a button inside a tree is
    axe's `aria-required-children`). `expanded` keys of nodes not known yet are kept, so a
    restored lazy subtree opens level by level as it loads; `getExpanded` gives the known ones in
    the tree's order, then the others.
  - **The filter's opens and closes are its own:** while filtering the matches' ancestors show
    open unless the user closed them (unreported); the expanded keys come back when the query is
    cleared, with the tab stop's ancestors opened so the node the user reached stays shown
    (reported when the user cleared it). Code's `expand` / `collapse` while filtering change both.
    A node is expandable in the filter's view only with a match below it (the filter doesn't
    search a lazy node's unloaded children).
  - **Keys and clicks** (D4's APG tree, plus PageUp / PageDown as the list): Enter is
    `onActivate`, or opens and closes without it; a click on the twisty opens and closes, on a row
    selects and activates, or opens and closes in a tree with neither `selection` nor `onActivate`.
    A disabled node isn't selected or activated, but opens and closes. Closing a node with the
    tab stop under it moves the stop and the focus to it. `focusKey` and `scrollToKey` open the
    node's ancestors first (unreported, as `expand`).
  - **What the list and the tree share** moved out of `List.ts` into `data/CollectionParts.ts`
    (`@internal`, with `CollectionParts.scss`): the heading with its count, the search field with
    its overlay stack entry, the empty and no match lines, `placeElems`, `createElem`,
    `writeAttr`, `useCollectionKey`. `block` names each piece's classes (`aekList__search`,
    `aekTree__search`, unchanged for the list), the stylesheet styles both; `List.ts` went from
    804 to 700 lines. `VirtualRowsImpl.attach` takes `{ spacerTag, spacerClass,
rowHeightProperty }` (`VirtualRowsParts`) for the tree's names.
  - **VoiceOver** (Phase 0 left the flat tree's pass by hand to this section): not run (Linux);
    still open for §5's by-hand pass on a Mac. axe in `verify:ui` checks the flat form.
- **The library:** the tree box in `data.ts` / `dataChecks.ts`: a scene outline (single
  selection, a filter field, a scrolling box), lazy asset folders (the remote library failing every
  other try, the archive taking a minute) and 5,040 tiles with virtual rows and a multiple
  selection; "Filter by “ro”" and "Open the slow and the failing folders" states, a clicked-row
  state, four keyboard scripts (the APG keys, the filter with a cleared query, lazy children with a
  failure and its retry, virtual rows).
- **The Hub:** the data page's `## Trees` section and its key APIs, its intro and tags, the UI kit
  overview's pieces table, both library pages' box and texts, `COMPONENT_USES`.
- **Size:** no first download moved (`verify:baselines`' bundles unchanged: nothing in the app or
  the embeds uses the tree yet). Each module minified and gzipped alone: `Tree.ts` 4.1 kB,
  `TreeNodes.ts` 1.8, `TreeRow.ts` 1.7, `CollectionParts.ts` 1.3 (shared with the list, which lost
  as much). Phase 7 section 3's inspector measures the tree's chunk.
- **Seen on the way, not changed:** virtual rows measure the row height once (D8), so a box made
  in one density keeps that height after a switch to the other (the library's density switch shows
  it on the list's and the tree's virtual boxes). The table's virtual rows (Phase 4 section 3) are
  the place to measure again on `ThemeWatch.ts`' density change (Phase 5 section 3), if wanted.

### Phase 4: the table — done

1. The table: columns, formats and alignment, groups, footer, caption, sticky parts, stripes,
   highlight, the empty state, the scroll box and the stacked layout (D5).
2. Sort, selection, the grid mode, the context menu, cell renderers and bar cells (D5).
3. Live data: `setRows`' diff, `setCell`, the scheduler, virtual rows (D3, D8); the perf-auditor's
   pass (D14).

As built (section 1):

- **`createTable<T>`** (`data/Table.ts`, `Table.scss`, public with `TableProps`, `TableColumn`,
  `TableGroup`, `TableTone`, `Table`; the types in `data/TableTypes.ts`): section 1's part of D5,
  `{ cmp, setRows, setGroups, setFooter, scrollToKey, getKeyAt, refresh }`. Section 2 adds `sort`,
  `selection`, the grid mode, `cell`, `kind: 'bar'`, `headerTooltip` (on the sort button: a
  tooltip on a header that isn't focusable reaches no keyboard) and `onRowActivate`; section 3
  `setCell`, `scheduler`, `interval` and `virtual`. Decided on the way:
  - **Rows by key from the start** (D3), so section 3 adds `setCell` and the scheduler on them: a
    row's element and cells kept across the rows, groups and footer (a key's first place wins), each
    cell's text one kept `Text` node written only when it changed, the elements moved only where
    out of place (`CollectionParts.ts`' `placeElems`).
  - **Groups after the rows:** `rows` are the first `<tbody>` (no header), `groups` (`{ key, label,
rows }`) a `<tbody>` each after them with a `<th scope="rowgroup" colspan>` header row, the
    census' Overview shape; a group without rows is hidden. `setGroups` and `setFooter` beside
    `setRows`.
  - **Alignment:** a column's `align`, else `end` once its first non-null value is a number (kept
    from then on, so a column doesn't flip); every figure is in tabular figures (the census' tables
    all are). `rowHeader` columns are `<th scope="row">`.
  - **The stripe and the highlight aren't tokens:** `--aek-table-stripe` and
    `--aek-table-highlight` are the table's custom properties with Phase 0's values as fallbacks
    (`color-mix(in srgb, var(--aek-text) 3% / 8%, transparent)`), resolved on the cell, so they
    follow the theme with no copy per theme in `tokens.css` and need no `Tokens.test.ts` reason.
    They paint through a row's `--aek-table-row-tint`, which a sticky cell paints over its opaque
    `--aek-table-bg` (default the surface; the table's box is transparent).
  - **The column highlight is the `<col>`'s background** (`data-highlight`, under the rows'), set
    from `pointerover` / `focusin` on the `<table>`: one attribute per change, not one per cell.
  - **`stackBelow` is a `ResizeObserver`, not a container query:** a container query's condition
    can't read a per-table width. The observer measures the table's own box, as D5 wanted. With
    `stackBelow` every part carries its table role and each cell an `aria-hidden` label, shown
    stacked.
  - **The box is a region only while it overflows** (the same observer on the `<table>`): a
    `role="region"` named by the caption with `tabindex="0"`, so a table that fits adds no
    landmark.
  - **Tones** (`TableTone`: `info`, `success`, `warning`, `danger`): the role's colour and a mark
    (a CSS escape, said as nothing through `content: … / ''`); the text says the status.
  - **The empty state** is a row across every column (`empty`'s text or CMP).
- **The library:** the table box in `data.ts` / `dataChecks.ts`: a profiler's overview (a group,
  stripes, the row highlight, tones), the GPU memory by owner (sticky header and first column in a
  box that scrolls both ways, a total, the cross highlight) and assets stacked in a narrow box;
  "Empty the overview"; a keyboard script (the overflowing box is a named tab stop, the narrow one
  stacks).
- **The Hub:** the data page's `## Tables` section and key APIs, its intro and tags, the UI kit
  overview's table, both library pages' box and texts, `COMPONENT_USES`.
- **Size:** no first download moved (`verify:baselines`' bundles unchanged). `Table.ts` alone is
  2.5 kB minified and gzipped (the parts it shares with the list besides).

As built (section 2):

- **Three modules, not one** (`Table.ts` would pass 800 lines): `data/TableRows.ts` (`@internal`:
  a column's header with its sort button and tooltip, a cell's text, CMP or bar written where it
  changed, `writeTableBars`, `compareTableValues`, `createTableSorter`) and `data/TableGrid.ts`
  (`@internal`: the grid's tab stop, keys and clicks, the way into and out of a cell's control);
  `Table.ts` keeps the render, the sort's state, the selection and the handle (576 lines).
- **Sort** as D5, with these decisions:
  - **`manualSort`, not "`sort` given makes it controlled":** the kit's pieces take a start value,
    a setter and a user's `on*` (the tabs' `selected`, `select`, `onSelect`), so `sort` is the sort
    at the start, `setSort` / `getSort` code's (unreported), `onSortChange` the user's, and the
    table sorts its copy of the order on every render. `manualSort: true` is D5's controlled case
    (a server's or a paged source's order): the sort shown (`aria-sort`, the mark) and reported,
    the rows kept as given.
  - **What sorts:** the rows and each group's rows apart, never the footer; a tie in the order
    given (stable); empty values (`null`, `undefined`, `''`, `NaN`) last in either direction;
    numbers as numbers, text by an `Intl.Collator` with `numeric` (made on the first sort, none at
    load), a bar's array by its total; a column's `compare(a, b)` over that (negated descending).
    The values come from the cells (`writeTableRow` keeps each), so a sort reads no value again.
  - **The header:** `<th data-sortable aria-sort>` holding `button.aekTable__sort` (the label and
    `__sortMark`, two CSS triangles, `aria-hidden`: the direction is a shape, not only a colour).
    `aria-sort` only on the sorted column (the APG sortable table). The cycle: ascending,
    descending, then ascending again, or the rows' own order with `sortUnset`. Every new column
    starts ascending. The change announced: "Sorted by Size, descending" or "Not sorted".
- **The grid** (D4's "table with selection or active cells") is the table with a `selection` or
  `onRowActivate`; a table with only cell controls stays native (Tab reaches them). The arrows
  reach the header row (a sortable header's button takes the focus in its cell's place, its Enter
  and Space its own click) and a group's header row (one cell: Up / Down keep the column it
  doesn't have). D4's keys, plus Shift + a vertical move (a range), Ctrl / ⌘ + A and the clicks as
  the list's (Phase 3 section 1: selection doesn't follow the focus; Space picks, Enter or a
  plain click activates and, in a single selection, selects). The tab stop starts on the first
  selected row, else the first data row. **The footer's rows** are cells the arrows reach but are
  never selected or activated (a total isn't an item). Enter or F2 on a cell holding a control
  (`cell`'s CMP) focus its first control; Escape or F2 there go back to the cell, Escape through
  an overlay stack entry while the focus is in a cell's control (so a dialog around the table
  doesn't close first). A `cell` CMP's controls get `tabindex="-1"` when made (one tab stop). In
  a grid the overflowing box is a region but not a tab stop: its cells scroll it. A Shift press on
  a row prevents its default and focuses the cell by hand, so a range click selects no text (found
  in the browser's shots; the list and tree use `user-select: none`, but a table's figures stay
  copyable).
- **`cell(row)`** is a CMP in place of the text, made again when the row is another object (the
  list's `render` rule), removed with its row and the table; the value still sorts the column. The
  census' two-line cells use it (the library's heaviest objects).
- **Bar cells: the table's own, not D9's stacked bar.** `createStackedBar` comes in Phase 5, and a
  table importing it would carry it whether a column has a bar or not (D8's lesson). A
  `kind: 'bar'` cell is a track with a segment per number (the value a number or an array, as the
  census' in view and culled), each its share of the column's `barMax`, else of the column's
  largest total over the rows, groups and footer (so a total in the footer makes them shares, the
  census' breakdown), `aria-hidden`, the text (`format`; an array's default its numbers joined by
  `/`, hidden when empty) beside it. Colours `--aek-table-bar-1` to `-4` (the text, the text at
  35 %, muted, `border-strong`: p801 §4's in view and culled). Phase 5 section 1 decides whether
  the stacked bar shares its styles.
- **`headerTooltip`** is a `createTooltip` on the sort button, or on a `<th>` that isn't sortable
  (its description; the keyboard reaches it only in a grid). The table imports the tooltip, as the
  list does.
- **The context menu** needs nothing new: `getKeyAt` (section 1) finds a cell's row, and the
  ContextMenu key or Shift+F10 on a grid's focused cell opens a `createContextMenu` on
  `cmp.elem` anchored to it (the library's heaviest objects).
- **Stacked with sortable columns:** a visually hidden header would hide a focusable button, so
  the stacked head shows the sortable headers as chips above the cards (the others stay hidden but
  read).
- **The library:** two new tables in the table box, the objects by kind (sorted by triangles,
  descending; a bar of in view and culled against the footer's total; a header tooltip) and the
  heaviest objects (a grid: a multiple selection, an object and its owner on two lines, an Edit
  button cell, a context menu); the stacked assets sortable; a status line. States: a row clicked,
  a row's context menu; three keyboard scripts (a header's sort, the grid's keys and selection,
  Enter into a cell's button and Shift+F10).
- **The Hub:** the data page's Tables section (sorting, cells, bars, selecting and opening, the
  context menu, a "Keys in a grid" table) and key APIs (`TableSort`), its intro and tags, the UI
  kit overview's row, both library pages' texts.

As built (section 3):

- **Records and views** (D8's "rows recycled by key", which section 1's element per row couldn't
  do): a record per row (its key, row, the values read for every shown column, its grid row,
  order, place among the ungrouped rows) and a view per rendered row (the `<tr>` and its cells),
  pooled and bound to another record, written only when it shows another record or is behind its
  read. Without `virtual` every record keeps a view, as section 1's rows did (its tests unchanged).
  A render is the read (the values, the sort, the bars' lengths, the selection's order, the grid's
  rows) and the placing; a virtual scroll is the placing alone (never a read or a sort).
- **`setCell(key, column, value)`** as D3: the record's value, the rendered cell's text node
  written when its text changed, nothing allocated of the table's own. It doesn't sort (a row
  jumping under the pointer at a figure's rate), and the value holds until the row is read again;
  on a bar column the column's bars are measured again (O(rows)).
- **`scheduler` / `interval`** as the list's (`addScheduledRefresh`).
- **Virtual rows** as D8, with these decisions: **only the ungrouped rows** are virtual (the
  groups and the footer, short, always render); the spacers are `<tr>`s with one cell across the
  columns; `aria-rowcount` / `aria-rowindex` count the header row, the rows, the groups' header
  rows and the footer's; the stripes follow the row's place (`data-stripe`), not the child order;
  **the tab stop's row out of the window is rendered visually hidden** after the bottom spacer
  (the list puts it at its offset: an absolute `<tr>` would leave the table's columns, and the row
  is off the box's view anyway); **`VirtualRowsView.setInset(top, covered)`** (new, 0 for the list
  and the tree): the table's rows start below its caption and header row, and a sticky header
  covers the box's top, measured once in the page and on a resize. `stackBelow` is ignored with
  `virtual` (cards aren't one height). The guide says to give every column a `width` (the auto
  layout would size the columns by the rows on screen).
- **Density change** (Phase 3's note): not done; virtual rows still measure their height once.
  Phase 5 section 3's `ThemeWatch.ts` is where it can be added for the list, the tree and the
  table at once.
- **The perf pass** (D14): the dev page's "Tables under load" box (500 rows of five figures, every
  column a width, a sticky header and stripes; updates at 10 Hz) and a virtual one (10,000 rows),
  each update's script time with the style and layout it forces (read back at once, as Phase 0's
  probe), in headless Chromium under WSL2 (software raster) on the dev server:

  | Mode                                         | Update, median / p95 | Frames |
  | -------------------------------------------- | -------------------- | ------ |
  | 500 rows, `setCell` on a tenth of the rows   | 4.7-5.1 / 5.8-6.1 ms | 60 fps |
  | 500 rows, `setCell` on every figure          | 15.9-17.2 / 18-21 ms | 60 fps |
  | 500 rows, `refresh` of every figure          | 16.0-17.3 / 21-25 ms | 60 fps |
  | 10,000 virtual rows, `refresh` (every value) | 4.3-4.4 / 5.5-5.8 ms | 60 fps |
  | 10,000 virtual rows scrolled 37 px a frame   | –                    | 60 fps |

  Phase 0's probe had 3.9 ms for a tenth and 12.5 for every figure (no stripes or sticky header).
  Every figure of 500 rows is the browser's layout of the new text, the same by `setCell` or a
  refresh; virtual rows are its answer, as the guide says. The perf-auditor read the three paths:
  no layout read per render or scroll (the inset and the row height measured once), `setCell`
  O(1) with every write behind a change check, a virtual scroll O(window). Its small findings
  were taken: a column without `format` makes no string for an unchanged primitive value (an
  array may change in place), a group's rows placed from one array, the selection's order built
  only with a selection, the released attributes a constant. Not taken: one small object per
  scroll event in `VirtualRows.ts` (shared with the list and the tree; negligible).

- **The library:** the table box gained 2,000 draw calls in a virtual grid (a single selection,
  sortable by triangles, a sticky header) and a keyboard script (Ctrl+End to the last row with
  its index, ArrowUp, Space, Ctrl+Home). Found on the way: `verify:ui` sets each setting by
  clicking the page's radios, and Chromium keeps that pointer modality through a Ctrl chord (no
  focus ring after Ctrl+End): the script starts with a plain arrow, as Phase 3 section 2's reorder
  script does.
- **The Hub:** the Tables section's "Live figures" and "Long tables", its reference rows, the
  library texts, the dev page's stress box and its text; `createVirtualRows`' JSDoc and key APIs
  name the table.

### Phase 5: graphs and figures — done

1. The sparkline, the donut (the ray cast tab moved onto it, the pie removed), the stacked bar,
   the stat tile; the chart tokens and the design document's colours (D9).
2. The static charts and their scale (D9).
3. The time series and `ThemeWatch.ts`, the graph monitor and the grid's `view: 'graph'` item; the
   perf-auditor's pass (D9, D14).

As built (section 1):

- **`data/graphs/`** holds `Sparkline.ts`, `Donut.ts`, `StackedBar.ts` and `GraphParts.ts` (each
  with its stylesheet); `StatTile.ts` is in `data/` (D2). Public on `aekasha/ui`: the four
  `create*` with their props and handles, and `GraphPart` (`{ label, value, color? }`) and
  `GraphPartFormat` (`(value, share) => text`), which the donut, the stacked bar and section 2's
  chart share. `GraphParts.ts`' `@internal` rest: the part's colour (its own, else
  `var(--aek-chart-n)` by place), the whole (`total`, else the sum), the default format (the
  rounded percent), the label's text ("GPU memory: Textures 40 %, …") and the legend
  (`.aekGraphLegend`, `aria-hidden`: the graph's label says the same). None of the four has a
  listener or a timer.
- **`color`, not D9's `tone`:** the sparkline takes any CSS colour (a series,
  `var(--aek-chart-2)`, or a status role for a status), as a part does; one prop shape for every
  graph, no new tone type.
- **The sparkline:** a `Float64Array` ring (`capacity`, default the values' length, else 60), fewer
  values at the right; one path per line broken at each `NaN` (a lone point a segment of no
  length, which the round cap draws), the area a path per run, the dot a `<line>` of no length
  (its round cap stays a circle under `preserveAspectRatio="none"`, which a `<circle>` wouldn't),
  the strokes `non-scaling-stroke`. Every `push` draws (D9's "at the scheduler's rate": the JSDoc
  and the guide say so).
- **The donut:** one value writes `--aek-donut-value` only when it changed to a thousandth (a
  value set every frame is fine); parts write their stops into `--aek-donut-parts` (allocates: a
  parts change is rare). **Its track is the text at 10 %, not D9's `surface-hover`**: that's near
  invisible on the light surface (1.1:1) and darker than a window's in dark (Phase 0's finding for
  the table), so it takes the table bar track's mix. `size`, `centre`, `--aek-donut-thickness`
  (100 % a pie). `total` is kept across `setParts` until another is given (0: the sum), the
  stacked bar's too.
- **The stacked bar doesn't share the table's bar styles** (Phase 4 section 2 left it here): the
  table keeps its own `kind: 'bar'` (a table importing the graph module would carry it, D8), and
  its bars are a measure in the text's shades (in view, culled) where the stacked bar's are
  categories in the series. Over the `total`, the parts are cut at the end and the bar gets
  `data-over` with a danger outline (an inset shadow would sit under the segments); the amounts in
  its label say it in words.
- **The stat tile** takes a `Sparkline` handle (`sparkline`), not props: the tile imports the type
  only, so a tile without one carries none of its code (D8's lesson). The change: an arrow (a CSS
  triangle), '+12 %' / '−12 %' (`aria-hidden`) and visually hidden words ("up 12 %", "no
  change"); `data-tone` only with `goodDirection`. Not live.
- **The chart tokens** in the three theme blocks (Phase 0's values). `TokenSheet.ts`'
  `CONTRAST_SERIES` checks each at 3:1 on `CONTRAST_SERIES_SURFACES`, `surface` and
  `surface-raised` (not `bg`: the light orange is 2.98 there; nor `surface-hover`); the design
  document's colour section gets a "Chart series" table (`design.ts`' `renderSeriesTable`, each
  series' bar on both surfaces in both themes) and its rule line, and `colours-text.md` a bullet.
- **The ray cast tab** shows a decorative donut per window (`.rayStatProgress` in `RayDebug.scss`
  sets its size and thickness); `debug/_dbg__PercentagePie.ts` and `PercentagePie.scss` are gone,
  `debug/CLAUDE.md` says so.
- **The library:** a group module of their own, `_library/graphs.ts` and `graphsChecks.ts`
  (`GRAPHS_DEMOS`, `GRAPHS_CHECKS`; `data.ts` is at 789 lines), four boxes (`sparkline`, `donut`,
  `stackedBar`, `statTile`), each on a `surface` panel (`hubDemoGraphs`: the page's `bg` isn't a
  surface the series are checked on), fixed data, a button each and a keyboard script each (no
  keys: the ARIA before and after the button).
- **The Hub:** the data page's `## Graphs` (`### Sparklines`, `### Donuts`, `### Stacked bars`)
  and `## Stat tiles`, each with its demo and reference table, the key APIs, intro, tags; the UI
  kit overview's pieces table; both library pages' boxes and texts; `COMPONENT_USES`.
- **Size:** each module minified and gzipped alone: `Sparkline.ts` 1.1 kB, `Donut.ts` 1.0,
  `StackedBar.ts` 0.8, `GraphParts.ts` 0.7 (the donut's and the stacked bar's), `StatTile.ts`
  0.9. Nothing in the app's or the embeds' first download uses them (the ray cast tab is debug).
  The chart tokens are in `tokens.css`, so every build's stylesheet grew by their 18 declarations
  (414 B raw, about 0.1 kB gzip: `verify:baselines`' `index.css`, `banner.css`, `uiKit.css`); no
  script moved. The baselines are recorded (`verify:baselines --update`: the API's 14 new names,
  the docs at 100 %).
- **Found on the way:** a library box whose demo throws (two demos taking the same id) stops the
  whole page's boxes: `verify:ui` showed it on every box after it.

As built (section 2):

- **`createChart`** (`data/graphs/Chart.ts`, `Chart.scss`, public with `ChartProps`,
  `ChartSeries`, `ChartAxis`, `Chart`): D9's props plus `xLabel` (the table's first header),
  `yMin` / `yMax`, `legend` (default with more than one series), `class`, `attr`, `id`; the
  handle `{ cmp, setSeries(series, { categories?, x? }?), setTableShown, isTableShown }` (D9's
  `setSeries`, the axis beside the series since a new series often has new categories). Decided
  on the way:
  - **SVG for the plot, HTML for the labels:** the plot is a 100 × 100 `viewBox` stretched to its
    grid cell with non-scaling strokes (the sparkline's way), so the chart follows its width with
    no `ResizeObserver` and no measuring; text in a stretched SVG would stretch, so the ticks are
    HTML: the y axis a flex column of ticks of no height spaced `space-between` (nice ticks are
    even, so each sits on its line), the x axis' placed at their percent. Dots are segments of no
    length (round caps), as the sparkline's.
  - **Bars** are categorical (a band each, 70 % of it for its bars, side by side or `stacked` with
    positives up and negatives down) and always include 0; **lines** take categories or a numeric
    `x` with its own nice ticks (the ends aligned inside the plot), gaps at `null` / `NaN`, a dot
    per point up to 40. Every k-th category label past 12 (bars) or 8 (lines): no layout read.
  - **The figure is the `role="img"`** (named by the title, described by `description`), not the
    chart's root: the table and the toggle are outside it, so they stay readable and operable. The
    table is always in the accessibility tree (visually hidden until "Show as table"), captioned
    by the title (the caption visually hidden: the title shows above), a `row` header per category.
    The toggle is a plain `<button>` styled as a link (a CMP child, so its listener goes with the
    chart), not `createButton` (a chart carrying the button and its tooltip, D8's lesson).
  - **No hover, no tooltips on points:** the table has the values. **No scatter** (Phase 0's
    colour check), **no stacked lines** (`stacked` is bars only).
  - **`setSeries` redraws whole** (the SVG, the axes and the table rebuilt): a static chart's
    update, as D9 said; a per-frame line is section 3's time series. `type`, `stacked`, the
    formats and the title are fixed at creation.
- **`ChartScale.ts`** (`@internal`, pure): `getNiceStep` (1, 2, 2.5, 5 × 10^n), `getNiceTicks`
  (the range widened to the step, the values rounded to its decimals, so `0.1 + 0.2` never shows;
  an empty range `[0, 1]`, a single value a step around it, `includeZero` for bars),
  `getNiceCeiling` (for section 3's auto range) and `formatTick`; tested alone.
- **The legend** reuses `GraphParts.ts`' with no amounts (`.aekGraphLegend__value:empty` hidden).
- **The library:** the `chart` box in `graphs.ts` / `graphsChecks.ts`: frame time by scene in
  stacked bars with a description (**Show the table**), draw calls side by side (**Only the large
  scenes**: `setSeries` with new categories) and a run's frame and physics time over seconds with
  a gap; a keyboard script (Enter on the toggle shows and hides the table).
- **The Hub:** the data page's `### Charts` (under `## Graphs`) with its reference table, the
  intro, tags, key APIs and the UI kit overview's row; both library pages' texts;
  `COMPONENT_USES`.
- **Size:** `Chart.ts` 2.5 kB minified and gzipped alone, `ChartScale.ts` 0.5 (plus
  `GraphParts.ts`' 0.7, shared). D13's "module lines" are the `'_engine/ui/data/': 0` lines
  already in `sbp.config.ts` (they cover `data/graphs/`): nothing in a first download imports a
  graph, and no build's bundle moved (`verify:baselines`: only the API's new names).

As built (section 3):

- **`createTimeSeries`** (`data/graphs/TimeSeries.ts`, `TimeSeries.scss`, public with
  `TimeSeriesProps`, `TimeSeriesSeries` (`{ label, color? }`), `TimeSeriesThreshold`
  (`{ value, label, tone? }`) and `TimeSeries`): D9's props plus `ticks`, `summary`, `class`,
  `attr`, `id`; the handle D9's plus `isPaused`, `setRange({ min?, max? })` (an options object:
  the coding standards' rule for optional parameters). Decided on the way:
  - **One clock, not D9's `push(seriesIndex, value)`:** the shifted bitmap moves every series by
    the same samples, so a sample is one value per series: `push(value)` is a one-series sample
    (the others a gap), `pushAll(values)` every series' from an array it reads and doesn't keep
    (an app reuses one: nothing allocated per frame). `capacity` defaults to 300 (D9 had none).
  - **The renderer** is Phase 0's shifted bitmap, by **whole device pixels**: a fractional
    `drawImage` offset resamples the image every frame and blurs the lines, so the shift is
    rounded and the newest sample's x tracked on the bitmap (at most half a pixel from the edge;
    the test pins the drift: 10, 10, 9, 10 px for a step of 9.8). A run's start gets a small dot
    (a lone sample shows).
  - **Every frame, after the app's loop:** a draw asked for in a push runs a frame later, so an
    app pushing from its own frame callback (registered first) got a draw every other frame. After
    a frame that drew, the time series asks for the next one too, which then runs after the app's
    loop in the same frame; an empty frame stops it (a test pins the order).
  - **HTML over the canvas** for the grid lines, their values and the thresholds (a shift would
    cut anything static on the canvas), placed only on a rescale. The thresholds count in the auto
    range (a budget is meant to be seen); a fixed end clamps the line. With ticks the auto range
    ends at the first of 3, 2 or 4 ticks that end at the nice ceiling (0 to 50 is three ticks at
    25, not four at 20 up to 60: the first screenshots showed a graph monitor's reads of 25 in
    the lower third); without ticks it's the ceiling as it is.
  - **The colours** are each series' colour written to the canvas' own `color` and read back
    computed (a token, a `color-mix()`, any CSS colour), at the first draw and after a theme change;
    never a style read per frame.
  - **The summary** is a list (`__item` per series: swatch, label, latest value, min and max),
    written by a 250 ms timer a push starts (the last values always written; in view or not:
    `verify:ui` found it stale off screen when a draw started it), held while paused, not a live
    region:
    D9's "text summary beside it", in the piece, which `summary: false` leaves out (the graph
    monitor does).
  - **Visibility** is an `IntersectionObserver` on the root (a hidden panel or a closed tab is out
    of view too); the page's own hiding stops `requestAnimationFrame` anyway. A ratio change alone
    (a window dragged to another screen) isn't seen until a resize.
- **`ThemeWatch.ts`** (`core/`, `@internal`): as D9, `onKitThemeChange(elem, fn)` with one
  `MutationObserver` on `<html>` (`subtree`, the two attributes) and one `matchMedia` listener.
  linkedom's observer reports only the observed node's own attributes, so its test writes on
  `<html>`; the library's switches (on kit roots) are the browser check.
- **The graph monitor** (`forms/GraphMonitor.ts`, public with `GraphMonitorProps`):
  `createGraphMonitor` is `Monitor.ts`' `buildGraphMonitor` (the number's text and an empty
  `.aekMonitor__graph` line at `--aek-graph-monitor-height`) and `attachMonitorGraph` (a time
  series with no ticks and no summary, `capacity` default 64, Tweakpane's `bufferSize`). The field
  shell gained `FieldSpec.onSample(value)`, run after every read, changed or not: every read is a
  sample, the tick's and a refresh's (Tweakpane's graph pushes on each read; the library box fills
  its buffer with refreshes, so its shots hold).
- **The grid's `view: 'graph'`** (with `bufferSize`, Tweakpane's names; `readonly` or not) on a
  number: `buildGraphMonitor`'s field at once, the time series after `import('./GraphMonitor')`
  (re-checked: a grid removed first gets none; a failed load warns and keeps the text). **Measured
  both ways (Phase 0's open question):** a declarative grid's bundle (esbuild, minified, the
  colour picker and Kbd left lazy either way) is 46.6 kB gzip with the `import()` and 49.7 kB
  static: **+3.1 kB**, over Phase 0's 0.5 kB bar, so the `import()` stays. In a bundle that also
  imports `createGraphMonitor` statically (the Hub's library) Vite keeps it in that chunk and
  warns, as it does for `Kbd.ts`.
- **KitDom:** `stubIntersectionObserver`, `stubMatchMedia`, `stubCanvas2d` (D14's recording 2D
  context, with a `getComputedStyle` stub), and linkedom's `MutationObserver` as the global.
- **The perf pass** (D14, "8 time series of 600 samples pushed every frame"): the dev page's
  "Time series under load" box (8 panels, one or eight series each, a loop pushing every frame;
  the readout is the script time from the loop's start to a frame callback that runs after the
  panels' draws), headless under WSL2 (software raster) on the dev server, every panel in view
  and drawing every frame (960 `drawImage` calls a second: 8 × 2 × 60):

  | Case                        | Chromium, median / p95       | Firefox, median / p95        | Frames |
  | --------------------------- | ---------------------------- | ---------------------------- | ------ |
  | 1 series a panel, DPR 1 / 2 | 0.13 / 0.19 · 0.25 / 0.36 ms | 0.30 / 0.40 · 0.32 / 0.40 ms | 60 fps |
  | 8 series a panel, DPR 1 / 2 | 0.18 / 0.23 · 0.26 / 0.33 ms | 0.54 / 0.66 · 0.58 / 0.74 ms | 60 fps |
  | Paused (the pushes only)    | 0.00 / 0.02 ms               | 0.02 / 0.02 ms               | 60 fps |

  Phase 0's bitmap probe had 1.7 / 2.4 ms (Chromium) and 3 / 5 (Firefox) for 64 lines at DPR 2.
  The perf-auditor read the push, frame and draw paths: no allocation, no layout or style read, no
  redundant canvas state (each series' stroke and fill colour differ; the line's width, cap and
  join set only on a whole draw), the steady draw O(new samples), not O(capacity). Its two notes
  are outside the time series and older than it: a live monitor makes its text's string when the
  text changes, and the scheduler's `isShown` walks the DOM (`closest('[hidden]')`) for each due
  live field.

- **The library:** `timeSeries` (a frame's three stages over 300 fixed samples with a budget line,
  **A long frame**, **Fix the range at 0 to 10 ms**; a draw call count with a gap and no ticks) and
  `graphMonitor` (a frame time filled by 63 refreshes, a 60 fps line; a grid's `view: 'graph'`
  item beside a text monitor) in `graphs.ts`, each with a keyboard script (no keys: the ARIA, the
  summary's text, the range's top tick before and after the button; the grid's graph loaded). A
  live run is a kit switch in the box (off at the start: not a `.hubButton`, so not a state, and
  the shots hold).
- **The Hub:** the data page's `### Time series` (with "which graph for what"), its reference
  table, key APIs, intro and tags; the forms page's `### Graph monitors` under Monitors, the
  grid's `view: 'graph'` in "Panels as data", key APIs, intro and tags; the UI kit overview's two
  rows; both library pages' boxes and texts; the dev page's stress box and its text;
  `COMPONENT_USES`.
- **Size:** each module minified and gzipped alone: `TimeSeries.ts` 2.8 kB, `ThemeWatch.ts` 0.4,
  `GraphMonitor.ts` 0.3 (plus `ChartScale.ts`' 0.5, the chart's). D13's module lines are the
  `'_engine/ui/data/': 0` lines already in `sbp.config.ts` (they cover `data/graphs/`;
  `GraphMonitor.ts` is in `forms/`, whose line is 0 too); no build's bundle moved
  (`verify:baselines`: the app's and both embeds' unchanged; the API's 7 new names and KitDom's
  recorded).
- **Not done:** Phase 3's and Phase 4's note (virtual rows measure their row height once, so a
  density switch keeps the old one): `ThemeWatch.ts` is ready for it, but it's the list's, the
  tree's and the table's change, not the graphs'; left for the user's call (§4's p806 list, or a
  section of its own).

### Phase 6: the command palette — done

1. The palette (D12).

As built:

- **`createCommandPalette<C>`** (`overlays/CommandPalette.ts`, `CommandPalette.scss`, its public
  types in `overlays/CommandPaletteTypes.ts`: `CommandPaletteProps`, `CommandPalette`,
  `PaletteCommand`, `PaletteSource`, `PaletteSourceResult`, `PaletteRowParts`,
  `CommandPaletteHints`): D12's props plus `class`, `attr`, `id`; the handle D12's plus `getQuery`
  and `setRecent` (an app restoring its stored list). D12's command type is `PaletteCommand`.
  Decided on the way:
  - **`kbd` is the keys' text** (`'Ctrl+S'`, `createKbd`'s form), not D12's Kbd handle: the rows
    are made again on every query and a source makes new command objects, so nothing would own a
    handle to remove it; and the palette imports Kbd anyway for its hints footer. A Kbd per shown
    row, removed with it; the row's `aria-keyshortcuts` is its `getAriaKeyShortcuts()`.
  - **The empty query** lists the `recent` commands (a "Recent" group) and then every other
    command (or, with a `source`, its answer for `''`), with `hint` as the status: D12's "the
    recent commands first, else `hint`" read as both, so an app's few commands are all one key
    away and the Hub's source (empty for `''`) shows its hint alone. The recent list keeps 5;
    with a source, a recent id resolves to the command chosen while the palette lived.
  - **The scorer** (`Filter.ts`, `@internal`: `prepareScoredText`, `scoreText`, `appendRanges`):
    each query word must be in the label whole or as its letters in order (`tgdr`); a letter
    scores 1, +3 at a word's start (after a non-letter, or a capital after a small letter), +5
    right after the previous one, −0.01 per character before the first; the best of the whole
    match and two letter-by-letter walks. A word not in the label may be in `keywords` at half its
    score (not marked); `description` isn't searched. Ties keep the given order. Its marks are the
    letters it took (`appendRanges`), so `tgdr` marks four letters, not nothing.
  - **A source's promise:** the source is asked on every input until it answers with a promise;
    from then on the next query waits for 150 ms of no typing (D12's "debounced"), and a
    synchronous answer makes it immediate again (the Hub's case: a promise while the payload
    loads, then answers at once). An answer to an older query is dropped; the old rows stay
    (`aria-busy`, dimmed) under the loading status until the new ones come.
  - **Groups:** commands with no group go straight into the listbox, unlabelled, where their first
    one comes.
  - **The layer:** a new token, `--aek-z-palette` (9000: above an app's dialogs, so it opens over a
    pause menu; below the debugger at 10000), shown by the design document's z-layer table (its
    `z-` prefix). Every build's stylesheet grew by its 22 bytes.
  - **The narrow form** is a container query on the palette's root (`container: … / size`, the
    root being the HUD's bounds), so an embed's container decides it, not the viewport; the
    panel's top is `12cqh`.
  - **The focus ring** (found by `verify:ui`): the input keeps the kit's ring (inset) while no row
    is active, and gives it to the active row while one is (`aria-activedescendant`), as the
    drop-down's list gives its ring to its active option. The Hub search's accent bottom border in
    its place would have removed the input's outline.
  - **Modal:** the overlay stack's `inert` entry (the debugger stays live for an app's palette), a
    focus trap over the panel (Tab between the input and Close), the focus back to the opener; a
    command runs after the close (the menu's rule). `open()` needs the HUD root (Phase 7
    section 2's `_kitRoot.ts` makes it before the Hub's first open).
- **Found on the way:** an action map takes keys typed into a text field (`Actions.ts` skips only
  its `preventDefault` there), so typing `w` in the palette would move a player. The overlays
  page's example turns `GAMEPLAY` off in `onOpen` and on in `onClose`, with the Ctrl / ⌘ + K map
  in a context of its own; Phase 7 section 3's example binding does the same.
- **The library:** a group module of its own, `_library/palette.ts` and `paletteChecks.ts`
  (`overlays.ts` is at 622 lines): an editor's commands (groups, icons, key hints, a disabled one,
  keywords, a recent command) and a page search through a `source` (the Hub's shape: a first
  answer that waits 1.5 s for its "index", `renderRow` with a breadcrumb, title and snippet, link
  rows to the library's sections, `hints: { select: 'to open' }`). Four states (the commands, "tog",
  "zz", the search's hint) and three keyboard scripts (the keys and Enter's run with the focus
  back, Tab and Escape, the source's loading and grouped results).
- **The Hub:** the overlays page's `## Command palettes` (the action map binding, ranking, groups,
  the empty query, choosing, the query; `### A source`; the reference table), its intro, tags,
  description and key APIs, the layers line; the UI kit overview's rows for the palette and the
  context menu (Phase 1 section 4 hadn't added one); both library pages' box and texts;
  `COMPONENT_USES`; `hub/CLAUDE.md`'s group modules.
- **Size:** `CommandPalette.ts` 3.7 kB minified and gzipped alone, its stylesheet 1.3 kB; the
  scorer took `Filter.ts` from 0.8 to 1.4 kB, carried only where the palette is (the list and
  the tree import the filter's other names). Nothing in a first download imports the palette.
  `verify:baselines --update` recorded the API's 12 new names (8 public), the docs at 100 %, and
  the bundles: besides the stylesheets' token, the forms' lazy chunks (`Slider`, the embed's
  `uiKitEmbedForm`) by about 230 bytes of script and of CSS that were Phase 5 section 3's
  (`Monitor.ts`' graph slot, the shell's `onSample`), within the check's tolerance and not
  recorded then.

### Phase 7: the Hub, the example, `CLAUDE.md`, readme — done

1. The Hub's data page and its guide, the core, overlays and forms pages' additions, every box on
   both library pages, the "Debugger parity" box (D14, D15).
2. The Hub's search on the palette (D12, Phase 0 step 5): the Hub's source and row renderer in
   `_search.ts`, `_kitRoot.ts` (the library's chunk on it too), `#hudRoot`'s `z-index`, the page's
   `inert` and scroll lock, `_search.scss` down to the rows' parts and `tokens.test.ts`' backdrop
   check moved, `hub.ts`' two `<dialog>` workarounds removed; a Node test of the source against
   the built payload and a `verify:ui` script on the header search; the chunk measured against
   step 5's 9.2 kB, and before and after screenshots for review. Or the reason it stays.
3. The example's inspector, the `uiKit` profile's data window and its budget lines (D13, D15).
4. `src/_engine/ui/CLAUDE.md`, the root `CLAUDE.md`, `readme.md`, `layoutRules.ts`' note,
   `debug/CLAUDE.md`; p800's §5 entry for p805 (what the later plans build on) and §4 below
   completed for p806 and p807.

As built (section 1, from `46094479`: Phase 6 committed):

- **Most of step 1 came with the components:** every piece's box is on both library pages
  (checked: the dev page has every public box plus its six dev-only ones), and the core, overlays
  and forms pages have D15's sections (the tabs, accordion, splitter; the context menu, submenus,
  palette; the fields' menu, graph monitor). What was left: the guide and the parity box.
- **The data page's `## Showing live data`** (after the stat tiles, before Key APIs): the three
  ways (read everything again by key, set one figure, a panel's scheduler and what it skips),
  an example with a scheduler's table, a stat tile and a time series pushed per frame; `### Which
  piece for what` (a table of each piece's use and update, D15's "which chart for what": the time
  series' "Which graph" bullet now links it), `### Long and busy collections` (Phase 4 section 3's
  costs, virtual rows, the filter), `### Colours on a canvas` (what the time series does, and how
  an app's own canvas does the same: `ThemeWatch.ts` is `@internal`). The intro and Key APIs link
  it.
- **The "Debugger parity" box** (dev page only, `debuggerParity`), `_library/parity.ts` with its
  tables in `parityTables.ts` (708 lines: the 15 tables don't fit one module with the rest): an
  accordion of six shut sections, each built on first open: the profiler's 4 tables, GPU memory's
  9, the assets window's 2, the 11 debugger list shapes (13 sites), the 4 tab menus (the drawer's
  16 icon tabs in a narrow box, the profiler's, the key shortcuts dialog's) and the bars,
  sparklines, the pie (the Phase 5 donut) and the key-value grid. Each row's label is the census'
  source line and what its port takes that isn't a rename (code spans as `<code>`). A kit switch,
  off at the start, runs the census' refreshes at 4 Hz: the Overview by `setCell`, GPU memory's
  frame table as `rows` on the box's scheduler (500 ms), the budget bar, the sparklines, the
  donuts. No checks (the dev page's boxes have none; `verify:ui` builds the public Hub). Its dev
  text lists the shapes that don't map one to one, for section 4's §4: two tables without a header
  row (the labels are new); a row class (`isWarn`, `isNA`, the 0 B source, the current scene) has
  no row form (a cell's `tone`, a word, a badge); the “+N more” `colspan` row a footer row; GPU
  memory's by owner a two-level hierarchy drawn by a `cell`, unsorted; a header's live count and
  the “(main loop paused)” heading need a line beside the table (labels and caption are fixed);
  the assets tab's heading with its control stays the tab's own; the drawer's tabs scroll where
  they wrap today, and a scene tab's class has no per-tab form.
- **Fixed on the way (the engine):** a column given `align` (not inferred) never wrote its
  header's `data-align` (`TableRows.ts`' `createTableColumn`), so its header stayed at the start
  over end-aligned cells; `Table.test.ts`' alignment test had pinned the wrong `null`.
- `graphs.ts` exports `addFigureLine` and `addLiveSwitch` (the box uses both); `_components.ts`,
  `hub/CLAUDE.md` name the new modules.

As built (section 2):

- **The search is on the palette** (D12, Phase 0 step 5's mapping held): `_search.ts` makes
  `createCommandPalette<HubSearchCommand>` (id `hubSearch`) with the Hub's `source` (`[]` for an
  empty query, the results at once once loaded, a promise of them until then: the palette's
  loading status and its debounce, a rejection its `errorText`, tried again on the next query),
  `renderRow` (the breadcrumb, an API result's kind badge and name as `<code>`, the snippet; the
  marks the palette's `appendMarked`), `emptyText` as a function (the "Did you mean" titles as
  `createLink`s), `hints: { select: 'to open' }`, `onQueryChange` into `sessionStorage` and
  `open({ query })` with it. Its `<dialog>` code went.
- **The results are `devTools/hub/searchResults.ts`** (`createHubSearchResults({ payload,
rootUrl })` → `{ search, suggest }`, `getSnippet`; no Node imports, beside `searchProtocol.ts`),
  so `searchResults.test.ts` runs them against a payload built as `hub:build` builds it: the
  groups (the section's menu label, 'Home' for none), the crumbs, the matched terms, the API rows
  (kind, name, crumbs), the links, the 50 kept and the count of all, the snippet window, the
  suggestions (now once per page: the old ones could repeat a page). A one-letter term isn't
  marked (the old regex's rule), and the status now says "50 of 142 results" where it said "50+".
- **`_kitRoot.ts`** (`getKitRoot`): the one HUD root, made in a slot at the end of `<body>` by
  whichever chunk runs first; `_components.ts` is on it too and keeps `registerBuiltInIcons` (in
  the shared module it would put about 10 kB of icons into the search's chunk). Both chunks import
  it, so the build makes a `_kitRoot` chunk with the kit modules they share.
- **`#hudRoot { z-index: 70 }`** (`_base.scss`: above the header's 50 and its dropdowns' 60, below
  the skip link's 100): needed, as Phase 0 said. The first check said otherwise, wrongly: an inert
  header isn't hit-tested, so `elementFromPoint` skipped it; the phone shot showed the header over
  the palette's field.
- **The page while open:** `onOpen` makes every `<body>` child but the HUD root's inert (not one
  that already was) and sets `html.hubSearchOpen` (`overflow: hidden`), `onClose` undoes both.
- **Fixed on the way (the engine):** the palette called `onClose` after giving the focus back, so
  a page `onOpen` made inert (its JSDoc's own use, the Hub's) refused it. `onClose` now runs
  before the overlay entry's removal; a test pins it (fails without the fix).
- **Fixed on the way (the Hub, older than this plan's change):** the build emits `hub.js` as a
  facade over `chunks/hub-….js`, so `hub.js`' `import.meta.url` pointed into `chunks/` and every
  search result linked to `_assets/<page>` (a 404; seen on this branch's section 1 build, before
  this change). The links now resolve against the payload's URL from the page's `<meta>` (its
  folder's parent), whatever the chunking; `hub.ts` passes no URL any more.
- **`hub.ts`' two `<dialog>` workarounds went** (the Escape listener's `closest('dialog')`: the
  overlay stack stops the palette's Escape in the HUD root; `isEditable`'s `dialog:not([open])`:
  the palette's input is in the page only while it's open).
- **`_search.scss`** is the scroll lock and the rows' parts on the kit's tokens; the chrome, the
  backdrop and the narrow form are the palette's. `tokens.test.ts`' backdrop check moved to the
  palette's root (`var(--aek-backdrop)`, no fallback needed: it's an element, not `::backdrop`).
- **`yarn verify:ui`** gained `focusPage`, `type`, `pressToNavigate` and `expectUrl` steps
  (`uiPage.ts`, `uiChecks.ts`' `describeStep` and its test), and the palette's box a fourth
  keyboard script on the library page's header search: ⌘K over an inert page and the scroll
  lock, the hint, a query's group, title and crumbs, the arrows, Escape with the focus back on
  the button and nothing inert, the query kept on reopening, Enter landing on
  `features/ui-kit/data/#showing-live-data`.
- **The look is the kit's** (before and after shots for review): the panel 42 × `--aek-base`
  (588 px; was 42 rem, 672), the kit's type scale, the active row an inset ring on
  `accent-soft` (was a left accent bar), the marks the kit's `.aekMark` (a soft background; was
  bold accent text), `Kbd` key hints ("Enter", "Esc"; were ↵ and esc), and no blur behind the
  backdrop (the old `::backdrop` had `blur(3px)`).
- **Size** (gzip, `dist-hub/`): a first search loads `_search` 8.4 kB (MiniSearch, the protocol,
  the results, the palette's use) and the shared `_kitRoot` chunk 12.9 kB with its CSS 4.4 kB
  (the HUD root, `kit.scss` with `tokens.css` again, the palette, Kbd, the overlay stack, the
  focus trap, the spinner, `Filter.ts`, the link): 25.6 kB where it was 9.2 (and the old styles,
  now out of `hub.css`). Phase 0 estimated 9-12 kB more script; it's about 12 kB more and the
  CSS. Against the 416 KiB payload a first search loads anyway, about 4 %. On the library pages
  the `_kitRoot` chunk is shared with `_components`.
- The overlays page's "A source" says the Hub's own search is a palette; `devTools/hub/CLAUDE.md`
  (Search), `hub/CLAUDE.md` (the library's root) and `devTools/verify/CLAUDE.md` (the steps)
  say what changed.

As built (section 3, from `b6de4f78`: sections 1 and 2 committed):

- **The example's inspector** is its own module, `examples/uiKit/exampleUiKitInspector.ts`: the
  scene file describes its objects (`InspectorScene`'s `getOutline()`: groups of
  `InspectedObject`s, each with its key, name, kind, entity, and what may be edited: a colour with
  its options and first value, a light's intensity, a shape's turn), and the inspector reads and
  edits them only through that. `getLightObject` binds a light by its app id. The window's helpers
  (`toggleInspectorWindow`, `openInspector(scene, key)`, `refreshInspector`) live there too; the
  scene calls `refreshInspector()` after a rename, a reset, a shape window's or the settings'
  colour, and the ground's select. D15's pieces: a tree (`roots` a function, the kind as a badge,
  a hidden object muted by `isPlaceholder`, a filter field, single selection) beside a
  collapsible splitter, and tabs: Properties (a grid made again per pick, each kind its rows:
  position, a shape's rotation at 100 ms, colour, a light's intensity, Visible through
  `setDisabled`; `default`s the first values; `createFieldContextMenu` over it) and Stats (built on
  first show: tiles of the frame time with a sparkline, the draw calls and the triangles, a frame
  time series with a 60 fps line, a sortable table of the meshes whose row's activation picks the
  object).
- **The tree's context menu** is D15's but "Focus" (the example has no camera control): Show its
  properties, Visible (a checkbox item), Colour (a submenu of a radio group: D11's submenus in an
  app), Turn (shapes), Copy the name. A group's row has no items (the browser's menu).
- **Stats read after the render:** a `LATE_MAIN` system (`world.addSystem`, removed with the
  panel), not a scene looper: three resets `info.render` as its next frame starts, so a looper
  (before the render) read 0 draw calls (the first run showed it; `_dbg__GPUMemory.ts` has the same
  note). The tiles show a quarter second's average; the time series takes every frame.
- **The palette** is `examples/uiKit/exampleUiKitPalette.ts` (`createScenePalette(sceneId,
  getCommands)`: the palette, its Ctrl / ⌘ + K map in a `SHORTCUTS` context, the recent list in
  memory across visits, `GAMEPLAY` off while open and restored as it was, since the pause menu may
  have it off); the scene's commands (`getCommands`, made on each open: Shapes, Windows, Inspect
  every object, Scene) stay in the scene file. The HUD got Inspector and Commands buttons (the
  hint the platform's one chord: both read "Ctrl + K or Meta K" and overflowed the panel); the
  Rename window moved right of the panel (`x: 260, y: 300`), which now reaches it.
- **Size of the files:** the scene file is 805 lines with the outline and the commands (the
  palette and the window helpers moved out to stay near 800), the inspector 522, the palette 66.
- **The `uiKit` profile's data window** (`profiles/uiKit/uiKitEmbedData.ts`, `createDataTabs`): a
  third button ("Open the data", `uiKitEmbedOpenData`) imports it on the first press and opens a
  draggable window (`uiKitEmbedData`, 360 × 300 at 252, 16) of tabs: Shades (a sortable, single
  selection table of five shades whose pick colours the box), Objects (a list of the box and the
  light, a visibility toggle action each, its eye icons inline SVG: the built-in icons register
  only in the debug env), Frame (a stat tile with its change and a sparkline, from a scene looper
  at 4 Hz, built on first show). The first window is 220 × 230 now (was 190), which
  `verify:embed`'s drag still keeps inside (its comment updated). `verify:embed` doesn't open the
  data window (its checks are the kit's sizes and bounds, which the first window and the dialog
  cover).
- **Budgets** (`suggestBudget`): `assets/uiKitEmbedData.js` 19.3 KiB → 21 KiB,
  `assets/uiKitEmbedData.css` 3.9 → 5 KiB, and a new shared chunk, `assets/BindingScheduler.js`
  0.8 → 2 KiB: the table and the list import the scheduler (their `scheduler` prop) as the form's
  fields do, so the build splits it out of the form's chunk (18.1 → 17.5 KiB, its budget 19 kept).
  The first download didn't move (286.7 KiB, its `_engine/ui` group 4.3); `data/` stays 0 there.
  The Hub's sizes: the data page's new `## In a build`, the UI kit overview's and the library's
  build texts, and the forms page's (the scheduler no longer in the form's chunk).
- **In the app's build** (gzip; it holds both scenes): the example's chunk `exampleUiKit.js`
  13.4 → 29.9 kB (+16.5: the inspector, the palette and the pieces only it uses: the tree, the
  splitter, the time series, the context menu, the palette) and its CSS 2.1 → 4.4; the pieces
  both scenes use (the table, the list's parts, the tabs, the sparkline, the stat tile) a shared
  `Table.js` 13.8 kB and `Table.css` 3.3, `BindingScheduler.js` 0.9 as in the embed. The first
  download moved by what the new code keeps of modules already there (`getLightByAppId`: the app's
  `_engine/kernel/light` +0.1 kB; `createSceneAppLooper`: the uiKit entry's `_engine/kernel/scene`
  +0.2), within the check's tolerance. `verify:baselines --update` recorded `bundle.json` and
  `bundle.uiKit.json`; the API, the docs (100 %) and the debug-code checks unchanged.
- **Checked:** `yarn test` (241 files), ESLint, `tsc` and `tsc -p hub`, `yarn sbp --profile uiKit`
  (every budget within), `yarn hub:build`, `yarn verify:embed --no-build` (all passed),
  `yarn verify:scenes --only exampleUiKit,uiKitEmbed` (8 passed, WebGL on WSL2), and both scenes
  driven in Chromium (WebGL2): the inspector's pick, context menu and Colour submenu, Stats' figures,
  the palette's "Inspect Sun"; the data window's shade pick, visibility toggle and Frame tab.
  `verify:ui` wasn't run: no kit piece or library box changed.
- **The Hub:** the example page's `## The inspector` (`### Properties`, `### Stats`) and `## The
  command palette`, from the regions `ui-kit-outline`, `ui-kit-commands` (`exampleUiKit.ts`),
  `ui-kit-inspector`, `-properties`, `-stats` (`exampleUiKitInspector.ts`) and `ui-kit-palette`
  (`exampleUiKitPalette.ts`); its intro, description and tags; both scenes' JSON descriptions.
- **For section 4:** `src/_engine/ui/CLAUDE.md`'s "Bounds in an embed" names the profile's
  contents (add the data window); `devTools/sbp/CLAUDE.md` is done.

As built (section 4):

- **`src/_engine/ui/CLAUDE.md`:** the data pieces' bullets (the filter, the selection, lists,
  virtual rows, reorder, the collections' parts, trees, tables, graphs, charts, time series, stat
  tiles) moved from `## UI kit` into a new `## Data display` (after Forms and bindings) with an
  intro of what the collections share and what's budgeted; the data page has its `aek:covers`.
  The tabs, accordion, splitter, roving focus and announcer stay under `## UI kit` (they're
  `components/`), the context menu and palette under The overlay layer, the fields' menu and graph
  monitor under Forms and bindings. "Bounds in an embed" names the data window. The file and this
  plan were already off Prettier at `b6de4f78` (its one change in the kit's file would turn a code
  span `` ` / ` `` into `` `/` ``), so neither was reformatted.
- **The root `CLAUDE.md`:** the map line for the kit's file names the data display section; the
  `data/` line lost its "so far".
- **`readme.md`:** the UI kit bullet (tabs, accordions, split panes; menus with submenus, context
  menus, the command palette; monitors as graphs and the fields' context menu; a data display
  sentence), the source tree's `ui/` comment (`data/`, the palette), the examples line (the
  inspector and the palette).
- **Already done earlier:** `layoutRules.ts`' note (Phase 1 section 1 wrote `data/` into it) and
  `debug/CLAUDE.md`'s pie line (Phase 5 section 1).
- **p800 §5:** p805's entry says what the later plans build on (the collections' model, the
  pieces, the tokens, §4, the size), in p804's shape; its first paragraph replaced.
- **§4 below** completed for p806 and p807: the list's two hand-made shapes, the tab menus'
  open decisions, the fields' menu per tab; the tables' hand-made shapes (no header row, row
  classes, the "+N more" row, the by-owner hierarchy, the live heading counts), the bars, the
  sparklines, the key-value grid, the stats panels on the time series, reading `info.render` after
  the render; and the open items (virtual rows on a density switch, the scheduler's `isShown`, the
  collections' scheduler import).

### Phase 8: versions and done — done

Engine minor, app minor, the Project entry (D16); `yarn checkVersions --against main`; the plan
marked done and renamed, with the references to its old name (p800's `Blocks`, p806's and p807's
when written, p804's and p803's `Related` / `Blocks`).

As built (2026-10-28, from `1d1b79c0`: Phase 7 committed):

- **Versions:** engine 5.14.0 (Golden Hour; `main` was still at 5.13.0, so D16's first choice) and
  app 1.18.0 (Preschooler); the toolkit unchanged at 2.2.1 (nothing in `src/toolkit/`).
  `CHANGELOG.md`'s entry: Engine (the pieces, the tokens, the menu's growth, the ray cast tab's
  donut; no restyle, D16), App (the inspector, the palette, the embed's data window), Project (the
  Hub's pages and boxes, the search on the palette with its size, the library's split, the SBP
  lines, the `verify:ui` steps, and the Hub search's link fix, which predates this plan).
- **Marked done:** `git mv` to `_DONE_p805_data-display.md`; the references: p800's Blocks line
  and §5 entry (done, with the versions), `_DONE_p803`'s Blocks line, `_DONE_p804`'s Related line.
  p806 and p807 aren't written yet, so they have no line to update; no `CLAUDE.md` names the
  plan's file (they name it as p805, which stays). The root `CLAUDE.md`, the nested ones and
  `readme.md` were Phase 7 section 4's.
- **Time for the PR:** `p805-data-display` → `main` (p800 §6), the whole branch: Phases 0-8.

---

## 4. For p806 and p807

What each port needs that isn't a rename, from Phase 0's census (§4.1) and the "Debugger parity"
box (the dev component library, Phase 7 section 1: every shape below built from the new pieces,
with the census' source line on each row). Completed in Phase 7 section 4.

**p806: the debugger's lists and tab menus**

- **The debugger list → `createList`** with `actions`: `DebuggerListDef`'s `heading`,
  `emptyText` (`empty`), `perItemConfig.toggles` (`actions` with `pressed` and `iconOff`; a row's
  `null` toggle value → the action's `hidden`), `onClick` (`onActivate`), `selectedItemId`
  (`selection: 'single'` and `setSelected` on refresh: the debugger's selection is the open
  window's, set from code), `data` as a function (`items` on the tab's scheduler), and each item's
  `subTitle`, `icon` (`getSvgIcon`'s HTML), `badge`, `title`, `titlePlaceholder` (`isPlaceholder`),
  `description`, `suffix`, `tooltip`, `disabled`. A row's context menu is a `createContextMenu`
  on the list with `getKeyAt` (no prop: Phase 3 section 1). The keys change from Tab through
  every button to one tab stop with arrows (D4): a visible change the debug suite's page says.
- **Two list shapes by hand:** the assets tab's own heading with its scope switch stays the tab's,
  above a list without `heading` (`heading` is text); LOD's capped list's disabled "…and N more"
  row stays a disabled item, or the cap goes and the list takes virtual rows (no list reaches D8's
  ~200 today: 86 rows at most, `physicsTiers`).
- **The tab menus → `createTabs`:** the drawer's and the profiler's icon menus (`iconOnly`, the
  label its tooltip), the editor drawer's, the key shortcuts dialog's tab list;
  `_debugTabButtons.scss` goes. Decisions left to p806: the drawer's 15 tabs (16 with a scene tab) wrap into two rows
  today, where `createTabs` scrolls with faded edges (a `wrap` option, or the scroll accepted:
  the parity box shows the scroll in a narrow box); a scene tab's class ("(scene tab: <id>)" in its
  `title` and a class) has no per-tab form (`TabDef` has no `class`: its label, or a badge); the tab
  host keeps mounting its content into the panel the tabs give it, or builds `content` per tab.
- **The fields' menu** on every debugger grid: `createFieldContextMenu({ container })` per tab
  (D11), removed with it.

**p807: the profiler's and GPU memory's tables, bars and graphs**

- **The tables → `createTable`**, with `setCell` for the live figures (the Overview's at up to
  10 Hz) or `rows` as a function on the tab's scheduler (a few milliseconds a tick at the census'
  sizes, Phase 4 section 3's figures); the two-line cells (a name and a dimmed owner or scene
  line, in five tables) a `cell` renderer; the Overview's and the heaviest objects' row buttons
  `onRowActivate` or a `cell` button; the breakdown's bars `kind: 'bar'` with the total in the
  footer (`<tfoot>` where the census has a Total row in the body).
- **Table shapes by hand:** the Overview and the ECS worlds table have no header row (their
  column labels are new; `captionHidden` for the caption); a row class (`isWarn`, `isNA`, the 0 B
  source, the current scene) has no row form: a cell's `tone` with its word, or a badge in a
  `cell`; GPU memory's "+N more" `colspan` row becomes a footer row; its by-owner table is a
  two-level hierarchy (an owner, then its cells' rows, indented): a `cell` renderer and the rows
  unsorted (no treegrid: D1); the asset diff's counts in its header text and the frame table's "(main loop paused)"
  go on a line beside the table (the caption and the labels are fixed at creation).
- **The bars:** the GPU memory budget bar → `createStackedBar` of one part against a `total`
  (its over state `data-over`, the text beside it kept); the Objects tab's "Over time"
  sparklines → `createSparkline({ area: true, min: 0 })` with the latest and the max as text beside
  them; the component types' key-value grid → a static list with a `suffix`, or a two-column table.
- **The stats panels** (p807 Phase 0's gate) on `createTimeSeries`: one clock per panel
  (`pushAll` once a frame, its array reused), the canvas's colours through `ThemeWatch.ts` (by the
  time series itself), the summary off where the panel shows its own figure (`summary: false`);
  Phase 5 section 3's figures are the baseline (8 panels at DPR 2 about 0.3 ms a frame in
  Chromium).
- **Figures read after the render:** three resets `renderer.info.render` as its next frame
  starts, so a panel's draw calls and triangles are read in `LATE_MAIN` (`_dbg__GPUMemory.ts` does;
  the UI kit example's Stats tab learnt it in Phase 7 section 3).

**Open, for either**

- Virtual rows measure their row height once (D8), so a box made in one density keeps it after a
  switch; `ThemeWatch.ts`' density change is where to measure again (Phases 3-5's note).
- The scheduler's `isShown` walks the DOM (`closest('[hidden]')`) for each due entry, and a live
  monitor makes its text's string when the text changes (the perf-auditor's two notes, Phase 5
  section 3): fine at today's sizes, the first places to look if a ported tab's tick shows up.
- A collection imports the scheduler for its `scheduler` prop (0.8 kB gzip, a shared chunk in the
  `uiKit` build): an opt-in value like the virtual rows would drop it from a collection without
  one.

### 4.1 The census (Phase 0, 2026-10-27, `main` at `8f4d77ed`)

A one-off script in the scratchpad (sites by grep, each read by hand) and a Playwright pass over
the larger scenes in the debug env (every drawer tab and profiler tab opened, `tbody` rows and
list rows counted: "Most rows"). §1.1's "33 `<table>` sites" and GPU memory's "eight tables" were
wrong: there are **14 table templates in 4 files, 15 tables drawn** (the assets helper twice),
GPU memory has nine. Every one is an HTML string through `CMP({ html })`, re-rendered whole on
its tab's refresh; none sorts, has a sticky part or a caption; all use `tabular-nums`.

**Tables**

| Site                                                                         | Columns                                                                                           | Groups, footer, row classes                                                                                                                | Interaction                                                           | Refresh               | Most rows               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------- | ----------------------- |
| Overview `_dbg__ProfilerOverview.ts:579`                                     | label (`<th>`), value, sub + action; no `<thead>`                                                 | an "App" `<tbody>` with a `colspan` header row; `isNA`, `isWarn`                                                                           | a row's action button (`data-metric`), one handler on the table       | 1, 2, 4 or 10 Hz (4)  | 14 (default rows)       |
| Objects, by kind / by owner `…Objects.ts:261` (one template)                 | label + sub line, Objects, Triangles, Vertices (each "in view / total"), a bar                    | a Total row in the `<tbody>` (`isTotal`, not a `<tfoot>`)                                                                                  | the "Bars" measure switch above (a segmented control, `data-measure`) | the profiler's rate   | 6 / 5, + Total          |
| Objects, ECS worlds `…Objects.ts:340`                                        | world, entity count, "entities"; no `<thead>`                                                     | –                                                                                                                                          | –                                                                     | the profiler's rate   | 1                       |
| Objects, heaviest `…Objects.ts:386`                                          | rank, object + entity line, kind, triangles, instances, action                                    | –                                                                                                                                          | Edit (`data-heavy`) opens the entity's window                         | the profiler's rate   | 10 (cap)                |
| GPU memory, categories `_dbg__GPUMemory.ts:214`                              | Category, Size, Count                                                                             | sorted by size, then two fixed rows with text in the Size cell                                                                             | –                                                                     | 500 ms                | 10                      |
| GPU memory, peaks `:221`                                                     | Peak, Size, Reached                                                                               | –                                                                                                                                          | –                                                                     | 500 ms                | 2                       |
| GPU memory, frame `:242`                                                     | (label), Last, Min, Avg, Max                                                                      | a heading with "(main loop paused)"                                                                                                        | –                                                                     | 500 ms                | 4                       |
| GPU memory, sources `:276`                                                   | source + owner line (`title` the id), Size, GPU objects                                           | `<tfoot>` Total; untracked class at 0 B; an empty row's text                                                                               | –                                                                     | 500 ms                | 10                      |
| GPU memory, by owner `:359`                                                  | Owner, Textures, Geometry, Total, Items                                                           | an owner row then its cells' rows (indented: a two-level hierarchy), the current scene's class, an Untracked row with a %, `<tfoot>` Total | –                                                                     | 500 ms                | 3                       |
| GPU memory, untracked `:367`                                                 | Untracked, Size                                                                                   | sorted by size                                                                                                                             | –                                                                     | 500 ms                | 4                       |
| GPU memory, snapshot categories `:449`                                       | Category, Size, Count (signed deltas)                                                             | –                                                                                                                                          | –                                                                     | 500 ms                | –                       |
| GPU memory, left behind `:457`                                               | allocation + scene / visit / site line, Count, Size                                               | at most 12 (`DIFF_MAX_ROWS`) and a "+N more" `colspan` row, `<tfoot>` Total                                                                | –                                                                     | 500 ms                | 13 (cap)                |
| GPU memory, asset diff `:466`                                                | asset + kind / owner line, Then, Now, Change; counts in the header text                           | at most 12 and a "+N more" row                                                                                                             | –                                                                     | 500 ms                | 13 (cap)                |
| Assets info window `_dbg__Assets.ts:582` (`table()`, used at `:646`, `:703`) | a texture array's layers (#, Layer or Member, Source); an atlas's cells (Cell, At, Size, UV rect) | –                                                                                                                                          | –                                                                     | built with the window | not measured (a window) |

Row styles: the profiler stripes odd rows `rgba(255,255,255,0.04)` (`Profiler.module.scss:41`; its
sparklines' rows `:154` too); GPU memory has no stripe, right-aligned numbers and a `<tfoot>` with
a top border and `$debugGuiBackgroundLighter2`; the assets table's head has that background. Two
lines in one cell (a name, a dimmed owner or scene line under it) are in five tables: the table's
`cell(row)` renderer, or a column `format` returning two lines, has to cover it.

**Bars, sparklines, the pie**

- **The breakdown's bar** (`…Objects.ts:196`): two segments, in view (`$debugTextColor`) and culled
  (that at 30 %), as shares of the table's total, its figures in `title`; in a cell (D5's
  `kind: 'bar'`).
- **The GPU memory budget bar** (`_dbg__GPUMemory.ts:212`): one fill against the budget, clamped,
  a text label beside it ("62 % of the 512 MB budget (over budget)"), an over-budget class, a width
  transition: a stacked bar of one part against a `total`, its over state a status role.
- **The "Over time" sparklines** (`…Objects.ts:406`): three series (triangles in view, meshes in
  view, draw calls), 60 samples (`HISTORY_LENGTH`, 15 s at 4 Hz), auto-scaled from 0 to the max, a
  filled `<polygon>` under each `<polyline>`, gaps at `NaN`, `aria-hidden`, the latest and the
  max as text beside it: D9's sparkline needs the fill (an `area` option).
- **The pie** (`_dbg__PercentagePie.ts`, used at `kernel/render/debug/_dbg__Raycast.ts:292`): 12 of
  them (three stat blocks, three's rays, physics rays and shape casts, × four windows), each showing
  how far its measuring window has run (`pie.set(win.progress * 100)`, `:371`), not a share. So
  the donut that replaces it is a single value, decorative next to the row's figure (`aria-hidden`)
  rather than a `meter`: D9's donut keeps the one-value form, and the ray cast tab is its first
  user in that form.
- **A key-value grid** (`…Objects.ts:330`, the component types by entity count): `<div>`s, not a
  table; a static list (D6) with a suffix, or a two-column table.

**Debugger lists** (`debuggerListCMP`, 13 sites in 11 files; every one `data` as a function but
the space demo's)

| Site                                                                                  | List fields                                                                                           | Item fields                                                                                                           | Most rows           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Cameras `kernel/camera/debug/_dbg__CameraGUI.ts:616`                                  | `onClick`, `selectedItemId`, a toggle (helper)                                                        | `subTitle`, `title`, `titlePlaceholder`, `toggleValues`                                                               | 2                   |
| Lights `kernel/light/debug/_dbg__LightGUI.ts:1124`                                    | `emptyText`, `onClick`, `selectedItemId`, toggles                                                     | `subTitle`, `icon`, `badge`, `title`, `titlePlaceholder`, `toggleValues`                                              | 12                  |
| ECS worlds `kernel/ecs/debug/_dbg__ECS.ts:223`                                        | `emptyText`, `onClick`, `selectedItemId`                                                              | `subTitle`, `title`, `suffix`                                                                                         | 1                   |
| Assets `kernel/assets/debug/_dbg__Assets.ts:1111`                                     | `emptyText`, `onClick`, `selectedItemId`; its own heading above (the count and a scope switch button) | `subTitle`, `icon`, `title`, `description`, `tooltip`                                                                 | 57 (gym)            |
| Physics entities `features/physics/debug/_dbg__PhysicsAPI.ts:1163`                    | `heading`, `emptyText`, `onClick`, `selectedItemId`, a toggle (wireframe)                             | `subTitle`, `title`, `toggleValues`                                                                                   | 86 (`physicsTiers`) |
| Characters `features/character/debug/_dbg__Character.ts:340`                          | `emptyText`, `onClick`, `selectedItemId`, toggles                                                     | `subTitle`, `title`, `toggleValues`                                                                                   | 3                   |
| PostFX `features/postfx/debug/_dbg__PostFX.ts:628`                                    | `heading`, `emptyText`, `onClick`, `selectedItemId`                                                   | `subTitle`, `badge`, `title`, `titlePlaceholder`, `tooltip`, `disabled`                                               | 1                   |
| LOD entities `features/lod/debug/_dbg__LOD.ts:625`                                    | `heading`, `emptyText`, `onClick`, `selectedItemId`                                                   | `subTitle`, `title`, `suffix`; a capped list with a disabled "…and N more" row                                        | 12                  |
| `assetCompare` ×3 `app/scenes/assetCompare/_dbg__assetCompare.ts:226`, `:232`, `:238` | `heading`, `emptyText`                                                                                | `subTitle`, `badge`, `title`, `titlePlaceholder`, `description`, `suffix`, `disabled` (a total row, a "Loading…" row) | 8 each              |
| `lodShowcase` lanes `app/scenes/lodShowcase/_dbg__lodShowcase.ts:379`                 | `heading`, `emptyText`                                                                                | `subTitle`, `title`, `description`, `suffix`, `tooltip`                                                               | 6                   |
| `space` `app/scenes/space/_dbg__spaceDemo.ts:153`                                     | `heading`, `emptyText`, `data` an array                                                               | `subTitle`, `title`, `description`, `suffix`                                                                          | 4                   |

Every `DebuggerListDef` and `DebuggerListItem` field has a user but `id` alone, so §4's mapping
covers them all; two shapes it didn't name: a list's own heading with a control in it (the assets
tab: `heading` takes a CMP, or the tab keeps its own above the list) and a capped list's "…and N
more" row (LOD: an `overflow` text, or virtual rows instead of the cap).

The counts (nine scenes: `largeWorld`, `physicsTiers`, `lodShowcase`, `space`, `scene01`,
`assetCompare`, `physicsTest`, `thirdPersonGymScene`, `skyShowcase`; no snapshot taken, so the
diff tables weren't drawn) say: the largest list is 86 rows and the largest table 14, nothing near
D8's ~200 where the guide suggests virtual rows, and a refresh writes at most about 70 table cells
(GPU memory's at 2 Hz) or 60 (the Overview's at up to 10 Hz). So no debugger list or table needs
virtual rows today (`physicsTiers`' list is the one that grows with a scene), and D14's 500 live
rows at 10 Hz is headroom for p807, not today's load; §5's "hundreds of changing figures" holds for
p807's richer tables, not the current ones.

**Tab menus**

- **The drawer** (`debug/_dbg__DebuggerGUI.ts:141`), **the profiler window**
  (`profiler/_dbg__Profiler.ts:202`) and **the editor drawer** (`editors/_dbg__EditorDrawer.ts:124`):
  icon-only `<button>`s named by `title` (the drawer's adds "(scene tab: <id>)" and a scene-tab
  class), the selected one by class, no tab roles, every button a tab stop. The drawer's menu holds
  15 tabs (`testDebugScene`; a scene tab adds one) in two wrapped rows at its width: `createTabs`' overflow is a scroll with faded
  edges (D10), so p806 either wraps (a `wrap` option) or accepts the scroll.
- **The key shortcuts dialog** (`debug/_dbg__DebugKeyShortcuts.ts:542`): `role="tablist"`, `tab`,
  one `tabpanel`, `aria-selected`; no `aria-controls`, no arrow keys (every tab a tab stop), text
  labels, two tabs.

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
- **The Hub's search** is public and used: Phase 0's mapping fit, and D12 moves it with the checks
  it never had in a browser (a `verify:ui` script) and screenshots for review; the measured chunk
  or the look can still keep it as it is.

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
