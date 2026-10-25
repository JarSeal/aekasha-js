## Toaster

`createToaster` returns the toaster's CMP (add it under the HUD root); `addToast` adds a toast to
the default toaster (the first one made) or the one its `toasterId` names. One timer per toast.
The engine makes a toaster only in the debug env, so an app that shows toasts makes its own.
Nothing goes into the page's head: a toaster's sizes are custom properties on its element.

- **States:** the four kinds (info, success, warning, alert, which is closable by default), each
  with its status colour and icon, a title, a toast that stays until it's closed
  (`showingTime: 0`), a long message (it scrolls inside the toast, the close button in its own
  column), and a second toaster with its own settings (top right, its toasts coming down from the
  right).
- **Assistive tech and keys:** each toaster reads a toast once through its live regions
  (a polite `status`, an assertive `alert`), the close button is labelled and a tab stop, and
  Escape in a toast closes it with the focus back where it was. The showing time pauses on hover,
  on focus and while the page is hidden.
- The slide and the fade are timed in JavaScript and follow the reduced motion setting (the
  element's `--aek-motion`): under reduced motion a toast fades in place instead.
