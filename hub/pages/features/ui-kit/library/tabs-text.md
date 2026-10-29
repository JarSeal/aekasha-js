## Tabs

`createTabs({ label, tabs })` puts a tab list over panels, one shown at a time (the APG tabs:
`role="tablist"`, `tab`, `tabpanel`). A tab has a `label`, and optionally an `icon` (`iconOnly`:
the label read by assistive tech and shown as a tooltip), a `badge`, `disabled` and
`separatorBefore` (a divider before it, setting a group of tabs apart); its `content` is a CMP,
or a function that builds it on the tab's first selection, kept after (`keepMounted: false`
removes it when another tab is selected). The tab list is one tab stop, the selected tab: the
arrows along it move the focus (wrapping, disabled tabs skipped), Home and End to the ends. With
automatic activation (the default) the focus selects; with `activation: 'manual'` Enter or Space
does. Tab goes on to the panel. An overflowing tab list scrolls, its cut edges faded.

- **States:** drawn in the page: scene settings (automatic, a badge with a warning tone, a
  disabled tab), an inspector (manual, its Stats panel built on its first selection and saying how
  often it was), a vertical icon-only debugger menu with a divider before its scene tab, and ten
  layers in a narrow box, whose list overflows; **Select Layer 6** scrolls it to the middle, both
  edges faded. The status line says what the user selected.
