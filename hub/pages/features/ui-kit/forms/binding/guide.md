## The three bindings

A field binds its value in one of three ways, given in its props
([`BindingSource`](api:BindingSource)):

| Binding           | Reads                 | Writes                                   | For                                               |
| ----------------- | --------------------- | ---------------------------------------- | ------------------------------------------------- |
| `{ target, key }` | `target[key]`         | `target[key]`, an object in place        | Your settings object, a mesh, a light, a material |
| `{ get, set }`    | `get()`               | `set(value)`, with a copy it may keep    | A setter with side effects, a store, a component  |
| `{ value }`       | the field's own value | the field's own value: read `getValue()` | A form's fields, a dialog's choices               |

```ts
// target and key: a THREE.Vector3 is written in place, never replaced
createVectorField({ label: 'Position', target: mesh, key: 'position', step: 0.1 });

// get and set: through your own functions
createSwitch({ label: 'V-sync', get: () => renderer.vsync, set: (on) => setVsync(on) });

// value: held by the field
const name = createTextField({ label: 'Name', value: '' });
const create = () => createPlayer(name.getValue());
```

- **Objects are written in place**, component by component: a `THREE.Vector3`, a
  `THREE.Color` or a `THREE.Euler` bound with `{ target, key }` stays the same instance, so
  whatever holds it sees the change. A primitive is assigned (`target[key] = value`).
- **`key` is one property** of `target`, not a path: bind `{ target: light.shadow, key: 'bias' }`.
- **`{ get }` alone** is a read-only binding, for a monitor or a field with `readonly: true`.
- **A read allocates nothing:** the field keeps its own copy and compares the value with it
  (an object component by component), so reading a vector every frame costs no garbage.

## The writes and their order

`onChange(value, { prev, last, source, field })` ([`FieldChange`](api:FieldChange)) hears every
write of the value, right after it's written, so the handler reads the new value wherever it
looks. A gesture (a drag, a held key) is several writes with `last: false`, then one with
`last: true` when it ends:

| What happens                                | `onChange`                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| A drag: a slider, a scrubbed label, a dial  | Each move that changes the value: `last: false`; the release: `last: true`            |
| A press on a track, released without moving | The press's write (when it moved the thumb): `last: false`; the release: `last: true` |
| A held key: an arrow, PageUp                | Each keydown and repeat: `last: false`; the keyup: `last: true`                       |
| A click, a pick, a swatch                   | One write: `last: true`                                                               |
| Typed text, then Enter or a blur            | One write: `last: true` (with `live`, each keystroke `last: false` before it)         |
| The reset button, or `reset()`              | One write: `last: true`                                                               |
| Your `setValue(value)`                      | One write: `last: true`, `source: 'api'`                                              |
| Your `setValue(value, { silent: true })`    | None                                                                                  |
| A refresh that reads a changed value        | None                                                                                  |

- **`prev`** is the value before this write, and on `last: true` the value before the whole
  gesture: one call has the whole change.
- **`last: true` may carry no change:** a press on a slider's thumb, released where it was, ends
  its gesture with `prev` equal to `value`. Compare them before recording anything.
- **`value` and `prev` are copies:** keep them. A write equal to the value calls nothing, but a
  gesture's end always calls once.
- **`source`** is `'user'` for the user's input (a reset included) and `'api'` for `setValue`.
- **A refresh never calls `onChange`,** so a handler that refreshes its panel can't loop.
- **Typed text** isn't a value until it's written: `onInput(text)` (on the text, number and
  colour fields) hears each keystroke before that, for a search as you type or a preview.

So a handler applies a live change on every write and does what's done once, saving or
recording an undo, on `last`:

