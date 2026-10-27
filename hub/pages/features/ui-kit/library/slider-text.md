## Slider

`createSlider({ label, min, max, … })` is a number field with a track before its spin button,
bound the same three ways (`{ target, key }`, `{ get, set }`, `{ value }`) with the same handle
and `onChange`. The track is for the pointer only: the spin button is the one control a keyboard
and a screen reader use, with everything the number field does (typed expressions, the keys, copy
and paste), so a slider is one tab stop.

- **Pointer:** a press on the track moves the thumb there and drags it, each move with
  `last: false` and the release with `last: true`; a click is a drag without a move. A press on
  the thumb drags it from where it was grabbed. Alt drags on a tenth of the step's grid. A bubble
  over the thumb shows the value while it's dragged.
- **Ticks:** `ticks: 5` marks five even places from `min` to `max`; an array marks values, each
  with an optional label under the track (`{ value: 90, label: '90°' }`). They're marks only:
  `step` makes the grid a value snaps to.
- **Without the input** (`showInput: false`): the thumb is the slider itself (`role="slider"`),
  a compact control. Its keys are the APG slider's: the four arrows step (Shift ×10, Alt ×0.1),
  PageUp and PageDown ×10, Home and End go to the ends, each keyup writing `last: true`.
- **States:** drawn in the page, in a kit root of its own, bound to one object: a volume shown
  as a percent, a field of view with a unit and labelled ticks, a quality without the input (its
  `format` names each step: "Low" to "Max", which assistive tech hears too) and a disabled slider.
  The status line says what each write was.

The thumb is a 24 px target in both densities. The bubble fades in over `--aek-motion-fast`, and
at once, without its rise, under reduced motion.
