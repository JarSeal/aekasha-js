## Fields' context menu

`createFieldContextMenu({ container })` gives every field in a container (a property grid, a form,
any panel) one context menu: **Reset** to the field's default, **Copy** the value as text, **Paste**
a value (read when it's picked; a text that isn't one is the field's message, as a typed one is)
and **Copy as**, a submenu of a colour's hex, `rgb()` and sRGB floats, or a vector's array and
object. A right click on a field's label opens it (on the control the browser's own menu stays,
with a text's Cut, Copy and Paste), as do the ContextMenu key and Shift+F10 with the focus in the
field. Reset is off at the default; Reset and Paste are off for a monitor and a disabled field;
Copy and Paste are off where the page can't use the clipboard.

- **States:** drawn in the page, in a kit root of its own: a number field, a colour field, a
  vector field, a select, a monitor and a disabled field, all under one menu. The status line says
  what each change wrote. The page can't show the browser asking to read the clipboard: a paste may
  wait for it.
