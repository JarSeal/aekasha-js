## Colour fields

[`createColorField`](api:createColorField) edits a colour and writes it back in the form it was
found in: a 24-bit number (`0xrrggbb`, a `THREE.Color`'s `getHex()`), a hex string (`'#rrggbb'`,
`'#rrggbbaa'`) or an `{ r, g, b, a? }` object of 0-1 floats, written in place, so a `THREE.Color`
stays the same instance (its floats are linear: `colorSpace: 'linear'`). The text shows hex and
takes hex, `rgb()`, `hsl()` or three numbers 0-1.

```ts
const fog = createColorField({
  label: 'Fog colour',
  get: () => fogSettings.color.getHex(),
  set: (hex) => fogSettings.color.setHex(hex),
  palette: ['#9fb4c7', '#d7c4a3', '#3a4a5c'],
});
const sun = createColorField({
  label: 'Sun',
  target: sunLight,
  key: 'color',
  colorSpace: 'linear',
  // A number of its own binding, after the colour
  intensity: { target: sunLight, key: 'intensity', min: 0, step: 0.1 },
});
```

::: demo colorField
:::

- **The panel:** the swatch opens a popover with the picker (a plane of saturation and
  brightness, a hue slider and, with alpha, an alpha slider), `palette`'s swatches, the page's
  recent colours and the browser's eyedropper where it has one. A swatch sets its colour and the
  panel stays open; Escape closes it and puts the focus back on the swatch.
