## Chart

`createChart({ type, title, series, categories? | x? })` draws lines or bars of a few series:
bars per category, side by side or `stacked` (positives up from 0, negatives down), lines over
categories or a numeric `x` (a gap at a `null`), on a y axis of nice ticks (1, 2, 2.5 or 5 times a
power of ten; bars always from 0). Each series is in the chart series' colours unless it has its
own, named in the legend. The chart is an image named by its title and described by its
`description` (say the trend there); its values are a table a screen reader always has, which
"Show as table" shows on the page. `setSeries` draws it again: it's for figures that change now
and then.

- **States:** drawn in the page on panels: frame time by scene in stacked bars with a
  description (**Show the table**), draw calls by scene side by side (**Only the large scenes**
  draws it again with two categories), and a run's frame and physics time over seconds, with a
  gap.
- **What the page can't show:** the chart has no hover: its values are the table's.
