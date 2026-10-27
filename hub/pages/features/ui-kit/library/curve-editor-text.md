## Curve editor

`createCurveEditor({ label, … })` edits a curve, written in place. Its value's shape says what kind:
four numbers are an easing as CSS's `cubic-bezier(x1, y1, x2, y2)` (two handles, the ends fixed at
(0, 0) and (1, 1)); an array of `{ x, y, inTangent?, outTangent? }` is keys joined by smooth
segments, for a falloff or an animation curve (a key without tangents is joined by straight lines).
`axes` sets each axis' range and step (default 0 to 1 by 0.01).

Each point is a slider: drag it, or move it with ArrowLeft / ArrowRight along x and ArrowUp /
ArrowDown along y (Shift ×10, Alt ×0.1). With keys, a press on the plot adds a key there, Insert
or `+` adds one after the focused key on the curve, Delete or Backspace removes it, and the
selected key's tangent handles drag its slopes. The row under the plot edits the selected point:
its X and Y and, for a key, its In and Out tangents, the "Add key" and "Remove key" buttons, and
the "Presets" menu (linear, ease in, ease out, ease in-out, smoothstep). `minKeys` (2) and
`maxKeys` (32) bound the count.

`evaluateCurve(curve, x)` reads its value at `x` without allocating (an easing solved as the
browsers do), and `getCurvePreset(name, mode)` makes a preset as either kind.

- **States:** drawn in the page, in a kit root of its own: CSS's `ease` with the presets and a
  button that sets it from outside (the plot flashes), a falloff over 20 m as keys, and a disabled
  easing. The status line says each write; the line under it is `evaluateCurve` at the middle.
