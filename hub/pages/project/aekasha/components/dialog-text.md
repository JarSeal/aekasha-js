## Dialog

`openDialog` is a window centred over a backdrop: it doesn't move, resize or collapse, and every
open resets it (600 × 600 px unless `size` says otherwise, at least 320 px and at most 90 % of the
screen). It takes the focus when it opens and gives it back to its opener when it closes. It closes
like any window, or with Escape when `closeOnEscape` is set. A dialog is on the kit's overlay stack
(p803 D7): Escape pressed inside the HUD goes to the top overlay alone and nothing else gets that
press or its keyup, so a drop-down's list open in the dialog closes first, and a dialog without
`closeOnEscape` stops Escape there. Escape pressed outside the HUD (here, on this page) is the
page's.

- **States:** the defaults (its close button or the content's own button), closing on Escape,
  closing on a backdrop click, and a drop-down inside it, as the uiKit embed opens one.

::: note For p803
Phase 5 makes a dialog modal for assistive technology and the keyboard: its ARIA, a focus trap,
`inert` on the rest of the HUD, and its own z-order above the windows.
:::