- **The picker loads on the first open** (about 3 KiB, [vanilla-colorful](https://github.com/web-padawan/vanilla-colorful)):
  a page whose colour fields no one opens never downloads it, and until it's there the rest of the
  panel works. Its drag writes as a slider's does, and it rounds to whole degrees and percent:
  type an exact value.
- **Recent colours** are the page's, set in any colour field (`recent: false` leaves one out). An
  app that keeps them across loads reads them with [`getRecentColors`](api:getRecentColors),
  hears changes with [`onRecentColorsChange`](api:onRecentColorsChange) and restores them with
  [`setRecentColors`](api:setRecentColors).
- **Alpha and intensity:** `alpha: true` (or a hex string with alpha digits) adds an alpha spin
  button, 0-1 (`50%` typed works); `intensity` adds a number bound on its own, a light's
  intensity next to its colour.

| Colour field      |                                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ColorFieldProps`](api:ColorFieldProps), its value [`ColorFieldValue`](api:ColorFieldValue), the intensity [`ColorIntensityProps`](api:ColorIntensityProps)                                                                                        |
| Parts             | `.aekColorField` with `__swatch` (`__chip`), `.aekField__box.aekColorField__box` (`__input`) and each `__part` (`__partLabel`); the panel `.aekColorPopover` with `.aekColorPanel` (`__picker`, `__group`, `__heading`, `__swatch`, `__eyeDropper`) |
| States            | `data-kind="color"`; a panel swatch's `aria-current` (the value's)                                                                                                                                                                                  |
| Custom properties | `--aek-color-field-checker` (the checkerboard's dark squares), `--aek-color-picker-height` (the plane), and the field's                                                                                                                             |
| Keys              | The text: Enter or a blur writes, Escape puts it back; Ctrl/⌘+C copies the colour, a pasted one sets it. The picker's sliders: the arrows                                                                                                           |
| Assistive tech    | The swatch is a button "Pick {label}" opening a dialog named by the label; its swatches are buttons named by their hex, in groups "Palette" and "Recent"                                                                                            |

## Vectors, rotations and quaternions

[`createVectorField`](api:createVectorField) edits an `{ x, y }` to `{ x, y, z, w }` object
(a `THREE.Vector3` written in place) or an array of 2 to 4 numbers: a spin button per axis, each
with the number field's keys and typed expressions. `min`, `max`, `step` and `precision` are
shared, or an axis' own in `axes`, which also names it. `linkable: true` adds a toggle that, while
pressed, scales the other axes with the one changed (a uniform scale).

```ts
const position = createVectorField({ label: 'Position', target: mesh, key: 'position', step: 0.1 });
const scale = createVectorField({
  label: 'Scale',
  target: mesh,
  key: 'scale',
  min: 0.01,
  step: 0.01,
  linkable: true,
  linked: true,
});
const size = createVectorField({
  label: 'Size',
  value: [1920, 1080],
  axes: { x: { label: 'W' }, y: { label: 'H' } },
  unit: 'px',
});
```

::: demo vectorField
:::

Ctrl/⌘+C in an axis with nothing selected copies the whole vector (`1, 2.5, -3`), and pasting as
many numbers as it has axes sets them all. The axes' colours are a hint only: the letter says it.

[`createRotationField`](api:createRotationField) edits an Euler's angles (a `THREE.Euler`, written
in place) in degrees, though they're bound in radians: each wraps at ±180°, and a typed angle
takes `deg`, `°`, `rad` or `turn`. `step` is in radians, so Tweakpane's `Math.PI / 8` keeps
working and shows as 22.5°; `showOrder` adds a select for the Euler's order.
[`createQuaternionField`](api:createQuaternionField) edits a quaternion as Euler angles in
degrees (`order`) or, with `edit: 'axisAngle'`, an axis and an angle, and writes it normalised.
The numbers stay the ones the user typed while the quaternion is the one they made, so an angle
past 90° on the middle axis isn't re-derived into an equivalent set; `showRaw` shows its
components as text.

```ts
const rotation = createRotationField({
  label: 'Rotation',
  target: mesh,
  key: 'rotation',
  step: Math.PI / 8,
  showOrder: true,
});
const facing = createQuaternionField({
  label: 'Facing',
  target: body,
  key: 'quaternion',
  order: 'YXZ',
});
```

::: demo rotationField
:::

| Vector, rotation, quaternion |                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props                        | [`VectorFieldProps`](api:VectorFieldProps) (its axes [`VectorAxisProps`](api:VectorAxisProps)), [`RotationFieldProps`](api:RotationFieldProps), [`QuaternionFieldProps`](api:QuaternionFieldProps) |
| Parts                        | `.aekVectorField` with an `__axis` per axis (`__letter` and a number's box) and `__link`; `.aekRotationField` (and its order's part), `.aekQuaternionField` (`__raw`)                              |
| States                       | `data-kind="vector"`, `"rotation"` or `"quaternion"`; each axis' `data-axis`                                                                                                                       |
| Custom properties            | `--aek-vector-x-color`, `-y-color`, `-z-color`, `-w-color` (the letters), and the field's                                                                                                          |
| Keys                         | Each axis the number field's (without the label's scrub); copy and paste the whole value                                                                                                           |
| Assistive tech               | A group named by the label, each axis a spin button named by its letter ("Position, group, X, spin button"); an angle's value text in degrees; the link toggle `aria-pressed`                      |

## Angle dials and 2D pads

[`createAngleDial`](api:createAngleDial) edits an angle on a circle with a hand: a press turns the
hand to the pointer and a drag takes it round (Shift snaps to 15°). The angle's spin button in
degrees beside it is the keyboard's and assistive tech's control, as a slider's is; with
`showInput: false` the dial is the slider itself. The value is in radians (three's), or degrees
with `angleUnit: 'degrees'`, and `step`, `min` and `max` are in the value's unit. It wraps at its
ends (default -180° to 180°), or clamps with `wrap: false`. `convention: 'compass'` puts 0 at the
top, turning clockwise (a heading, a sun's azimuth); the default is 0 at the right, anticlockwise.

```ts
const azimuth = createAngleDial({
  label: 'Sun azimuth',
  target: sun,
  key: 'azimuth',
  angleUnit: 'degrees',
  min: 0,
  max: 360,
  convention: 'compass',
});
```

::: demo angleDial
:::

[`createPad2D`](api:createPad2D) edits an `{ x, y }` value (a `THREE.Vector2`, written in place) on
a box with a point: an offset or a direction. A press puts the point under the pointer and drags
it, and the pad is a tab stop whose arrows move it. Its two axes, a vector field's parts under it,
are its accessible editor (there's no standard pattern for a 2D control). Each axis spans its
`min` to `max` (default -1 to 1 by 0.01; `axes` sets one's own), y upwards unless `invertY`
(screen coordinates).

```ts
const anchor = createPad2D({
  label: 'Anchor',
  target: hudLayout,
  key: 'anchor',
  min: 0,
  max: 100,
  step: 1,
  unit: 'px',
  invertY: true,
});
```

::: demo pad2d
:::

| Angle dial, 2D pad |                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props              | [`AngleDialProps`](api:AngleDialProps), [`Pad2DProps`](api:Pad2DProps) (its value [`Pad2DValue`](api:Pad2DValue))                                                                 |
| Parts              | `.aekAngleDial__row` (the dial and the spin button's box); `.aekAngleDial` with `__zero` and `__hand`; `.aekPad2D` with `__pad` (`__axis`, `__line`, `__point`) and the axes      |
| States             | `data-kind="angle"` / `"pad2d"`; `data-dragging`; the dial's `data-convention`                                                                                                    |
| Custom properties  | `--aek-angle-dial-size`, `--aek-angle-dial-face-color`, `--aek-angle-dial-hand-color`, `--aek-angle-dial-input-width`; `--aek-pad2d-size`, `--aek-pad2d-point-color`; the field's |
| Keys               | The dial: the spin button's (without it the APG slider's); Shift snaps to 15° on a drag. The pad: the arrows move the point (Shift ×10, Alt ×0.1)                                 |
| Assistive tech     | The dial's spin button says degrees; without it the dial is `role="slider"`. The pad is a group described by its value ("X 0.25, Y -0.50"), each axis a spin button               |

## Gradient editors

[`createGradientEditor`](api:createGradientEditor) edits a gradient, `{ stops: { t, color }[] }`
(each stop's place 0-1 and its hex colour), written in place. A preview bar shows it over a
checkerboard, with a handle under it per stop, a slider for its place: drag it or move it with
the arrows. A press on the bar adds a stop there, its colour the gradient's at that place. The row
under the bar edits the selected stop: its position in %, its colour (the colour field's swatch,
panel and text, with `alpha` its alpha), and "Add stop" and "Remove stop". `minStops` (2) and
`maxStops` (16) bound the count, and stops keep their order in the array: one dragged past
another stays itself.

```ts
const sky = createGradientEditor({
  label: 'Sky ramp',
  target: skySettings,
  key: 'ramp',
  palette: ['#0b1d3a', '#f2a65a', '#9fd3ff'],
  onChange: (_ramp, { last }) => last && saveSettings(),
});

// Each frame: the ramp's colour for the time of day, without allocating
const color = { r: 0, g: 0, b: 0, a: 1 };
evaluateGradient(skySettings.ramp, dayFraction, color);
skyColor.setRGB(color.r, color.g, color.b, SRGBColorSpace);
```

::: demo gradientEditor
:::

[`evaluateGradient`](api:evaluateGradient) reads the colour at a place as CSS draws the gradient
(sRGB, premultiplied alpha; two stops at one place a hard edge), so the preview and your ramp
agree. The stops may be in any order.

| Gradient editor   |                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`GradientEditorProps`](api:GradientEditorProps), its value [`GradientValue`](api:GradientValue) ([`GradientStop`](api:GradientStop))               |
| Parts             | `.aekGradientEditor` with `__track` (`__bar`, `__stops` of `__stop`) and `__row` (`__position`, the colour's `.aekColorField`, `__add`, `__remove`) |
| States            | `data-kind="gradient"`; the track's `data-dragging`; the selected stop's `data-selected`                                                            |
| Custom properties | `--aek-gradient-editor-bar-height` (24 px), the colour field's `--aek-color-field-checker`, and the field's                                         |
| Keys              | On a handle: the APG slider's; Delete or Backspace removes the stop, Insert or `+` adds one after it, Enter opens its colour panel                  |
| Assistive tech    | A group named by the label; each handle a `slider` "Stop {n}" ("25 %, #ff8800"); the row's position a spin button, its colour the colour field's    |

## Curve editors

[`createCurveEditor`](api:createCurveEditor) edits a curve, written in place, and its value's
shape says which kind: four numbers are an easing as CSS's `cubic-bezier(x1, y1, x2, y2)` (two
handles, the ends fixed at (0, 0) and (1, 1)); an array of `{ x, y, inTangent?, outTangent? }`
is keys joined by smooth segments, for a falloff or an animation curve (keys without tangents are
joined by straight lines). `axes` sets each axis' range and step (default 0 to 1 by 0.01; an
easing's x is always 0 to 1, and `axes.y` lets its handles overshoot).

```ts
// Four numbers: an easing (this is CSS's ease)
const ease = createCurveEditor({ label: 'Ease', value: [0.25, 0.1, 0.25, 1] });
const falloff = createCurveEditor({
  label: 'Falloff',
  target: lightSettings,
  key: 'falloff', // [{ x: 0, y: 1 }, { x: 20, y: 0 }]
  axes: { x: { min: 0, max: 20, step: 0.1 } },
});

// Anywhere, without allocating
const strength = evaluateCurve(lightSettings.falloff, distance);
const smooth = getCurvePreset('smoothstep', 'keys'); // or 'bezier'
```

::: demo curveEditor
:::

- Each point is a slider: drag it, or move it with ArrowLeft / ArrowRight along x and ArrowUp /
  ArrowDown along y. With keys, a press on the plot adds a key there, and the selected key's
  tangent handles drag its slopes.
- The row under the plot edits the selected point: its X and Y and, for a key, its In and Out
  tangents (the keyboard's way to the slopes), "Add key" and "Remove key", and the "Presets"
  menu: linear, ease in, ease out, ease in-out and smoothstep, each exact in either kind
  (`presets: false` or a list of names). `minKeys` (2) and `maxKeys` (32) bound the count.
- [`evaluateCurve`](api:evaluateCurve) reads either kind at `x`: an easing solved as the browsers
  solve `cubic-bezier()`, keys flat past the ends. [`getCurvePreset`](api:getCurvePreset) makes a
  new preset value each call.

| Curve editor      |                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`CurveEditorProps`](api:CurveEditorProps), its value [`CurveValue`](api:CurveValue) ([`CurveBezier`](api:CurveBezier), [`CurveKey`](api:CurveKey))                                          |
| Parts             | `.aekCurveEditor` with `__plot` (`__area`: `__svg` with `__arms` and `__curve`, `__tangent`, `__points` of `__point`) and `__row` (`__pair`s of `__part`s, `__add`, `__remove`, `__presets`) |
| States            | `data-kind="curve"`; `data-mode` (`bezier`, `keys`); the plot's `data-dragging`; the selected point's `data-selected`; a tangent's `data-side`                                               |
| Custom properties | `--aek-curve-editor-height`, `--aek-curve-editor-curve-color`, `--aek-curve-editor-grid-color`, and the field's                                                                              |
| Keys              | On a point: ArrowLeft / ArrowRight x, ArrowUp / ArrowDown y (Shift ×10, Alt ×0.1); on a key also Delete or Backspace, Insert or `+`                                                          |
| Assistive tech    | A group named by the label; each point a `slider` "Key {n}" or "Handle {n}" ("X 0.25, Y 0.50"); the tangent handles are pointer only, the row's In and Out their numbers                     |
