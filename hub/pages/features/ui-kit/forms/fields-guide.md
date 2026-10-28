## How a field works

A field is a `createX(props)` that returns its handle, as every kit piece does: add its `cmp`
where it goes, and `cmp.remove()` removes it with its listeners and timers. Its value is bound one
of three ways:

- **`{ target, key }`** reads and writes `target[key]`. An object value (a `THREE.Vector3`, a
  `THREE.Color`) is written in place, component by component, so it stays the same instance.
- **`{ get, set }`** reads and writes through your functions; `set` gets a copy it may keep.
- **`{ value }`** holds the value in the field: read it with `getValue()`.

`readonly: true` with `{ get }` alone, or with either of the others, shows the value as text
instead of a control (a [monitor](#monitors) in that field's own text).

```ts
const speed = createNumberField({
  label: 'Speed',
  target: spinner,
  key: 'speed',
  min: 0,
  step: 0.1,
  unit: 'rad/s',
  hint: 'Radians per second',
  onChange: (value, { prev, last, source }) => {
    // Every step of a drag or a held key (last: false), then once more at its end
    spinner.applySpeed(value);
    // Once, at the end of the gesture: prev is the value before it
    if (last) undo.record('Speed', prev, value);
  },
});
settingsPanel.add(speed.cmp);
```

`onChange(value, { prev, last, source, field })` hears every write, after the value is written:
each step of a drag or a held key with `last: false`, then once with `last: true` on the release,
the keyup, Enter or a blur, its `prev` the value from before the gesture. A click, a pick, a typed
value or a reset is one write with `last: true`. So a handler applies a live change on every step
and saves, or records an undo, on `last`. `source` is `'user'` (a reset included) or `'api'`
(the handle's `setValue`; `setValue(v, { silent: true })` fires nothing, for an undo's own write).

A field reads its bound value again on `refresh()`: the handle's own, or its scheduler's.
[`createBindingScheduler`](api:createBindingScheduler) is one per host (a window, a panel): every
field made with it as its `scheduler` is read by one `refresh()`, and a
[property grid](#property-grids), a [form](#forms) or a [folder](#folders-and-fieldsets) gives
theirs to every field added without one. A refresh never calls `onChange`, so a handler that
refreshes can't loop, and a value changed from outside flashes its field once. A field that
follows a value changing on its own takes an `interval` (in ms, 0 every frame), read on the
scheduler's tick while its host shows. [Binding values](hub:features/ui-kit/forms/binding) has the
whole order of the writes, the scheduler and its tick.

Around every control is the same shell:

- **The label** names the control (`labelHidden` keeps it as the name only); a long one is cut,
  with a tooltip. `hint` is a line of help under the control.
- **The reset button** after the label shows while the value isn't its `default` (the value at
  creation unless given), and writes it back as the user's change. `reset()` does the same.
- **Errors:** `setError(text)` shows one under the control, as does a typed expression that
  doesn't parse; `required` and `validate(value)` are checked by the [form](#forms) the field is
  in.
- **`disabled` and `hidden`** take a value or a function, re-read on every refresh (a light's
  shadow settings hidden while it casts none); `setDisabled` and `setHidden` set them from code. A
  hidden field isn't read, and is read once when it shows.

| Field             |                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`FieldOptions`](api:FieldOptions), with the binding: [`FieldProps`](api:FieldProps); the handle [`Field`](api:Field), `onChange`'s event [`FieldChange`](api:FieldChange) |
| Parts             | `.aekField` with `__head` (`__label`, `__required`, `__reset`), `__control` and `__message`; a typed field's `.aekField__box` around its `.aekField__input`                |
| States            | `data-kind` (the field's kind), `data-disabled`, `data-invalid`, `hidden`; `data-flash` while a change from outside shows; the message's `data-type` (`hint`, `error`)     |
| Custom properties | `--aek-field-control-bg`, `--aek-field-control-border-color`, `--aek-field-radius`, `--aek-field-flash-color`, on the field or any ancestor                                |
| Assistive tech    | The label names the control; the hint or the error describes it, an error sets `aria-invalid`; a required field's `*` is hidden, its control `required` or `aria-required` |

## Number fields

[`createNumberField`](api:createNumberField) is a text input that is a spin button. It takes an
expression, not only a number: `1/2`, `2 ** 3`, `pi / 4`, and the units it's given
(`expressionUnits`), written on Enter or a blur (on each keystroke with `live`). A written value
snaps to the `step`'s grid, stays in `min` / `max` (or wraps at them with `wrap`) and is rounded
to the step's decimals, so `1 + 0.1` writes `1.1`.

```ts
const fov = createNumberField({
  label: 'Field of view',
  target: camera,
  key: 'fov',
  min: 10,
  max: 120,
  step: 1,
  unit: '°',
  onChange: () => camera.updateProjectionMatrix(),
});
const opacity = createNumberField({
  label: 'Opacity',
  target: material,
  key: 'opacity',
  min: 0,
  max: 1,
  step: 0.01,
  expressionUnits: { '%': 0.01 }, // "50%" types 0.5
  format: (value) => `${Math.round(value * 100)} %`,
});
```

::: demo numberField
:::

- **Scrub:** drag the label sideways to change the value (Shift ×10, Alt ×0.1); a click on it
  still focuses the input.
- **Copy and paste:** Ctrl/⌘+C with no text selected copies the value, and a pasted number sets it.
- An invalid expression shows its error and keeps the value; Escape puts the value's text back.
- `format` is the shown text (and what assistive tech says), never the value written: a percent,
  a named step.

| Number field      |                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`NumberFieldProps`](api:NumberFieldProps), its rules [`NumberRules`](api:NumberRules)                                                |
| Parts             | The field's, with `.aekField__box.aekNumberField` holding `.aekNumberField__input` and `.aekNumberField__unit`                        |
| States            | `data-kind="number"`, `data-scrubbing` while the label is dragged                                                                     |
| Custom properties | The field's                                                                                                                           |
| Keys              | ArrowUp / ArrowDown step (Shift ×10, Alt ×0.1), PageUp / PageDown ×10, Home / End to `min` / `max`; Enter writes, Escape puts it back |
| Assistive tech    | A `spinbutton` with `aria-valuenow`, `-min`, `-max` and `-valuetext` (its text and unit)                                              |

## Sliders

[`createSlider`](api:createSlider) is a number field with a track before it. The track is for the
pointer: a press moves the thumb there and drags it, each move a `last: false` write and the
release `last: true`, and a bubble over the thumb shows the value. The spin button is the one
control the keyboard and a screen reader use, with all the number field does, so a slider is one
tab stop. `showInput: false` leaves the track alone, its thumb then the slider itself.

```ts
const volume = createSlider({
  label: 'Volume',
  target: audio,
  key: 'volume',
  min: 0,
  max: 1,
  step: 0.01,
  format: (value) => `${Math.round(value * 100)} %`,
  ticks: [0, { value: 0.5, label: '50 %' }, 1],
  onChange: (value, { last }) => {
    setVolume(value);
    if (last) saveSettings();
  },
});
```

::: demo slider
:::

- **Ticks:** `ticks: 5` marks five even places; an array marks values, each with an optional
  label under the track. They're marks only: `step` is the grid a value snaps to.
- A press on the thumb drags it from where it was grabbed, so it doesn't jump; Alt drags on a
  tenth of the step's grid.

| Slider            |                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`SliderProps`](api:SliderProps), its ticks [`SliderTick`](api:SliderTick)                                                                                |
| Parts             | `.aekSlider__row` (the track and the spin button's box); `.aekSlider` with `__rail`, `__fill`, `__ticks` (`__tick`, `__tickLabel`), `__thumb`, `__bubble` |
| States            | `data-kind="slider"`, `data-dragging` (the track and the thumb), `data-tick-labels`                                                                       |
| Custom properties | `--aek-slider-rail-color`, `--aek-slider-fill-color`, `--aek-slider-thumb-color`, `--aek-slider-input-width` (5em), and the field's                       |
| Keys              | The spin button's; without the input the thumb's (the APG slider's): the four arrows, PageUp / PageDown, Home / End, Shift ×10, Alt ×0.1                  |
| Assistive tech    | The spin button, the track `aria-hidden`; without the input the thumb is `role="slider"`, named by the label                                              |

### Range sliders

[`createRangeSlider`](api:createRangeSlider) picks a range on one track, its value
`{ min, max }`. Each thumb is a slider of its own ("Minimum Price", "Maximum Price") that can't
pass the other, `minGap` keeps them apart, and the span between them is a third stop that moves
both, its width kept. `showInputs: true` adds a spin button at each end, which are then the
controls (the track for the pointer only, as the slider's), and `histogram` draws bars over the
rail, those in the range in the fill's colour.

```ts
const price = createRangeSlider({
  label: 'Price',
  target: filters,
  key: 'price', // { min, max }, written in place
  min: 0,
  max: 500,
  step: 10,
  minGap: 20,
  unit: '€',
  histogram: priceCounts,
  onChange: (_range, { last }) => last && applyFilters(),
});
```

::: demo rangeSlider
:::

A press on the rail moves the nearer thumb there; on the span it drags both. Two thumbs at one
value wait for the first move's side, so either can leave.

| Range slider      |                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`RangeSliderProps`](api:RangeSliderProps), its value [`RangeValue`](api:RangeValue)                                                        |
| Parts             | The slider's `.aekSlider`, with two `__thumb`s, `.aekRangeSlider__span` and `__histogram` (`__bars`); with `showInputs` a `.aekSlider__row` |
| States            | `data-kind="range"`, `data-dragging`, `data-histogram`                                                                                      |
| Custom properties | The slider's, and `--aek-slider-histogram-height` (32 px)                                                                                   |
| Keys              | On a thumb the APG slider's, Home / End to its own ends; on the span the same keys move both                                                |
| Assistive tech    | A group named by the label; each thumb a `slider` whose `aria-valuemin` / `-max` are its own ends; the span a `slider` "{start} to {end}"   |

## Radio groups and segmented controls

[`createRadioGroup`](api:createRadioGroup) picks one value of a few: native radios in a group
named by the label, written on each pick. An option is `{ value, label, disabled? }`, its value a
string, a number or a boolean; `orientation: 'horizontal'` lays them in a row.
[`createSegmentedControl`](api:createSegmentedControl) is the same radios drawn as a row of
segments, each its text, an icon and its text, or an icon alone (`iconOnly`: its label is then
its name and its tooltip). It's for a value: a row of tool buttons is a
[button group](hub:features/ui-kit/core#groups-and-toolbars).

```ts
const difficulty = createRadioGroup({
  label: 'Difficulty',
  target: settings,
  key: 'difficulty',
  options: [
    { value: 'easy', label: 'Easy' },
    { value: 'normal', label: 'Normal' },
    { value: 'hard', label: 'Hard' },
  ],
});
const camera = createSegmentedControl({
  label: 'Camera',
  target: settings,
  key: 'camera',
  options: [
    { value: 'orbit', label: 'Orbit' },
    { value: 'follow', label: 'Follow' },
  ],
  fill: true, // the segments share the field's width
});
```

::: demo radioGroup
:::

| Radio group, segmented control |                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Props                          | [`RadioGroupProps`](api:RadioGroupProps) ([`RadioOption`](api:RadioOption)), [`SegmentedControlProps`](api:SegmentedControlProps) ([`SegmentOption`](api:SegmentOption)) |
| Parts                          | `.aekRadioGroup` of `.aekRadio` labels (`__input`, `__label`); `.aekSegmented` of `.aekSegmented__segment` labels (`__input`, `__icon`, `__label`)                       |
| States                         | `data-kind="radio"` / `"segmented"`, `data-orientation`, `data-fill`; the picked segment `:has(:checked)`                                                                |
| Custom properties              | `--aek-radio-size` (16 px), `--aek-segmented-selected-bg`, `--aek-segmented-selected-color`, and the field's                                                             |
| Keys                           | The browser's: one tab stop at the picked option, the arrows move and pick (wrapping, skipping a disabled one), Space picks                                              |
| Assistive tech                 | A `radiogroup` named by the label, of native radios; the hint or the error describes the group                                                                           |

## Selects and drop-downs

[`createSelectField`](api:createSelectField) is one value of a list: the
[drop-down](#drop-downs) on a binding, written on each pick. `options` takes Tweakpane's two
forms, `[{ text, value }]` and `{ [text]: value }`, as well as `[{ label, value }]`, or a getter
of either for a list that changes (read again on each open and refresh). A value may be a string,
a number or a boolean; one no option has shows `placeholder`.

```ts
const shadowMap = createSelectField({
  label: 'Shadow map',
  target: light.shadow.mapSize,
  key: 'x',
  options: { '512': 512, '1024': 1024, '2048': 2048 },
  onChange: (size) => setShadowMapSize(size),
});
const level = createSelectField({
  label: 'Level',
  get: () => currentLevelId,
  set: (id) => loadLevel(id),
  options: () => levels.map((l) => ({ label: l.name, value: l.id })),
  searchable: true, // a filter field over the list
});
```

::: demo selectField
:::

| Select field      |                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Props             | [`SelectFieldProps`](api:SelectFieldProps), its options [`SelectOptions`](api:SelectOptions)                       |
| Parts             | The drop-down's (below), filling the control's width                                                               |
| States            | `data-kind="select"`; the trigger's `data-placeholder` while no option has the value                               |
| Custom properties | The field's `--aek-field-flash-color`; the rest is the drop-down's look                                            |
| Keys              | The drop-down's; a click on the label focuses the trigger                                                          |
| Assistive tech    | The trigger is named by the label and the value it shows ("Shadow map, 1024"); the open list is named by the label |

### Drop-downs

[`createDropDown`](api:createDropDown) is the select field without a binding: a trigger button
and an in-page list (not a native `<select>`). The arrows, Home and End move, Enter, Space or a
click picks, and Escape, Tab or a click outside closes it without a change. Its keys reach no key
binding, and a pick or Escape gives the focus back to the trigger when the list was opened from
it. The list opens over everything (the browser's top layer), so a window doesn't clip it: on
`placement`'s side when it fits there, else the other, and inside the page or the embed's
container. Add its `cmp` where it goes. The trigger re-reads `value` after a pick; when the value
changes elsewhere, call `refresh()`.

```ts
const quality = createDropDown({
  options: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ],
  value: () => settings.quality, // Re-read on every open and after every pick
  onChange: (value) => setQuality(value), // Then the trigger shows the new label
  title: 'Quality',
});
settingsPanel.add(quality.cmp);
```

For a long list, `searchable: true` puts a filter field over it. Typing filters the options by
their labels and marks the match, the arrows move through what's left, and Enter picks:

```ts
const level = createDropDown({
  options: levels.map((l) => ({ value: l.id, label: l.name })),
  value: () => currentLevelId,
  onChange: (id) => loadLevel(id),
  title: 'Level',
  searchable: true,
  searchPlaceholder: 'Find a level',
});
```

::: demo dropDown
:::

| Drop-down      |                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props          | [`DropDownProps`](api:DropDownProps)                                                                                                                                                   |
| Parts          | `.aekDropDown` (`_top` when it opens upward) with `.aekDropDownTrigger`; the list `.aekDropDownList` of `.aekDropDownItem`s; searchable, `.aekDropDownPopup` with `.aekDropDownSearch` |
| States         | The highlighted option `data-active`; a match `<mark class="aekDropDownMatch">`                                                                                                        |
| Keys           | The arrows, Home and End move; Enter or Space picks; Escape, Tab or a click outside closes it without a change; searchable: typing filters, Enter picks                                |
| Assistive tech | A listbox with `aria-activedescendant`; searchable, a `combobox` filter field                                                                                                          |

## Text fields

[`createTextField`](api:createTextField) is an `<input type="text">` bound to a string: the
typed text is written on Enter or a blur (on each keystroke with `live`; `onInput` gets each
keystroke's text first), and Escape puts the value's text back. A refresh never writes over what's
being typed. `multiline: true` makes it a `<textarea>` (`rows`), where Enter is a new line and
Ctrl/⌘+Enter or a blur writes.

```ts
const name = createTextField({ label: 'Name', target: player, key: 'name', maxLength: 24 });
const filter = createTextField({
  label: 'Filter',
  labelHidden: true,
  type: 'search',
  value: '',
  placeholder: 'Filter entities',
  onSearch: (query) => filterEntities(query), // 250 ms after the last keystroke
});
```

::: demo textField
:::

`type: 'search'` adds a search mark, a clear button ("Clear {label}", shown while there's text,
which empties it and puts the focus back in the input) and `onSearch(text)`, called
`searchDelayMs` (250) after the last keystroke, and at once on Enter or a clear.

| Text field        |                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`TextFieldProps`](api:TextFieldProps)                                                                                           |
| Parts             | The field's, with `.aekField__box.aekTextField` holding `.aekTextField__icon`, `.aekTextField__input` and `.aekTextField__clear` |
| States            | `data-kind="text"`, `data-multiline`, `data-search`                                                                              |
| Custom properties | The field's                                                                                                                      |
| Keys              | Enter (multiline: Ctrl/⌘+Enter) writes, Escape puts the value's text back                                                        |
| Assistive tech    | The label names the input; a search is a `searchbox`                                                                             |

## Checkboxes and switches

[`createCheckbox`](api:createCheckbox) and [`createSwitch`](api:createSwitch) are both a native
checkbox bound to a boolean, written on each click. The switch (`role="switch"`) is for a setting
that takes effect at once; `onText` and `offText` show its state beside it. A checkbox over
several others takes `indeterminate` (and `setIndeterminate`), a bar until it's clicked, which
assistive tech hears as "mixed".

```ts
const shadows = createCheckbox({ label: 'Shadows', target: settings, key: 'shadows' });
const vsync = createSwitch({
  label: 'V-sync',
  get: () => renderSettings.vsync,
  set: (on) => setVsync(on),
  onText: 'On',
  offText: 'Off',
});
```

::: demo checkbox
:::

| Checkbox, switch  |                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`CheckboxProps`](api:CheckboxProps), [`SwitchProps`](api:SwitchProps)                                                      |
| Parts             | `.aekCheckbox` (the box its `::before`, the mark its `::after`); `.aekSwitch` (the track and the thumb), `.aekSwitch__text` |
| States            | `data-kind="checkbox"` / `"switch"`; `:checked`, `:indeterminate`                                                           |
| Custom properties | `--aek-checkbox-size`, `--aek-switch-width`, `--aek-switch-height`, and the field's                                         |
| Keys              | Space flips it; a click on the label does too                                                                               |
| Assistive tech    | A native checkbox, or `role="switch"`; the switch's state text is hidden (its own state is read)                            |

## Monitors

[`createMonitor`](api:createMonitor) shows a bound value as text, read every `interval` ms (200
by default, 0 every frame) on its scheduler's tick, which runs only while the host shows: a frame
time, a body count, a state. A read that finds the value unchanged writes nothing. Its text is
`format`'s, a number in its decimals (`precision`) with its `unit`, a boolean as `onText` /
`offText`, a vector's axes or a string as it is; `multiline` shows a block of lines that scrolls
(a log). Any field with `readonly: true` is a monitor in that field's own text.

```ts
const frameTime = createMonitor({
  label: 'Frame time',
  get: () => stats.frameMs,
  unit: 'ms',
  precision: 1,
  interval: 250,
});
// The same value as a slider would show it, read-only
const volume = createSlider({
  label: 'Volume',
  target: audio,
  key: 'volume',
  min: 0,
  max: 1,
  readonly: true,
});
```

::: demo monitor
:::

A monitor isn't a live region, on purpose: a value that changes every frame would drown a screen
reader. A line is read after its label, in order; a value worth announcing is your own
`aria-live` text. A monitor without a scheduler shares one tick with the page's other monitors,
and never flashes.

| Monitor           |                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Props             | [`MonitorProps`](api:MonitorProps)                                                                      |
| Parts             | The field's (no reset button), with `.aekMonitor` (`__value`, `__unit`), or `textarea.aekMonitor__text` |
| States            | `data-kind="monitor"`, `data-disabled`                                                                  |
| Custom properties | `--aek-monitor-bg`, `--aek-monitor-color`, `--aek-monitor-font` (the multiline block's)                 |
| Assistive tech    | Text read after its label, not announced; the multiline block a read-only text area and a tab stop      |

### Graph monitors

[`createGraphMonitor`](api:createGraphMonitor) is a number monitor with a graph of its reads under
its text (Tweakpane's `view: 'graph'`).

```ts
const frameTime = createGraphMonitor({
  label: 'Frame time',
  get: () => stats.frameMs,
  unit: 'ms',
  precision: 1,
  interval: 100,
  capacity: 100, // 10 s of reads
  thresholds: [{ value: 16.7, label: '60 fps' }],
});
statsPanel.add(frameTime.cmp);
```

::: demo graphMonitor
:::

- **Samples.** Every read is one: the tick's every `interval` ms, and a refresh's. The graph holds
  the last `capacity` (default 64, Tweakpane's `bufferSize`); a value that isn't a number is a gap.
- **Range.** `min` and `max`, or a nice range over the reads and the `thresholds` that grows when
  a read passes it and shrinks after a whole buffer under a lower one.
- **In a property grid.** An item with `view: 'graph'` (and `bufferSize`, Tweakpane's names) is a
  graph monitor. A grid loads its graph the first time it makes one, showing the text until then,
  so a grid without one carries none of it.
- **The graph** is a [time series](hub:features/ui-kit/data#time-series) with no ticks and no
  summary: the monitor's text is its value.

| Graph monitor     |                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Props             | [`GraphMonitorProps`](api:GraphMonitorProps), a threshold's [`TimeSeriesThreshold`](api:TimeSeriesThreshold)   |
| Parts             | The monitor's, `.aekMonitor` with `data-graph`, `__value`, `__unit` and `__graph` holding the `.aekTimeSeries` |
| States            | `data-kind="monitor"`, `data-disabled`                                                                         |
| Custom properties | The monitor's, `--aek-graph-monitor-height` (the graph's) and the time series'                                 |
| Assistive tech    | The monitor's: text read after its label, not announced; the graph hidden                                      |

## The fields' context menu

[`createFieldContextMenu`](api:createFieldContextMenu) gives every field in a container (a property
grid, a form, any panel) one context menu: **Reset** to the field's default, **Copy** the value as
text, **Paste** a value and **Copy as**, other forms of a colour (hex, `rgb()`, sRGB floats) or a
vector (an array, an object). A right click on a field's label opens it; on the control the
browser's own menu stays, with a text's Cut, Copy and Paste. With the focus in a field, the
ContextMenu key or Shift+F10 opens it too. Fields added to the container later have it as well.

```ts
const grid = createPropertyGrid({ children: [speedField, tintField, offsetField] });
settingsPanel.add(grid.cmp);
const fieldsMenu = createFieldContextMenu({ container: grid.cmp.elem });
// With the panel: fieldsMenu.cmp.remove()
```

::: demo fieldContextMenu
:::

What Copy writes is the field's own text: a number as it is, a colour's hex, a vector's
`1, 2.5, -3`, an option's label, a monitor's text. A paste goes through the same checks as typing:
a number field takes an expression and keeps it to its `min`, `max` and `step`, a colour field
reads any colour text it reads typed, a choice takes an option's label or value. A text that isn't
a value is the field's message, as a typed one is. The browser may ask the user before the page
reads the clipboard, so a paste can wait for that.

| Fields' context menu |                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props                | [`FieldContextMenuProps`](api:FieldContextMenuProps)                                                                                                              |
| Items                | Reset (off at the default, for a monitor and a disabled field), Copy, Paste (off for a monitor, a disabled field, and where the clipboard can't be read), Copy as |
| Keys                 | The ContextMenu key and Shift+F10 in a field; the menu's keys in it                                                                                               |
| Assistive tech       | The menu's, named by the field's label                                                                                                                            |
