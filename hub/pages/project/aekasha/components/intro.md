The UI kit's pieces (`aekasha/ui`) running in this page, for the people building Ækasha: open
each piece's states, see which debug tools use it, and what it adds to a build. It shows what
exists today; p803-p808 add their components here as they build them, and p803 adds the public
library page.

The page runs no engine (p800 D1: every component works without it):

- **A HUD root.** The windows, dialogs and toasts go under it. The engine's boot makes it in an
  app; this page makes it with `createHudRoot`, as any page without the engine does, and gets the
  kit's global styles with it. It sits over the viewport, as in an app, so the demos open over
  the page and stay in view while it scrolls.
- **A stand-in for the storage** ([`kitStandIns.ts`](repo:devTools/hub/kitStandIns.ts)): this
  Hub shares the app's `localStorage`, so the demo windows keep their state in memory and never
  touch the app's saved windows. A window follows the browser window's resizes, but nothing
  restores it from storage on a reload, and a debug window doesn't open: those need the boot.

`yarn verify:ui` checks this page: each demo's states in both themes and both densities with
axe-core and against its last good screenshot, and each piece's keyboard script
([`_componentChecks.ts`](repo:hub/_assets/ts/_componentChecks.ts), next to the demos). A
violation the kit still has is on its allow list
([`ui.config.ts`](repo:devTools/verify/ui.config.ts)) with the p803 phase that fixes it.

The design these follow is the [design document](hub:project/aekasha/design)'s.
