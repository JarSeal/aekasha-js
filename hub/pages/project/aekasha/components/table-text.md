## Table

[What it is and its states](hub:features/ui-kit/library#table), on the public page.

::: note For a later plan
p805 Phase 4: `data/Table.ts` (its public types in `TableTypes.ts`, its columns,
cells, bars and sort in `TableRows.ts`, the grid's keys in `TableGrid.ts`): columns, formats,
alignment, groups, the footer, the caption, sticky parts, stripes, the highlight, the empty row,
the scroll box and the stacked layout; sort, selection, the grid mode, cell renderers and bar
cells; `setCell`, the scheduler and virtual rows (the box below measures them). p807 moved the profiler's and GPU
memory's tables onto it (its Phases 3-4): the Overview's figures by `setCell`, each only when its
text changed (an n/a value in the `'muted'` tone it added), the two-line cells a `cell` renderer,
the breakdowns' bars `kind: 'bar'` against the footer's total, the heaviest objects' Edit a `cell`
button, GPU memory's tables sortable and kept by key. Left (its Phase 5): a table on a scheduler
still allocates per render (`readRows`' arrays, `place`), which a "rows unchanged" path would
remove.
:::
