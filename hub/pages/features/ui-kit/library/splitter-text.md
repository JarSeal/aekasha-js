## Splitter

`createSplitter({ label, first, second })` puts two panes side by side, or stacked with
`orientation: 'vertical'`, with a separator between them (the APG window splitter: a focusable
`separator` named by `label`). Its `size` is the first pane's, in a percent (the default) or px,
between `min` and `max`. The pointer drags the separator; with the focus on it, the arrows along it
move it by `step` (Shift ×10, Alt ×0.1), Home and End to the ends, and with `collapsible` Enter
collapses the first pane and restores it. `onSizeChange` reports a finished move.

- **States:** drawn in the page: an outline beside its properties (35 %, from 15 to 70,
  collapsible) and an editor over its console (80 px, from 40 to 160); **Collapse the outline**
  collapses the first. The status line says what the user moved.
- The property grid's label column has the same keys and drag: see
  [the property grid](#property-grid).
