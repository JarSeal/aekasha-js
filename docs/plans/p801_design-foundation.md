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

   As built (section 1, 2026-10-23, `p801-design-foundation` cut from `main` at `f962bb3`, p802
   Phase 1 merged; no `src/` change since `192292a`, so §1 holds):

   - Scene baselines: 100 recorded (25 scenes × 4 configurations), Chromium, WebGPU, on macOS,
     in 392 s (`.cache/verify/scenes/webgpu/baseline.json`, local).
   - SBP, both profiles within budget, no diff against `bundle.json` / `bundle.banner.json`:

     | profile  | initial (gzip)     | lazy (gzip)          | `_engine/ui` initial / lazy |
     | -------- | ------------------ | -------------------- | --------------------------- |
     | `app`    | 379.8 kB (2 files) | 1685.4 kB (74 files) | 4.0 kB / 10.2 kB            |
     | `banner` | 285.5 kB (3 files) | 759.4 kB (27 files)  | 3.9 kB / -                  |

     `assets/index.css` is 0.9 kB against a 3 KiB budget (the report says lower it to 2 KiB):
     left alone, since Phase 1's `tokens.css` lands in it.

   - Corrections to §1.1 found on the way: `Toaster.ts`' injected CSS has 14 `rem` values, not 33
     (the kit's are 67 + 25 + 14 = 106, with `variables.scss` 4 and `page.scss` 1); the 524 is
     every `rem` in the engine's SCSS (21 files, `Viewports.module.scss`' 9 among them), and the
     `.ts` strings to convert are 14 (`Toaster.ts`) + 6 (`_dbg__Assets.ts`, in 4 strings) + 1
     (`_dbg__PercentagePie.ts`, a JSDoc default only): 538 values in all. `page.scss`' font is a
     Lucida Sans / Geneva / Verdana stack, not a system UI stack (p800 §2.4): an embed's kit
     inherits the host's font today, so Phase 1's tokens set no `font-family` on `.aekUi` until
     Phase 4 (D1: no visual change), and the "keep the old font" changelog note (D12) names that
     stack.

