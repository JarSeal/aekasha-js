## Sparkline

`createSparkline({ values?, capacity?, min?, max? })` draws a small line of recent values beside a
figure: an "over time" at a glance. `push(value)` adds one at the right (the oldest goes past
`capacity`), `setValues` replaces them; a `NaN` is a gap. It scales from the smallest value shown
to the largest unless `min` or `max` fixes an end (0 for a count), `area` fills under the line, and
the last value has a dot. It's SVG, so its stroke follows the theme and stays sharp; it builds its
points as a string, so push at a panel's rate, not every frame. Beside its figure it's hidden from
assistive tech; with a `label` it's an image named by it.

- **States:** drawn in the page on a panel: the Objects tab's "over time" (triangles in view and
  draw calls, 60 samples each, filled from 0; **Push a value** adds one to the first) and frame
  times with gaps, labelled, in a chart series' colour.
