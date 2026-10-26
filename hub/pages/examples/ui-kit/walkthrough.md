## The HUD panel

The panel is a component under the HUD root, and its buttons are the kit's: a button per shape,
a split button that turns them, and the settings and the menu. The scene removes the panel in
its exit function, with the toaster, and the kit components in it go with it.

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-hud

- `createButton` returns a handle; its `cmp` goes where the button goes. A `tooltip` describes the
  button on hover and keyboard focus.
- `kbd` takes a key hint made with `createKbd`: the button draws it after its label and sets
  `aria-keyshortcuts` from its keys. It doesn't bind the key: Space and Escape are the scene's
  action map's (below).
- The split button is an action ("Turn all") and a menu button next to it, whose menu holds the
  action's variants. A menu item's `onSelect` runs after the menu closed.
- Each shape button's colour swatch is a CSS `::before` that reads the custom property `--swatch`.
  `updateStyle` writes it on the button's element in place.
- The panel's stylesheet lays the kit's buttons out with rules on their classes (`.aekButton`,
  `.aekButton__kbd`) and colours the panel with the kit's design tokens, so it follows the theme
  and the UI scale ([Styling the UI kit](hub:features/ui-kit/styling)).

## Windows

The shapes' windows are one kind: the kind is registered with a content function, and each
window passes the data its content is built from. The settings window is a single window with
its content passed on the open.

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-windows

- `toggleDraggableWindow` is the button's click: it opens the window, brings it to the front when
  another window covers it, and closes it when it's on top. A second shape's window opens
  cascaded from the first.
- A shape's turns are a segmented progress bar: eight segments for a full turn. `turnShape`
  writes the open window's bar with `setValue` in place; the bar's handle is kept while its
  window's content is in the page and dropped in the content's `onRemoveCmp`.
- The scene registers the kind on every visit, which replaces the options. A kind whose windows
  are `saveToLS` is registered in the app's `start` instead, before the engine restores them
  after a reload.
- `closeOnSceneChange` closes the windows when another scene loads (a kind's window is removed
  on close).
- A drop-down re-reads its `value` getter after `onChange`, so the trigger shows the pick.
  Resetting the colours rebuilds the open shape windows with `updateDraggableWindowsOfKind`.

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

## The scene loader

"Reload the scene" loads the scene again through the app's scene loader, which every scene goes
through: the kit's loading overlay over the HUD, made in the app's `start` (`src/index.ts`).

<<< src/index.ts#app-scene-loader

- The load removes its container at its end, so `loaderContainerFn` makes a new overlay each time.
- `showAsync` and `hideAsync` fade it and resolve once done, so they're `loadStartFn` and
  `loadEndFn` as they are; under reduced motion they're instant.
- A scene that reports its progress (`getLoaderStatusUpdater()` with `loadedCount` and
  `totalCount`) turns the overlay's spinner into a progress bar, and its text says how far it is.

Back to the [examples](hub:examples).
