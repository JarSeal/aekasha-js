## Voice

Ækasha is the quiet medium under someone else's work, and its words are the same: calm, short and
exact. These rules are for the engine's own text (the debugger, the kit's defaults, its messages
and errors); a game writes its players' text in its own voice, in its own design document.

- **Sentence case** everywhere: "Save scene", not "Save Scene".
- **Buttons are verbs** with their object where it helps: "Delete entity", "Open in editor".
- **Name the thing**: the scene's id, the file, the number of items. "3 entities deleted", not
  "Done".
- **Messages say what happened, then what to do**, in that order, with a colon between: "Couldn't
  load `forest`: the scene file is missing. Run `yarn gatherAppData`."
- **No blame, no drama**: no "you failed", "oops", "uh-oh" or exclamation marks.
- **Numbers carry their unit**, with a space: "16.7 ms", "48 MiB", "60 fps".
- **The engine's words, consistently**: scene, entity, component, body, collider, feature,
  window, tab. A label uses the API's name for the same thing.

::: do
"Couldn't create the body: the collider's mesh has no vertices."
:::

::: dont
"Error!! Physics failed." It says neither what failed nor what to change.
:::
