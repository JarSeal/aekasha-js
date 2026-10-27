## Angle dial

[What it is and its states](hub:features/ui-kit/library#angle-dial), on the public page.

::: note For a later plan
p804 Phase 6 section 1: `forms/AngleDial.ts`, its spin button `rotation/AnglePart.ts`'
`getAnglePart` (moved out of `RotationField.ts`, so the dial brings none of the rotation field's
code). A drag follows the pointer's turn since the last move (unwrapped), so it crosses ±180°
smoothly and, without `wrap`, holds at an end until the pointer comes back round. Its drag is
`PointerDrag.ts`' (the sliders' too).
:::
