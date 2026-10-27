## Select field

`createSelectField({ label, options, … })` is the drop-down above on a binding: one value of a
list, bound the same three ways as the other fields and written on each pick (one `onChange` with
`last: true`). `options` takes Tweakpane's two forms, `[{ text, value }]` and `{ [text]: value }`
(and the kit's `{ label, value }`), so a ported list is a rename; a value may be a string, a number
or a boolean. A getter in place of the options is read again on each open and refresh, for a list
that changes. A value no option has shows `placeholder`; `searchable` puts the drop-down's filter
over the list.

- **Keys:** the drop-down's: Enter or Space on the trigger opens the list on the value, the arrows,
  Home and End move, Enter or Space picks, and Escape or Tab closes it without a change; the focus
  comes back to the trigger. A click on the label focuses the trigger.
- **States:** drawn in the page, in a kit root of its own, bound to one object: the object form
  with number values, the array form with a hint, a searchable list from a getter (the button adds
  a place and calls `refresh()`), the placeholder, an error and a disabled field. The status line
  says what each pick was.

The trigger's name is the label and the value it shows ("Shadow map, 1024"), and the open list is
named by the label.
