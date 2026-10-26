## Tweakpane parity

Only on this page (p804 D14): one property grid built with `addPropertyGridItems`, a row per row
of p804 Phase 0's Tweakpane census, each hinted with the census's source line, so p806 starts
from a page that shows every feature it ports. The status line says each field's last write
(`last` or a step).

- **Edit fields:** a checkbox; a slider (`min`, `max`, `step`); selects with the array and the
  object `options`; numbers with `min` and `step`, `step` alone and `min` alone; a text field; the
  four colours (`_dbg__SpatialGrid.ts:586`'s hex number with `kind: 'color'`, Tweakpane's
  `view: 'color'`; `_dbg__BaseFolder.ts:26`'s inferred `'#rrggbb'`; `_dbg__RayTester.ts:492`'s
  string with `view: 'color'`; `_dbg__DebugTools.ts:682`'s float object, its
  `color: { type: 'float' }` dropped: an object is floats here); the `view: 'list'` blade as an
  unbound select.
- **Monitors:** plain, with an `interval`, with a `format`, multiline with `rows` and with and
  without an `interval`.
- **Functions:** a `disabled` and a `hidden` function on a checkbox, re-read by the button's
  refresh (as a tab's `updateDebuggerTab`).
- **Structure** (shut): a nested folder, a separator, a button, a labelled button and a `custom`
  item (the day-night speed buttons as kit buttons).

Not yet (Phase 5): the vector (`_dbg__DebugTools.ts:549`) and the rotation
(`_dbg__Character.ts:213`). Until then a value no field edits shows as a monitor, with a warning.
