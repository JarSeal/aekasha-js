## Rotation and quaternion fields

[What they are and their states](hub:features/ui-kit/library#rotation-and-quaternion-fields), on
the public page.

::: note For a later plan
p804 Phase 5 section 4: `forms/rotation/` (`RotationField.ts`, `QuaternionField.ts`,
`RotationMath.ts`: three's formulas without three, `RotationMath.test.ts` against three's), both on
`VectorField.ts`' `buildPartsField`. Phase 6's angle dial reuses `getAnglePart` and `ANGLE_UNITS`.
A wrapped 180° writes as -180° (the range is `[-180, 180)`).
:::
