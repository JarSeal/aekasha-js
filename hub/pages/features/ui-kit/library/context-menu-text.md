## Context menu

`createContextMenu({ target, items })` opens the menu (`createMenu`'s items, submenus included)
over everything inside `target`: a right click at the pointer, the ContextMenu key or Shift+F10 at
the focused element's corner, a touch held still for half a second. `items` may be a function of
the element it opens on and how (`'pointer'`, `'keyboard'`, `'touch'`), read at each open, so one
menu serves a whole list: it finds the row from the element. Where it gives no items, a right
click shows the browser's own menu, as Shift+right click always does. Escape and a pick close it
with the focus back on what had it.

- **States:** drawn in the page: a list of three scene objects, each a button; a right click on a
  row, or the ContextMenu key on a focused one, opens the row's actions (a checkbox for its
  visibility, a submenu of where to move it). The status line says what was picked. A right click
  on the box's background keeps the browser's menu.
