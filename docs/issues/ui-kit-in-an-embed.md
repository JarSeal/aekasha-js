**Title:** The UI kit sizes itself for the full page: `rem`s on the template's root and the browser window's box

Status: fixed | 2026-10-24, p801 (D4, Phases 1-3; checked by D9's `uiKit` embed)
Category: UI, Embed
Found: 2026-10-20, p617 §1.4 (S2, W5); filed in p617 D8
Our workaround (until p801): none needed: no embed profile showed kit UI (the banner has none)

## What happens

The UI kit (`src/_engine/ui/`, `aekasha/ui`) was built for the full-page boot (`InitEngine`),
which loads `ui/styles/page.scss`: normalize and the `html` and `body` rules, among them
`html { font-size: 62.5% }`, so 1 rem is 10 px. A mounted engine (`mountAekasha`,
`kernel/init/Mount.ts`) loads only `ui/styles/index.scss` and leaves the host page's root alone
(p611 D6). Two things then go wrong for kit UI in an embed:

- **Sizes.** The kit's styles are `rem`s on that 10 px root: `DraggableWindow.module.scss` (61
  values), `DropDown.scss` (21) and the toaster's injected CSS (`Toaster.ts`, 31), and the debug
  modules' styles that build on them. On a host page at the browsers' default 16 px root, every
  one renders 1.6 × larger; on a host with its own root size, at that.
- **Bounds.** The draggable windows measure the browser window, not the mount's container:
  `ui/core/Window.ts`' `getWindowSize` (`window.innerWidth` / `innerHeight`) is what
  `DraggableWindowGeometry.ts`' `keepOnScreen`, `isFittable`, `fitWindow` and the cascade use, and
  a window's default max size is `100vw` × `100vh`. A mount's container has `contain: layout`,
  so the HUD's fixed elements are placed relative to the container: a window can be clamped to,
  fitted to, or cascaded across a box the size of the page, inside a container that's smaller.

## Why it isn't fixed here

p617 fixed, documented and exported the kit as it is; p800 restyles every component and adds
new ones, and picks their units then. Changing about 115 values in four style files now, for p800
to rewrite, would be work done twice, and no embed shows kit UI yet.

## What a fix needs (p800 D4, done in p801)

1. Units that work in both boots: a `--aek-rem`-style custom property set on the HUD root (by
   `page.scss` for the full page, by the mount's container otherwise), or `px`, or `em` from a
   font size the HUD root sets. The debug modules' styles follow the same rule.
2. `getWindowSize` reading the HUD root's container (the page in the full-page boot, the mount's
   container in an embed), and the default max size in the same box (`100%` of it, not `vw` /
   `vh`).
3. A check: `yarn verify:embed` mounting a profile that opens a window, a dialog and a toast, and
   comparing their boxes with the container's.

## Fix

p801 (the design foundation, D4) changed both, and its Phase 3 checks them in a page:

- **Sizes.** The kit root (`.aekUi`, the HUD root's class) sets `font-size: medium`, the user's
  browser default, which a host page's root can't change, and computes `--aek-base` (14 px at
  the defaults) and `--aek-rem` (10 px, the old `rem`) from it, registered with `@property` so
  they inherit as pixels (`ui/styles/tokens.css`). Every `rem` in the kit's and the debugger's
  styles became `calc(N * var(--aek-rem))` (p801 Phase 2), and `page.scss` lost its 62.5 % root:
  the full page looks the same, and an embed sizes like it at any host root. They follow the
  browser's font size and `--aek-ui-scale` too.
- **Bounds.** `mountAekasha` makes its container the HUD's bounds (`ui/core/Window.ts`'
  `setWindowBoundsElement`): `getWindowSize` measures it, with its viewport position, so the
  clamps, the fits, the cascade and a drag's start work in the container's box (a drag used to
  jump by the container's offset, a bug this issue didn't name). The windows' default max size
  and the dialog backdrop are `100%` of their containing block, the container in an embed. The
  container's `ResizeObserver` (the canvas size source) runs the windows' resizer, so they clamp
  when only the container changes. `'vw'` / `'vh'` window units stay the browser window's, as CSS
  says (their JSDoc points to `'%'`).

The evidence: `yarn verify:embed`'s scenario for the `uiKit` profile (`src/app/profiles/uiKit/`,
a window, a toast and a dialog with an open drop-down) mounts it in a 640 × 360 target on a host
with a 16 px root and again with `html { font-size: 62.5% }`: every element inside the container,
the window at its px position from the container's corner, the dialog centred in it, the backdrop
covering it and not the page, the font sizes the same at both roots (window 12 px, toast 14 px),
a drag moving the window by the pointer's distance, and the window inside after the target
shrinks. Each check was seen failing on a broken copy (the origin fix reverted, `--aek-rem` on the
host's root, the backdrop at `100vw` × `100vh`, no bounds element). Chromium only.

Left for p803 (the kit's restyle), seen in the same embed: a drop-down list's `max-height: 40vh`
is the browser window's; a `closeOnEscape` dialog takes Escape from the whole host page while
it's open; the toast's text colour, the kit's font and the buttons' font come from the host page
(no normalize in an embed); a window clips a drop-down list that overflows it.
