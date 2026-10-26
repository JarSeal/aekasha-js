Status: in progress | Phases 0-5 implemented
Category: UI, Accessibility, Debug
Epic: p800_debugger-ui-overhaul.md
Blocks: p806_debugger-migration.md, p808_game-ui-components.md (p800 §5; written when each starts)
Related: \_DONE_p803_ui-kit-structure-and-core.md (the folders, coding style, overlay layer, popover and drop-down this builds on; its open items: D13), \_DONE_p801_design-foundation.md (the tokens, densities and motion), \_DONE_p618_review-debug-public-api.md (the pane types' Tweakpane fields, P7), p805_data-display.md (the label's context menu and the monitor's graph view: D1), p355_save-menu-and-file-server-settings.md (its settings on this plan's form), p426_sequencer-splines-and-cutscenes.md (the curve editor), p622_engine-6-major.md (the button's string `kbd`, deprecated here: D13), `docs/issues/ui-kit-review-items.md` (D13)

# Forms and Bindings

p800's fourth child: Tweakpane's replacement, as public `aekasha/ui` components. Every field the
debugger's panes use today (numbers, sliders, checkboxes, lists, text, colours, points, monitors,
folders) and the ones a game's settings menu or an editor needs (switches, radio groups, segmented
controls, ranges, vectors, rotations, quaternions, the angle dial, the 2D pad, the gradient and
curve editors) are built on one binding model and one refresh scheduler. A declarative description
(the debugger's pane sections' shape, without Tweakpane) lets an app and p806 describe a panel as
data, with Tweakpane's names, so p806 ports the debugger mechanically.

The debugger doesn't move here: its panes stay on Tweakpane until p806. Nothing breaks.

---

## 1. As found (2026-10-26, `main` at `a49bb748`, Engine 5.12.0)

### 1.1 p800's p804 sketch, checked

p800 §2.1, §3 D9 / D13 and §4.3 hold, with these differences and additions:

