## Table

`createTable({ caption, columns, rows })` shows an app's rows under its columns: each cell a value
as text (a column's `format`), a number aligned to the end in tabular figures. Rows are kept by
key, so new rows write only the cells whose text changed. `groups` add a `<tbody>` each under a
header row, `footer` a total in a `<tfoot>`; a column can be the rows' headers (`rowHeader`), carry
a status (`tone`: its colour and a mark, the text saying it too) or be left out (`hidden`).
`striped` tints every other row, `highlight` the row, the column, the cell or both under the
pointer and the focus, `sticky` keeps the header and the first column in view, and `stackBelow`
turns each row into a card of "label: value" lines when the table's own box is narrower than it.
While the table overflows its box, the box is a tab stop named by the caption, so the arrows
scroll it.

- **States:** drawn in the page: a profiler's overview (five frame metrics and an "App" group,
  striped, a row's highlight, each metric's state as a tone with a mark and a word), the GPU memory
  by owner (twelve owners and their total in a box that scrolls both ways, the header and the first
  column sticky, the cross highlight) and three assets in a narrow box, stacked. **Empty the
  overview** shows the empty row.
- **What the page can't show:** the highlight is the pointer's and the focus's; sorting, selection
  and live figures come with the table's next sections.
