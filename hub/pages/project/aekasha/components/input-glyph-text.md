## Input glyph

`createInputGlyph({ input })` draws one input for a prompt ("Press E to open"): a key as a key cap,
or a mouse button, the wheel or the mouse's movement as a mouse with that part in the accent.
`input` is an action binding's shape (`{ device: 'KEYBOARD', key }`, `{ device: 'MOUSE', button }`
or `{ device: 'MOUSE', delta }`), so a map's binding goes in as it is. It's `role="img"`, named by
the input ("Left mouse button"); its height is `--aek-input-glyph-size` (`1.6em`, so it follows
its text). `setInput` redraws it.

- **States:** keys, the mouse's parts, and a prompt with a key and a button in its text.
- Static and keyboard plus mouse here: p808 makes it follow the device in use and adds the gamepad
  families.
