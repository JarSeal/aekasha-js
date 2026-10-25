## Type

Ækasha's faces are IBM Plex Sans and IBM Plex Mono, drawn together, so labels and figures in a
panel match. The kit's default is the system's UI font, so an app that doesn't opt in downloads
no font; the debugger, the full-page template and the Hub opt in (`aekasha/ui/fonts`).

- Sizes come from the scale, never a value: `md` (14 px) is the UI's body, `sm` and `xs` its
  secondary text and captions, `lg` and up headings. Every size follows the browser's font size
  and the game's UI scale. The compact density (`data-aek-density="compact"`, for tight panels:
  the debugger's from its restyle) shrinks the whole scale, `md` to 12 px.
- Weights: `regular` for text, `medium` for labels and buttons, `semibold` for headings, `bold`
  rarely, for one word that has to stand out.
- Line heights: `tight` for a single line in a control, `base` for UI text, `relaxed` for
  paragraphs someone reads.
- Numbers that change in place (fields, tables, monitors, timers) use tabular figures, so they
  don't jitter as they change.
- `em` is for a size relative to the element's own text (an icon at `1em`); everything else is a
  token.

::: do
`font-size: var(--aek-font-size-sm); font-variant-numeric: var(--aek-numeric-tabular);` on a
frame-time readout.
:::

::: dont
`font-size: 12px` or `1.2rem`: a pixel size ignores the UI scale, and a `rem` follows the host
page's root. (`--aek-rem` is the old styles' internal unit, on its way out: don't add one.)
:::
