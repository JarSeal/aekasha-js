## Angle dial

`createAngleDial({ label, … })` edits an angle on a circle with a hand: a press turns the hand to
the pointer and a drag takes it round (Shift snaps to 15°, Alt drags on a tenth of the step). The
angle's spin button in degrees sits beside it and is the keyboard's and assistive tech's control,
as a slider's is; with `showInput: false` the dial is the slider itself. The value is in radians
(three's), or in degrees with `angleUnit: 'degrees'`; `step`, `min` and `max` are in the value's
unit, so Tweakpane's `Math.PI / 8` shows as 22.5°. It wraps at its ends (default -180° to 180°),
or clamps with `wrap: false`. `convention: 'compass'` puts 0 at the top, turning clockwise (a
heading, a sun's azimuth); the default is 0 at the right, anticlockwise.

- **States:** drawn in the page, in a kit root of its own: a heading in radians with
  `step: Math.PI / 8` and a button that turns it from outside (its box flashes), a compass in
  degrees from 0 to 360, the dial alone as the slider, a quarter turn without wrapping, an error
  and a disabled dial. The status line says each write (to 3 decimals).
