## Two debug modes

Both work in development and test builds only (`yarn dev`, `yarn build:test`), never in a
production build:

- `?isDebug=true`: every tool.
- `?isProdTest=true`: the app as it runs in production, plus a few tools: play and stop (`F5`),
  the loop switches (`F6`, `F7`), and the profiler (`F8`) when you enable it there.

Next to either, `?startScene=<scene id>` picks the first scene.

## The drawer

`h` opens the drawer. Its tabs cover the engine: stats, the main loop, the sky box, the debug
tools, physics, the renderer, assets, PostFX, ray casting, lights, cameras, characters, the ECS,
the spatial index and levels of detail. The drawer remembers its tab and each tab's settings in
localStorage.

From the drawer, an entity opens in an edit window: lights, cameras, ECS worlds, PostFX passes,
physics entities, assets and characters. Several can be open at once, and they're kept over
reloads and scene changes.

## Write your own tab

Your scenes and features add tabs to the drawer, and figures, undo and file writes to the rest of
the suite, all through `aekasha/debug`. The [debug tab example](hub:examples/debug-tab) does each
of them in one scene.

### Load it only in debug builds

Put your debug code in a module whose name starts with `_dbg__`, and load it only in the debug
env. A production build then never loads the module, so neither your tab nor the Tweakpane it
uses ships:

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

A pane's items are bindings (an input bound to a property), folders, buttons, separators and a
`custom` item for anything else. A binding's `hidden` and `disabled` can be functions, read again
on every refresh. Creating a tab with an id that's already taken replaces the tab.

You can create a tab at any time: one created before the drawer has loaded (in a feature's
`install`) is added when it loads.

::: note Tweakpane
The panes are built with [Tweakpane](https://tweakpane.github.io/docs/): a binding passes its
other fields (`min`, `max`, `step`, `options`, `view`, …) to Tweakpane's `addBinding`, and
`onCreate` and `custom` items get Tweakpane's own objects. A later engine major replaces
Tweakpane, and these fields change with it.
:::

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
- Folder open states are saved under `uiLsKey` (by default `lsKey` + `UI`).
- A binding's `onChange` runs on user input only, never when a saved value is loaded or the tab
  refreshes, with the value before the change (`e.prev`) and whether a drag has ended
  (`e.last`).
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
always shows the current scene's. A `content` or `onRefresh` that throws is logged and shows an
error line in the tab; the drawer and the scene load go on.

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

| Key          | Does                                                     |
| ------------ | -------------------------------------------------------- |
| `h`          | Opens and closes the drawer.                             |
| `u` / `i`    | The key shortcuts dialog: the app's keys / the engine's. |
| `o` / `p`    | Opens the camera list / the scene list.                  |
| `F1`         | Switches to the debug fly camera and back.               |
| `F5`         | Plays the scene in production test mode.                 |
| `F6` / `F7`  | Stops and starts the main loop / pauses the app.         |
| `F8`         | Opens the profiler.                                      |
| `F9` / `F10` | Shows the environment ball / the axes gizmo.             |
| `Ctrl/⌘ + Z` | Undo (with `Shift`: redo).                               |

`AppConfig.debugKeys` in `src/CONFIG.ts` rebinds them and adds your own. They're
[action maps](hub:features/input#debug-keys) in the `DEBUG` context, so they work while the app
is paused and in editor views.

## Profiler and GPU memory

`F8` (or the speedometer at the top of the screen) opens the profiler window:

- **Overview**: frame, GPU, physics and memory figures, and your own.
- **Objects**: what's in view and in total, with the heaviest objects.
- **GPU memory**: memory by category and by owner (each scene's assets), draw calls, a budget,
  and snapshots whose difference names what a scene visit left behind.
- **Settings**: the update rate, which Overview rows show and in what order, and whether the
  profiler also loads in `?isProdTest=true`.

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
profiler by changing the call. [`removeProfilerTab`](api:removeProfilerTab) removes it,
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
const path = 'src/app/cameras/scene01Camera.camera.json';
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
- The API reference: [debug](hub:documentation/engine/debug), the public entry points of the
  debug tools.

::: claude-md
:::
