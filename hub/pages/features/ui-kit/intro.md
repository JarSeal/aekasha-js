The UI kit is the DOM UI the engine's own debug tools are built from, and it's yours for the
app's HUD: buttons, links, badges, key hints and progress bars for its panels, form fields bound
to your values, draggable windows that remember their layout, modal dialogs, menus, tooltips and
toasts. It's plain DOM with no framework, every piece works with the keyboard and assistive
tech, and a build carries only the parts the app imports. Everything is on `aekasha/ui`.

::: embed uiKit
The UI kit live, mounted into this page: a window with a button and its tooltip, a toast, and a
dialog with a drop-down from the window's "Open the dialog". Drag the window, press Escape in the
dialog, or Tab through it. The [UI kit example](hub:examples/ui-kit) builds a whole HUD.
:::

This page is the kit's base: [components](#components), [the HUD root](#the-hud-root) and
[styling](#styling). The pieces have pages of their own,
[core components](hub:features/ui-kit/core), [forms and fields](hub:features/ui-kit/forms) and
[windows and overlays](hub:features/ui-kit/overlays), each with live demos, and the
[component library](hub:features/ui-kit/library) shows every piece in every state.
