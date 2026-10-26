## Fieldset

`createFieldset({ legend, children })` is a native `<fieldset>` and `<legend>` around a group of
fields outside a property grid: a form's section, a dialog's group of settings. The legend names
the group; a `hint` describes it.

- **Disabled:** `disabled` (or `setDisabled`) disables every field in it as its own `disabled`
  would: the labels, the state and the kit's own stops, such as a slider's thumb, which the
  browser's `disabled` doesn't reach. A field's own `disabled` stays when the fieldset is enabled
  again.
- **States:** drawn in the page, in a kit root of its own: two sections of a form, and
  "Disable the notifications" for the second one disabled, its fields out of the tab order.
