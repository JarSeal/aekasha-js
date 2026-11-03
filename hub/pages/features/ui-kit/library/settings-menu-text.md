## Settings menu

`createSettingsMenu({ pages, onChange, onReset })` is a game's settings: pages on tabs, each a
property grid of items bound to the app's settings object, so its graphics, audio and subtitle
settings are data. It reports each change with its page and its owner saves on `change.last`;
"Reset page" and "Reset all" (which asks first, inline) put the items' defaults back. Inline
content: a game menu's page, or a window's.

- **States:** in the page: the Display page, the Audio page, and both shown again after the
  settings changed from outside (`refresh()`).
