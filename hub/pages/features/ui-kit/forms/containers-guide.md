## Folders and fieldsets

[`createFolder`](api:createFolder) is a disclosure: a button over a group of fields, which opens
and shuts with its height animated. Folders nest, each level indented. A shut folder's fields
aren't read; when it opens, its scheduler reads them once, without a flash. The folder writes no
storage: `expanded` starts it open or shut, and `onExpandedChange` reports each change for you to
keep.

```ts
const shadows = createFolder({
  title: 'Shadows',
  expanded: settings.shadowsOpen,
  onExpandedChange: (open) => saveSetting('shadowsOpen', open),
  hidden: () => !light.castShadow, // re-read on every refresh
  children: [
    createSlider({
      label: 'Bias',
      target: light.shadow,
      key: 'bias',
      min: -0.01,
      max: 0.01,
      step: 0.0001,
    }),
    createNumberField({ label: 'Radius', target: light.shadow, key: 'radius', min: 0 }),
  ],
});
```

::: demo folder
:::

[`createFieldset`](api:createFieldset) is a native `<fieldset>` and `<legend>` around a group of
fields outside a property grid: a form's section, a dialog's group of settings, named by its
legend and described by its `hint`. `disabled` (or `setDisabled`) disables every field in it as
its own `disabled` would, the kit's own stops included (a slider's thumb, which the browser's
`disabled` doesn't reach); a field's own `disabled` stays when the fieldset is enabled again.

```ts
const account = createFieldset({
  legend: 'Account',
  hint: 'Shown to other players',
  children: [
    createTextField({ label: 'Name', target: profile, key: 'name' }),
    createSelectField({ label: 'Region', target: profile, key: 'region', options: regions }),
  ],
});
```

::: demo fieldset
:::

| Folder, fieldset  |                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Props             | [`FolderProps`](api:FolderProps), [`FieldsetProps`](api:FieldsetProps); what they hold: [`FormChild`](api:FormChild)                                         |
| Parts             | `.aekFolder` with `__toggle` (`__chevron`, `__title`) and `__region` > `__clip` > `__content`; `fieldset.aekFieldset` with `__legend`, `__hint`, `__content` |
| States            | The folder's `data-expanded`, `data-animating` while it moves, `hidden`; the fieldset's `disabled`                                                           |
| Custom properties | `--aek-folder-indent`, `--aek-folder-gap`; `--aek-fieldset-gap`                                                                                              |
| Keys              | Enter or Space on the folder's button opens or shuts it; shut from code with the focus inside, the button takes it                                           |
| Assistive tech    | The folder's button `aria-expanded`, its region a `group` named by it; the fieldset the native group, named by its legend                                    |

The folder's height eases over `--aek-motion-base`, at once under reduced motion.

## Property grids

