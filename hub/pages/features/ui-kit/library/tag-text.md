## Tag

`createTag({ label, tone? })` labels a thing's kind, in the badge's tones. `selectable: true` makes
it a filter's chip, a toggle button (`aria-pressed`, a check mark when it's on), whose button
fills the chip. `removable: true` adds a remove button named "Remove {label}" (a 24 px target),
and Backspace or Delete on the tag removes it too: the tag removes itself, moves the focus to the
next tag (else the previous) and calls `onRemove`, where the app drops it from its list.

- **States:** drawn in the page: the tones, three filter chips, three removable tags, one with an
  icon and a disabled one. The status line says what changed.
