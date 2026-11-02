## Two debug modes

Both work in development and test builds only (`yarn dev`, `yarn build:test`), never in a
production build:

- `?isDebug=true`: every tool.
- `?isProdTest=true`: the app as it runs in production, plus a few tools: play and stop (`F5`),
  the loop switches (`Shift+F7`, `F7`), and the profiler (`F8`) when you enable it there.

Next to either, `?startScene=<scene id>` picks the first scene.

## The drawer

`h` opens the drawer. Its tabs cover the engine: stats, the main loop, the sky box, the debug
tools, physics, the renderer, assets, PostFX, ray casting, lights, cameras, characters, the ECS,
the spatial index and levels of detail. The drawer remembers its tab, its width and each tab's
settings in localStorage.

The debugger is built from the [UI kit](hub:features/ui-kit) in its compact density, and is dark
by default. `AppConfig.debugDrawer.theme` in `src/CONFIG.ts` sets `'light'`, or `'app'` to follow
your app's theme (its kit root's, else the system's); the Debug tools tab's "Debugger theme"
changes it for your browser. Its keys are its own: a key pressed on a debugger control never
reaches your app's action maps or key bindings.

From the drawer, an entity opens in an edit window: lights, cameras, ECS worlds, PostFX passes,
physics entities, assets and characters. Several can be open at once, and they're kept over
reloads and scene changes.

## Write your own tab

Your scenes and features add tabs to the drawer, and figures, undo and file writes to the rest of
the suite, all through `aekasha/debug`. The [debug tab example](hub:examples/debug-tab) does each
of them in one scene.

### Load it only in debug builds

Put your debug code in a module whose name starts with `_dbg__`, and load it only in the debug
env. A production build then never loads the module, so none of your tab's code ships:

```ts
import { IS_DEBUG_ENV } from 'aekasha';

if (IS_DEBUG_ENV) {
  const { createMyTab } = await import('./_dbg__myTab');
  createMyTab();
}
```

The `import()` has to sit inside the `if`: one outside it ships the module's chunk.
[`loadDebugModuleAsync`](api:loadDebugModuleAsync) does the same, and can also load the module in
prod test mode (`?isProdTest=true`), for a tool that should show there too. It logs a failed
load.

### A tab

[`createDebuggerTab`](api:createDebuggerTab) takes the whole tab as one object: its menu button
(`id`, `title`, `icon`), its place (`orderNr`) and a `content` function that returns its
sections. A section is a pane of controls (`{ pane: true, content: [...] }`), a list, or any CMP
from the [UI kit](hub:features/ui-kit).

