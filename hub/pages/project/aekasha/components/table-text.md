## Table

[What it is and its states](hub:features/ui-kit/library#table), on the public page.

::: note For a later plan
p805 Phase 4: `data/Table.ts` (its public types in `TableTypes.ts`, its columns,
cells, bars and sort in `TableRows.ts`, the grid's keys in `TableGrid.ts`): columns, formats,
alignment, groups, the footer, the caption, sticky parts, stripes, the highlight, the empty row,
the scroll box and the stacked layout; sort, selection, the grid mode, cell renderers and bar
cells; `setCell`, the scheduler and virtual rows (the box below measures them). p807 moves the profiler's and GPU
memory's tables onto it (§4.1's census: 14 templates in 4 files): `setCell` for the live figures,
the two-line cells (a name and a dimmed owner line, five of them) a `cell` renderer, the
breakdown's bars `kind: 'bar'` against the footer's total, the Overview's and heaviest objects'
row buttons `onRowActivate` or a `cell` button.
:::
