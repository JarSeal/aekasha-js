The UI kit's pieces (`aekasha/ui`) running in this page, for the people building Ækasha: open
each piece's states, see which debug tools use it, and what it adds to a build. It shows what
exists today; p803-p808 add their components here as they build them, and p803 adds the public
library page.

The page runs no engine (p800 D1: every component works without it). Today the kit needs two
things the Hub supplies itself:

- **A HUD root.** The windows, dialogs and toasts go under it, and only the engine's boot makes
  one: this page makes it with the boot's own internal function. It sits over the viewport, as
  in an app, so the demos open over the page and stay in view while it scrolls.
- **Stand-ins for two modules** the kit's bundle reaches
  ([`kitStandIns.ts`](repo:devTools/hub/kitStandIns.ts)): the main loop (whose real module
  brings three and both workers along, for one name) and the storage (this Hub shares the app's
  `localStorage`, so the demo windows keep their state in memory and never touch the app's saved
  windows). A window follows the browser window's resizes, but nothing restores it from storage
  on a reload, and a debug window doesn't open: those need the boot.

The design these follow is the [design document](hub:project/aekasha/design)'s.
