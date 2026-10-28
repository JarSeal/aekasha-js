## Colours

Every colour is a role, never a value: a style reads `var(--aek-text)`, not `#e6ebf2`. Each role
has a value in both themes. Dark is the default, light follows `prefers-color-scheme`, and
`data-aek-theme="dark"` or `"light"` on any element forces its subtree. Each theme sets
`color-scheme` with its values, so the browser's scrollbars and form controls match. The debugger
stays dark whatever the system's theme until it gets a theme setting of its own (p806).

- **Surfaces** are what things sit on: `bg` the page or the game's canvas edge, `surface` a panel
  or a window's body, `surface-raised` what floats over it (a menu, a popover), `surface-hover` a
  row or a control under the pointer. In the light theme `surface-raised` is the same white as
  `surface`, and the shadow raises it.
- **Borders**: `border` divides, `border-strong` emphasises, and both are decoration. The edge
  that tells a control apart from its background is `border-control` (3:1 on every surface).
- **Text**: `text`, `text-muted` for what's secondary, `text-disabled` for a disabled control
  only (WCAG exempts it, so nothing else may use it).
- **The accent** marks the one primary action in a group, keyboard focus, the selection, the
  current item (a tab, a nav entry) and a "this changed" flash. Nothing else: secondary buttons,
  borders, icons and headings stay neutral. Text on an accent fill is `on-accent`.
- **The status colours**, `danger`, `warning`, `success` and `info`, appear only for a status: a
  toast, a validation message, a budget over, a health bar. Each has a `-soft` tint for its
  background, and each always comes with an icon or a word, since colour is never the only signal.
- **The chart series**, `chart-1` to `chart-6` (blue, orange, violet, aqua, yellow, magenta), tell
  a chart's series and a donut's or a stacked bar's parts apart, in that order: neighbours stay
  apart under the common colour vision deficiencies, and each is 3:1 on `surface` and
  `surface-raised`. A series is never a status (there's no green or red among them: a budget's
  line or an over part takes a status colour), and it always has its name beside it, in a legend
  or a label. With more than two series in a chart where any can sit next to any (a scatter), the
  dark blue and violet come close: add shapes, or keep to two.

::: do
One accent per group: a dialog's "Save scene" is the primary button, "Cancel" beside it is neutral.
:::

::: dont
Accent headings, icons or borders to make a panel look lively: the accent then stops meaning "act
here".
:::

::: do
A failed save shows the `danger` colour with its icon and the words: "Couldn't save the scene: the
file is read only."
:::

::: dont
A red border alone on a field that failed: a reader who can't tell red from grey sees nothing.
:::

Contrast is WCAG 2.2 AA in both themes: 4.5:1 for text (the accent and the status colours count
as text, the debugger writes values in them) and 3:1 for a control's edge, the focus ring and a
chart series.
`Tokens.test.ts` fails on a pair below its minimum, and every role needs a pair or a written
reason (the lists are in `TokenSheet.ts`): a new role gets one there before it's used.
