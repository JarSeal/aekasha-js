## Curve editor

[What it is and its states](hub:features/ui-kit/library#curve-editor), on the public page.

::: note For a later plan
p804 Phase 6 section 3: `forms/curve/` (`CurveEditor.ts`, `CurvePlot.ts` with the geometry,
`Curve.ts` with `evaluateCurve` and `getCurvePreset`). Keys keep their order in the array, as the
gradient's stops; `evaluateCurve` reads them in any order (a scan per call, fine at the editor's
32 keys). p426's sequencer is the first user of the keys; a binary search over sorted keys is its
call if it needs more.
:::