A pane is a [property grid](hub:features/ui-kit/forms#property-grids) described as data. Its
items are the UI kit's [property grid items](hub:features/ui-kit/forms/binding#panels-as-data):
bindings (a field bound to a property), folders, buttons, separators and a `custom` item for
anything else.

```ts
createDebuggerTab({
  id: 'enemies',
  title: 'Enemies',
  icon: 'personArmsUp',
  state: enemySettings,
  content: () => [
    {
      pane: true,
      content: [
        { key: 'speed', label: 'Speed', min: 0, max: 10, step: 0.1 },
        { key: 'tint', label: 'Tint', kind: 'color' },
        {
          type: 'folder',
          title: 'Spawning',
          content: [
            { key: 'spawnOn', label: 'Spawn' },
            { type: 'button', title: 'Spawn one now', onClick: spawnEnemy },
          ],
        },
      ],
    },
  ],
});
```

- A binding takes the kit field's props: `min`, `max`, `step`, `options`, `readonly`, `format`,
  `interval`, `kind`, … ([`DebuggerPaneBindingProps`](api:DebuggerPaneBindingProps)). One the kit
  doesn't take is a type error, and at run time the tab's error line names it.
- Without `kind`, the field is inferred from the value: a number with `min` and `max` is a
  slider, a boolean a checkbox, a `THREE.Euler` a rotation field in degrees. A 24-bit colour
  number says `kind: 'color'`.
- `readonly: true` makes a monitor, read every `interval` ms (default 200) while the tab shows.
  In a pane `interval: 0` reads it only when the tab refreshes (the kit's `'refresh'`).
- A binding without a `label` is named by its key.
- `hidden` and `disabled` can be functions, read again on every refresh.
- `onCreate(field)` gets the field's handle, and a `custom` item's `build(container)` a CMP across
  both columns; the function `build` returns runs on every refresh.

Creating a tab with an id that's already taken replaces the tab. You can create a tab at any
time: one created before the drawer has loaded (in a feature's `install`) is added when it loads.

### State and persistence

A tab's bindings bind to its `state` object by default: your module's own settings, so a control
changes what your code reads. A binding's `key` can be a path one level into it
(`'helpers.showGrid'`). One with a `target` binds to another object instead (a read-only figure,
say), which is never saved.

- `persistKeys` are saved under `lsKey` in localStorage after each finished change, and loaded
  back into `state` when the tab is created, so your code can read them right after. No other key
  is ever saved.
- `lsKey` also gives the heading a button that clears the saved values; `onClearLS` then puts
  your state back to its defaults.
- Folder open states and the label column's width are saved under `uiLsKey` (by default
  `lsKey` + `UI`).
- A binding's `onChange` runs on user input only, never when a saved value is loaded or the tab
  refreshes. It runs on each step of a drag with `e.last` false, then once with `e.last` true
  and `e.prev` the value before the drag.
- A value you change from code (an undo, a reset) isn't saved by itself:
  [`persistDebuggerTabValue`](api:persistDebuggerTabValue) saves one key.

### Refresh

- `refreshIntervalMs` refreshes the tab while it's visible. A closed drawer, another tab or an
  editor view stops it.
- `onRefresh` runs before every build and refresh: copy live values into the objects your
  bindings show.
- [`updateDebuggerTab`](api:updateDebuggerTab) refreshes a tab from code, and
  `{ rebuild: true }` builds its content again (when its structure changed). It does nothing
  while the tab isn't visible ([`isDebuggerTabOpen`](api:isDebuggerTabOpen)): a hidden tab is
  built fresh from `content` the next time it shows.
- `onOpen` runs each time the tab's content is built into the drawer, and the function it
  returns when that content goes (another tab, a rebuild): start and stop what only the built tab
  needs there. Closing the drawer only pauses the refreshes.

The open tab is built again on every scene change, so a tab that lists the scene's objects
always shows the current scene's. With `keepOnSceneChange: true` it stays as it is (its scroll,
open folders and focus) and refreshes instead, after `onSceneChange`: for a tab that reads the
scene through functions. A `content` or `onRefresh` that throws is logged and shows an error line
in the tab; the drawer and the scene load go on.

### Kit components in a tab

A section can be any CMP, so a tab can hold the UI kit's own pieces: a folder of fields, a
[segmented control](hub:features/ui-kit/forms#radio-groups-and-segmented-controls), a
[table](hub:features/ui-kit/data#tables). `content` gets the tab's refresh scheduler,
`ctx.scheduler`: give it to your fields (and lists and tables), and they refresh with the tab's
panes, on `refreshIntervalMs` and `updateDebuggerTab`, and stop while the tab isn't visible.

```ts
content: (ctx) => [
  { pane: true, content: [{ key: 'speed', label: 'Speed', min: 0, max: 10 }] },
  createFolder({
    title: 'Wave',
    scheduler: ctx.scheduler,
    children: [
      createSlider({ target: wave, key: 'size', label: 'Size', min: 1, max: 50, step: 1 }),
      createMonitor({ get: getAliveCount, label: 'Alive', interval: 'refresh' }),
    ],
  }).cmp,
],
```

A kit field isn't one of the tab's bindings, so `persistKeys` doesn't save it: save its key with
[`persistDebuggerTabValue`](api:persistDebuggerTabValue) when `e.last` is true. The
[debug tab example](hub:examples/debug-tab#kit-components-in-the-tab) does it.

### Lists

[`debuggerListCMP`](api:debuggerListCMP) is the list of the engine's own tabs, as a section: rows
with an icon, a badge, a suffix and a description, a selected row, icon toggles on the right and
a click handler (usually to open an edit window). Give `data` a function and the list reads it
again on every refresh, rendering only when the rows changed.

```ts
debuggerListCMP({
  heading: 'Enemies',
  emptyText: 'No enemies',
  data: () => enemies.map((e) => ({ itemId: e.id, title: e.name, suffix: `${e.hp} hp` })),
  perItemConfig: { onClick: (itemId) => openEnemyWindow(itemId) },
});
```

### Scene tabs

A tab with a `sceneId` belongs to that scene: it's removed when the scene exits, so the scene
creates it again in its code on every visit. The drawer stays on a scene tab across a reload,
once the scene has created it.

[`openDebuggerTab`](api:openDebuggerTab) opens the drawer on a tab, and
[`removeDebuggerTab`](api:removeDebuggerTab) removes one.

### Toasts

[`addDebugToast`](api:addDebugToast) shows a short message in the debug toaster, bottom left:
"Level saved", "Spawned 100 enemies". It does nothing before the toaster exists (until the
app's `start` has run) and outside the debug env.

## Icons

A drawer tab, an editor view and a draggable window take an `icon` by name, from a registry
(`aekasha/ui`). The debug env and prod test mode register every built-in icon; a production build
registers none, so its bundle has no SVG it doesn't show.

```ts
import { gearIcon, registerIcon } from 'aekasha/ui';
import shieldSvg from './icons/shield.svg?raw';

registerIcon('shield', shieldSvg); // Your own, in every build
registerIcon('gear', gearIcon); // A built-in your production UI shows
```

- An unregistered name renders `??` and warns once. Register your own icons, and the built-ins
  your app shows in production (each is exported as `<name>Icon`), before the UI that shows them.
- Registering a name again replaces its SVG, so you can restyle a built-in.
- [`getSvgIcon`](api:getSvgIcon) renders a registered icon as HTML, for your own HUD.

## Keys

| Key               | Does                                                     |
| ----------------- | -------------------------------------------------------- |
| `h`               | Opens and closes the drawer.                             |
| `u` / `i`         | The key shortcuts dialog: the app's keys / the engine's. |
| `o` / `p`         | Opens the camera list / the scene list.                  |
| `F1`              | Switches to the debug fly camera and back.               |
| `F5`              | Plays the scene in production test mode.                 |
| `Shift+F7` / `F7` | Stops and starts the main loop / pauses the app.         |
| `F8`              | Opens the profiler.                                      |
| `F9` / `F10`      | Shows the environment ball / the axes gizmo.             |
| `Ctrl/⌘ + Z`      | Undo (with `Shift`: redo).                               |

`AppConfig.debugKeys` in `src/CONFIG.ts` rebinds them and adds your own. They're
[action maps](hub:features/input#debug-keys) in the `DEBUG` context, so they work while the app
is paused and in editor views.

## Stats panels

In the debug env, panels in the bottom-left corner show the frame's figures as they change: each
its figure (written four times a second), a graph of the last three seconds, and the graph's
lowest and highest sample under the figure. They measure what the profiler's Overview rows do,
by the same definitions, and a panel's tooltip says what its figure spans:

| Panel | Shows                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| TFPS  | Theoretical frames per second: 1000 over the main loop's mean CPU time of the last 60 frames, what the CPU would allow |
| FPS   | Rendered frames per second, over the last second; with Hz on, the display's refresh rate in its small text             |
| CPU   | The main loop's CPU time per frame, the render's submission included                                                   |
| PHY   | The physics step time of the last frame that stepped, its sub-steps summed                                             |
| GPU   | The GPU time per frame over the last second, every render pass summed                                                  |
| CPT   | The GPU time per frame of the compute dispatches, over the last second                                                 |

- A graph takes a sample 30 times a second, each the worst frame since the last, so a short hitch
  still shows. The lowest and highest are the graph's, so a load's hitch stays in them until it
  scrolls out.
- GPU and CPT need timestamp queries: WebGPU's `timestamp-query` feature, or WebGL 2's
  `EXT_disjoint_timer_query_webgl2`. Without them their toggles are disabled. On WebGL fewer
  frames get a figure (three's queries are lost while a read is pending), each still a whole
  frame's.
- The Statistics tab picks the panels (TFPS, FPS and CPU by default) and the Hz line, and lays
  them out in a column or, with Horizontal, a row. Each change applies at once and is saved. PHY
  applies after a reload, since physics sets up its step stats at boot
  (`AppConfig.physics.stepStatsEnabled` is its default). "Enable measuring" off removes the
  panels.
- The panels measure only what they show: the GPU timer runs only while something reads it (a
  GPU or CPT panel, the profiler's GPU row).
- The panels are a button that opens the profiler: click them, or Tab to them and press Enter.
  The profiler's Settings ("Open from stats panels") turn that off.

## Profiler and GPU memory

`F8` (or the speedometer at the top of the screen, or the stats panels) opens the profiler
window:

- **Overview**: frame, GPU, physics and memory figures, and your own. A figure that can't be
  measured reads "n/a" with its reason, and a warning says why in words.
- **Objects**: what's in view and in total, by kind and by owner, with a bar of the share in view
  (objects, triangles or vertices), the ECS worlds and their component types, the heaviest
  objects (each opening its entity's edit window), and three counts over time.
- **GPU memory**: memory by category and by owner (each scene's assets), draw calls, a budget,
  and snapshots whose difference names what a scene visit left behind. Its tables sort by a
  column header.
- **Settings**: the update rate, which Overview rows show and in what order, and whether the
  profiler also loads in `?isProdTest=true`.

The tabs are the [UI kit's](hub:features/ui-kit/data) tables, bars, lists and sparklines, and a
refresh writes only the figures that changed: a sort you picked, the focus and the scroll stay
while the figures update. The built-in tabs stay open across a scene change (the Objects tab's
history starts again).

GPU times are read from three's timestamp queries by one timer that the stats panels, the
profiler, the PostFX profiler and the sky box's bake stats share, on WebGPU and WebGL 2, so they
read the same frames.

A closed profiler measures nothing. It loads in the debug env, and in prod test mode when its
Settings say so: gate code that only feeds the profiler on
[`isProfilerLoadedInThisMode`](api:isProfilerLoadedInThisMode), not on `IS_DEBUG_ENV`. The
registrations below are no-ops where it doesn't load, and work at any time where it does, also
before it has loaded.

### Your own figures

[`registerStatsSource`](api:registerStatsSource) adds a row to the Overview, under "App", after
the engine's. The Settings tab hides and moves it like the others.

```ts
const removeEnemiesSource = registerStatsSource({
  id: 'game.enemies',
  label: 'Enemies',
  read: () => enemyCount,
  format: (count) => `${count} alive`,
});
```

- `read` is called only at the profiler's update rate, and only while a view shows the source.
  Null reads "measuring…".
- Without `format`, a number shows with two decimals and a string as it is.
- A figure that costs something to measure turns it on in `acquire` and off in `release`: they run
  when the first view needs the source and when the last one is done.
- `availability` returns true, or why the figure is n/a right now ("WebGPU only"). The row shows
  the reason, and the source isn't acquired meanwhile.
- The function `registerStatsSource` returns removes the source: remove a scene's source on its
  exit.

### Your own profiler tabs

[`createProfilerTab`](api:createProfilerTab) adds a tab to the profiler window. It takes the same
definition as `createDebuggerTab` (without `sceneId`), so a tab moves between the drawer and the
profiler by changing the call: it's built again on a scene change too, unless it has
`keepOnSceneChange`. [`removeProfilerTab`](api:removeProfilerTab) removes it,
[`openProfilerTab`](api:openProfilerTab) opens the window on a tab (the GPU memory tab is
[`GPU_MEMORY_TAB_ID`](api:GPU_MEMORY_TAB_ID)), and
[`updateProfilerTab`](api:updateProfilerTab) refreshes one.

### GPU memory sources

The GPU memory tab sums each scene's registered assets. A GPU resource that isn't a registered
asset (a render target, an instance buffer) counts as "untracked" until you name it with
[`registerGPUMemorySource`](api:registerGPUMemorySource):

```ts
registerGPUMemorySource({
  id: 'game.minimap',
  label: 'Minimap',
  getResources: () => [minimapTarget],
  owner: () => getCurrentSceneId(),
});
```

`getResources` returns the three objects themselves, never a byte estimate: the tab reads their
bytes from three's own bookkeeping.

### Debug helpers

Debug code that adds gizmos, wireframes or lines to the root scene marks them with
[`markDebugHelper`](api:markDebugHelper). The profiler's census then counts them in a row of
their own instead of the scene's figures, and snapshots (the Hub images among them) leave them
out. three's `*Helper` objects are recognised without it.

[`registerEntityWindowOpener`](api:registerEntityWindowOpener) lets the Objects tab's heaviest
rows open your own entity edit window.

## Undo and redo

Changes made in the debugger can be undone, from the buttons at the top of the screen or with
`Ctrl/⌘ + Z`. Your tool takes part in two steps:

- It registers a handler per action type with
  [`registerUndoRedoActionHandler`](api:registerUndoRedoActionHandler): `undo` and `redo`, each
  given the recorded payload. That works at any time, also before the debugger has loaded.
- It records each change it has made with [`recordUndoRedoAction`](api:recordUndoRedoAction),
  or, from a binding's `onChange`,
  [`recordOrCoalesceUndoRedoAction`](api:recordOrCoalesceUndoRedoAction): the ticks of one drag
  (with the same key, within 800 ms of each other) merge into one entry with the first tick's
  `prev` and the last one's `next`.

```ts
registerUndoRedoActionHandler<{ prev: number; next: number }>('myGame.speed', {
  undo: ({ prev }) => setSpeed(prev),
  redo: ({ next }) => setSpeed(next),
});

// One of the tab's bindings, as its pane's content lists it
const speedBinding: DebuggerPaneBinding<typeof settings> = {
  key: 'speed',
  onChange: (value, e) =>
    recordOrCoalesceUndoRedoAction(
      'myGame.speed',
      'Speed',
      { prev: e.prev as number, next: value as number },
      'speed'
    ),
};
```

- The history is saved in localStorage, so a payload is plain JSON: ids, field names and values,
  never an object.
- An action type is `'perScene'` by default: its entries undo only while their scene is current.
  `'global'` is for settings that aren't a scene's (the renderer's). Undo walks both as one
  timeline.
- A handler changes values outside the tab's inputs: it saves them
  ([`persistDebuggerTabValue`](api:persistDebuggerTabValue)) and refreshes the tab
  ([`updateDebuggerTab`](api:updateDebuggerTab)).
- Undo stops at an entry whose handler isn't registered (after a reload, before the scene that
  registers it has loaded) and goes on once it is: skipping it would apply the rest out of order.
- The Debug tools tab shows the history, its size per scene, and whether each undo shows a
  toast.

## Editor views

The buttons at the top left switch the whole canvas to an editor view (see
[Viewports and views](hub:features/viewports#views)), with its own scene, camera and drawers. The game scene is suspended meanwhile (no systems, no physics) and goes on
exactly where it was when you switch back, so a visit to an editor keeps it deterministic.

The first editor is the **material editor**: every `*.material.json` material on a preview
ball, picked from a list, with its params and TSL inputs edited live. Each material's edits,
the stage and the camera are kept over reloads.

## Dev file server

While `yarn dev` runs, debug tools can write files into the repo: the LOD tab exports
impostors, and each example scene's Hub tab saves its Hub image. A write is like saving the file
in your editor: the scene data is gathered again and the page reloads.

- [`writeDevFiles`](api:writeDevFiles) writes a batch, all or nothing: JSON values, blobs (a PNG
  from [`encodePNG`](api:encodePNG)) and save entries. It rejects with a
  [`DevFilesError`](api:DevFilesError), whose `code` says why (`CONFLICT`, `INVALID_SCHEMA`, …).
- [`readDevFile`](api:readDevFile) reads one with its hash. Pass the hash as a write's
  `expectedHash`, and the write fails with `CONFLICT` when the file has changed since.
- [`getDevFilesStatus`](api:getDevFilesStatus) tells whether this page can write, and why not:
  disable your tool's button on it.
- A `saveData` write adds a scene's overrides to an asset JSON's `__saveData`, stamped with the
  engine, toolkit and app versions. [`getDevFilesSaveHistorySize`](api:getDevFilesSaveHistorySize)
  is how many entries a scene keeps; at 0 saving is off.
- [`onDevDataGathered`](api:onDevDataGathered) calls you after each gather, before the reload:
  whether it went through, the files it read (find your write by its path) and whether the page
  reloads next. A failed gather keeps the page and shows Vite's error overlay.

```ts
const path = 'src/app/scenes/scene01/scene01Camera.camera.json';
const removeListener = onDevDataGathered((event) => {
  if (!event.files.includes(path)) return;
  removeListener();
  if (event.status === 'failed') addDebugToast({ title: 'The gather failed' });
});
await writeDevFiles([{ path, saveData: { sceneId: 'scene01', entry: { fov: 60 } } }]);
```

The server writes only JSON and images, only under `src/app/`, `src/toolkit/` and `src/public/`,
and checks a JSON of a known type against its schema first. Only the server's own machine can
write, with a token the server gives its page. `AEK_DEV_FILES_LAN=true` lets a phone on your
network write too, and `AEK_DEV_FILES=false` turns it off.

::: dev-only

## Test bridge

`?aekTest=true`, next to `?isDebug=true` or `?isProdTest=true`, installs `window.__AEK_TEST__`, the
page side of `yarn verify:scenes`: it tells when the first scene is ready, waits for the
determinism probe, freezes the loops and takes a snapshot. It also runs a test clock, every frame
1/60 s, so what a page shows depends on how many frames ran, not on how fast the machine is. See
the [Quick start](hub:examples/quick-start#check-your-changes) for the commands.
:::

## Physics and characters

- Collider wireframes coloured by body state and simulation tier, ray helpers, and live body
  counts, in the Physics API tab.
- The determinism probe (see [Physics](hub:features/physics#deterministic-scene-loads)).
- A state window per character, with its live data, its configuration edited live, and in-world
  gizmos for what its controller measures (see
  [Characters](hub:features/characters#debugging-characters)).

## About and bug reports

The Æ button at the top left opens the About dialog: the engine, toolkit and app versions, the
build, the renderer and GPU, and the physics backend and thread. Its "Copy info" button copies
it all for a bug report.

## Key APIs

- Tabs: [`createDebuggerTab`](api:createDebuggerTab), [`updateDebuggerTab`](api:updateDebuggerTab),
  [`openDebuggerTab`](api:openDebuggerTab), [`removeDebuggerTab`](api:removeDebuggerTab),
  [`persistDebuggerTabValue`](api:persistDebuggerTabValue) and
  [`debuggerListCMP`](api:debuggerListCMP); the definition is
  [`DebuggerTabDef`](api:DebuggerTabDef).
- [`addDebugToast`](api:addDebugToast): a short message on screen.
- [`loadDebugModuleAsync`](api:loadDebugModuleAsync): a debug module that also loads in prod
  test mode.
- [`registerIcon`](api:registerIcon) and [`getSvgIcon`](api:getSvgIcon).
- The profiler: [`toggleProfilerWindow`](api:toggleProfilerWindow),
  [`isProfilerLoadedInThisMode`](api:isProfilerLoadedInThisMode),
  [`registerStatsSource`](api:registerStatsSource),
  [`createProfilerTab`](api:createProfilerTab),
  [`registerGPUMemorySource`](api:registerGPUMemorySource) and
  [`markDebugHelper`](api:markDebugHelper).
- Undo: [`registerUndoRedoActionHandler`](api:registerUndoRedoActionHandler),
  [`recordUndoRedoAction`](api:recordUndoRedoAction) and
  [`recordOrCoalesceUndoRedoAction`](api:recordOrCoalesceUndoRedoAction).
- Dev files: [`writeDevFiles`](api:writeDevFiles), [`readDevFile`](api:readDevFile),
  [`getDevFilesStatus`](api:getDevFilesStatus) and
  [`onDevDataGathered`](api:onDevDataGathered).

## Read more

- The [debug tab example](hub:examples/debug-tab): a tab, undo and a profiler figure in one
  scene.
- The API reference: [`aekasha/debug`](hub:documentation/aekasha/debug), the debug tools' public entry.

::: claude-md
:::
