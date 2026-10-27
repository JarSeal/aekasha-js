## Tabs

[What it is and its states](hub:features/ui-kit/library#tabs), on the public page.

::: note For a later plan
p805 Phase 2 section 1: `components/Tabs.ts` on `RovingFocus.ts`. p806 moves the debugger's tab
menus onto it (the drawer's, the profiler window's and the editor drawer's icon menus with
`iconOnly`, the key shortcuts dialog's tab list) and decides how the tab host mounts its content:
a function `content` per tab, or one panel it fills itself. The drawer's 15 tabs wrap in two rows
today; the tabs scroll instead (no `wrap` option yet).
:::
