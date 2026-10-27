## Number field

[What it is and its states](hub:features/ui-kit/library#number-field), on the public page.

::: note For a later plan
p804 Phase 2 built it with the field shell (`forms/Field.ts`) and the binding core
(`forms/binding/`). Phase 3's slider puts a track beside the same spin button, Phase 4 adds
`readonly: true` (a monitor), and Phase 5's vector, rotation and quaternion fields are rows of its
number parts. Its scrub, clipboard and expression units have no keyboard script here:
`yarn verify:ui` has no pointer drag or clipboard step (`NumberField.test.ts` checks them).
:::
