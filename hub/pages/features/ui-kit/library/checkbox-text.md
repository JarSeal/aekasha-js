## Checkbox and switch

`createCheckbox({ label, … })` and `createSwitch({ label, … })` are both a native
`<input type="checkbox">`, bound to a boolean the same three ways as the other fields and written
on each click (one `onChange` with `last: true`). Space flips them, as a click on their label
does. The switch is the same input with `role="switch"`, for a setting that takes effect at once;
`onText` and `offText` show its state beside it (hidden from assistive tech, which hears the
switch's own state).

- **Mixed:** a checkbox's `indeterminate` (and `setIndeterminate`) shows a bar until it's clicked,
  and assistive tech hears "mixed": a checkbox over several others, some on and some off.
- **States:** drawn in the page, in a kit root of its own: two checkboxes, "All layers" over
  three (mixed while some are on; it sets them all), two switches (one with its state as text) and
  disabled ones. The status line says what each click did.

Each is a 24 px target in both densities, the box or the track drawn inside it, so the focus ring
is around the whole target. The switch's thumb slides in `--aek-motion-fast` (at once under
reduced motion).
