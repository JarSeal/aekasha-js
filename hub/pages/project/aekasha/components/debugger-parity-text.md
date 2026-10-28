## Debugger parity

Only on this page (p805 D14), as the property grid's Tweakpane parity box: a row per shape of
p805 Phase 0's census of the debugger (§4.1 in the plan), built from the data pieces, each with
the census's source line and what its port takes that isn't a rename, so p806 (the lists and tab
menus) and p807 (the profiler's and GPU memory's tables and graphs) start from a page that shows
each. The sections are shut at first and built on their first open. **Live figures** moves what
the census refreshes, 4 times a second: the Overview's figures by `setCell`, GPU memory's frame
table read on the box's scheduler every 500 ms, the budget bar, the sparklines and the donuts.

- **Tables** (15 in 4 files, every one an HTML string re-rendered whole today): sticky headers,
  sorting and stripes are what they gain. What doesn't map one to one: two tables have no header
  row (the Overview, the ECS worlds), so their column labels are new; a row class (`isWarn`,
  `isNA`, the untracked 0 B source, the current scene's owner) has no row form, so it's a cell's
  `tone`, a word or a badge; the “+N more” `colspan` row is a footer row before the Total; GPU
  memory's by owner is a two-level hierarchy, its levels drawn by a `cell` and left unsorted (the
  treegrid is out of p805); a header's live count (the asset diff's “Then (14)”) and the frame
  table's “(main loop paused)” need a line beside the table, since the labels and the caption are
  fixed.
- **Debugger lists** (13 sites, 11 shapes): every `DebuggerListDef` and item field has its prop
  (the plan's §4 maps them). What changes: one tab stop with the arrows in place of a Tab per
  button; a toggle the row hasn't (`null`) is a hidden action, its cell kept; the assets tab's
  heading with its count and scope switch stays the tab's own, above the list (`heading` is a
  text); the LOD tab's capped “…and N more” is a disabled row (or virtual rows in place of the
  cap).
- **Tab menus:** the drawer's 16 tabs wrap to two rows in its width today and scroll with faded
  edges here (no `wrap` option: p806 decides); a scene tab's class has no per-tab form, its name
  says it. The key shortcuts dialog's tab list gains the arrows and `aria-controls`.
- **Bars, sparklines, the pie:** the breakdown's bar is the Objects table's `kind: 'bar'`; the GPU
  memory budget a stacked bar of one part against a `total` (`data-over` past it); the “Over time”
  sparklines `area` ones from 0; the pie moved onto the donut in Phase 5; the component types'
  key-value grid a static list with a suffix.
