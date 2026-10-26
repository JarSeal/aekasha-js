## Property grid

`createPropertyGrid({ children })` is the debugger's layout: each field a row of two columns, its
label (cut, with a tooltip, when long) and its control. In a folder the labels step in while the
controls stay lined up with the top level's, at any depth. A button or any other child spans both
columns.

- **Scheduler:** the grid has its own (or shares a host's `scheduler`), which every field and
  folder added without one joins. Its `refresh()` reads them all and re-reads their `hidden` and
  `disabled` functions, and never fires `onChange`.
- **The label column:** a percent of the grid's width (`labelWidth`, 40 by default). Its edge is a
  separator: drag it, or focus it and use ArrowLeft / ArrowRight (Shift ×10, Alt ×0.1), Home and
  End. The grid writes no storage: `onLabelWidthChange` reports the width at a drag's release or
  a key's keyup.
- **Items:** `addPropertyGridItems(grid, items)` adds a panel described as data, Tweakpane's pane
  items with its names (`label`, `min`, `max`, `step`, `options`, `readonly`, `format`, `hidden`,
  `disabled`, folders with `expanded`, buttons, separators, a `custom` escape hatch). A field's
  kind is inferred from its value as Tweakpane does: a number field (a slider with `min` and
  `max`), a checkbox, a text field, a select with `options`, a monitor with `readonly`. It's its
  own module, so a grid built from handles doesn't carry every field's code.
- **States:** drawn in the page, in a kit root of its own: a scene's settings, a long label, a
  folder in a folder and a monitor. "Change the values from outside" changes the speed and the
  bodies and refreshes: the speed flashes, the monitor doesn't. The status line says the label
  column's width after a move.

The separator is the columns' 24 px gap, so it covers no control.
