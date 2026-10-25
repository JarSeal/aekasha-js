## Dialog

`openDialog` is a window centred over a backdrop: it doesn't move, resize or collapse, and every
open resets it (600 × 600 px unless `size` says otherwise, at least 320 px and at most 90 % of the
screen). It closes like any window, or with Escape when `closeOnEscape` is set: then nothing else
gets that press or its keyup.

- **States:** the defaults (its close button or the content's own button), closing on Escape,
  closing on a backdrop click, and a drop-down inside it, as the uiKit embed opens one.

::: warning Escape with a drop-down's list open
Open the drop-down in "With a drop-down" and press Escape: one press closes the list and the
dialog. The dialog's Escape listener is a capture listener on the window, so it runs before the
list's own. For p803, with the item it already has (a `closeOnEscape` dialog takes Escape from the
whole host page).
:::
