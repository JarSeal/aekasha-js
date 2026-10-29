## Button

`createButton({ label, … })` makes a native `<button>` (`type="button"`) and returns its handle,
whose setters write it in place: `setLabel`, `setDisabled` (with a reason, its tooltip while it's
disabled), `setLoading` (the width kept, the text
faded into a spinner, `aria-busy`, clicks ignored) and a toggle's `setPressed`. Its variants are
`primary` (a group's one main action), `secondary` (the default), `ghost`, `danger` and `link`
(an action that looks like a link; a navigation is a link), at `sm`, `md` or `lg`. It takes an
`icon` (at the start or the end, or `iconOnly`, when its label is its `aria-label` and tooltip),
a `tooltip`, and a `kbd` hint (a Kbd the app makes, hidden from assistive tech, its keys the
button's `aria-keyshortcuts`). With `pressed` it's a toggle (`aria-pressed`); with `holdToConfirmMs` it
acts only after the pointer, Space or Enter is held that long, a fill across it showing the time
(in steps under reduced motion), and assistive tech hears "Hold to confirm".

- **States:** drawn in the page, in a kit root of its own: the variants, the sizes, the icons, a
  shortcut's hint on a button that loads on a click, disabled and loading, two toggles and a hold
  to confirm, and one disabled but focusable (`focusableWhenDisabled`: `aria-disabled`, still a tab
  stop, its reason the tooltip). The status line under them says what each did.
- A hold to confirm can't be held through a click with no press, which is how some screen readers
  activate a button in their browse mode: it calls `onUnheldClick`, where the app confirms
  another way (a confirmation dialog), and does nothing without it. In focus mode such a user can
  hold Space. The page can't click without a press: the status line says what one would do.
- The icon button is a button with `iconOnly`: no component of its own. The button group, the
  split button and the link have boxes of their own below.
