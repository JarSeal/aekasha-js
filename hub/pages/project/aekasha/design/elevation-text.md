## Radii and elevation

- Radii: `sm` for small parts (a chip, a checkbox, a swatch), `md` for controls (buttons,
  fields), `lg` for panels, windows and dialogs, `full` for pills and badges. A part inside a
  rounded box takes a smaller radius than the box.
- Elevation is a surface and a shadow together: a menu, a tooltip or a popover is
  `surface-raised` with `shadow-sm`; a window or a dialog is `surface-raised` with `shadow-lg`,
  over a dialog's `backdrop`. In the light theme the shadow does the raising (the surfaces are the
  same white), so never leave it out there.
- Layers: the app's windows stack from `--aek-z-window`, the debug windows above them from
  `--aek-z-debug-window`, then dialogs, toasts and tooltips. Each window takes 2 above the last,
  its backdrop 1 below. The windows still read their bases from the code's constants; the tokens
  hold the same values, and the restyle moves the windows onto them.

::: do
A drop-down list: `background: var(--aek-surface-raised); box-shadow: var(--aek-shadow-sm);
border-radius: var(--aek-radius-md);` and its z-index from the layer it opens in.
:::

::: dont
`z-index: 99999` to get on top: it jumps over the dialogs and the toasts, and the next fix does it
again.
:::
