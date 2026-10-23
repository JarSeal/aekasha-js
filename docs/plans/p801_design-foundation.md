Status: draft | not-implemented
Category: UI, Refactoring
Epic: p800_debugger-ui-overhaul.md
Blocked by: p802_hub-project-section.md (only its Phase 1, the dev-only pages, merged on its own, for Phase 0's font specimen page: D11)
Blocks: p803_ui-kit-structure-and-core.md, p806_debugger-migration.md
Related: \_DONE_p611_sbp-tooling-profiles-and-marketing.md (D6: an embed leaves the host page alone; the embed profiles), \_DONE_p617_review-input-ui-hud.md (the kit as it is; D8: the embed issue), `docs/issues/ui-kit-in-an-embed.md` (closed here: D4, D9)

# Design Foundation

p800's first child: the tokens the kit, the debugger and the Hub share, their themes, the units
that make the kit work in an embed, motion, the focus ring and the contrast rule, and the fonts.
No new component, and no restyle: at the browsers' default font size the app and the debugger
look exactly as they do today (the scene runner's baselines prove it), except where Phase 4's font
opt-in changes the debugger's and the full page's typeface on purpose.

---

## 1. As found (2026-10-23, `main` at `192292a`, Engine 5.10.2)

### 1.1 p800's grounding, checked

p800 §2 holds, with these differences:

- `_dbg__` files: 109, 36,765 lines (p800: 105, about 36,100). `createDebuggerTab`: 26 call sites
  in 23 files (p800: 25 in 22).
- The kit's `rem` values: 125, not "about 150": `DraggableWindow.module.scss` 67, `DropDown.scss` 25,
  `Toaster.ts`' injected CSS 33. The issue file says 115 (counted before p617's last phases).
- **The debugger's styles hold 399 more `rem`s** in 18 files (`DebuggerGUI.module.scss` 82,
  `Profiler.module.scss` 59, `CharacterStateWindow.module.scss` 53, `DebugKeyShortcuts.module.scss`
  47, `MaterialEditor.module.scss` 43, `About.module.scss` 32, …), plus `rem` strings in
  `_dbg__Assets.ts` (4) and `_dbg__PercentagePie.ts` (1). They must change in the same commit as
  `page.scss`' 62.5 %, or the debugger renders 1.6× larger: p800 counts them as "the conversion
  only", but it is 524 values, not 150. `Viewports.ts` and `Mount.ts` name `rem` in JSDoc only.