```ts
const speed = createSlider({
  label: 'Speed',
  target: settings,
  key: 'speed',
  min: 0,
  max: 10,
  onChange: (value, { prev, last }) => {
    spinner.setSpeed(value); // every step: the scene follows the drag
    if (last && value !== prev) {
      saveSettings();
      undoStack.push({ prev, next: value });
    }
  },
});

// The undo writes silently (no onChange: no new entry), then applies the value
const undoSpeed = ({ prev }: { prev: number }) => {
  speed.setValue(prev, { silent: true });
  spinner.setSpeed(prev);
};
```

## Refresh and the scheduler

When your code changes a bound value (a save loaded, an undo, the simulation), the field shows
the old one until it reads again. `refresh()` reads it: the field's own, or its scheduler's. An
edit field whose value changed flashes once (a static tint under reduced motion), so the user
sees what moved; `refresh()` also re-reads every `hidden` and `disabled` function.

A [scheduler](api:createBindingScheduler) is one per host (a window, a panel, a menu): one
`refresh()` reads every field of it. Make one and pass it as `scheduler`, or let a container do
it: a [property grid](hub:features/ui-kit/forms#property-grids) and a
[form](hub:features/ui-kit/forms#forms) have their own, and give it, as a
[folder](hub:features/ui-kit/forms#folders-and-fieldsets) passes on its own, to every field added
without one.

```ts
const scheduler = createBindingScheduler({ visible: false });
const grid = createPropertyGrid({
  scheduler, // shared: the grid uses it, and you dispose of it
  children: [
    createSlider({ label: 'Gravity', target: world, key: 'gravity', min: -30, max: 0 }),
    createMonitor({ label: 'Bodies', get: () => world.bodyCount }),
  ],
});
tuningPanel.add(grid.cmp);

// Your panel says when it shows: the live fields are read only then
const onPanelShown = () => {
  scheduler.setVisible(true);
  scheduler.refresh(); // what changed while it was away
};
const onPanelHidden = () => scheduler.setVisible(false);
const onPanelRemoved = () => scheduler.dispose();
```

- **The tick** reads the live fields: [monitors](#monitors), and an edit field with an `interval`
  that follows a value changing on its own. It's one `requestAnimationFrame` loop per scheduler,
  running only while the host shows (`setVisible`), the page isn't hidden and a live field
  exists; each field is read at its own `interval` (in ms, 0 every frame), against the frame's
  time.
- **A field that doesn't show isn't read:** one hidden, or in a shut folder, is read once when it
  shows again, without a flash.
- **Without a scheduler** an edit field is read by its own `refresh()` only, and a live field
  joins one tick the page's live fields share.
- A property grid or a form disposes of the scheduler it made when it's removed; one you made
  and passed is yours to dispose of.

## Monitors

A [monitor](hub:features/ui-kit/forms#monitors) shows a value as text, read on the tick every
`interval` ms (200 by default). Any field with `readonly: true` is a monitor in that field's own
text: a number's decimals and unit, an option's label, a checkbox's "On" or "Off".

```ts
createMonitor({ label: 'Frame time', get: () => stats.frameMs, unit: 'ms', precision: 1 });
createMonitor({ label: 'Grounded', get: () => player.isGrounded, onText: 'Yes', offText: 'No' });
createSelectField({
  label: 'Quality',
  target: settings,
  key: 'quality',
  options: { Low: 'low', High: 'high' },
  readonly: true, // the option's label: "High"
});
```

- **A read that finds the value unchanged writes nothing,** and the text is made only when it
  changed. `get` is called on every read, so keep it cheap: return a value you have, don't build
  one.
- **A monitor never flashes and never calls `onChange`:** its reads are refreshes.
- **It isn't a live region:** a value that changes every frame would drown a screen reader. A
  value worth announcing is your own `aria-live` text.

## Panels as data

[`addPropertyGridItems`](api:addPropertyGridItems) adds a panel described as data to a
[property grid](hub:features/ui-kit/forms#property-grids): the shape of a settings table, a
generated inspector or a tool's options, written once. An item
([`PropertyGridItem`](api:PropertyGridItem)) is one of:

| Item          | Shape                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| A field       | A binding, a `label` and the field's props; `kind` when the value can't say (below) |
| A folder      | `{ type: 'folder', title, items, expanded?, id?, hidden? }`                         |
| A button      | `{ type: 'button', title, onClick, label?, variant?, hidden?, disabled? }`          |
| A separator   | `{ type: 'separator', hidden? }`                                                    |
| A custom item | `{ type: 'custom', build(container) }`: anything else, in a CMP across both columns |

**Without `kind`, the field is inferred from the value at creation**:

| The value                                        | The field                                           |
| ------------------------------------------------ | --------------------------------------------------- |
| Any, with `options`                              | A select                                            |
| A number                                         | A number field; with both `min` and `max`, a slider |
| A boolean                                        | A checkbox                                          |
| A string `'#rgb'` to `'#rrggbbaa'`               | A colour field                                      |
| An `{ r, g, b, a? }` object of numbers           | A colour field (0-1 floats: a `THREE.Color`)        |
| Another string                                   | A text field                                        |
| An `{ x, y, z?, w? }` object, or 2 to 4 numbers  | A vector field                                      |
| An `{ x, y, z, order }` object (a `THREE.Euler`) | A rotation field, in degrees                        |
| Anything else                                    | A monitor of it, with a warning in the console      |

`readonly: true` makes any of them a monitor. `kind` says what the shape can't: `'color'` for a
24-bit number, `'text'` for a string that looks like a colour, `'switch'`, `'radio'`,
`'segmented'`, `'range'`, `'search'`, `'quaternion'`, `'angle'`, `'pad2d'`, `'gradient'` and
`'curve'` ([`PropertyGridFieldKind`](api:PropertyGridFieldKind)).

```ts
addPropertyGridItems(
  grid,
  [
    { target: light, key: 'color', label: 'Colour', colorSpace: 'linear' },
    { target: light, key: 'intensity', label: 'Intensity', min: 0, max: 10, step: 0.1 },
    {
      type: 'folder',
      title: 'Shadow',
      hidden: () => !light.castShadow,
      items: [
        { target: light.shadow, key: 'bias', label: 'Bias', step: 0.0001 },
        {
          kind: 'select',
          label: 'Map size',
          // An unbound select: the item holds the value
          value: light.shadow.mapSize.x,
          options: [512, 1024, 2048].map((size) => ({ text: String(size), value: size })),
          onChange: (size) => setShadowMapSize(light, size as number),
        },
      ],
    },
    {
      type: 'custom',
      build: (container) => {
        const line = container.add({ tag: 'p', text: '' });
        // Runs on each refresh
        return () => line.updateText(`Casts on ${countShadowCasters()} meshes`);
      },
    },
  ],
  {
    folderExpanded: saved.folders,
    onFolderExpandedChange: (id, open) => saveFolder(id, open),
  }
);
```

- **A field item's `onChange`** is the field's; `onCreate(field)` gets the field's handle when
  it's made (to keep it, or set an error later).
- **A folder's id** is its title path (`'Shadow'`, `'Light/Shadow'` in a nested one; the
  options' `path` puts a prefix before it) or its `id`. Its open state comes from
  `folderExpanded` over its own `expanded`, and each change goes to `onFolderExpandedChange`: the
  grid writes no storage, you keep them.
- **Every `hidden` and `disabled` function**, and the function a custom item's `build` returns,
  runs on the grid's `refresh()`.
- **It's its own module,** since inference may make any field: a grid built from field handles
  carries only the fields it holds.

## Coming from Tweakpane

The fields replace [Tweakpane](https://tweakpane.github.io/docs/), and keep its names where it has
them, so a pane described as items ports by renaming. Its calls map like this:

| Tweakpane                                          | The UI kit                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `new Pane({ container })`                          | `createPropertyGrid()`, its `cmp` added where it goes (a window for a floating pane)         |
| `pane.addBinding(obj, 'key', params)`              | An item `{ target: obj, key: 'key', ...params }`, or the field's own `createX`               |
| `addBinding(…, { readonly: true, interval })`      | The same item (a monitor), or `createMonitor`                                                |
| `pane.addFolder({ title, expanded })`              | `{ type: 'folder', title, expanded, items }`, or `createFolder`                              |
| `pane.addButton({ title, label })`, `.on('click')` | `{ type: 'button', title, label, onClick }`                                                  |
| `pane.addBlade({ view: 'separator' })`             | `{ type: 'separator' }`                                                                      |
| `pane.addBlade({ view: 'list', options, value })`  | An unbound select: `{ kind: 'select', label, options, value }`                               |
| `binding.on('change', (ev) => …)`                  | `onChange: (value, { last, prev }) => …` (`ev.value`, `ev.last`)                             |
| `folder.on('fold', (ev) => …)`                     | `onExpandedChange: (open) => …`, or the items' `onFolderExpandedChange(id, open)`            |
| `pane.refresh()`                                   | `grid.refresh()`, or the scheduler's                                                         |
| `api.hidden = true`, `api.disabled = true`         | `hidden` / `disabled` values or functions (re-read on refresh), `setHidden`, `setDisabled`   |
| `api.dispose()`                                    | `cmp.remove()`                                                                               |
| Essentials' `interval`, `radiogrid`, `cubicbezier` | A range slider (the same `{ min, max }`), a radio group or segmented control, a curve editor |

And its params:

| Tweakpane                                   | The UI kit                                                          |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `label`, `min`, `max`, `step`, `format`     | The same; `label` is required (Tweakpane shows the key without one) |
| `options` (an array or an object)           | The same                                                            |
| `readonly`, `interval`, `multiline`, `rows` | The same                                                            |
| `hidden`, `disabled`, `expanded`            | The same                                                            |
| `view: 'color'` (a 24-bit number)           | `kind: 'color'`                                                     |
| `color: { alpha: true }`                    | `alpha: true`                                                       |
| `color: { type: 'float' }`                  | Nothing: an `{ r, g, b }` object is always floats                   |
| `x: { min, max, step }` (a point's axis)    | `axes: { x: { min, max, step } }`                                   |
| `y: { inverted: true }`                     | `invertY: true` (a 2D pad)                                          |
| `keyScale`, `pointerScale`                  | None: `step`, with Shift ×10 and Alt ×0.1                           |
| `picker: 'inline'`, `expanded` (a colour)   | None: the colour panel is a popover                                 |

What works differently, on purpose:

- **`prev` with `last: true`** is the value before the gesture (Tweakpane's equals the value), so
  a handler that acts only on `last` gets the whole change in one call.
- **A monitor's reads never call `onChange`** (Tweakpane's poll emits a change on every read),
  and neither does a refresh.
- **Escape puts typed text back**; in Tweakpane the next blur writes it.
- **A typed or stepped number is rounded to the step's decimals** before it's written: `1 + 0.1`
  writes `1.1`, not `1.0999999999999999`.
- **Typed expressions** are the kit's own parser (no `eval`): numbers, `+ - * / **`, parentheses,
  `pi` and the field's units. `%` is a unit where the field takes one, not the modulo, and the
  bit operators are gone.
- **An Euler is a rotation field in degrees** (Tweakpane shows it as a point in radians), and an
  `{ x, y }` value is a vector field (Tweakpane's point has a pad: say `kind: 'pad2d'`).

The engine's [debug tabs](hub:features/debug-suite#a-tab) still build their panes with Tweakpane;
a later engine major moves them onto these fields, with the same names.

## Read more

- [Forms and fields](hub:features/ui-kit/forms): every field, with its demo, keys and parts.
- [The component library](hub:features/ui-kit/library): every field in every state.
- The API reference: [`aekasha/ui`](hub:documentation/aekasha/ui).
