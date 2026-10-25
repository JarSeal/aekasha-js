## Spacing and layout

Every size is computed from one unit, `--aek-base`: 14 px at the browser's default font size,
times `--aek-ui-scale`. It's a registered property, computed once on the kit root (an element with
the class `aekUi`), so it inherits as pixels and never compounds, and a host page's root size
doesn't touch it. The tokens live on the kit root, never on `:root`, so an embed leaves its host
page alone.

- Space comes from the scale: about `space-2` to `space-3` inside a control (an icon and its
  label), `space-3` to `space-4` between controls in a group, `space-5` to `space-6` between
  groups. The compact density tightens the same steps.
- The UI's bounds are the HUD's container, not the browser window: in an embed that's the mount's
  container. A window or a dialog sizes in `%` of it; `vw` and `vh` are the browser window's.
- Media queries are in px and don't follow the UI scale: lay out with the container's size
  (flex, grid, container queries) where you can.

::: do
`padding: var(--aek-space-3) var(--aek-space-4); gap: var(--aek-space-2);` on a button with an
icon.
:::

::: dont
`padding: 6px 10px` or a `margin` in `vw`: the first ignores the UI scale and the density, the
second the embed's container.
:::
