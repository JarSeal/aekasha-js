## Accessibility

Every component meets this from its first version. A component that can't says why in its JSDoc
and its Hub section (a running graph is hidden from screen readers, with its numbers as text
beside it).

- **Native elements first**: `button`, `a`, `input`, `select`, `label`, `fieldset` and
  `legend`, `table` with `th` and `scope`, `details` and `summary`, `dialog` for a modal. A custom
  widget (a listbox, a slider, tabs, a tree, a menu) follows its WAI-ARIA Authoring Practices
  pattern, with a roving `tabindex` inside it.
- **Keys**: Tab and Shift+Tab move between widgets, arrows inside one, Home and End to its ends,
  PageUp and PageDown by ten on a value. Enter or Space activates, and Escape closes the innermost
  overlay and gives focus back. Every pointer action has a key path: a scrub has arrows, a drag
  reorder has Alt+arrows.
- **Focus** shows on `:focus-visible` as the ring below: 2 px in the accent, 2 px out, never
  removed (an unlayered `outline: 0` in a kit or debugger style hides it wherever that style
  applies).
- **Overlays**: a modal dialog traps focus, sets `aria-modal` and gives focus back on close; a
  window is a labelled `role="dialog"` that the keyboard can reach. A toast is announced through
  an `aria-live` region (`polite`, `assertive` for an error), stays while hovered or focused, and
  can be dismissed from the keyboard.
- **Size**: a target is at least 24 × 24 px at UI scale 1, in the compact density too.
- **Labels**: every field has a visible label or an `aria-label`; an icon-only button has a label
  and a tooltip.

::: do
A clickable row is a `<button>` (or holds one) with the row's name as its text.
:::

::: dont
A `<div>` with a click listener: no focus, no Enter, nothing for a screen reader to call it.
:::
