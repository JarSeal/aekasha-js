**Title:** `yarn verify:ui` fails two screenshots intermittently: `settingsMenu`'s flash and `itemDetails`' tooltip

Status: open
Category: Tooling (`yarn verify:ui`)
Found: 2026-11-05, p622 Phase 8 (the full check before the engine 6.0.0 release)
Our workaround: run the failed piece again with `--only <piece>`, and take a pass as the result. Don't record either state with `--update` until this is fixed: the baseline would get whichever rendering that run caught.

## What happens

Two states of the component library's demos fail some runs and pass others. Each failure is one
of exactly two renderings: the same deltas repeat across runs, on `main` (`a0b15403`) and on
`p622_engine-6-major` alike.

| Piece and state                          | Settings that fail        | Delta when it fails                                              |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| `settingsMenu`, "Changed from outside"   | light, light compact      | mean 0.08-0.10, 0.39-0.40 % of the pixels (the UI scale's field) |
| `itemDetails`, "Show the slot's tooltip" | dark, light (one or both) | mean 2.78 (dark), 3.36 (light), 3.77 / 3.88 % of the pixels      |

Seen on macOS (Chromium, the local baselines in `.cache/verify/ui/baseline/`):

- Two full runs on the branch and one on `main`: both states failed every time, with the same
  deltas.
- Alone: `--only itemDetails` passed four runs out of five; `--only settingsMenu` failed three
  runs out of four.
- In pairs, `--only <piece>,itemDetails`: it failed after `settingsMenu` and `inventoryGrid`, and
  passed after `gameMenu`, `controlsPage`, `itemSlot` and `hotbar`. That looked like state leaking
  from earlier pieces, through the browser context each setting shares for the whole run
  (`ui.ts`' `createSettingContextAsync`: its `localStorage` and caches). The alone runs say
  otherwise: these are races that a full run's load makes more likely, not leaks.

## `settingsMenu`: the shot races the field's flash

"Changed from outside" sets the menu's `uiScale` from code and calls `refresh()`
(`hub/_assets/ts/_library/gameMenus.ts`), so the UI scale's number field flashes. In the failing
shot its box has the flash's `accent-soft` tint; in the baseline it doesn't.

The flash is an attribute, not an animation: `createFlash` (`ui/forms/binding/BindingScheduler.ts`)
sets `data-flash` and removes it with a `setTimeout` after `FLASH_MS` (200 ms). While it's set,
`Field.scss`' `.aekField__box[data-flash]` holds the tint with `transition-duration: 0s`, so
nothing is animating. The settle check (`ui.ts`, after the steps: no animation from
`document.getAnimations()`, and the HUD root's boxes the same on two polls) can pass inside those
200 ms and shoot the tint. If it runs later, the fade back is a transition, which it waits out,
and the shot has no tint. Which happens depends on how fast the page answers the polls.

## `itemDetails`: the tooltip's text a sub-pixel off

The state opens a tooltip whose content is an item details CMP (`gameItems.ts`:
`tip.show()` on an item slot). The two renderings are the same text antialiased differently on
every line, as a fraction-of-a-pixel offset does (the box was aligned to whole pixels first,
`uiPage.ts`' `alignBoxAsync`). The cause isn't found. A likely one: the tooltip centres itself on
the slot with its own width, so a width measured before its content finished laying out (the
details' figures, a font) puts it a fraction off, and nothing moves it after the settle's two
polls.

## What it would take

- **The flash:** the settle wait also waits until no element in the box or the HUD root has
  `data-flash`. A flash is transient by definition, and this fixes every field that flashes, not
  only this state. With that in, record `settingsMenu`'s four "Changed from outside" shots again.
- **The tooltip:** log the tooltip's `getBoundingClientRect()` and the slot's at the shot in both
  outcomes (a failing run is easy to get with `--only inventoryGrid,itemDetails`). If its `x` or
  its width differs by a fraction, round the tooltip's position in the kit (the anchor's code), or
  have the settle wait compare unrounded boxes over a frame more. Then record its shots again.
- Then a full `yarn verify:ui` run twice without a failure. The CLI's header comment
  ("so no state leaks into the next") also needs a correction: the contexts are per setting and
  shared by the whole run, so `localStorage` and caches do carry over. Nothing found here depends
  on that, but a demo that writes `localStorage` would.
