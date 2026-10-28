## In a build

Each field, editor and container is its own module with its own styles, so a build carries only
the ones the app makes: a settings menu of number fields, sliders, checkboxes and selects brings
no colour, rotation or editor code. The `uiKit` embed profile measures a small form: its dialog
holds a property grid of a slider, a number field, a checkbox, a select and a colour field, in a
module the dialog's first open imports. From the last `yarn sbp` report (gzip), the fields, the
grid, the binding and the scheduler come to {{sbp:uiKit.chunk:assets/uiKitEmbedForm.js}} of code
and {{sbp:uiKit.chunk:assets/uiKitEmbedForm.css}} of styles, on top of the HUD's window, dialog
and button. None of it is in the first download. Three pieces load or carry more:

- **The colour picker** is its own chunk, {{sbp:uiKit.chunk:assets/hsva.js}}, loaded the first
  time a colour panel opens.
- **The gradient and curve editors** are modules of their own, in a build only when the app makes
  one.
- **[`addPropertyGridItems`](api:addPropertyGridItems)** can make any field from a value, so it
  brings every field's code; a grid built from handles carries only the fields it holds.

## Key APIs

- The binding: [`FieldProps`](api:FieldProps), [`FieldOptions`](api:FieldOptions),
  [`Field`](api:Field), [`FieldChange`](api:FieldChange),
  [`BindingSource`](api:BindingSource) and
  [`createBindingScheduler`](api:createBindingScheduler).
- The fields: [`createNumberField`](api:createNumberField), [`createSlider`](api:createSlider),
  [`createRangeSlider`](api:createRangeSlider), [`createRadioGroup`](api:createRadioGroup),
  [`createSegmentedControl`](api:createSegmentedControl),
  [`createSelectField`](api:createSelectField), [`createDropDown`](api:createDropDown),
  [`createTextField`](api:createTextField), [`createCheckbox`](api:createCheckbox),
  [`createSwitch`](api:createSwitch), [`createMonitor`](api:createMonitor) and
  [`createGraphMonitor`](api:createGraphMonitor).
- The value editors: [`createColorField`](api:createColorField),
  [`createVectorField`](api:createVectorField), [`createRotationField`](api:createRotationField),
  [`createQuaternionField`](api:createQuaternionField), [`createAngleDial`](api:createAngleDial),
  [`createPad2D`](api:createPad2D), [`createGradientEditor`](api:createGradientEditor) with
  [`evaluateGradient`](api:evaluateGradient), and [`createCurveEditor`](api:createCurveEditor)
  with [`evaluateCurve`](api:evaluateCurve) and [`getCurvePreset`](api:getCurvePreset).
- The containers: [`createFolder`](api:createFolder), [`createFieldset`](api:createFieldset),
  [`createPropertyGrid`](api:createPropertyGrid),
  [`addPropertyGridItems`](api:addPropertyGridItems) and [`createForm`](api:createForm).

## Read more

- [Binding values](hub:features/ui-kit/forms/binding): the bindings, the writes' order, the
  scheduler, panels as data and coming from Tweakpane.
- [The UI kit](hub:features/ui-kit): components, the HUD root, styling.
- [Windows and overlays](hub:features/ui-kit/overlays): the windows and dialogs a panel or a form
  goes in, and the popover the colour panel is.
- [Styling the UI kit](hub:features/ui-kit/styling): the tokens and the custom properties in the
  tables above.
- [The component library](hub:features/ui-kit/library): every field in every state.
- The API reference: [`aekasha/ui`](hub:documentation/aekasha/ui).

::: claude-md
:::
