## Engine 5 → 6

::: note In progress
Engine 6.0.0 isn't released yet. Its changes merge into `main` ahead of the release, and this
section grows with them: so far the debugger's move onto the UI kit. The removals of what the
5.x minors deprecated come next.
:::

### The debugger on the UI kit

The debugger no longer uses Tweakpane: every drawer tab, edit window and debug window is built
from the [UI kit](hub:features/ui-kit), and its panes are
[property grids](hub:features/ui-kit/forms#property-grids). Most tabs keep working unchanged:

- The functions keep their names and signatures: `createDebuggerTab`, `openDebuggerTab`,
  `updateDebuggerTab`, `removeDebuggerTab`, `isDebuggerTabOpen`, `persistDebuggerTabValue`,
  `debuggerListCMP` and the profiler's.
- Every field of `DebuggerTabDef` stays, and so do the sections (`{ pane: true, … }`, a CMP, a
  list) and the item types' names (`DebuggerPaneBinding`, `DebuggerPaneFolder`, …), now defined
  over the kit's property grid items.
- What a 5.x debugger saved in localStorage loads in 6.0: a tab's `lsKey` values, its `uiLsKey`
  folder states and the drawer's state.

What breaks is a binding's Tweakpane side:

| 5.x                                                                         | 6.0                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A binding's other fields go to Tweakpane's `addBinding` (anything is typed) | The kit's field props only: an unknown one is a type error, and at run time the tab's error line names it |
| `view: 'color'`, or a `color` param, on a number                            | `kind: 'color'`; an `{ r, g, b }` object is always floats, so `color: { type: 'float' }` goes             |
| `onChange(value, { prev, last, api })`, `api` a `BindingApi`                | `onChange(value, { prev, last, source, field })`, `field` the field's handle                              |
| `onCreate(api: BindingApi)`                                                 | `onCreate(field)`                                                                                         |
| `custom.build(parent: Pane \| FolderApi)`                                   | `build(container: CMPHandle)`; a returned function still runs on every refresh                            |
| `prev` on the `last: true` call is the last step's value                    | The value before the gesture                                                                              |
| A `THREE.Euler` is a point in radians                                       | A rotation field in degrees; the bound value stays in radians                                             |
| A typed number reaches the target unrounded (`1.0999999999999999`)          | Rounded to the step's decimals (`1.1`)                                                                    |
| `tweakpane` and `@tweakpane/core` are dependencies                          | Gone: an app that imports Tweakpane itself adds them to its `package.json`                                |

For example:

```ts
{
  key: 'tint',
  label: 'Tint',
  view: 'color', // [!code --]
  kind: 'color', // [!code ++]
  onCreate: (api) => (tintApi = api), // [!code --]
  onCreate: (field) => (tintField = field), // [!code ++]
  onChange: (value, e) => {
    if (e.last) recordTintChange(e.prev, value); // e.prev: the value before the drag
  },
},
{
  type: 'custom',
  build: (parent) => { // [!code --]
    const element = parent.element.appendChild(document.createElement('p')); // [!code --]
  build: (container) => { // [!code ++]
    const element = container.add({ tag: 'p' }).elem; // [!code ++]
    return () => (element.textContent = describeTint()); // Every refresh
  },
},
```

`interval: 0` still reads a monitor only when the tab refreshes (the kit's `interval: 'refresh'`),
and `view: 'graph'` with `bufferSize` is still a graph monitor.

### What reads differently

Not type errors, but a tab may look or behave differently:

- **Monitors:** a boolean reads "On" / "Off" (Tweakpane wrote "true" / "false"), and a monitor
  with `options` reads the option's label, not the value.
- **Rotations** show in degrees, with Tweakpane's `step: Math.PI / 8` as 22.5°.
- **A list** is one tab stop with the arrows inside, where every row and toggle was a Tab stop.
- **Keys:** a key pressed on a debugger control is the debugger's: your app's action maps and
  key bindings don't see it, so Enter and Space click a focused debugger button.
- **During a scene load** the drawer and the on-screen tools are disabled.
- **The look:** the debugger is the kit's compact density, dark by default.
  `AppConfig.debugDrawer.theme` sets `'light'`, or `'app'` to follow your app's theme.
- **Restyling it:** the debugger's own stylesheets and their classes changed, and the Sass
  variables are gone. Set the kit's tokens on its roots (`[data-aek-debugger]`) instead
  ([Styling the UI kit](hub:features/ui-kit/styling)).

### New in a tab

- `content(ctx)`: `ctx.scheduler` is the tab's refresh scheduler, for the UI kit's own fields in a
  CMP section ([Kit components in a tab](hub:features/debug-suite#kit-components-in-a-tab)).
- `keepOnSceneChange` keeps the open tab across a scene change and refreshes it, after
  `onSceneChange`.
- `uiLsKey` also keeps the label column's width.
