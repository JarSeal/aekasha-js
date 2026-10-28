Status: draft | not-implemented
Category: UI, Debug, Refactoring, Accessibility
Epic: p800_debugger-ui-overhaul.md
Blocks: p807_stats-and-profiler-graphs.md (p800 §5; written when it starts)
Related: \_DONE_p804_forms-and-bindings.md (the binding, the scheduler, the declarative grid; its §4: what this port rewrites by hand), \_DONE_p805_data-display.md (the list, the tabs, the table, the splitter; its §4: the debugger's lists and tab menus), \_DONE_p803_ui-kit-structure-and-core.md (D6: the debugger until p806; the window helper classes and `uiIcon` it left), \_DONE_p801_design-foundation.md (§4: every debugger colour mapped to a role; D2: the compact density's sizes left for this plan; D4: `--aek-rem`), \_DONE_p618_review-debug-public-api.md (P7: the Tweakpane fields in the tab types; D8: the header lines; the "Write your own tab" guide), p622_engine-6-major.md (the major this ships in; its migration page lists D3's breaks), p150_current-entity-data-source-info-on-edit-windows.md and p373_merge-debug-and-member-editing.md (edit windows built on this plan's), `docs/issues/on-screen-tools-during-scene-load.md` (closed here: D7)

# Debugger Migration

p800's sixth child: the debugger rebuilt on the UI kit. The drawer, the tab host, the pane builder,
the profiler window's shell, the editor drawer and the on-screen tools on the kit's components; every
Tweakpane panel on the property grid; every debugger stylesheet on the tokens, in the compact
density, with a theme setting. Tweakpane leaves `package.json`. The files that were left unsplit
because "p800 replaces" them are split as they're rewritten.

It breaks the tab types' Tweakpane parts (p618 P7), so it ships with engine 6.0.0 on the
`engine-6` integration branch (p800 D12, §6). Everything else about a tab keeps working, including
what it saved in localStorage.

---

## 1. As found (2026-10-28, `main` at `e6ad8f2c`, Engine 5.14.0)

Three read-only passes over the code (greps, then reads by hand). Phase 0 refreshes the port
census against the branch's start (§4.1).

### 1.1 p800's p806 sketch, checked

p800 §2.1, §5 and p804 / p805's §4 hold, with these differences:

