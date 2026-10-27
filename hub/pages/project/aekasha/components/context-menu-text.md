## Context menu

[What it is and its states](hub:features/ui-kit/library#context-menu), on the public page.

::: note For a later plan
p805 Phase 1 section 4: `overlays/ContextMenu.ts` on the menu's surface (`createMenuSurface`, at a
point). The list takes none as a prop (Phase 3 section 1): the app makes one on `list.cmp.elem` and
finds the row with `getKeyAt`, so a list without a menu carries none of its code; the tree and the
table follow (Phases 3 and 4). p806 moves the debugger's lists onto them.
:::
