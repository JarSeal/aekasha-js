**Title:** The UI kit sizes itself for the full page: `rem`s on the template's root and the browser window's box

Status: open | for p800 (the UI kit restyle)
Category: UI, Embed
Found: 2026-10-20, p617 §1.4 (S2, W5); filed in p617 D8
Our workaround: none needed yet: no embed profile shows kit UI (the banner has none). An app that does sets its own sizes on the components it makes

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
  `ui/Window.ts`' `getWindowSize` (`window.innerWidth` / `innerHeight`) is what
  `DraggableWindowGeometry.ts`' `keepOnScreen`, `isFittable`, `fitWindow` and the cascade use, and
  a window's default max size is `100vw` × `100vh`. A mount's container has `contain: layout`,
  so the HUD's fixed elements are placed relative to the container: a window can be clamped to,
  fitted to, or cascaded across a box the size of the page, inside a container that's smaller.

## Why it isn't fixed here

p617 fixed, documented and exported the kit as it is; p800 restyles every component and adds
new ones, and picks their units then. Changing about 115 values in four style files now, for p800
to rewrite, would be work done twice, and no embed shows kit UI yet.

## What a fix needs (p800)

1. Units that work in both boots: a `--aek-rem`-style custom property set on the HUD root (by
   `page.scss` for the full page, by the mount's container otherwise), or `px`, or `em` from a
   font size the HUD root sets. The debug modules' styles follow the same rule.
2. `getWindowSize` reading the HUD root's container (the page in the full-page boot, the mount's
   container in an embed), and the default max size in the same box (`100%` of it, not `vw` /
   `vh`).
3. A check: `yarn verify:embed` mounting a profile that opens a window, a dialog and a toast, and
   comparing their boxes with the container's.
