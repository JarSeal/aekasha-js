## Radio group and segmented control

[What they are and their states](hub:features/ui-kit/library#radio-group-and-segmented-control), on
the public page.

::: note For a later plan
p804 Phase 3 section 3: one module, `forms/RadioGroup.ts`, on the shell's group (`groupRole:
'radiogroup'`). The arrows are the browser's, which `yarn verify:ui`'s scripts check; the unit
tests can't (linkedom moves no focus between radios). Phase 4's declarative items make one from
`kind: 'radio'` or `kind: 'segmented'` with `options`.
:::
