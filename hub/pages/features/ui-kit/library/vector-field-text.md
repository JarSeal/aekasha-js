## Vector field

`createVectorField({ label, … })` edits a vector bound the same three ways as the other fields:
an `{ x, y }` to `{ x, y, z, w }` object, written in place (a `THREE.Vector3` stays the same
instance), or an array of 2 to 4 numbers. Each axis is a number part with its letter before it,
taking the number field's keys and typed expressions; `min`, `max`, `step` and `precision` are
shared, or an axis' own in `axes` (which also names it: `W` and `H` for a size). Ctrl/⌘+C in an
axis with nothing selected copies the whole vector (`1, 2.5, -3`), and pasting as many numbers as
it has axes sets them all.

- **Linked axes:** `linkable: true` adds a toggle after the axes; while it's pressed, a change to
  one axis scales the others by the same factor (a uniform scale), or moves them by the same
  amount when that axis was 0.
- **States:** drawn in the page, in a kit root of its own: a position with a button that moves it
  from outside (its boxes flash), a linked scale, a size as an array with named axes and a unit,
  four axes, an error and a disabled field. The status line says what each write was.

The row is a group named by the label, each axis a spin button named by its letter, so a screen
reader hears "Position, group, X, spin button". The letters' colours are a hint only.
