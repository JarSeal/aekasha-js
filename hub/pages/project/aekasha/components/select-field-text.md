## Select field

[What it is and its states](hub:features/ui-kit/library#select-field), on the public page.

::: note For a later plan
p804 Phase 3 section 4: `forms/SelectField.ts` wraps `createDropDown` unchanged (the options are
the drop-down's by index, so a value may be a number or a boolean). Phase 4's declarative items
infer it from any value with `options`, and the two `view: 'list'` blades of the light window
became unbound selects (`value`) in p806 Phase 3 (`_dbg__LightShadowItems.ts`).
:::
