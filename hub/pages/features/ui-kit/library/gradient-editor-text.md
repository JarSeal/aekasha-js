## Gradient editor

`createGradientEditor({ label, … })` edits a gradient, `{ stops: { t, color }[] }` (each stop's
place 0-1 and its hex colour), written in place. A preview bar shows it over a checkerboard; under
it each stop has a handle, a slider for its place: drag it, or move it with the arrows (Shift ×10,
Alt ×0.1, Home / End). A press on the bar adds a stop there, its colour the gradient's at that
place. On a focused handle, Insert or `+` adds a stop after it, Delete or Backspace removes it,
and Enter opens its colour panel. The row under the bar edits the selected stop: its position in
%, its colour (the colour field's swatch, panel and text, with `alpha` its alpha), and the "Add
stop" and "Remove stop" buttons. `minStops` (2) and `maxStops` (16) bound the count. Stops keep
their order in the array: one dragged past another stays itself.

`evaluateGradient(gradient, t, out?)` reads its colour at `t` as CSS draws it (sRGB, premultiplied
alpha), without allocating when given `out`: a sky's colours or a ramp, every frame.

- **States:** drawn in the page, in a kit root of its own: a sky ramp with a palette and a button
  that shifts a stop from outside (the bar flashes), a fade with alpha, and a disabled editor.
  The status line says each write; the line under it is `evaluateGradient` at a quarter.
