## Radii and elevation

- Radii: `sm` for small parts (a chip, a checkbox, a swatch), `md` for controls (buttons,
  fields), `lg` for panels, windows and dialogs, `full` for pills and badges. A part inside a
  rounded box takes a smaller radius than the box.
- Elevation is a surface and a shadow together: a menu, a tooltip or a popover is
  `surface-raised` with `shadow-sm`; a window or a dialog is `surface-raised` with `shadow-lg`,
  over a dialog's `backdrop`. In the light theme the shadow does the raising (the surfaces are the
  same white), so never leave it out there.
- Layers: the app's windows stack from `--aek-z-window`, the app's modal dialogs above them from
  `--aek-z-dialog` (under the debugger, which an app's dialog leaves usable), the debug windows
  from `--aek-z-debug-window`, the debug dialogs from `--aek-z-debug-dialog`, then toasts and
  tooltips. Each window takes 2 above the last, its backdrop 1 below. The windows' code holds the
  same bases as the tokens (a test keeps them equal).

::: do
A drop-down list: `background: var(--aek-surface-raised); box-shadow: var(--aek-shadow-sm);
border-radius: var(--aek-radius-md);` and its z-index from the layer it opens in.
:::

::: dont
`z-index: 99999` to get on top: it jumps over the dialogs and the toasts, and the next fix does it
again.
:::
