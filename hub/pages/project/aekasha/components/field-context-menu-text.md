## Fields' context menu

[What it is and its states](hub:features/ui-kit/library#fields-context-menu), on the public page.

::: note For a later plan
p805 Phase 1 section 4 (p804 D1's move): `forms/FieldContextMenu.ts`, reading each field's
`FieldMenuEntry` (`Field.ts`, a `WeakMap` by element) and its `FieldClipboard` (the number, colour,
vector and choice fields give their own; a string's and a boolean's pastes, a number's or an
object's copies). p806 puts one on every debugger grid.
:::
