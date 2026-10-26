## Button

`createButton({ label, … })` makes a native `<button>` (`type="button"`) and returns its handle,
whose setters write it in place: `setLabel`, `setDisabled`, `setLoading` (the width kept, the text
faded into a spinner, `aria-busy`, clicks ignored) and a toggle's `setPressed`. Its variants are
`primary` (a group's one main action), `secondary` (the default), `ghost`, `danger` and `link`
(an action that looks like a link; a navigation is a link), at `sm`, `md` or `lg`. It takes an
`icon` (at the start or the end, or `iconOnly`, when its label is its `aria-label` and tooltip),
a `tooltip`, and a `kbd` hint (drawn with Kbd, hidden from assistive tech, and the button's
`aria-keyshortcuts`). With `pressed` it's a toggle (`aria-pressed`); with `holdToConfirmMs` it
acts only after the pointer, Space or Enter is held that long, a fill across it showing the time
(in steps under reduced motion), and assistive tech hears "Hold to confirm".

- **States:** drawn in the page, in a kit root of its own: the variants, the sizes, the icons, a
  shortcut's hint on a button that loads on a click, disabled and loading, two toggles and a hold
  to confirm. The status line under them says what each did.
- A hold to confirm ignores a click with no press, which is how some screen readers activate a
  button in their browse mode: such a user holds Space in the screen reader's focus mode. An app
  that can't ask that offers another way (a confirmation dialog).
- The icon button is a button with `iconOnly`: no component of its own. The button group, the
  split button and the link have boxes of their own below.