- **The counts:** 26 declarative sections (p800: 30; p804's 26 holds), 20 `createDebuggerTab`
  calls (15 engine, 5 app; p800: 25 in 22 files), one public `createProfilerTab`
  (`gpuMemory/_dbg__GPUMemory.ts:488`) and three internal (`profiler/_dbg__Profiler.ts:305-309`).
  7 `new Pane` in 6 files outside the builder (p804's count), with 54 imperative `addBinding`s
  (Light 32, Camera 9, Physics 5, PostFX 3, ECS 3, Character 2; p804: 53).
- **Tweakpane in the contract has almost no users:** no `onCreate` and no handler reading `e.api`
  anywhere; one `custom` item (`features/skybox/debug/_dbg__DayNightFolder.ts:144`, engine). No
  app or toolkit file imports Tweakpane. So D3's breaks are type-level for an app.
- **Tweakpane outside the builder:** `tweakpane` imported in 9 files (`DebuggerGUI.ts` for types,
  the builder, and the camera, light, ECS, physics, character, PostFX and day-night modules),
  `@tweakpane/core` in 3 (`DebuggerGUI.ts`, the builder, `_dbg__LightGUI.ts:41`'s `ListBladeApi`
  casts). Four `.on('fold')` (PhysicsAPI:408, LightGUI:814, :933, CameraGUI:321), seven pane
  `refresh()`s (ECS:109, PhysicsAPI:446, :454, :585, :607, Character:209, :239), seven `addBlade`s
  (five separators, LightGUI's two `view: 'list'`), `view: 'color'` at 14 sites, Tweakpane's
  `tp-btnv_b` class in two places (`DayNightFolder.ts:97`, `DebuggerGUI.module.scss:196`).
- **A fourth builder user:** the ray tester calls `_buildDebuggerPane` directly
  (`kernel/render/debug/_dbg__RayTester.ts:382`), outside any tab host.
- **The material editor's tabs** (`debug/editors/material/_dbg__MaterialEditorTabs.ts`: Params,
  Settings, Camera) are declarative sections in the editor drawer's tab host. Its selector is raw
  DOM (`_dbg__MaterialEditorSelector.ts`).
- **No debug file uses a kit component** beyond `createDropDown` (the on-screen tools),
  `createDonut` (the ray cast tab, p805), `createLoadingOverlay` (the scene loader, p803),
  `openDialog`, `addToast` and the window functions. Every table, list and tab menu is an HTML
  string or hand-made CMP (p805 §4.1's census).

### 1.2 The framework

| File                                  | Lines | What                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debug/DebuggerGUI.ts`                | 587   | The public types and thin functions. `DebuggerPaneBinding` (:104) has `onChange(value, { prev, last, api: BindingApi })`, `onCreate(api)` and an index signature passing any other field to `addBinding`. `DebuggerPaneCustom.build(parent: Pane \| FolderApi)` (:188). Tweakpane types at :2-3                            |
| `debug/_dbg__DebuggerGUI.ts`          | 445   | The drawer. Creating or removing a tab rebuilds the whole drawer (`_createDebugGui`, :347, :383, :400). A scene change (`_updateDebuggerSceneTitle` :426, from `kernel/scene/Scene.ts:247`) sets the title in place and remounts the open tab. `_disableDebugger` toggles a class only; its TODO at :439 is the issue file |
| `debug/_dbg__TabHost.ts`              | 257   | Mounts a tab: heading row, sections, `onOpen`, a `setInterval` for `refreshIntervalMs` while visible. A throw while building leaves the error line; a throw while refreshing stops the interval. Used by the drawer, the profiler window and the editor drawer                                                             |
| `debug/_dbg__DebuggerPaneBuilder.ts`  | 217   | The only place that builds Tweakpane from items: one `Pane` per section; one-level state paths; persistence on `e.last` (:129); folders in `uiLsKey`; a suppression flag around `refresh()`, because Tweakpane emits `change` on refresh; `prev` from a `structuredClone` kept per binding                                 |
| `debug/_dbg__DebuggerList.ts`         | 157   | The debugger list (p805 §4: `createList`)                                                                                                                                                                                                                                                                                  |
| `debug/profiler/_dbg__Profiler.ts`    | 309   | The profiler window. Its own icon tab menu (:179-207)                                                                                                                                                                                                                                                                      |
| `debug/editors/_dbg__EditorDrawer.ts` | 288   | The editor drawer. It reuses `DebuggerGUI.module.scss`' classes                                                                                                                                                                                                                                                            |
| `debug/_dbg__OnScreenTools.ts`        | 557   | The on-screen tools: CMP buttons, `createDropDown`                                                                                                                                                                                                                                                                         |
| `debug/_dbg__DebugKeyShortcuts.ts`    | 606   | The key shortcuts dialog: a `role="tablist"` by hand, raw `<kbd>`s                                                                                                                                                                                                                                                         |

The drawer's LS: `AEK_debugDrawerState` (`{ isOpen, currentTabId, currentScrollPos }`). The
scroller's height is set from script on resize (:241-271).

### 1.3 Tabs and the scene change

Tabs by how their content uses the scene:

- **Built from the scene's data** (captured when `content()` runs, so they need the rebuild):
  Debug tools, LOD, sky box, spatial grid, ray cast.
- **Through a getter a refresh re-reads** (a refresh would do): PostFX, ECS, characters, cameras,
  lights, assets.
- **No scene data:** stats, loop, renderer, physics (boot proxies; its entity list is a getter),
  the four profiler tabs.
- **Scene tabs** (`sceneId`; all five app tabs): removed on their scene's exit anyway.

### 1.4 Undo

Seven files record undo from a change handler (`recordOrCoalesceUndoRedoAction`): the debug tab
example, the sky box edits, the material editor, the physics tab, the character state window (CMP,
not Tweakpane), the light window (position and target record on `last` only, :760, :780) and the
camera window (position on `last` only, :306). Eleven more handlers act on `e.last` only:
persistence, rebuilds, PostFX's non-coalesced record. p804 D3 pinned the event order these rely on
(`Binding.test.ts`).

### 1.5 Styles

- **15 debugger stylesheets**, 2,751 lines. They hold 415 `var(--aek-rem)` uses, plus 6 in
  `_dbg__Assets.ts`' inline styles and 9 in `features/viewports/Viewports.module.scss` (not debug).
  No other `--aek-rem` user exists outside `tokens.css`.
  - The largest: `DebuggerGUI.module.scss` 511 lines (82 uses), `CharacterStateWindow` 406 (53),
    `Profiler` 399 (59), `MaterialEditor` 327 (43).
  - None uses `@layer` or `:where()`. There are 107 `:global(` rules and 21 `color.adjust` calls.
  - Hex literals: `#28292e` (×2), the character window's `#e3b341` and `#58a6ff`, the assets
    checkerboard and markers, and `Stats.scss`' `#222` (p807's).
- **`ui/styles/variables.scss`** (55 lines) has 13 importers, all debugger stylesheets.
  - The colours are used as p801 §4.2 mapped them.
  - It also holds the breakpoints (in 7 files), `$drawerWidth` / `$drawerWidthSmall`,
    `borderRadiusSmall` and the `nakedButton` mixin (in 6 files). `dragWinContentPadding` is dead.
- **`_debugTabButtons.scss`:** used by the drawer's and the profiler's tab menus.
- **The kit carries debugger styles:**
  - `DraggableWindow.scss:275-341`: `winPaddedContent`, `winSmallLabel`, `winSmallIconButton`.
  - `kit.scss`: the unlayered `.uiIcon` rules (:89-95) and the `[data-aek-debugger] .aekIcon` reset
    (:65).
  - The `.uiIcon` class is selected in 4 debugger stylesheets, and `smallIcon` in the on-screen
    tools.
- **The roots:**
  - The dark theme is forced in 4 places: the drawer `:184`, the editor drawer `:87`, the on-screen
    tools `:153`, and the debug windows (`DraggableWindowDom.ts:32`).
  - `DEBUGGER_ROOT_ATTR` is set on those 4, on the stats panels and on the debug toaster.
  - `data-aek-density` is set nowhere: the compact density exists only in `tokens.css` and the Hub's
    demos.

### 1.6 Sizes

- 108 `_dbg__` files, 36,715 lines.
- **Over 800 lines, with a p800 header:**
  - `_dbg__CharacterStateWindow.ts` 1492
  - `_dbg__LightGUI.ts` 1489 (`createEditLightContent` 495 lines)
  - `_dbg__RayTester.ts` 1266
  - `_dbg__PhysicsAPI.ts` 1186 (`_createPhysicsAPIDebugGUI` 268, its `content` 225;
    `createEditPhysicsEntityContent` 157)
  - `_dbg__Assets.ts` 1121
  - `_dbg__MaterialEditor.ts` 1071
  - `_dbg__DebugTools.ts` 823 (`buildDebugToolsItems` 402)
- **Under 800 lines, but with a p800 header because of a function over 150:**
  - `_dbg__LOD.ts` 643 (`_createLodDebugGUI` 425)
  - `_dbg__SpatialGrid.ts` 717 (`_createSpatialGridDebugGUI` 372)
  - `_dbg__CameraGUI.ts` 740 (`createEditCameraContent` 239)
- `_dbg__PhysicsDebugDraw.ts` (1104) and `_dbg__CharacterGizmos.ts` (950) carry p618's "split when
  next reworked" header, not p800's: they draw in 3D, not UI.
- No framework function is over 150 lines.

### 1.7 Docs, checks, build

- **The Hub:**
  - `features/debug-suite/guide.md` (400 lines) teaches the tab API with inline code (no
    regions). Its Tweakpane note is at :63-68.
  - `examples/debug-tab/walkthrough.md` includes four regions of `src/app/examples/debugTab/`. The
    tab binds a slider, a `view: 'color'`, a button, a separator and a monitor.
  - The tags name `tweakpane` (`debug-suite/index.html:11`, `debug-tab/index.html:9`).
  - The forms binding guide's `## Coming from Tweakpane` (:242) is for any app.
  - There is no engine 6 migration page (`documentation/migration/` has `engine-5.md`).
- **Other docs:**
  - `readme.md:71` ("built on Tweakpane") and `:479` (the credits, with stats-gl).
  - The root `CLAUDE.md`'s Debug system (:130, :134).
  - `debug/CLAUDE.md` (:5, :8, :20).
  - `ui/CLAUDE.md`'s nine "until p806" lines (:28, :43, :44, :76, :129, :132-134, :137).
- **The dev component library:**
  - The "Tweakpane parity" box (`hub/_assets/ts/_library/containers.ts:274`).
  - The "Debugger parity" box (`_library/parity.ts:504`; its tab menus row says "p806 decides" the
    wrap).
- **The scene runner:**
  - It snapshots the canvas only; no configuration opens the drawer.
  - The system order baseline is per scene and local
    (`.cache/verify/scenes/<backend>/baseline.json`).
  - There is no tab order record.
- **Node tests:** 9 files under `debug/`.
  - `_dbg__DebuggerGUI.test.ts` covers the rebuild on a title change and a throwing saved tab.
  - `_dbg__TabHost.test.ts` covers a failing tab and a throwing `onRefresh`.
  - `UndoRedo.test.ts` covers coalescing and persistence.
  - There is no builder test.
- **Build:**
  - `sbp.config.ts` has no debug, Tweakpane or stats-gl line; production carries none of them
    (`verify:baselines`' debug check).
  - Dependencies: `tweakpane` 4.0.5, `@tweakpane/core` 2.0.5 (dev), `stats-gl` 4.2.3 (p807's).
- **Git:** no `engine-6` or `p806` branch. Engine 5.14.0 (Golden Hour), toolkit 2.2.1 (Half
  Moon), app 1.18.0 (Preschooler).
- **The kit has what the port needs:**
  - `addPropertyGridItems` with Tweakpane's names, `custom(container: CMPHandle)` and
    `onCreate(field)` (`forms/PropertyGridItems.ts`).
  - `createBindingScheduler`.
  - `createTabs` (`orientation: 'vertical'`, `keepMounted`, `badge`; an overflowing list scrolls,
    with no wrap).
  - `createList` with `actions`, `createListReorder`, `createTable`, `createSplitter`.
  - `createFieldContextMenu`, `createKbd`, `createButtonGroup`.

---

## 2. Decisions (proposed 2026-10-28, for review)

### D1. Scope

- **In:**
  - The framework: the drawer, the tab host, the pane builder, the debugger list.
  - The profiler window's shell and its Settings tab.
  - The editor drawer and the material editor.
  - The on-screen tools.
  - Every drawer tab, edit window and debug window.
  - The About and key shortcuts dialogs, the character state window, the ray tester, and the assets
    tab with its info window.
  - Every debugger stylesheet restyled onto the tokens. `variables.scss` and `--aek-rem` go.
  - Tweakpane's removal. The issue file (D7).
- **p807's, not here:**
  - The profiler's Overview, Objects and GPU memory content (tables, bars, sparklines onto p805's
    pieces).
  - stats-gl and `_dbg__Stats.ts`' panels, and `Stats.scss`.
  - What p806 does there: it ports their Tweakpane sections (the Stats tab's, GPU memory's two)
    and maps their stylesheets' colours and sizes to tokens (`Profiler.module.scss`,
    `GPUMemory.module.scss`), so `variables.scss` can go. Their structure stays HTML strings for
    p807.
- **Out:**
  - The 3D debug drawing (`_dbg__PhysicsDebugDraw.ts`, `_dbg__CharacterGizmos.ts`: p618's headers
    stand) and the 3D scene's colours (p801 §4.1).
  - New debugger features (p150's origin rows, p373's merging tab): they land on this plan's
    pieces.
  - A storage layer: the debugger keeps its LS keys and formats (D3).
- **If the plan runs long,** the character state window's rewrite onto fields leaves to a
  follow-up issue (restyled on the tokens here, its raw DOM kept), and p800 §5 says so. It's the
  one large UI with no Tweakpane in it.

### D2. Branches and versions

- **Branches:** `engine-6` is cut from `main` in Phase 0 (it doesn't exist yet; p800 §6), and
  `p806-debugger-migration` from `engine-6`. `engine-6` is rebased on `main` after each merge to
  `main`, and `p806-debugger-migration` on `engine-6`. p807 starts after p806 (p800 §5); p808 and
  p809 may merge to `main` meanwhile, so their kit and Hub changes are what the rebases meet.
- **No version bump in p806's PR:** it merges into `engine-6`, not `main`, and the versioning
  counts merges to `main`. `CHANGELOG.md` gets an unreleased `engine-6` entry with p806's sections
  (Engine, App, Project). The `engine-6` → `main` merge bumps engine 6.0.0 (its codename p622's),
  the app (its debug modules changed; a minor) and the toolkit if p622 changes it.
- **p622** is a stub. Its migration page needs D3's table, which Phase 3 settles. So p622 is
  written as a full plan after p806's Phase 3 at the latest, or earlier if the major is
  scheduled sooner (the user's call; §5).
- **The restyle note** (p800 D12): the debugger's look changes completely, which isn't an app's
  UI. The changelog shows it, with before and after shots (Phase 6). The one kit-visible change is
  the compact density's retune (D8), if Phase 0 makes one.

### D3. The tab contract

**What stays.** An app's tab keeps working unchanged, unless it uses a row of the breaks table
below:

- The functions keep their names and signatures: `createDebuggerTab`, `openDebuggerTab`,
  `updateDebuggerTab`, `removeDebuggerTab`, `isDebuggerTabOpen`, `persistDebuggerTabValue`,
  `debuggerListCMP`, the profiler's.
- Every field of `DebuggerTabDef`: `id`, `title`, `icon`, `orderNr`, `sceneId`, `lsKey`, `state`,
  `persistKeys`, `uiLsKey`, `headerButtons`, `clearLSButton`, `onClearLS`, `refreshIntervalMs`,
  `onRefresh`, `onOpen`, `content`.
- Sections: `{ pane: true, id?, title?, expanded?, content }`, CMP sections, the lists.
- The item types keep their names (`DebuggerPaneBinding`, `DebuggerPaneFolder`, `…Button`,
  `…Separator`, `…Custom`, `DebuggerPaneItem`, `DebuggerDyn`, `DebuggerStateKey`). They are now
  defined over the kit's `PropertyGrid*Item` types, plus the state-key binding (`key` without
  `target`).
- `type: 'binding'` is accepted next to the kit's untyped field item, and a folder's
  `persistExpanded` stays.
- State keys with one-level paths (`'helpers.showGrid'`).
- **The LS formats:** `lsKey`'s flat object, `uiLsKey`'s `{ folders: { [id]: boolean } }` with
  the same folder ids, and `AEK_debugDrawerState`. So what a 5.x debugger saved loads in 6.0
  (a test, D14).
- Registrations at any time; a throwing `content` or `onRefresh` still leaves the error line.
- `onChange` still fires on user input only, with `prev` and `last`.

**What's new (additive):**

- `keepOnSceneChange?: boolean` and `onSceneChange?()` on a tab (D5).
- `content(ctx)`: `ctx.scheduler` is the tab's binding scheduler, so a CMP section built from kit
  fields refreshes with the tab and pauses with it. `content()` without the parameter still works.
- `uiLsKey` also keeps the label column's width (`labelWidth`; a new key, so an old object still
  loads).
- `AppConfig.debugDrawer.theme` (D8).

**What breaks** (p622's migration page; the types on `aekasha/debug`):

| 5.x                                                                          | 6.0                                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A binding's other fields go to Tweakpane's `addBinding` (an index signature) | The kit's field props only: an unknown field is a type error, and at run time the tab's error line names it |
| `view: 'color'`, `color: { type: 'float' }`                                  | `kind: 'color'`, `format: 'float'`                                                                          |
| `onChange(value, { prev, last, api })` (`api` a `BindingApi`)                | `onChange(value, { prev, last, source, field })` (`field` the field's handle)                               |
| `onCreate(api: BindingApi)`                                                  | `onCreate(field)`                                                                                           |
| `custom.build(parent: Pane \| FolderApi)`                                    | `build(container: CMPHandle)`; a returned function still runs on every refresh                              |
| `prev` on the `last: true` call is the last step's value                     | the value before the gesture (p804 D3)                                                                      |
| A `THREE.Euler` bound is a point in radians                                  | a rotation field in degrees; the bound value stays in radians (p804 D10)                                    |
| A typed number reaches the target unrounded (`1.0999999999999999`)           | rounded to the step's decimals (p804 D6)                                                                    |
| `tweakpane` and `@tweakpane/core` are dependencies                           | gone: an app that imports Tweakpane itself adds it                                                          |
| A list's keys: Tab through every row and toggle                              | one tab stop, arrows inside (p805 D4)                                                                       |

Not breaks, but listed on the page: `createDebuggerTab`'s second parameter and `DebugGUIOpts`
leave in p622 (p618 D3), not here.

### D4. The pane builder on the property grid

- **A section becomes a grid.** `_buildDebuggerPane` (same module, no Tweakpane) builds:
  - `createPropertyGrid({ scheduler: the host's, labelWidth, onLabelWidthChange })`;
  - `addPropertyGridItems(grid, items, { folderExpanded, onFolderExpandedChange, path })`, with
    the folder states from `uiLsKey` and `path` the section's title;
  - a titled section as a folder item of its own (`expanded`, persisted as today).
- **The state binding:** an item with `key` and no `target` binds `{ target: state[root], key:
prop }` for `'root.prop'`, or `{ target: state, key }`. On a change with `last: true`, the root
  key is persisted when it's in `persistKeys`, as today.
- **What goes:**
  - The suppression flag: the grid's `refresh()` fires nothing (p804 D3).
  - The `structuredClone` `prev`: the field's own `prev`.
  - The `as` casts to Tweakpane.
- **Labels:** a binding without `label` gets its key (Tweakpane's default), since the kit needs
  one.
- **Unknown fields:** the builder checks each field item's keys against the kit's field props (one
  list, next to `PropertyGridFieldItem`) and throws naming the item and the key. The tab host's
  error line shows it (D3). This catches a JS app or an `as` cast that TS didn't.
- **The ray tester** keeps calling the builder directly, with its own scheduler (D5's host
  contract, without a tab).
- **p804 §4's hand items:**
  - `view: 'list'` blades become unbound selects.
  - A handler that refreshes its own pane (`_dbg__RayTester.ts`' `refreshPane`) calls the grid's
    `refresh()`.
  - `persistOnCommit`-style wrappers keep working on plain items.
- **The fields' context menu:** one `createFieldContextMenu({ container })` per tab host (Reset,
  Copy, Paste on every grid), removed with the host.

### D5. The tab host

- **One scheduler per host** (`createBindingScheduler`). Its visibility is the host's: the drawer
  open with the tab shown, no editor view hiding it, the profiler window open. Monitors' `interval`s
  run on its tick, which pauses while hidden, as today's interval does.
- **`refreshIntervalMs` stays the tab's:** a `setInterval` while visible, calling `onRefresh`, then
  `scheduler.refresh()`. That is today's `onRefresh` plus `pane.refresh()`.
- **The error line:** a kit empty state with the danger role and its icon ("This tab failed to
  build: …"), still in place of the content.
- **The scene change** (p800 §5):
  - By default the open tab is rebuilt from `content`, as today.
  - A tab with `keepOnSceneChange: true` keeps its DOM, scroll position, open folders and focus.
    Its `onSceneChange?.()` runs, then `onRefresh`, then `scheduler.refresh()`. A closed tab is
    rebuilt on its next mount either way.
  - The engine's tabs opt in where §1.3 says a refresh does: stats, loop, renderer, physics,
    PostFX, ECS, characters, cameras, lights and assets. Phase 0 checks each by running it.
  - Debug tools, LOD, sky box, spatial grid and ray cast keep the rebuild; each could move its
    captured data behind a getter later.
- **The menu changes in place:** creating or removing a tab adds or removes its button. The open
  tab, its scroll and the focus stay; today the whole drawer is rebuilt, so a scene tab appearing
  resets the drawer. This needs the tabs handle to add and remove a tab: Phase 0 checks
  `createTabs` and adds `addTab` / `removeTab` if missing (a kit addition, with its test and demo).

### D6. The shell

- **The drawer** is a labelled `<aside>` (`aria-label="Debugger"`).
  - **The toggler:** a kit icon button with `aria-expanded`, `aria-controls` and its key hint
    (`createKbd`: `h`, or the rebound key).
  - **The heading row:** the scene title and the close button.
- **The tab menu is a vertical icon rail** on the drawer's outer edge: `createTabs` with
  `orientation: 'vertical'`, `iconOnly` (the title as the tooltip and the name),
  `activation: 'manual'` (Enter or Space opens; the arrows only move, since a tab's build isn't
  free).
  - 16 tabs at 32 px are 512 px, so a short window scrolls the rail with faded edges.
  - The scene's tabs come last, after a divider (a per-tab `separatorBefore`, a kit addition if
    Phase 0 finds no form), each with "(scene tab)" in its name. The scene tab's green goes (p801
    §4.2: a category, not a status).
  - The alternative is today's horizontal rows with a `wrap` option added to `createTabs`. The
    rail is recommended: it frees the two wrapped rows for content, and it is the familiar pattern
    in 3D tools (Blender's Properties editor, VS Code's activity bar).
- **The drawer's width is resizable:** a `createSplitter` separator on its inner edge (drag or
  arrows), persisted in `AEK_debugDrawerState` (`width`).
  - Default 400 px at the defaults (today's `40rem`), minimum 280 px, maximum 70 % of the HUD
    root.
  - Below the small breakpoint the drawer is the HUD root's full width, as today.
- **Scrolling:** the tab panel scrolls in CSS (no height from script). The scroll position is kept
  per tab in `AEK_debugDrawerState` (`scrollPos: { [tabId]: number }`); `currentScrollPos` is read
  once, then dropped.
- **Disabled during a scene load:**
  - The drawer gets `inert` and `aria-busy`, and is dimmed through the disabled opacity token.
  - The striped PNG goes (p801 §4.3 left it here).
  - The scene loader's overlay is the loading signal.
- **The debugger list** is `createList` behind `debuggerListCMP` (p805 §4's mapping, its two
  shapes by hand: the assets tab's heading with its scope switch stays the tab's; LOD's capped
  list keeps a disabled "…and N more" item).
- **The profiler window's tab menu** is `createTabs` (horizontal, `iconOnly`, four tabs).
  `_debugTabButtons.scss` goes.
- **The editor drawer:** `createTabs` for its tabs, and `createSplitter` between the material
  selector and the tabs (p805's splitter page names it).

### D7. The on-screen tools

- Each group is a `role="toolbar"` with roving focus (`createButtonGroup`). The buttons are kit
  icon buttons with a label and a tooltip. Play, pause and the view switch are toggle buttons
  (`aria-pressed`). Undo and redo are `aria-disabled` while there's nothing to undo or redo. The
  camera and scene drop-downs stay `createDropDown`.
- **During a scene load** (closes `docs/issues/on-screen-tools-during-scene-load.md`):
  `_disableDebugger` also disables the on-screen tools.
  - Every control gets `aria-disabled` and the tooltip "Loading the scene…"; clicks are ignored.
  - An open drop-down closes.
  - The F-keys already stop with the debug keys.
  - A Node test covers it.
- The group's translucent background is `surface` at an alpha this plan picks (p801 §4.2 left it
  here), checked for contrast over a bright and a dark scene in the before / after shots.

### D8. Theme and density

- **Compact:** every debugger root gets `data-aek-density="compact"`: the drawer, the editor
  drawer, the on-screen tools, the debug windows (`DraggableWindowDom.ts`' attribute), the
  profiler window and the dialogs the debugger opens. The debug toaster stays at the default
  density: a toast is read at a glance.
- **The theme setting:** `AppConfig.debugDrawer.theme?: 'dark' | 'light' | 'app'`, default
  `'dark'`, overridden by a "Theme" select in the Debug tools tab, saved in its LS.
  - `'app'` sets no attribute, so the debugger follows the kit root: the app's forced theme, or the
    system.
  - One function gives every root its attributes (the debugger root, the theme, the density),
    replacing the four constants (§1.5). A change applies live.
  - Dark stays the default: a viewport tool reads better dark, and the scene runner's shots don't
    depend on the machine's theme.
- **The compact sizes:** p801 left their retune here ("looking at the 11 px panels").
  - Phase 0 compares the compact type scale with Tweakpane's 11 px rows (rows per screen, the
    label column's characters, 24 px targets).
  - If they change, `tokens.css`' compact block changes for every app that uses compact: a kit
    restyle in the changelog (D2).
- **Headings and figures** are kept apart by weight, not a third grey (p801 §4.2).
- **The accent** marks the current tab, the selected list row, a pressed tool and the focus ring,
  nothing else (p800 D6).

### D9. Styles

- **Every debugger stylesheet goes onto the tokens:**
  - Colours become p801 §4's roles.
  - Sizes go from `var(--aek-rem)` to the space and type tokens (`--aek-space-*`,
    `--aek-font-size-*`), or to `em` for a size relative to the element's own text.
  - No `color.adjust`: a role, or `color-mix()` on a role.
  - No hex.
- **They stay unlayered CSS modules** (p803 left the choice here). They style the debugger's own
  layout, and the kit's pieces inside it take the tokens and the density, not overrides. An
  unlayered module class beats an app's element rules (`button { … }`), which a layered one
  wouldn't: a dev tool should survive the app's CSS. An app that restyles the debugger sets
  tokens on its roots.
- **`variables.scss` is deleted** (p800 D2):
  - Its breakpoints and the drawer's widths go to `debug/styles/_debugLayout.scss`, a debug-only
    Sass partial (media queries can't read custom properties).
  - Or they become container queries on the HUD root, if Phase 0 finds `container-type:
inline-size` there harmless. That would be better in an embed, whose HUD root isn't the
    viewport.
  - `nakedButton` gives way to the kit's ghost button. `dragWinContentPadding` was dead.
- **`--aek-rem` goes:**
  - It leaves the debugger, `_dbg__Assets.ts`' inline styles and `Viewports.module.scss`
    (`features/viewports`: onto the space tokens, with its own before / after shot).
  - Then it leaves `tokens.css` (`@internal`, so not a break: p801 D4's end).
- **The kit's debugger leftovers move out:**
  - `DraggableWindow.scss`' `winPaddedContent`, `winSmallLabel` and `winSmallIconButton` go to
    `debug/styles/DebugWindow.module.scss`, or are replaced by kit pieces where one fits.
  - `kit.scss`' `.uiIcon` rules and its `[data-aek-debugger] .aekIcon` reset go.
  - No style reads `uiIcon` or `smallIcon` after this; p622 stops `getSvgIcon` writing them.
- `Stats.scss` stays for p807.

### D10. The windows and the raw-DOM UIs

Each becomes kit pieces. Values are set with `textContent` or field handles, never HTML strings
holding values.

| UI                                                   | Becomes                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera edit window (9 bindings, 3 buttons)           | Property grid items. The lens folder's `.on('fold')` becomes `folderExpanded` / `onFolderExpandedChange` on its module's state                                                                                                                                  |
| Light windows (a readout and an editor; 32 bindings) | Two grids. The shadow map's two `view: 'list'` blades become unbound selects; the two shadow folders' open states as the camera's                                                                                                                               |
| Physics entity window and its wireframe folder       | A grid. Position and rotation become a vector and a rotation field (degrees); the per-state colours with their reset buttons; the folder's open state                                                                                                           |
| Character window                                     | A grid (position, rotation, five buttons, a separator)                                                                                                                                                                                                          |
| PostFX pass window                                   | A grid; `getParamBindingParams` returns items                                                                                                                                                                                                                   |
| ECS world window                                     | A grid; the storage folder; `pane.refresh()` becomes `grid.refresh()`                                                                                                                                                                                           |
| Day-night speed buttons (`custom`)                   | `createButtonGroup` (exclusive) in `custom`'s container; `.debuggerSkyTransportRow` and the `tp-` rule go                                                                                                                                                       |
| Ray tester                                           | Its inputs through the builder (already). The notice, toolbar and copy buttons become kit pieces; the results a list                                                                                                                                            |
| Assets tab and info window                           | The heading's scope switch becomes a segmented control. In the info window, the two tables become `createTable` (static, a caption each), the `field()` rows a property grid of monitors, and the buttons kit buttons                                           |
| Material editor                                      | The filter becomes a search text field. The cards are kit buttons in a grid with roving focus. The tabs are declarative already (D4); the drawer is D6's                                                                                                        |
| Character state window (1492 lines)                  | Its groups become folders. Its rows become a property grid of number fields and monitors; the scheduler's flash replaces its own animation, and its "saved" dot becomes a badge. The header's interval becomes a number field, freeze / copy / pin icon buttons |
| About dialog                                         | Its `<dl>` stays (it's the right element). The buttons become kit buttons; restyled                                                                                                                                                                             |
| Key shortcuts dialog                                 | `createTabs` (its two tabs), `createKbd` for the keys (p803 named it), lists                                                                                                                                                                                    |
| Profiler Settings tab                                | Checkboxes. The metric order becomes `createList` with `createListReorder` (Alt+arrows, announced) in place of ▲ / ▼                                                                                                                                            |

### D11. Splitting the big files

Every file and function §1.6 lists with a p800 header is split as it's rewritten. Each file ends
under 800 lines and each function under 150, and the header lines go. At the end,
`grep -rln "which p800 replaces" src` is empty.

- The split is by concern: the tab, its items, the edit window, the window's sections. For
  example, `_dbg__LightGUI.ts` → `_dbg__LightTab.ts`, `_dbg__LightEditWindow.ts` and
  `_dbg__LightShadowItems.ts`.
- The phase names the modules. Items are data, so a big tab becomes item builders per folder.
- The two 3D files keep their p618 headers (D1).

### D12. Accessibility

- **Landmarks and names:**
  - The drawer is a labelled `<aside>`, the toggler a disclosure button, the tab rail an APG tab
    list.
  - Every field is labelled (D4). Every icon button has a name and a tooltip.
  - The on-screen groups are toolbars.
  - Debug windows are kit windows: `role="dialog"`, labelled, cycled with F6 (p803).
- **Focus:**
  - The `h` key opens the drawer without moving the focus: the user may be playing.
  - The toggler's click moves the focus to the open tab in the rail.
  - Closing returns the focus to the toggler when the focus was inside.
  - Escape doesn't close the drawer: it's an app's key, and the drawer isn't an overlay.
- **Targets:** at least 24 × 24 px in the compact density at UI scale 1. That covers the rail's
  tabs, the list's toggles and the on-screen tools (p800 D8; Phase 0 measures today's).
- **Monitors** aren't live regions (p804 D11). A list's or a table's change is announced only on a
  user's action (sort, filter, reorder).
- **Motion:** the drawer slides in `--aek-motion-slow`, and under reduced motion it fades (p800 D7).
- **The check:** every debugger root passes axe in the scene runner's debugger configuration
  (D14), with no allowed violations at the end (Phase 6). Phase 0 records today's counts for the
  changelog.

### D13. Size and performance

- **Production:** nothing changes. `yarn sbp --profile all` keeps every first download, and
  `yarn verify:baselines`' debug check still finds no debug module in a build.
- **The debug env:** Phase 0 records the debugger's chunks in a `yarn build:test` (Tweakpane's
  share in them), and Phase 6 measures them again. The figure goes in the changelog. No budget
  line: debug chunks aren't what a player downloads.
- **Per frame** (the perf-auditor agent, Phase 6), against Phase 0's Tweakpane figures from the
  profiler's frame probe:

  - the Lights edit window open (its 32 fields);
  - the physics tab open (its monitors);
  - the character state window live;
  - each tab's build time (from `content()` to the DOM).

  p805 §4's two scheduler notes (`isShown`'s DOM walk, the monitor's string) are looked at with
  these figures.

### D14. Tests and checks

- **Node tests:**
  - `_dbg__DebuggerPaneBuilder.test.ts` (new): the state paths, persistence on `last` only, the
    folder ids and their LS keys, `type: 'binding'`, an unknown field's error, `custom`'s
    container and its refresh function, `onCreate`'s field, and no `onChange` on refresh.
  - `_dbg__TabHost.test.ts` grows: the scheduler's visibility, `refreshIntervalMs`,
    `ctx.scheduler`, `keepOnSceneChange`, and the error line.
  - `_dbg__DebuggerGUI.test.ts` grows: the menu changing in place, the roots' attributes, and the
    drawer and on-screen tools disabled during a load.
  - A 5.x LS fixture per format: `lsKey`, `uiLsKey` and the drawer state load.
  - The debugger list's mapping.
- **The scene runner's `debugger` configuration** (`devTools/verify/scenes.config.ts`, Phase 1):
  - It runs in DEBUG mode on `testDebugScene` (every engine tab) and the scenes with scene tabs.
  - It opens each drawer tab, each profiler tab and one edit window of each kind through new test
    bridge methods (`TEST_BRIDGE_VERSION` bumped).
  - **Screenshots:** the drawer or window element, against local baselines with `verify:ui`'s
    tolerance, the live figures masked.
  - **axe:** on each root.
  - **The tab order:** each host's tab ids in menu order, recorded beside the system order (p800
    §5's "tab system order baseline": both checked, the system order unchanged by the port).
  - **An undo / redo script per kind:** a declarative field, an imperative window's field, a list
    toggle and the custom row. Each changes a value by keys, undoes and redoes, and compares the
    bound value and the LS.
- **`yarn verify:ui`:** the kit's additions (D5's tab add and remove, D6's separator) get their
  boxes and scripts. The "Tweakpane parity" box goes (its job is done; the property grid's boxes
  stay). The "Debugger parity" box keeps p807's rows only.
- **Greps at the end:** no `tweakpane`, `tp-`, `variables.scss`, `--aek-rem`, `uiIcon` /
  `smallIcon` selector or p800 header in `src/`.

### D15. Documentation

- **The Hub:**
  - The debug suite's guide is rewritten. "Write your own tab" covers the items with the kit's
    names, `ctx.scheduler` and a section "Kit components in a tab"; the Tweakpane note and the
    `tweakpane` tags go.
  - The debug tab example uses `kind: 'color'`, and its tab gains a CMP section of kit fields on
    `ctx.scheduler`, which shows the new API. The regions keep their names.
  - **The migration page** `documentation/migration/engine-6.md` is created with D3's table; p622
    adds the rest.
  - The forms binding guide's "Coming from Tweakpane" stays (it's for apps); its "the debugger
    still uses Tweakpane" lines go.
  - The design document gets the debugger's density and theme.
- **The CLAUDE.md files:**
  - The root's Debug system: "Tweakpane-based" and "The actual Tweakpane implementations" become
    the kit.
  - `debug/CLAUDE.md`: the builder, the host's scheduler, `keepOnSceneChange`, the theme setting,
    the density, the styles.
  - `ui/CLAUDE.md`'s nine "until p806" lines are resolved.
  - `devTools/verify/CLAUDE.md`: the `debugger` configuration.
  - A new `##` section gets an `aek:covers`.
- **`readme.md`:** :71 says the drawer is built on the UI kit; :479's credits drop Tweakpane
  (stats-gl stays until p807).
- **Example scene:** none new. The debug tab example is the one updated (the user's call,
  `docs/plans/CLAUDE.md`).

---

## 3. Phases

Branch `p806-debugger-migration` from `engine-6` (D2). Every phase is verified with `yarn test`,
`yarn verify:scenes` (baselines recorded on `main` before the first run; the `debugger`
configuration from Phase 1 on), `yarn verify:baselines`, `yarn verify:embed`, `yarn verify:ui`
and `yarn sbp --profile all`, plus the phase's own checks.

Each port section takes its modules off Tweakpane and splits them (D11), restyles their
stylesheet (D9), updates their tests, and takes the `debugger` configuration's new shots on
purpose, shown before and after for review. Then: `yarn test`, `tsc`, ESLint, the configuration's
undo / redo scripts. Each phase stops after each section for review.

### Phase 0: baselines and checks

1. **Branches and baselines:**
   - `engine-6` from `main`, then `p806-debugger-migration` from it.
   - On `main`: `yarn verify:scenes --update`, `yarn verify:embed`, `yarn verify:ui`,
     `yarn sbp --profile all`.
   - A `yarn build:test` with the debugger's chunks and Tweakpane's share noted here (D13).
2. **Before shots and axe** (a scratchpad Playwright script, not committed):
   - Every drawer tab, profiler tab, edit window kind and debug dialog, in `testDebugScene` and the
     scene-tab scenes.
   - At 1280 × 720 and an 800 px wide window.
   - Kept in `.cache/p806/before/` for the reviews; axe's counts per root noted here.
3. **The port census, refreshed** (a scratchpad script and reading by hand):
   - Every declarative item with its params (p804's 280 bindings recounted).
   - Every imperative binding with its handler, mapped to its grid item.
   - Anything outside D3's map.
   - The result goes into §4.1.
4. **Measures** (D13): the frame cost with the Lights edit window, the physics tab and the
   character state window open; each tab's build time; the drawer's open time. All from the
   profiler's frame probe, in Chromium.
5. **Checks that decide details:**
   - `createTabs`' handle: adding or removing a tab (D5), a separator (D6), and the vertical rail
     with 16 tabs at 720 px high.
   - The compact scale against Tweakpane's 11 px rows (D8).
   - Today's target sizes (D12).
   - Each tab's behaviour on a scene change with `keepOnSceneChange` (D5's list, each one run).
   - The profiler window on a scene change.
   - Container queries on the HUD root against the Sass partial (D9).
   - Every tab's LS format (D3's compatibility fixtures).
   - linkedom's gaps for the builder's test.

### Phase 1: the framework on the kit

1. **The scene runner's `debugger` configuration** (D14), with the test bridge's methods. It is
   recorded on the branch before any change: its shots are Tweakpane's, and the later sections
   update them on purpose, while its tab order and undo / redo scripts must keep passing.
2. **The builder on the property grid and the tab types** (D3, D4):
   - The 26 declarative sections renamed where they use Tweakpane's names (`view: 'color'` and the
     rest; the app's five and the material editor's included).
   - The day-night `custom` on a button group (D10).
   - The builder's test.
   - `DebuggerGUI.ts` no longer imports Tweakpane.
3. **The tab host** (D5):

   - The scheduler, `ctx`, `refreshIntervalMs`, the fields' context menu, the error line.
   - `keepOnSceneChange` and `onSceneChange`, with the engine's tabs opted in.
   - The tests.

   The six imperative files still import Tweakpane until Phase 3.

### Phase 2: the shell, the theme and the density

1. **Theme and density** (D8): the roots' attributes from one function, the setting, the compact
   retune if Phase 0 asks for one.
2. **The drawer** (D6):
   - The rail, the toggler, the heading, the width splitter, the scroll, the disabled state.
   - The menu changing in place (the kit's tab additions with their boxes).
   - The debugger list on `createList`.
   - `DebuggerGUI.module.scss` restyled; `_debugTabButtons.scss` deleted.
3. **The profiler window and the editor drawer:**
   - The profiler's tab menu and its Settings tab (D10).
   - The editor drawer's tabs and splitter, and the material editor's selector and HUD.
   - Their styles, with `Profiler.module.scss` and `GPUMemory.module.scss` restyled only (D1).
4. **The on-screen tools** (D7): the toolbars, the disabled state during a load (the issue file
   closed), and the axes gizmo's and environment ball's styles.

### Phase 3: the edit windows

1. **Camera and lights:** `_dbg__CameraGUI.ts` and `_dbg__LightGUI.ts` on grids, and split.
2. **Physics:** the entity window and the wireframe folder; `_dbg__PhysicsAPI.ts`' tab content
   split.
3. **Character, PostFX, ECS:**
   - The three windows.
   - After it, nothing imports Tweakpane: `tweakpane` and `@tweakpane/core` leave
     `package.json`, and D3's table is final (p622 can be written, D2).

### Phase 4: the big panels

1. **Debug tools, LOD, spatial grid:** `buildDebugToolsItems`, `_createLodDebugGUI` and
   `_createSpatialGridDebugGUI` split into item builders.
2. **Ray tester and ray cast, assets:** the ray tester's UI and `RayDebug.scss`; the assets tab
   and its info window (the tables on `createTable`).
3. **The character state window** (D10; D1's escape hatch if it runs long).

### Phase 5: dialogs and the last styles

1. **The About and key shortcuts dialogs** (D10).
2. **The leftovers** (D9):
   - `variables.scss` deleted.
   - The kit's debugger helpers moved; `kit.scss`' `.uiIcon` rules gone.
   - `--aek-rem` gone from every stylesheet (`Viewports.module.scss` included), then from
     `tokens.css`.
   - D14's greps pass.

### Phase 6: verification

- The `debugger` configuration with axe failing on any violation; every undo / redo script.
- The perf-auditor agent's pass against Phase 0's figures (D13); the debug chunks measured again.
- The before and after shots side by side for the changelog and a last review.
- Every scene runner baseline updated on purpose.

### Phase 7: the Hub, the example, `CLAUDE.md`, readme

D15. `yarn hub:build` in both modes.

### Phase 8: done

- `CHANGELOG.md`'s unreleased `engine-6` entry: p806's Engine (the breaks with D3's table, the new
  fields, the look, the sizes), App (the ported debug modules) and Project (the scene runner's
  configuration, the Hub) sections. No version bump (D2).
- The plan marked done and renamed, with the references to its old name:
  - p800's Blocks line and §5 entry;
  - `_DONE_p805`'s, `_DONE_p804`'s, `_DONE_p803`'s and `_DONE_p801`'s Blocks / Related lines;
  - p622's Related line, p150's and p373's.
- **Time for the PR:** `p806-debugger-migration` → `engine-6` (p800 §6).

---

## 4. For p807

Filled in by Phase 0's census and the later phases.

- **What p806 leaves:**
  - The profiler's Overview, Objects and GPU memory content as HTML strings, restyled on the
    tokens.
  - The stats panels (stats-gl, `Stats.scss`).
  - The "Debugger parity" box's p807 rows.
- **What p807 can count on:**
  - The profiler window's shell on `createTabs`, in the compact density.
  - Each tab's scheduler (`ctx.scheduler`) for `rows` as a function on its tick (p805 D3).
  - `keepOnSceneChange` for the profiler tabs.
  - The `debugger` configuration's shots of every profiler tab.

### 4.1 The port census (Phase 0)

---

## 5. Risks

- **Size:** about 36,700 debug lines (p800 counted 43 panel files). Mitigations:
  - One area per section.
  - The framework first, so the 26 declarative sections move in one step.
  - The `debugger` configuration's shots, tab order and undo / redo scripts from Phase 1 on.
  - D1's escape hatch.
- **A long-lived branch:** `engine-6` waits for p622. Mitigations:

  - Rebases after each `main` merge (D2).
  - p807 starts after p806.
  - p622 written once Phase 3 settles D3.

  p808 and p809 touching `ui/` and `hub/_assets` are where conflicts land.

- **Undo and persistence:** handlers key on `last`, and LS formats must load. Mitigations: p804's
  pinned event order, D14's undo scripts and the 5.x LS fixtures.
- **Monitor and build cost:** the light window and the physics tab show dozens of live values;
  every tab builds kit DOM instead of Tweakpane's. Mitigation: D13's figures against Phase 0's.
- **The look for developers who know today's debugger:** a new layout (the rail, the compact
  density). Mitigation: before and after shots at each review, and the theme setting.
- **The compact retune is public:** it changes every app's compact UI. It is made only if Phase 0
  asks, and called out in the changelog (D8).
- **Rotations shown in degrees** where Tweakpane showed radians: a visible change, on the
  migration page (D3).

---

## Done when

- No file in `src/` imports Tweakpane, and `tweakpane` / `@tweakpane/core` are out of
  `package.json`.
- Every drawer tab, profiler tab, edit window and debug dialog is on the kit, in the compact
  density, with the theme setting.
- D3's contract holds, and 5.x LS state loads.
- Every debugger stylesheet is on the tokens. `variables.scss` and `--aek-rem` are gone.
- No p800 header remains, and every file and function is within the coding standards' sizes.
- The on-screen tools are disabled during a scene load, and the issue file is closed.
- The scene runner's `debugger` configuration passes: shots, axe with no allowed violations, the
  tab and system order, every undo / redo script.
- The perf-auditor's pass shows no regression against Tweakpane's figures. Production's
  `yarn sbp` is unchanged.
- The Hub's debug suite guide, the debug tab example, the engine 6 migration page, the
  `CLAUDE.md` files and the readme are current, and `yarn hub:build` passes in both modes.
- `engine-6`'s unreleased changelog entry has p806's sections, and the PR into `engine-6` is
  ready.
