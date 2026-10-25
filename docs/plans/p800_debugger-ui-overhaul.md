Status: draft | epic — not-implemented
Category: Refactoring, Documentation, UI, Debug
Blocks: \_DONE_p801_design-foundation.md, \_DONE_p802_hub-project-section.md, p803_ui-kit-structure-and-core.md, p804_forms-and-bindings.md, p805_data-display.md, p806_debugger-migration.md, p807_stats-and-profiler-graphs.md, p808_game-ui-components.md, p809_project-roadmaps-and-docs-split.md (p801 and p802 done; the rest not yet: §5)
Related: \_DONE_p600_whole-codebase-refactoring-and-documentation.md (§9: this epic follows its p608 move and p617's kit), \_DONE_p602_architecture-and-target-structure.md (D5: "the debugger is the kit's first consumer, not its owner"), \_DONE_p617_review-input-ui-hud.md (the kit on `aekasha/ui`; D8: the embed issue), \_DONE_p618_review-debug-public-api.md (D3, P7: Tweakpane in the tab types; the "Write your own tab" guide), p622_engine-6-major.md (the major p806 ships with: D12), p150_current-entity-data-source-info-on-edit-windows.md and p373_merge-debug-and-member-editing.md (debug UI built on p806's components), p355_save-menu-and-file-server-settings.md (its menu on p803 / p804), p426_sequencer-splines-and-cutscenes.md (p804's curve editor), `docs/issues/ui-kit-in-an-embed.md` (p801), `docs/issues/on-screen-tools-during-scene-load.md` (p806) (the original prompt was in `docs/templates/todo-plan-prompts.txt` until this plan's commit, `208b177`, removed it: this plan is its record)

# Debugger UI Overhaul — Epic

Ækasha's own UI components: a design system shared with the Hub, a component library on
`aekasha/ui` that apps build their game or 3D app UI with, and the debugger rebuilt on it. Tweakpane
goes, stats-gl goes if p807's gate passes, and the Hub gets a dev-only Project section with the
design document, the component library and the project's conventions.

This file is the epic: the grounding, the shared decisions every child follows, the component
catalogue, the plan map and the branches. The work happens in p801-p809, each written in full
(grounding, decisions, phases) when it starts, with `Epic: p800`; §5 sketches each one's scope and
phases so the numbers and the order are fixed now.

**The mantra: USER FIRST.** Two users, both first: the developer who builds with the components
and the debugger, and the player or visitor who uses what they build. Every decision below is
judged by both: is it obvious, is it fast, does it work with a keyboard, a screen reader, a
gamepad, a small screen, an embed, and does it make someone want to come back to Ækasha.

**Out of scope:**

- A 3D in-world UI renderer (text and panels as meshes in the WebGPU scene). p808's world anchors
  are DOM elements placed over the canvas.
- Framework adapters (React, Vue, Svelte). The components are plain DOM through CMP; an adapter
  can wrap them later.
- Our own colour picker. p804 wraps a small library and adds our features around it (D13).
- A visual UI editor (drag components onto a canvas). The component library page shows and
  copies; it doesn't author.

---

## 1. Goal

1. **One component library, two consumers.** Everything the debugger draws (fields, folders,
   tables, graphs, lists, buttons, windows) is a public `aekasha/ui` component an app can use for
   its own UI. The debugger is the first consumer, not the owner (p602 D5).
2. **Tweakpane gone, stats-gl likely gone.** Every Tweakpane feature the engine uses (§2.1) has a
   replacement with a better binding model (D9); the stats panels move to our own graphs if p807's
   parity gate passes.
3. **One look with the Hub.** The kit's tokens are the Hub's (D2), denser for tight panels, in
   dark and light, with subtle motion (D7), a sparing accent and status colours (D6), and fonts
   shared with the Hub (D5).
4. **Accessible by default.** Semantic HTML, the WAI-ARIA Authoring Practices patterns, a visible
   focus ring, full keyboard use, reduced motion (D8). A deviation is written down with its reason.
5. **Smallest build.** An app pays only for the components it imports; heavy parts load on first
   use; the debugger costs production nothing (D10). Every component works in an embed as well as
   in the full-page boot (D4).
6. **Easy to restyle.** Tokens and cascade layers, so an app's own CSS wins without `!important`
   (D3), with a Hub guide.
7. **Documented and visible.** A public component library page in the Hub, a dev-only Project
   section (design document, component library for developing Ækasha, conventions, later
   roadmaps), the rewritten "Write your own tab" guide, and a game HUD example scene.

---

## 2. Grounding (checked against the code, 2026-10-21; p801 §1 rechecked it on 2026-10-23)

### 2.1 Tweakpane

- `tweakpane` 4.0.5 (dependency), `@tweakpane/core` 2.0.5 (devDependency, types only). No plugin
  packages (no essentials).
- 9 files import `tweakpane` directly: `debug/_dbg__DebuggerPaneBuilder.ts`, `debug/DebuggerGUI.ts`
  (types), and the camera, light, ECS, physics, character, PostFX and day-night debug modules.
  `@tweakpane/core` in 3 (the builder, `DebuggerGUI.ts`' `BindingApi`, `_dbg__LightGUI.ts`' list
  blade cast).
- 43 non-test files build Tweakpane UI, nearly all through the declarative pane builder
  (`_dbg__DebuggerPaneBuilder.ts`, 217 lines): `createDebuggerTab` 25 calls in 22 files,
  `createProfilerTab` 4. The declarative items: `pane: true` sections 30, folders 67, buttons 74,
  separators 21, one `custom` (`features/skybox/debug/_dbg__DayNightFolder.ts`, speed buttons
  reusing Tweakpane's `tp-btnv_b` class), `onCreate` defined but used by no tab.
- 8 imperative `new Pane(…)` in 7 files, the entity edit windows and sections: camera, light (2),
  physics, character, ECS, PostFX, and the builder itself. Imperative calls: `addBinding` 55
  (light 32), `addButton` 20, `addFolder` 6, `addBlade` 8, `on('change')` 44, `refresh()` 13.
- What's used: bindings with `min` / `max` / `step` (about 120 / 80 / 110), `options` (39, drop-down
  lists), `format` (27); read-only monitors (84) with `interval` (0, 250, 500); `multiline` with
  `rows` (12); `view: 'color'` (16, one float colour); `{x, y, z}` objects bound as points
  (position, target, origin), Euler rotation with `step: Math.PI / 8`, quaternions converted by
  hand; `hidden` / `disabled` (static and dynamic); folders nested at most about three deep
  (material editor's inputs, light's shadow camera).
- What isn't: `graph`, `slider`, `text` blades, `cubicbezier`, `fpsgraph`, radio / button grids,
  `picker`, `addTab`, `exportState` / `importState`, plugins.
- No theme: no `--tp-*` override anywhere; Tweakpane draws its default look next to our drawer.

### 2.2 What's already ours

- The drawer, its toggler, tab menu and scroller (`debug/_dbg__DebuggerGUI.ts`, 440 lines,
  `DebuggerGUI.module.scss` 511), the tab host shared by the drawer, the profiler window and the
  editor drawer (`_dbg__TabHost.ts`, 257), the debugger list (`_dbg__DebuggerList.ts`, 157): CMP and
  DOM.
- The profiler (`debug/profiler/`): HTML tables (`_dbg__ProfilerOverview.ts`), inline SVG
  sparklines (`_dbg__ProfilerObjects.ts`); no canvas, no Tweakpane graph.
- The on-screen tools (`_dbg__OnScreenTools.ts`, 547): CMP buttons, SVG icons, `createDropDown`.
- The material editor's selector and HUD: raw DOM (`MaterialEditor.module.scss`).
- `_dbg__PercentagePie.ts` (61): a CSS `conic-gradient` on `--p`, used only by the ray cast tab.
- The character state window (`_dbg__CharacterStateWindow.ts`, 1492): CMP HTML.

### 2.3 stats-gl

- `stats-gl` 4.2.3, only in `debug/_dbg__Stats.ts` (428): FPS, CPU, GPU and compute panels from
  stats-gl, PHY and TFPS added with `addPanel`. It reaches into private fields (`fpsPanel`,
  `msPanel`, `gpuPanel`, `gpuPanelCompute`, `vsyncPanel`), reorders panels, works around stats-gl's
  own resize and click handling, and its GPU panel competes with ours for timestamp queries (noted
  in `_dbg__GPUTimer.ts`, `_dbg__ProfilerSources.ts`, `_dbg__PostFXProfiler.ts`, `_dbg__BakeStats.ts`).

### 2.4 The UI kit (`src/_engine/ui/`, `aekasha/ui`, p617)

- CMP (`CMP.ts` 721, `CMPTypes.ts`, `CMPAnim.ts`), the HUD root (`HUD.ts`), draggable windows
  (`DraggableWindow*.ts`, kinds, LS store, geometry, drag), dialogs (`DialogWindow.ts`, a window
  preset), the drop-down (`DropDown.ts`), toasters (`Toaster.ts` 592, CSS injected into `<head>`),
  icons (`icons/`: 49 SVG strings, mostly Bootstrap Icons, `registerIcon`, `getSvgIcon`).
- The entry exports CMP and its `T`-prefixed types, `openDialog`, 15 window functions, the
  drop-down, `getHUDRootCMP` / `KEEP_IN_VIEWS_CLASS`, the toaster API and the icons.
- Users outside the engine: `examples/uiKit/` (most of the API), `examples/exampleHud.ts`,
  `scenes/physicsTest/` (`addToast`); the toolkit uses none.
- Styles: Sass variables only (`styles/variables.scss`: mostly the debugger's colours,
  `$drawerWidth: 40rem`, breakpoints), no custom properties, dark only, a system font stack (`page.scss`), CSS
  modules for most, `:where()` zero-specificity globals for the drop-down, plain globals for icons
  and the pie.
- Sizes are `rem` on the full-page template's `html { font-size: 62.5% }` (`page.scss`, loaded
  only by `InitEngine`): the debugger's styles have the most (`DebuggerGUI.module.scss` 82,
  `DraggableWindow.module.scss` 67, `Profiler.module.scss` 59, `CharacterStateWindow` 53, …).
  An embed doesn't load `page.scss`, so they follow the host's root size, and the windows measure
  the browser window (`ui/Window.ts`' `getWindowSize`, the `100vw` / `100vh` max size):
  `docs/issues/ui-kit-in-an-embed.md`.
- Accessibility: the drop-down is the one complete piece (listbox, `aria-activedescendant`, full
  keys). Windows focus their first focusable element but have no `role="dialog"`, `aria-modal`,
  focus trap or focus return; dialogs close on Escape only; the toaster has no `aria-live` or role.
  About 15 `aria-` attributes in the whole engine.

### 2.5 The Hub's look (`hub/_assets/scss/`)

- Tokens (`_tokens.scss`): `--hub-bg`, `-panel`, `-panel-hover`, `-border`, `-border-strong`,
  `-text`, `-text-muted`, `-accent` (`#3fd8f2` dark / `#0a7590` light: the prompt's "Ækasha blue"
  is this cyan), `-accent-hover`, `-accent-soft`, `-gradient`, `-code-bg`, and the status colours
  `-warning`, `-success`, `-danger`, `-error`. Dark by default, `prefers-color-scheme: light`
  unless `data-theme='dark'`, a toggle saved to `localStorage.aekHubTheme`, `.hubThemeDark` to
  force dark on a subtree.
- No spacing scale (hard-coded `rem`s), `--hub-radius: 8px` plus 4 / 6 / 999 px, one shadow token,
  0.15 s colour transitions, no `@keyframes`, one `prefers-reduced-motion` rule.
- Fonts: Inter Variable (OFL, self-hosted `hub/_assets/fonts/`, Latin, normal and italic,
  preloaded); a system stack for mono.
- `.hubButton` is outline only; there is no filled button.

### 2.6 The Hub's structure

- Pages are folders under `hub/pages/` with `aek:` metas; the nav is built from them
  (`devTools/hub/shell.ts`' `renderNav`): Hub, Examples, Features, Documentation, Issues, Version.
  `.hubTools` (search, version, GitHub, theme) sits on the right.
- Modes `dev` and `public` (`devTools/hub/types.ts`). No page can be dev-only today:
  `discoverPages` (`devTools/hub/pages.ts`) takes every folder; the only dev-only content is
  `::: dev-only` blocks, the scene buttons and the editor links. A `hub:` link to a missing page
  fails the build (`checkLinks`, `build.ts`).
- The homepage hero's right column is `hub/pages/index.html`' `.hubHeroSide` ("Build / Explore /
  Create", filled by `devTools/hub/generated/home.ts` with the engine's description).
- `documentation/code-blocks/` (the code block syntax reference; its `dynamic-box` region lives in
  `src/app/scenes/physicsTest/physicsTest.ts`, and `hub/CLAUDE.md`, `devTools/hub/CLAUDE.md`,
  `docs/techniques/hub-authoring.md`, `hub/_assets/ts/_search.ts` and
  `devTools/refactor/moveText.test.ts` name its path), `documentation/coding-standards/`,
  `documentation/migration/`.
- `features/ui-kit/` (the kit's guide, with the embed warning), `features/debug-suite/` (with
  p618's "Write your own tab"), `examples/ui-kit/`, `examples/debug-tab/`.
- The Hub reads `docs/issues/` (its Issues section) and nothing else of `docs/`. `readme.md`'s
  Roadmap points at `docs/plans/`.

### 2.7 Size and the debug files

- 105 `_dbg__` files, about 36,100 lines (109 and 36,765 at p801's check). The largest are the edit windows and panels: the
  character state window 1492, light 1489, ray tester 1266, physics 1186, assets 1121, physics
  debug draw 1104, material editor 1071. Eleven engine files carry a header line deferring their
  split or restyle to p800 (`grep -rln p800 src`).
- SBP (`sbp.config.ts`): app 404 KiB initial (gzip), banner embed 313; the `_engine/ui` group is
  7 KiB in each; the built-in icons are 0 in production. `yarn verify:embed` shows no kit UI yet.

---

## 3. Shared decisions

Binding on every child plan. A child that needs to change one says so in its own decisions and
updates this section.

### D1. Components are CMP functions

- A component is `createX(props)` returning a handle (`{ cmp, …setters, …getters }`), as the
  drop-down does, or a CMP with a typed wrapper. `cmp.remove()` disposes it (listeners, timers,
  observers, the binding's scheduler entry).
- No custom elements: CMP is the public pattern apps already use (p617), a shadow root fights style
  overrides (D3), and custom element registration is a side effect at load.
- No side effects at load (`moduleSideEffects.test.ts`); each module imports its own stylesheet.
- Props objects only (the coding standards' options-object rule); events are `on*` props; every
  component takes `class`, `attr` (so `data-*`, `aria-*` and test ids pass through) and `id`.
- Every component works in a plain DOM container: no engine, renderer or ECS needed (the Hub's
  component pages import them without the engine, D11).

### D2. Tokens are CSS custom properties, shared with the Hub

- `--aek-*` tokens in `src/_engine/ui/styles/tokens.css`: colour roles (`bg`, `surface`,
  `surface-raised`, `surface-hover`, `border`, `border-strong`, `border-control` (p801 D2: a
  control's edge at 3:1; `border-strong` is decorative), `text`, `text-muted`,
  `text-disabled`, `accent`, `accent-hover`, `accent-soft`, `on-accent`, and `danger`, `warning`,
  `success`, `info` each with a `-soft` background), type (families, sizes, weights, line heights,
  tabular numbers), a space scale, radii, shadows, motion (D7), focus ring, z-layers.
- Dark and light the Hub's way: dark by default, `prefers-color-scheme: light` unless forced, a
  forced theme by `data-aek-theme="dark" | "light"` on the kit root (an app's setting) or on any
  element for its subtree (p801 D3: one attribute instead of the Hub's extra `.hubThemeDark`
  class). The Hub's toggle sets it next to its own `data-theme`.
- Scoped to a kit root, the class `aekUi` (`:where(.aekUi)`), never `:root`, so an embed leaves
  the host page alone (`verify:embed` already checks host styles). The HUD root carries it, the
  Hub puts it on its `<html>`, and an app or a Hub demo box on any container outside the HUD
  (p801 D2; this was `:where(.aekHudRoot)`, a class the HUD root never had).
- The Hub and the kit share the values from one source: the Hub's `--hub-*` colour roles become
  aliases of `--aek-*` (p801 D2, Phase 5: one file changes; the Hub-only tokens stay `--hub-*`),
  and a test checks every alias resolves.
- The debugger's density is a token set, not other colours: `data-aek-density="compact"` (the
  debugger, tight panels) next to the default (app UI).
- `styles/variables.scss` is retired when the last user moves (p806).

### D3. Restyling through cascade layers

- The kit's CSS is in `@layer aek.tokens, aek.base, aek.components, aek.utilities`. An app's
  unlayered CSS beats any layer, so an override needs no `!important` and no specificity race.
- Default selectors use `:where()` (the drop-down's pattern) so even a layered app rule wins.
- Global class names, prefixed: `aek<Component>` and `aek<Component>__<part>` (`aekButton`,
  `aekButton__icon`), state as attributes (`[aria-pressed]`, `[data-state="open"]`), not classes.
  CSS modules stay only for the debugger's internal layout. Each component's JSDoc and Hub section
  list its parts and its component-level custom properties (`--aek-button-radius`).
- Three ways to restyle, documented in that order (D11): set tokens (whole look), set a component's
  properties (one component), write rules on its parts (anything).

### D4. Units: one em base on the HUD root (closes `ui-kit-in-an-embed.md`)

- The kit root sets `font-size: medium` (the user's browser default, which a host page's root
  can't change) and computes `--aek-base: calc(var(--aek-ui-font-size, 0.875em) * var(--aek-ui-scale, 1))`,
  registered with `@property` as a `<length>` so it inherits as pixels (p801 D4; this was a
  `0.875rem` default on the font size, which a host's root would still have scaled). The type and
  space scales are tokens computed from `--aek-base` on the kit root (`calc(var(--aek-base) * 12 / 14)`),
  so they inherit as fixed lengths and never compound, and the compact density re-declares them
  for its subtree; a component sets `font-size: var(--aek-font-size-md)` on its root and uses
  `em` only for sizes relative to its own text (p801 D2: this was "every kit size is a token in
  `em`", which the compact density couldn't shrink).
- `page.scss` drops `html { font-size: 62.5% }`: the full page and an embed both follow the user's
  browser font size (an accessibility gain), and a host page's own root size no longer scales the
  kit by accident (a host that wants that sets `--aek-ui-font-size`). The existing styles' `rem`s
  (524 in the kit and the debugger) become `calc(N * var(--aek-rem))`, an `@internal` unit that is
  10 px at the defaults, until p803 and p806 restyle them onto `em` tokens (p801 D4).
- `--aek-ui-scale` is the game's "UI scale" setting (p808's settings menu sets it).
- `getWindowSize` (`ui/Window.ts`) measures the HUD root's container (the page in the full-page
  boot, the mount's container in an embed); the windows' default max size is `100%` of it, not
  `100vw` / `100vh`, and the dialog backdrop with them. `_dbg__DebuggerGUI.ts`' caller follows.
- p801's check: a `uiKit` SBP embed profile opens a window, a dialog and a toast, and
  `yarn verify:embed` compares their boxes with the container's, at a host root of 16 px and of
  10 px. The issue file is closed then.

### D5. Fonts

- p801 Phase 0 is a font study on a dev-only specimen page: sans candidates Inter (incumbent, the
  Hub's), Geist, IBM Plex Sans; mono candidates JetBrains Mono, Geist Mono, IBM Plex Mono. Judged
  at 11-13 px in dense panels (labels, numbers in fields and tables, monitors), at Hub body and
  heading sizes, in both themes, on Windows / macOS / Android rendering: readability, tabular
  figures, distinct `0O`, `1lI`, width (how many characters a 280 px label column holds), weight
  range, the "subtle" feel, and the woff2 size of a Latin variable subset.
- The pick is self-hosted (variable woff2, Latin subset, licence file next to it), in one place
  both the Hub and the engine read: `src/_engine/ui/fonts/` (p801 D8; the engine can't read
  `hub/`, so the Hub's build reads them there). If one sans
  doesn't serve both, the Hub keeps its own and the decision is written down.
- Smallest build: the kit's default font token is the system UI stack, so an app pays nothing for
  fonts it didn't choose. The debugger loads the Ækasha fonts (debug-only chunk), the full-page
  template opts in, an app opts in with one import (`aekasha/ui/fonts`, an entry with only the
  `@font-face` CSS), and an embed only if its profile imports it.
- Numbers in fields, tables and monitors use tabular figures
  (`font-variant-numeric: tabular-nums`) so they don't jitter while they change.

### D6. Colour discipline

- The accent marks the one primary action in a group, keyboard focus, selection, the current item
  (tab, nav entry) and "this changed" flashes. Nothing else: secondary buttons, borders, icons and
  headings stay neutral.
- The status colours (`danger`, `warning`, `success`, `info`) appear only for status: toasts,
  validation, the profiler's budgets, health bars. Always with an icon or text: colour is never the
  only signal (colour vision deficiency).
- Contrast: WCAG 2.2 AA in both themes, 4.5:1 for text, 3:1 for UI parts and the focus ring.
  p801 adds a unit test that computes each text-on-surface pair from `tokens.css`.

### D7. Motion

- Tokens: `--aek-motion-fast` (about 120 ms: hover, press, toggle), `--aek-motion-base` (about
  200 ms: expand, open, toast in), `--aek-motion-slow` (about 320 ms: drawer, page-level), and two
  easings (standard and emphasised).
- Motion hints: a folder's chevron turns as it opens, a value that changed from outside flashes
  once (the debugger's `$debugValueFlash`, made a pattern), a toast slides from its corner, a
  dragged list item lifts, a loading button keeps its width while its text fades to a spinner.
- `prefers-reduced-motion: reduce` and `--aek-motion: 0` (an app's setting) collapse every
  duration to 0 and replace movement with opacity.
- No CSS animation or transition on a per-frame path (monitors, running graphs): those redraw
  without transitions.

### D8. Accessibility baseline

Every component, from its first version:

- Native elements first: `button`, `a`, `input`, `select` where it fits, `label`, `fieldset` /
  `legend`, `table` / `th` with `scope`, `details` / `summary` where its look can be kept, `dialog`
  for modal dialogs (p803 decides with the window code).
- The WAI-ARIA Authoring Practices pattern for anything custom (listbox, slider, tabs, tree,
  grid, menu, combobox, disclosure, toolbar), roving `tabindex` inside composite widgets.
- Keys: Tab / Shift+Tab between widgets; arrows inside them; Home / End; PageUp / PageDown (×10
  on values); Enter / Space to activate; Escape closes the innermost overlay and returns focus.
  Every pointer action has a keyboard path (drag-scrub has arrow keys, drag-reorder has
  Alt+arrows, the colour picker has inputs).
- A visible focus ring on `:focus-visible`, 2 px in the accent with an offset, never removed.
- Modal dialogs trap focus, set `aria-modal`, and give focus back on close; non-modal windows are
  `role="dialog"` with a label and are reachable from the keyboard (a key to cycle windows).
- Toasts announce through an `aria-live` region (`polite`; `assertive` for errors), stay while
  hovered or focused, and can be dismissed from the keyboard.
- Target size at least 24 × 24 CSS px (WCAG 2.2 2.5.8) at UI scale 1 in the compact density.
- Labels: every field has a visible label or `aria-label`; icon-only buttons have a label and a
  tooltip.
- A deviation is allowed only with a reason written in the component's JSDoc and its Hub section
  (eg. a running graph is `aria-hidden` with its numbers given as text next to it).
- Gamepad and spatial navigation across the HUD is p808's.

### D9. The binding model (Tweakpane's replacement)

- A field binds in one of three ways: `{ target, key }` (an object and a key, Tweakpane's model),
  `{ get, set }` (any source), or a debugger tab's `state` key (p806 maps it to the first).
- Events: `onInput(value)` on every live change (each drag step, each key),
  `onChange(value, { prev, last, source })` on commit, `last` true on release or Enter (what undo coalescing and
  LS persistence key on today, `debug/CLAUDE.md`'s undo section), `source` `'user' | 'api'`.
  A refresh from the bound value never fires `onChange` (today's builder suppresses it the same
  way).
- Monitors: `readonly` fields with `interval` (ms; `0` reads every scheduler tick).
- The scheduler: one per host (a tab, a window, an app panel), driven by the host's visibility
  (paused while hidden, as the tab host's `refreshIntervalMs` is today). A tick reads each visible
  field's bound value, compares it with the shown one, and writes the DOM only on a change; no
  allocation per tick (numbers compared as numbers, vectors component by component into a kept
  scratch). The perf-auditor agent reviews it.
- Value editing: arrow keys step, Shift ×10, Alt ×0.1; drag-scrub on the label; a typed value can
  be an expression (`1/3`, `90deg`) where p804 decides it's safe; reset to the default (the value
  at creation, or a given `default`) from the label's context menu or a key; copy and paste a
  value (vectors and colours as text).
- The declarative names map one to one from Tweakpane's (`min`, `max`, `step`, `options`, `format`,
  `readonly`, `interval`, `multiline`, `rows`, `hidden`, `disabled`, `expanded`, `view: 'color'`
  → `kind: 'color'`), so p806 ports the 30 declarative sections mechanically.

### D10. Smallest build

- Each component is its own module, re-exported by name from `aekasha/ui` (or a sub-entry per
  group if the entry grows: `aekasha/ui/forms`, p803 decides); nothing registers at load.
- Heavy parts load with `import()` on first use: the colour picker library (on the first open),
  the canvas graph renderer, drag and drop, virtualised lists. Each has a budget line.
- A component's CSS ships only with its module (Vite splits CSS per chunk); the tokens file is
  the one shared stylesheet, small and budgeted.
- The debugger's use of the components costs production nothing (the debug modules fold, D7 of
  p607); `yarn verify:baselines` keeps checking it.
- A `uiKit` SBP embed profile (p801 creates it for D4's check) with budgets for what an app pays
  for a window, a dialog, a toast and a button, and later a form and a table: the "what does a
  HUD cost" number the Hub shows.

### D11. Documentation

- The Hub's UI kit feature page (`hub/pages/features/ui-kit/`) grows into a section with a child
  page per component group (core, forms, data, overlays, game), each component with a live demo,
  its props, its parts and custom properties (D3), its keyboard map (D8), and its size.
- **The public component library page**: every component live, in both themes and densities,
  rendered by a Hub TS entry that imports `aekasha/ui` directly (no engine, D1). This is the
  prompt's "example page of all of the HTML UI components".
- **The styling guide** (public): tokens, layers, parts, densities, themes, UI scale, the font
  opt-in; with a worked "make it look like my game" example.
- **The dev-only Project section** (p802): the design document and the component library for
  developing Ækasha, on pages the public Hub doesn't build.
- "Write your own tab" (`features/debug-suite/guide.md`) and `examples/debugTab/` are rewritten
  for the components in p806.
- A component module over the coding standards' size says why in its header, as the rest of the
  engine does. New `##` sections in `src/_engine/ui/CLAUDE.md` get an `aek:covers` (root
  `CLAUDE.md`, Ækasha Hub).
- Each child's second-to-last phase updates the Hub (`docs/plans/CLAUDE.md`).

### D12. Versioning and the major

- p801-p805, p807 (unless it changes a public type), p808 and p809 add or restyle without breaking:
  minors (new components, new tokens) and patches, each merged to `main`.
- p806 removes Tweakpane, so the tab types' Tweakpane parts break (p618 P7, p622): it ships with
  engine 6.0.0 on the `engine-6` integration branch it shares with p622 (§6).
- The kit's `T`-prefixed type renames (`TCMP` → `Cmp`, `TProps` → `CmpProps` and the rest, listed
  in p622) get their new names with deprecated aliases in a p803 minor; p622 removes the aliases.
- A restyle isn't a break, but it changes how an app's UI looks: each restyle's changelog entry
  says what changed and how to keep the old look (the tokens to set).

### D13. The colour picker: a library in our wrapper

- p804 Phase 0 picks it. Candidates: `vanilla-colorful` (custom elements, a few KiB, accessible
  sliders), Coloris (no dependencies, accessible, a popup with inputs), `iro.js` (wheel and box
  layouts). Criteria: gzip size, keyboard and screen reader use, alpha, HSV / HSL / RGB / hex, how
  far its look can follow our tokens (a shadow root needs `::part`), maintenance (last release,
  open issues), licence.
- Ours around it: the swatch and text input (hex, `rgb()`, `hsl()`, three.js float triples), an
  intensity field for HDR colours (light colours and emissive), linear / sRGB awareness for
  `THREE.Color` (the picker shows sRGB, the binding stores what the target expects), recent and
  scene palette swatches, the EyeDropper API where the browser has it, copy and paste (D9).
- Loaded on the first open (D10).

---

## 4. Component catalogue

The prompt asked what else a game or 3D app UI needs. This is the list the children build from;
each child may move an item to a later child or drop it with a reason.

### 4.1 Existing pieces (p803)

- Restyled and given D8: draggable windows (`role="dialog"`, a label, a key to cycle windows),
  dialogs (focus trap and return, `aria-modal`), the drop-down (already accessible; restyled, and
  a searchable variant), toasters (`aria-live`, pause on hover and focus, keyboard dismiss, the
  status colours with icons), icons (the registry stays; sizes from tokens).
- Moved in from the debugger and generalised: the percentage pie (→ p805's donut), the scene
  loader's spinner (`kernel/scene/debug/_dbg__DebuggerSceneLoader.ts` → spinner and the loading
  overlay), the debugger list (→ p805's list), the tab host's tab buttons (→ p805's tabs), the key
  shortcut chips (`_dbg__DebugKeyShortcuts.ts` → `kbd`).

### 4.2 Core (p803)

- **Button**: variants primary (the one accent use), secondary, ghost, danger; sizes; icon left,
  right or only (icon-only requires a label); a loading state where the text fades into a spinner
  and the width is kept, with `aria-busy` and clicks ignored; a toggle button (`aria-pressed`); a
  button group and a split button (an action plus a drop-down); a hold-to-confirm option for
  destructive actions (a ring fills while held; Enter held does it too); keyboard shortcut hints
  (`kbd` inside).
- **Link**: internal vs external (an external link gets an icon, `rel="noopener noreferrer"` and
  "opens in a new tab" for screen readers); a link styled as a button and a button styled as a
  link, each with the right element.
- **Icon button**, **badge**, **tag / chip** (removable, selectable), **kbd** and the **input
  glyph** (one key or a chord; p808 makes it device-aware).
- **Tooltip** (on hover and focus, delayed, Escape closes, `aria-describedby`) and **popover**
  (anchored, flips at the container's edges, focus moves in).
- **Spinner** (sizes, label for screen readers), **progress bar** (determinate, indeterminate,
  segmented, with a label and `role="progressbar"`), **skeleton** (loading placeholder, no
  motion under reduced motion), **divider**, **empty state** (icon, text, an action).
- **Loading overlay** (the scene loader's, public: an app's scene loader UI, p613's
  `createSceneLoader` hooks).

### 4.3 Forms (p804, Tweakpane's replacement)

- Fields, each on D9's binding: **number** (scrub, units, precision, min / max, wrap for angles),
  **slider** (a number with a track, ticks, a value bubble), **range** (two thumbs: min gap, steps,
  ticks and labels, an optional histogram behind the track, the span draggable as a whole),
  **checkbox**, **switch**, **radio group**, **segmented control**, **select** (the drop-down),
  **text**, **textarea** (Tweakpane's multiline), **search**.
- Value editors: **colour** (D13), **vector 2 / 3 / 4** (axes in a row, a link-axes lock to scale
  them together), **rotation** (Euler in degrees with its order, `step` as Tweakpane's
  `Math.PI / 8` today), **quaternion** (edited as Euler or axis-angle, stored as a quaternion,
  never shown as raw xyzw unless asked), **angle dial**, **2D pad** (a point in a box, for
  offsets and directions), **gradient editor** (sky colours, ramps), **curve editor** (easing and
  falloff curves; p426's sequencer reuses it).
- Containers: **folder** (a disclosure: nested, its open state persisted, Tweakpane's folders),
  **fieldset**, **property grid** (the label column the debugger uses: aligned, resizable, labels
  truncated with a tooltip), **monitor** (read-only value, text or a sparkline).
- **Form**: a group of fields with validation (messages under the field, the `danger` role with an
  icon, `aria-invalid`), submit and reset; what p355's save menu and p808's settings menu build on.

### 4.4 Data display (p805)

- **Table**: title and caption, headers with sort (`aria-sort`), colour roles per cell (D6), cells
  as buttons or links, hover and focus highlighting of the row, the column or the cell, sticky
  header and first column, number alignment and tabular figures, row selection, virtualised rows
  past a threshold, responsive (scroll inside its box, or stack rows as cards below a width), and
  an empty state. The profiler's tables move onto it.
- **List**: static, selectable (single, multiple), draggable reorder (pointer and Alt+arrows, with
  a live announcement), searchable and filterable (a search field, highlighted matches),
  virtualised, with per-row actions (the debugger list's toggles).
- **Tree view**: the scene graph and entity inspector (expand, select, keyboard per the APG tree
  pattern, lazy children).
- **Graphs**: static line and bar charts (SVG, accessible: a title, a description, the values in a
  table for screen readers), running time series (canvas, a ring buffer, no allocation per frame,
  the profiler's and p807's), the 100% stacked / segmented bar (a frame's time by stage, memory by
  category), sparkline, and the donut (the percentage pie generalised).
- **Stat tile**: a figure, its unit, a delta and a sparkline.
- **Tabs** (APG tabs, the tab host's buttons), **accordion**, **splitter** (resizable panes,
  keyboard resizable), **context menu** (right-click and the context menu key), **command palette**
  (the Hub's ⌘K search, generalised: commands as data; the debugger's actions become searchable).

### 4.5 Game UI (p808)

The pieces games build again and again, made engine-aware where the engine knows something the
DOM doesn't:

- **Bars**: health and resource bars (segmented, with a delayed "damage trail", a heal flash,
  thresholds in the status roles), a radial cooldown overlay on an icon.
- **Items**: hotbar and inventory grid with drag and drop (and keyboard / gamepad moves), slots,
  stack counts, a tooltip with stat comparison.
- **World anchors**: DOM labels, nameplates and markers that follow an entity's position (projected
  each frame through the active camera, hidden behind the camera, clamped to the container's edge
  as an off-screen waypoint arrow, culled by distance), batched into one per-frame system that
  writes `transform` only on change (D7's per-frame rule).
- **Navigation aids**: compass strip, a minimap frame around a `viewports()` viewport.
- **Text**: dialogue box and subtitles (a typewriter reveal that respects reduced motion, speaker
  names, choices as buttons), notification feed, objective / quest tracker.
- **Menus**: radial menu (gamepad stick or mouse), pause menu, settings menu builder (graphics,
  audio, controls; the controls page rebinds p610's action maps, p770's UI), loading screen (tips,
  progress, the loading overlay of §4.2).
- **Device-aware prompts**: the input glyph of §4.2 showing the binding of an action for the
  device last used (keyboard or the gamepad's family), switching when the player switches.
- **Spatial focus navigation**: arrow keys and the gamepad's d-pad / stick move focus by position
  across the HUD's focusable elements, with focus groups and a "back" action; the whole kit works
  without a mouse.
- **Crosshair / reticle** and **hit markers** (CSS-drawn, tokens for colour and size).

---

## 5. Plan map

```
p801 design foundation (tokens, themes, fonts, units, motion, a11y baseline)
  ├─ p802 Hub Project section (its Phase 1, dev-only pages, lands before p801: p801 D11)
  │    └─ p809 roadmaps and docs/ vs docsApp/
  └─ p803 UI kit structure and core components
       ├─ p804 forms and bindings ──┐
       ├─ p805 data display ────────┼─► p806 debugger migration (engine-6, needs p618 done)
       │                            │      └─ p807 stats and profiler graphs
       └────────────────────────────┴─► p808 game UI components + gameHud example
```

Each child starts with its own Phase 0 (grounding against the code at that time), and its last
two phases are the Hub update and the versioning / changelog / done marking
(`docs/plans/CLAUDE.md`).

### p801 — Design foundation

Done: `_DONE_p801_design-foundation.md` (2026-10-25, engine 5.11.0, app 1.15.0). What the later
plans build on, each written there: the kit root `.aekUi` and the tokens in `tokens.css` (D2, with
`border-control`, a role this plan didn't have), the type and space scales as lengths from
`--aek-base` (not `em`s), `--aek-rem` the existing styles' internal unit for p803 / p806 to remove
as they restyle, every colour, duration and outline mapped to a role (its §4, p803's and p806's
restyle table), IBM Plex Sans and Mono behind `aekasha/ui/fonts` (D8), and the embed issues it
left for p803 (Phase 3's As built). What follows is the plan as written.

- Phase 0: the font study (D5) on a dev-only specimen page; the token inventory (every colour,
  size and duration in the kit's and the debugger's styles, mapped to a role).
- `tokens.css` (D2), the layers (D3), the em base and UI scale (D4), motion (D7), the focus ring
  and the contrast test (D6, D8); the fonts self-hosted where both the Hub and the engine read them.
- The embed fix: `getWindowSize` on the HUD root's container, `page.scss` without 62.5%, the kit's
  existing styles converted (about 150 values in four files; the debugger's styles get the
  conversion only, their restyle is p806's), the `uiKit` profile and the `verify:embed` check;
  `docs/issues/ui-kit-in-an-embed.md` closed.
- The Hub on the shared tokens (aliases, p801 D2).
- No new component; the look of the existing ones changes only through the tokens.

### p802 — Hub Project section

Done: `_DONE_p802_hub-project-section.md` (2026-10-25: Phase 1 as `p802-dev-pages`, the rest
with engine 5.11.1, app 1.15.1). What the later plans build on, each written there: `aek:dev`
pages, which a public page links only inside `::: dev-only` (D1, D2), and the Project section
under the header's button; Ækasha's design document, whose token tables are generated from
`tokens.css` (a new token's prefix needs a group in `devTools/hub/generated/design.ts`), and the
app's to fill in; the component library (`project/aekasha/components/`,
`hub/_assets/ts/_components.ts`), where p803-p808 add their components' demos in their Hub phase
(the page's three elements per piece, `DEMOS`, `COMPONENT_USES`: `hub/CLAUDE.md`) and from which
p803's public component library page is to render. For p803: the Hub's script build stands in
for `MainLoop.ts` and the storage module, and the library imports `createHudContainer` and the
kit's global styles by path, all until p803 cuts the kit's kernel imports and gives it a public
root; the findings it left are `src/_engine/ui/CLAUDE.md`'s "Left for p803". What follows is the
plan as written.

- Dev-only pages: an `aek:dev` meta (in `META_NAMES`) that a page's children inherit;
  `discoverPages` drops them in `public`, so they're absent from `dist-hub/`, the nav and the
  search index (the Hub has no sitemap); a public page linking to one fails the build with a
  message naming the page (a link inside `::: dev-only` is fine).
- The **Project** button: on the right of the nav (next to `.hubTools`), filled with the accent
  (D6: the one primary action in the header), with an icon; a shell placeholder that's empty in
  `public`; in the mobile panel too.
- Pages: `/hub/project/` (the core philosophy: the brand and principles of the root `CLAUDE.md`,
  and how the project is developed), `/hub/project/aekasha/` (Ækasha development: code conventions
  linking the public coding standards, the plan and issue workflow, the code blocks reference moved
  here from `documentation/code-blocks/`, the design document, the component library) and
  `/hub/project/app/` (the app's own: a design document template to copy, its conventions).
- The design document: colours (the tokens and their roles, with D6's rules), type (families,
  scale, numbers), spacing and layout, radii and elevation, motion (D7), icons (the set, sizes,
  when an icon needs a label), patterns (primary action, forms, empty states, errors, loading,
  destructive actions), accessibility (D8), voice (labels and messages).
- The component library (dev): every component and every state, both themes and densities, with
  the internal notes (which debugger panels use it, its budget line), linking the public page.
- The hero's right column, dev only: quick links into the Project section (the app's design
  document first, as the prompt asks), under "Build / Explore / Create".
- Moving `code-blocks/`: its region comment in `physicsTest.ts` and its page's copy of it,
  `hub/CLAUDE.md`, `devTools/hub/CLAUDE.md`, `docs/techniques/hub-authoring.md` and `_search.ts`
  updated in the same change (`moveText.test.ts` went with `devTools/refactor/` in p619). It becomes dev only, so the public Hub loses it:
  p802 checks no public page links it.

### p803 — UI kit structure and core components

- The layout: `ui/core/` (CMP, HUD root, icons), `ui/components/` (§4.2), `ui/overlays/` (windows,
  dialogs, popover, tooltip, toaster, context menu), `ui/forms/` (p804), `ui/data/` (p805),
  `ui/game/` (p808), `ui/styles/`; a move codemod as p608's if the move is large. One coding
  style: D1's handle shape, props, `on*` events, disposal, JSDoc with `@example`.
- The existing pieces restyled on the tokens and brought to D8 (§4.1), the debugger pieces moved
  in (§4.1), the core components (§4.2).
- The `T`-prefixed renames with deprecated aliases (D12).
- Tests: each component's keyboard map and ARIA states in Node with linkedom (as the kit's tests
  are); a Playwright pass of the component library page in `verify:embed` or a new verify command
  (decided here) with an accessibility checker (eg. axe-core, dev dependency).

### p804 — Forms and bindings

- Phase 0: the colour picker study (D13); the binding scheduler's design checked against today's
  builder (`_dbg__DebuggerPaneBuilder.ts`) and undo (`UndoRedo.ts`).
- The scheduler (D9), the fields, the value editors and the containers (§4.3).
- A declarative form description (the debugger's `pane` sections' shape, without Tweakpane), so
  an app and p806 describe a form as data.

### p805 — Data display

- The table, list, tree, graphs, stat tile, tabs, accordion, splitter, context menu and command
  palette (§4.4). The running graph's renderer measured with the perf-auditor agent before p807
  builds on it.

### p806 — Debugger migration (engine 6.0.0)

- The drawer, the tab host, the pane builder, the profiler window, the editor drawer and the
  on-screen tools on the components; the compact density; the debugger's styles on the tokens.
- The port: the 30 declarative sections mechanically (D9's names), the 8 imperative panes
  rewritten as declarative forms or the components directly, `DayNightFolder`'s `custom` section
  on the button group. The files over 800 lines and functions over 150 (the p800 header lines) are
  split as they're rewritten, and their header lines removed.
- The tab contract: `DebuggerTabDef`'s non-Tweakpane fields keep working (sections, `state` /
  `persistKeys` / `lsKey`, `refreshIntervalMs`, `onRefresh`, `onOpen`, `sceneId`, the lists), a
  throwing `content` or `onRefresh` still shows an error line, every registration still works
  at any time. What breaks, listed in p622's migration page: `onCreate` and `onChange`'s `e.api`
  get the field's handle instead of a `BindingApi`, `custom.build` gets a CMP container instead of
  a `Pane | FolderApi`, and binding fields outside D9's map are an error instead of passed to
  Tweakpane.
- The scene change: the open tab is still rebuilt from `content` by default (the camera, light,
  character and ray cast tabs build from the scene's data). A tab can opt out
  (`keepOnSceneChange: true` with an `onSceneChange` hook), keeping its scroll position, open
  folders and focus; the engine's tabs whose content doesn't depend on the scene opt out.
- The on-screen tools are disabled during a scene load (`_disableDebugger` disables them too,
  with `aria-disabled` and a "loading" tooltip): `docs/issues/on-screen-tools-during-scene-load.md`
  closed.
- `tweakpane` and `@tweakpane/core` removed from `package.json`.
- Docs: the debug suite page and its "Write your own tab" guide, `examples/debugTab/` and its
  walkthrough, `src/_engine/debug/CLAUDE.md`, `readme.md`'s debug suite line ("built on
  Tweakpane").
- Verification adds the scene runner's screenshots of each tab open (`yarn verify:scenes`), the
  tab system order baseline, and an undo / redo pass over a ported tab of each kind.

### p807 — Stats and profiler graphs

- Phase 0 is a gate: our stats panels (FPS, CPU, GPU, compute, physics, target FPS) on p805's
  running graph and `_dbg__GPUTimer.ts`, compared with stats-gl on both backends for accuracy,
  cost per frame and the timestamp query budget. If it passes, `stats-gl` is removed and the GPU
  timing has one owner; if not, the plan records why and restyles stats-gl's panels instead.
- The profiler's tables, sparklines and the GPU memory tab on p805's components.

### p808 — Game UI components

- §4.5, and the `examples/gameHud/` scene with its Hub example page: a small arena where world
  anchors (nameplates, a waypoint), health and resource bars, a hotbar, a notification feed, a
  dialogue box, a pause and a settings menu (UI scale, theme, reduced motion, key rebinding) are
  all used, playable with keyboard, mouse or gamepad without switching modes.
- The world anchor system's per-frame cost measured (the perf-auditor agent) with 200 anchors.

### p809 — Project roadmaps and docs split

- `docs/` stays Ækasha's (plans, issues, techniques, analysis, templates); `docsApp/` (the name is
  this plan's to confirm) gets the app's plans and issues with the same file formats, so an app
  made from the template keeps its own without mixing them with the engine's.
- The Project section's roadmap pages (dev only), one for Ækasha and one for the app: generated
  from the plans' header lines (`Status`, `Category`, `Blocks` / `Blocked by`, `Epic`) as a table
  and a dependency graph, done and open; the issues per area.
- The Hub's Issues section reads both folders; `readme.md`'s Roadmap points at the page.
- The plan rules (`docs/plans/CLAUDE.md`) gain the app's folder.

---

## 6. Branches and PRs

Every PR into `main` runs `yarn checkVersions --against main` and bumps what it changed (one bump
per merge). The children are written and started one or two at a time; p804 and p805 can run in
parallel branches.

| Plans                                    | Branch                    | Merges into                                         | PR                                                                                                                                          |
| ---------------------------------------- | ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| p801, p802, p803, p804, p805, p808, p809 | each its own, from `main` | `main`                                              | one per plan when its last phase is done: engine / toolkit minors or patches, the Project entry for p802 and p809's tooling                 |
| p806                                     | its own, from `engine-6`  | `engine-6` (cut from `main` when p622 is scheduled) | into `engine-6` after its last phase; `engine-6` → `main` is engine 6.0.0 with p622's removals, codemod and migration page (a new codename) |
| p807                                     | its own                   | `main`, or `engine-6` if it changes a public type   | one when its last phase is done                                                                                                             |

One exception to "one PR per plan": p802's Phase 1 (the dev-only pages) is its own PR into `main`
(`p802-dev-pages`), merged before p801 starts, since p801's font study needs a dev-only page
(p801 D11, p802 D10). p802's other phases follow on `p802-hub-project-section`.

If p806 is ready long before p622 is scheduled, `engine-6` is cut then and kept rebased on `main`;
p622 is expanded into a full plan at that point (its stub says so).

---

## 7. Integration with existing plans and issues

- **p600** (§9): its "p800 … not planned yet" line points here. p800 isn't a p600 stage; it
  starts from p608's debug placement, p617's kit and p618's debug API.
- **p618** (done, engine 5.9.0): it blocked p806 only. Its "Write your own tab" guide and `examples/debugTab/` are what p806
  rewrites; its D1 / D8 header lines are what p806 removes.
- **p622**: p806's breaks (D12) and the kit's `T` renames ship in it; its migration page lists
  p806's tab type changes.
- **p150** (origin info on the camera and light edit windows) and **p373** (merge debugging): if
  they land before p806, they use the current panels and p806 ports them with the rest; after, they
  use the components.
- **p355** (save menu): its menu and settings use p803 / p804.
- **p426** (sequencer): its curve and timeline editing reuses p804's curve editor.
- **p770** (the key binding refactoring prompt): its rebinding UI is p808's settings menu's
  controls page.
- **`docs/issues/ui-kit-in-an-embed.md`**: fixed and closed by p801 (D4).
- **`docs/issues/on-screen-tools-during-scene-load.md`**: fixed and closed by p806.

---

## 8. Risks and open questions

**Risks:**

- **The port's size.** 43 panel files and about 36,000 debug lines. Mitigation: D9's one-to-one
  names so the declarative sections port mechanically, one area per phase, the scene runner's
  screenshots of each tab, and the undo / redo pass.
- **Undo and persistence semantics.** Today's undo coalescing and LS writes key on Tweakpane's
  `last`. D9 keeps `last`; p804's tests pin the event order before p806 moves anything.
- **Monitor cost.** The light and physics windows show dozens of live values. The scheduler (D9)
  and the perf-auditor agent's review in p804 and p806.
- **Fonts.** Size (a Latin variable subset of a sans and a mono is roughly 100-150 KiB), licences
  (OFL for every candidate), rendering differences between platforms. Mitigation: D5's study and
  the opt-in.
- **The colour picker library.** Maintenance and its shadow root. Mitigation: D13's criteria and
  the wrapper, so a swap later touches one module.
- **The restyle changes apps' UI.** D12's changelog notes and the tokens to restore a look.
- **The scene runner's baselines** change with every restyle; each child records them on `main`
  before its first run and updates them on purpose (`docs/plans/CLAUDE.md`).

**Open questions (decided in the children):**

- One `aekasha/ui` entry or sub-entries per group (p803, D10).
- The native `<dialog>` element for modal dialogs vs the current window code with a focus trap
  (p803).
- A new verify command for the component library page's accessibility pass, or a mode of
  `verify:embed` (p803).
- The app docs folder's name, `docsApp/` or another (p809).
