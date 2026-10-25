Every piece of the [UI kit](hub:features/ui-kit) (`aekasha/ui`) running in this page: open each
one's states with the buttons in its box, and try them with the mouse and the keyboard. The
switches below set the theme and the density of everything the demos open or draw, so you can see
each piece in both themes and both densities without changing your system's settings.

The page runs no engine, as any page without it can use the kit:

- **A HUD root.** The windows, dialogs and toasts go under it. In an app the engine's boot makes
  it; here the page makes it with [`createHudRoot`](api:createHudRoot), which brings the kit's
  global styles with it. It sits over the viewport, as in an app, so the demos open over the page
  and stay in view while it scrolls.
- **Pieces drawn in the page** (a button, a key hint, a progress bar) draw in a kit root of their
  own in their box: a container with the class `aekUi`
  ([`KIT_ROOT_CLASS`](api:KIT_ROOT_CLASS)), as an app's own UI outside the HUD.
- **What needs the boot isn't here:** a debug tool's window, a window restored from storage after
  a reload, and what happens on a scene load. The [UI kit example](hub:examples/ui-kit) runs them
  in the app.

The buttons that open the states and the windows' content are this page's own, as an app's
content is the app's; everything else is the kit's.
