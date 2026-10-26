## Kbd

`createKbd({ keys })` draws a key hint: a chord as `getKeyChordLabel` writes it
(`'Ctrl+Shift+P'`), a `<kbd>` per key with `+` between them, or several chords joined with
`' / '`, shown with "or". On macOS the modifiers are symbols (⌘ ⇧ ⌥ ⌃) and the arrows are arrows
everywhere; where a key shows something other than its word, assistive tech hears the words
("Command+Shift+P") from a visually hidden copy. It's sized in `em`, so it follows its text. Display
only: binding the key is the app's. `setKeys` redraws it in place. A button's or a menu item's
`kbd` takes the handle and names its keys in `aria-keyshortcuts`.

- **States:** chords, the macOS names, this platform's names, alternatives, and a hint in a line of
  text. Drawn in the page, in a kit root of its own (as an app's UI outside the HUD).
