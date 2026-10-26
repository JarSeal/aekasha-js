## Menu and split button

`createMenu({ anchor, items })` is the APG menu button: its trigger (a button) opens a list of
actions (`menuitem`, with an icon and a shortcut's hint), on / off items (`menuitemcheckbox`),
one-of choices (a `group` of `menuitemradio`s), named groups and separators, anchored to the
trigger on the kit's overlay stack, in the top layer. Enter, Space and ArrowDown on the trigger
open it on its first item, ArrowUp on its last; in it the arrows move (wrapping), Home and End go
to the ends, typed letters go to the next item starting with them, Enter picks and closes, Space
flips an on / off item or a choice and keeps it open, Escape and Tab close it with the focus back
on the trigger. Hovering focuses an item; a disabled one is focusable and picks nothing. An
action's `onSelect` runs after the menu closed, so a dialog it opens returns the focus to the
trigger. `items` may be a getter, read on every open: the checked states and values are the app's.

`createSplitButton({ label, onClick, items })` joins an action's button and an icon-only menu
button ("More options") with that menu of its variants, in a group named by the action.

- **States:** drawn in the page: a File menu button and a split button, each menu also open. The
  status line says what was picked.
