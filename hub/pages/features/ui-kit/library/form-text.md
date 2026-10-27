## Form

`createForm({ children, onSubmit, submitLabel, resetLabel })` is a `<form novalidate>` around
fields, fieldsets and property grids that checks its fields itself: each field's `required` (an
empty value: `''` or spaces, `false`, `null`) and `validate(value)`, which returns the error or
null.

- **Errors:** checked on a submit, and from then on when the focus leaves a field. Each error is
  under its field (`aria-invalid`, the danger colour and a `!` mark), and on a submit an error
  summary at the top takes the focus and links each error to its field (the GOV.UK pattern): a
  link focuses the field, opening a shut folder around it. A field that is hidden or disabled
  isn't checked; a field's own error (an expression that doesn't parse) and the app's `setError`
  count too.
- **Submit:** Enter in a single-line field, the submit button or `submit()`; `onSubmit` runs only
  when every field is valid. A promise from it keeps the form busy (`aria-busy`, the submit button
  loading) until it settles.
- **Reset:** the reset button or `reset()` writes every field's default as the user's change (so
  an undo records it), and takes the errors and the summary away.
- **Required:** a `*` after the label, hidden from screen readers, with `required` or
  `aria-required` on the control where its role takes one.
- **States:** drawn in the page, in a kit root of its own: a new player's form in two fieldsets.
  "Submit it empty" shows the summary and the errors; "Fill it in" fills every field, so Create
  succeeds after a moment.

The browser's own validation messages never show: the form's errors are text in the page, in the
kit's colours, read with their fields.
