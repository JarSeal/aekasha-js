## Dialog

`openDialog` is a modal window centred over a backdrop: it doesn't move, resize or collapse, and
every open resets it (600 × 600 px unless `size` says otherwise, at least 320 px and at most 90 %
of the screen). It takes the focus when it opens (`initialFocus`, else its first focusable
element), keeps Tab inside it, makes the rest of the HUD `inert` while it's open, and gives the
focus back to its opener when it closes (p803 D7). It's `role="dialog"` with `aria-modal`, or
`"alertdialog"` with `alert`. It closes
like any window, or with Escape when `closeOnEscape` is set. A dialog is on the kit's overlay stack
(p803 D7): Escape pressed inside the HUD goes to the top overlay alone and nothing else gets that
press or its keyup, so a drop-down's list open in the dialog closes first, and a dialog without
`closeOnEscape` stops Escape there. Escape pressed outside the HUD (here, on this page) is the
page's.

- **States:** the defaults (its close button or the content's own button), closing on Escape,
  closing on a backdrop click, a drop-down inside it (as the uiKit embed opens one), an alert
  (the focus on Cancel), and one over a window, which is inert until the dialog closes.
- **Not shown here:** the debugger's roots, which an app's dialog leaves live (they need the
  boot), and a debug dialog over them.
