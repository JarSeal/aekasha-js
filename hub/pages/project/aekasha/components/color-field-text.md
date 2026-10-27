## Colour field

[What it is and its states](hub:features/ui-kit/library#colour-field), on the public page.

::: note For a later plan
p804 Phase 5 sections 1-2: `forms/color/` (`ColorField.ts`, `ColorValue.ts`: the forms, the sRGB
curve with three's constants, the parser and HSVA; `RecentColors.ts`, the page's list;
`ColorPicker.ts`, vanilla-colorful's HSVA base loaded on the first open and defined as
`aek-color-picker`, its `::part`s styled in `ColorField.scss`). The keyboard script follows the
focus into the picker's shadow root (`verify:ui` reads the element focused there).
The alpha and the intensity are `NumberInput`s on a `NumberTarget`, as the vector's axes will be
(section 3). The property grid infers a colour from a hex string or an `{ r, g, b }` object; a
24-bit number says `kind: 'color'`.
:::
