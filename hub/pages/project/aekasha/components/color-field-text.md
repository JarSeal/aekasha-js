## Colour field

[What it is and its states](hub:features/ui-kit/library#colour-field), on the public page.

::: note For a later plan
p804 Phase 5 section 1: `forms/color/` (`ColorField.ts`, `ColorValue.ts`: the forms, the sRGB
curve with three's constants and the parser; `RecentColors.ts`, the page's list). Section 2 puts
the lazily loaded picker (`ColorPicker.ts`, vanilla-colorful's HSVA base) at the top of the panel.
The alpha and the intensity are `NumberInput`s on a `NumberTarget`, as the vector's axes will be
(section 3). The property grid infers a colour from a hex string or an `{ r, g, b }` object; a
24-bit number says `kind: 'color'`.
:::
