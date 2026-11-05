## Button

[What it is and its states](hub:features/ui-kit/library#button), on the public page.

::: note For a later plan
p804 D13 made `kbd` a Kbd handle the app makes (`components/ShortcutHint.ts` draws it, the menu's
too), so a button imports none of Kbd's code (p622 removed the string form, engine 6.0.0).
`onUnheldClick` has no keyboard script: `yarn verify:ui` has no step that clicks without a press
(`Button.test.ts` checks it).
:::
