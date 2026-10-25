## Drop-down

`createDropDown` returns `{ cmp, open, close, toggle, isOpen, refresh }`; its `cmp` goes where the
drop-down goes, under a CMP that's in the page (here, a window). The keyboard, the focus and the
ARIA roles are its own: the arrows and Home / End move, Enter or Space picks, Escape, Tab or a
click outside closes it without a change, and none of its keys reaches a key binding. A pick,
Escape or Tab gives the focus back to what had it when the list opened (the trigger, opened by
its keys). The open list is on the kit's overlay stack, so in a dialog one Escape closes the list
and the next the dialog.

- **States** (in one window): a value, no value (the placeholder), an icon, opening upward,
  disabled, and a value changed elsewhere, which the trigger shows after `refresh()`. The trigger
  re-reads `value` after `onChange` returns, so a pick shows at once; each pick here also adds a
  toast.

::: note For p803
The list's height is at most `40vh` (the browser window's, also in an embed), and a window clips a
list that overflows it.
:::
