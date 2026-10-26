## Range slider

`createRangeSlider({ label, min, max, … })` picks a range on one track: its value is
`{ min, max }`, bound the same three ways as the other fields (`{ target, key }` writes the object
in place), with the same handle and `onChange`. It's the APG multi-thumb slider: each thumb is a
slider of its own ("Minimum Price", "Maximum Price") whose ends are the track's and the other
thumb's, so neither passes the other, and `minGap` keeps them that far apart.

- **The span** between the thumbs is a third stop: its arrows move both (the range's width
  kept), Home and End take it to the track's ends, and a drag on it moves both.
- **Pointer:** a press on the rail moves the nearer thumb there and drags it; a press on a thumb
  drags it from where it was grabbed (two thumbs at one value: the first move's side picks which).
  The press focuses what it moves. Each move writes `last: false`, the release `last: true`.
- **Keys:** on a thumb, the slider's: the four arrows (Shift ×10, Alt ×0.1), PageUp and PageDown
  ×10, Home and End to the thumb's own ends.
- **Spin buttons** (`showInputs: true`): one at each end of the track, for an exact value or a
  keyboard user who'd rather type: each is the number field's (an expression written on Enter or
  a blur, the arrows, Home and End, copy and paste), kept on its side of the other with the gap.
  They're then the controls the keyboard and assistive tech use, as the slider's spin button is,
  and the track is for the pointer only.
- **Histogram** (`histogram: number[]`): bars over the rail, spread evenly from `min` to `max`,
  those in the range in the fill's colour. `ticks` are the slider's.
- **States:** drawn in the page, in a kit root of its own, bound to one object: a price range with
  a histogram and a 50 € gap, a span of years with labelled ticks whose thumbs may meet, an
  altitude band with its spin buttons (typed in metres, or in `km`) and a disabled one. The status
  line says what each write was.

Each stop is a 24 px target in both densities, and the thumbs' bubbles show while they move.
