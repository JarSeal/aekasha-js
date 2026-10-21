Debug everything, ship nothing extra. Open the app with `?isDebug=true` and press `h`: a drawer
of tools for every part of the engine, a profiler, undo and redo, editor views, and a dev file
server that writes your changes back into the repo. All of it is loaded on demand from `_dbg__`
modules, so a production build doesn't contain it.

::: scene exampleDebugTab
A scene with a debug tab of its own: saved settings that undo, a button, and a figure in the
profiler. The [debug tab example](hub:examples/debug-tab) shows the code.
:::
