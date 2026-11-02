## Input glyph

`createInputGlyph({ input, family })` draws one input for a prompt ("Press E to open"): a key as a
key cap, a mouse button, the wheel or the mouse's movement as a mouse with that part in the
accent, or a gamepad's button, stick or axis with its family's label (`SOUTH` is A on an Xbox pad,
Cross on a PlayStation pad, B on a Nintendo pad). `input` is an action binding's shape
(`{ device: 'KEYBOARD', key }`, `{ device: 'MOUSE', button }`, `{ device: 'MOUSE', delta }`,
`{ device: 'GAMEPAD', button }`, `{ device: 'GAMEPAD', stick }`), so a map's binding goes in as
it is. It's `role="img"`, named by the input ("Left mouse button", "Cross button"); its height is
`--aek-input-glyph-size` (`1.6em`, so it follows its text). `setInput` and `setFamily` redraw it.
The gamepad's buttons are neutral, never the brands' colours. An input prompt
(`createInputPrompt`) picks the binding for the device the player uses.

- **States:** keys, the mouse's parts, a gamepad's buttons in each family, and a prompt with a
  key and a button in its text.
