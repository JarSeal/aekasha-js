## List

[What it is and its states](hub:features/ui-kit/library#list), on the public page.

::: note For a later plan
p805 Phase 3 section 1: `data/List.ts` (with `ListRow.ts`, the rows' parts) on `RovingFocus.ts`,
`Filter.ts` and `Selection.ts`, which the tree and the table share. Section 2 adds virtual rows and
reorder (`virtual`, `reorder`: values the app passes, D8). p806 moves the debugger list
(`_dbg__DebuggerList.ts`, 13 sites) onto it: `perItemConfig.toggles` → `actions` (`pressed`,
`iconOff`; a `null` toggle value → `hidden`), `onClick` → `onActivate`, `selectedItemId` →
`selection: 'single'` with `setSelected`, `titlePlaceholder` → `isPlaceholder`, `data` as a
function → `items` on the tab's scheduler. Tab through every button becomes one tab stop with
arrows: the debug suite's page says so.
:::
