## Divider

`createDivider({ orientation? })` is a line between two groups: an `<hr>` across a column, or a
`role="separator"` with `aria-orientation="vertical"` down a row, as tall as the row's items.
`decorative: true` hides it from assistive tech, where nothing ends or begins. Its colour is
`--aek-border` (decorative, as a separator needs no contrast) and its space either side
`--aek-divider-spacing`.

- **States:** drawn in the page: a pause menu's column split before Quit, and a toolbar's groups.
