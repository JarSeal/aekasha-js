## Time series

`createTimeSeries({ series, capacity })` draws figures that change every frame as lines over their
last `capacity` samples, on a canvas: `push(value)` for one series, `pushAll(values)` for several,
as often as every frame, drawn at most once per animation frame while it shows (only the new
samples are drawn; the rest is the last frame's image moved left). The range runs from 0 to a
nice ceiling over the values and the thresholds, which grows when a value passes it and shrinks
only after a whole buffer under a lower one. `thresholds` draw a line at a value in a status
colour with its text. The plot is hidden from assistive tech: the summary under it (each series'
latest value, min and max, written at most four times a second) is its text.

- **States:** drawn in the page on panels, from fixed figures: a frame's three stages over 300
  samples with a budget line (**A long frame** pushes a frame whose render stage took 30 ms, and
  the range grows to 50; **Fix the range at 0 to 10 ms** holds it there, a value past it drawn at
  the top), and a draw call count with a gap and no ticks. The **Live** switch pushes a sample
  each frame.
- **What the page can't show:** its colours are read from the theme when it first draws and again
  when the theme or density changes, which a switch on this page does.
