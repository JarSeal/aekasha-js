## Dialogue box

`createDialogueBox({ onAdvance, onChoice, charsPerSecond })` holds a conversation: a speaker, a
portrait (an element the app gives), a line typed out and the choices. Enter, Space or a click
shows the whole line, then goes on (Continue is a real button); the choices are buttons in a group,
the arrows between them and 1-9 picking one. The whole line is read when it starts, not a
character at a time; under reduced motion it shows at once.

- **States:** in the page: a line, the question with its choices (one disabled) and empty. The
  lines show whole: a typewriter's screenshot would depend on its timing. The switch in the box
  types them out, as a game's would.
