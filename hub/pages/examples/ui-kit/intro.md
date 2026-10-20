::: scene exampleUiKit
Three shapes and a HUD. Click a shape's button for its window, pick a colour, open the settings
for the ground and a toast, and press Space to turn the shapes. Escape opens the pause menu: the
arrows choose, Enter presses, Escape resumes.
:::

The HUD is built from the [UI kit](hub:features/ui-kit), on `aekasha/ui`: a panel of components,
two kinds of window, drop-downs, a toaster and a dialog. Everything the scene adds goes when it
exits.

![The example's HUD: the shapes panel, the Box window with its colour drop-down, the settings window and two toasts](ui-kit-hud.png)
