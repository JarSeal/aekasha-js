## Table

`createTable({ caption, columns, rows })` shows an app's rows under its columns: each cell a value
as text (a column's `format`), a number aligned to the end in tabular figures, a CMP (`cell`) or a
bar (`kind: 'bar'`). Rows are kept by key, so new rows write only the cells whose text changed, and `setCell` writes
one live figure; `virtual` renders only the rows the box shows.
`groups` add a `<tbody>` each under a header row, `footer` a total in a `<tfoot>`; a column can be
the rows' headers (`rowHeader`), carry a status (`tone`: its colour and a mark, the text saying it
too), sort the rows (`sortable`: its header a button, ascending then descending, stable, the
footer never sorted) or be left out (`hidden`). With a `selection` or `onRowActivate` the table is
a grid: one tab stop, the arrows over its cells, Space selecting a row and Enter opening it, Enter
or F2 into a cell's control. `striped` tints every other row, `highlight` the row, the column, the
cell or both under the pointer and the focus, `sticky` keeps the header and the first column in
view, and `stackBelow` turns each row into a card of "label: value" lines when the table's own box
is narrower than it. While a plain table overflows its box, the box is a tab stop named by the
caption, so the arrows scroll it.

- **States:** drawn in the page: a profiler's overview (five frame metrics and an "App" group,
  striped, a row's highlight, each metric's state as a tone with a mark and a word), the GPU memory
  by owner (twelve owners and their total in a box that scrolls both ways, the header and the first
  column sticky, the cross highlight), the objects by kind (sorted by triangles, descending; a bar
  of in view and culled against the total in the footer), the heaviest objects (a grid with a
  multiple selection, an object and its owner on two lines, an Edit button) and three assets in a
  narrow box, stacked, the sortable headers as chips. **Empty the overview** shows the empty row;
  2,000 draw calls in a virtual grid (sticky header, sortable by triangles) and a row clicked
  selects it; a right click opens the row's context menu.
- **What the page can't show:** the highlight is the pointer's and the focus's; live figures are
  the dev page's ("Tables under load"), which measures them.
