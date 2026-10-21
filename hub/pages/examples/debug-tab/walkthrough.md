## The scene

The scene owns its settings, and builds the boxes from them:

<<< src/app/examples/debugTab/exampleDebugTab.ts#debug-tab-scene

- The tab is created only in the debug env, through a dynamic `import()`. A production build
  never loads the module, so neither the tab nor the Tweakpane it uses is in it.
- Debug-only modules start with `_dbg__`, as the engine's do. The prefix marks them as debug
  code, and the API documentation leaves them out.
- The tab is created before `buildBoxes`, because creating it loads the saved settings into
  `boxSettings`.

## The tab

<!-- prettier-ignore -->
<<< src/app/examples/debugTab/_dbg__exampleDebugTab.ts#debug-tab

- `sceneId` makes it a scene tab: it's removed when the scene exits, and the scene creates it
  again on its next visit. The drawer stays on it across a reload, once the scene has made it.
- `state` is the object the controls bind to: here the scene's own settings, so a control
  changes what the scene reads. `persistKeys` are saved under `lsKey` after each change and
  loaded back when the tab is created. Other keys are never saved.
- A control's `onChange` runs on user input only, never when the saved value is loaded, so it's
  where the scene reacts to the change, and records it for undo.
- `lsKey` also gives the heading a button that clears the saved values, and `onClearLS` puts the
  scene back to its defaults.
- `refreshIntervalMs` and `onRefresh` run only while the tab is visible: a closed drawer
  doesn't refresh it.
- `content` is built again every time the tab is shown. Besides controls, buttons and
  separators, a pane can have folders, and a tab can have lists (`debuggerListCMP`).

[`openDebuggerTab`](api:openDebuggerTab) opens the drawer on a tab, and
[`updateDebuggerTab`](api:updateDebuggerTab) refreshes one from code.

## Undo

The tab registers one undo handler for both settings, and each control records its changes:

<<< src/app/examples/debugTab/_dbg__exampleDebugTab.ts#debug-tab-undo

- [`recordOrCoalesceUndoRedoAction`](api:recordOrCoalesceUndoRedoAction) merges the ticks of a
  slider drag (the same key, within 800 ms of each other) into one entry, from the value before
  the drag to the value after it.
- The payload is plain JSON, because the history is saved in localStorage: a reload keeps it.
- An undo changes the settings from code, so the handler saves the value itself
  ([`persistDebuggerTabValue`](api:persistDebuggerTabValue)) and refreshes the tab, whose controls
  then show it.
- The handler is registered again on every visit, which replaces it. Its entries are the scene's
  (`'perScene'`, the default): they undo only while this scene is current, so `buildBoxes` always
  has its scene.

## A figure in the profiler

The box count is a row of the profiler's Overview (`F8`), under "App":

<<< src/app/examples/debugTab/_dbg__exampleDebugTab.ts#debug-tab-profiler

- [`registerStatsSource`](api:registerStatsSource)'s `read` runs only at the profiler's update
  rate, and only while the Overview shows the row; `format` writes the value.
- The source goes with the scene: an exit hook of its own id removes it, then itself. The scene's
  own exit function (`registerOnSceneExit`) is left to the scene file.
- The Settings tab hides and moves the row like the engine's own.

The [Debug suite](hub:features/debug-suite#write-your-own-tab) has the rest: lists, toasts,
profiler tabs, GPU memory and the dev file server.

Back to the [examples](hub:examples).
