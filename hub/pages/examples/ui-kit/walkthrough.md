## The HUD panel

The panel is a component under the HUD root, with a button per shape. The scene removes it in
its exit function, with the toaster.

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-hud

- The panel places itself (`position: fixed` in the scene's stylesheet): the HUD root is a
  zero-size element at the canvas's top left.
- Each button's colour swatch is a CSS `::before` that reads the custom property `--swatch`.
  `updateStyle` writes it on the button's element and its props in place, so the next `update()`
  keeps it.
- The buttons' `onClick` runs in the capture phase, as every CMP listener does.

## Windows

The shapes' windows are one kind: the kind is registered with a content function, and each
window passes the data its content is built from. The settings window is a single window with
its content passed on the open.

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-windows

- `toggleDraggableWindow` is the button's click: it opens the window, brings it to the front when
  another window covers it, and closes it when it's on top. A second shape's window opens
  cascaded from the first.
- The scene registers the kind on every visit, which replaces the options. A kind whose windows
  are `saveToLS` is registered in the app's `start` instead, before the engine restores them
  after a reload.
- `closeOnSceneChange` closes the windows when another scene loads (a kind's window is removed
  on close).
- A drop-down shows its `value` getter's label on an open and on `refresh()`, so `onChange`
  refreshes it. Reset rebuilds the open shape windows with `updateDraggableWindowsOfKind`.

## Toasts

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-toasts

In debug mode the engine's own toaster is the default one, so the scene names its toaster on
every toast.

## The pause menu

Escape opens the menu through the scene's gameplay action map. The menu's arrow keys are a
second map, in a context of its own that is off until the menu opens.

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-menu

- Opening the menu turns the `GAMEPLAY` context off and the `MENU` context on: Space no longer
  turns the shapes, and the arrows move the focus. The dialog's `onClose` turns them back,
  however it closes: Escape, Resume, its close button, or a scene load (`removeOnSceneChange`).
- `closeOnEscape` closes the dialog on Escape before any action map sees the press, so the same
  key opens the menu (the gameplay map) and closes it (the dialog).
- Enter and Space press the focused button as the browser does: the menu needs no action for
  them.
- Both maps have the scene's `sceneId`, so they're inactive in any other scene, and the next
  visit's maps replace them by their ids.

Back to the [examples](hub:examples).
