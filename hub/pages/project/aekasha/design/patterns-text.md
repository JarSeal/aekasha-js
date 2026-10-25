## Patterns

- **The primary action**: one per group (a dialog, a form, a toolbar section), the only accent
  button there, labelled with the verb of what it does ("Save scene", "Delete 3 entities"), not
  "OK". The other actions in the row are neutral.
- **Forms**: every field has a visible label (or an `aria-label` where the context names it, as in
  a vector's x, y and z). Help text sits under the field. A value is checked when it's committed
  (Enter, blur, release), not on every key; a problem shows under its field in the `danger` colour
  with its icon and `aria-invalid`, and says how to fix it.
- **Empty states** say what would be here, why it's empty and how to fill it, with the action as
  a button when there is one: "No lights in this scene. Add a light".
- **Errors** say what happened and what to do next, keep what the person typed, and stay until
  they're read. A field's error is inline; an error about an action is a toast (read out at once,
  `assertive`); an error that blocks the work is a dialog.
- **Loading**: a spinner with a label for screen readers, after a short delay (a quick result
  shouldn't flash one). A button that starts the work keeps its width, shows the spinner, ignores
  clicks and sets `aria-busy`. A skeleton holds a layout's place and doesn't shimmer under reduced
  motion.
- **Destructive actions** use the `danger` button, name what goes ("Delete the 'forest' scene"),
  and are never the default: focus starts on the safe action. Where it can be undone (the
  debugger's undo), do it at once and offer the undo; where it can't, confirm in a dialog or with
  hold-to-confirm.

::: do
A delete confirmation titled "Delete the 'forest' scene?", with "Cancel" focused and a `danger`
"Delete scene" button.
:::

::: dont
"Are you sure?" with "OK" and "Cancel", "OK" focused: nothing says what goes, and Enter does it.
:::
