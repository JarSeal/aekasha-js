## Slider

[What it is and its states](hub:features/ui-kit/library#slider), on the public page.

::: note For a later plan
p804 Phase 3 section 1: `forms/Slider.ts` builds on the number field's spin button
(`buildNumberField`, `@internal`, with the track around its box) and `forms/NumberSteps.ts`, the
keys every number part shares. The range slider (section 2) adds a second thumb on the same
track. The drag, the bubble and the grab offset have no keyboard script here: `yarn verify:ui`
has no pointer drag step (`Slider.test.ts` checks them).
:::
