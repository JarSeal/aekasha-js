## Number field

`createNumberField({ label, … })` makes a text input that is a spin button, bound to a value:
`{ target, key }` writes `target[key]` in place, `{ get, set }` reads and writes through your
functions, and `{ value }` holds the value itself (read it with `getValue()`). Its handle has
`getValue`, `setValue`, `refresh`, `reset`, `setDisabled`, `setHidden`, `setError` and `focus`.
`onChange(value, { prev, last, source, field })` fires on every write: each step of a drag or a
held key with `last: false`, then once with `last: true` on the release, Enter or a blur. A
refresh from the bound value never fires it, so a handler can record undo and apply a live change
on every step.

- **Typing:** an expression (`1/2`, `2 ** 3`, `pi / 4`, and the units the field takes:
  `90deg`, `50%`) is written on Enter or a blur, or on each keystroke with `live`; an invalid one
  shows its error and keeps the value. Escape puts the value's text back. A value snaps to the
  `step`'s grid, stays in `min` / `max` (or wraps at them with `wrap`) and is rounded to the
  step's decimals, so `1 + 0.1` writes `1.1`.
- **Keys:** ArrowUp and ArrowDown step (Shift ×10, Alt ×0.1), PageUp and PageDown ×10, Home and
  End go to `min` and `max`. Ctrl/⌘+C with no text selected copies the value, Ctrl/⌘+V of a number
  sets it.
- **Scrub:** drag the label sideways to change the value (Shift ×10, Alt ×0.1); a click still
  focuses the input.
- **States:** drawn in the page, in a kit root of its own, all bound to one object: a step, a
  minimum, a unit and a hint; an angle that wraps; a percent shown by `format`; a live field; an
  error; disabled. The status line says what each write was. "Change the speed from outside"
  changes the bound value and calls the scheduler's `refresh()`: the field reads it and flashes
  once (a tint that stays as long under reduced motion). The reset button next to a label shows
  while the value isn't its default.

The field's label, reset button and message line are the shell every field shares; the scrub, the
clipboard and the flash's timing need a pointer and the browser's own editing, which the page's
checks don't drive (`NumberField.test.ts` does).