- **Tweakpane today** (non-test files naming `tweakpane`, a tab or a pane section: 33; p800 counted
  43 that build Tweakpane UI, helpers included; Phase 0's census is the exact list): `addBinding`
  59, `new Pane` 8, `addBlade` 8 (6 separators, 2 `view: 'list'` in `_dbg__LightGUI.ts`' shadow map
  size), declarative folders 44, buttons 60, separators 19, `custom` 2. Binding params: `min` 70,
  `max` 36, `step` 72, `options` 28, `format` 25, `readonly: true` 64, `interval` 15, `multiline`
  10, `rows` 18, `expanded` 24, `view: 'color'` 12, `color: { type: 'float' }` 2. No per-axis
  point params (`x: { … }`), `keyScale`, `pointerScale`, `inverted`, `bufferSize`, `picker`,
  graph, slider or text blades. `onCreate` has no user outside the builder.
- **The builder** (`debug/_dbg__DebuggerPaneBuilder.ts`, 217 lines): a binding's `onChange` fires
  for user input only, suppressed while `refresh()` pushes values in (Tweakpane's `refresh()`
  emits `change`). It gets `{ prev, last, api }`: `prev` is a `structuredClone` snapshot taken at
  the last change or refresh, `last` Tweakpane's. A persisted state key is written to LS on
  `last` before `onChange` runs. `hidden` / `disabled` are `DebuggerDyn` (a value or a function
  re-read on refresh). Folder ids are the title path (`'Parent/Child'`) or an `id`; their open
  states go to the tab's UI key. A titled pane section is itself a foldable root.
- **The values bound:** numbers, booleans, strings, `{ x, y, z }` objects (positions, targets,
  origins), Euler rotations with `step: Math.PI / 8`, and colours as 24-bit hex **numbers**
  (`getHex()` / `setHex()`, sRGB: `Config.ts`' collider colours say so) or `{ r, g, b }` floats
  (`color: { type: 'float' }`, the Debug tools tab's grid colours). No binding targets a
  `THREE.Color` directly; quaternions are converted by hand.
- **Refresh:** the tab host (`_dbg__TabHost.ts`) runs a tab's `refreshIntervalMs` with a
  `setInterval` while the host is visible; each monitor with an `interval` has Tweakpane's own
  timer on top. No shared tick.
- **Undo** (`debug/UndoRedo.ts`): `recordOrCoalesceUndoRedoAction` merges the ticks with the same
  type and key within 800 ms into one entry (the first tick's `prev`, the last's `next`). The
  bindings' `onChange` handlers call it on every tick, `last` or not, and apply live side effects
  (a light's colour, a grid rebuild) on every tick too: an `onChange` fired only on commit would
  freeze the scene during a drag.
- **The kit** (`src/_engine/ui/`, p803): `forms/` holds only the drop-down (`DropDown.ts` 422
  lines, `createDropDown`, searchable, on the overlay layer). The pieces this plan builds on: the
  overlay stack, `showAnchored`, the popover, the menu, the tooltip (`onlyWhenTruncated`), the
  button, the button group, the divider, `getMotionFactor`, `KitDom`. The layout rule per kit
  folder (`UI_KIT_FOLDERS`, `layoutRules.ts`) is a path prefix, so a subfolder of `forms/` needs
  no rule.
- **The button's `kbd`** (p803's open item, p800 §5): `Button.ts` imports `createKbd` and
  `getAriaKeyShortcuts` statically, about 0.7 kB gzip of the button's 1.8 kB, which a button
  without a hint carries too.
- **`docs/issues/ui-kit-review-items.md`** (`open | for the UI kit's next plan (p804)`): four
  items: `normalize.scss` unlayered beats the kit on `button` (and on `input`, `select`,
  `textarea`, which this plan's fields are), hold to confirm ignoring a click with no press,
  `verify:ui`'s shot of the indeterminate progress bar, a long custom property name breaking
  mid-word in a Hub table cell.
- **SBP** (`sbp.config.ts`): the app's `_engine/ui` group budget 7 KiB initial, the `uiKit`
  profile's 6 KiB, its scene chunk `uiKitEmbed.js` 19 KiB and `.css` 6 KiB.
- `tweakpane` 4.0.5 and `@tweakpane/core` 2.0.5 stay in `package.json` until p806.

---

## 2. Decisions (proposed 2026-10-26, for review)

### D1. Scope

- **In:** the binding (D3) and its scheduler (D4), the field shell and value editing (D5, D6),
  p800 §4.3's fields (D7), value editors (D8) and containers (D9), the declarative description with
  Tweakpane's names (D10), the forms' accessibility (D11) and size (D12), p803's open items and
  the button's `kbd` (D13), tests (D14), the Hub (D15).
- **Moved to p805:** the label's context menu (Reset, Copy, Paste; p805 builds the context menu on
  p803's menu, and adds these items to a field's label then; until then D6's keyboard and button
  paths do it) and the monitor's graph view (p805's sparkline; p804's monitor shows text).
- **The gradient and curve editors are in** (Phase 6, the last component phase). If the plan runs
  long, they leave it as a pair: the curve editor to p426 (its first user), the gradient editor to
  p806 (the sky colours), and p800 §4.3 says so.
- **Out:** the debugger's panes (p806), Tweakpane's removal (p806), a storage layer: a field or a
  folder never writes LS, it reports (`onChange`, `onExpandedChange`) and its owner persists (the
  debugger, p806; an app's settings, p808).

### D2. Layout

`ui/forms/`, as p803 D2 set it (a module, its stylesheet and its test flat; a piece with more
than one module gets a folder):

| Path                    | What                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `forms/binding/`        | `Binding.ts` (D3), `BindingScheduler.ts` (D4), `ValueExpression.ts` (D6), `ValueText.ts` (D6) |
| `forms/Field.ts`        | the field shell (D5), `@internal`                                                             |
| `forms/NumberField.ts`  | number (D7)                                                                                   |
| `forms/Slider.ts`       | slider, and the range slider's two thumbs (D7)                                                |
| `forms/Checkbox.ts`     | checkbox and switch (D7)                                                                      |
| `forms/RadioGroup.ts`   | radio group and segmented control (D7)                                                        |
| `forms/SelectField.ts`  | the drop-down on the binding (D7)                                                             |
| `forms/TextField.ts`    | text, textarea, search (D7)                                                                   |
| `forms/Monitor.ts`      | read-only values (D7)                                                                         |
| `forms/color/`          | `ColorField.ts`, `ColorValue.ts` (parse, format, spaces), `ColorPicker.ts` (lazy, D8)         |
| `forms/VectorField.ts`  | vector 2 / 3 / 4 (D8)                                                                         |
| `forms/rotation/`       | `RotationField.ts`, `QuaternionField.ts`, `RotationMath.ts` (D8)                              |
| `forms/AngleDial.ts`    | (D8)                                                                                          |
| `forms/Pad2D.ts`        | (D8)                                                                                          |
| `forms/gradient/`       | `GradientEditor.ts`, `Gradient.ts` (evaluate) (D8)                                            |
| `forms/curve/`          | `CurveEditor.ts`, `Curve.ts` (evaluate, presets) (D8)                                         |
| `forms/Folder.ts`       | (D9)                                                                                          |
| `forms/Fieldset.ts`     | (D9)                                                                                          |
| `forms/PropertyGrid.ts` | the label column layout and the declarative items (D9, D10); `PropertyGridItems.ts` if large  |
| `forms/Form.ts`         | validation, submit, reset (D9)                                                                |
| `forms/DropDown.ts`     | as it is (the select field wraps it)                                                          |

Each public module is on `aekasha/ui` by name (p803 D12: one entry). The coding style is
`src/_engine/ui/CLAUDE.md`'s "Writing a component".

### D3. The binding (changes p800 D9's events)

- A field binds in one of three ways (p800 D9; the third is this plan's):
  - `{ target, key }`: reads `target[key]`, writes it in place (Tweakpane's model);
  - `{ get, set }`: any source (an ECS component, a setter with side effects, a store);
  - `value`: unbound, the field holds it (a form's fields, an app's dialog), read with
    `getValue()`.
  - p806 maps a debugger tab's `state` key to the first (p800 D9).
- **A vector, colour or rotation target is written in place** (`target[key].x = …`), never
  replaced, when the bound value is an object: a `THREE.Vector3` stays the same instance. A bound
  primitive is written with `target[key] = v` or `set(v)`.
- **Events** (changes p800 D9, which had `onInput` on every live change and `onChange` on commit):
  - `onChange(value, { prev, last, source })` fires on **every write** of the bound value: each
    drag step and each key step with `last: false`, then once with `last: true` on release, Enter,
    blur or the key's keyup. `prev` is the value before the gesture's first write for the `last`
    call and before this step otherwise. `source` is `'user'` or `'api'` (`setValue`). This is
    Tweakpane's model, which today's handlers rely on: they apply live side effects on every tick
    and record undo on every tick (coalesced), so p806's port stays mechanical (1.1, Undo).
  - `onInput(text)` fires only in a text-like part (a text field, a number or colour field's
    typed text) on each keystroke, before a commit: what a search-as-you-type or a live preview
    uses. A typed value is written on Enter or blur (one `onChange`, `last: true`), or on each
    valid keystroke with `live: true`.
  - **A refresh from the bound value never fires either.** `setValue(v)` writes and fires
    `onChange` with `source: 'api'`; `setValue(v, { silent: true })` writes without it (what an
    undo handler uses).
  - The order, pinned by `Binding.test.ts` and checked in Phase 0 against today's builder:
    pointerdown → (each step: write, `onChange` `last: false`) → pointerup: `onChange` `last: true`
    (with the same value as the last step when it didn't move again). A key step: write,
    `onChange` `last: false`; its keyup: `onChange` `last: true`. A click (checkbox, select,
    segment): write, one `onChange` `last: true`. A click on a slider's track is a drag without a
    move (the press's write with `last: false`, then `last: true`).
  - **Phase 0 found today's order the same** (§3, Phase 0 step 3), with these differences, each
    kept on purpose:
    - `prev` on the `last: true` call: today the last step's value (so it equals `value`); here
      the value before the gesture. No handler reads it there (undo coalescing keeps the first
      tick's `prev`; the one `prev` comparison, the sky box's auto colour, is on a select, which
      writes once), and a handler that records on `last` only gets the whole change in one call.
    - Monitors: Tweakpane's poll emits `change` unsuppressed, so today the builder calls a
      monitor's `onChange` on every read (no monitor has one). Here a monitor's read is a refresh
      (D4): it never fires `onChange`.
    - Escape on typed text reverts it (D6); today the next blur commits it.
    - A typed or stepped number is rounded to the step's decimals before it's written (D6); today
      `1.0999999999999999` and `2.5000000000000004` reach the target, LS and undo.
- p800 D9's events bullet is updated to this.

### D4. The scheduler

- `createBindingScheduler(props?)` (public, on `aekasha/ui`), one per host (a debugger tab, a
  window, an app panel): `{ refresh(), setVisible(on), dispose() }`. A field takes `scheduler`;
  without one it gets the scheduler of the property grid or form it's in, or none (refreshed only
  by `refresh()` on its handle).
- **Two kinds of read:** `refresh()` reads every edit field of the host (what a tab's `onRefresh`
  and `updateDebuggerTab` do today; p806 maps `refreshIntervalMs` onto it). Monitors (and a field
  with `live: true`) are read by the tick.
- **The tick:** one `requestAnimationFrame` loop per scheduler, running only while the host is
  visible, the document isn't hidden and it has at least one live field (none: no loop). Each
  live field has its `interval` (ms; `0` every tick, p800 D9) and its last read time, compared
  with the frame's timestamp: no timer per field. Not the main loop: the kit doesn't import it
  (p803 D4), and the debugger's monitors keep running while the loop is paused, as today.
- **Visible fields only:** a field inside a collapsed folder or a hidden item isn't read, and is
  read once when shown.
- **No allocation per tick** (p800 D9): a number compared as a number, a string by `===`, a
  vector or colour component by component into the field's kept scratch, the formatted text made
  only on a change, the DOM written only on a change. The perf-auditor agent reviews it with 200
  monitors in one host (D14).
- **The flash** (p800 D7): an edit field whose value changed from outside (a `refresh()` read
  that differs, not the user's own write) flashes once (`data-flash`, the accent's soft
  background, `--aek-motion-base`). Monitors never flash (D7's per-frame rule); under reduced
  motion the flash is a static tint for the same time.

### D5. The field shell

Every field is the same shell (`Field.ts`, `@internal`): a label, the control, a reset button, a
message line.

- **Common props:** the binding (D3), `label` (required: visible, or `labelHidden: true` keeps it
  as the accessible name only), `hint` (the message line's text), `default` (the reset value;
  default: the value at creation), `disabled`, `hidden` (each a value or a function re-read on
  `refresh()`, as `DebuggerDyn`), `readonly`, `onChange`, `onInput`, `scheduler`, `class`, `attr`,
  `id`.
- **The handle:** `{ cmp, getValue(), setValue(v, opts?), refresh(), reset(), setDisabled(on),
setHidden(on), setError(text | null), focus() }`, plus each field's own.
- **The label:** a `<label for>` for a one-input field; for a group (vector, radio group,
  rotation) the label's id names a `role="group"` (`aria-labelledby`), and each part has its own
  `aria-label` (`X`, `Y`, …). Long labels truncate with `createTooltip({ onlyWhenTruncated })`.
- **The reset button:** a small ghost button after the label, shown only while the value differs
  from its default (so it's a Tab stop only then), labelled "Reset {label}"; `reset()` writes
  the default with `source: 'user'` (it's the user's action, so undo records it).
- **The message line:** a hint, or an error (`setError`, or D9's validation) with the danger role
  and its icon (p800 D6: never colour alone), linked by `aria-describedby`; an error sets
  `aria-invalid` on the control.

### D6. Value editing (p800 D9's last bullet, made concrete)

- **Keys on a number** (and each axis of a vector, rotation, quaternion): ArrowUp / ArrowDown step
  (`step`), Shift ×10, Alt ×0.1; PageUp / PageDown ×10; Home / End to `min` / `max` when set.
  Enter commits typed text, Escape reverts it (and goes no further: p803's "a key the piece uses
  goes no further").
- **Scrub on the label:** a horizontal drag on a number's label changes the value (pointer
  capture, a 3 px threshold so a click still focuses, Shift / Alt as the keys, `cursor:
ew-resize`). No pointer lock (it prompts in some browsers and loses the cursor in an embed).
  The keyboard path is the keys above.
- **Expressions** (p800 D9: "where p804 decides it's safe"): `ValueExpression.ts`, our own parser
  (about 1 KiB): numbers, `+ - * / ** ( )`, unary minus, `pi`, and the units the field declares
  (`deg` / `rad` on an angle, `%` on a 0-1 field). No `eval` or `Function` (CSP-safe, nothing
  runs). An invalid expression shows the error and keeps the value. Typed into any number part.
  Phase 0 found Tweakpane evaluates typed expressions already (ECMAScript's number expressions),
  so this is parity, not new: its `**` is kept, its `%` (modulo) is the unit here, and its bit
  operators and `~` go (nothing types a value with them).
- **Rounding:** a stepped, dragged or typed value is rounded to the shown decimals (`step`'s, or
  `precision`) before it's written, so `1 + 0.1` writes `1.1` (Phase 0: Tweakpane writes
  `1.0999999999999999`, and snaps a typed `2.5` to `2.5000000000000004` on a grid from `min`).
  The step grid stays Tweakpane's (from `min` when it's set, else 0); the rounding takes the
  larger of `step`'s and `min`'s decimals. A `format` changes only what's shown.
- **Precision:** the shown decimals follow `step` (as Tweakpane: `step: 0.01` → 2), or
  `precision`, or `format(v) => string` (Tweakpane's `format`, which then also sets the
  spinbutton's `aria-valuetext`). Numbers use tabular figures (p800 D5).
- **Copy and paste:** Ctrl/⌘+C in a field part with no text selected copies the field's whole
  value as text (`1.5`, `0, 1.2, -3`, `#3fd8f2`, a rotation in degrees); Ctrl/⌘+V of a text that
  parses as the whole value sets it (one `onChange`, `last: true`), otherwise the input pastes as
  usual. (Ctrl+Shift+C was the other candidate: Chrome takes it for the element picker.)
- **Reset:** D5's button and `reset()`; p805's context menu adds it to the label (D1).

### D7. The fields

Native elements first (p800 D8), the APG pattern where none fits:

- **Number** (`createNumberField`): `<input type="text" inputmode="decimal" role="spinbutton">`
  with `aria-valuenow`, `-min`, `-max` and `-valuetext` (the formatted value and `unit`). Not
  `type="number"`: it rejects expressions, formats by locale, and changes on the wheel. Props:
  `min`, `max`, `step`, `precision`, `format`, `unit` (shown after the value), `wrap` (an angle
  wraps at its range instead of clamping).
- **Slider** (`createSlider`): a number field with a track. **The track is pointer-only and
  `aria-hidden`; the spinbutton is the one keyboard and screen reader control** (Tweakpane has
  two tab stops per slider; one is enough when both take the same keys). `showInput: false` makes
  the thumb itself the APG slider (`role="slider"`, focusable) for a compact control. Ticks
  (`ticks: n` or values, with labels) and a value bubble while dragging.
- **Range slider** (`createRangeSlider`, `{ min, max }` value): the APG multi-thumb slider, each
  thumb `role="slider"` labelled "Minimum {label}" / "Maximum {label}", each one's
  `aria-valuemin` / `-max` the other's value ± `minGap`. Steps and ticks as the slider; an
  optional `histogram: number[]` drawn behind the track (inline SVG bars, `aria-hidden`); the span
  between the thumbs drags both (pointer), and its keyboard path is a third stop on the span
  (`tabindex="0"`, `aria-roledescription="range"`, the arrows move both).
- **Checkbox** (`createCheckbox`): a native `<input type="checkbox">`, styled with
  `appearance: none`; `indeterminate` supported. **Switch** (`createSwitch`): the same input with
  `role="switch"` (the APG switch on a checkbox), on / off text optional.
- **Radio group** (`createRadioGroup`): native radios in a `role="radiogroup"` (a `<fieldset>`
  standalone, a labelled group in a grid row); the arrows are the browser's. **Segmented control**
  (`createSegmentedControl`): the same native radios, visually hidden behind segment labels (text
  or icon with a label). A value, not actions: a set of tool buttons is p803's exclusive button
  group.
- **Select** (`createSelectField`): `createDropDown` on the binding. `options` take Tweakpane's two
  forms, `[{ text, value }]` and `{ [text]: value }`, so the port is mechanical; `searchable`
  passes through. The drop-down's own API doesn't change.
- **Text** (`createTextField`): `<input type="text">`; `multiline: true` (with `rows`, Tweakpane's
  names) a `<textarea>`; `type: 'search'` a search input with a clear button and `onSearch`
  (debounced `onInput`). Written on Enter / blur, or each keystroke with `live: true` (D3).
- **Monitor** (`createMonitor`, and `readonly: true` on any field): the value as text in a
  `<span>` (tabular figures, `aria-labelledby` its label), `multiline` / `rows` as a `<pre>`-like
  block, a boolean as "On" / "Off" text, a vector as its axes. **Not a live region** (a value that
  changes 60 times a second would drown a screen reader; p800 D8's deviation, written in its
  JSDoc). `interval` as D4.

### D8. Value editors

- **Colour** (`createColorField`, p800 D13): a swatch button that opens the picker in a p803
  popover, a text input (hex, `rgb()`, `hsl()`, a float triple) and, with `alpha: true`, an alpha
  field.
  - **The value's forms**, read from the bound value and kept on write: a 24-bit number
    (`0xrrggbb`, what `getHex()` gives: today's form), a string (`'#rrggbb'`, `'#rrggbbaa'`), or
    `{ r, g, b, a? }` floats (Tweakpane's `color: { type: 'float' }` maps to `format: 'float'`).
  - **Colour spaces:** `colorSpace: 'srgb'` (default: what the hex forms are) or `'linear'` (a
    `THREE.Color`'s `r`, `g`, `b` in three's linear working space): the picker and text always
    show sRGB, the binding writes what the target holds. The transfer function is the kit's own
    (no three import; three's `ColorManagement` uses the same sRGB curve).
  - **HDR:** `intensity: true` adds a number field after the swatch (a light's intensity or an
    emissive strength), bound with its own `intensityBind` (D3's forms).
  - Recent colours (in memory for the page, shared by the fields; an owner may persist them),
    `palette: string[]` swatches, the EyeDropper API where the browser has it (a button, hidden
    elsewhere), D6's copy and paste.
  - **The picker** is Phase 0's pick (p800 D13's criteria: gzip size, keyboard and screen reader
    use, alpha, HSV / HSL / RGB / hex, how far its look follows our tokens through a shadow root,
    maintenance, licence), wrapped in `ColorPicker.ts` so a swap touches one module, and loaded
    with `import()` on the first open (D12).
  - **Picked: `vanilla-colorful` 0.7.2** (MIT), its HSVA model (Phase 0 step 4 has the study):
    the plane, the hue and the alpha as three `role="slider"` parts (named "Color", "Hue",
    "Alpha", with `aria-valuetext`; arrows, PageUp / PageDown, Home / End), no chrome of its own,
    so the popover around it, the swatch and the text inputs are ours and on the tokens. About
    3 KiB gzip with our wrapper's import.
  - **No tag of its own on the page:** `ColorPicker.ts` imports the base class
    (`vanilla-colorful/lib/entrypoints/hsva`'s `HsvaBase`, which registers nothing) and defines
    `aek-color-picker` from it on the first open (`customElements.get` first), so a host page
    using vanilla-colorful's own `hsva-color-picker` never collides with an embed.
  - **The ring:** its shadow sets `outline: 0` and marks focus only by scaling the pointer;
    `aek-color-picker::part(saturation | hue | alpha):focus-visible` draws the kit's ring from
    outside (an outer `::part` rule beats the shadow's own; checked in Chrome). Sizes and radii
    through `::part` too.
  - **Its limits, and ours around them:** it rounds HSVA to whole degrees and percent (the
    pointer's precision; the text input sets exact values); its slider names are English in its
    template (its shadow root is open, so the wrapper can relabel them if the kit gets
    translations); D6's Shift / Alt step modifiers aren't its keys (the text input has them). Its
    last release is 2022-11, the repository is active (pushed 2026-10, 6 open issues): small,
    finished, and swappable behind the wrapper.
- **Vector** (`createVectorField`): `{ x, y }`, `{ x, y, z }`, `{ x, y, z, w }` or a number
  array (2-4), axes in a row, each a number part (D6) with its axis letter visible (colour on the
  letter is a hint, never alone). `min` / `max` / `step` shared, or per axis
  (`axes: { x: { … } }`). A link lock (a toggle button, `aria-pressed`) scales the axes together:
  proportionally, or by the same delta when an axis is 0.
- **Rotation** (`createRotationField`): an Euler `{ x, y, z, order? }` in radians (a
  `THREE.Euler`'s shape), shown and typed in degrees; `step` in radians (Tweakpane's
  `Math.PI / 8` keeps working) shown as degrees; each axis wraps at ±180°; `showOrder: true`
  adds a select for the order.
- **Quaternion** (`createQuaternionField`): a `{ x, y, z, w }` target edited as Euler degrees
  (default) or axis-angle (`edit: 'axisAngle'`), the raw `xyzw` only with `showRaw: true` (a
  monitor). Normalised on write. While a part has focus, the shown Euler is the user's own, not
  re-derived from the quaternion on each refresh (no jumps between equivalent angles).
  `RotationMath.ts` is the kit's own (no three import, about 1 KiB).
- **Angle dial** (`createAngleDial`): a circle with a handle, `role="slider"` in degrees
  (`aria-valuetext` "45 degrees"), D6's keys, Shift-drag snaps to 15°, `wrap`; next to a number
  part by default.
- **2D pad** (`createPad2D`, `{ x, y }`): a box with a point for offsets and directions. The pad is
  a pointer convenience, focusable with the arrows moving the point (D6's modifiers); **the vector
  field shown next to it is the accessible editor** (the APG has no 2D pattern). The pad has
  `role="group"` and `aria-roledescription="2D pad"`, its value in `aria-describedby` text
  (updated on change, not live).
- **Gradient editor** (`createGradientEditor`, `{ stops: { t, color }[] }`): a preview bar, stops
  on it (each a `role="slider"` for its position: arrows move it, Delete removes it, Enter opens
  its colour field's picker, Insert adds a stop after it), add on a bar click; `evaluate(gradient,
t)` on `aekasha/ui` for the sky colours and ramps.
- **Curve editor** (`createCurveEditor`): `mode: 'bezier'` (a CSS-like `[x1, y1, x2, y2]` easing,
  two handles) or `'keys'` (`{ x, y, inTangent?, outTangent? }[]`, the falloff and animation
  curves p426 needs), with presets (linear, ease in / out / in-out, smoothstep). SVG (a few points,
  crisp at any scale, styled by the tokens). Keyboard: each point is a stop (Tab between them),
  arrows move it (D6's modifiers), Delete removes, Insert adds; the points' values are listed in
  a visually hidden table. `evaluateCurve(curve, x)` on `aekasha/ui`.

### D9. Containers

- **Folder** (`createFolder`): the APG disclosure, a `<button aria-expanded aria-controls>` row
  over a region, not `<details>`: the height animates under D7 in every browser (`::details-content`
  isn't everywhere), and the open state is set before the first paint. The chevron turns as it
  opens. `expanded`, `onExpandedChange` (the owner persists, D1), nesting with an indent per level,
  `hidden`.
- **Fieldset** (`createFieldset`): a native `<fieldset>` and `<legend>`, for a group outside the
  grid (a form's section).
- **Property grid** (`createPropertyGrid`): the label column layout the debugger uses. A CSS grid
  with `--aek-property-grid-label-width` (default 40 %, Tweakpane's look), labels aligned and
  truncated with a tooltip, every row in the density's height.
  - **The label column is resizable:** a `role="separator"` on the column edge, focusable,
    `aria-valuenow` the percentage, dragged or moved with the arrows; `labelWidth` and
    `onLabelWidthChange` (the owner persists).
  - It owns a scheduler (D4), or takes one (`scheduler`, a tab host sharing one over its
    sections), and `refresh()` reads every field in it and re-reads each `hidden` / `disabled`
    function (today's `refresh()`).
  - Its content: field handles and D10's items (`items`), added with `add(...)` after creation too.
- **Form** (`createForm`): a `<form novalidate>` around a grid or fieldsets, with `onSubmit`
  (Enter in a field submits, as natively) and `onReset` (every field to its default). Per field
  `required` and `validate(value) => string | null`, checked on blur after the first submit and on
  submit: the errors under their fields (D5) and an error summary at the top that takes the focus
  and links each field (the GOV.UK pattern). What p355's save menu and p808's settings menu build
  on.

### D10. The declarative description

- `PropertyGridItem`: a field item, `{ type: 'folder', title, id?, expanded?, hidden?, items }`,
  `{ type: 'button', title, label?, variant?, hidden?, disabled?, onClick }` (p803's button),
  `{ type: 'separator', hidden? }` (p803's divider) and
  `{ type: 'custom', build(container: CMPHandle) => void | (() => void) }` (the function it
  returns runs on every refresh). The shape of today's `DebuggerPaneItem`, with a CMP container in
  `custom` instead of Tweakpane's `Pane | FolderApi` (p800 §5's p806 sketch).
- **A field item** is `{ target, key }` or `{ get, set }` or `{ value }` (D3) with the field's
  props, and `kind` (`'number' | 'slider' | 'checkbox' | 'switch' | 'radio' | 'segmented' |
'select' | 'text' | 'color' | 'vector' | 'rotation' | 'quaternion' | 'angle' | 'pad2d' | …`).
  **Without `kind` it's inferred from the bound value at creation, as Tweakpane does:** a number
  is a number field, or a slider when both `min` and `max` are set; a boolean a checkbox; a string
  a text field; any value with `options` a select; `{ x, y }`-like objects and 2-4 number arrays a
  vector. **Colours are inferred as Tweakpane infers them** (Phase 0's census: the sky box's 8
  colour rows are `'#rrggbb'` strings with no `view`, the Debug tools tab's 2 grid colours
  `{ r, g, b }` objects with only `color: { type: 'float' }`): a `'#rgb'`, `'#rrggbb'` or
  `'#rrggbbaa'` string and an `{ r, g, b, a? }` object are a colour field (the object's channels
  0-1, D8's float form; no census row has 0-255 objects); a 24-bit number has no shape to infer
  from (`kind: 'color'`, Tweakpane's `view: 'color'`); a text field that holds such a string says
  `kind: 'text'`. An object with a string `order` (a `THREE.Euler`'s shape) is a rotation field
  (D8: degrees), not a vector (Tweakpane shows its radians as a point; the census's 2 Euler rows
  are imperative, rewritten in p806 anyway).
- **Tweakpane's names map one to one** (p800 D9), so p806's port is a rename where it isn't the
  same name:

  | Tweakpane                                    | Here                                             |
  | -------------------------------------------- | ------------------------------------------------ |
  | `label`, `min`, `max`, `step`, `format`      | the same                                         |
  | `options` (array or object)                  | the same (D7's select)                           |
  | `readonly: true`, `interval`                 | the same (D7's monitor, D4)                      |
  | `multiline`, `rows`                          | the same (D7's text and monitor)                 |
  | `hidden`, `disabled` (values or functions)   | the same                                         |
  | `expanded` (a folder, a titled section)      | the same                                         |
  | `view: 'color'`, `color: { type: 'float' }`  | `kind: 'color'`, `format: 'float'`               |
  | an `{ x, y, z }` value (a point)             | inferred `vector`                                |
  | a `'#rrggbb'` string, an `{ r, g, b }` value | inferred `color`                                 |
  | a `THREE.Euler` value (a point in radians)   | inferred `rotation` (shown in degrees)           |
  | `onChange(value, { prev, last, api })`       | `onChange(value, { prev, last, source, field })` |
  | `onCreate(api)`                              | `onCreate(field)` (the field's handle)           |
  | `addBlade({ view: 'separator' })`            | `{ type: 'separator' }`                          |
  | `addBlade({ view: 'list', options, value })` | an unbound select (`kind: 'select'`, `value`)    |

  Phase 0's census confirms every param in use is in the table (the two inferred rows above were
  added from it); what isn't a rename is §4's list for p806.

- **Folder ids** are the title path (`'Parent/Child'`) or `id`, as today, and the grid reports
  `onFolderExpandedChange(id, expanded)` and takes `folderExpanded: Record<string, boolean>`: the
  owner's persistence (D1) keeps today's key format.

### D11. Accessibility (p800 D8, for forms)

- Every field has a visible label, or `labelHidden` with the name still given; a group is a
  `role="group"` (or a fieldset) with its label.
- Target size at least 24 × 24 px in the compact density at UI scale 1, the slider's thumb and the
  reset button included.
- Errors: text, the danger role and its icon, `aria-invalid`, `aria-describedby`; the form's
  summary takes focus on a failed submit.
- Monitors aren't live regions (D7); a running value an app wants announced is the app's
  `aria-live` text.
- Every pointer action has a keyboard path: scrub (keys), the slider track (the spinbutton), the
  range span (its stop), the pad (arrows and the vector field), the gradient's and curve's points
  (their stops), the label column (its separator), the picker (its inputs).
- Reduced motion: the folder opens without the height animation, the flash is a static tint
  (D4), the value bubble doesn't slide.

### D12. Size

- Each field is its own module; a form with a number, a slider, a checkbox and a select brings no
  colour, rotation or editor code (`sideEffects`, p803 D12).
- **Lazy:** the colour picker library on the first open (`import()` in `ColorPicker.ts`; the
  swatch and text input work without it). The gradient and curve editors are their own modules,
  imported only by an app that uses them, so they need no `import()` of their own.
- **Budgets** (p800 D10: "later a form"): the `uiKit` profile's scene gets a small form (a number,
  a slider, a checkbox, a select and a colour field), and `sbp.config.ts` gets a line for the
  forms group and one for the picker's chunk, set from Phase 0's probe and Phase 5's measure.
- The debugger's use costs production nothing (p806; p607 D7).

### D13. p803's open items and the button's `kbd`

From `docs/issues/ui-kit-review-items.md` (proposed answers; the issue is closed by Phase 1):

1. **`normalize.scss` in a layer:** `@layer aek.page` named first in `tokens.css`' layer order
   statement, `page.scss` forwarding normalize into it. An app's CSS still beats it, and every
   kit rule does too: the button's size goes back on the button, and the fields' inputs need no
   workaround. First in the plan, since every field is an `input`.
2. **Hold to confirm and a click with no press:** a click that no pointer or key press on the
   button started (a screen reader's browse mode) calls a new `onUnheldClick` when given (an app
   opens its confirmation dialog), and is ignored otherwise, as now. The kit can't open a dialog
   from the button without importing the dialog code into every button.
3. **The indeterminate bar's shot:** `verify:ui`'s settle loop pauses an infinite animation at
   40 % of its duration instead of 0, and a box's checks may name its own fraction.
4. **A long custom property name in a Hub table:** the Hub's Markdown renderer puts a `<wbr>`
   after each `-` of inline code inside a table cell.

**The button's `kbd`** (p800 §5): `kbd` takes a `Kbd` handle the app makes
(`createButton({ label: 'Save', kbd: createKbd({ keys: 'Ctrl+S' }) })`), so `Button.ts` no longer
imports `Kbd.ts`; `aria-keyshortcuts` comes from the handle (`getAriaKeyShortcuts` moves onto it).
The string form keeps working, deprecated until 6.0.0 (p622), drawn after an `import('./Kbd')` on
first use (the hint appears a frame later; a build gets a small chunk). Phase 0 measures
`KeyNames.ts`' share; if it's most of the 0.7 kB, the menu's `kbd` gets the same treatment.
**Phase 0 measured it:** the two add about 860 B of JS gzip (and 348 B of CSS), `KeyNames.ts`
about 600 B of it, the same in the menu, so **the menu's `kbd` takes a `Kbd` handle too** (its
string form deprecated the same way).

### D14. Tests and checks

- **Unit tests** (Node, `KitDom`, next to each module): each field's keys (D6) and ARIA after each
  action, its disposal (`countListeners`), and nothing at load. `Binding.test.ts` pins D3's event
  order for each gesture; `BindingScheduler.test.ts` the visibility rules, the intervals (a fake
  `requestAnimationFrame` clock), no write on an unchanged value, no flash on a monitor;
  `ValueExpression.test.ts` the grammar and the refusals; `ColorValue.test.ts` the forms and the
  sRGB curve against three's (three is a dependency, the test may import it);
  `RotationMath.test.ts` Euler / quaternion / axis-angle round trips against three's.
- **KitDom's form controls** (Phase 0 step 5 found linkedom's gaps): `stubKitDomAsync` gets
  `shimFormControls` in Phase 2 section 2, grown as the fields need it: `checked` and
  `defaultChecked` (the attribute is the default, the property the state), `click()` on a
  checkbox or radio toggling it with `input` and `change` and a radio unchecking its group,
  `value` kept apart from `defaultValue` (linkedom writes the attribute on every set), the
  selection API (`selectionStart`, `selectionEnd`, `setSelectionRange`, `select()`), pointer
  capture (`setPointerCapture`, `releasePointerCapture`, `hasPointerCapture`, a
  `lostpointercapture` on release) and a `dispatchPointer` beside `dispatchKey` (an `Event` with
  the pointer fields: linkedom has no `PointerEvent`). No shim for what the kit doesn't use: the
  select field is the drop-down (no native `<select>`), and the form validates itself
  (`novalidate`, D9) and resets its fields through their handles, so no validity API or
  `form.reset()`. **What stays a browser check** (`verify:ui`): the browser's own text editing
  (typing, the caret, IME, the clipboard), a form's implicit submission (Enter in a field), a
  disabled fieldset's controls, anything read from `getComputedStyle`, and the drags' geometry.
- **`yarn verify:ui`:** each field's box with its states (default, focused, disabled, error,
  read-only) and its keyboard script; the folder, grid and form boxes; **a "Tweakpane parity" box**
  (dev page only) with one row per row of Phase 0's census, so p806 starts from a page that shows
  every feature it ports.
- **The perf-auditor agent** reviews the scheduler's tick, the scrub and the slider's drag, with
  a 200-monitor demo (dev page) measured in the profiler's frame probe.

### D15. Documentation and the example

- **The Hub's UI kit section** (p803 D13) gets `features/ui-kit/forms/`: the fields, the value
  editors and the containers, each with `::: demo`, its parts, custom properties and keyboard map;
  **the binding guide** (the three bindings, the events and their order, the scheduler, monitors,
  the declarative grid and its inference) with "Coming from Tweakpane" (D10's table). The
  drop-down's section moves there from the overview.
- **The component library pages** (public and dev) get every box (D14), `DEMOS`,
  `COMPONENT_USES` and the checks.
- **The example** (proposed, the user's call per `docs/plans/CLAUDE.md`): `examples/uiKit/` gets
  a "Scene settings" panel, a property grid in a kit window bound to the scene's objects (a
  spinning mesh's speed on a slider, its colour, its position as a vector, its rotation, a
  checkbox for the wireframe, a monitor of the frame time) and a small form (a validated name, a
  select, submit and reset). No new example scene: p808's `gameHud` builds the settings menu.
- `src/_engine/ui/CLAUDE.md` gets a `## Forms and bindings` section (an `aek:covers` on the forms
  page); the root `CLAUDE.md`'s Three-folder split line for `ui/` names the fields; `readme.md`'s
  UI kit bullet; `layoutRules.ts`' note on `forms/`.
- `debug/CLAUDE.md` and the debug suite's page don't change (p806).

### D16. Versions

- **Engine minor** (5.13.0, or the next minor when p805 merges first): the new components and
  public functions, the button's `kbd` handle with the string form deprecated, normalize's layer.
  The changelog's restyle note (p800 D12): normalize's layer makes the kit's rules beat it on
  buttons and form controls in the full page (the drop-down's trigger takes the kit's line height,
  the key hints `Kbd.scss`' font and size); to keep a normalize rule, an app puts it in its own
  unlayered CSS. The button's font size is on the button again, so an `em` in an app's rule on a
  kit button (a `::before` swatch) is its text size, 14 px at the defaults, not the inherited
  16 px, and a kit piece put straight in a button (a badge, a key hint) has its own size, no
  longer the button's.
- **App minor** (the example's panel and form, the `uiKit` profile's form). **Toolkit:** none.
  **Project:** `verify:ui`'s settle fraction, the Hub's `<wbr>`, the forms page and boxes.
- p800 §6: branch `p804-forms-and-bindings` from `main`, one PR into `main`. It can run beside
  p805's branch; whichever merges second rebases and takes the next minor.

---

## 3. Phases

Branch `p804-forms-and-bindings` from `main`. Verification of each phase: `yarn test`,
`yarn verify:scenes` (baselines recorded on `main` before the first run), `yarn verify:baselines`,
`yarn verify:embed`, `yarn verify:ui`, `yarn sbp --profile all`, plus the phase's own checks. Each
section of a component phase: the modules with their stylesheet and test, their names on
`aekasha/ui` with JSDoc and an `@example`, their boxes on both library pages with the keyboard
scripts, the kit's `CLAUDE.md`; then `yarn test`, `tsc`, ESLint, `yarn hub:build`,
`verify:ui --only <pieces>`, `verify:baselines` (the new names recorded). Each phase stops after
each section for review.

### Phase 0: baselines and checks — done

1. On `main`: `yarn verify:scenes --update`, `yarn verify:embed`, `yarn verify:ui`,
   `yarn sbp --profile all` (the app's and the `uiKit` profile's `_engine/ui` group, the
   `uiKitEmbed` chunk: noted here).
   - **Run on 2026-10-26** (branch `p804-forms-and-bindings` at `567cecf3`, `main`'s commit; macOS,
     Chromium on WebGPU): all four passed. `verify:scenes --update`: 104 runs recorded, 0 failed.
     `verify:ui`: every box and script passed against p803's local shots (117.6 s). `verify:embed`:
     both profiles, all checks. `sbp --profile all`: every budget within (the app's `app` group
     well under: 12.0 kB of 14 KiB, left as it is).
   - **The sizes** (gzip): the app's `_engine/ui` group 5.4 kB initial (budget 7 KiB), 19.8 kB
     lazy; the `uiKit` profile's `_engine/ui` 4.3 kB initial (budget 6 KiB), 17.2 kB lazy; its
     `assets/uiKitEmbed.js` 17.9 kB (budget 19 KiB) and `assets/uiKitEmbed.css` 4.3 kB (Vite's
     figure; budget 6 KiB); `assets/uiKit.css` 1.9 kB (budget 3 KiB). The banner's `_engine/ui`
     4.0 kB.
2. **The Tweakpane census** (a one-off script in the scratchpad, not committed): every binding,
   blade and imperative call in the engine and the app, with its params, the type of its bound
   value, whether its `onChange` has a live side effect, and its file. The result goes into D10's
   table (every param mapped) and a list p806 starts from (§4 of this plan, "For p806").
   - **Run on 2026-10-26** (the TypeScript checker over `src/`: a declarative item found by its
     `DebuggerPane*` contextual type, or by its keys where a helper builds it untyped; an
     imperative call by its Tweakpane receiver; the bound value's type from the checker, the sky
     box's runtime proxy (`Record<string, unknown>`) typed by hand from `_dbg__SkyBoxShared.ts`'
     key tables). §1.1's counts were greps; these are exact.
   - **340 bindings** in 40 files (280 declarative, 53 imperative `addBinding`, 7 untyped helper
     items), plus 26 declarative sections, 66 folders, 77 buttons, 20 separators and 1 `custom`;
     imperative: 7 `new Pane` in 6 files, 5 `addFolder`, 19 `addButton`, 7 `addBlade` (5
     separators, 2 `view: 'list'`).
   - **Params:** `label` 330, `readonly` 85, `step` 84, `min` 75, `disabled` 47, `max` 40,
     `options` 36 (3 in the object form), `interval` 35 (`0` ×14, `250` ×4, `500` ×11, 6 through a
     spread), `hidden` 23, `format` 22, `view` 14 (all `'color'`), `multiline` 11, `rows` 11,
     `color: { type: 'float' }` 2. Every one is in D10's table. `hidden` and `disabled` are always
     functions; `format` and `interval` appear only on monitors; `multiline` only on monitors (no
     editable multiline text); `onCreate` has no user.
   - **The fields they become:** checkbox 92, monitor 88 (12 multiline; their values strings 57,
     numbers 28, booleans 3: no vector or colour monitor), number 43 (34 with `min` and `step`, no
     `max`), slider 40, select 38, colour 22 (9 hex numbers with `view: 'color'`, 8 `'#rrggbb'`
     strings inferred, 3 strings with `view: 'color'`, 2 `{ r, g, b }` floats), vector 11 (all
     3D: `THREE.Vector3`, `Vec3`, `PhysVector`, plain `{ x, y, z }`), text 3, rotation 2 (Euler,
     `step: Math.PI / 8`, both imperative), and the material editor's TSL input (number, checkbox or
     colour by the input's kind).
   - **`onChange`:** 194 act on every tick (a live side effect: a light, a uniform, an override
     with its coalesced undo, a rebuild); 16 act on every tick and read `last` for the commit work
     (persist, undo); 4 act on `last` only (the light's position and target and the camera's
     position, imperative points, and `_dbg__SpatialGrid.ts`' cell size); 126 have none (monitors,
     and state keys the builder persists). D3's every-write `onChange` is what they need.
   - **Parity box rows** (Phase 4; one per distinct shape, with an example): checkbox
     (`_dbg__SpatialGrid.ts:568`); slider `min`/`max`/`step` (`_dbg__LightGUI.ts:838`); select,
     array `options` (`_dbg__SpatialGrid.ts:508`) and object `options` (`_dbg__ECS.ts:120`);
     number `min`/`step` (`_dbg__SpatialGrid.ts:522`), `step` alone (`_dbg__LightGUI.ts:816`),
     `min` alone (`_dbg__LightGUI.ts:865`); monitor plain (`_dbg__SpatialGrid.ts:521`), `interval`
     (`_dbg__LightGUI.ts:506`), `format` (`_dbg__SpatialGrid.ts:560`), multiline `rows` with and
     without `interval` (`_dbg__SpatialGrid.ts:674`, `_dbg__AmbientLightFolder.ts:21`); vector
     (`_dbg__DebugTools.ts:549`); colour hex number (`_dbg__SpatialGrid.ts:586`), inferred
     `'#rrggbb'` (`_dbg__BaseFolder.ts:26`), string with `view` (`_dbg__RayTester.ts:492`), float
     object (`_dbg__DebugTools.ts:682`); text (`_dbg__RayTester.ts:557`); rotation, Euler
     (`_dbg__Character.ts:213`); a `hidden` and a `disabled` function; a folder, a nested folder, a
     button, a separator, a `custom` item; an unbound select (the `view: 'list'` blade).
3. **The event order today:** a Playwright probe on the `debugTab` example (`?isDebug=true`): drag
   a slider, step it with the keys, type into a number, toggle a checkbox, pick a list option, and
   log each `onChange` with `last` and `prev`. Written here; `Binding.test.ts` pins D3's order, and
   any difference from today's is a decision in D3 before Phase 2.
   - **Run on 2026-10-26** (Chrome on WebGPU, a dev server of its own, a fresh context per tab;
     Playwright's route served `_dbg__DebuggerPaneBuilder.ts` with a log call before its
     `isSuppressed` check and one next to its `onChange` call, so the repo wasn't touched; the
     `debugTab` example has only a slider and a colour, so the Debug tools tab's checkbox and
     number and the Renderer tab's list were driven too). Each line: what the builder's
     `onChange` got.
   - **Slider drag** (the track, a pause before the release): the press writes at once
     (`last: false`, `prev` the old value), each move writes (`last: false`, `prev` the step
     before), the release repeats the last value with `last: true` and `prev` equal to it.
     Released while moving: the same, the `last: true` call 8 ms after the last step. **A click on
     the track** is the same gesture: one `last: false` write, then `last: true` with the same
     value.
   - **Keys** (the slider's focused track with ArrowRight, its text with ArrowUp, the number's
     text with ArrowUp): each keydown writes with `last: false`, its keyup repeats it with
     `last: true`. Shift+ArrowUp steps ×10. A held key's repeats each write `last: false`; one
     `last: true` on the keyup.
   - **Typed text:** Enter or a blur (Tab) writes once with `last: true`, `prev` the old value.
     Escape doesn't revert: the next blur commits the typed text. `1/2` is evaluated (0.5:
     Tweakpane's own parser, ECMAScript's number expressions: `**`, `*`, `/`, `%` as modulo, `+`,
     `-`, the bit operators, unary `+ - ~`, parentheses); `abc` writes nothing.
   - **The number text's drag knob** (Tweakpane's scrub, on the value's left edge): as the slider
     drag, `last: false` per step and `last: true` on the release.
   - **Colour:** a typed `#ff0000` and Enter writes once (`last: true`); a drag in the picker's
     plane writes per move (`last: false`) and once with `last: true` on the release. The bound
     string is written as `'#rrggbb'`.
   - **Checkbox** (a click, Space) and **list** (a pick): one write, `last: true`.
   - **Float noise:** ArrowUp from 1 by `step: 0.1` writes `1.0999999999999999`; a typed `2.5`
     on `min: 0.1, step: 0.1` writes `2.5000000000000004` (Tweakpane snaps to the step grid from
     `min` and doesn't round).
   - **Refresh:** the tab's `refreshIntervalMs` refresh makes Tweakpane emit `change` for the
     bound values that changed (and every monitor), which the builder suppresses: no `onChange`.
     **But a monitor's own `interval` read emits `change` unsuppressed**, every 200 ms (Tweakpane's
     default) with `last: true`, so the builder would call a monitor's `onChange` on every read;
     no monitor in the census has one.
   - Not found: ArrowDown on a focused `<select>` in Chrome on macOS opens its popup, so no key
     write was logged for the list.
   - Aside: the Renderer tab's "Custom" tone mapping (`THREE.CustomToneMapping`) logs
     `THREE.ToneMappingNode: Unsupported Tone Mapping configuration. 5` on WebGPU: the tab offers
     an option three's node renderer doesn't take (outside this plan:
     `docs/issues/renderer-custom-tone-mapping.md`).
4. **The colour picker study** (p800 D13): `vanilla-colorful`, Coloris, `iro.js`, and any newer
   candidate found then, on p800 D13's criteria, each in a probe page (scratchpad) in both themes:
   gzip size, keyboard and screen reader use (axe-core and by hand with VoiceOver), alpha, the
   models, how far tokens restyle it, last release and open issues, licence. The pick and why go
   into D8.

   - **Run on 2026-10-26** (Chrome; each candidate inline in a popover-like frame on the tokens,
     in a page of its own per theme over HTTP, with a stylesheet mapping its look onto the tokens;
     esbuild bundles, minified; axe-core with WCAG 2.2 A / AA and `best-practice`; a Tab walk from
     a button before to one after, pressing ArrowRight and ArrowUp at each stop). Added from a
     search: Alwan, Pickr, vanilla-picker, `hdr-color-input` (`<color-input>`), and the native
     `<input type="color">` as the floor.

     | Candidate                     | gzip (JS + CSS) | axe (both themes)                                               | Keyboard                                                   | Tokens                             | Release, repo           | Licence |
     | ----------------------------- | --------------- | --------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- | ----------------------- | ------- |
     | `vanilla-colorful` 0.7.2 HSVA | 3.0 KiB         | none                                                            | 3 sliders, named, value text                               | `::part`, no chrome; ring from out | 2022-11; pushed 2026-10 | MIT     |
     | the same with `<hex-input>`   | 4.1 KiB         | `label` (its input)                                             | + an unnamed input                                         | as above                           | as above                | MIT     |
     | Coloris 0.25.0 (`@melloware`) | 7.6 KiB         | `aria-prohibited-attr`                                          | all reachable, but Tab cycles inside the picker (a trap)   | classes only; a marker outside     | 2025-06; pushed 2025-09 | MIT     |
     | Alwan 2.3.1                   | 7.9 KiB         | `aria-prohibited-attr`, `aria-valid-attr` (critical)            | all reachable; no focus outline                            | its custom properties: good        | 2026-02; 51 stars       | MIT     |
     | vanilla-picker 2.12.3         | 6.9 KiB         | none                                                            | the plane and sliders not reachable (2 stops: text, Ok)    | classes; stays light in dark       | 2024-03                 | ISC     |
     | Pickr 1.10.2                  | 10.2 KiB        | `aria-roles`, `aria-required-attr` (critical), contrast, size   | reachable; the plane a `listbox`; ignored the start colour | classes, `--pcr-color`             | 2026-09; 34 open        | MIT     |
     | iro.js 5.5.2                  | 10.4 KiB        | none (nothing focusable)                                        | none (0 stops)                                             | JS options only (SVG)              | 2021-07                 | MPL-2.0 |
     | `hdr-color-input` 0.4.4       | 77.7 KiB        | `label` ×8, `aria-required-attr` (critical), `label-title-only` | reachable; unnamed sliders and number inputs               | `::part`; wide gamut, OKLCH        | 2026-08; 23 open        | MIT     |
     | `<input type="color">`        | 0.4 KiB         | none                                                            | one stop; the OS's own panel                               | none (the OS draws it)             | -                       | -       |

   - **The pick: `vanilla-colorful`, its HSVA picker** (D8 says why and how it's wrapped): the
     smallest, the only one with no axe violation that's fully keyboard-reachable, and the only
     one with no chrome to fight (the rest of the field is ours anyway). Not done here:
     VoiceOver by hand; it's a check for Phase 5 section 2, on the wrapped picker.

5. Checks that decide details: linkedom 0.18.13's `<input>` (`value`, `selectionStart`, `select`
   and `input` events, `setPointerCapture`; a gap becomes a `KitDom` shim or a check moved to
   `verify:ui`); `KeyNames.ts`' share of the button's `kbd` cost (D13); whether `@layer aek.page`
   changes any scene runner screenshot or the debugger by eye (D13 item 1).
   - **Run on 2026-10-26.**
   - **linkedom 0.18.13's form controls** (a script over its `parseHTML`, without KitDom): an
     input's `value` works (writing it rewrites the `value` attribute, so `defaultValue`, which
     is `undefined`, can't be told apart), a textarea's too, and an `input` event dispatched
     reaches its listener. Missing or wrong: `checked` doesn't read its attribute and setting it
     leaves the attribute; `click()` doesn't toggle a checkbox; a radio doesn't uncheck its group;
     no `selectionStart`, `setSelectionRange` or `select()`; `select.value` can't be set and has
     no `selectedIndex`; no `labels`, `htmlFor` or `control`; `readOnly`, `required` and
     `inputMode` don't reflect; a disabled fieldset disables nothing (`:disabled`); no
     `form.reset()`, `elements`, `noValidate`, `checkValidity`, `validity`,
     `setCustomValidity` or `requestSubmit`, and a submit button's click submits nothing; no
     `setPointerCapture` / `hasPointerCapture`; no `KeyboardEvent`, `PointerEvent`,
     `MouseEvent`, `FocusEvent` or `ClipboardEvent` (`Event`, `CustomEvent`, `InputEvent` are
     there); no `getComputedStyle` or `ResizeObserver`. `customElements` exists; SVG elements
     build and serialise. What follows is in D14.
   - **The button's `kbd` cost** (esbuild, minified, gzip; the stylesheets stubbed; each module
     replaced by a stub in turn): `Kbd.ts` and `KeyNames.ts` add **about 860 B** of JS to a button
     (8293 B → 7431 B), of which **`KeyNames.ts` is about 600 B (70 %)** and `Kbd.ts` about 260 B,
     plus `Kbd.scss`' 348 B of CSS. The menu is the same (about 845 B, KeyNames 586 B). So the
     menu's `kbd` gets D13's treatment too.
   - **`@layer aek.page`** (the change made for the check and reverted: `aek.page` first in
     `tokens.css`' order, `page.scss` loading normalize with `meta.load-css` inside the layer; the
     full page's DOM, shot with the canvas hidden in 15 states, before (twice: 0 px apart, the
     profiler's live figures aside) and after, compared in pixels): **no drawer tab changed**
     (the debug tools, renderer, lights, cameras, sky box, physics, stats, loop, ECS and assets
     tabs, the Boxes tab: Tweakpane and the debugger's own styles are unlayered and beat it
     either way). What changed is the kit where normalize had won: **the kit's buttons in the
     debugger's dialogs** (the About dialog's "Copy info" and "Close", the key shortcuts dialog's
     and the profiler's tab buttons) are a few px taller, normalize's `line-height: 1.15` giving
     way to the kit's; and **the key hints** (`Kbd`) in the UI kit example's buttons are the
     kit's size, normalize's `kbd { font-family: monospace, monospace; font-size: 1em }` giving
     way to `Kbd.scss` (the look the Hub shows, which has no normalize). The scene runner's
     snapshots read the canvas, so they can't show it; Phase 1 section 1 compares these shots
     instead.

### Phase 1: p803's open items and the button's `kbd` — done

D13. Small, and first: normalize's layer is under every field.

1. Section 1, normalize's layer: `@layer aek.page` in `tokens.css`' order, `page.scss`, the
   button's size back on the button, the drop-down trigger's line height, `Kbd.scss` as the key
   hint's whole look; the full page's DOM compared before and after (the scene runner's
   snapshots read the canvas and can't show it): Phase 0 step 5's states, shot with the canvas
   hidden (`?isDebug=true&startScene=…` with the drawer's tab seeded in `AEK_debugDrawerState`,
   and `?isProdTest=true&startScene=exampleUiKit` for the kit's HUD without the debugger), the
   expected changes being the kit buttons' height and the key hints, and none in a drawer tab.
   - **Done 2026-10-26.** `tokens.css`' order puts `aek.page` first (its header says why it's
     named there; `Tokens.test.ts` follows); `page.scss` loads normalize with `meta.load-css`
     inside `@layer aek.page`, its `*`, `body`, `#mainCanvas` and `#guiContainer` rules left
     unlayered (Phase 0 checked normalize alone, and nothing of the kit fights them). The button's
     `font-size` and `line-height` are on `.aekButton` again (`--aek-button-font-size` still set
     per size, which the spinner reads); the drop-down's trigger needed no change (its own
     `line-height` now wins), only its comment, as `Kbd.scss`' and `Divider.scss`'. The Hub's
     Styling guide names `aek.page`.
   - **The shots** (Phase 0's 15 states, the script reused; two "before" sets 0 px apart but the
     profiler's live figures): **no drawer tab changed.** Changed: the About dialog's "Copy info" and
     "Close" (taller: the kit's line height), the key shortcuts dialog and the profiler (their kit
     buttons and key hints), and the UI kit example's key hints (`Kbd.scss`' size and font, no
     longer normalize's `kbd { font-family: monospace, monospace; font-size: 1em }`): Phase 0's
     list. One more, from the button's size moving back: **an `em` on the button itself now means
     its text size.** The example's shape swatches (`.exampleUiKitShapeButton::before`, `0.75em`)
     went from 12 px to 10.5 px, since the button was 16 px (inherited) with only its parts at
     14 px. That's the point of the move, and goes in D16's changelog note with normalize's.
     Section 3's full `verify:ui` found one more of the same kind: a badge put straight in a
     button (the badge box's "Messages") had the button's size from the old `.aekButton > *` rule,
     and now has its own `0.8em` of it.
2. Section 2, the button: `kbd` as a `Kbd` handle, the string form deprecated and loaded on first
   use, `onUnheldClick`; the menu's `kbd` if Phase 0 says so; JSDoc, the Hub's core page, the
   library's button text.
   - **Done 2026-10-26.** The `Kbd` handle gets `getAriaKeyShortcuts()` (D13) and
     `onKeysChange(fn)`, which returns its remover (not in D13): a button's or item's
     `aria-keyshortcuts` follows a later `setKeys`, which reading it once at the create would
     leave stale.
   - **`components/ShortcutHint.ts`** (`@internal`): `addShortcutHint(props)` draws a hint (the
     part's class, `aria-hidden`, before `before`), writes the owner's `aria-keyshortcuts` and
     keeps it, and returns a stop (`removeHint`). It imports Kbd's type only; the deprecated
     string makes the hint after `import('./Kbd')` (not after a stop that came first). The button,
     the split button (through the button) and the menu use it, so none of them imports `Kbd.ts`
     or `KeyNames.ts`.
   - **Who removes a hint** (every CMP stays in CMP's registry until removed, and the old code
     never removed the hint it made): the button, with itself; the menu, a getter's hints at each
     close (a getter makes new ones per open) and an array's with the menu (they're re-added on
     each open). A string's hint is always the owner's.
   - **`onUnheldClick`**: a press is a primary `pointerdown` or a hold key's keydown; the click
     after a pointer's release takes it, and a `pointercancel`, the key's keyup or a blur ends it
     (no click follows those). A click with none calls `onUnheldClick` (not while loading), and
     is ignored without it. The Hub's hold demo reports one; `yarn verify:ui` has no step that
     clicks without a press, so `Button.test.ts` alone checks it (the dev library page says so).
   - The string form's removal is in p622's list (`ButtonProps`, `SplitButtonProps`,
     `MenuActionItem`, `MenuCheckboxItem`, and the string path of `ShortcutHint.ts`). The UI kit
     example and the Hub's demos pass handles.
   - **Sizes** (`yarn verify:baselines`): the `uiKit` profile's `uiKitEmbed.js` 17.9 → 17.5 kB
     gzip and its `.css` 4.2 → 4.0 kB (its buttons show no hint), the app's `DropDown.js` chunk
     −0.5 kB; Kbd is a chunk of its own (`Kbd.js` 1.2 kB, `Kbd.css` 0.3 kB), lazy in the `uiKit`
     profile (only the string path loads it), in the app with the example that imports it.
   - **`verify:ui`'s menu shots moved** ("the menu open", "the split button's menu open"): not
     the menu. The library page's button text grew by a line, which moved the menu box 26 px
     down and the open menu from y .578 to .969 of a pixel, which antialiases its text
     differently. A box's shot is pinned to whole pixels (`getPinBoxCss`), an open overlay's
     isn't. Recorded again; section 3 could pin the overlays too (the anchor scrolled to a whole
     pixel before the shot), so a Hub text change no longer moves them.
3. Section 3, `verify:ui`'s settle fraction and the Hub's `<wbr>`; the issue file closed
   (`git rm`, its mentions in `src/_engine/ui/CLAUDE.md` and p800 updated).
   - **Done 2026-10-26**, with the overlays' pinning added (the user's call after section 2).
   - **The settle point:** an infinite animation pauses at `pauseAt` of its duration after its
     delay, 0.4 by default (`ui.ts`' `DEFAULT_PAUSE_AT`), or the box's own (`UiDemoChecks.pauseAt`
     in `_componentChecks.ts`). The progress bar's box says 0.2: its slide eases out fast
     (`--aek-ease-standard`), so at 0.4 the bar is already past the right edge; at 0.2 it spans
     30-70 % of the track. The spinner's, the skeleton's and the loading overlay's shots were
     recorded again at 0.4.
   - **The overlays pinned:** before a state's steps, `uiPage.ts`' `alignBoxAsync` offsets the
     box by its place's fraction of a pixel (`position: relative` with `left` / `top`; a
     transform would make the box the containing block of its fixed children), so what opens
     anchored to it lands on whole pixels. The two menu shots were recorded again; checked by a
     temporary wrapped line at the top of the library page, with the drop-down, tooltip, popover
     and menu boxes passing unchanged under it.
   - **The `<wbr>`:** `code.ts`' `tableCellCodeRule` marks plain inline code in a table cell, and
     its renderer puts a `<wbr>` after each hyphen between two letters or digits
     (`breakAtHyphens`), not after each `-` as D13 had it: a break after a name's leading `--`
     would leave it alone at a line's end. Highlighted inline code (`` `x`{ts} ``) is left as it
     is. `devTools/hub/code.test.ts` is new (and `HubCodeOptions` exported for it).
   - The issue file is removed; p800's two mentions now say p804 took and settled its items (the
     kit's `CLAUDE.md` had none). The dev library pages' spinner, skeleton and progress bar texts
     say where their shots pause.

### Phase 2: the binding core and the first fields — done

D3-D6 and D7's number, text, checkbox and switch: the core is built against real fields, so its
API is tried before the rest depend on it.

- **Verified 2026-10-26** (after section 4): `yarn test` (193 files), `tsc` and `tsc -p hub`,
  ESLint, `yarn hub:build`, `yarn verify:ui` (every box and script, 152 s; the number, text and
  checkbox boxes' shots recorded), `yarn verify:embed` (both profiles), `yarn sbp --profile all`
  (every budget within: no kit field is in an app or embed build yet, so the sizes are Phase 0's),
  `yarn verify:scenes` (104 passed), `yarn verify:baselines --update` (the new names; docs 100 %).
- **Open for Phase 4** (raised in section 1, not decided): D4 says a field with no scheduler is
  read only by its own `refresh()`, so a monitor made alone (outside a grid or a form) would never
  tick. Phase 4's monitor section decides: as D4 says, or a live field without a scheduler makes
  one of its own. **Decided in Phase 4 section 1:** neither: a live field with a bound value and
  no scheduler joins one the page shares (`getPageScheduler`).

1. Section 1, `forms/binding/`: `Binding.ts` (the three forms, in-place writes, the events and
   `prev`), `BindingScheduler.ts` (refresh, the tick, visibility, intervals, the flash),
   `ValueExpression.ts`, `ValueText.ts` (precision, `format`, tabular figures); their tests. No UI
   yet; `createBindingScheduler` on `aekasha/ui`.
   - **Done 2026-10-26.** 47 tests in the four `*.test.ts` files; the kit's `CLAUDE.md` has a
     bullet for the core (D15's `## Forms and bindings` section, with its `aek:covers`, stays
     Phase 7's).
   - **`Binding.ts`** (`@internal` but its two public types): `createBinding({ ...source, kind,
     onChange })` returns `{ peek, getValue, sync, step, commit, change, setValue, isInGesture }`.
     A `BindingValueKind` (`{ equals, copy(from, into?) }`) compares and copies the value:
     `getPrimitiveValueKind()` (`===`, NaN equal to itself, so a bound NaN isn't a change on every
     read) or `createObjectValueKind(keys)` (key by key, a copy a plain object; a read fills the
     kept copy in place, no allocation; a `THREE.Euler`'s accessors work as fields). D3's order:
     `step` writes with `last: false` (an equal value opens the gesture and writes nothing, as
     Tweakpane's `forceEmit: false`), `commit` fires `last: true` with the gesture's first `prev`
     even when nothing moved since (Tweakpane's release), `change` is one write with `last: true`
     (and inside a gesture, its last step and commit), `setValue` is `source: 'api'` and reads the
     bound value first (`silent` writes without an event). An equal value is no write for
     `change` and `setValue`. The handler gets copies (it may keep them), after the value is
     written and kept, so a `refresh()` from inside it reads no change (§4's `refreshPane`).
   - **Not in D3:** `{ get, set }` with an object value calls `set` with a copy of its own (D3's
     in-place rule is `{ target, key }`'s); `{ value }` holds a plain copy (a `THREE.Vector3`
     given as `value` reads back as `{ x, y, z }`). `BindingSource` and `BindingChange` go on
     `aekasha/ui` with the number field (section 2), the first public signature naming them.
   - **`BindingScheduler.ts`:** the handle is D4's `{ refresh, setVisible, dispose }`; a field
     joins through `addScheduledBinding(scheduler, { read(fromRefresh), readState?, isShown,
     interval? })` (`@internal`, returns the remover; the internals are in a `WeakMap`, off the
     public handle). `refresh()` calls every entry's `readState` (the `hidden` / `disabled`
     functions, hidden or not), reads the shown ones with `fromRefresh: true` (live ones too: a
     monitor ignores the flag) and marks the others stale; `revealScheduledBindings(scheduler)`
     reads the stale entries that show now, once, without a flash (a folder calls it on open,
     Phase 4; a field on `setHidden(false)`, section 2). The tick reads a hidden live entry on the
     first frame it shows, whatever its interval. The page's `visibilitychange` is listened to
     only while a live entry exists. `isShown` is the field's (section 2 decides how it sees a
     collapsed folder; a `closest('[hidden]')` per tick read is the candidate the perf-auditor
     looks at in section 4).
   - **The flash** is `createFlash(elem)` in `BindingScheduler.ts`: `data-flash` for 200 ms
     (`--aek-motion-base` unscaled, so reduced motion's static tint lasts as long), a second flash
     restarting it; the stylesheet's rule and the tabular figures land with `Field.scss` in
     section 2 (no UI here).
   - **`ValueText.ts`** (all `@internal` but `NumberRules`, which the number field's props
     extend): the shown decimals are Tweakpane's count (`toFixed(10)` without trailing zeros, so
     `Math.PI / 8` shows 10, as there), `precision` over `step`'s, else the value's own and at
     least 2 (Tweakpane's `getSuitableDecimalDigits`); `constrainNumber` snaps to the grid from
     `min` (else 0), wraps or clamps, then rounds. **The rounding takes `max`'s decimals too**
     (D6 said step's and min's): a clamp to `max: 1.05` on a `0.1` grid would round past it
     otherwise. Without a `step` it rounds to `precision`, else the value's own decimals (at most
     10). A `step` of 0 or less is none. Halves round away from zero.
   - **`ValueExpression.ts`:** as D6, plus `π`, exponents (`2e-3`) and a unary `+`; `**` binds
     tighter than a unary sign and from the right (`-2 ** 2` is -4, `2 ** -1` 0.5); no implicit
     product (`2pi` is an error); units are postfix factors after a number or a `)`, matched
     case-insensitively on the field's own keys (`toString` isn't one); 256 characters and 32
     levels of nesting at most; a non-finite result (`1 / 0`) is an error.
2. Section 2, `Field.ts` (the shell: label, reset button, message line, `hidden` / `disabled`,
   ids) and the number field (spinbutton, D6's keys, scrub, expressions, copy and paste).
   - **Done 2026-10-26.** `Field.test.ts` (11) and `NumberField.test.ts` (26); the number box on
     both library pages (`numberField`: six fields bound to one object, a status line, a kit
     button that changes the speed and calls the scheduler's `refresh()`), four keyboard scripts,
     `COMPONENT_USES`; the kit's `CLAUDE.md` bullets. On `aekasha/ui`: `createNumberField`,
     `NumberField`, `NumberFieldProps`, `Field`, `FieldChange`, `FieldDyn`, `FieldProps`,
     `BindingChange`, `BindingSource`, `NumberRules`.
   - **KitDom's `shimFormControls`** (D14) has what this section needed: `value` apart from
     `defaultValue` (inputs and textareas), the selection API, pointer capture and
     `dispatchPointer`. `checked` and the checkbox's and radio's `click()` come with section 3.
   - **`interval`, not `live`, puts an edit field on the tick** (D4 said "a field with
     `live: true`"): D3 and D7 already use `live` for writing each keystroke, so a field prop
     can't mean both. `interval` is Tweakpane's monitor name, so a monitor and an edit field
     that follows a changing value say it the same way.
   - **The number field's own props:** `expressionUnits` (D6's "units the field declares", named
     apart from `unit`, the shown one), `live`, `onInput`, `format`, `unit` and `NumberRules`
     (`min`, `max`, `step`, `precision`, `wrap`). `readonly` waits for Phase 4's monitor.
   - **Escape on typed text** goes through the overlay stack: the field pushes an entry at the
     first keystroke, so in a dialog the first Escape reverts the text and the next one closes
     the dialog. Outside a HUD root the input's own keydown does it. With `live`, Escape also
     writes back the value from before the typing (`last: true`).
   - **Enter isn't stopped**, so in a form (Phase 4) Enter writes the value and then submits.
     Home and End are left to the caret when `min` / `max` aren't set.
   - **Alt's ×0.1** steps on a tenth of the step's grid: on the grid itself, a 0.1 step × 0.1
     would snap back to where it was.
   - **The reset button**, activated with the keyboard, hides itself (the value is the default
     again), so it moves the focus to the control first; the keyboard script checks it.
   - **The ring is on the input**, not the box: the kit never removes `outline`, and
     `verify:ui`'s keyboard scripts read it on the focused element. The input fills the box (the
     padding is inside it).
   - **Layout:** a field stands alone as its label row over the control and the message line;
     Phase 4's property grid lays fields out in its label column.
   - **Copy and paste** use the `copy` / `paste` events (no clipboard permission): copy with a
     collapsed selection writes `String(value)`, and a plain number pasted (`1.5`, `-2e3`) is the
     value. An expression pasted pastes as text.
   - Not in a keyboard script (no step drives them): the scrub, the clipboard, `live`; the unit
     tests check them.
3. Section 3, the text field (text, multiline, search), the checkbox and the switch.
   - **Done 2026-10-26.** `TextField.test.ts` and `Checkbox.test.ts`; the `textField` and
     `checkbox` boxes on both library pages (the checkbox box shows the switch too, as one module
     makes both), three keyboard scripts each, `COMPONENT_USES`; on `aekasha/ui`:
     `createTextField`, `createCheckbox`, `createSwitch` and their props and handle types.
   - **`forms/TypedText.ts`** (`@internal`, not in D2's table): the typed text the number field
     and the text field share (dirty text, the overlay stack entry for Escape, the commit, the
     revert with `live`'s undo, the blur's settle). The number field moved onto it unchanged (its
     26 tests as they were).
   - **The box styles moved to `Field.scss`** (`.aekField__box`, `.aekField__input`), which both
     typed fields carry next to their own class; `NumberField.scss` keeps the tabular figures,
     the unit and the scrub cursor.
   - **The search field is `type="text"` with `role="searchbox"`**, not `type="search"`:
     browsers draw their own clear button and clear on Escape differently, and the kit has both.
     Its clear button writes `''` and calls `onSearch` at once, and moves the focus to the input
     when it had it (it hides with the text). `onSearch` is debounced `searchDelayMs` (250 ms,
     not in D7), at once on Enter.
   - **Multiline:** Enter is a new line; Ctrl/⌘+Enter (prevented) or a blur writes (D7 named
     only Enter and the blur).
   - **The checkbox** sits before its label and **the switch** after it, both on the shell's
     grid areas (`Checkbox.scss`); a 24 px target with the box or track drawn in its `::before`
     and the mark or thumb in its `::after`. `setIndeterminate` / `isIndeterminate` extend the
     shell's handle object, so `onChange`'s `field` is the checkbox's own handle.
   - **KitDom:** `checked` apart from `defaultChecked`, `indeterminate`, and a checkbox's
     `click()` (flipped, the cancelable click, then `input` and `change`). The radio group's
     unchecking comes with Phase 3. **`verify:ui` got an `expectValue` step** (an input's
     `value`: typed text), for the text field's scripts.
   - **Found by the screenshots, not the checks:** the first `Checkbox.scss` put its
     pseudo-elements inside `:where()` (`:where(.aekCheckbox::before)`), which makes the whole
     rule invalid: the checkboxes and switches drew nothing, yet axe and every keyboard script
     passed (the inputs were there, focusable, with their outline). Fixed
     (`:where(.aekCheckbox)::before`), as was `Field.scss`' placeholder rule; the kit's
     `CLAUDE.md` (Writing a component, Styles) names the trap. A new box's first shots are
     looked at before `--update` records them.
4. Section 4, the perf-auditor's first pass over the scheduler and the scrub with a 200-number
   demo; its findings fixed or written here.
   - **Done 2026-10-26.** The demo is a box on the dev component library page only
     (`numberFieldStress`: 200 number fields with `interval: 0` in one scheduler; "Values change
     every frame", "Values stay", "Stop"; a frame-time readout), not on the public page, so
     `verify:ui` doesn't run it. The perf-auditor agent read the code; a Playwright script (the
     scratchpad's, not committed) profiled the box in headless Chromium on the dev server, 5 s per
     scenario: a sampling heap profile with collected objects, a CPU profile, and the page's
     script, style and layout time (`Performance.getMetrics`). The engine's profiler can't run
     there (the Hub has no engine), so these replace D14's "the profiler's frame probe" for this
     pass.
   - **Before → after** (two quiet runs after, which agreed; every frame 16.7 ms throughout):
     steady (nothing changes) script 6.0 → 3.8-4.3 ms/s, its JS allocation the two rAF loops'
     own (about 5 KiB/s each: the scheduler's tick allocates nothing else); changing (all 200
     every frame) script 58 → 36-40 ms/s and allocation 2.46 → 0.74-0.81 MiB/s; the scrub
     (625 moves) script 2.5 → 1.8 ms/s; stopped: nothing.
   - **Fixed** (the auditor's findings and the profile's): the number field formats once per
     draw (`ValueText.ts`' `createValueFormatter` works out the decimals once when `precision` or
     `step` sets them; `getValueText` / `getSpokenValueText` went), writes `aria-valuetext` only
     when the text changed and the input's `value` only when it differs; the shell writes the
     reset button's `hidden` only when it flips; the tick checks an entry's due time before
     `isShown` (so an entry that isn't due skips the DOM walk; a hidden one is marked stale at
     the frame it's due); a key step or a scrub move redraws the text itself only when it wrote
     nothing (a write redraws through the shell); Alt's rules object is made once.
   - **Left, with why:** **layout**, about 122 ms/s while all 200 change (one layout per frame,
     about 10 µs per input): the inputs' own text layout. `contain: layout paint` on the box
     changed nothing (tried and reverted). Phase 4's monitors draw text in a `<span>`; their pass
     measures it again and tries size containment on a fixed-width cell. **`isShown`'s
     `closest('[hidden]')`** per due entry: about 3 ms/s for 200 entries at `interval: 0`,
     the steady state's main JS cost. Caching it needs the folder (Phase 4), which can mark its
     fields when it collapses. **The flash** restarts a timer per changed field on a
     `refresh()`; a host refreshes every few hundred ms, not per frame. **A gesture's per-step
     objects** (`{ prev, last, source }` with `field`, the copies of an object value): D3's
     event, per user input, not per frame. **`document.visibilityState`** read per frame:
     negligible.

### Phase 3: choices and ranges — done

D7's slider, range slider, radio group, segmented control and select.

- **Verified 2026-10-26** (after section 4): `yarn test` (197 files, 1630 tests), ESLint, `tsc` and
  `tsc -p hub`, `yarn verify:ui` (every box and script, 157 s), `yarn verify:embed` (both
  profiles), `yarn sbp --profile all` (every budget within; no field in an app or embed build yet,
  the `_engine/ui` groups as Phase 0's), `yarn verify:scenes` (104 passed), `yarn verify:baselines
  --update` (the new names; docs 100 %, no debug code).
- **New internal modules** (not in D2's table): `NumberSteps.ts`, `NumberInput.ts` (the spin button
  any number part writes through a `NumberTarget`), `SliderTrack.ts`; the shell's `FieldSpec` grew
  `isLabelledBy`, `messageFor`, `groupRole` and `onRefresh`, and a disabled group is
  `aria-disabled` itself. Phase 4's monitor, grid and declarative items build on these; Phase 5's
  vector, rotation and quaternion axes are `NumberInput`s on an object binding's keys.

1. Section 1, the slider (the pointer-only track, `showInput: false`, ticks, the bubble).
   - **Done 2026-10-26.** `Slider.test.ts` (20); the `slider` box on both library pages (a
     volume as a percent, a field of view with a unit and labelled ticks, a quality without the
     input whose `format` names each step, a disabled one), two keyboard scripts,
     `COMPONENT_USES`; on `aekasha/ui`: `createSlider`, `Slider`, `SliderProps`, `SliderTick`.
   - **`forms/NumberSteps.ts`** (`@internal`, not in D2's table): `createNumberSteps(rules,
     { horizontal? })` (`constrain` with Alt's tenth of the grid, `getKeyTarget`: the arrows,
     PageUp / PageDown, Home / End; `horizontal` adds ArrowLeft / ArrowRight, the APG slider's)
     and `getStepModifier`, which the number field moved onto (its tests as they were); the
     range slider's thumbs, the vector's axes, the angle dial and the pad take them next.
   - **The slider with the input is the number field's spin button** (`buildNumberField(props,
     parts)`, `@internal` in `NumberField.ts`, which `createNumberField` is with `scrub: true`):
     the track goes before the box in a `.aekSlider__row`, its draw, disabling and removal hook
     in, and a press on the track calls `interrupt` (typed text put back, a key's gesture
     ended). **No scrub on a slider's label**: the track is its drag. `SliderProps` is
     `NumberFieldProps` with `min` and `max` required, so `expressionUnits`, `live`, `format`,
     `unit` and the rest pass through.
   - **Without the input** the shell needed a third way to name a part: `FieldSpec.isLabelledBy`
     (a `<span>` label the thumb is `aria-labelledby`; a click on it focuses the thumb, since a
     `<label for>` labels only a labelable element). A disabled thumb has `aria-disabled` and no
     `tabindex`.
   - **The pointer:** the press `preventDefault`s (no text selection; the focus stays, so a
     phone's keyboard doesn't open; without the input it focuses the thumb), captures the
     pointer and steps to the value under it; **a press on the thumb keeps its grab offset**
     (not in D7: the thumb doesn't jump to the pointer's x); Alt drags on a tenth of the grid
     (Shift means nothing to an absolute position). The release, a `pointercancel` or a lost
     capture commits; disabling commits a drag; removal releases the capture and doesn't commit
     (as the number field's scrub).
   - **Ticks** are marks only (`step` makes the grid): a count is spread from `min` to `max` with
     both ends (at least 2), values outside the range are left out, and labels make the track
     taller (`data-tick-labels`). All `aria-hidden`: the value text says where the value is, so a
     label that names a value (a quality's "High") goes in `format` too, as the demo does.
   - **The bubble** is the shown text with the unit, written only when it changes; it fades and
     rises in over `--aek-motion-fast` while `data-dragging` (no rise under reduced motion). The
     thumb's `left` and the fill's `width` are a percent rounded to a thousandth (`0.55 * 100` is
     `55.00000000000001`), written only when it changes.
2. Section 2, the range slider (two thumbs, `minGap`, the span's stop, the histogram).
   - **Done 2026-10-26.** `RangeSlider.test.ts` (17); the `rangeSlider` box on both library
     pages (a price range with a histogram and a 50 € gap, years with labelled ticks whose thumbs
     may meet, a disabled one), two keyboard scripts, `COMPONENT_USES`; on `aekasha/ui`:
     `createRangeSlider`, `RangeSlider`, `RangeSliderProps`, `RangeValue` (and `SliderTick`, now
     from `SliderTrack.ts`).
   - **Not one module** (D2 had both sliders in `Slider.ts`): the track moved out to
     `forms/SliderTrack.ts` (`@internal`: the rail, fill, ticks, histogram, thumbs with their
     bubbles, the value under the pointer, and `createTrackDrag`, the capture and its end), so
     `Slider.ts` and `RangeSlider.ts` each stay small and a slider brings no range code. The
     slider moved onto it unchanged (its tests and shots as they were); a bubble now shows on its
     thumb's `data-dragging`, so only the moving thumbs' bubbles show.
   - **The span is the track's fill**, moved after the thumbs in the DOM (the tab order: minimum,
     maximum, range) and under them by `z-index`: a 24 px tall target with its bar in its
     `::before`. It's `role="slider"` (an `aria-roledescription` needs a role that takes it): named
     by the label, its value the range's start, its `aria-valuemax` the track's end less the
     width, its text "{start} to {end}". End on it takes the range's end to the track's.
   - **The press decides what moves:** a thumb (its grab offset), the span (both, by the pointer's
     delta, the width kept), else the nearer thumb, which it focuses. **Two thumbs at one value**
     wait for the first move's side (not in D7: otherwise the top thumb at an end could never
     leave it, and the other was unreachable).
   - **The group is `aria-disabled` too** while disabled: axe (and WCAG 1.4.3's exception) treats
     a label's text as an inactive control's only when every control naming it with
     `aria-labelledby` is disabled; the stops alone weren't enough (`verify:ui` failed on the
     disabled label's contrast).
   - **Found by the shots:** the track's tick labels went in its bottom padding with
     `box-sizing: content-box`, which the Hub's unlayered `* { box-sizing: border-box }` beat (an
     app's reset would too); each variant now sets its full height (every part is placed
     absolutely). And a histogram's rail override came before the rail's own rule at the same
     zero specificity, so the bars covered the rail until it moved after it.
   - Not done: copy and paste on the thumbs (D6's, for number parts with text): neither slider's
     thumb has it; the text fields and the spin button do.
   - **`showInputs`** (the user's addition after the review, not in D7: a typed exact value, for
     precision and for a keyboard or screen reader user who'd rather type): a spin button at each
     end of the track ("Minimum {label}" / "Maximum {label}", with `expressionUnits`), each kept
     on its side of the other with the gap. As the slider's spin button, they're then the
     controls: the track is `aria-hidden`, the thumbs and the span no stops, and a press on the
     track leaves the focus and puts typed text back. The box's altitude row shows it (typed in
     metres or `km`), with a third keyboard script; `RangeSlider.test.ts` grew to 23.
   - **`forms/NumberInput.ts`** (`@internal`, for it): the number field's spin button moved out of
     `buildNumberField` (the box, typed text, keys, clipboard), writing through a `NumberTarget`
     (`peek`, `step`, `commit`, `change`, `isInGesture`: a binding, or one end of a range's, which
     `TypedText.ts` now takes too). The number field (and so the slider) is the shell, one of
     these and the label's scrub; its 26 tests as they were. Phase 5's vector, rotation and
     quaternion axes are the next `NumberTarget`s (an axis of an object binding).
   - **`FieldSpec.messageFor`**: the parts the message line describes and an error marks
     `aria-invalid` (default `labelFor`): the range's two spin buttons, or its three stops, where
     only the first was before.
3. Section 3, the radio group and the segmented control.
   - **Done 2026-10-26.** `RadioGroup.test.ts` (13); the `radioGroup` box on both library pages
     (both pieces, as the checkbox box shows the switch: a column with a hint, a row with a
     disabled option, a segmented control filling its width, one of icons alone, a disabled one of
     each), two keyboard scripts, `COMPONENT_USES`; on `aekasha/ui`: `createRadioGroup`,
     `createSegmentedControl`, `RadioGroup`, `RadioGroupProps`, `RadioOption`, `RadioValue`,
     `SegmentedControl`, `SegmentedControlProps`, `SegmentOption`.
   - **One module** (`forms/RadioGroup.ts`, as D2): both are `createChoiceField`, native radios
     sharing a name of their own (`aekRadio<n>`), their `value` the option's index (a value is a
     string, number or boolean, compared with `===`). An option is `{ value, label, disabled? }`
     (the kit's `label`; section 4's select maps Tweakpane's `text` to it), a segment's with `icon`
     and `iconOnly` (its label visually hidden and a tooltip).
   - **No `<fieldset>`** (D7 had one standalone): every field is the shell, so the group is a
     `role="radiogroup"` the label's `<span>` names (`FieldSpec.groupRole`), standalone or in a
     grid; a fieldset is D9's `createFieldset` for a form's section.
   - **The keys are the browser's** (D7): one tab stop at the checked radio, the arrows pick and
     wrap, skipping a disabled one, Space picks. linkedom moves no focus between radios, so only
     `verify:ui`'s scripts check them (they passed first time). KitDom's radio shim: `checked`
     unchecks the group (the same name in the same tree, detached too) and `click()` fires `input`
     and `change` only when it wasn't checked.
   - **The message describes the group**, which an error marks (a radio takes no
     `aria-invalid`), and the handle's `focus` goes where Tab would (the checked radio, else the
     first enabled one).
   - **A disabled group is `aria-disabled` itself, now in the shell** for any `isGroup` field (the
     range slider set it on its own in section 2): `verify:ui` failed the disabled groups' label
     contrast the same way.
   - **The segment's radio lies over it**, transparent (`appearance: none`), so the kit's focus
     ring on the radio is the segment's ring and a click anywhere picks it; the picked segment is
     `:has(:checked)` in the accent (`--aek-segmented-selected-bg` / `-color`).
   - The `@example` check found `toolbar` in the segmented control's example resolving to
     `window.toolbar`: examples name a `settingsPanel`.
4. Section 4, the select field on the drop-down (Tweakpane's two `options` forms).
   - **Done 2026-10-26.** `SelectField.test.ts` (8); the `selectField` box on both library pages
     (the object form with number values, the array form with a hint, a searchable list from a
     getter that a kit button grows, the placeholder, an error, disabled), three keyboard scripts,
     `COMPONENT_USES`; on `aekasha/ui`: `createSelectField`, `SelectField`, `SelectFieldProps`,
     `SelectOption`, `SelectOptions`, `SelectValue`.
   - **`createDropDown` unchanged** (D7): the options go to it by index, so a value may be a
     number or a boolean (`SelectValue` is the radio's), and its `value` getter finds the bound
     value's index. `options` takes Tweakpane's `[{ text, value }]` and `{ [text]: value }` and the
     kit's `{ label, value }` (as the radio's, so a radio and a select take the same list), or a
     getter of any of them, read again on each open and refresh.
   - **`FieldSpec.onRefresh`** (the shell, not in D5): a getter's list can change while the value
     doesn't, which a refresh never drew; it runs with the `hidden` / `disabled` functions on every
     refresh.
   - **The trigger's name** is the label and the value it shows (`aria-labelledby`: "Shadow map,
     1024"), the shell's `isLabelledBy` (a click on the label focuses it); the drop-down's `title`
     is the label, for the open list's name, and the trigger's `title` attribute is removed (no
     native tooltip). While no option has the value it's `data-placeholder`, its text muted (not
     in D7: the placeholder read as a picked value in the first shots).
   - **The drop-down's root isn't in the field's CMP tree** (the shell appends the control's
     element), so the field's `onRemove` removes it, which closes an open list.
   - **Where an open list is:** with the Popover API it stays in the drop-down's DOM, in the field
     (the browser's top layer); without it (linkedom) `showAnchored` moves it to the HUD root. The
     unit tests look in the HUD root, the box's scripts in the box (a window's drop-down is under
     `#hudRoot` either way).

### Phase 4: containers and the declarative grid — done

D9 and D10, and D7's monitor.

- **Verified 2026-10-26** (after section 5): `yarn test` (203 files, 1690 tests), ESLint, `tsc` and
  `tsc -p hub`, `yarn hub:build`, `yarn verify:ui` (every box and script, 188 s; no new shot
  unrecorded), `yarn verify:embed` (both profiles), `yarn sbp --profile all` (every budget within;
  still no field in an app or embed build: the app's `_engine/ui` 5.4 kB initial as Phase 0's,
  20.5 kB lazy (19.8), the `uiKit` profile's 4.3 kB, `uiKitEmbed.js` 17.5 kB), `yarn verify:scenes`
  (104 passed), `yarn verify:baselines` (unchanged after section 5's `--update`; docs 100 %, no
  debug code).

1. Section 1, the monitor (text, multiline, intervals on the tick) and `readonly: true` on every
   field so far.
   - **Done 2026-10-26.** `Monitor.test.ts` (17); the `monitor` box on both library pages (a small
     simulation's values on one scheduler that a kit button steps, a vector, a multiline log,
     every field so far with `readonly: true`, a hint and a disabled one), one keyboard script,
     `COMPONENT_USES`; the dev page's `monitorStress` box (below); on `aekasha/ui`:
     `createMonitor`, `Monitor`, `MonitorProps`, `FieldOptions`, `ReadonlyBindingSource`.
   - **A lone live field shares the page's tick** (Phase 2's open item): a field with an
     `interval` (a monitor always has one) and a bound value (not `{ value }`), given no
     `scheduler`, joins `getPageScheduler()` (`@internal`): made on first use, never disposed,
     one rAF loop for every such field (none: no loop, no listener). Not one scheduler per field:
     200 lone monitors would be 200 loops. Section 3's grid gives its fields its own scheduler
     (a field `add`ed after its creation moves to it then).
   - **`readonly: true`** (`FieldProps`, D5) makes any field a monitor through `buildMonitor`
     (`@internal`, `forms/Monitor.ts`) with the field's own text: the number field and the slider
     their formatter and `unit` (`buildNumberMonitor`), the range "{start} to {end}", the
     checkbox 'On' / 'Off' / 'Mixed' (its `setIndeterminate` still works), the switch its
     `onText` / `offText`, the radio, segmented and select the option's label (the select's
     `placeholder` when none; a getter's list redrawn on each refresh), the text field its text
     (`multiline`, `rows`). A field's edit props do nothing then. The default `interval` is 200,
     Tweakpane's. `createMonitor` infers its text from the value: `format`, a number's decimals
     (`precision`), a boolean's `onText` / `offText`, a vector-like object's axes (`{ x, y }` to
     `{ x, y, z, w }`, compared axis by axis, so one changed in place is read), a string.
   - **`{ get }` alone** (not in D3): a monitor of a getter needs no `set` (the `@example` check
     found `createMonitor({ get })` failing to type-check). `ReadonlyBindingSource<T>` (public) is
     taken by `createMonitor` and, with `readonly: true`, by any field (`FieldProps` is now
     `(BindingSource | ReadonlyBindingSource & { readonly: true }) & FieldOptions`, the latter
     public); a `setValue` on one draws until the next read. The shell takes `AnyFieldProps`
     (`@internal`).
   - **The line names nothing** (D7 had `aria-labelledby` on the `<span>`): a name on a generic
     `<span>` is ARIA 1.2's prohibited attribute (axe's `aria-prohibited-attr`), and a role to
     carry it would be wrong (`status` is a live region, `textbox` a control). The label is a
     `<span>` (`FieldSpec.isTextOnly`) and the value follows it in the reading order. **The
     multiline block is a `<textarea readonly rows>`** (Tweakpane's own), not a `<pre>`: the
     `<label for>` names it, and as a tab stop its scroll is reachable (axe's
     `scrollable-region-focusable` would fail a scrolling `<pre>`). A monitor has no reset
     button (`isMonitor`) and never flashes. A long line wraps (nothing cut off), so a row may
     grow. Disabled, the line and its label are muted, not the disabled colour: neither is a
     control, so WCAG 1.4.3's exception doesn't cover them.
   - **The 200-monitor pass** (D14; the dev page's `monitorStress` box: 200 monitors at
     `interval: 0` in one scheduler, the number stress box's harness shared as
     `createStressDemo`): a Playwright script (the scratchpad's, not committed) profiled both
     boxes in headless Chromium on the dev server, 5 s per scenario. Monitors changing every
     frame, first build: script 21 ms/s (the number fields 41), layout 134, **style recalc 84**
     (the number fields 15), allocation 385 KiB/s (the number fields 742), of which 240 KiB/s is
     the new text itself (`getText`) and the rest the demo's own writes; steady: script 11 ms/s,
     allocation 4.5 KiB/s (the rAF loops'). **Fixed:** the line's text is one `Text` node whose
     `data` is written (`textContent` replaced the node each time): style 84 → 5 ms/s, script
     21 → 15, the frame's tasks 394 → 362 ms/s. **Left:** layout, 160-180 ms/s while all 200
     change every frame (two runs agreed): the text's own layout. `contain: layout` on the line,
     and `contain: inline-size layout` on its value, changed nothing (injected, not kept); size
     containment can't apply to a line that wraps. Of the census's 85 monitors 14 are at `interval: 0`, the
     rest at 250 or 500 ms or the default 200 (6 through a spread), so a real tab writes a small
     share of this. Every frame stayed at
     16.7 ms. The perf-auditor agent didn't read it this time (the profile is the measure; its
     second pass, Phase 6 section 3, can take this box).
2. Section 2, the folder and the fieldset.
   - **Done 2026-10-26.** `Folder.test.ts` (9) and `Fieldset.test.ts` (4); the `folder` box (a
     light's folder with a nested shut one, hidden by a `hidden` function while the light casts no
     shadows, and a kit button that changes the values and refreshes) and the `fieldset` box (two
     sections of a form; "Disable the notifications" a state) on both library pages, two keyboard
     scripts each, `COMPONENT_USES`; on `aekasha/ui`: `createFolder`, `Folder`, `FolderProps`,
     `createFieldset`, `Fieldset`, `FieldsetProps`, `FormChild`.
   - **The folder:** as D9, with `.aekFolder__region` (`role="group"` named by the button) holding
     a `__clip` (the grid row's item, `grid-template-rows` 0fr ↔ 1fr: a padded item can't shrink to
     nothing) holding `__content`. A shut hides the region when its animation ends (a timer of
     200 ms × `getMotionFactor`, at once under reduced motion); the clip's `overflow: hidden` only
     while it moves, so the fields' rings show when open. An open calls
     `revealScheduledBindings(scheduler)`. Shut from code with the focus inside, the button takes
     it (not in D9). `onExpandedChange` hears `setExpanded` too (Tweakpane's `fold` does). A
     `hidden` function joins the scheduler as an entry with `readState` only. `expanded` defaults
     to true, Tweakpane's and the builder's. Its handle adds `content`, `add`, `toggle`,
     `setTitle`, `setHidden`, `refresh`.
   - **The fieldset disables its fields** (not in D9; D14 had a disabled fieldset as a browser
     check): the browser's `disabled` reaches only native controls, not a slider's
     `role="slider"` thumb or a range's span (still tab stops), nor a field's label or
     `data-disabled`. A field's disabled state is now its own or `closest('fieldset[disabled]')`,
     read on each refresh and pushed by the fieldset's `setDisabled` and `add`
     (`readFieldsetDisabled`, `@internal`, over every `.aekField` under it, nested fieldsets
     included); a field's own `disabled` stays when the fieldset is enabled again. Section 5's form
     can disable a section, or itself, the same way.
   - **`FormChild`** (public): what a folder, a fieldset and the grid hold, a kit piece's handle
     (`{ cmp }`) or a CMP; `children` at creation and `add(...)` after.
   - **Found by the shots:** the folder's `[hidden]` rule came before the region's `display: grid`
     at the same zero specificity, so a shut folder's fields showed (axe and the keyboard scripts
     passed). The rule is last in `Folder.scss` now, and the kit's `CLAUDE.md` says why.
   - **Not done:** Phase 2 section 4's idea of the folder marking its fields when it shuts, so the
     tick's `isShown` needn't walk the DOM (`closest('[hidden]')`, about 3 ms/s for 200 fields at
     `interval: 0`). Left for the grid (section 3), which knows its folders and fields; the walk
     stays correct meanwhile.
3. Section 3, the property grid: the label column and its separator, the scheduler it owns or
   shares, `refresh()`, `add()`.
   - **Done 2026-10-26.** `PropertyGrid.test.ts` (8); the `propertyGrid` box on both library
     pages (a scene's settings: a text, a slider, a checkbox, a select, a long label cut, a folder
     in a folder, a monitor; the column's width in the status line; a kit button that changes
     values and refreshes), two keyboard scripts, `COMPONENT_USES`; on `aekasha/ui`:
     `createPropertyGrid`, `PropertyGrid`, `PropertyGridProps`.
   - **The columns are CSS subgrids** (not in D9): the content is a two-column grid, and every
     field, the folder's four levels and the fieldset's two pass the columns down
     (`grid-template-columns: subgrid`, `column-gap: normal`), so the controls line up at every
     depth while a folder's indent narrows only its labels' column. Subgrid: Chrome 117, Safari
     16, Firefox 71. The grid's rules are
     `.aekPropertyGrid :where(…)` (one class of specificity, still layered): they re-lay the
     fields' and folders' own zero-specificity layouts, whose stylesheets load in any order.
   - **The separator is the columns' 24 px gap** (D9 named no size): WCAG 2.5.8's target, over
     no control, so it steals no click from a label's reset button or an input's edge; at rest
     it draws nothing, a line under the pointer or the focus, the accent while dragged. Keys:
     ArrowLeft / ArrowRight ±1 % with D6's Shift / Alt, Home / End to 20 / 80 %.
     `onLabelWidthChange` reports a gesture's end (the release, a key's keyup), not each move.
     `resizable: false` leaves it out.
   - **A field joins the scheduler of the container it's added to** (D4's "it gets the scheduler
     of the property grid or form it's in"): `adoptFormScheduler` gives the grid's (or a folder's,
     own or adopted) to every field and folder added without one, nested ones included, moving a
     live field off the page's tick; one given its own `scheduler` keeps it. A folder added to a
     grid passes the grid's on to what it adds later.
   - **`refresh()` is its scheduler's**: with a shared one it reads every host's fields (a tab's
     sections together, as today's tab refresh does). A grid has no `setVisible`: its
     `scheduler` handle has it.
   - Not done: the `isShown` cache (Phase 2 section 4's idea, section 2's note): the grid adopts
     fields but doesn't track which folder hides each, and the walk is correct; the perf-auditor's
     second pass (Phase 6) can weigh it against the 3 ms/s measured.
4. Section 4, the declarative items (`items`, kind inference, D10's names, folder ids and
   `onFolderExpandedChange`, `custom`, buttons and separators) and the "Tweakpane parity" box (dev
   page) from Phase 0's census, so far as the fields exist.
   - **Done 2026-10-26.** `PropertyGridItems.test.ts` (9); the "Tweakpane parity" box
     (`propertyGridParity`, dev page only, so not in `verify:ui`: checked by a screenshot from the
     dev server, no warning in its console) with a row per census row whose field exists, each
     hinted with its source line, and its text listing Phase 5's rows (the vector, the four
     colours, the rotation); on `aekasha/ui`: `addPropertyGridItems` and the item types
     (`PropertyGridItem`, `PropertyGridFieldItem`, `PropertyGridFolderItem`,
     `PropertyGridButtonItem`, `PropertyGridSeparatorItem`, `PropertyGridCustomItem`,
     `PropertyGridFieldKind`, `PropertyGridItemsOptions`).
   - **`addPropertyGridItems(grid, items, options)`, not a grid prop** (D9 and D10 had `items` on
     `createPropertyGrid`): inference may make any field, so the items' module imports every field
     creator; on the grid, every grid (an app's settings menu of handles) would carry them all
     (Smallest Build Possible). Its own module, `PropertyGridItems.ts` (D2's "if large"). The
     folders' open states are its options: `folderExpanded` (by id, over an item's `expanded`),
     `onFolderExpandedChange(id, expanded)` and `path` (a titled section's title, the ids' start).
   - **The field item:** `type?: 'field'` (the debugger's `'binding'`), the binding (`{ get }`
     alone too), the fields' props in Tweakpane's names, `kind` (D10's list as far as the fields
     exist, plus `range` and `search`, which `type` couldn't name). `format`, `onChange`,
     `onCreate`, `onInput` and `onSearch` are method signatures, so a handler typed with its value
     (`(value: number) => …`) type-checks against `unknown`. Inference as D10; a value no field
     edits yet (a vector, a colour, a rotation) is a monitor with a warning unless `readonly`,
     until Phase 5 (D10's colour-string inference waits for the colour field: a `'#rrggbb'`
     string is a text field until then).
   - **The folder item's children are `items`** (D10; the debugger's `content`); its id is `id`,
     else the title path, the children's path the title path (the builder's rule).
   - **The button item** is the kit's button, `variant` default `secondary`; with `label` a row
     whose label sits in the label column and the button in the control column, named by both
     (`aria-labelledby`); without, it spans both. **The separator** is the kit's divider in a row;
     **`custom`** gets the row's CMP. Their `hidden` / `disabled` functions and the custom
     refresh join the grid's scheduler, and leave it with their row (a shared one keeps nothing).
5. Section 5, the form (validation, the error summary, submit and reset).
   - **Done 2026-10-26.** `Form.test.ts` (13); the `form` box on both library pages (a new player's
     form in two fieldsets: a required name with a length check, a required region, an age of 13
     or more, the rules to accept; its submit a 400 ms promise; "Submit it empty" and "Fill it in"
     states), four keyboard scripts, `COMPONENT_USES`; on `aekasha/ui`: `createForm`, `Form`,
     `FormProps`.
   - **`required` and `validate` are field props** (`FieldOptions`; D9 said "per field"), so a
     grid item takes them too. The shell only stores them and marks `required` (an `aria-hidden`
     `*` in the label; `required` on an `<input>` / `<textarea>` part, `aria-required` where the
     part's role takes it: a radio group's, not a select's trigger button, which has the mark
     alone). The checks are `Form.ts`', reading each field through a `FormFieldEntry` the shell
     registers by element (`getFormField`, `@internal`), so a field outside a form carries no
     validation code. `required` is `true` ("{label} is required") or the error's text; empty is
     `''` or spaces, `false`, `null`, `undefined`, `NaN`.
   - **A third error slot:** the form's errors go to the field's form error, under its own (a
     typed expression's) and the app's `setError`. A field showing any of the three is invalid,
     so an expression that doesn't parse blocks a submit, and an app's server answer
     (`setError`, then `validate()`) shows in the summary.
   - **The summary** (GOV.UK): first in the form, `role="group"` named by its title ('There is a
     problem', `summaryTitle`), `tabindex="-1"`, a link per error whose text is the error and
     whose `href` is the control's id (a group's control now gets the control id when it has
     none). A link's click is prevented (no hash in an app's URL), opens the shut folders around
     the field (`setFormRevealer` / `revealFormChild`, `@internal`: the folder registers its open),
     focuses it and scrolls it into view. A shut folder's field is checked; a hidden or disabled
     one isn't (as the browser skips a disabled control).
   - **The blur check** (from the first submit or `validate()`, until a reset): a bubble
     `focusout` on the form, after the field's own `blur` wrote its typed text, unless the focus
     stayed in the field. It updates the field's link or removes it (hiding the summary with the
     last), but never adds one: the summary is the last submit's. Not on each change (a checkbox
     ticked keeps its error until the focus leaves), as D9 has it.
   - **Not in D9:** `submitLabel` / `resetLabel` make the buttons (a primary `type="submit"`, a
     `type="reset"`; the app may add its own); an `onSubmit` promise makes the form busy
     (`aria-busy`, the submit button loading, a submit meanwhile ignored: p355's save); the body is
     a `fieldset` with `role="none"`, so `disabled` / `setDisabled` disables every field and button
     as the fieldset does; the form owns a scheduler (D4) or shares one, and **a property grid added
     to a form keeps its own** (`adoptFormScheduler` skips what a grid at or under the added root
     holds), so `grid.refresh()` still reads its fields.
   - **Not done:** a form-level error (a failed save not tied to a field): a toast, or a field's
     `setError` and `validate()`, until p355 or p808 needs one.

### Phase 5: value editors I — done

D8's colour, vector, rotation and quaternion.

- **Verified 2026-10-26** (after section 4): `yarn test` (209 files, 1760 tests), ESLint, `tsc` and
  `tsc -p hub`, `yarn hub:build` (API 100 % documented), `yarn verify:ui` (every box and script,
  215 s), `yarn verify:embed` (both profiles), `yarn sbp --profile all` (all 21 budgets within;
  still no field in an app or embed build: the app's `_engine/ui` 5.5 kB initial, 21.0 kB lazy;
  the `uiKit` profile's 4.5 kB and 18.2 kB), `yarn verify:scenes` (104 passed),
  `yarn verify:baselines` (each section's `--update`: the new names; docs 100 %, no debug code).
- **New dependency:** `vanilla-colorful` 0.7.2 (section 2), its picker a lazy chunk of 2.7 kB gzip.
- **For Phase 6:** the angle dial takes `RotationField.ts`' `getAnglePart` and `ANGLE_UNITS`; the
  2D pad's "vector field shown next to it" is `createVectorField` (or `buildPartsField`); KitDom
  and `verify:ui` follow open shadow roots now. The picker's budget line waits for Phase 7
  section 3 (section 2's note), and the perf-auditor's second pass (Phase 6 section 3) can take
  the vector's and the colour field's draws with the others.

1. Section 1, `ColorValue.ts` (the forms, the spaces, parse and format) and the colour field
   without the picker (swatch, text, alpha, intensity, recent, palette, the EyeDropper).
   - **Done 2026-10-26.** `ColorValue.test.ts` (10) and `ColorField.test.ts` (18), and a colour
     inference test in `PropertyGridItems.test.ts`; the `colorField` box on both library pages (a
     number with a palette and "The fog’s panel open" state, a hex string with alpha, a linear
     object with an intensity and a kit button changing both from outside, an error, disabled),
     three keyboard scripts, `COMPONENT_USES`; the parity box's four colour rows; on
     `aekasha/ui`: `createColorField`, `ColorField`, `ColorFieldProps`, `ColorIntensityProps`,
     `ColorFieldValue`, `getRecentColors`, `setRecentColors`, `onRecentColorsChange`.
   - **`forms/color/RecentColors.ts`** (not in D2's table): the page's list (newest first, at most
     8, hex), in memory; `setRecentColors` (an owner's restore, calling no listener) and
     `onRecentColorsChange` (the owner's save) are D8's "an owner may persist them".
   - **No `format: 'float'`** (D8, D10's table): the value's form is its type (a number, a string,
     an object, read at creation), and an object is always 0-1 floats (no census row has 0-255
     objects), so Tweakpane's `color: { type: 'float' }` is dropped in the port, not renamed; an
     item's `format` stays the text function it is for every other field.
   - **`intensity` is one prop** (D8 had `intensity: true` with `intensityBind`):
     `ColorIntensityProps`, a `BindingSource<number>` with `NumberRules`, `label` (default
     'Intensity'), `unit` and its own `onChange`. Its binding is read with the field's through
     the shell's new `FieldSpec.onRead(fromRefresh)` (every read: a refresh's, the tick's, a
     show's), flashing its own box on a refresh. The reset button resets the colour only.
   - **Not a group:** the `<label for>` names the text input; the swatch is "Pick {label}", the
     alpha "{label} alpha", the intensity "{label} {its label}", each part's name shown before
     its box (`aria-hidden`, held in the input's name: WCAG 2.5.3). An error marks every input.
   - **Alpha:** a spin button 0-1 on a `NumberTarget` over the colour's binding (`withAlpha`
     leaves the colour channels as they are: a linear value's round trip through sRGB isn't
     exact, and an HDR channel over 1 stays). Shown for a string or an object with `alpha: true`,
     and for a string bound with alpha digits; never for a number (a warning with `alpha`). A
     typed 6-digit hex in an alpha field writes it opaque (the text shows the alpha digits).
   - **The panel** (the popover the swatch opens, built on each open; the picker's place in
     section 2): 'Palette' and 'Recent' groups of swatch buttons named by their hex (a tooltip
     each, `aria-current` on the value's), the eyedropper button where `EyeDropper` exists (it
     keeps the alpha, and re-checks the field after its `await`), else a line saying what to
     type. A swatch writes once and the panel stays open (the picker beside it in section 2).
     Each swatch is a tab stop (no roving focus: at most 8 recent and the app's palette).
   - **Recent colours** are added on a user's `last: true` change (a reset too), not a step.
   - **The text** accepts no colour names (a 1.3 KiB table), and 3-digit hex only with `#` or
     `0x` (`100` reads as numbers, an error, not `#110000`); `live` isn't offered (`#3fd` is a
     whole colour, so each keystroke would write a different one).
2. Section 2, the picker: Phase 0's library in `ColorPicker.ts`, loaded on the first open in the
   popover; its budget line measured and set.
   - **Done 2026-10-26.** `vanilla-colorful` 0.7.2 in `package.json` (pinned; the readme's
     credits); `ColorPicker.test.ts` (3, its own file so the picker isn't loaded at its start) and
     7 picker tests in `ColorField.test.ts`; the `colorField` box's keyboard script goes into the
     picker (its plane takes the focus at the open, ArrowRight steps it) and a "The tint’s panel
     open" state shows the alpha slider. Nothing new on `aekasha/ui`.
   - **The picker is the panel's top** (`.aekColorPanel__picker`), the panel a fixed width of
     eight swatches. On the first open its place is kept (`data-loading`, its height) while the
     library loads; then it's attached and **its plane takes the focus**, unless the user moved
     the focus meanwhile. Later opens show it at once with the focus on the plane. A failed load
     warns, removes the place and is tried again on the next open; the text and the swatches work
     without it (D8's fallback).
   - **The gesture's end is the wrapper's:** the library fires only `color-changed`, so a primary
     press on it listens for the release on the document (anywhere, as the library's own drag),
     and a key it used (it prevents it) is stopped at the host and its keyup commits. D3's order
     holds: each move `last: false`, the release or keyup `last: true`. Escape mid-drag closes the
     panel and commits the value reached; a removed field commits nothing.
   - **Its own writes aren't drawn back** (`isPickerWriting`): it rounds to whole units, and a grey
     or black has no hue, so drawing the written value back would move the pointer and send the
     hue slider to red at the plane's edge. A value from outside is drawn with the picker's hue and
     saturation kept where the colour has none (`rgbaToHsva(color, previous)`).
   - **Styles:** `ColorField.scss`' `::part` rules (a rule outside a shadow root beats the root's
     own, whatever the layer or specificity, as D8 found): the kit's radii, 24 px sliders, the
     kit's ring on each part's `:focus-visible`, 20 px pointers. The pointers keep the library's
     white ring and shadow: they sit on the colours, and a surface-coloured ring (tried first) was
     lost on the plane's dark half in the dark theme.
   - **The size:** the library is a chunk of its own in the Hub's build, **2.7 kB gzip** (6.3 kB
     raw, `hsva-*.js`), D8's "about 3 KiB". **The budget line waits for Phase 7 section 3:** no app
     or embed build has a colour field yet, so `yarn sbp` has no chunk to budget; the `uiKit`
     profile's form brings one, and its line (3 KiB, `assets/hsva.js` or the key that build
     gives it) is set from that report.
   - **Two tools learned shadow roots:** `verify:ui`'s focus reads (`expectFocus`, the outline
     check) follow an open shadow root's `activeElement`, so a script names a part
     (`[part="saturation"]`); KitDom's events cross an open shadow root to its host (composed
     ones, retargeted), `document.activeElement` is the host and the root's own the element, and
     the global `CustomEvent` is linkedom's (the library's events).
   - **Not done:** VoiceOver by hand (Phase 0 step 4 left it for this section; it needs a person
     at the Mac); axe passes on both panel states in all four settings.
3. Section 3, the vector field (axes, the link lock, per-axis props).
   - **Done 2026-10-26.** `VectorField.test.ts` (13) and the vector inference in
     `PropertyGridItems.test.ts`; the `vectorField` box on both library pages (a position with a
     kit button moving it from outside, a linked scale, a size as an array with named axes and a
     unit, four axes, an error and disabled), three keyboard scripts, `COMPONENT_USES`; the parity
     box's vector row (`_dbg__DebugTools.ts:549`); on `aekasha/ui`: `createVectorField`,
     `VectorField`, `VectorFieldProps`, `VectorAxisProps`, `VectorAxisName`, `VectorValue`.
   - **Each axis is a `NumberInput` on a `NumberTarget` over its key** (Phase 3's plan held): a
     write copies the value with the axis set, so D3's order and the gesture's first `prev` are
     the binding's. `createObjectValueKind(keys, create?)` makes an array's copies arrays, so an
     array is written in place as an object is.
   - **`axes`** (D8) carries an axis' own rules and its `label` too (the letter shown and the
     spin button's name: `W` and `H` for a size); an array's axes are named `x` to `w` by place.
   - **The link** is `linkable` (the toggle shown), `linked` (its start) and `onLinkedChange`
     (the owner saves it), with `isLinked` / `setLinked` on the handle. The other axes are
     scaled by the changed axis' factor, or moved by its change when it was 0 (D8), each kept to
     its own rules.
   - **The clipboard is the whole vector** (D6): `NumberInput` got a `clipboard` hook (the field's
     text for a copy, a whole-value paste before the part's own number paste). A pasted single
     number still sets the axis.
   - **The letters' colours** are the danger, success and info colours and the muted text
     (`--aek-vector-x-color` to `-w-color`): no axis tokens exist, and the status colours already
     pass 4.5 as text on every surface. The letter says the axis; the colour is a hint (D8).
   - **The inference** (D10): an `{ x, y, … }` object (consecutive axes from `x`:
     `getVectorKeys`, now shared from `Monitor.ts`, as `readFirstValue`) without a string `order`
     (an Euler stays a monitor with a warning until section 4), or an array of 2 to 4 numbers.
   - **Not done:** a scrub on an axis' letter (D6 has it on a number's label; the keys and typing
     are an axis' paths). Phase 6's perf-auditor pass can take the vector with the others.
4. Section 4, `RotationMath.ts`, the rotation and quaternion fields; the parity box completed.
   - **Done 2026-10-26.** `RotationMath.test.ts` (4: every order against three's `setFromEuler`,
     `setFromQuaternion` and `setFromAxisAngle`) and `RotationField.test.ts` (12, both fields);
     the `rotationField` box on both library pages (both fields, as the checkbox box shows the
     switch: an Euler with `step: Math.PI / 8` and its order, a quaternion as Euler angles with
     its raw line and a button turning it from outside, one as axis-angle, a disabled rotation),
     three keyboard scripts, `COMPONENT_USES`; the parity box's rotation row, so **every census
     row has its field**; on `aekasha/ui`: `createRotationField`, `RotationField`,
     `RotationFieldProps`, `EulerValue`, `createQuaternionField`, `QuaternionField`,
     `QuaternionFieldProps`, `QuaternionValue`, `EulerOrder`.
   - **`buildPartsField`** (`@internal`, in `VectorField.ts`): the vector field's row of parts
     pulled out, with `readPart` / `writePart` / `writeAll` per field; the vector (its link in its
     `writePart`), the rotation and the quaternion are it, and share `VectorField.scss`.
   - **The rotation field:** the value's keys are `x`, `y`, `z` and its `order` when it has one,
     so a `THREE.Euler` is written in place with its order. Each angle part (`getAnglePart`,
     which the angle dial takes next) is degrees on `[-180, 180)` with `wrap` (so a typed 180°
     writes -180°, the same angle; not special-cased), the radian `step` shown in degrees
     (rounded to 10 decimals: `Math.PI / 8` is 22.5°, not 22.499999999999996), unit `°`, and
     `ANGLE_UNITS` (`deg`, `°`, `rad`, `turn`). `showOrder` is a drop-down part named "Order"
     and its value; a pick keeps the angles (three reads them in the new order).
   - **The quaternion field:** the "user's own Euler" rule (D8: "while a part has focus") is
     kept by value, not focus: the parts' numbers stay while the bound quaternion is the one
     they made (or were derived from), and are derived again (from the unit quaternion, three's
     conventions) only when it differs. So typed angles past 90° on the middle axis, or an
     axis-angle's axis as typed, stay through refreshes, focused or not; a change from outside
     shows derived. A write composes the numbers into a unit quaternion (normalised on write). The
     axis-angle axis is -1 to 1 by 0.01, its no-rotation axis kept (else +X).
   - **`showRaw`** is a line of text under the parts (`x 0.000, y 0.383, …`, `.aekQuaternionField__raw`),
     not a monitor field of its own: it's read with the group.
   - **Found by the shots:** the axis-angle row's four parts squeezed the angle's box to nothing,
     and a fix on the parts' width overlapped the Euler's parts with the order select. A rotation's
     or quaternion's box keeps 4em and a part its content's width (`min-width: auto`), so the row
     wraps a part that doesn't fit (the angle in the default density; all four fit compact).

### Phase 6: value editors II

D8's angle dial, 2D pad, gradient editor and curve editor (D1: if the plan runs long, the last
two leave it here).

1. Section 1, the angle dial and the 2D pad.
2. Section 2, the gradient editor and `evaluate`.
3. Section 3, the curve editor, `evaluateCurve` and its presets; the perf-auditor's second pass
   (the slider's drag, the pad, the editors' drags).

### Phase 7: the Hub, the example, `CLAUDE.md`, readme

D15 and D12's budgets.

1. Section 1, `features/ui-kit/forms/`: every piece's section with `::: demo`, the drop-down moved
   there, the `aek:covers`.
2. Section 2, the binding guide and "Coming from Tweakpane".
3. Section 3, the example's panel and form (as the user decided), its walkthrough; the `uiKit`
   profile's form and the budgets in `sbp.config.ts`.
4. Section 4, the `CLAUDE.md` files, `readme.md`, `layoutRules.ts`' note; `yarn hub:build` in both
   modes, `verify:ui` against the public build.

### Phase 8: versions and done

D16; the changelog entry with the restyle note; `yarn checkVersions --against main`; mark the plan
done (the references: p800's Blocks line and §5 entry, p806's and p808's when written, p355,
p426); time for the PR: `p804-forms-and-bindings` → `main` (p800 §6).

---

## 4. For p806

Filled by Phase 0's census and the later phases: what the port needs that isn't a rename. The
declarative sections (26, with their 280 bindings and the helper-built items) port by D10's
table; these don't:

- **The imperative panes** (7 `new Pane` in 6 files; 53 bindings, 40 with a `.on('change')`
  handler: 37 live, 3 acting on `last` only): `_dbg__LightGUI.ts` (two panes: a light's readout and its editor; 32
  bindings, 2 folders, 3 buttons), `_dbg__CameraGUI.ts` (8 bindings, a folder, 2 buttons),
  `_dbg__Character.ts`' window (position and rotation, 5 buttons, a separator),
  `_dbg__PhysicsAPI.ts` (the entity window's position and rotation, 5 buttons, 2 separators; the
  wireframe folder's visibility, note and per-state colours with their reset buttons),
  `_dbg__PostFX.ts` (the enabled toggle and one binding per pass param, its params built by
  `getParamBindingParams`) and `_dbg__ECS.ts` (3 bindings, the storage folder, 2 buttons). Each
  becomes a property grid of D10's items, `.on('change')` an `onChange`.
- **Their folders' open states** are module-owned (`.on('fold')` writing `_lensSettingsOpen`,
  `_shadowFolderOpen`, `_shadowCameraFolderOpen`, `entityWireframeFolderExpanded`): a folder
  item's `onExpandedChange`, or ids under the grid's `folderExpanded`.
- **The two `view: 'list'` blades** (`_dbg__LightGUI.ts`' shadow map width and height, `value`
  and `.on('change')`): unbound selects (`kind: 'select'`, `value`).
- **The `custom` item** (`_dbg__DayNightFolder.ts`' `buildSpeedButtons`): raw `<button>`s with
  Tweakpane's own class `tp-btnv_b` in a separator blade's element, styled by
  `DebuggerGUI.module.scss`' `.debuggerSkyTransportRow` (the one Tweakpane class outside
  Tweakpane): a row of kit buttons in `custom`'s CMP container, and the rule goes.
- **The Euler bindings** (the character's and the physics entity's rotation, imperative,
  `step: Math.PI / 8`): rotation fields, shown in degrees where Tweakpane showed radians (a
  visible change, D10's inference).
- **One-level state paths** (46 rows: `_dbg__DebugTools.ts`' `'helpers.showGrid'` and the like,
  `_dbg__RayTester.ts`' `'aim.dir'`): p806's mapping of a tab's `state` key to `{ target, key }`
  (D3) resolves the path to its parent object, as the builder does today, and persists the
  top-level key.
- **Wrappers that rewrite items** (`_dbg__RayTester.ts`' `persistOnCommit`, spreading each item
  with a wrapped `onChange`; the material editor's definition tables, `SettingDef` and
  `MaterialParamDef` with `kind: 'COLOR' | 'NUMBER' | 'BOOLEAN' | 'OPTIONS' | 'SIDE'`, spread into
  items): they keep working on plain data; their `view: 'color'` spreads become `kind: 'color'`.
- **A pane section is a property grid with its items** (Phase 4 section 4):
  `createPropertyGrid({ scheduler: the tab's, labelWidth, onLabelWidthChange })` and
  `addPropertyGridItems(grid, section.content, { folderExpanded, onFolderExpandedChange, path })`
  (the titled section's title as `path`, or the section a folder item of its own). The renames: a
  binding's `type: 'binding'` → `'field'` (or none), a folder's `content` → `items`, its
  `persistExpanded` → the owner's `onFolderExpandedChange` (it saves the ids it persists),
  `view: 'list'` blades → `{ kind: 'select', value, options }`. A field item's `onChange` gets
  `{ prev, last, source, field }` in place of `{ prev, last, api }`.
- **A handler that refreshes its own pane** (`_dbg__RayTester.ts`' `refreshPane`, the builder's
  `refresh()` from inside an `onChange`): the grid's `refresh()`, which never fires `onChange`
  (D3), so it can't loop.

---

## 5. Risks

- **The event model is what p806's port and undo stand on.** D3 keeps Tweakpane's (every write
  with `last`), Phase 0 records today's order in the browser, and `Binding.test.ts` pins it before
  any other field is built.
- **Monitor cost** (p800 §8): one rAF per visible host, no allocation, DOM writes on change only,
  and the perf-auditor's two passes with 200 monitors.
- **The colour picker library:** its shadow root may resist the tokens, and its maintenance may
  lapse. Phase 0's study, the wrapper (one module to swap), and the field working without it
  (text input, swatches) if a pick fails late.
- **Scope:** the plan holds 20-odd components. The phases are ordered so the debugger's needs
  (Phases 2-5) come before the editors no Tweakpane panel has (Phase 6), and D1 says what leaves
  if it runs long.
- **normalize's layer** changes how the full page's buttons and controls look where an app relied
  on normalize beating the kit: D16's changelog note, and the scene runner's screenshots in
  Phase 1.
- **Two ways to draw a hint on a button** until 6.0.0 (the handle and the deprecated string):
  the string's lazy path is tested, and p622 removes it.

---

## Done when

- `ui/forms/` holds the binding, the scheduler and every field, value editor and container of
  D7-D9 (or D1's moves are written in p800), each with tests, demos, keyboard scripts and its Hub
  section, and `yarn verify:ui` passes with no allowed violations.
- D3's event order is pinned by tests and matches today's builder where p806 relies on it;
  the scheduler passed the perf-auditor's review with 200 monitors.
- A property grid built from D10's items renders every row of Phase 0's census (the parity box),
  and §4 lists what p806 rewrites by hand.
- The colour picker is picked and wrapped, loaded on first open, with its budget line.
- `docs/issues/ui-kit-review-items.md` is closed, and the button carries no Kbd code unless it
  shows a hint.
- The Hub's forms page, binding guide and library boxes are live, the example's panel and form
  work, and `yarn hub:build` passes in both modes.
- Engine minor and app minor, the changelog's restyle note, `yarn checkVersions --against main`.
