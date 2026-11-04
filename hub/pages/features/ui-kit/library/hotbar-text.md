## Hotbar

`createHotbar({ slots, selected, cooldowns, onUse, placement })` is a row of item slots, a
toolbar: one tab stop, the arrows round the slots, the number keys' hints. `onUse` is a slot's
click, Enter or Space; the app's action map calls `select` for the number keys and `selectNext` for
the wheel and the shoulder buttons. A selection made away from the bar is announced. In a HUD it
sits at the bottom; here `inline`.

- **States:** in the page: the first slot selected, the next and the previous by the wheel, and
  slot 3 by its key.
