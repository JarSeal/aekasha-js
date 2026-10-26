**Title:** Four small UI kit questions p803 left open: normalize's layer, hold to confirm, two Hub shots

Status: open | for the UI kit's next plan (p804)
Category: UI, Accessibility, Hub
Found: 2026-10-25 and 2026-10-26, p803 Phases 6-8 (`_DONE_p803_ui-kit-structure-and-core.md`)

Each was found while building p803's components and left for a decision, not a fix. None blocks
an app. The fifth item p803 left, the button bringing Kbd, is in p804's sketch
(`p800_debugger-ui-overhaul.md` §5).

## 1. `normalize.scss` beats the kit's layered rules on a button

The full-page boot's `page.scss` (`src/_engine/ui/styles/`) forwards `normalize.scss` unlayered,
so its `button { font-size: 100%; line-height: 1.15 }` beats every layered kit rule on a button
(p803 D5: the kit is in `@layer aek.components`). The kit's button works around it by putting its
size on its parts (`--aek-button-font-size`, `--aek-button-height`), but the drop-down's trigger
takes `line-height: 1.15` in an app and the kit's `--aek-line-height-base` in the Hub (which has no
normalize). An embed has neither.

Proposed: normalize in a layer below the kit's (`aek.page`, named first in `tokens.css`' layer
order statement, so either stylesheet may load first). An app's own CSS still beats it, and the
button's size could go back on the button.

## 2. Hold to confirm ignores a click with no press

`createButton({ holdToConfirmMs })` acts only after a held pointer, Space or Enter, and ignores every
`click` (`src/_engine/ui/components/Button.ts`, `createHoldToConfirm`). A screen reader in browse
mode activates a button with a click and no press, so its user can't confirm this way: they hold
Space in focus mode. The JSDoc, the Hub's core components page and the component library say so,
and that an app offers another way (a dialog). Open: whether a click with no press should act at
once, or open a confirmation, instead.

## 3. The indeterminate progress bar's screenshot shows an empty track

`yarn verify:ui` pauses every infinite animation at its start for a stable shot
(`devTools/verify/ui.ts`' settle loop: `currentTime = 0`). At its start the indeterminate bar's
slide (`aekProgressSlide`) is still off the track's left edge, so the progress bar box's shot has
an empty track. Not wrong, but the shot doesn't show the state. A fix: pause at a set fraction of
the duration, or let a box's checks name the time.

## 4. A long custom property name breaks mid-word in a Hub table cell

The UI kit pages' reference tables (`hub/pages/features/ui-kit/core/`, `overlays/`) list each
component's custom properties as inline code, and the Hub's inline code wrapping breaks a long
name (`--aek-window-header-height`) anywhere, mid-word, in a narrow cell. Readable, but a break at
the hyphens would read better.
