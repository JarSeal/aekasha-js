## Button

[What it is and its states](hub:features/ui-kit/library#button), on the public page.

::: note For a later plan
p804 D13 made `kbd` a Kbd handle the app makes (`components/ShortcutHint.ts` draws it, the menu's
too), so a button imports none of Kbd's code. The string form is deprecated: it loads Kbd with
`import()` on first use, and p622 (engine 6.0.0) removes it and that path. `onUnheldClick` has
no keyboard script: `yarn verify:ui` has no step that clicks without a press (`Button.test.ts`
checks it).
:::
