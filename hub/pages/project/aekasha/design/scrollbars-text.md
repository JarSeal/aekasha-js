## Scrollbars

Every scrolling part of the kit, the debugger and the Hub has one scrollbar, the kit's, drawn from
the `--aek-scrollbar-*` tokens (`src/_engine/ui/styles/scrollbars.scss`). It belongs to the theme
like any other part: no scroller has a look of its own.

- **The track** is the colour of the surface it's on (`scrollbar-track`, transparent), with a thin
  line along its middle (`scrollbar-line`, `--aek-scrollbar-line-width`), so an empty track still
  shows how long it is.
- **The thumb** is a rounded bar inset from the track's edges (`scrollbar-thumb`, a control's edge
  colour, at least 3:1 on every surface), lighter under the pointer and while dragged
  (`scrollbar-thumb-hover`). The whole bar's width is its target, and it's never shorter than three
  bar widths.
- **The buttons** are an arrow at each end (`scrollbar-button-glyph` on `scrollbar-button`,
  transparent): one at the start, one at the end, whatever the platform does.
- **The size** is `--aek-scrollbar-size`, 10 px at the defaults, following the UI scale; the
  compact density keeps it (a thinner bar is harder to hit).

The browsers differ. Chrome, Edge and Safari draw all of it. Firefox draws the thumb and the
track in the theme's colours, thin, without the line or the buttons. On macOS the kit's bars are
classic ones, which take their width where the system's overlay bars took none.

::: dont
`scrollbar-color` or `scrollbar-width` on a component: since Chrome 121 either one switches the
kit's scrollbar off for the element and, inherited, for everything under it. A part that must
look different (a game menu over the scene that wants none) writes its own `::-webkit-scrollbar`
rules; to change the look, set the tokens.
:::

The samples below are scrollers in each theme; the colours' contrast is in the Colours tables.
