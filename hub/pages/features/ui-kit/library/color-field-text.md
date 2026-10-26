## Colour field

`createColorField({ label, … })` edits a colour bound the same three ways as the other fields,
written back in the form it was found in: a 24-bit number (`0xrrggbb`, what a `THREE.Color`'s
`getHex()` gives), a hex string (`'#rrggbb'`, `'#rrggbbaa'`), or an `{ r, g, b, a? }` object of
0-1 floats, written in place, so a `THREE.Color` stays the same instance (its floats are linear:
`colorSpace: 'linear'`). The text shows the colour as hex and takes hex, `rgb()`, `hsl()` or three
numbers 0-1, written on Enter or a blur; Escape puts it back. Ctrl/⌘+C with nothing selected
copies the colour, and a pasted colour sets it.

- **The panel:** the swatch before the text opens it, a popover with the picker (a plane of
  saturation and brightness, a hue slider and, with alpha, an alpha slider: each a slider the
  arrows move, the plane taking the focus at the open), `palette`'s swatches, the page's recent
  colours (the ones set in any colour field, newest first; an app that keeps them
  across loads reads them with `getRecentColors()` and restores them with `setRecentColors()`) and
  the browser's eyedropper, where it has one. A swatch sets its colour and marks it as the current
  one; Escape closes the panel and puts the focus back on the swatch.
- **Alpha and intensity:** `alpha: true` (or a hex string with alpha digits) adds a spin button
  for the alpha, 0-1 (`50%` typed works). `intensity` adds a number bound on its own, a light's
  intensity next to its colour.
- **States:** drawn in the page, in a kit root of its own: a number with a palette (and the panel
  open: the picker, the palette and three recent colours), a hex string with alpha (its panel
  open: the alpha slider too), a light's linear colour
  with its intensity and a button that changes both from outside (they flash), an error and a
  disabled field. The status line says what each write was.

The picker's code loads the first time a panel opens (about 3 KiB): a page with colour fields
that no one opens never downloads it, and until it's there the rest of the panel works. It's
[vanilla-colorful](https://github.com/web-padawan/vanilla-colorful)'s, its sliders named "Color",
"Hue" and "Alpha" by it; a drag in it writes as a slider's does (each move, then the release with
`last: true`), and it rounds to whole degrees and percent, so type an exact value. The
eyedropper's own screen isn't in the page's shots.
