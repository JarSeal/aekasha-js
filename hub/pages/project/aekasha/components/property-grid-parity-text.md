## Tweakpane parity

Only on this page (p804 D14): one property grid built with `addPropertyGridItems`, a row per row
of p804 Phase 0's Tweakpane census, each hinted with the census's source line, so p806 starts
from a page that shows every feature it ports. The status line says each field's last write
(`last` or a step).

- **Edit fields:** a checkbox; a slider (`min`, `max`, `step`); selects with the array and the
  object `options`; numbers with `min` and `step`, `step` alone and `min` alone; a text field; the
  four colours (`_dbg__SpatialGridItems.ts:258`'s hex number with `kind: 'color'`, Tweakpane's
  `view: 'color'`; `_dbg__BaseFolder.ts:26`'s inferred `'#rrggbb'`; `_dbg__RayTesterItems.ts:116`'s
  string with `view: 'color'`; `_dbg__DebugToolsFolders.ts:208`'s float object, its
  `color: { type: 'float' }` dropped: an object is floats here); the vector
  (`_dbg__DebugCameraFolder.ts:101`, inferred from its `{ x, y, z }`); the rotation
  (`_dbg__Character.ts:213`, an Euler with `step: Math.PI / 8`, inferred from its `order` and
  shown in degrees where Tweakpane showed radians); the `view: 'list'` blade as an unbound
  select.
- **Monitors:** plain, with an `interval`, with a `format`, multiline with `rows` and with and
  without an `interval`.
- **Functions:** a `disabled` and a `hidden` function on a checkbox, re-read by the button's
  refresh (as a tab's `updateDebuggerTab`).
- **Structure** (shut): a nested folder, a separator, a button, a labelled button and a `custom`
  item (the day-night speed buttons as kit buttons).

Every census row has its field now (p804 Phase 5).
