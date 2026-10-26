## Text field

`createTextField({ label, … })` makes an `<input type="text">` bound to a string, the same three
ways as the number field (`{ target, key }`, `{ get, set }`, `{ value }`), with the same handle
and `onChange`. The typed text is written on Enter or a blur, once with `last: true`, or on each
keystroke with `live`; `onInput` gets each keystroke's text first. Escape puts the value's text
back, and a refresh never writes over what's being typed. `placeholder` and `maxLength` go on the
input.

- **Multiline** (`multiline: true`, `rows`, Tweakpane's names): a `<textarea>` where Enter is a
  new line and Ctrl/⌘+Enter or a blur writes.
- **Search** (`type: 'search'`): a search mark, a `searchbox`, a clear button ("Clear {label}",
  shown while there's text, which empties it and puts the focus back in the input) and
  `onSearch(text)`, called 250 ms after the last keystroke (`searchDelayMs`), at once on Enter or
  a clear.
- **States:** drawn in the page, in a kit root of its own, bound to one object: a field with a
  hint and a maximum length, a live one, a multiline one, a search over a list of words (its
  label hidden: the search mark and the placeholder show what it is), an error and a disabled
  field. The status line says what each write was.
