## Input prompt

`createInputPrompt({ bindings, label })` shows an action's binding for the device the player uses
("[E] Interact", "[Cross] Jump"): `bindings` is an action map's `getBindings(id)` as it is, and the
prompt draws the first one for the prompt device with input glyphs (a chord's modifiers, a
composite's four keys), else the first it can draw; touch shows the keyboard's. `setPromptDevice`
switches every prompt at once: wire it to the engine's `onLastInputDeviceChange` and the prompts
follow the player. Each glyph is an image named by its input.

- **States:** in the page: five prompts (a key, Space, a chord, a composite, a mouse button), and
  the prompt device set to the keyboard, each gamepad family and touch.
