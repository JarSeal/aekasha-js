The UI kit is the DOM UI the engine's own debug tools are built from, and it's yours for the
app's HUD: small components over the canvas, draggable windows that remember their layout,
modal dialogs, drop-downs, toasts and icons. It's plain DOM with no framework, and a build
carries only the parts the app imports. Everything is on `aekasha/ui`.

::: scene exampleUiKit
A HUD panel with a window per shape, a settings window, toasts, and a pause menu on Escape. The
[UI kit example](hub:examples/ui-kit) walks through it.
:::
