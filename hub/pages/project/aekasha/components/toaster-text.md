## Toaster

`createToaster` returns the toaster's CMP (add it under the HUD root) and puts its CSS in the
page's head; `addToast` adds a toast to the default toaster (the first one made) or the one its
`toasterId` names. One timer per toast. The engine makes a toaster only in the debug env, so an
app that shows toasts makes its own.

- **States:** the three kinds (info, warning, alert, which is closable by default), a title, a
  toast that stays until it's closed (`showingTime: 0`), a long message, and a second toaster with
  its own settings (top right, its toasts coming down from the right).
- The slide and the fade are timed in JavaScript and follow the reduced motion setting (the
  element's `--aek-motion`), so they stop where the CSS transitions do.

::: note For p803
A toast's text colour comes from the host page, its close button sits over the text, and a long
message runs past the toast's maximum height (100 px by default): write a toast as one short
sentence.
:::