- `_dbg__DebuggerGUI.ts` calls `getWindowSize` once (line 237), not twice.
- Beside the windows' `100vw` / `100vh` default max size (`DraggableWindowGeometry.ts:48-49`), the
  dialog backdrop is `100vw` × `100vh` too (`DraggableWindow.module.scss`' `.backDrop`), and
  `DraggableWindowUnit` takes `'vw'` and `'vh'` (public): in an embed they're the browser
  window's, not the container's.
- p800's header names `docs/templates/todo-plan-prompts.txt` as the original prompt: commit
  `208b177` (the plan's) removed it from there. The plan is the record now.
- The HUD root's class is `hudRoot` (id `hudRoot`), not `aekHudRoot` (p800 D2).
- In the Hub's dev mode, `::: embed` removes the `page.scss` `<style>` the untree-shaken `aekasha`
  entry injects (`devTools/hub/CLAUDE.md`, Dev plugin): it changes with `page.scss`.

### 1.2 A contradiction in p800 D4

D4 sets the HUD root's `font-size` to `calc(var(--aek-ui-font-size, 0.875rem) * var(--aek-ui-scale, 1))`
and says "a host page's own root size no longer scales the kit". A `rem` default is the host's
root size: a host with `html { font-size: 62.5% }` would get a 8.75 px kit. The browser's own
default size, which the user sets and the host can't change, is the `medium` keyword; `calc()`
can't multiply a keyword, so D3 below takes it in two steps. p800 D4 is updated to match.

### 1.3 The Hub

- Tokens: `hub/_assets/scss/_tokens.scss` (55 lines with a `--hub-` name), used about 300 times in
  12 SCSS files; no hard-coded colour outside it but `#000` (9) and one `rgb()`.
- The Hub is on the browsers' 16 px root and sizes in `rem` (`0.8125rem`, `0.9375rem`, …): no
  spacing scale.
- Fonts: Inter Variable in `hub/_assets/fonts/` (`@font-face` in `_base.scss`). The engine can't
  read `hub/` (Vite's root is `src/`, and the layer rule), so a font both use lives under `src/`
  and the Hub's build reads it there.
- Theme: `data-theme` on `<html>`, saved by `hub.ts` to `localStorage.aekHubTheme`.

### 1.4 What the inventory still has to do (Phase 0)

Colours: about 430 colour values or Sass colour variables in 21 engine style files and
`variables.scss` (52). Durations: 0.2 s (18), 0.17 s (7), 0.15 s (4), and one each of 700 ms,
150 ms, 0.8 s and 0.075 s, in 11 files. Phase 0 maps each to a role so p803 and p806 restyle from
a table, not a search.

---

## 2. Decisions (confirmed 2026-10-23, as recommended)

### D1. Scope: foundation only, no restyle

The tokens exist and the Hub uses them; the kit's and the debugger's existing styles keep their
colours, spacing and look. They change units (D4) and durations (D7) only, so the scene runner's
baselines don't change through Phase 3. Colours move to roles when p803 (the kit) and p806 (the
debugger) restyle, from Phase 0's inventory. One exception, on purpose: Phase 4's fonts (D8).

### D2. The tokens file and the kit root

- `src/_engine/ui/styles/tokens.css`, plain CSS (Sass `@use`s a `.css` file as is, so the Hub's
  SCSS reads it), in `@layer aek.tokens`. Every component and the Hub import it; it is the one
  shared stylesheet (p800 D10).
- The tokens are on a **kit root**, the class `aekUi`, through `:where(.aekUi)`: the HUD root gets
  it (and keeps `hudRoot`), the Hub puts it on `<html>`, an app puts it on any container its own
  UI goes in outside the HUD (and the Hub's component pages on their demo boxes, p800 D1). Never
  `:root` (an embed leaves the host alone). This replaces p800 D2's `:where(.aekHudRoot)`.
- Roles as in p800 D2. Values: the Hub's where the Hub has the role (`bg`, `surface` ← `panel`,
  `surface-hover`, `border`, `border-strong`, `text`, `text-muted`, `accent`, `accent-hover`,
  `accent-soft`, `warning`, `success`, `danger`), new ones chosen in Phase 1 under D6's contrast
  test (`surface-raised`, `text-disabled`, `on-accent`, `info`, the `-soft`s). The Hub's `error`
  (`#ff7a85`, next to `danger` `#ff7a6b`) has no role: Phase 1 checks where the Hub uses each, and
  folds `error` into `danger` if nothing tells them apart.
- Also tokens: font families (sans, mono; D8), a type scale with weights and line heights, a space
  scale, radii (the Hub's 8 px plus 4, 6 and full), two shadows, motion (D7), the focus ring (D6),
  z-layers (the windows' two layers, dialogs, toasts, tooltips).
- The compact density (`data-aek-density="compact"`, p800 D2) changes the space and type scales
  only. Its values are set here; the debugger opts in in p806.

### D3. Themes

- Dark by default. `@media (prefers-color-scheme: light)` gives light to a kit root without
  `data-aek-theme="dark"`; `data-aek-theme="dark" | "light"` on any element forces its subtree
  (one attribute for the root and a subtree, instead of the Hub's extra `.hubThemeDark` class).
- The Hub's toggle sets `data-aek-theme` on `<html>` next to its `data-theme` (`hub.ts`), so the
  kit inside a Hub page follows the Hub's theme, not only the system's.
- An app sets its theme on the HUD root; `AppConfig` gets nothing in p801 (p808's settings menu
  writes the attribute).

### D4. Units (closes `ui-kit-in-an-embed.md`; changes p800 D4)

- The kit root sets `font-size: medium`: the user's browser default, which a host page's root
  can't change. Two registered custom properties (`@property`, `syntax: '<length>'`,
  `inherits: true`, top-level in `tokens.css`) are computed on the kit root, so they inherit as
  pixels and never compound:
  - `--aek-base: calc(var(--aek-ui-font-size, 0.875em) * var(--aek-ui-scale, 1))`: the UI's
    font size, 14 px at the defaults. The new components (p803 on) set `font-size: var(--aek-base)`
    on their root and size in `em` inside it (p800 D4's model, unchanged).
  - `--aek-rem: calc(var(--aek-base) / 1.4)`: 10 px at the defaults, the old `rem`. **The
    existing styles convert `Nrem` → `calc(N * var(--aek-rem))`**, so they look the same at the
    defaults, follow the browser's font size and the UI scale, and ignore the host's root. p803
    and p806 replace them with `em` tokens when they restyle; `--aek-rem` is `@internal`
    (not documented in the styling guide) and goes when its last user does.
- `--aek-ui-font-size` and `--aek-ui-scale` are set on the kit root only (they're read where
  `--aek-base` is computed). Both are public and documented.
- `page.scss`: no `html { font-size: 62.5% }`; `body`'s `1.6rem` becomes `1rem` (16 px, as
  before). The Hub's dev `::: embed` code that removes `page.scss`' `<style>` is checked against
  the new file.
- **Bounds:** `getWindowSize` (`ui/Window.ts`) measures the HUD root's containing block: the
  viewport in the full-page boot, the mount's container in an embed (`contain: layout`). The
  windows' default max size and the dialog backdrop become `100%` of it (a fixed element's `%`
  resolves against its containing block, so this works in both boots). `'vw'` / `'vh'` window
  units stay the viewport's, as CSS says; their JSDoc says so and points to `'%'` for an embed.
  `DraggableWindowUnit` doesn't change (no break).
- The `resize` hook (`addResizer`, the window's resize) doesn't fire when only an embed's container
  changes: the windows also clamp on the mount's existing `ResizeObserver` (Phase 2 checks
  `Mount.ts`' observer and adds the call if it isn't there).

### D5. Cascade layers

`@layer aek.tokens, aek.base, aek.components, aek.utilities;` is declared once, first in
`tokens.css`. p801 puts only the tokens in a layer: the existing styles stay unlayered until
p803 / p806 restyle them (layering them now would let a host's or an app's unlayered rules beat
them, a visual change in an app with broad selectors). The styling guide (D10) says which parts
are layered yet.

### D6. Contrast and the focus ring

- A Node test (`tokens.test.ts`) parses `tokens.css` and computes the WCAG ratio of every
  text-on-surface pair in both themes: `text`, `text-muted` on `bg`, `surface`, `surface-raised`,
  `surface-hover` ≥ 4.5; `accent` on those and `on-accent` on `accent` ≥ 4.5; `border-strong` and
  the focus ring on `bg` / `surface` ≥ 3. `text-disabled` is exempt (WCAG exempts disabled
  controls) and the test says so. A failing pair names both tokens and the ratio.
- The focus ring tokens: `--aek-focus-ring-width: 2px`, `--aek-focus-ring-offset: 2px`, colour
  `accent`; `.aekUi :focus-visible` gets it in `aek.base` (zero specificity), the one global rule
  p801 adds. Where an existing style removes `outline` (Phase 0 lists them), that rule is
  removed: a visible ring is an accessibility fix, not a restyle. Their baselines don't change
  (the scene runner doesn't focus anything).

### D7. Motion

- `--aek-motion-fast: 120ms`, `--aek-motion-base: 200ms`, `--aek-motion-slow: 320ms`,
  `--aek-ease-standard`, `--aek-ease-emphasized`.
- `@media (prefers-reduced-motion: reduce)` and `--aek-motion: 0` (an app's setting on the kit
  root) set the three durations to `0ms`. The existing transitions take the token closest to
  their value (0.15-0.2 s → `base`, 0.075 s → `fast`, 0.7-0.8 s keep their own value with
  `calc(… * var(--aek-motion, 1))`), so a 0.17 s becomes 0.2 s: too small to see, and recorded in
  Phase 0's table. Animations on a per-frame path keep none (p800 D7).
- The toaster's `animationTimeMs` is JS: it reads `matchMedia('(prefers-reduced-motion: reduce)')`
  when a toast starts and uses 0 then.

### D8. Fonts

- The study (Phase 0, on the dev-only specimen page, D11) as p800 D5 says: sans Inter, Geist,
  IBM Plex Sans; mono JetBrains Mono, Geist Mono, IBM Plex Mono; the pick and its reasons are
  written here as D8's outcome before Phase 4.
- The candidates come from Fontsource's variable packages (`@fontsource-variable/*`, OFL),
  added as dev dependencies for the study and removed after it; the picks' Latin woff2 files and
  licences are copied into `src/_engine/ui/fonts/`.
- `src/_engine/ui/fonts/fonts.css` holds the `@font-face` rules; the `aekasha/ui/fonts` entry
  (`devTools/aliases.ts`, `tsconfig.json`'s `paths`) imports it and exports nothing (an entry of
  only `export … from` lines can't import a stylesheet: Phase 4 checks `aliases.test.ts`' rule and
  either allows a CSS import in this one entry or exports a `FONTS_CSS_URL` constant with `?url`).
- The default sans token is the system UI stack, so an app that doesn't opt in pays nothing. The
  full-page template (`InitEngine`) and the debugger (its drawer's module, a debug chunk) opt in;
  the Hub reads the same files (its `@font-face` points at them; `devTools/hub/assets.ts` copies
  and hashes them).
- If one sans doesn't serve both the Hub and dense panels, the Hub keeps Inter and this decision
  says why.

### D9. The `uiKit` embed profile and the check

- `src/app/profiles/uiKit/` (`uiKit.embed.ts`, a code-made scene, no feature), in
  `sbp.config.ts` with budgets set from its first report: a window, a dialog, a toast, a drop-down
  and the tokens. Its `mount` opens them after the first frame.
- `yarn verify:embed` (`devTools/verify/embed.ts`) gains a scenario for it: mounted `INLINE` in a
  640 × 360 target, on a host with a 16 px root and again with `html { font-size: 62.5% }`. Each
  open element's box is inside the container's, the window's and the toast's font sizes are the
  same at both host roots, the dialog's backdrop covers the container and not the page, and no
  host style changed (the existing check).
- The issue file is closed (`Status: closed`, the fix and the plan named) when this passes.

### D10. Documentation

- The UI kit feature page (`hub/pages/features/ui-kit/`) gets a "Styling" section: the kit root,
  the tokens by group, the themes, the UI scale and font size, the font opt-in, reduced motion,
  and which parts are layered yet (D5). p803 grows it into the full styling guide (p800 D11).
- The embed warning on that page goes; `src/_engine/ui/CLAUDE.md`'s "In an embed" item becomes a
  "Tokens and units" section (a new `##` section: an `aek:covers` on the UI kit page).
- The design document itself is p802's.

### D11. The specimen page needs p802's dev-only pages

The font study's specimen page must not reach the public Hub. p802's Phase 1 (an `aek:dev` meta,
`discoverPages` dropping those pages in `public`) is small and self-contained: it lands first, on
p802's branch, and p801's Phase 0 adds the specimen at `hub/pages/project/font-study/` under it.
(The alternative, a `::: dev-only` block on a public page, would leave an empty page in the
public build.)

### D12. Versions

- Engine minor (5.11.0): the tokens, the `aekasha/ui/fonts` entry, the UI scale and font size
  properties, the embed fix. The changelog's restyle note (p800 D12): the font change of Phase 4
  and how to keep the old one (set `--aek-font-sans`).
- App minor: the `uiKit` profile. Project: the verify scenario and the tests.
- Toolkit: none.

---

## 3. Phases

Branch `p801-design-foundation` from `main` after p802's Phase 1 merged (D11). Verification of
each phase: `yarn test`, `yarn verify:scenes` (baselines recorded on `main` before the first
run), `yarn verify:baselines`, plus the phase's own.

### Phase 0: baselines, inventory, font study

1. `yarn verify:scenes --update` on `main`; `yarn sbp --profile all` numbers noted here.
2. The inventory, written into §4 of this plan as tables: every colour (file, value, the role it
   becomes in p803 / p806, or "debug-only" with its reason: the profiler's budget colours, the
   physics debug draw's), every duration (its token, D7), every `outline: none` (D6).
3. The specimen page (`hub/pages/project/font-study/`, `aek:dev`): each candidate at 11, 12 and
   13 px in a mock dense panel (a label column, number fields, a table of figures, a monitor), and
   at the Hub's body and heading sizes; both themes; `0O 1lI` and tabular figures side by side;
   the label column's characters at 280 px; each woff2's size.
4. Screenshots on macOS, Windows and Android (the developer's own devices, through `yarn dev:https` for the
   phone), the pick, written into D8.

### Phase 1: tokens, themes, contrast (no visual change)

1. `tokens.css` (D2, D3, D5, D6, D7), the `@property` registrations (D4), the `.aekUi :focus-visible`
   rule; imported by `ui/styles/index.scss`.
2. The HUD root gets `aekUi` (`HUD.ts`).
3. `tokens.test.ts`: the contrast pairs (D6), every role defined in both themes, the compact
   density defining only space and type tokens, `@property` names registered once.
4. The SBP budget line for `tokens.css` in the `app` and `banner` profiles.

### Phase 2: units and bounds (the embed fix; no visual change at 16 px)

1. `page.scss` (D4). Every `Nrem` in the kit's and the debugger's styles and the five `.ts`
   strings → `calc(N * var(--aek-rem))`, by a one-off script (`npx tsx`, from the scratchpad,
   not committed: p803 and p806 restyle rather than convert again) so nothing is missed: `grep -rE
'[0-9]rem\b' src/_engine` finds nothing after it but the JSDoc. The `0.17s`-style durations →
   tokens (D7).
2. `getWindowSize` on the containing block, the `100%` max size and backdrop, the units' JSDoc,
   the container resize (D4); `DraggableWindow.test.ts` and `DialogWindow.test.ts` updated for the
   new measurement.
3. The Hub's dev `::: embed` `page.scss` handling (§1.1).
4. `yarn verify:scenes`: no baseline changes. A manual pass at a 20 px browser font size: the
   kit and the debugger scale by 1.25 and nothing overlaps (the drawer's width is `rem`-based, so it
   grows too: noted for p806 if it's too wide on a small screen).

### Phase 3: the `uiKit` profile and the embed check

D9: the profile, its budgets, the `verify:embed` scenario, the issue file closed.

### Phase 4: fonts

D8 with the study's pick: the files in `src/_engine/ui/fonts/`, the entry, the opt-ins (the
full-page template, the debugger), the Hub on the same files. The scene runner's baselines with
debugger UI change here on purpose: `yarn verify:scenes --update`, the diffs looked at first.

### Phase 5: the Hub on the shared tokens

- `--hub-*` become aliases of `--aek-*` for each role (`--hub-panel: var(--aek-surface)`); the
  Hub-only ones (`gradient`, `header-bg`, `code-*`, the layout widths) stay `--hub-*`. The Hub's
  `<html>` gets `aekUi`; `hub.ts`' toggle sets `data-aek-theme` (D3); `--hub-font` reads
  `--aek-font-sans` if Phase 4 shared the sans. The Hub's own focus styles use the ring tokens.
- A test (`devTools/hub/`) checks every aliased `--hub-*` resolves to a `--aek-*` and that the
  Hub's computed colours are unchanged from Phase 0 (a value list taken then).
- Aliases rather than moving the Hub's ~300 references to `--aek-*` (p800 §8's question): one
  file changes, the Hub's SCSS reads the same, and a later rename can be a codemod.

### Phase 6: the Hub's UI kit page, `CLAUDE.md`, readme

D10. `src/_engine/ui/CLAUDE.md`, the root `CLAUDE.md` (Three-folder split: `ui/fonts/`; the
`aekasha/ui/fonts` entry under Build config notes), `devTools/sbp/CLAUDE.md` (the `uiKit` profile),
`devTools/verify/CLAUDE.md` (the scenario), `readme.md` if it lists the UI kit's features.
`yarn hub:build`.

### Phase 7: versions and done

D12; `yarn checkVersions --against main`; mark the plan done; p800 §5's p801 entry points here.
Time for the PR: `p801-design-foundation` → `main` (p800 §6).

---

## 4. Inventory

Filled in Phase 0.

---

## 5. Risks

- **`@property` support**: Chrome 85, Safari 16.4, Firefox 128. Every browser with WebGPU has it;
  the WebGL2 fallback's older browsers would compute `--aek-rem` as unregistered (it would then
  inherit as an unresolved `em` and compound). Phase 1 checks the floor in `readme.md`'s browser
  list and, if it's lower, adds a fallback (`--aek-rem: 10px`-style declaration before the
  computed one).
- **524 conversions**: the codemod and unchanged baselines are the check; a `calc()` inside a Sass
  expression (`$x * 2` with a `rem` variable) can't be multiplied by Sass. Phase 2's script
  flags each such use for a hand fix.
- **The scene runner can't see focus or a 20 px font size**: Phase 2's manual pass and Phase 3's
  embed check cover them.

## Done when

`tokens.css` is the kit's and the Hub's one source, with the contrast test passing in both
themes; the kit and the debugger look as before at 16 px and follow the browser's font size and
`--aek-ui-scale`; the `uiKit` embed passes `yarn verify:embed` at both host roots and the issue is
closed; the fonts are opted into by the full page, the debugger and the Hub; the UI kit page
documents it.
