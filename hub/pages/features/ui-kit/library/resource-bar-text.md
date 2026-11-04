## Resource bar

`createResourceBar({ label, max, value, segments?, thresholds?, showValue? })` is a value a game
shows all the time (health, stamina, a shield): a `role="meter"` whose value text says the value
and its threshold's word ("18 of 100, Low"). A drop leaves a damage trail that holds, then
shrinks; a heal fills and flashes; a threshold sets `data-state` and a word, never the colour
alone; `segments` draws dividers. `setValue` writes nothing when the shown value is unchanged, so
a game sets it every frame.

- **States:** in the page: health with thresholds, a segmented stamina bar and a percent, after a
  hit, a heal, low health, a run, a higher maximum and a broken shield. The trail and the flash
  have ended by the screenshot.
