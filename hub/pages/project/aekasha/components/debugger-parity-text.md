## Debugger parity

Only on this page (p805 D14): a row per shape of p805 Phase 0's census of the debugger (§4.1 in
its plan) that p807 still ports, built from the data pieces, each with the census's source line
and what its port takes that isn't a rename, so p807 (GPU memory's tables and budget bar) starts
from a page that shows each. p806 ported the rest (the debugger lists, the tab menus, the ray cast
tab's pie, the assets info window's tables) and took their rows out (its Phase 7), and p807's
Phase 3 the profiler's Overview and Objects (their tables, the “Over time” sparklines and the
component types' list). The sections are shut at first and built on their first open. **Live
figures** moves what the census refreshes, 4 times a second: GPU memory's frame table read on the
box's scheduler every 500 ms, and the budget bar.

- **Tables** (9 in 1 file, every one an HTML string re-rendered whole today): sticky headers,
  sorting and stripes are what they gain. What doesn't map one to one: a row class (the untracked
  0 B source, the current scene's owner) has no row form, so it's a cell's `tone`, a word or a
  badge; the “+N more” `colspan` row is a footer row before the Total; GPU memory's by owner is a
  two-level hierarchy, its levels drawn by a `cell` and left unsorted (the treegrid is out of
  p805); a header's live count (the asset diff's “Then (14)”) and the frame table's “(main loop
  paused)” need a line beside the table, since the labels and the caption are fixed. p806
  restyled them on the tokens and gave the empty headers hidden names (its Phase 6), leaving the
  structure.
- **The budget bar:** the GPU memory budget, a stacked bar of one part against a `total`
  (`data-over` past it).
