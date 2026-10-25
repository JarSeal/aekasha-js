## Colours

Every colour is a role, never a value: a style reads `var(--aek-text)`, not `#e6ebf2`. Each role
has a value in both themes. Dark is the default, light follows `prefers-color-scheme`, and
`data-aek-theme="dark"` or `"light"` on any element forces its subtree.

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
as text, the debugger writes values in them) and 3:1 for a control's edge and the focus ring.
`Tokens.test.ts` fails on a pair below its minimum, and every role needs a pair or a written
reason (the lists are in `TokenSheet.ts`): a new role gets one there before it's used.