2. The inventory, written into §4 of this plan as tables: every colour (file, value, the role it
   becomes in p803 / p806, or "debug-only" with its reason: the profiler's budget colours, the
   physics debug draw's), every duration (its token, D7), every `outline: none` (D6).

   As built (section 2): §4, with z-layers (§4.7) and the Hub's reference values (§4.8) added.
   What it changes for the later phases:

   - The profiler's budget colours and the physics debug draw's aren't in the styles: the budget
     colours are `$debugValueWarn` / `$debugAlertLight` / `$debugBoolTrue` (status roles), the
     debug draw's are 3D colours in `.ts` (§4.1: out of the inventory).
   - Phase 1: D2 gains a `backdrop` token (the dialog's `rgba(0,0,0,0.8)`, the Hub search's
     `rgb(3 6 12 / 60%)`); the ring rule comes with the removal of `normalize.scss`'
     `:-moz-focusring` rule, which would beat it in Firefox (§4.5).
   - Phase 2: the outline removals are 6 declarations, one of them `nakedButton`'s, which 18
     button styles include (§4.5). The scene loader's JS-timed fades (150 / 250 ms) follow
     reduced motion as the toaster does (§4.6; D7 names only the toaster).
   - p803 / p806: the scene tab's green is a category, not `info` (p800 D6); the pairs of §4.4
     fail AA today, fixed by the restyle, not here.

3. The specimen page (`hub/pages/project/font-study/`, `aek:dev`): each candidate at 11, 12 and
   13 px in a mock dense panel (a label column, number fields, a table of figures, a monitor), and
   at the Hub's body and heading sizes; both themes; `0O 1lI` and tabular figures side by side;
   the label column's characters at 280 px; each woff2's size.

   As built (section 3):

   - Dev dependencies, pinned: `@fontsource-variable/inter`, `geist`, `ibm-plex-sans`,
     `jetbrains-mono`, `geist-mono` 5.3.0, and `@fontsource/ibm-plex-mono` 5.3.0. IBM Plex Mono
     has no variable build: the page loads its static 400, 500, 600 and 400 italic, so its size
     isn't one file like the others'. All six are OFL 1.1. The Hub's Inter files are the same
     files as Fontsource 5.3.0's (byte for byte).
   - The page is `index.html` with an inline `<style>` and `<script type="module">`, and
     `intro.md` (what's judged and how, the devices); `aek:dev` comes from `project/`. No generator
     change: the script gets each woff2's URL from the dev server as `/@id/<package file>?import`
     (Vite's asset module, `export default "/@fs/…"`, without Vite's client), loads it with the
     `FontFace` API, and measures in the browser. A static asset in `hub/_assets/` or a script
     entry would have been in the public build; a dev page is removed before it renders, so its
     markup never reaches `dist-hub/` (checked: a `--no-api --no-embed` build has no `project/`,
     no reference to the study and only the Hub's two Inter files). The search skips `<script>`
     and `<style>`.
   - Besides the candidates, two references: the debugger's font today (the Lucida stack, §1
     section 1) and the system UI stack (D8's default token), plus the system mono (the Hub's
     mono today). A pairing view sets the sans, the mono and whether numbers use the sans' tabular
     figures or the mono, over the panel at 11, 12 and 13 px in both themes; each font's own
     section has its glyphs, its panels and the Hub's sizes (body 16 px / 1.65, h1 44, h2 26,
     h3 20; the mono at the code blocks' 14 px).
   - First numbers (macOS, Chrome, headless), the label sample's characters in 280 px at 11 / 12 /
     13 px, and the Latin normal woff2:

     | Font                | 11 px | 12 px | 13 px | x-height | normal woff2 | all faces |
     | ------------------- | ----- | ----- | ----- | -------- | ------------ | --------- |
     | Inter               | 50    | 46    | 42    | 54.6 %   | 47.1 KiB     | 97.7 KiB  |
     | Geist               | 52    | 48    | 44    | 53.0 %   | 28.7 KiB     | 59.0 KiB  |
     | IBM Plex Sans       | 53    | 49    | 45    | 51.6 %   | 44.6 KiB     | 93.6 KiB  |
     | Today (Lucida)      | 49    | 45    | 41    | 53.0 %   | (system)     |           |
     | System UI           | 50    | 46    | 43    | 50.8 %   | (system)     |           |
     | JetBrains Mono      | 42    | 38    | 35    | 55.0 %   | 39.5 KiB     | 81.4 KiB  |
     | Geist Mono          | 42    | 38    | 35    | 53.0 %   | 22.6 KiB     | 47.5 KiB  |
     | IBM Plex Mono (400) | 42    | 38    | 35    | 51.6 %   | 14.4 KiB     | 60.2 KiB  |

   - After the study (Phase 4): the dev dependencies removed, and the page moved into p802's
     `design/` as the fonts' record or removed (p802 D5); it can't stay as is once the packages
     are gone.

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

Taken in Phase 0 (2026-10-23, `f962bb3`): every declaration in the engine's 25 style files and
`Toaster.ts`' injected CSS, parsed with its selector (a scratchpad script, not committed). The
roles are what p803 (the kit's files) and p806 (the debugger's) restyle to; nothing changes colour
in p801 (D1). File names drop `.module.scss` / `.scss`; a line number is the declaration's.

### 4.1 Colours: counts

- 321 colour declarations (338 values) in 18 style files and the toaster's CSS. Seven style files
  have none (`AxesGizmo`, `EnvBall`, `EditorDrawer`, `Viewports`, `index`, `page`, `normalize` but
  its two focus rules, §4.5). §1.4's "about 430" counted every `$` name, declarations included;
  the tables below hold every declaration.
- 29 are `currentColor` (8) or `transparent` (21): no role, unchanged.
- The `.ts` colours are not UI roles and stay out: the boot banner's and `ECSHelpers.ts`' console
  log styles, the 3D scene's (the axes gizmo's axis colours and its canvas labels, the ray
  helpers', the character gizmos', the physics debug draw's, the spatial grid's, the 3D symbols'),
  the sky box's defaults, stats-gl's panel colours (`_dbg__Stats.ts`, p807) and the material
  editor's preview background (a scene colour).

### 4.2 Colours: the Sass variables

`variables.scss` and the character window's three locals. Today's text has three greys (white for
headings and figures, `#bbbcc4` for body text, `#848695` for secondary); the kit has two roles,
so white and `#bbbcc4` both become `text` and p806 keeps headings and figures apart by weight.
"Selected" below is the current tab, segment, list item or tool: today an inverted grey, the
`accent` in the restyle (p800 D6: the current item and selection are the accent's).

| Variable (value)                                                                                                                                                       | Use (count: where)                                                                                                                                                  | Role                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `$debugTextColor` (`#bbbcc4`)                                                                                                                                          | text (30: everywhere)                                                                                                                                               | `text`                                                                                                         |
|                                                                                                                                                                        | text on hover (1: `DebugKeyShortcuts:33`)                                                                                                                           | `text`                                                                                                         |
|                                                                                                                                                                        | icon fill (3: `DebuggerGUI:182, 509`, `OnScreenTools:173`)                                                                                                          | `text`                                                                                                         |
|                                                                                                                                                                        | button border (3: `DebuggerGUI:168, 221, 240`; 1: `_debugTabButtons:13`)                                                                                            | `border-strong`                                                                                                |
|                                                                                                                                                                        | scrollbar thumb (7: `About`, `DebugKeyShortcuts`, `DebuggerGUI`, `MaterialEditor`, `Profiler`, `DraggableWindow`, `DropDown`)                                       | `border-strong`                                                                                                |
|                                                                                                                                                                        | focus border / outline / box-shadow (4: `DebuggerGUI:500`, `MaterialEditor:198`, `CharacterStateWindow:358`, `DropDown:38`)                                         | the focus ring (§4.5)                                                                                          |
|                                                                                                                                                                        | selected background (4: `DebuggerGUI:397`, `OnScreenTools:152`, `_debugTabButtons:26`, `Assets:62`; hover of it 2: `Profiler:231`, `Assets:66`)                     | `accent`                                                                                                       |
|                                                                                                                                                                        | collapse / close button marks (2: `DraggableWindow:178, 236`)                                                                                                       | `text-muted` (`text` on hover)                                                                                 |
|                                                                                                                                                                        | the small icon button's background (`DraggableWindow:303`)                                                                                                          | p803's icon button: `surface-hover`                                                                            |
|                                                                                                                                                                        | a profiler bar's in-view part (`Profiler:299`)                                                                                                                      | p805's bar: `text-muted`                                                                                       |
| `$debugTextColorDark` (`#bbbcc4` −20 % lightness = `#848695`; also `$dimText`, and the 11 `color.adjust(…, -20%)` written out in `Profiler` and `DraggableWindow:291`) | text (27 + 6 `$dimText` + 11)                                                                                                                                       | `text-muted`                                                                                                   |
|                                                                                                                                                                        | borders: tab bar, footers, `kbd`, the clear-LS button (5: `About:135`, `DebugKeyShortcuts:14, 117, 214`, `DebuggerGUI:156`; selected tab 1: `DebugKeyShortcuts:40`) | `border-strong`                                                                                                |
|                                                                                                                                                                        | focus border (`MaterialEditor:107`)                                                                                                                                 | the focus ring                                                                                                 |
|                                                                                                                                                                        | an inverted id chip's background (`DebuggerGUI:421`, with `$debugGuiBackgroundLighter` text)                                                                        | p803's badge                                                                                                   |
| `color.adjust($debugTextColorDark, -20%)` (`#535560`)                                                                                                                  | empty list text (`DebuggerGUI:333`)                                                                                                                                 | `text-muted` (2.1:1 today, §4.4)                                                                               |
| `$white` (`#ffffff`)                                                                                                                                                   | headings, figures, titles (15)                                                                                                                                      | `text`                                                                                                         |
|                                                                                                                                                                        | text and marks on hover (5: `About:79`, `DraggableWindow:204, 252, 309`, `DebuggerGUI:284`)                                                                         | `text`                                                                                                         |
|                                                                                                                                                                        | `nakedButton`'s background (`variables:54`)                                                                                                                         | none: a reset each include overrides                                                                           |
| `$black` (`#000000`)                                                                                                                                                   | selected tab's text (`_debugTabButtons:28`)                                                                                                                         | `on-accent`                                                                                                    |
| `$debugGuiBackground` (`#1f1f1f`)                                                                                                                                      | the drawer, its toggler, the material editor's selector, `kbd`, the scene loader (5)                                                                                | `surface`                                                                                                      |
|                                                                                                                                                                        | scrollbar track (2: `DebuggerGUI:112`, `MaterialEditor:141`)                                                                                                        | `surface`                                                                                                      |
|                                                                                                                                                                        | text on a selected segment / preview level (2: `Profiler:232`, `Assets:63`)                                                                                         | `on-accent`                                                                                                    |
|                                                                                                                                                                        | the material editor's notice at 85 % (`MaterialEditor:32`)                                                                                                          | `surface` (translucent: p806 picks the alpha)                                                                  |
| `$debugTabButton` (`#1f1f1f`, the same value)                                                                                                                          | the window's header bar, the clear-LS dialog's and the small buttons (3: `DraggableWindow:121`, `DebuggerGUI:220, 239`), tab buttons (`_debugTabButtons:12`)        | `surface`                                                                                                      |
|                                                                                                                                                                        | the divider between the header's buttons (`DraggableWindow:209`)                                                                                                    | `border`                                                                                                       |
| `$debugGuiBackgroundLighter2` (`#2e2e2e`)                                                                                                                              | the window, the drop-down's trigger and list, cards, buttons, rows (9)                                                                                              | `surface-raised`                                                                                               |
|                                                                                                                                                                        | hover (5: `OnScreenTools:168`, `MaterialEditor:133, 223`, `GPUMemory:94`, `Assets:35`)                                                                              | `surface-hover`                                                                                                |
|                                                                                                                                                                        | borders (8: `DraggableWindow:122-124`, `MaterialEditor:78, 99`, `GPUMemory:89`, `CharacterStateWindow:24, 35`)                                                      | `border`                                                                                                       |
|                                                                                                                                                                        | scrollbar track (5)                                                                                                                                                 | `surface-raised`                                                                                               |
|                                                                                                                                                                        | selected tab / current-window mark (2: `DebugKeyShortcuts:39, 41`, `DraggableWindow:329`)                                                                           | `accent` (the tab's border joins its panel: `surface-raised`)                                                  |
|                                                                                                                                                                        | the small icon button's icon (`DraggableWindow:313`)                                                                                                                | `text`                                                                                                         |
|                                                                                                                                                                        | the GPU memory bar's track (`GPUMemory:23`)                                                                                                                         | `surface-hover`                                                                                                |
| `color.adjust($debugGuiBackgroundLighter2, 6%)` (`#3d3d3d`)                                                                                                            | card hover (`MaterialEditor:194`)                                                                                                                                   | `surface-hover`                                                                                                |
| `color.adjust($debugGuiBackgroundLighter2, 20%)` (`#616161`)                                                                                                           | the small icon button disabled (2: `DraggableWindow:338, 343`)                                                                                                      | `text-disabled`                                                                                                |
| `$debugGuiBackgroundLighter` (`#181818`: darker than `#1f1f1f`, despite the name)                                                                                      | hover (3: `DebuggerGUI:57`, `OnScreenTools:160`, `DropDown:34`)                                                                                                     | `surface-hover`                                                                                                |
|                                                                                                                                                                        | the id chip's text (`DebuggerGUI:420`)                                                                                                                              | p803's badge                                                                                                   |
| `$debugGuiBackgroundDarker` (`#111111`)                                                                                                                                | fields, preview slots, badges (4: `MaterialEditor:101, 247, 286`, `CharacterStateWindow:37`)                                                                        | `bg` (sunken)                                                                                                  |
| `$debugOnScreenAlphaBack` (`#bbbcc4` at 20 %)                                                                                                                          | the on-screen tool group over the canvas (`OnScreenTools:9`)                                                                                                        | `surface` (translucent: p806 picks the alpha)                                                                  |
| `$info` (`#307b4d`, a green)                                                                                                                                           | the shortcut badge's border (`DebugKeyShortcuts:198`), the debug toaster's info icon (`DebugToaster:6`)                                                             | `info`                                                                                                         |
|                                                                                                                                                                        | `rgba($info, 0.35)` badge background (`DebugKeyShortcuts:197`)                                                                                                      | `info-soft`                                                                                                    |
|                                                                                                                                                                        | `+30 %` (`#79cb99`) note and pick status text (2: `DebugKeyShortcuts:165`, `RayDebug:64`)                                                                           | `info`                                                                                                         |
|                                                                                                                                                                        | the scene tab button: `+25 %` border, `0.22` background, `+30 %` mark, `+40 %` selected, `$info` selected mark (5: `DebuggerGUI:85-104`)                            | none: a category, not a status (p800 D6). p806 marks the scene's tabs another way (an icon or a group heading) |
| `$warning` (`#7d690f`)                                                                                                                                                 | badge border, toaster icon (2: `DebugKeyShortcuts:204`, `DebugToaster:9`); `rgba(…, 0.35)` badge background (`DebugKeyShortcuts:203`)                               | `warning`, `warning-soft`                                                                                      |
|                                                                                                                                                                        | `+35 %` (`#eacf54`) note and notice text (2: `DebugKeyShortcuts:169`, `RayDebug:54`)                                                                                | `warning`                                                                                                      |
| `$alert` (`#700606`)                                                                                                                                                   | the toaster's alert icon (`DebugToaster:12`); `+45 %` (`#f76565`) ray tester error (`RayDebug:114`)                                                                 | `danger`                                                                                                       |
| `$errorDark` (`#701515`)                                                                                                                                               | tab error and warning text, the danger button, the danger icon (5: `DebuggerGUI:136, 230, 231, 251`, `DraggableWindow:318`)                                         | `danger` (1.4:1 today, §4.4)                                                                                   |
| `$debugAlertLight` (`#d04848`)                                                                                                                                         | a failed card, over budget (4: `MaterialEditor:211, 214`, `GPUMemory:33, 41`)                                                                                       | `danger`                                                                                                       |
| `$debugBoolTrue` (`#3fb56b`)                                                                                                                                           | the true icon (`CharacterStateWindow:237`), the GPU memory bar within budget (`GPUMemory:29`)                                                                       | `success`                                                                                                      |
|                                                                                                                                                                        | a selected card's border and `0.15` background (`MaterialEditor:202, 203`)                                                                                          | `accent`, `accent-soft`                                                                                        |
| `$debugBoolFalse` (= `$debugTextColor`)                                                                                                                                | the false icon (`CharacterStateWindow:222`)                                                                                                                         | `text-muted` (neutral, as its comment says)                                                                    |
| `$debugValueWarn` (`#e3b341`)                                                                                                                                          | a profiler figure over its budget (`Profiler:89`)                                                                                                                   | `warning`                                                                                                      |
| `$debugValueFlash` (`#e3b341` at 35 %)                                                                                                                                 | the changed-value flash (`CharacterStateWindow:154`)                                                                                                                | `accent-soft` (p800 D6: "this changed")                                                                        |
|                                                                                                                                                                        | the frozen badge (`CharacterStateWindow:99`, white text)                                                                                                            | `warning-soft` with `text`                                                                                     |
| `$changedColor` (`#e3b341`, local)                                                                                                                                     | a changed row's mark, the reset button, the changed count (3: `CharacterStateWindow:251, 263, 333`)                                                                 | `accent` (changed from its default)                                                                            |
| `$savedColor` (`#58a6ff`, local)                                                                                                                                       | the saved dot and count (2: `CharacterStateWindow:289, 309`)                                                                                                        | `info`                                                                                                         |

### 4.3 Colours: literal values

| Value                                                               | Use (where)                                                                                                                                             | Role                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `rgba(255,255,255,0.04)`                                            | zebra rows, a sparkline's background (3: `Profiler:42, 155, 385`); a grid line (`Profiler:344`)                                                         | `surface-hover` (zebra: p805's table picks the strength); `border`                    |
| `rgba(255,255,255,0.05)`                                            | the window's resize handles (3: `DraggableWindow:45, 60, 82`), a bar's track (`Profiler:295`)                                                           | `border`; `surface-hover`                                                             |
| `rgba(255,255,255,0.08)`                                            | the collapse and close buttons (2: `DraggableWindow:166, 224`)                                                                                          | `surface-hover`                                                                       |
| `rgba(255,255,255,0.1 / 0.12 / 0.25)`, `rgba(0,0,0,0.1)`            | hover (3 + 2 + 3 + 1: `DebuggerGUI:167, 226, 246, 367, 495`, `Profiler:106, 226`, `_debugTabButtons:20`, `DebugKeyShortcuts:32`)                        | `surface-hover`                                                                       |
| `rgba($debugTextColor, 0.06 / 0.2 / 0.3)`                           | hover and the highlighted option (6: `CharacterStateWindow:144`, `DebuggerGUI:275`, `DraggableWindow:200, 248`, `DropDown:118`)                         | `surface-hover`                                                                       |
| `rgba(255,255,255,0.2)`, `rgba($debugTextColor, 0.12 / 0.3 / 0.35)` | borders and row lines (5 + 2 + 1 + 1: `Profiler:98, 218, 267`, `RayDebug:15, 81`, `About:103`, `DebugKeyShortcuts:87, 192`, `CharacterStateWindow:353`) | `border`                                                                              |
| `rgba($debugTextColor, 0.3)`                                        | a profiler bar's culled part (`Profiler:303`)                                                                                                           | p805's bar: `border`                                                                  |
| `rgba(255,255,255,0.9)`                                             | the list button's focus mark (`DebuggerGUI:379`)                                                                                                        | the focus ring                                                                        |
| `rgba(0,0,0,0.25)`                                                  | an unselected tab button (`DebugKeyShortcuts:22`)                                                                                                       | `surface`                                                                             |
| `rgba(0,0,0,0.19) 0 10px 20px, rgba(0,0,0,0.23) 0 6px 6px`          | the window's and the drop-down list's shadow (`DraggableWindow:12`, `DropDown:92`)                                                                      | the larger of D2's two shadows                                                        |
| `rgba(0,0,0,0.8)`                                                   | the dialog backdrop (`DraggableWindow:270`)                                                                                                             | a `backdrop` token: D2 has none, Phase 1 adds it (the Hub's search has one too, §4.8) |
| `#28292e`, `color.adjust(#28292e, -2%)` (`#232429`)                 | the list's odd rows and background (`DebuggerGUI:354, 342`)                                                                                             | `surface-raised`, zebra as above                                                      |
| `rgba(255,255,255,0.25)`                                            | a toast (`Toaster.ts:308`: translucent white over the canvas)                                                                                           | `surface-raised`                                                                      |
| `white`                                                             | the scene loader's spinner (`DebuggerSceneLoader:31`)                                                                                                   | p803's spinner: `text`                                                                |
| `var(--pie-fill, #fff)`                                             | the percentage pie's default fill (`PercentagePie:8`)                                                                                                   | p805's donut: `text` (its track `surface-hover`)                                      |

Debug-only, no role:

| Value                                                | Where                  | Why                                                                                                 |
| ---------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `#222`                                               | `Stats:7`              | stats-gl's container: p807 replaces or restyles stats-gl                                            |
| `#777`, `#555` (×4)                                  | `Assets:77, 78`        | the texture preview's transparency checkerboard: fixed greys so alpha reads the same in both themes |
| `#00ffff`, `#ff00ff`, `rgba(255,0,255,0.25)`         | `Assets:140, 145, 149` | the atlas slot overlay drawn on a texture: must stand out on any image                              |
| `rgba(75,59,59,0.2)` with `stripe-pattern-24x24.png` | `DebuggerGUI:316`      | the disabled drawer's stripes (p806 decides with the on-screen tools' disabled state, p800 §5)      |

### 4.4 Colours: contrast today

Pairs below WCAG AA now (computed as `tokens.test.ts` will). p801 leaves them (D1); the roles they
map to pass by construction, so p803 and p806 fix them by restyling:

| Pair                                                                    | Ratio              | Needs                                                                |
| ----------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `$debugTextColorDark` `#848695` on a window `#2e2e2e`                   | 3.77               | 4.5 (on the drawer `#1f1f1f` it's 4.57)                              |
| the empty list's `#535560` on `#232429`                                 | 2.1                | 4.5                                                                  |
| `$errorDark` `#701515` on the drawer / a window                         | 1.42 / 1.17        | 4.5 (text), 3 (the icon)                                             |
| `$debugAlertLight` `#d04848` on a window                                | 3.04               | 4.5 (the failed card's name)                                         |
| the debug toaster's icons: `$info` / `$warning` / `$alert` on `#2e2e2e` | 2.63 / 2.52 / 1.11 | 3                                                                    |
| `$debugGuiBackgroundLighter2` as a border on the drawer                 | 1.21               | 3 where the border is the only edge of a control (the field borders) |

### 4.5 Focus: every outline removed (D6)

The existing styles are unlayered, so any of them beats the layered `.aekUi :focus-visible` ring
whatever its specificity (`:where()` included): each removal below has to go, or the ring never
shows there. Everything the debugger draws is inside the HUD root (the drawer, the on-screen
tools, stats, the material editor's HUD, the windows, the toasters), so the HUD root's `aekUi`
reaches it all.

| Where                                                      | What                                                                                                                                                                                                                                                 | Phase 2                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `variables.scss:51`                                        | `nakedButton`'s `outline: 0`, in 18 button styles: `DraggableWindow:162, 219, 295`, `DebuggerGUI:41, 148, 216, 236, 263, 358, 479`, `DebugKeyShortcuts:18`, `_debugTabButtons:8`, `MaterialEditor:112, 177`, `OnScreenTools:131`, `Profiler:96, 216` | removed from the mixin                                                                              |
| `DropDown.scss:25`, `:38`                                  | the trigger's `outline: 0` and its `:focus-visible` 1 px `box-shadow` ring                                                                                                                                                                           | both removed: the token ring replaces it                                                            |
| `DropDown.scss:96`                                         | the list's `outline: 0` (it holds focus while open, `tabindex="-1"`, `aria-activedescendant`)                                                                                                                                                        | removed: the ring goes round the list; p803 decides whether the highlighted option shows it instead |
| `Toaster.ts:336`                                           | the close button's `outline: 0`                                                                                                                                                                                                                      | removed                                                                                             |
| `MaterialEditor:106`                                       | the filter field's `outline: none` (its focus shows as a border colour)                                                                                                                                                                              | removed (the border stays)                                                                          |
| `CharacterStateWindow:357`                                 | the config field's `outline: none` (same)                                                                                                                                                                                                            | removed (the border stays)                                                                          |
| `normalize.scss:211-216` (`page.scss`, the full page only) | `button:-moz-focusring { outline: 1px dotted ButtonText }`: unlayered, so in Firefox it would replace the ring on every button                                                                                                                       | removed in Phase 1 with the ring (it restores Firefox's own ring, which the token ring now is)      |

Kept: `MaterialEditor:198` (a card's own 1 px `:focus-visible` outline: visible, p806 moves it
onto the tokens), `normalize.scss:286` (`[type='search']`'s `outline-offset: -2px`: an inset ring
on a search field). The focus marks that don't touch `outline` (`DebuggerGUI:379`'s mark, `:500`'s
border, the fields' borders) stay, so those controls show both until p806.

### 4.6 Durations (D7)

| Value                                                           | Where                                                                                                                                                                                                              | Token                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `0.2s` (19 values)                                              | `AxesGizmo:40`, `DebugKeyShortcuts:27` (2), `DebuggerGUI:14, 52 (2), 223, 243, 272, 315`, `OnScreenTools:11, 32 (2), 71`, `Stats:12`, `_debugTabButtons:17`, `MaterialEditor:56`, `GPUMemory:30`, `Toaster.ts:340` | `base`                                                                                                                        |
| `0.17s` (7)                                                     | `DebuggerGUI:157 (2), 486 (2)`, `OnScreenTools:138`, `DraggableWindow:304`, `DropDown:30`                                                                                                                          | `base` (0.17 → 0.2 s)                                                                                                         |
| `0.15s` (4)                                                     | `MaterialEditor:189 (2)`, `DraggableWindow:167, 225`                                                                                                                                                               | `base`                                                                                                                        |
| `$collapseAnimLength: 150ms` (4 uses)                           | `DraggableWindow:5` (the collapse's height and its chevron, `:15`, `:180`)                                                                                                                                         | `base`                                                                                                                        |
| `0.075s`                                                        | `DebuggerGUI:364`                                                                                                                                                                                                  | `fast`                                                                                                                        |
| `700ms`                                                         | the scene loader's spinner (`DebuggerSceneLoader:34`, infinite)                                                                                                                                                    | `calc(700ms * var(--aek-motion, 1))`: under reduced motion it stops (a still ring, the loader's text still says it's loading) |
| `0.8s`                                                          | the material editor's loading pulse (`MaterialEditor:207`, infinite)                                                                                                                                               | `calc(0.8s * var(--aek-motion, 1))`                                                                                           |
| `animationTimeMs` (JS, default 200, `Boot.ts:252` sets 200)     | the toaster's slide and fade, its padding (`Toaster.ts:296, 365`)                                                                                                                                                  | D7: 0 under reduced motion, read when a toast starts                                                                          |
| `START_ANIM_LENGTH_IN_MS` 150, `END_ANIM_LENGTH_IN_MS` 250 (JS) | the scene loader's fade in and out (`_dbg__DebuggerSceneLoader.ts:6-7`), set as `transitionDuration` and awaited with `setTimeout`                                                                                 | as the toaster: 0 under reduced motion (not in D7 yet)                                                                        |

Not a duration to tokenise: `transition: none` (`DraggableWindow:24`, the toaster's base), CMP's
`anim` phases (an app's own durations: p803 decides whether they follow reduced motion), the
windows' 150 ms resize debounce.

### 4.7 Z-layers (D2)

| Value                                        | Where                                                             | Layer                     |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------- |
| 100 + 2 per window (its backdrop 1 below)    | `DraggableWindow.ts:47` `Z_INDEX_BASES.APP`                       | app windows and dialogs   |
| 20000 + 2 per window; a `customZIndex` + 100 | `Z_INDEX_BASES.DEBUG`, `:48`                                      | debug windows             |
| 10000                                        | `Stats:6`, `OnScreenTools:7, 67, 95`                              | the debugger's overlays   |
| 10100, 10150                                 | `MaterialEditor:50, 20` (above the debug toaster, which has none) | the material editor's HUD |
| 10200                                        | `DebuggerGUI:9`                                                   | the drawer                |
| 1000                                         | `DebuggerSceneLoader:18`                                          | the scene loader          |
| 1, −1                                        | `DropDown:83`, `Viewports:10`, `CharacterStateWindow:152`         | local stacking, no token  |

Toasts and tooltips have no z-index today (the toaster sits in the HUD root's order).

### 4.8 The Hub's reference values (Phase 5)

- Its colours are `hub/_assets/scss/_tokens.scss` at `f962bb3` (both themes, unchanged by p802),
  used 307 times. Outside it: `#000` 9 times, all in `mask-image` gradients (a mask, not a
  colour: stays), and `rgb(3 6 12 / 60%)`, the search dialog's backdrop (`_search.scss:26`: the
  `backdrop` token's dark value).
- Its focus style is already D6's ring (2 px `--hub-accent`, offset 2 px: `_base.scss:56`,
  `_header.scss:215`; `_code.scss` insets it, −2 px / 1 px). `_search.scss:61` removes the search
  field's outline: Phase 5 checks it shows focus otherwise.
- Its transitions are all `0.15s` (`_cards`, `_embed`, `_base`, `_home`, `_header`, `_code`):
  `base` under D7's mapping.

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
