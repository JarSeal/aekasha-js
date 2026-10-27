## 2D pad

`createPad2D({ label, … })` edits an `{ x, y }` value (a `THREE.Vector2`, written in place) on a
box with a point: an offset or a direction. A press puts the point under the pointer and drags
it; the pad is a tab stop whose arrows move it (Shift ×10, Alt ×0.1). Its two axes, the vector
field's parts under it, are its accessible editor (the APG has no 2D pattern): the pad is a group
described by its value's text. Each axis spans its `min` to `max` (default -1 to 1, by 0.01;
`axes` sets one's own), y upwards unless `invertY` (screen coordinates).

- **States:** drawn in the page, in a kit root of its own: an offset on the defaults with a button
  that moves it from outside (the pad and the boxes flash), a screen anchor from 0 to 100 px with
  y down, and a disabled pad. The status line says each write.
