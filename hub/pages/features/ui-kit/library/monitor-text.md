## Monitor

`createMonitor({ label, … })` shows a bound value as text, read on its scheduler's tick every
`interval` ms (200 by default, 0 every frame): a frame time, a body count, a state.
`interval: 'refresh'` keeps it off the tick: only the scheduler's `refresh()` reads it. A read
that finds the value unchanged writes nothing. A monitor without a scheduler shares one tick with
the page's other monitors. Any field's `readonly: true` is a monitor in that field's own text: a
number's format and unit, an option's label, a checkbox's "On" or "Off".

- **Text:** a number in its decimals (`precision`), a boolean as `onText` / `offText`, a vector's
  axes, a string as it is, or `format`'s text. `multiline` (with `rows`) shows the text as a block
  of lines that scrolls.
- **Not a live region:** a value that changes every frame would drown a screen reader, so a line
  is read after its label, in order, and nothing is announced. The multiline block is a read-only
  text area, a tab stop so its scroll can be reached. A value worth announcing is an app's own
  `aria-live` text.
- **States:** drawn in the page, in a kit root of its own: a simulation's values, which "Step the
  simulation" changes (the tick draws them; a monitor never flashes), one read only when its
  Refresh button refreshes the scheduler, a multiline log, every field so far with
  `readonly: true`, a hint and a disabled one.
