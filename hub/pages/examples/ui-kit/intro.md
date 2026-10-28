::: scene exampleUiKit
Three shapes and a HUD. Click a shape's button for its window, pick a colour and turn it, open
the split button's menu to turn one shape, and press Space to turn them all. Settings opens the
scene's settings: pick a shape, spin it, colour it, move it, turn it or show its wireframe, and
watch the frame time. Rename opens a form that checks the name you give a shape. Inspector shows
the scene's objects in a tree: pick one for its properties, right-click one for its menu, and open
Stats for the frame's figures and a table of the meshes. Ctrl+K (⌘K on a Mac) opens a palette of
the scene's commands. Escape opens the pause menu: the arrows choose, Enter presses, Escape
resumes, and Reload the scene shows the app's loading overlay.
:::

The HUD is built from the [UI kit](hub:features/ui-kit), on `aekasha/ui`: kit buttons with
tooltips and key hints, a split button with a menu, two kinds of window, drop-downs, a segmented
progress bar, a property grid of [form fields](hub:features/ui-kit/forms) bound to the scene, a
validated form, a toaster and a dialog, an inspector of the [data display](hub:features/ui-kit/data)'s
tree, tabs, stat tiles, time series and table beside a splitter, with context menus, and a
[command palette](hub:features/ui-kit/overlays#command-palettes). The scene loader every scene
goes through is the kit's loading overlay. Everything the scene adds goes when it exits.

![The example's HUD: the shapes panel, the Box window with its colour drop-down and its turns, the Scene settings window with its property grid, and two toasts](ui-kit-hud.png)
