## Icons

The built-ins are 16 × 16, drawn in Bootstrap Icons' form (most are Bootstrap's own, the rest
are drawn for Ækasha the same way): a filled shape or a 1-wide line, in `currentColor`, so an icon
takes its text's colour and, sized `1em`, its text's size. The Hub's own pages use Lucide; the kit
doesn't.

- An icon goes with a word, or stands for a well-known action (close, play, pause, undo). An
  icon-only button has an `aria-label` and a tooltip saying the same.
- A status icon (`alert`, `warning`, `info`, `circleCheckCutout`) goes with its status colour and
  a message: the icon is what makes the colour readable.
- An icon is registered by name before it's shown (`registerIcon`). The debug tools register every
  built-in; a production app registers only the ones it shows, so its build carries no others.
- A new built-in comes from Bootstrap Icons as it is, under its own file name, or is drawn in the
  same form. It gets an export in `BuiltInIcons.ts` and a name in `SvgIcon.ts`, and appears in the
  table below on the next build.

::: do
A window's close button: the `x` icon, `aria-label="Close"` and the tooltip "Close".
:::

::: dont
A bare `gear` icon that opens one of three different panels depending on where it is: an icon
without a label has to mean the same thing everywhere.
:::
