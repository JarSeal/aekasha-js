## The HUD panel

The panel is a component under the HUD root, and its buttons are the kit's: a button per shape,
a split button that turns them, the settings, the rename form and the menu. The scene removes the
panel in its exit function, with the toaster, and the kit components in it go with it.

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

## Scene settings

The settings window holds a property grid of form fields. A select at its top picks the shape,
and the rows under it edit that shape; a folder holds the scene's own rows.

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-settings

- Each field is bound with a getter and a setter (`{ get, set }`): the getter reads the scene's
  own state (the ECS transform, a component's data, a material, this file's records) and the
  setter writes it the way that state is written: `setTransform` for the position and the
  rotation, the component's data for the spin, the material for the wireframe.
- The Shape select is bound to `settingsShape`, and its `onChange` refreshes the grid: every row
  reads the picked shape's values, and the ones that differ flash.
- The spin is the [ECS example](hub:examples/ecs)'s SPIN component, whose system runs in every
  world. Its speed is in radians a second; the getter and the setter show it in degrees.
- The colour field and a shape window's drop-down edit the same colour. A pick in the drop-down
  refreshes the grid, so the colour field flashes; a finished change in the colour field
  (`last: true`) rebuilds the shape windows. A colour none of the drop-down's options has shows
  its placeholder, "Custom".
- The rotation is a quaternion field, edited as Euler angles in degrees. `order: 'YXZ'` keeps a
  turn about y as one angle all the way round. `interval: 100` reads it every 100 ms while it
  shows, so it follows the spin and the turns; the other rows are read only by a refresh.
- The monitor reads the frame time (`getDelta`) every 200 ms, its default, and not while its
  folder is shut.
- The grid's handle is kept while its window is open and dropped in the panel's `onRemoveCmp`, so
  a drop-down's pick, a reset and a rename can call its `refresh()`.

[Binding values](hub:features/ui-kit/forms/binding) has the bindings, the order of the writes
and the refreshes in full.

## A form

Rename opens a form: a select and a text field, checked on a submit.

<<< src/app/examples/uiKit/exampleUiKit.ts#ui-kit-form

- The fields are bound to a plain object of the form's own (`{ target, key }`), which a valid
  submit reads.
- `required` takes the error's text, and `validate` checks the name against the other shapes'.
  Both run on a submit, then on each blur from the first submit on. The summary at the top takes
  the focus and links each error to its field, and Enter in the text field submits the form.
- `maxLength` stops the typing at 12 characters, and the hint says so.
- After a rename, `reset()` puts the fields back and turns the blur checks off, and `refresh()`
  reads the select's options again: its value is the same, its option's name isn't.
- The new name reaches the HUD's button (`setLabel`), the split button's menu (its items are a
  getter, read on each open), an open shape window's title (opened again with the new `title`
  and `focusFirstElement: false`) and the settings' select.

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
