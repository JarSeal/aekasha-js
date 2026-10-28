The UI kit's pieces (`aekasha/ui`) running in this page, for the people building Ækasha: the same
demos as the public [component library](hub:features/ui-kit/library), with what only developing
the kit needs: which debug tools use each piece, the notes for the plans that change it, and what
the kit adds to a build. Each piece's text links its public one, which says what it is and what
its states show. p804-p808 add their components to both pages as they build them.

The page runs no engine (p800 D1: every component works without it):

- **A HUD root.** The windows, dialogs and toasts go under it. The engine's boot makes it in an
  app; this page makes it with `createHudRoot`, as any page without the engine does, and gets the
  kit's global styles with it. It sits over the viewport, as in an app, so the demos open over
  the page and stay in view while it scrolls.
- **A stand-in for the storage** ([`kitStandIns.ts`](repo:devTools/hub/kitStandIns.ts)): this
  Hub shares the app's `localStorage`, so the demo windows keep their state in memory and never
  touch the app's saved windows. A window follows the browser window's resizes, but nothing
  restores it from storage on a reload, and a debug window doesn't open: those need the boot.

`yarn verify:ui` checks the public page, as the public Hub builds it: each demo's states in both
themes and both densities with axe-core and against its last good screenshot, and each piece's
keyboard script ([`_componentChecks.ts`](repo:hub/_assets/ts/_componentChecks.ts), which merges a
module per group next to its demos in `hub/_assets/ts/_library/`). A violation the kit still has goes on its allow list
([`ui.config.ts`](repo:devTools/verify/ui.config.ts)) with the plan that fixes it; it's empty.

The design these follow is the [design document](hub:project/aekasha/design)'s.