[`createPropertyGrid`](api:createPropertyGrid) is the debugger's layout: each field a row of two
columns, its label and its control. In a folder the labels step in while the controls stay lined
up with the top level's, at any depth; a button or any other child spans both columns. The grid
has its own scheduler (or shares a host's `scheduler`), which every field and folder added
without one joins, so its `refresh()` reads them all.

```ts
const grid = createPropertyGrid({
  labelWidth: settings.labelWidth, // a percent, 40 by default
  onLabelWidthChange: (width) => saveSetting('labelWidth', width),
  children: [
    createSlider({ label: 'Speed', target: spinner, key: 'speed', min: 0, max: 10 }),
    createCheckbox({ label: 'Wireframe', target: material, key: 'wireframe' }),
    createMonitor({ label: 'Frame time', get: () => stats.frameMs, unit: 'ms' }),
  ],
});
settingsWindow.add(grid.cmp);
```

::: demo propertyGrid
:::

The label column's edge is a separator: drag it, or focus it and use ArrowLeft / ArrowRight. The
grid writes no storage: `onLabelWidthChange` reports the width at a drag's release or a key's
keyup. The separator is the columns' 24 px gap, so it covers no control: a row across both
columns (a button without a label, a custom item, a folder's heading) is over it, and so is the gap
between two buttons or custom items, so a run of full-width buttons can't be dragged through.

### Panels as data

[`addPropertyGridItems`](api:addPropertyGridItems) adds a panel described as data, with
Tweakpane's names (`label`, `min`, `max`, `step`, `options`, `readonly`, `format`, `hidden`,
`disabled`, folders with `expanded`): field items, folders, buttons, separators and a `custom`
escape hatch. Without a `kind`, a field's kind is inferred from its value at creation, as
Tweakpane does.

```ts
const grid = createPropertyGrid();
addPropertyGridItems(
  grid,
  [
    // A number with min and max: a slider
    { target: spinner, key: 'speed', label: 'Speed', min: 0, max: 10, step: 0.1 },
    // A boolean: a checkbox
    { target: material, key: 'wireframe', label: 'Wireframe' },
    // A THREE.Color ({ r, g, b }): a colour field
    { target: material, key: 'color', label: 'Colour', colorSpace: 'linear' },
    {
      type: 'folder',
      title: 'Light',
      items: [
        { target: light, key: 'intensity', label: 'Intensity', min: 0, step: 0.01 },
        // A THREE.Vector3: a vector field
        { target: light, key: 'position', label: 'Position', step: 0.1 },
        // readonly: a monitor
        { get: () => light.castShadow, label: 'Shadows', readonly: true },
        // view: 'graph': a graph monitor, its graph loaded on first use
        { get: () => light.shadow.map?.width ?? 0, label: 'Shadow map', view: 'graph' },
      ],
    },
    { type: 'separator' },
    { type: 'button', title: 'Reset the scene', onClick: () => resetScene() },
  ],
  {
    folderExpanded: savedFolders, // by id: the title path, 'Light'
    onFolderExpandedChange: (id, open) => saveFolder(id, open),
  }
);
```

- **Inferred:** `options` make a select; a number a number field, or a slider with both `min` and
  `max`; a boolean a checkbox; a hex colour string or an `{ r, g, b, a? }` object a colour field;
  an `{ x, y, … }` object or 2 to 4 numbers a vector field, an Euler (a string `order`) a rotation
  field; another string a text field. `readonly: true` makes any of them a monitor in its text,
  and `view: 'graph'` a number's [graph monitor](#graph-monitors) (`bufferSize` its capacity),
  whose graph the grid loads the first time it makes one.
- **Said with `kind`:** what a value's shape can't tell: `'color'` for a 24-bit number,
  `'switch'`, `'radio'`, `'segmented'`, `'range'`, `'search'`, `'quaternion'`, `'angle'`,
  `'pad2d'`, `'gradient'` and `'curve'`, or `'text'` for a string that looks like a colour.
- A folder's id is its title path (`'Light/Shadow'`) or its `id`; a button item with a `label`
  puts the label in the label column; every `hidden` and `disabled` function, and a custom item's
  refresh, runs on the grid's `refresh()`.

It's its own module, since inference may make any field: a grid built from handles, as above,
carries only the fields it makes. [Binding values](hub:features/ui-kit/forms/binding#panels-as-data)
has every item's shape and the whole inference, and
[coming from Tweakpane](hub:features/ui-kit/forms/binding#coming-from-tweakpane) maps a pane's
calls and params onto them.

| Property grid     |                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`PropertyGridProps`](api:PropertyGridProps); its items [`PropertyGridItem`](api:PropertyGridItem), [`PropertyGridItemsOptions`](api:PropertyGridItemsOptions) |
| Parts             | `.aekPropertyGrid` with `__content` (the rows) and `__separator`; item rows `__buttonRow` (`__buttonLabel`), `__dividerRow`, `__customRow`                     |
| States            | The separator's `data-dragging`; a labelled button row's `data-labelled`                                                                                       |
| Custom properties | `--aek-property-grid-label-width` (a percent, set by `labelWidth`), `--aek-property-grid-row-gap`                                                              |
| Keys              | On the separator: ArrowLeft / ArrowRight move the column by 1 % (Shift ×10, Alt ×0.1), Home / End to 20 % / 80 %                                               |
| Assistive tech    | The separator is a focusable `separator` "Label column" with its percent; each field's label names its control                                                 |

## Forms

[`createForm`](api:createForm) is a `<form novalidate>` around fields, fieldsets and property
grids that checks them itself: each field's `required` (an empty value: `''` or spaces, `false`,
`null`) and `validate(value)`, which returns the error or null. The browser's own validation
messages never show: the errors are text in the page, in the kit's colours, read with their
fields.

```ts
const profile = { name: '', region: '', terms: false };
const form = createForm({
  submitLabel: 'Create',
  resetLabel: 'Reset',
  // Only when every field is valid; its promise keeps the form busy until it settles
  onSubmit: () => saveProfileAsync(profile),
  children: [
    createTextField({
      label: 'Name',
      target: profile,
      key: 'name',
      required: 'Enter your name',
      validate: (name) => (name.length < 3 ? 'Name must be 3 characters or more' : null),
    }),
    createSelectField({
      label: 'Region',
      target: profile,
      key: 'region',
      options: { Europe: 'eu', Americas: 'am' },
      placeholder: 'Choose',
      required: true,
    }),
    createCheckbox({ label: 'I accept the terms', target: profile, key: 'terms', required: true }),
  ],
});
newPlayerDialog.add(form.cmp);
```

::: demo form
:::

- **Errors:** checked on a submit, and from then on when the focus leaves a field. Each is under
  its field, and on a submit an error summary at the top takes the focus and links each error to
  its field (the [GOV.UK pattern](https://design-system.service.gov.uk/components/error-summary/)):
  a link focuses the field, opening a shut folder around it. A hidden or disabled field isn't
  checked; a field's own error (an expression that doesn't parse) and your `setError` count too,
  so `validate()` after a server's answer shows it in the summary.
- **Submit:** Enter in a single-line field, the submit button or `submit()`; `onSubmit` runs only
  when every field is valid. A promise from it sets `aria-busy` and the submit button's loading
  until it settles.
- **Reset:** the reset button or `reset()` writes every field's default as the user's change (so
  an undo records it), and takes the errors and the summary away.
- A property grid in a form keeps its own scheduler; `createPropertyGrid({ scheduler: form.scheduler })`
  shares the form's.

| Form              |                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`FormProps`](api:FormProps), the handle [`Form`](api:Form)                                                                                              |
| Parts             | `form.aekForm` with `__summary` (`__summaryTitle`, `__summaryList` of `__summaryLink`s) and `fieldset.aekForm__body` holding `__content` and `__actions` |
| States            | `aria-busy` while `onSubmit`'s promise is pending; the summary `hidden` without errors; the body's `disabled`                                            |
| Custom properties | `--aek-form-gap`, `--aek-form-summary-border-color`                                                                                                      |
| Keys              | Enter in a single-line field submits; a summary link focuses its field                                                                                   |
| Assistive tech    | The summary is a group named by its title that takes the focus, each link's text its field's error; a required control has `required` or `aria-required` |
