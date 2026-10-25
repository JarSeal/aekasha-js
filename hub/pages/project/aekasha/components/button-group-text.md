## Button group

`createButtonGroup({ label, buttons })` joins buttons made with `createButton` into one row (or
column, `orientation: 'vertical'`), named as a group (`role="group"`, `aria-label`): each button
stays a tab stop. With `exclusive: true` its toggles are a toolbar (`role="toolbar"`): one pressed
at a time (a press of another releases it, a press of the pressed one changes nothing, `onChange`
gets the new one's index) and one tab stop, the pressed button, whose arrows along the group move
the focus (wrapping, disabled buttons skipped), Home and End to the ends, Space and Enter press.

- **States:** drawn in the page: a clipboard group, a view mode toolbar and a vertical tool
  toolbar. The status line says what a toolbar picked.
- The split button is a group of a button and a menu button: section 4, with the menu.
