## Loading overlay

`createLoadingOverlay({ text, progress?, cover? })` covers the HUD's bounds (a scene load; the
mount's container in an embed) or, with `cover: 'parent'`, a positioned element of the app's,
while something loads: a spinner, or a progress bar when `progress` is given (`setProgress` swaps
one in), and a text that's read as a status. `showAsync` and `hideAsync` fade it (150 and 250 ms,
times the motion factor) and resolve `true` once done, `false` when a later call or the removal
cut them short, so they're a scene loader's `loadStartFn` and `loadEndFn` as they are. Over the
bounds it's at `--aek-z-loading`: above the app's windows, below its dialogs and the debugger. It
blocks the pointer while shown, and nothing else (a scene load turns the inputs off itself).

The debug scene loader (the Debug tools' start scene) is one, a new overlay per load.

- **States:** drawn in the page: an overlay over a panel with its spinner, the same with a bar
  ("Show the progress") and hidden ("Hide it"), and one over the HUD's bounds with a bar, as a
  scene loader's (the demo closes it on a click; the overlay itself takes no input).
