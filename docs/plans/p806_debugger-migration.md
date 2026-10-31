Status: in progress | Phases 0-5 implemented
Category: UI, Debug, Refactoring, Accessibility
Epic: p800_debugger-ui-overhaul.md
Blocks: p807_stats-and-profiler-graphs.md (p800 §5; written when it starts)
Related: \_DONE_p804_forms-and-bindings.md (the binding, the scheduler, the declarative grid; its §4: what this port rewrites by hand), \_DONE_p805_data-display.md (the list, the tabs, the table, the splitter; its §4: the debugger's lists and tab menus), \_DONE_p803_ui-kit-structure-and-core.md (D6: the debugger until p806; the window helper classes and `uiIcon` it left), \_DONE_p801_design-foundation.md (§4: every debugger colour mapped to a role; D2: the compact density's sizes left for this plan; D4: `--aek-rem`), \_DONE_p618_review-debug-public-api.md (P7: the Tweakpane fields in the tab types; D8: the header lines; the "Write your own tab" guide), p622_engine-6-major.md (the major this ships in; its migration page lists D3's breaks), p150_current-entity-data-source-info-on-edit-windows.md and p373_merge-debug-and-member-editing.md (edit windows built on this plan's), `docs/issues/on-screen-tools-during-scene-load.md` (closed here: D7), `docs/issues/action-map-keys-on-focused-debugger-controls.md` (closed here: D12, Phase 2)

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
| `view: 'color'`, or a `color` param, on a number                             | `kind: 'color'` (the kit has no `format: 'float'`: an object colour is floats; §4.1)                        |
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
- **Refresh-only monitors** (decided 2026-10-29, §4.1's first finding): Tweakpane's
  `interval: 0` reads only on a refresh, the kit's every frame. The kit gains
  `interval: 'refresh'` (a field read by its scheduler's `refresh()` and a reveal, never by the
  tick; a monitor's 200 ms default stays), with its test and its demo box, and the builder maps
  `interval: 0` to it. An app's grid can use it too. Phase 1's builder section.
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
  resets the drawer. The tabs handle's `setTabs` does it: it diffs by key and keeps a kept tab's
  button, panel and content (Phase 0; no `addTab` / `removeTab`).

### D6. The shell

- **The drawer** is a labelled `<aside>` (`aria-label="Debugger"`).
  - **The toggler:** a kit icon button with `aria-expanded`, `aria-controls` and its key hint
    (`createKbd`: `h`, or the rebound key).
  - **The heading row:** the scene title and the close button.
- **The tab menu is a vertical icon rail** on the drawer's outer edge: `createTabs` with
  `orientation: 'vertical'`, `iconOnly` (the title as the tooltip and the name),
  `activation: 'manual'` (Enter or Space opens; the arrows only move, since a tab's build isn't
  free).
  - 16 tabs are 384 px in the compact density (24 px each; Phase 0), so the rail fits 720 px and
    scrolls with faded edges only in a window under about 400 px.
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

### Phase 0: baselines and checks — done

1. **Branches and baselines:**

   - `engine-6` from `main`, then `p806-debugger-migration` from it.
   - On `main`: `yarn verify:scenes --update`, `yarn verify:embed`, `yarn verify:ui`,
     `yarn sbp --profile all`.
   - A `yarn build:test` with the debugger's chunks and Tweakpane's share noted here (D13).

   As run (2026-10-28):

   - `engine-6` and `p806-debugger-migration` cut from `main` at `3adfac2b` (the plan's commit,
     on `main` already, so nothing to commit). The branch's first commit, `a0d3ced2`, speeds up
     `yarn verify:scenes` on WSL2 (the Windows Chrome on the GPU); it changes only
     `devTools/verify/`, so the baselines below, taken on it, are `main`'s app.
   - `yarn sbp --profile all`: 29 budgets within, every diff unchanged. First downloads (gzip):
     app 384.3 kB, banner 287.4 kB, uiKit 286.7 kB.
   - `yarn verify:baselines`: unchanged; no debug code in production or either embed.
   - `yarn verify:embed`: 7 scenarios pass (WebGPU, Windows Chrome 155, AMD RDNA 3).
   - `yarn verify:ui`: every state and script passes (284 s, local Chromium).
   - `yarn verify:scenes --update`: 26 scenes × 4 configurations, 104 recorded, no errors, on
     WebGPU (Windows Chrome 155, AMD RDNA 3), in 592 s; the baselines in
     `.cache/verify/scenes/webgpu/`.
   - `yarn build:test`, the debugger's share (`dist-stats/module-sizes.json`; a debug module is a
     `_dbg__` file or one under an engine `debug/` folder):
     - 49 lazy JS chunks hold debug, Tweakpane or stats-gl code: 638.7 kB, 221.5 kB gzip; their
       CSS 12 files, 51.3 kB, 12.6 kB gzip.
     - Tweakpane is one chunk of its own (`tweakpane-*.js`): 148.6 kB, 30.5 kB gzip, about 14 %
       of the debugger's JS gzip. stats-gl (p807's) is in `_dbg__Stats-*.js`: 37.6 kB, 10.6 kB
       gzip.
     - The modules: debug 484.2 kB minified (16.7 kB of it the thin wrappers in the entry
       chunk), Tweakpane 148.6, stats-gl 33.2; the kit inside the debug chunks only 2.8 kB (the
       rest of what the debugger uses is in the entry chunk, shared with the app).
     - The largest: `_dbg__Character` 16.2 kB gzip, `_dbg__Profiler` 14.9, `_dbg__MaterialEditor`
       13.7, `_dbg__SkyBox` 13.0, `_dbg__Stats` 10.6, `_dbg__Assets` 10.2.

2. **Before shots and axe** (a scratchpad Playwright script, not committed):

   - Every drawer tab, profiler tab, edit window kind and debug dialog, in `testDebugScene` and the
     scene-tab scenes.
   - At 1280 × 720 and an 800 px wide window.
   - Kept in `.cache/p806/before/` for the reviews; axe's counts per root noted here.

   As run (2026-10-29, WebGPU in the Windows Chrome 155, dark colour scheme, a fresh profile per
   scene):

   - The script is `.cache/p806/shots.mts` (gitignored, kept for Phase 6:
     `npx tsx .cache/p806/shots.mts --out after`; it empties its `--out` folder first, `after` by
     default). It loads each scene with `?isDebug=true&aekTest=true&startScene=…`, clicks the
     drawer's toggler and each menu button, opens the edit windows from a list tab's first row
     (the light list's first three), and calls the rest through the dev server's module URLs
     (`toggleProfilerWindow`, `openProfilerTab`, `_toggleRayTesterWindow`, `openAboutDialog`,
     `openDebugKeyShortcutsDialog`, `setActiveView('materialEditor')`). The selectors are the CSS
     module class prefixes (`[class*="_debuggerGUI_"]`, `_debugDrawerTabsMenu_`, `_editorDrawer_`,
     `button[class*="_card_"]`) and the global `.debugDrawerToggler`, `.debugCurrentSceneTitle`,
     `.debuggerList`, `.aekWindow`: a CMP's `id` isn't the element's id, and a tab button is the
     menu's child itself.
   - 168 shots: each drawer tab at 1280 × 720, 800 × 720 and 1280 × 2000 (the whole content),
     each window and profiler tab at the first two, the pages at 1280 and 800.
     - `testDebugScene`: the 15 engine tabs, the on-screen tools, the stats panels, the camera,
       ambient light, sun, ECS world and assets info windows, the four profiler tabs, both ray
       testers, About, both key shortcut tabs, and the material editor (the page; its drawer with
       no material selected and with the first one).
     - `thirdPersonGymScene`: the 15 engine tabs with a scene's content (its sky box tab is the
       largest), and the physics entity, PostFX pass, character and character state windows.
     - `lodShowcase` (its LOD demo and Hub tabs, the LOD entity window), `assetCompare`, `space`,
       `exampleDebugTab` (Boxes and Hub): the scene tabs.
   - axe (`UI_AXE_TAGS`, each root alone at 1280 × 720): 68 roots, 15 clean, 660 nodes. A drawer
     tab's count includes the drawer's own parts (heading, menu).

     | Roots                                          | Roots | Nodes | Rules (nodes)                                                                                     |
     | ---------------------------------------------- | ----- | ----- | ------------------------------------------------------------------------------------------------- |
     | On-screen tools, stats panels, toaster         | 8     | 0     | -                                                                                                 |
     | Drawer tabs, `testDebugScene`                  | 15    | 142   | label 99, color-contrast 25, select-name 12, button-name 6                                        |
     | Drawer tabs, `thirdPersonGymScene`             | 15    | 224   | label 159, color-contrast 35, select-name 20, button-name 10                                      |
     | Scene tabs                                     | 6     | 38    | label 20, color-contrast 12, select-name 5, button-name 1                                         |
     | Edit and debug windows (incl. the ray testers) | 12    | 100   | label 88, select-name 5, button-name 3, color-contrast 2, label-title-only 1, target-size 1       |
     | Profiler tabs                                  | 4     | 90    | target-size 49 (Settings' ▲ / ▼), color-contrast 29, label 6, empty-table-header 5, select-name 1 |
     | Dialogs (About, key shortcuts ×2)              | 3     | 1     | scrollable-region-focusable 1                                                                     |
     | Material editor (its drawer, the page's HUD)   | 5     | 65    | label 48, button-name 8, color-contrast 6, select-name 3                                          |

     Nearly all of `label` and `select-name` are Tweakpane's inputs (no `<label>` tied to them);
     the per-root list is `.cache/p806/before/summary.md`.

   - Found on the way:
     - The material editor's drawer has two tabs, Params and Settings; Camera is a folder in
       Settings (§1.1 said three tabs).
     - The LOD demo scene tab's list rows open no window (its LOD tab's rows do).
     - The on-screen tools and the stats panels have no axe violation today.

3. **The port census, refreshed** (a scratchpad script and reading by hand):
   - Every declarative item with its params (p804's 280 bindings recounted).
   - Every imperative binding with its handler, mapped to its grid item.
   - Anything outside D3's map.
   - The result goes into §4.1.
4. **Measures** (D13): the frame cost with the Lights edit window, the physics tab and the
   character state window open; each tab's build time; the drawer's open time. All from the
   profiler's frame probe, in Chromium.

   As run (2026-10-29, WebGPU in the Windows Chrome 155 at 144 Hz, the dev server's debug env,
   1280 × 720, no test bridge):

   - The script is `.cache/p806/measure.mts` (gitignored; Phase 6:
     `npx tsx .cache/p806/measure.mts --out after [--scene testDebugScene] --seconds 10 --runs 3`),
     its figures `.cache/p806/measures-before.json` (`thirdPersonGymScene`) and
     `measures-before-quiet.json` (`testDebugScene`). Each scenario on a fresh browser context, three
     windows of 10 s.
   - Next to the frame probe (the main loop's own time) it reads Chrome's
     `Performance.getMetrics` over each window (task, script, style and layout ms per second):
     Tweakpane's monitors tick on their own `setInterval`, outside the frame, so the probe alone
     wouldn't see them.
   - Frame cost (main-thread ms per second, the three windows; the loop's CPU per frame):

     | Scenario                           | `testDebugScene`                     | `thirdPersonGymScene`                        |
     | ---------------------------------- | ------------------------------------ | -------------------------------------------- |
     | Idle (drawer closed, nothing open) | 57, 51, 56 (0.24-0.25 ms)            | 160, 144, 144 (0.85-0.93 ms)                 |
     | The sun's Lights edit window       | 48, 46, 60 (0.21-0.24 ms)            | 148, 155, 141 (0.84-0.88 ms)                 |
     | The Physics API tab open           | 57, 63, 58 (0.25-0.26 ms; style 0.6) | 167, 147, 148 (0.88-0.91 ms; style 0.6)      |
     | The character state window live    | (no character)                       | 167, 156, 171 (0.90-0.94 ms; layout 0.2-0.8) |

     Every scenario ran at 144 fps. Today's UI costs are inside the windows' noise (±6 ms/s in the
     quiet scene, ±15 in the gym): the physics tab adds about 3 ms/s, the character state window
     about 15. So Phase 6 compares in `testDebugScene` (the character window in the gym), and a
     regression has to pass the noise to count.

   - Each tab's build (the menu button's click; median of three, the gym scene):

     | Tab                  | The click (ms) | To the next frame (ms) |
     | -------------------- | -------------- | ---------------------- |
     | Sky box controls     | 25.3           | 42.8                   |
     | Physics API controls | 11.0           | 23.0                   |
     | Debug tools controls | 5.9            | 9.5                    |
     | Ray cast controls    | 5.4            | 13.9                   |
     | Spatial index        | 4.5            | 10.8                   |
     | LOD                  | 3.4            | 8.5                    |
     | Assets               | 3.0            | 10.4                   |
     | The other eight      | 0.8-1.7        | 5.0-8.4                |

   - The drawer's open (closed, then open on its saved tab; median of five): the click 1.0-1.2
     ms, to the next frame 3.5-6.0 ms.

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

   As run (2026-10-29; the browser checks are `.cache/p806/checks.mts`, their figures
   `.cache/p806/checks.json`, WebGPU in the Windows Chrome 155 at 1280 × 720):

   - **`createTabs`' handle:** `setTabs` diffs by key (a kept tab keeps its button, panel and
     content; new ones added, gone ones removed), so the drawer's menu changes in place with no
     `addTab` / `removeTab` (D5 changed). A divider between tabs has no form: `separatorBefore` on
     `TabDef` is a kit addition (D6), with its test and its demo box.
   - **The vertical rail:** 16 icon-only tabs are 24 × 24 px each in the compact density (384 px)
     and 32 × 32 in the default one (512 px), so the rail fits 720 px without scrolling; it scrolls
     with its faded edges below about 400 px of height (compact).
   - **The compact scale against Tweakpane's rows** (the Physics API tab, its pane 361 px wide,
     against a grid of seven fields as wide):

     |                | Tweakpane                                                 | Kit, compact                 | Kit, default        |
     | -------------- | --------------------------------------------------------- | ---------------------------- | ------------------- |
     | Label text     | 11 px Roboto Mono                                         | 11 px IBM Plex Sans          | 12 px IBM Plex Sans |
     | Control height | 20 px                                                     | 24 px                        | 24.4 px             |
     | Row pitch      | 24 px a one-line row (32.6 the tab's median: labels wrap) | 27 px                        | 28.4 px             |
     | Label column   | 193 px (53 %), 29 characters                              | 144 px (the grid's 40 %), 26 | 144 px, 23          |

     The kit's row is set by the 24 px target floor (D12; Tweakpane's 20 px controls fail it), not
     by its type scale: a retune of `tokens.css`' compact block wouldn't give the rows back.
     **Recommended: no compact retune** (no kit restyle in the changelog, D2), and the debugger's
     grids start at a 50 % label column (about 32 characters, more than Tweakpane's 29), which
     `uiLsKey`'s `labelWidth` keeps per tab. About 12 % fewer one-line rows per screen than
     Tweakpane is the targets' cost.

   - **Today's target sizes** (D12; under 24 × 24 px):
     - Under: the list's toggles (22 × 22), the tab heading's buttons (the clear-LS one, 22 × 22),
       Tweakpane's text inputs, checkboxes and selects (20 px high), the profiler Settings tab's ▲ /
       ▼ (22.6 × 18.5, 42 of them: axe's 49 `target-size` nodes).
     - At or over: the on-screen tools (32 × 32), the drawer's toggler (30 × 86) and tab buttons (42
       × 30.5), its close button (24 × 24), Tweakpane's folder headings (24 high), the list rows,
       the windows' header buttons (32 × 31) and the profiler's tab buttons (42 × 32.5).
   - **Each tab across a scene change, kept:** the drawer served with its scene-change rebuild
     switched off (a route patch of `_dbg__DebuggerGUI.ts`, so the open tab got `onRefresh` and
     `pane.refresh()` only, as `keepOnSceneChange` will), each of the 15 engine tabs taken across
     `testDebugScene` ↔ `thirdPersonGymScene`, its text (rows, Tweakpane labels and values,
     sections; digits normalised) compared with the same tab rebuilt.
     - 13 read the same as rebuilt, with no error: Statistics, Loop, Sky box, Physics API,
       Renderer, Assets, PostFX, Ray cast, Cameras, Characters, ECS, Spatial index, LOD.
     - **Debug tools:** its "Change scene" select keeps the old scene (state captured at build):
       it keeps the rebuild, as D5 has it.
     - **Lights:** the kept list draws its row's icon as `??` where the rebuilt one draws "DL": a
       glitch for its port (Phase 3), after which it opts in.
     - D5's list stands. The sky box, ray cast, spatial and LOD tabs read the same too, but text
       doesn't show what their handlers hold (the scene's objects captured at build): they keep
       the rebuild until each moves its data behind a getter.
   - **The profiler window across a scene change:** it stays open, with no error; Objects and GPU
     memory follow the new scene, Overview and Settings don't depend on it. Its tabs can keep (§4).
   - **Container queries on the HUD root: no.** The HUD root is fixed and 0 × 0 (its children
     place themselves), so a size container there would read 0. The breakpoints go to the Sass
     partial (D9's first option), media queries as today; an embed's debugger still reads the
     browser window. If that matters later, the drawer can set an attribute from the kit's
     `onBoundsResize` instead.
   - **The saved formats** (for D3's fixtures; a session that opened every tab, folded a folder
     in each and opened a light window):
     - `AEK_debugDrawerState`: `{ isOpen, currentTabId, currentScrollPos }`.
     - `uiLsKey`'s `{ folders: { [id]: boolean } }`: `AEK_debugToolsUI`, `AEK_debugStatsUI`,
       `AEK_debugSkyBoxUI`, `AEK_debugPhysicsApiUI`, `AEK_debugAssetsUI`,
       `AEK_debugSpatialGridUI` and `debugRayCastUI` (no `AEK_` prefix: kept as it is). The ids are
       an item's `id` (`scenes`, `bodies`) or a title path (`Visualizer`).
     - `lsKey`'s flat objects of `persistKeys` (written on a finished change): the Debug tools,
       stats, physics, loop, renderer, ray cast, spatial grid and GPU memory tabs, the profiler
       (`AEK_debugProfiler`) and the app's three.
     - Module-owned, outside the contract but read by the ported windows: `AEK_debugCams`
       (`{ [sceneId]: { cams, debugCam } }`), the lights', `AEK_popupWindows` (the saved
       windows) and `AEK_debugProfilerUI`.
   - **linkedom for the builder's test:** no gap. A throwaway test (deleted) built a grid from
     items under `KitDom`'s `stubKitDomAsync` with a `localStorage` stub: state-key bindings, a
     slider stepped by a key (`last: false`, then `last: true`, `prev` the value before), a
     refresh firing nothing but the custom item's function, a folder's
     `onFolderExpandedChange` writing the UI key, `createFieldContextMenu` (its `container` is an
     element) and a vertical `createTabs` taking a tab added and removed by `setTabs`. The
     existing debugger tests stub linkedom per file; the builder's test uses `KitDom`.

### Phase 1: the framework on the kit — done

1. **The scene runner's `debugger` configuration** (D14), with the test bridge's methods. It is
   recorded on the branch before any change: its shots are Tweakpane's, and the later sections
   update them on purpose, while its tab order and undo / redo scripts must keep passing.

   As built (2026-10-29):

   - **The bridge** (`TEST_BRIDGE_VERSION` 5, `debug/_dbg__TestBridgeDebugger.ts`):
     `getDebuggerTabOrder`, `openDebuggerTab({ host: 'DRAWER' | 'PROFILER', id })`,
     `openDebuggerListRow({ index })`, `focusDebuggerControl({ root?, name, nth? })`,
     `markDebuggerWindows` and `closeDebuggerWindows`. Things are named by tab id, list row and
     control name, never the debugger's classes, so the settings outlive the port (Phase 0's
     scratch script used CSS module prefixes). A control's name is its accessible name: ARIA,
     `<label>`, text, then title. When nothing has the name, the bridge takes the first control
     after a label or titled element in its row, which is how Tweakpane's unlabelled inputs are
     found. Behind it are four `@internal` accessors that Phases 2-4 must keep:
     `_getDrawerTestInfo` (`_dbg__DebuggerGUI.ts`), `_getProfilerTestInfo` (`_dbg__Profiler.ts`),
     `_clickDebuggerListRow` (`_dbg__DebuggerList.ts`: `createList` keeps it in Phase 2) and the
     kit's `getOpenDraggableWindowIds` (`DraggableWindow.ts`; `api.json` records the five types
     and the function).
   - **The runner** (`devTools/verify/sceneDebugger.ts`, pure parts `debuggerChecks.ts`, tested):
     a `debugger` configuration in `all`. It runs `mainThread`'s run, then the debugger on the
     frozen page at 1280 × 2000, only on the scenes with `debugger` settings (`getSceneConfigs`)
     and never in Firefox. Baseline entries gain `tabOrder`, `debuggerShots`
     (`debugger/<scene>/<drawer|profiler|window>.<name>.png`) and `axe` (counts per rule per
     shot). The format version is unchanged: the fields are optional.
   - **What it covers:** `testDebugScene` gets every engine tab, the four profiler tabs, the
     camera, two lights, ECS world and asset windows, both ray testers, About and both key
     shortcut dialogs. `thirdPersonGymScene` gets every engine tab with a scene's content, plus
     the physics entity, PostFX pass, character and character state windows. `lodShowcase` gets
     its two scene tabs and the LOD entity window; `assetCompare`, `space` and `exampleDebugTab`
     get their scene tabs. In all, 55 shots: 36 drawer tabs, 4 profiler tabs and 15 windows.
   - **Undo / redo scripts**, all passing on Tweakpane:

     - the debug tab example's Boxes slider (declarative; ArrowRight);
     - the camera window's Position x (imperative; ArrowUp);
     - the Lights list's Enabled toggle (Enter);
     - the day-night ▶▶ ×10 button (the custom row; Enter).

     The custom row has no undo (`undoable: false`: the change is checked only). The undo keys
     run with the focus on the page, since a focused field keeps Ctrl+Z for its text. Each
     script's `ls` key and path must follow the bound value through the change, the undo and the
     redo.

   - **The axe check is a ratchet:** a rule's count on a root may not grow (Phase 6 allows none).
     The recorded counts match Phase 0's per root.
   - **Masks:** `DEBUGGER_LIVE_MASKS` masks Tweakpane's monitors (`.tp-sglv`, `.tp-mllv`,
     `.tp-grlv`) and the profiler Overview's figures (`.profilerValue`, `.profilerSub`, p807's).
     The builder section replaces Tweakpane's with the kit monitor's selector. Two
     recordings in a row then differed only in the asset compare report, whose rows come in load
     order, so that shot only warns (`unstableShots`, with the reason). A third run showed long
     Tweakpane labels wrapping differently, because Tweakpane's labels have `hyphens: auto`. Chrome
     fetches its hyphenation dictionary on demand into each run's fresh profile, so a run may or
     may not hyphenate. The runner adds `hyphens: manual` on the debugger's roots before its shots
     (`STABLE_SHOT_CSS`). It goes with Tweakpane in Phase 3: the kit doesn't hyphenate.
   - **Found:** in `thirdPersonGymScene`, Enter on a focused debugger button does nothing. The
     scene's action map binds Enter to jump, and action maps prevent the default of their keys
     outside a text field (debug `CLAUDE.md`). The character state opener clicks instead, with
     `clickReason` saying why. It is D12's to settle: an action map should leave a key alone when
     the focus is on a control in a debugger root. Filed as
     `docs/issues/action-map-keys-on-focused-debugger-controls.md`; Phase 2's on-screen tools
     section closes it, and the opener's `clickReason` goes.
   - Not covered yet: the editor drawer and the material editor (Phase 2 section 3 adds them when
     it ports them).

2. **The builder on the property grid and the tab types** (D3, D4):

   - The 26 declarative sections renamed where they use Tweakpane's names (`view: 'color'` and the
     rest; the app's five and the material editor's included).
   - The day-night `custom` on a button group (D10).
   - The builder's test.
   - `DebuggerGUI.ts` no longer imports Tweakpane.

   As built (2026-10-29):

   - **The kit:**
     - `interval: 'refresh'` is on every field (`FieldOptions.interval`). The shell gives the
       scheduler no tick interval for it and joins no page scheduler, so only `refresh()` and a
       reveal read it.
     - Its test is in `Monitor.test.ts`. Its demo is a row of the monitor's box: "Bodies on
       refresh" with a Refresh button, plus a keyboard check in `fieldsChecks.ts`.
     - The forms guide, the binding guide (its Tweakpane table: `interval: 0` is `'refresh'`) and
       the library text describe it.
     - `PROPERTY_GRID_FIELD_ITEM_KEYS` (`@internal`, `PropertyGridItems.ts`) is D4's one list. Its
       test keeps it complete with `expectTypeOf`, because a module-level check would be a side
       effect.
   - **The types** (`DebuggerGUI.ts`, no Tweakpane import):
     - `DebuggerPaneBinding` is the new `DebuggerPaneBindingProps` (the kit field item's props,
       minus the binding, `label` and `onChange`), plus `type?: 'binding' | 'field'`, an optional
       `label`, the kit's `onChange(value, FieldChange)`, and either the state key or any of the
       kit's bindings.
     - Accepting `{ get, set }`, `{ get }` and `{ value }` is an addition: the Phase 3 windows'
       unbound selects use it.
     - `DebuggerPaneButton`, `…Separator` and `…Custom` are the kit's item types. With no index
       signature left, an unknown field is a type error.
   - **The builder** (`_dbg__DebuggerPaneBuilder.ts`): a grid per section
     (`createPropertyGrid`, `class: 'debuggerPaneSection'`), with a titled section as a folder
     item.
     - Folder ids are worked out as before and passed explicitly, so a `persistExpanded: false`
       folder (or a tab with no UI key) stays out of `folderExpanded` and its changes aren't
       saved.
     - It takes `opts.scheduler`; until section 3 each grid has its own.
     - The label column starts at 50 % (Phase 0's recommendation), saved as `labelWidth` beside
       5.x's `folders`.
     - Unknown fields throw with the binding's name, with a hint for Tweakpane's `color` and
       `view: 'color'`.
     - A state key with no object still warns and skips, as before.
   - **Renames:** every declarative colour, 13 sites, became `kind: 'color'`: the example, Debug
     tools' two grid colours (`color: { type: 'float' }`), the material editor's three
     conditional spreads, the physics wireframe colours, the spatial grid's two, the ray tester's
     two and the ray cast tab's two. The light window's three and the physics entity window's
     wireframe folder are imperative Tweakpane, left for Phase 3.
   - **The day-night speeds:** `createButtonGroup({ exclusive: true })` of small kit buttons. The
     pressed button is the speed the cycle plays at, none while it's paused; each button's
     tooltip is "Play at ×N". `.debuggerSkyTransportRow` and its `tp-btnv_b` rule are gone.
   - **Tests:** `_dbg__DebuggerPaneBuilder.test.ts`, 9 tests on `KitDom` with a `localStorage`
     whose items are own properties (`lsGetItem` checks them so). They cover: the state paths,
     persistence on `last` only before the handler, no `onChange` on a refresh, `type: 'binding'`,
     `interval: 0`, the unknown-field errors, the custom item's container and refresh,
     `onCreate`'s handle, a 5.x `uiLsKey` read and written back merged, `persistExpanded: false`,
     and `labelWidth`.
   - **The `debugger` configuration:**
     - The drawer tabs, the profiler's Settings tab and both ray testers changed, recorded on
       purpose.
     - The Boxes script's key is ArrowUp now: the kit slider's spin button steps on Up and Down,
       where Tweakpane's knob took ArrowRight. The other three scripts pass unchanged, the
       day-night one on the button group.
     - Axe, summed over the six scenes: `label` 372 → 71, `color-contrast` 268 → 231,
       `select-name` 43 → 1, `button-name` 20 → 3, `target-size` 50 → 47.
     - The gym's Physics tab gained two `color-contrast` nodes. Both are rows of the debugger
       list (Phase 2's): the shorter grid brought two more rows into the 2000 px page, where axe
       measures them. Recorded.
     - `DEBUGGER_LIVE_MASKS` adds `.aekMonitor`.
   - **Behaviour, for p622's page** (beyond D3's table): `onChange` also fires on a field's
     `setValue` (`source: 'api'`), which no debugger code calls. In the default density a
     vector's boxes are narrow in a 400 px drawer (the Physics tab's Gravity shows "-9.8"). Phase
     2's compact density and drawer width are where that's judged.

3. **The tab host** (D5):

   - The scheduler, `ctx`, `refreshIntervalMs`, the fields' context menu, the error line.
   - `keepOnSceneChange` and `onSceneChange`, with the engine's tabs opted in.
   - The tests.

   The six imperative files still import Tweakpane until Phase 3.

   As built (2026-10-29):

   - **The types:** `DebuggerTabDef` gains `keepOnSceneChange`, `onSceneChange` and
     `content(ctx: DebuggerTabContext)` (`{ scheduler }`).
     - A definition may ignore `ctx`, but a caller of `content` passes it (the profiler
       Overview's test does).
     - `DebuggerTabContext` and section 2's `DebuggerPaneBindingProps` are on `aekasha/debug`:
       section 2 had left the second off the entry.
   - **The host** (`_dbg__TabHost.ts`):
     - One `createBindingScheduler({ visible: false })` per host, set visible on mount (by
       `isVisible()`) and `resume`, invisible on `pause` and `unmount`.
     - The pane sections share it and add no refresher. A refresh is `onRefresh`, the CMP
       sections, the lists, then one `scheduler.refresh()`, so two sections no longer mean two
       refreshes.
     - The fields' context menu is made on the first mount into a container element, and made
       again when the owner gives a new one (the drawer and the profiler window rebuild theirs).
     - `sceneChanged()` rebuilds, or keeps the tab (`onSceneChange`, its throw logged, then the
       refresh).
     - `dispose()` unmounts and removes the menu and the scheduler; the editor drawer's
       `dispose` calls it.
     - `scheduler` is on the handle.
     - The error line is a `createEmptyState` with the title "This tab failed to build", the
       text "<message> (see the console)." and the `alert` icon, with `role="alert"`. The
       drawer's stylesheet colours its icon and title with `--aek-danger` (the old `$errorDark`
       rule went).
   - **The drawer:** `_updateDebuggerSceneTitle` calls `host.sceneChanged()`. The profiler window
     doesn't react to scene changes (Phase 0: it needn't), so its tabs don't use the flag yet.
   - **Opted in:** Statistics, Loop, Renderer, Physics API, PostFX, ECS, Characters, Cameras and
     Assets.
     - Lights waits for its Phase 3 port (Phase 0's `??` icons in its kept list).
     - Checked again on the kit, with a scratch probe through the bridge
       (`scratchpad/keep.mts`, not kept): each tab taken `testDebugScene` ↔
       `thirdPersonGymScene`. Each kept its DOM (the heading row's element the same), read the
       same as the tab rebuilt (field labels and values, list rows, folder titles; digits
       normalised) and logged no error.
   - **Tests:** `_dbg__TabHost.test.ts`, now on `KitDom`, 13 tests. Beyond the four failing-tab
     and the html-once ones, they cover: `ctx.scheduler` being the host's; one refresh reading
     each field of two sections once, after `onRefresh`; a CMP section's kit monitor on
     `ctx.scheduler`; the tick only while shown (mount hidden, resume, pause);
     `refreshIntervalMs` only while visible; the default rebuild on a scene change; a kept tab's
     DOM and its order (`onSceneChange`, `onRefresh`, the fields); a throwing `onSceneChange`;
     and the menu, one listener across mounts and none after `dispose`.
   - **The `debugger` configuration:** unchanged by this section, but a run after it showed the
     About dialog's Build row moving (its commit, "local changes" and time). It's masked now
     (`'dt:text-is("Build") + dd'`, a Playwright selector in `DEBUGGER_LIVE_MASKS`), and
     `testDebugScene` was recorded again. `api.json` records the two entry types.
   - Not here (Phase 2): D14's `_dbg__DebuggerGUI.test.ts` growth (the menu changing in place,
     the roots' attributes, the disabled state) and the drawer state's 5.x fixture, which go
     with the shell.

Phase 1 verified (2026-10-29):

- `yarn test` (2133), `tsc` (both projects), ESLint and `yarn verify:baselines` (`api.json` and
  `docs.json` recorded; the bundle changed only by section 2's 28 B in the field shell's chunk;
  no debug code in any build) all pass.
- `yarn sbp --profile all`: every budget within; first downloads app 384.4, banner 287.4 and
  uiKit 286.7 kB gzip.
- `yarn verify:embed`: 7 scenarios pass. `yarn verify:ui`: every box, state and script in all
  four settings, 270 s.
- `yarn verify:scenes`: 110 runs (26 scenes × 4 configurations, and the 6 `debugger` runs),
  none failed, in 662 s. The warnings are `space`'s known worker hash (`unstableHash`) and the
  asset compare shot's `unstableShots`.

### Phase 2: the shell, the theme and the density — done

1. **Theme and density** (D8): the roots' attributes from one function, the setting, the compact
   retune if Phase 0 asks for one.

   As built (2026-10-29):

   - **The function** is the kit's, `ui/overlays/DebuggerRoot.ts` (`@internal`), since a debug
     window is the kit's. `getDebuggerRootProps()` gives a root `DEBUGGER_ROOT_ATTR`,
     `data-aek-theme` (none for `'app'`) and `data-aek-density="compact"`, plus `onCreateCmp` /
     `onRemoveCmp` hooks that keep the mounted roots in a set. `setDebuggerTheme(theme)` rewrites
     them live through each CMP's `updateAttr` / `removeAttr`, so a later `update()` keeps it.
     `getDebuggerRootAttr()` and `getDebuggerTheme()` are beside it.
   - **The roots:** the drawer, the editor drawer, the on-screen tools' two rows and switch
     tools, and a debug window with its backdrop (`DraggableWindowDom.ts`' `getDebugRootProps`,
     which replaced `getThemeAttr`; the window merges its own `attr`). The four constants went.
     The stats panels (p807's) and the debug toaster keep `DEBUGGER_ROOT_ATTR` only: the toaster
     follows the system at the default density.
   - **The setting:** `AppConfig.debugDrawer.theme` (`'dark' | 'light' | 'app'`, written out in
     `Config.ts`: a public type takes no internal one), default dark. The Debug tools tab's
     "Debugger theme" select, under its three buttons, is `appearance.theme`, a new top-level
     persisted key in `AEK_debugTools` (saved once changed, as `devFiles`). The boot applies it
     in `registerDebugToolsModule`, before the first scene load, in the debug env and prod test
     mode (`_applyDebuggerTheme`).
   - **No compact retune**, as Phase 0 recommended: `tokens.css` is unchanged.
   - **A target floor:** the compact space scale took `DraggableWindow.scss`'
     `winSmallIconButton` under 24 px (axe's `target-size` in the physics entity, character and
     character state windows), so it has `min-width` / `min-height: 24px` until Phase 5 moves it.
   - **Tests:** `DebuggerRoot.test.ts` (the attributes, a live change, `'app'`, a CMP's
     `update()`, a root mounted after a change, a removed root, an unknown theme); the debug
     dialog's and its backdrop's attributes in `DialogWindow.test.ts`; the drawer's in
     `_dbg__DebuggerGUI.test.ts`.
   - **The `debugger` configuration:** every shot changed (the compact kit fields, the windows'
     headers), recorded on purpose; the tab order and the four undo / redo scripts pass
     unchanged. Axe, summed over the six scenes, against section 3 of Phase 1:
     `color-contrast` 231 → 232 (the compact rows bring two more debugger list rows into the
     gym's Physics tab's 2000 px page: the list's muted ids, section 2's port) and
     `target-size` 47 → 50: the character state window's own header controls (its gizmo row
     reflowed in the compact type) now fail it, 3 nodes, for Phase 4 section 3's rewrite. The
     Physics tab's Gravity boxes read "-9.81" in full now (Phase 1's note).

2. **The drawer** (D6):

   - The rail, the toggler, the heading, the width splitter, the scroll, the disabled state.
   - The menu changing in place (the kit's tab additions with their boxes).
   - The debugger list on `createList`.
   - `DebuggerGUI.module.scss` restyled; `_debugTabButtons.scss` deleted.

   As built (2026-10-29):

   - **One shell for both drawers:** `debug/_dbg__DrawerShell.ts`, the scene drawer's and each
     editor drawer's (`createDrawerShell`: the toggler, the width handle, the `<aside>` with the
     heading row and the rail; each tab's container). The editor drawer moved onto it here, not
     in section 3, so it didn't break between the sections; section 3 keeps the editor drawer's
     selector splitter and the material editor's selector and HUD.
   - **The rail:** `createTabs` vertical, `iconOnly`, manual activation, on the outer edge (the
     tabs' list after its panels by `row-reverse`, its indicator on the panel's side). Each tab's
     `content` is a function making the tab's container (its scroller, `keepMounted`); the tab
     host mounts into the selected one and the drawer empties the others after the mount (so a
     tab's `onOpen` cleanup still runs before its DOM goes). The menu changes in place by
     `setTabs`; a selection the rail reports while the drawer syncs it (the open tab removed)
     isn't saved as the user's.
   - **Scene tabs** come last, all of them (5.x put one with a smaller `orderNr` among the
     others; no scene tab sets one, so the recorded tab order is unchanged), after a divider:
     `separatorBefore` on `TabDef` (`data-separator-before`, a line the stylesheet draws, no
     element: a `tablist` owns tabs alone), with its test, its row in the vertical tabs' demo box
     and its keyboard check. "(scene tab)" is in the name; the green went.
   - **The toggler:** a kit `sm` button with `aria-expanded`, `aria-controls` and a `createKbd`
     hint of the drawer key with CONFIG.ts' rebinding (`getDebugKeyChordLabel`,
     `DefaultDebugKeyBindings.ts`), turned to read upwards on the outer edge. It keeps the global
     `debugDrawerToggler` and place classes, which the axes gizmo and the on-screen tools read.
     `drawerBtnPlace` still works (`setTogglerPlace`).
   - **The width handle is `SeparatorInput.ts`, not `createSplitter`** (D6 named the splitter,
     which lays out two panes; the drawer is one fixed pane): `role="separator"`, a 24 px target
     over the inner edge, ArrowLeft widens, Home the narrowest; 280 px to 70 % of the bounds,
     default 400 px; saved as `width`. Hidden while closed and below 479 px (the drawer is full
     width there).
   - **The width on `<body>`:** the open drawer writes `--aek-debug-drawer-width` beside the
     `debugDrawerOpen` class (`setBodyDrawerWidth`), and the on-screen rows, the viewport stack's
     offset (`AxesGizmo.module.scss`) and the material selector read it in place of
     `$drawerWidth`, which no stylesheet uses now.
   - **The state:** `{ isOpen, currentTabId, scrollPos: { [tabId] }, width? }`, read once at the
     build; 5.x's `currentScrollPos` becomes the saved tab's `scrollPos` and isn't written again
     (`_readSavedDrawerState`). Every tab keeps its position; the editor drawer's state gains
     `width` (`AEK_debugMatEditorUI`'s `drawer`).
   - **Disabled:** `inert`, `aria-busy`, `data-disabled` at opacity 0.5. D6 named a disabled
     opacity token, which doesn't exist; the kit's own disabled parts use literals, so this is
     one too. The striped PNG went with the old stylesheet.
   - **Focus (D12):** the toggler's click focuses the rail's open tab; the key leaves the focus;
     a close with the focus inside gives it to the toggler (before the `<aside>` goes `inert`).
   - **The debugger list** is `createList` (p805 §4): a `multiple` selection that always shows the
     open windows (every site's `selectedItemId` returns them all), a user's selection change put
     back; the toggles are actions (`hidden` without a value keeps the cell). `DebuggerListDef`
     gains `label` (additive, on `aekasha/debug`): the five lists under a tab's own heading
     (cameras, lights, ECS worlds, assets, characters) name their listbox with it.
   - **The clear-LS button** is a kit ghost icon button (24 px; it was 22) in a wrapper holding
     its LS subscription.
   - **Found on the way:** section 1's editor drawer root was appended to a plain element, so
     its mount hook never ran and a theme change didn't reach it. `appendDebuggerRoot` (kit,
     `@internal`) runs the hook; its test is in `DebuggerRoot.test.ts`.
   - **Left:** `_debugTabButtons.scss` stays for the profiler window's menu until section 3, the
     only user left.
   - **For section 3:** a debug window with an `icon` (the profiler's) draws it as wide as the
     window behind its title: the debugger roots' `.aekIcon` reset (`kit.scss`) leaves the SVG at
     `.uiIcon`'s 100 %. It's on `main` already (Phase 0's shots have it).
   - **The `debugger` configuration:** every drawer shot changed, recorded on purpose; the tab
     order and the four undo / redo scripts pass unchanged (the Lights toggle is a list action
     now, found by its name). Axe, summed over the six scenes: `color-contrast` 232 → 38 (the
     lists' and the drawer's old greys). Two counts grew, both in the profiler's Settings tab,
     whose smaller tab heading brings more of its ▲ / ▼ rows into the window: `target-size`
     47 → 50 and `color-contrast` 1 → 2, for section 3's reorder list.
   - **Checks:** `yarn test` (2152), both `tsc`, ESLint, `yarn hub:build`,
     `yarn verify:ui --only tabs` (re-recorded, then passing), `yarn verify:baselines` (the
     production and embed bundles unchanged, no debug code; `api.json` records the `@internal`
     exports of this phase and section 1).
   - **Tests:** `_dbg__DebuggerGUI.test.ts` on `KitDom`, 13 tests (the 5.x fixture, the aside and
     toggler, the theme, the toggler's and the key's focus, the title in place, the menu in place
     with the content and focus kept, the scene tabs, a rail pick, the editor view, the disabled
     state, a throwing tab); `_dbg__DebuggerList.test.ts`, 5 (the parts, the listbox and its
     selection, the toggles, a static list's copy, the empty text); `Tabs.test.ts`' divider.

3. **The profiler window and the editor drawer:**

   - The profiler's tab menu and its Settings tab (D10).
   - The editor drawer's tabs and splitter, and the material editor's selector and HUD.
   - Their styles, with `Profiler.module.scss` and `GPUMemory.module.scss` restyled only (D1).

   As built (2026-10-29):

   - **The profiler window's menu** is `createTabs` (horizontal, `iconOnly`, manual activation,
     as the rail). Each tab gets a container of its own: `debug/_dbg__TabContainers.ts`, moved
     out of the drawer shell, which uses it too. The menu changes in place as the rail's does
     (`setTabs`, the same `isSyncingTabs` guard): creating or removing a profiler tab no longer
     rebuilds the window. `_openProfilerTab` mounts the tab before `openDraggableWindow` brings
     an open window to the front, so the front's focus goes to the selected tab.
     `_debugTabButtons.scss` is deleted.
   - **The Settings tab's Overview rows** are two kit lists (D10), engine and app. Each row has a
     visibility toggle (an action, `circleCheckCutout`: the built-ins have no eye icon), "Hidden"
     as its suffix (not the colour alone), and `createListReorder` (Alt + arrows or a drag,
     announced). The two lists keep 5.x's rule that a row moves only within its group
     (`moveOverviewMetric`). The app list is hidden until an app source exists.
   - **The Overview rows' parts:** "Reset to default" is a kit button. The lists and the button
     read the settings on the tab's scheduler (`content(ctx)`, `addScheduledRefresh`), which
     `_setProfilerSettings`' tab refresh runs. The ▲ / ▼ buttons went, and with them axe's 50
     `target-size` and 2 `color-contrast` nodes.
   - **`Profiler.module.scss` and `GPUMemory.module.scss`** are on the tokens (roles, space and
     type tokens, no `variables.scss`, `color.adjust` or `--aek-rem`). Their HTML-string classes
     are kept for p807. The Objects tab's small buttons look like the kit's small secondary
     button (24 px), the picked bar measure is in the accent (a pressed tool), and the bars are
     the text's shades (a measure, as the kit table's bar cells).
   - **The window title's icon** (section 2's finding) has its own `1em` box in
     `DraggableWindow.scss` (`aek.components`, which beats the base layer's debugger reset). The
     About dialog's shot changed with it: its giant Æ behind the title is gone.
   - **Found on the way, a kit fix:** `FocusTrap.ts`' focusable selector counted a
     `tabindex="-1"` button as Tab-reachable, contrary to its comment. A window's first focus
     could then land on a roving composite's unselected item (the profiler's Overview tab), its
     tooltip showing. No native control with `tabindex="-1"` counts now; the focus trap's Tab
     wrap gains the same fix.
   - **The editor drawer's splitter:** the boundary between the selector and the drawer's tabs
     is the drawer's width handle (section 2). This section adds the selector's height handle on
     its top edge. It is `SeparatorInput.ts`, not `createSplitter`: as with the drawer, the
     selector is one fixed pane. ArrowUp heightens; Home is the lowest (80 px) and End 70 % of
     the bounds. Enter collapses and restores, and a move restores a collapsed body. The height
     is saved as the selector state's `height` (`AEK_debugMatEditorUI`), default 150 px (the old
     `15rem`).
   - **The selector** (`_dbg__MaterialEditorSelector.ts`, D10) is a `<section>` named by its
     heading:
     - The filter is a kit search field (`live`). Escape puts back the text from before the
       typing and the clear button empties it; 5.x's "first Escape clears, second blurs" went
       with the raw input.
     - The cards are kit buttons in a `role="toolbar"` with one tab stop: Left / Right, Up / Down
       by the grid's laid-out columns (the shown cards at the first one's `offsetTop`), Home /
       End. The shown material is `aria-current` (the accent), a loading one `aria-busy` (its
       slot pulses), a failed one `data-failed` with a "Failed" badge, and an unavailable one
       `aria-disabled` (focusable). The type and TSL marks are kit badges.
     - Each card's tooltip (`createTooltip`) is its source path, description and failure joined
       on one line. The collapse button is a ghost icon button with `aria-expanded` and
       `aria-controls`.
     - A filter change is announced ("3 of 6 materials").
   - **The material editor's HUD** is a CMP debugger root (`getDebuggerRootProps`) under the
     HUD root, so the selector and the notice take the debugger's theme and density, and an app
     modal's `inert` spares the whole HUD. Before, only the drawer inside it was a root. The
     notice is `role="status"`.
   - **`MaterialEditor.module.scss`** is on the tokens, its breakpoint from
     `debug/styles/_debugLayout.scss`. The info sections set their own text size: the tab's
     container has none, so they would take the kit root's 16 px.
   - **The scene runner** (D14): a third tab host, `MATERIAL_EDITOR`, and two bridge methods,
     `openMaterialEditor({ material })` and `closeMaterialEditor()` (`TEST_BRIDGE_VERSION` 6).
     - `testDebugScene`'s `materialEditor: { material: 'triplanarCheckerboard' }` (a TSL
       material without textures) enters the view and loads the material. It shoots
       `materialEditor.selector` and each drawer tab (`materialEditor.matEditorParams`,
       `.matEditorSettings`), then goes back to the Runtime view, before the undo scripts.
     - `getDebuggerTabOrder` gives the editor drawer's ids too, read from its tab definitions,
       so they are known before the first enter (`_getMaterialEditorTestInfo`,
       `_openMaterialEditorTab`; the editor drawer gains `openTab` and `getMountedId`).
     - `TestBridgeTabOrder` is `Partial` now: a baseline recorded before a host existed lacks it,
       and reads as its ids added.
   - **Tests:**
     - `_dbg__MaterialEditorSelector.test.ts`, 9 tests: the region and toolbar, the search and
       the count, a saved filter, the keys over two laid-out columns, a pick and an unavailable
       card, refresh's marks, collapse by the button and by Enter, the height handle's keys and
       saved height, and disposal.
     - `_dbg__ProfilerSettings.test.ts`, 5 tests: `moveOverviewMetric` within and past a group,
       and the editor's lists. They cover a reorder by Alt + ArrowDown, the toggle, the reset,
       and the app group.
   - **The `debugger` configuration:** the four profiler tabs and the About dialog changed, and
     the material editor's three shots and its tab order are new; all recorded on purpose. The
     other shots, the tab order and the four undo / redo scripts pass unchanged. Axe, summed over
     the six scenes: `color-contrast` 38 → 10 (the profiler's 28) and `target-size` 50 → 3 (the
     character state window's, Phase 4's). The material editor's three roots have none. The
     profiler's 5 `empty-table-header` nodes are p807's tables.

4. **The on-screen tools** (D7): the toolbars, the disabled state during a load (the issue file
   closed), and the axes gizmo's and environment ball's styles. Also
   `docs/issues/action-map-keys-on-focused-debugger-controls.md` (D12: an action map leaves a
   key alone on a focused debugger control), closed with the scene runner's character state
   opener pressing Enter again.

   As built (2026-10-29):

   - **The kit:**
     - `createButtonGroup` gains `toolbar`: the exclusive group's toolbar (one tab stop, the
       arrows, Home / End) for items that act alone. Its items may be `createDropDown`s
       (`ButtonGroupItem`, `Button | DropDown`, a type parameter defaulting to `Button`); the
       trigger takes the focus (`getDropDownTrigger`, `@internal`), and the arrows act only on an
       item's own element, so an open list keeps its keys.
     - `createButton` and `createDropDown` gain `focusableWhenDisabled` (`aria-disabled` instead
       of `disabled`: still a tab stop, the clicks ignored) and a reason on `setDisabled` (the
       button's tooltip, the trigger's title, while disabled). The button gains `isDisabled`, the
       drop-down `setDisabled`. A `disabled` toolbar item is skipped by the arrows, an
       `aria-disabled` one is a stop (the APG's toolbar).
     - Tests in `Button.test.ts`, `ButtonGroup.test.ts` and `DropDown.test.ts`. The library's
       boxes: a disabled but focusable button, a viewport toolbar in the button group box (a
       button, a toggle, a disabled but focusable button, a drop-down) with its keyboard check,
       and a disabled but focusable drop-down. The core and fields guides and the library texts
       describe them.
   - **The tools** (`_dbg__OnScreenTools.ts`, its groups on `_dbg__OnScreenToolbar.ts`):
     - Four kit toolbars (the view switch `exclusive`) in three debugger roots: the top left row
       ("Debugger": About, Undo, Redo; then "Views"), the top row ("Play") and a new bottom row
       (`onScreenBottomRow`, "Scene and camera"), which the switch tools were a root of their
       own before.
     - Each tool is a kit ghost icon button (`size: 'lg'`, 30 px in the compact density; the
       32 px boxes were the old tools'), its label the name, its tooltip the label and the debug
       key's chord (`getDebugKeyChordLabel`, which now knows the prod test keys). Toggles are
       `aria-pressed`: the main loop, pause, the profiler, the debug camera, the light and camera
       helpers, the physics wireframes and the views. Undo and redo are `aria-disabled` while
       there's nothing to do. The `.active` diamond went: the pressed state is the kit's accent.
     - A group reads its tools' state through getters, so `updateOnScreenTools(type)` refreshes
       it in place. Before, every update rebuilt the group, so a key press on a tool dropped the
       focus. A group is rebuilt only when its tools' keys or labels change (a view switch), and
       the focus goes to the same tool. A switch `setActiveView` refuses puts the pressed view
       back.
     - The camera drop-down's "active" mark went (a drop-down isn't pressed); its label is still
       struck while the debug camera renders (`data-debug-camera`).
   - **During a scene load:** `_disableDebugger` calls `setOnScreenToolsDisabled`. Every control
     is `aria-disabled` with the tooltip (or the drop-down's title) "Loading the scene…", its
     clicks are ignored, an open drop-down closes, and a refresh meanwhile keeps them so.
     `docs/issues/on-screen-tools-during-scene-load.md` is fixed.
   - **A debugger control's keys** (D12): a key whose keydown goes to an element in a debugger
     root is the debugger's until its keyup (`KeyboardInput.ts`' `isKeyEventOnDebugger`, folded
     in production).
     - An action map outside `DEBUG` neither counts it, calls back, prevents its default, reads
       it held nor makes a debug key yield to it. An app key binding (not `isDebugKey`) doesn't
       fire, and a `KEY_HELD` one doesn't read it held. The `DEBUG` maps see it as before.
     - So Enter and Space click a focused debugger button, and the gym's player doesn't jump.
       The settled question: the action doesn't run either, as the issue proposed.
     - A press on an on-screen tool doesn't move the focus (the rows prevent the default of a
       primary `mousedown`), so the app's keys keep working after a click on one; Tab reaches
       the tools.
     - Tests in `Actions.test.ts` and `KeyboardInput.test.ts`.
     - `docs/issues/action-map-keys-on-focused-debugger-controls.md` is fixed. The opener's
       `clickReason` (and the field) went: it presses Enter.
     - Found on the way: the issue's premise that typing in a text field doesn't move a player
       was wrong. A map leaves a text field's key its default but counts it. That's an app's
       text field, left as it is (the issue file says so).
   - **The group's background** is `surface` at 80 % (`color-mix`), with a `border` line. By the
     tokens, the icons are about 8:1 over a white scene in the dark theme and 11:1 over a black
     one in the light theme. Checked in a scratch script's shots (`.cache/p806/onscreen.mts`,
     not kept: `testDebugScene` and `lodShowcase`, as they are and over a white and a black
     backdrop, both themes, the loading state and the keyboard). Axe (`UI_AXE_TAGS`) finds no
     violation on the three rows in either theme or the loading state, as in Phase 0. The
     scene runner's `debugger` configuration doesn't shoot the rows: Phase 6's check covers
     them.
   - **Styles:** `OnScreenTools.module.scss`, `AxesGizmo.module.scss` and `EnvBall.module.scss`
     are on the tokens. They no longer use `variables.scss` or `--aek-rem`. Their breakpoints
     moved to `debug/styles/_debugLayout.scss` (`$breakpointXLarge`, `Large`, `Medium`). The
     gizmo and the ball keep their sizes (`space-1` multiples: 100 / 80 px and 70 / 60 px at the
     defaults). The viewport stack's offset uses the toggler's real width (24 px, the kit `sm`
     button's floor, not 30 px).
   - **The `debugger` configuration:** recorded on purpose (the About opener now presses the
     on-screen kit button, the character state opener presses Enter), then a plain run: 6 of 6
     pass, the tab order and the four undo / redo scripts unchanged. Axe, summed over the six
     scenes, is as section 3 left it (`color-contrast` 10, `target-size` 3: Phases 3-4's).
   - **Checks:** `yarn test` (2181), both `tsc`, ESLint, `yarn hub:build`, `yarn verify:ui
--only button,buttonGroup,dropDown` (re-recorded, then passing), `yarn verify:embed` (7
     scenarios), `yarn sbp --profile all` (every budget within; first downloads app 384.5, banner
     287.4 kB gzip). `yarn verify:baselines`: `api.json` records the five additions, and the
     production bundle's `kernel/input` group grew 0.1 kB gzip. That's the held-keys set and the
     branches, which the folded debug flag doesn't remove. No debug code in any build.

Phase 2 verified (2026-10-30, on `39eadf62`: section 4's finalization and the kit's icon slot and
grid stacking fix after it):

- `yarn verify:scenes`: 110 runs. The 105 runs of the four configurations pass (`space`'s known
  worker hash and the asset compare shot only warn). The six `debugger` runs pass their tab order,
  undo / redo scripts and axe ratchet, and fail only on shots: every drawer tab, the profiler's
  tabs and both ray testers moved by about a pixel. That's `39eadf62`'s icon slot rule (`kit.scss`:
  a button's, a tab's or a drop-down trigger's SVG a block) and the grid's rows across both
  columns. Recorded on purpose (`--config debugger --update`).
- `yarn verify:ui`: every box, state and script passes but the drop-down's three open states (its
  trigger 3-5 px shorter: the same icon slot rule) and the tabs box (0.1 %). Recorded
  (`--only dropDown,tabs --update`), then a plain run passes.
- `yarn verify:baselines` (unchanged; no debug code in any build), `yarn verify:embed` (7
  scenarios) and `yarn sbp --profile all` (every budget within; first downloads app 384.5, banner
  287.5 kB gzip) pass.
- `yarn test` under the run's load timed out once (`FeatureFactories.test.ts`) and failed
  `buildGuard.test.ts` while `verify:baselines` rebuilt `dist-embed/`; both pass on their own.

### Phase 3: the edit windows — done

1. **Camera and lights:** `_dbg__CameraGUI.ts` and `_dbg__LightGUI.ts` on grids, and split.

   As built (2026-10-30):

   - **The windows' grid** (`debug/_dbg__DebugWindowGrid.ts`, for this phase's other windows too):
     - `createDebugWindowGrid({ items, folderExpanded?, onFolderExpandedChange? })`: a property
       grid with its own scheduler (a window shows while it's open), the fields' context menu over
       it (Reset, Copy, Paste: D4's, per window as per tab host), removed with it, and the window's
       padding (`DebugWindowGrid.module.scss`, the module's own stylesheet; Phase 5 moves the other
       window helpers next to it).
     - The label column is the kit's 40 %, not the drawer's 50 %: a window is 320 px by default,
       and at 50 % a vector's three boxes cut their values ("1.0" for 1.00). Not persisted: a
       window has no `uiLsKey`.
     - `getEntityInfoItems({ entityId, appId, type, name?, description? })`: the info rows as
       monitors (`{ value }`, `interval: 'refresh'`) after a separator, set as text: 5.x's
       `winSmallLabel` HTML strings put a debug name into `innerHTML` (D10). A row without a
       value (no name) is left out. The scene runner's live masks (`.aekMonitor`) cover them in
       the shots: fixed text, masked all the same.
     - `getReasonedButtonItem({ title, getDisabledReason, onClick })`: a custom item of a kit
       button across both columns, `focusableWhenDisabled` with the reason as its tooltip, read on
       every refresh. The grid's button item has no tooltip; the camera's Delete needed one (5.x
       set the Tweakpane button's `title`).
   - **The split** (D11; both p800 headers gone, every file under 400 lines and every function
     under 150). The kernel still loads `_dbg__CameraGUI.ts` and `_dbg__LightGUI.ts` (D11's
     example named `_dbg__LightTab.ts`; keeping the names leaves `Camera.ts` and `Light.ts`'
     loaders as they were), now the tabs alone, re-exporting what the kernel reads:
     - Camera: `_dbg__CameraDebugState.ts` (the `AEK_debugCams` types, ids, LS functions, the
       helper toggle, the refresh; the debug camera, its rig and helpers and the Debug tools tab
       import it now), `_dbg__CameraEditWindow.ts` (the window and its undo).
     - Lights: `_dbg__LightDebugState.ts` (the `AEK_debugLights` types and LS, the helper and
       symbol preferences and their 3D visuals, the refresh, the global helper toggle, the shadow
       map rebuild), `_dbg__LightUndo.ts` (the undo, and `onLightChange`, the fields' shared
       handler), `_dbg__LightEditWindow.ts` (the editor and a managed light's readout),
       `_dbg__LightShadowItems.ts` (the cast shadow toggle and both shadow folders).
     - The state modules exist so no module imports the one that imports it (the tab registers
       the window's kind at its load). The tabs' two clear-LS buttons share one `clearScenes`.
   - **Changes** apply on every write and are saved and recorded at the gesture's end with the
     field's `prev` (p804 D3). The `committed` copies Tweakpane needed went, and so did LS writes
     on every tick of a drag. The number and colour fields still coalesce (two key presses within
     800 ms are one entry). A tuple saved from several fields (shadow map size, the shadow
     camera's near / far and frustum) takes the field's `prev` into its own slot
     (`onLightChange`'s `toSaved`).
   - **The fields:**
     - Position and target position are `{ get, set }` on the transform, `set` through
       `setTransform` on every step: 5.x moved the entity on `last` only.
     - The colours are `kind: 'color'` on `getHex` / `setHex` (24-bit numbers, as saved).
     - The shadow map's `view: 'list'` blades are unbound selects (`{ value }`, the options as
       before), and the `ListBladeApi` casts went.
     - The shadow fields' `disabled` is a function of `castShadow`, re-read when it changes: 5.x
       rebuilt the window a timeout later.
     - The fov (or frustum size) label follows the responsive aspect through two items, one
       hidden: 5.x rebuilt the window, which dropped the focus from the checkbox.
     - The folders' open states keep 5.x's keys (`_lensSettingsOpen`, `_shadowFolderOpen`,
       `_shadowCameraFolderOpen`) through `folderExpanded` / `onFolderExpandedChange`.
     - The clear button's `disabled` reads the LS on each refresh, which a saved change runs.
     - The labels are in sentence case ("Show helper", "Lens settings"); "Position" and
       "Enabled", which the undo scripts find, are unchanged. Near and far, unlabelled in 5.x
       (Tweakpane showed the key), are "Near" and "Far".
     - The managed light's readout: monitors on getters at 250 ms, its position a vector monitor
       (5.x formatted a string), "Managed by" a monitor with the "read-only" line as its hint.
   - **Lights keeps on a scene change** (D5's list complete): Phase 0's `??` was the data, not the
     list. `OBJECT3D`'s add hook gives a light `TAG_IS_LIGHT` before its type tag, and `Light.ts`
     refreshed the tab from that tag's hook, so the last light of a load read no type (a rebuild
     read it later). The hook now refreshes a microtask later, once per task (debug env only).
     Checked with a scratch probe (`scratchpad/keep.mts`, not kept): `testDebugScene` ↔
     `thirdPersonGymScene`, the kept tab's rows the same as rebuilt, no error.
   - **Tests:** `_dbg__LightEditWindow.test.ts`, 5 (the grid's fields and info rows, the shadow
     fields enabled by the toggle with its save and record, a key step saved and recorded on its
     keyup and undone, the folders' saved states, the clear button) and
     `_dbg__CameraEditWindow.test.ts`, 4 (Delete disabled with its reason as a tab stop, the fov's
     label without a rebuild, a position step moving the camera and recorded at the end, the lens
     folder's state), on `KitDom` with a real `ECSWorld`.
   - **The `debugger` configuration:** the camera and both light windows' shots changed, recorded
     on purpose; the tab order and the four undo / redo scripts pass unchanged (the camera
     window's Position by ArrowUp, the Lights toggle). Axe on the three windows: `label` 19 → 0,
     `button-name` 2 → 0. A scratch script (`scratchpad/windows.mts`, not kept) shot each light
     and camera window with its folders open, and `space`'s managed sky light, with no error.
   - **Hub:** the dev library's parity boxes name the new files' lines, and the select field's
     dev note says the blades are selects now.

2. **Physics:** the entity window and the wireframe folder; `_dbg__PhysicsAPI.ts`' tab content
   split.

   As built (2026-10-30):

   - **The split** (D11; the p800 header gone, every file under 400 lines and every function
     under 150). The kernel still loads `_dbg__PhysicsAPI.ts` (`PhysicsWorld.ts`' loader
     unchanged), now the tab alone (the boot, world, timing and interpolation items as builders,
     the list, the registration):
     - `_dbg__PhysicsDebugState.ts`: the LS keys, the window's folder state, the global
       wireframe palette's restore and persist, the physics entities' lookups and labels, the
       window ids, `refreshPhysicsTab`.
     - `_dbg__PhysicsSettingsUndo.ts`: gravity's and the solver's global undo (handlers at its
       load).
     - `_dbg__PhysicsTabFolders.ts`: the Bodies, Simulation tiers and Interpolation clock
       folders with their readouts (`refreshPhysicsReadouts`, the tab's `onRefresh`), the
       determinism probe, the global Wireframe folder. Their items are Phase 1's, moved as they
       were.
     - `_dbg__PhysicsEntityWindow.ts`: the window, its pose undo, the window kind and the
       profiler's opener (all at its load, which the tab's import runs, as before).
     - The clear-LS button's four keys are one list.
   - **The window** on `createDebugWindowGrid`:
     - **The pose keeps 5.x's model:** the position (a vector field) and the rotation (a rotation
       field in degrees, `step: π / 8` → 22.5°) edit a copy read at the build; "Set position",
       "Set position and cancel velocities" and "Set rotation" apply and record it (undo as
       before), "Update … input" reads the body again and refreshes the grid (5.x replaced the
       objects and refreshed the inputs). Not live `{ get, set }` as the camera's: a body
       simulates, so a live field would move under the user's typing, and a set on each step
       would fight the solver.
     - **The wireframe folder:** "Show wireframe" and each state's colour are `{ get, set }` on
       the draw module (no proxies; `kind: 'color'`), each colour with its "Reset to default"
       and a "Reset all to default", each refreshing the grid (5.x's `folder.refresh()` after
       re-seeding the proxy). The "Persistence" note is a monitor (`interval: 'refresh'`). The
       folder's open state keeps 5.x's key (`entityWireframeFolderExpanded` in
       `AEK_debugPhysicsApiUI`). The draw module still saves a colour on every write of a drag,
       as 5.x did (D1 leaves the draw module alone).
     - **The header went:** its HTML string (`winSmallLabel`, the two `winSmallIconButton`s)
       became grid rows, ordered as the camera's and the lights' windows: the pose, the folder,
       "Log to the console" and "Delete physics entity" (`variant: 'danger'`), then
       `getEntityInfoItems` (Entity ID, App ID, Type: the body's type from `bodyTypeSync`, which
       both targets answer; Name: the object's or the debug name; Description) and the collider
       shapes, a monitor reading "Loading…" until `shapeType()` resolves, then the grid's
       refresh unless the window closed (5.x showed the label, the id and the shapes only).
     - `createDebugWindowGrid` gained `onRemove` (the content removed: what an `await` started
       by the window checks).
   - **Tests:** `_dbg__PhysicsEntityWindow.test.ts`, 5 (the info rows and the shapes once
     resolved, a rotation step applied only by "Set rotation" with its record and undo, the
     position set with the velocities cancelled and "Update" reading the body again, the
     wireframe toggle saved with the folder state and the colour resets, Delete), on `KitDom`
     with a real `ECSWorld` and a stand-in body.
   - **The `debugger` configuration** (`testDebugScene`, `thirdPersonGymScene`): only the physics
     entity window's shot changed, recorded on purpose; the Physics API tab's shot, the tab order
     and the undo / redo scripts pass unchanged. Axe on the window: `label` 6 → 0. At its 400 px
     the info rows are below the fold (the grid scrolls), as the camera's.
   - **Hub:** the dev library's parity box names the list's new line (`_dbg__PhysicsAPI.ts:306`).

3. **Character, PostFX, ECS:**

   - The three windows.
   - After it, nothing imports Tweakpane: `tweakpane` and `@tweakpane/core` leave
     `package.json`, and D3's table is final (p622 can be written, D2).

   As built (2026-10-30):

   - **Shared pieces:**
     - `features/physics/debug/_dbg__BodyPoseItems.ts`: the physics window's pose rows
       (section 2) moved out, so the character window shares them: `getBodyPoseItems`, whose `onSet`
       gets `{ field, prev, next }`, which the window records under its own undo type (`physicsObject.*`, `character.*`: unchanged). The character's 5.x code
       read `pos` / `rot`; the rows read `translation()` / `rotation()`, the same values.
     - `_dbg__DebugWindowGrid.ts` gained `getInfoRowItem(label, value)` (the info rows'
       monitor, exported) and `getNoteItem(text)` (a muted paragraph across both columns, set as
       text; `.note` in its stylesheet, on the tokens).
   - **The character window** (`_dbg__Character.ts`, 336 lines, no split: no p800 header): the
     pose rows, then "Open character state window", "Log to the console" and "Remove character
     (this page load only)" (`variant: 'danger'`; 5.x said "this browser load" in the icon's
     title) as rows, then `getEntityInfoItems` (Type "Character", Name the character's or the
     debug name) and the character's rows (Character ID, Body kind, Controller, Brain, Control
     mode, Visual ID; the deprecated key and mouse binding ids only when it has some, as 5.x).
     The HTML header and its three `winSmallIconButton`s went. A file header was added.
   - **The ECS world window** (`_dbg__ECS.ts`):
     - The entity count is a refresh-only monitor on `getEntityCount()`, refreshed by the same
       `onECSEntityCountChange` listener through the grid's `refresh()` (5.x's
       `pane.refresh()`; `openWorldEditRefreshes` keeps the grid's, removed by `onRemove`).
     - The storage folder (open, not saved, as 5.x): the mode a select (Tweakpane's object form
       of options), each pick saving the override and reloading. Max entities reloads at the
       gesture's end only (5.x reloaded on Tweakpane's first `change`, the first key step), and
       its `min` is 1000, not 1: the kit's step grid starts at `min` (p804 D6), so `min: 1` with
       `step: 1000` stepped 100000 to 101001.
     - "Clear local storage" a button item with `disabled` as a function; "Delete world"
       `variant: 'danger'`, the default world's left out as before.
     - The header (World ID, Name, Description) became info rows at the end.
   - **The PostFX pass window** (`_dbg__PostFX.ts`, 677 lines, no split: no p800 header):
     - `getParamBindingParams` became `getParamField(kind, proxy, key, meta, label)`, returning
       the item and `toParam` (the field's value as the pass takes it): `options` a select
       (the meta's record is Tweakpane's object form), a number with the range, a point with the
       range per axis in `axes`, a boolean and a string inferred.
     - **Colour objects** (§4.1's third finding): every channel in 0..1 is the colour field's
       floats (sRGB, as Tweakpane showed them); a channel over 1 is read as 0..255 and bound
       through `{ get, set }` scaling the channels (the alpha left 0..1). The params say nothing
       of a colour space, so an HDR float colour still reads as 0..255; no pass in the repo has a
       colour param.
     - The changes: a live pass follows each write, a gesture's end applies, saves and records
       with the field's `prev` through `toParam`. The `committed` copies went.
     - The JSON params are info rows (5.x's readonly binding); the "not live" paragraph is a
       `getNoteItem` first; the footer and the name and description (5.x showed them empty) are
       info rows, the last two only when set.
   - **Tweakpane is gone:** no import of it anywhere; `yarn remove tweakpane @tweakpane/core`
     (`package.json`, `yarn.lock`). The scene runner's `.tp-*` live masks and its
     `STABLE_SHOT_CSS` (Tweakpane's labels hyphenated; nothing in `src/` does) went. Prose that
     names Tweakpane (the kit's "Tweakpane's names" notes, the Hub's guides, the root
     `CLAUDE.md`'s Debug system, `readme.md`'s credits, `TestBridge.ts`' control lookup's
     comment) is Phase 7's (D15). D3's table is final: p622 can be written (D2).
   - **Tests:** `_dbg__Character.test.ts` 3 (the info rows, a set position recorded and undone,
     Remove), `_dbg__ECS.test.ts` 3 (the count refreshed by the listener, max entities saved
     and reloaded at the gesture's end only, Delete world only for another world),
     `_dbg__PostFX.test.ts` 3 (each param's field from its value and meta, a 0..255 colour
     shown scaled, a live drag followed and recorded once with its `prev`, a rebuild pass's note
     and its edit applied only at the end).
   - **The position row shows two decimals** (`precision: 2`; the copy keeps them all, so a Set
     doesn't round the body): the gym's character showed "11.3256" cut in its box, the kit
     showing a value's own decimals.
   - **The `debugger` configuration** (`testDebugScene`, `thirdPersonGymScene`): the ECS world,
     PostFX pass and character windows' shots changed, and About's (its Packages list without
     `tweakpane`), all recorded on purpose; the tabs' shots, the tab order and the undo / redo
     scripts pass unchanged. Axe: the PostFX window's `label` 9 → 0, the character's 6 → 0, the
     ECS world's `label` 2 → 0 and `select-name` 1 → 0. Long PostFX labels ("Enabled (rebuilds
     the PostFX chain)") are cut at the window's 40 % label column, with the whole text in the
     label's tooltip (the kit's `onlyWhenTruncated`); 5.x's Tweakpane wrapped them.
   - **`yarn verify:baselines`:** every baseline unchanged (Tweakpane was never in a production
     chunk), no debug code in the production build or either embed.
   - **Hub:** the dev library's parity boxes name the new lines (`_dbg__ECS.ts:84`, `:226`,
     `_dbg__Character.ts:294`, `_dbg__PostFX.ts:662`, and the rotation row's source
     `_dbg__BodyPoseItems.ts:76`).

### Phase 4: the big panels — done

1. **Debug tools, LOD, spatial grid:** `buildDebugToolsItems`, `_createLodDebugGUI` and
   `_createSpatialGridDebugGUI` split into item builders.

   As built (2026-10-31):

   - **The split** (D11; the three p800 headers gone, every file under 420 lines and every
     function under 150: the longest, the Helpers folder's builder, 132). The loaders still load
     `_dbg__DebugTools.ts`, `_dbg__LOD.ts` and `_dbg__SpatialGrid.ts`, now the tabs (registration,
     `onRefresh`, the content's order), each re-exporting what its thin module calls. Folders are
     `get…Folder()` builders, as the physics tab's (Phase 3 section 2):
     - Debug tools: `_dbg__DebugToolsState.ts` (the ids, the state with its 5.x `prodTestMode`
       migration, the theme and click-through applies, a shortcut's save before and after the
       tab exists; the tab and its folders both import it), `_dbg__DebugToolsFolders.ts` (the
       scenes, on-screen tools, helpers, undo / redo, file server and logging folders),
       `_dbg__DebugCameraFolder.ts` (the folder, its camera writes and the viewport sync).
     - LOD: `_dbg__LodTabItems.ts` (the last frame, selection, fades, overlay, impostors and
       inspect folders). The tab keeps the counts and the mesh list (`formatLodCounts`,
       `getLodMeshListData`, both of a world now).
     - Spatial index: `_dbg__SpatialGridSettings.ts` (the saved per-domain settings, the cell size
       per scope, the single-grid LS migration), `_dbg__SpatialGridOverlays.ts` (the visualizer,
       moved as it was), `_dbg__SpatialGridItems.ts` (`createSpatialDomainView`: which domains are
       listed and shown, and where a cell size edit goes; the domain's rows and the Visualizer
       folder), `_dbg__SpatialGridReadouts.ts` (the live figures and their folders).
   - **What the kit's value column needed** (Phase 1's port kept Tweakpane's text layouts; this
     section's before shots, every folder open, showed them wrapping in the narrower column):
     - LOD's impostor rows were 3-line text areas of text wrapped at 24 characters, which scrolled
       at 5 lines. Each impostor is a folder now: Kind, Source, Export, Atlas and Bake as
       one-line monitors (`{ get }`, `interval: 'refresh'`), then its Export. "Export all" and its
       separator show only with impostors; without, a note says there are none (5.x: a monitor
       with an empty label). The dev files text is a note (`getNoteItem` takes a function now,
       read on every refresh), and `wrapText` went.
     - The spatial "All domains" text area is a folder with a monitor per domain (its policy and
       members, then its rebuilds and the last one's cost). The occupancy histogram is an
       "Occupancy" folder: "Occupied cells" (count, spread, average) and "Members per cell", lines
       of at most 17 characters (the bar 10, not 20) with a hint saying how to read a line.
     - Readouts synced in `onRefresh` (LOD's last frame, the spatial scope, size, policy and live
       stats) are `interval: 'refresh'`: they ticked every 200 ms reading proxies that change
       every 500 ms.
   - **Labels:** the key hints are the bindings' (`withDebugKeyHint`: `getDebugKeyChordLabel`, so
     CONFIG.ts' rebinding shows; "[I]" and the others unchanged by default, so the scene runner's
     "Debug key shortcuts [I]" press stands). Three labels cut at the 50 % column are shorter
     ("Load with debugger loader", "Show top tools in prod test", "Show gizmo in main camera"),
     sentence case ("Debug camera", "Undo / redo"), trailing spaces gone, the log buttons say what
     they log ("Log all", "Log the renderer", …). Folder ids are explicit in Debug tools, so the
     saved open states stand; the spatial tab's "Visualizer" and "Live stats" titles (their ids)
     are unchanged.
   - **The spatial cell size's `min` is 0.5** (5.x: 0.1): the kit's step grid starts at `min`
     (p804 D6, as the ECS window's max entities in Phase 3), so 10 stepped to 10.6.
   - **Found on the way, a kit fix:** a folder's heading spans both columns, but the label
     column's separator (24 px at the column's edge) was above it, so a click on a heading's
     middle started a column drag (the scratch shot script's click on a nested folder hit it).
     `.aekFolder__toggle` joins `39eadf62`'s rule for full-width rows (`PropertyGrid.scss`;
     `ui/CLAUDE.md`, the containers guide and the library's text say so). Checked in the browser
     (a scratch probe, `.cache/p806/folderHit.mts`): every heading's centre hits the heading.
   - **Not here:** Debug tools, LOD and spatial still rebuild on a scene change (D5). LOD's and
     the spatial tab's `onRefresh` already rebuild when their structure changes, so
     `keepOnSceneChange` would be a small step for them later; Debug tools' scene select and
     debug camera folder are built for the scene. The impostor button's "Export" / "Re-export"
     title is still read at the build (its Export row says the state live).
   - **Tests:** `_dbg__DebugTools.test.ts` 4 (the 5.x `prodTestMode` migrated and written back, a
     shortcut saved to LS before registration and through the tab after, the key hints with a
     CONFIG.ts rebinding, the file server's refresh-only row), `_dbg__LOD.test.ts` 5 (the counts
     by level and reason, the list's cap, the dev files note and "no impostors", an impostor's
     rows and buttons, the rebuild on a new level count), `_dbg__SpatialGrid.test.ts` 3 (the
     legacy LS migration, a cell size stepped in a scene's scope and reset in that scope only,
     the domains' rows and `formatOccupancy`), on `KitDom` with real `ECSWorld`s and the tab's
     definition captured from a mocked `createDebuggerTab`.
   - **Shots** (`.cache/p806/phase4s1.mts`, scratch: each tab with every folder open, unmasked,
     in `testDebugScene`, `lodShowcase` and `largeWorld`; `.cache/p806/phase4-s1/before/` and
     `after/`).
   - **Hub:** the dev library's parity boxes name the new lines (`_dbg__SpatialGridItems.ts`,
     `_dbg__SpatialGridReadouts.ts:157`, the histogram in place of the summary,
     `_dbg__DebugToolsFolders.ts:208`, `_dbg__DebugCameraFolder.ts:101`, `_dbg__LOD.ts:245`).
   - **The `debugger` configuration** (all six scenes): the tab order, the four undo / redo
     scripts and the axe ratchet pass. The LOD and Spatial index tabs' shots changed in
     `testDebugScene` and `thirdPersonGymScene` (the Debug tools tab's didn't: its changed labels
     are in shut folders), as did the ECS world window's (its focused folder heading's ring drawn
     whole above the separator: the kit fix) and once the GPU memory tab's peak rows (p807's live
     figures; a plain run after the recording passed them). Recorded on purpose
     (`--only testDebugScene,thirdPersonGymScene --update`), then a plain run passes. Axe: 0 on
     the three tabs.
   - **Checks:** `yarn test` (2216), both `tsc`, ESLint, the docs ratchet (unchanged, 100 %),
     `yarn hub:build`, `yarn verify:ui --only folder,propertyGrid` (every state and script, the
     screenshots unchanged).
2. **Ray tester and ray cast, assets:** the ray tester's UI and `RayDebug.scss`; the assets tab
   and its info window (the tables on `createTable`).

   As built (2026-10-31):

   - **The split** (D11; both p800 headers gone, every file under 440 lines and every function
     under 150; `grep -rln "which p800 replaces" src` leaves the material editor and the
     character state window). The loaders are unchanged (`AssetsAPI.ts` loads `_dbg__Assets.ts`,
     the Ray cast tab imports `_dbg__RayTester.ts`).
     - Ray tester: `_dbg__RayTester.ts` (the windows, their content, the results, the
       registration), `_dbg__RayTesterState.ts` (the params' types and defaults, each kind's state
       per scene, the last fire's `testerResults`, the per-scene LS and its clear),
       `_dbg__RayTesterFire.ts` (the aim, both kinds' casts, the hits as data, the scene targets,
       `dropPhysicsFiresInFlight` for the scene enter), `_dbg__RayTesterPick.ts` (the mouse pick,
       its status through a listener the window sets), `_dbg__RayTesterItems.ts` (the pane's
       items). The unused `getEntityIdForObject3D` export is module-private now.
     - Assets: `_dbg__Assets.ts` (the tab), `_dbg__AssetsState.ts` (the ids, the scope, the info
       windows' folder states), `_dbg__AssetsData.ts` (the declarations, the rows and scope, the
       load report's and the pipeline's descriptions as text), `_dbg__AssetInfoWindow.ts` (the
       window, its kind registered at its load as before), `_dbg__AssetInfoParts.ts` (the items
       both kinds share), `_dbg__TextureInfoItems.ts`, `_dbg__GeometryInfoItems.ts`.
   - **The ray tester window** (D10): the toolbar's text muted beside its (kit) clear button; the
     notice a box in the warning's soft tint with a 3 px edge (the text says it) and a kit "Show
     helpers" button (`hidden` while the helpers show); the pick status a `role="status"`
     paragraph kept rendered while empty (its gap cancelled: `display: none` would take it out of
     the tree, and the armed pick might not be read). The pane is still the builder's (D4), now
     with the fields' context menu over it, as the windows' grids. Results: per ray a "Ray" line,
     its error in the danger colour, its hits a kit list ("Hits" and its count; each row a title
     and a `<dl>` of its fields, set as text; a "Copy this hit as JSON" action, so one tab stop
     with the arrows), at most 20 with "+N more hits not listed" after it. Fire isn't `primary`
     (D8: the accent marks the current tab, the selection, a pressed tool and the focus).
   - **The Ray cast tab:** one pane (the testers' buttons, then each kind's helper folder, its
     statistics' toggle and a stats folder: "Three.js ray stats" / "Physics ray stats", ids
     `threeRayStats` / `physicsRayStats`). A counter is a `createTable` (a custom item): "Figure"
     (the row header, a window's decorative donut before its name: "Average, last 3 s") and
     "Value", written with `setCell` by the custom item's refresh (the tab's `onRefresh` at 200
     ms), dimmed with "-" while its statistics are off (`data-inactive`). The physics folder holds
     "Rays" and "Shape casts" (captions shown) and "Pending worker queries" (a refresh-only
     monitor, hidden off `WORKER_THREAD`), or a note without a world. The module-level
     `statsBlocks` / `pendingQueriesView` went. `RayDebug.scss` → `RayDebug.module.scss` on the
     tokens.
   - **The Assets tab:** the heading's HTML (its count and scope button, `--aek-rem` inline) went:
     the scope is a "List" segmented control ("This scene" / "All loaded") in the pane, with a
     note of what "This scene" leaves out ("3 loaded assets not in this scene …"; `getNoteItem`'s
     empty text hides it now), and the list's heading is "Assets" with its count. The Asset
     loading folder's text areas are folders of one-line monitors (p806 Phase 4 section 1's
     reason): "Resolved (this page load)" (GLTF, Textures, LOD chains, Files) and "Assets worker"
     (Status, Requests, Fallbacks, Last fallback, Capabilities joined by commas), read at the
     build too (5.x showed them empty until the first refresh).
   - **The info window** (`createDebugWindowGrid`): "Log to the console" first (5.x's icon at the
     top right), the info rows, then a folder per 5.x section (`texture`, `textureArray`,
     `textureAtlas`, `preview`, `pipeline`, `import`, `geometry`, `lodChain`, `customProps`), their
     open states shared by every info window in `AEK_debugAssetsUI`'s new `infoFolders`, beside
     the tab's `folders` and `scope`.
     - The tables: `createTable`, static, captioned "Layers" (#, the layer or member as the row
       header, "Source (JSON)" hidden without sources) and "Cells" (the cell as the row header,
       At, Size, UV rect, "Data" hidden when no cell has data: 5.x's sub-row under the cell).
     - The file size and the unique edges: a button item in the row ("Measure (HEAD request)",
       "Compute") until pressed, then a monitor in its place. The LOD chain: its rows and
       Generate / Generate (permissive) / Release chain (`danger`) button items, disabled while
       pending, the window rebuilt at the start and the end as 5.x did. The raw custom props a
       multiline monitor (6 rows); the warnings an info row (5.x's warning colour went). Labels
       cut at the window's 40 % column are shorter ("Load time (import)", "Loaded import size",
       "Edge instances" with "(3 × triangles)" in the value, "Welded vertices"). An unloaded
       asset's window is a note.
     - The preview: "Level" a select item in the Preview folder, each option the level's size
       (5.x's buttons' tooltips; 9 segments didn't fit the control column), "Cell rects" a
       checkbox item, the images a custom item; a readback after the window closed writes
       nothing. **Found:** a kit field made inside a custom item takes the grid's subgrid rules
       (`.aekPropertyGrid :where(.aekField)`) and loses its label, so a field goes in as an item
       (`ui/CLAUDE.md`'s grid items say so).
     - `Assets.module.scss` on the tokens: the table styles went; the checkerboard is the colour
       field's (`border-strong` over `surface`); the cell rects keep their cyan and magenta
       (the scene draws them so: D1's 3D colours, not a role).
   - **Tests:** `_dbg__RayTester.test.ts` 4 (the saved params merged over the defaults, the
     scene and the notice with its button, a fire's list capped at 20 with a row's fields and its
     copy, a pick's status, its click saved and Escape), `_dbg__Raycast.test.ts` 2 (a counter's
     table dimmed and written by the refresh, its donut; no physics world), `_dbg__Assets.test.ts`
     4 (the 5.x UI key's scope read and written beside its folders with the note, a geometry's
     rows with its unique edges and Generate, an array's layers table and the Level select, an
     unloaded asset), on `KitDom`.
   - **Shots** (`.cache/p806/phase4s2.mts`, scratch: the Ray cast and Assets tabs with every
     folder open, both testers fired, asset windows in `testDebugScene`, `textureAtlases`,
     `textureArrays` and `lodShowcase`, an atlas slot and an array among them;
     `.cache/p806/phase4-s2/before/` and `after/`).
   - **Hub:** the dev library's parity boxes name the new lines (`_dbg__Assets.ts:278`,
     `_dbg__Raycast.ts:266`, `_dbg__RayTesterItems.ts:116` and `:141`,
     `_dbg__TextureInfoItems.ts:130` and `:209`), and its debugger lists and donut notes say
     what the tab shows now.
   - **The `debugger` configuration** (`testDebugScene`, `thirdPersonGymScene`): the Assets and
     Ray cast tabs' shots changed in both, and the asset window's and both ray testers' in
     `testDebugScene`, as did the GPU memory tab's peak rows (p807's live figures, as in section
     1). The first run found 6 `color-contrast` on the Ray cast tab: its tables were dimmed with
     `opacity: 0.5` while their statistics are off (the default); their cells take the muted text
     instead (5.x's `.inactive` opacity). Recorded on purpose (`--only
     testDebugScene,thirdPersonGymScene --update`), then a plain run passes. Axe: 0 on the two tabs
     and the three windows (each ray tester's 1 `color-contrast`, 5.x's notice text, went).
   - **Checks:** `yarn test` (2226), both `tsc`, ESLint, the docs ratchet (unchanged),
     `yarn hub:build`.
3. **The character state window** (D10; D1's escape hatch if it runs long).

   As built (2026-10-31; D1's escape hatch not taken):

   - **The split** (D11; the p800 header gone, every file under 440 lines and every function
     under 150; `grep -rln "which p800 replaces" src` leaves the material editor). `_dbg__Character.ts`
     still imports `_dbg__CharacterStateWindow.ts` (the window kind, registered at its load):
     - `_dbg__CharacterStateWindow.ts`: the build, the update (a scene looper, as 5.x), the freeze,
       the window kind and the Characters tab's openers.
     - `_dbg__CharacterStateWindowState.ts`: the settings (`AEK_charStateWin`), the instance type,
       the instances, the groups' sources and the freeze's copy.
     - `_dbg__CharacterStateRows.ts`: the read-only rows (classifying, formatting, the flash).
     - `_dbg__CharacterConfigItems.ts`: the Properties group (the editors, their undo, Copy changes,
       Reset all, the baked keys' note).
     - `_dbg__CharacterStateHeader.ts`: the toolbar, the settings' fields, the Gizmos folder.
   - **Two grids** (`createDebugWindowGrid`): the header's, built once (the toolbar, "Update
     interval", "Flash changes", "Show notes"), and the groups', rebuilt when a key comes or goes or
     an open group's value changes its shape (5.x's rule): the Gizmos folder, then State,
     Properties and Internal memory as folders titled with their counts ("State (21)"), their open
     states in the settings' `groupsOpen` (`gizmos` a new key). The update, at the window's
     interval (skipped while frozen or collapsed), checks the shapes, then calls the grid's
     `refresh()`: every row is `interval: 'refresh'`, so the kit reads only the shown fields and a
     shut folder's on its open (5.x's "open groups only"). Nothing ticks.
   - **The read-only rows** are monitors: booleans "true" / "false" (5.x's red and green icons went:
     a colour isn't a status, D8), numbers to 3 decimals, a vector one line ("x 1.000  y 0.000  z
     0.000  len 1.000": the getter fills a scratch of the axes with the length as `w`, so the
     monitor compares them all without an allocation), radians and step stamps as 5.x, number
     arrays and other values as text made only when they changed. **The flash:** monitors never
     flash (p804 D7), so a row that flashes (5.x's `rowFlashes`) sets the kit's `data-flash` on its
     field (`createFlash`, the edit fields' flash colour in the window's stylesheet) when its read
     finds a change during the update's refresh (`isRefreshing`), with "Flash changes" on; a
     folder's reveal, a rebuild and the unfreeze read without one. The edit fields flash as the
     kit's always do (a change from outside: an undo), whatever the setting (its hint says it's
     the read-only rows').
   - **The freeze** copies the three objects one level deep (a vector's components, an array's
     items) and the read-only rows read the copy, so a shut folder opened while frozen shows that
     moment (5.x filled every group at the freeze). The editors keep reading the live values.
   - **The Properties rows:** number fields (a `deg` hint's in degrees with "°"; 5.x's radians text
     beside it went) and checkboxes, `{ get, set }` on `config.values` through `writeConfig`, so a
     key step or drag applies live; the gesture's end saves and records it with the raw value its
     first write replaced (not the degrees converted back). Number edits coalesce as before; a
     single write back to the creation-time value (the reset button, or the value typed) records
     "reset {key}". The kit's reset button (`default`: the creation-time value) replaces 5.x's
     reset icon and its changed edge. The text is `format`'s (up to 4 decimals, no trailing zeros:
     a value from the code keeps its decimals whatever the step's); a step lands on the kit's step
     grid from `min` (p804 D6), 5.x added the step to the value. The baked keys are monitors, named
     by one note at the top of the group ("height, radius, … are sized into the colliders at
     creation: …"; 5.x's lock icons with a tooltip each), then a row with the changed count
     ("2 changed" / "No changes"), "Copy changes" and "Reset all" (kit buttons, disabled with a
     reason while nothing changed), written on every write and never per frame.
   - **The saved values:** the toolbar's "N saved" badge (`info`, hidden at 0) and its clear button.
     The per-row saved dot went, not into a per-row badge as D10 said: every committed edit is
     saved, so a saved row is a changed one (the reset button shows it), and they differ only after
     a clear.
   - **Notes:** 5.x's row tooltips (the raw value, the key's note, the late-value and baked notes)
     went. "Show notes" (the settings' new `notes`, default off) builds the groups again with each
     configuration key's note, the late values' and each gizmo's description as the field's hint;
     the raw value is the fields' context menu's Copy and the toolbar's JSON copy.
   - **The header:** a toolbar (`createButtonGroup`, one tab stop: "Freeze updates" and "Pin the
     gizmos" icon toggles, "Copy the data as JSON"), the "Frozen" badge (`warning`), the saved
     badge and clear button, and "Update 0.016 ms" at the end. The settings' fields reset to the
     settings' defaults. The gizmo labels are words now (`CHARACTER_GIZMOS`: "Velocity", "Floor
     sensor", …), and the scale is "Arrow length per m/s" (`min` 0.05 for the step grid).
   - **Keys:** 5.x's `isolateEditorKeys` and its unfocusable buttons went: a debugger control's keys
     are the debugger's (p806 D12, `isKeyEventOnDebugger`), so Enter and Space reach the focused
     field, not the player's jump.
   - **The window** is 480 × 560 (5.x 460 × 520): the compact density's rows are 24 px.
   - **The update's cost** (its own readout, the gym's first character, every frame, every folder open):
     about 0.12 ms, 5.x 0.016 ms. The grid's `refresh()` reads every shown field, the 30 edit fields
     too, and their `hidden` / `disabled` state. D13's perf-auditor pass (Phase 6) looks at it.
   - **Tests:** `_dbg__CharacterStateWindow.test.ts` 6 (a 5.x settings object's folders and the
     rows' text, a baked key's monitor and note, a degree key; a flash on the update's refresh and
     the setting; the freeze with a shut folder opened while frozen and the unfreeze; a key step
     live, saved and recorded at its keyup, undone and redone; a checkbox, the reset button's
     "reset" and Reset all as one step; a key added and the character gone), on `KitDom` with a
     stand-in character and the looper captured.
   - **Shots** (`.cache/p806/phase4s3.mts`, scratch: the window with every folder open in
     `thirdPersonGymScene` (both characters) and `topDownTestScene`, frozen, and with the notes on;
     `.cache/p806/phase4-s3/before/` and `after/`).
   - **The `debugger` configuration** (`testDebugScene`, `thirdPersonGymScene`): only the character
     state window's shot changed (480 × 560; it opens with the focus on the Freeze toggle, whose
     tooltip shows, as the other windows' first controls' do); the tab order and the undo / redo
     scripts pass. Recorded on purpose (`--only thirdPersonGymScene --update`), then a plain run
     passes. Axe on the window: `label` 29 → 0, `button-name` 1 → 0, `label-title-only` 1 → 0,
     `target-size` 3 → 0.
   - **Hub:** unchanged: the characters guide's and the debug suite's lines (grouped and formatted
     data, freeze and copy, edits with undo kept over reloads, pinnable gizmos) and the readme's
     still say what the window does; the dev library's parity row is the Characters tab's toggle.
   - **Checks:** `yarn test` (2232), both `tsc`, ESLint, the docs ratchet (unchanged).

### Phase 5: dialogs and the last styles — done

1. **The About and key shortcuts dialogs** (D10).

   As built (2026-10-31):

   - **The About dialog** (`_dbg__About.ts`, 333 lines): its HTML strings (`escapeHtml`, the header's
     and the sections') went; every value is set as text. The symbol is a decorative box
     (`aria-hidden`) holding `getSvgIcon('aekasha')` (a CMP with `html` *is* that HTML's element,
     so the box is its parent: the first shot's symbol was text-sized), the name a paragraph (the
     window's title is the `h3`), the links `createLink`s (`external`: the mark and "(opens in a new
     tab)"), each section an `h4` and its `<dl>` (D10: it stays). "Copy info" and "Close" are kit
     buttons; the copy's result ("Copied", "Copy failed", also without `navigator.clipboard`) is the
     button's label for 2 s and is announced (`announce`: a label change isn't read). The label
     column is 40 % in every section (5.x: 160 px, a package name wrapping; `fit-content` made each
     section's column its own width). `About.module.scss` on the tokens, its breakpoint the
     partial's.
   - **The key shortcuts dialog** (`_dbg__DebugKeyShortcuts.ts`, 638 lines): `createTabs` (App,
     Ækasha; automatic activation, `keepMounted: false`, so a tab is built again on each selection,
     as 5.x's `showTab` did: the scene's bindings change), each panel the scroller. A row's keys are
     data now (`ShortcutInput`: `{ keys }` or `{ text }`): each chord a `createKbd` of its own (one
     Kbd for `'Ctrl+Z / Meta+Z'` couldn't wrap and ran under the name in the first shot), "or"
     between, a mouse, touch or gamepad input (and the pointer rows' drags and clicks) as text, an
     action without bindings "Unbound". Each section is an `h4`, its description and a static kit
     list (`render`, `label` the title, `empty` "No key bindings.") with a line between rows; a row's
     name, id, description and notes are text, its states `createBadge`s (muted → `neutral`). An
     inactive row (off, removed, unbound, disabled) is struck and muted, not at 50 % opacity (below
     AA); its badge says why. `DebugKeyShortcuts.module.scss` on the tokens; the notes' info and
     warning colours mark them, the text says it. The keys show the kit's names (`H`, `Esc`, `Ctrl`;
     ⌘ and the arrows on macOS).
   - **Tests:** `_dbg__About.test.ts` 3 (the sections set as text, the build line the runner masks,
     no second heading, the decorative symbol, external kit links; the copy's text, label and
     announcement and the label back; a copy resolving after the close), `_dbg__DebugKeyShortcuts.test.ts`
     6 (the tabs and the close; an engine key's hint, badge and the app's sharing note; an unbound
     key inactive; pointer input as text and Escape as a key, one hint per chord; the app's keys by
     scope with an action's keys and mouse, a disabled binding, other scenes' count and an empty
     section; a tab built again on its selection by the arrows), on `KitDom` with `openDialog`
     mocked.
   - **Hub:** the dev library's notes (`kbd-text.md`, `tabs-text.md`, `debugger-parity-text.md`) and
     the parity row (`_dbg__DebugKeyShortcuts.ts:599`) say the dialog is on the kit.
     `debug/CLAUDE.md`'s About and shortcuts lines, `ui/CLAUDE.md`'s Kbd line.
   - **Shots:** the `debugger` configuration's own (`window.about`, `window.keysAekasha`,
     `window.keysApp` in `testDebugScene`), copied to `.cache/p806/phase5-s1/before/` and `after/`.
     Only those three changed; recorded on purpose (`--only testDebugScene --config debugger
     --update`). Axe: the Aekasha tab's 1 `scrollable-region-focusable` (5.x's panel) went (the kit
     panel is a tab stop); the three dialogs have none.
   - **Checks:** `yarn test` (2241), both `tsc`, ESLint, `yarn hub:build`.
2. **The leftovers** (D9):
   - `variables.scss` deleted.
   - The kit's debugger helpers moved; `kit.scss`' `.uiIcon` rules gone.
   - `--aek-rem` gone from every stylesheet (`Viewports.module.scss` included), then from
     `tokens.css`.
   - D14's greps pass.

   As built (2026-10-31):

   - **The material editor split** (D11; no phase named it, and D14's greps needed its p800 header
     gone; the user's call to do it here). `_dbg__MaterialEditor.ts` 1097 → 426 lines (the load,
     the UI, the view and its registration), beside `_dbg__MaterialEditorAssets.ts` 188 (the
     project materials and textures from the generated data, a copy's props, the textures' load
     and `retagLoadedTextures` for the exit, the selector's entries), `_dbg__MaterialEditorStage.ts`
     234 (the private scene, the settings on it, the view camera and each material's pose; the view
     id is defined here and re-exported) and `_dbg__MaterialEditorEdits.ts` 396 (the selection, the
     copy, a binding's edit with its save, undo and redo, the clears). The edits reach the load,
     the drawer's refresh and `isEntered` through `setMaterialEditorHooks`, which the registration
     sets (no import cycle); its undo handler still registers at its module's load, which the
     editor's module imports, so as before. The bodies moved unchanged but for the shared state's
     getters. `grep -rln "which p800 replaces" src` is empty.
   - **`variables.scss` deleted** (no importer was left). `DraggableWindow.scss`' debugger helpers
     went: `winSmallLabel`, `winSmallIconButton`, `winNotRightPaddedContent` and `winFlexContent`
     had no user; `winPaddedContent`'s one, the LOD entity window, has its own
     `features/lod/debug/LodEntityWindow.module.scss` (its padding and its `pre` on the tokens, its
     inline 11 px the compact `font-size-sm`), not D9's shared `DebugWindow.module.scss`.
   - **`kit.scss`' debugger icon rules went:** the base layer's `[data-aek-debugger] .aekIcon`
     reset (inline, auto width) and the unlayered `.uiIcon svg` rules (`width: 100%`, and the slot
     rule). A debugger icon is the kit's now: `1em`, and in a button's or tab's slot the slot's
     `1em`. So the icon-only menus keep their 16 px through their slot's font size, on
     `--aek-icon-size-lg` (the rail, shared by the editor drawer, and the profiler's menu), the
     on-screen tools through theirs (`lg`, an icon that fills its box `md`), and the on-screen
     drop-down's SVG is 100 % of its 13 px icon (the trigger draws it at `1.25em`). Measured with
     a scratch probe (`.cache/p806/iconSizes.mts`) against the last commit: the on-screen tools 13
     px, their drop-downs 13, the rail and the profiler menu 16, a window title's 11, all as
     before; the three on-screen rows' shots are byte-identical. The kit lists' row and action
     icons go 16 → 11 px (`1em` of the compact small text): the kit's compact list, as D9 says
     (the kit's pieces take the density, not overrides), and kit buttons' icons in the debugger
     (a clear button's eraser, a close) the same.
   - **`--aek-rem` gone:** `Viewports.module.scss` (0.8 → `space-3`, 1.6 → `space-5`) and
     `Stats.scss` (0.4 → `space-2`), the same pixels at the defaults (neither is a compact root):
     `largeWorld` (its minimap viewport) passes `mainThread` unchanged. Then `tokens.css` (its
     `@property`, the kit root's two declarations) and `Tokens.test.ts`' registered list; the Hub's
     design generator drops its row ("internal") and the type page's note, `embedChecks.test.ts`
     uses other names.
   - **D14's greps** in `src/`: no Tweakpane import, `tp-` class, `variables.scss`, `--aek-rem`,
     `uiIcon` / `smallIcon` selector or p800 header. `getSvgIcon` still writes `uiIcon` /
     `smallIcon` (no style reads them; p622 stops it: `ui/CLAUDE.md`'s 6.0.0 list).
   - **Docs:** `ui/CLAUDE.md` (the icons, the styles, the units, the themes and layers lines that
     waited for p806; `--aek-rem` described as gone), `debug/CLAUDE.md` (only the two 3D files keep
     a size header), `editors/CLAUDE.md` (the material editor's modules), the dev library's icons
     note, `SvgIcon.ts`' summary.
   - **`yarn verify:ui`:** 16 states changed, all from the unlayered `.uiIcon svg` rule going: it
     reached the Hub's demos too, making every kit SVG `inline-block` on its text's baseline where
     the kit's own rule says `block`. The icons box (19 px shorter: the sized gears share a line and
     centre), the empty state (3-5 px), the button's, window title's, drop-down's, menu's, list's,
     tree's and divider's icons by 0.1-0.3 %. That's the kit's intended look; recorded on purpose
     (`--only window,dropDown,menu,list,tree,divider,emptyState,icons --update`), then every box,
     state and script passes.
   - **The `debugger` configuration** (all six scenes): the tab order, the undo / redo scripts and
     axe pass unchanged. The first run, before the slot sizes, moved 45 shots (the rail's and the
     profiler menu's icons at 12 px); after, 14: the Assets lists' icons and the shifts of a pixel
     under a kit button's or a heading's icon (a ray tester's toolbar, the profiler tabs' headings,
     the space and Hub tabs), the About dialog's and the character state window's title by 0.1 %.
     Recorded on purpose (`--config debugger --update`). Shots of the largest in
     `.cache/p806/phase5-s2/before/` and `after/`, the probe's sizes and the on-screen rows in
     `icons-before/` and `icons-after/`.
   - **Checks:** `yarn test` (2241), both `tsc`, ESLint, the docs ratchet (unchanged, 100 %),
     `yarn hub:build`, `yarn verify:embed` (all scenarios), `yarn sbp --profile all` (every budget
     within; first downloads app 384.4, banner 287.4, uiKit 286.6 kB gzip), `yarn verify:baselines`
     (no debug code; the production `DialogWindow.css` and the uiKit embed's CSS 0.2 kB gzip
     smaller, the banner's 62 B: recorded with `--update`), `largeWorld` under `mainThread`.

### Phase 6: verification

- The `debugger` configuration with axe failing on any violation; every undo / redo script.

  As built (2026-10-31):

  - **What was left** (the baseline's axe counts after Phase 5): the profiler's 5
    `empty-table-header` (Objects' two breakdown tables' and the heaviest table's rank and action
    columns, GPU memory's frame table's label column), which section 3 of Phase 2 had left to p807,
    and the `assetCompare` tab's 8 `color-contrast` (a scratch probe, `.cache/p806/axeNodes.mts`,
    named the nodes).
  - **The headers:** each empty `<th>` holds its name as `aekVisuallyHidden` text ("Kind",
    "Owner", "Rank", "Actions", "Metric"): no change to the look. `renderBreakdown` takes an
    options object (five parameters with the column's name).
  - **The contrast was the kit's:** the 8 nodes are the hidden slot's rows (`disabled: !isShown`)
    in a static list, which the kit drew in `--aek-text-disabled` (3.28:1 in the dark theme). A
    static list's row is text, not a control, so WCAG 1.4.3's exception for inactive controls
    doesn't cover it. `List.scss` draws a static list's disabled row (`data-disabled`) in
    `--aek-text-muted`, as p804 did for a disabled monitor; an interactive list's
    (`aria-disabled`) keeps the disabled colour. `ListTypes.ts`' `disabled` and `ui/CLAUDE.md`
    say so. Only `assetCompare` has such rows in the debugger; the public component library has
    none (the dev library's parity box has, which `verify:ui` doesn't check).
  - **The check:** `debuggerChecks.ts`' `compareAxeCounts` (a ratchet against the baseline)
    became `findAxeFailures`: any violation on any root fails, a recording run too. The baseline
    still records the counts. Its test, `sceneDebugger.ts`' header and `devTools/verify/CLAUDE.md`
    follow.
  - **The run** (`--config debugger`, all six scenes): 58 roots, 0 axe nodes (Phase 0: 68
    roots, 660 nodes); the tab order and the four undo / redo scripts pass unchanged. One shot
    changed: `drawer.assetCompare`, the hidden slot's titles muted (#939eb0 against the shown
    slot's #dde2ea; 5.x's #596474), recorded on purpose (`--only assetCompare --config debugger
    --update`); before and after in `.cache/p806/phase6-s1/`. The profiler's tables, with their
    hidden names, pass their shots.
  - **Checks:** `yarn test` (2241), both `tsc`, ESLint, the docs ratchet (unchanged),
    `yarn verify:ui --only list` (every state and script).
  - **For Phase 7:** D14's `verify:ui` lines (the "Tweakpane parity" box goes, the "Debugger
    parity" box keeps p807's rows only) are Hub content, done with D15.

- The perf-auditor agent's pass against Phase 0's figures (D13); the debug chunks measured again.

  As built (2026-10-31):

  - **The measures** (`.cache/p806/measure.mts`, its selectors moved to the kit's drawer: the
    rail's `role="tab"` buttons by their hidden names, the list rows' main cells, "Close the
    debugger"; Phase 0's copy is `measure-phase0.mts`; figures in `measures-after-quiet.json`,
    `measures-after.json`, `measures-after-fix.json`). Main-thread ms per second, three 10 s
    windows each, Phase 0 (Tweakpane) → Phase 6 (kit):
    - Quiet idle: 57, 51, 56 → 62, 59, 52.
    - Quiet, the sun's Lights window: 48, 46, 60 → 53, 54, 66. Its fields have no interval, so
      no tick runs: nothing per frame.
    - Quiet, the Physics API tab: 57, 63, 58 (style 0.6) → 55, 65, 57 (style 0: Tweakpane's
      monitors ran their own `setInterval`).
    - Gym idle: 160, 144, 144 → 146, 147, 144.
    - Gym, the character state window: 167, 156, 171 (+15 over idle; loop CPU +0.03 ms) → 200,
      169, 210 (+46; loop CPU +0.2 ms), a regression; after the fix below 165, 180, 143 against
      idle's 146, 177, 138 in the same run (loop CPU +0.03 ms), within the noise. That run was
      at 132 Hz (the display); each comparison is within its run.
  - **The character state window's regression** (Phase 4 section 3's 0.12 ms against 5.x's
    0.016): a CPU profile (`.cache/p806/charProfile.mts`, scratch) put the window at 15 ms/s, of
    it `closest()` 7.8: every field walked to the document root twice a refresh, `isShown`'s
    `[hidden]` and `readState`'s `fieldset[disabled]`; the reads themselves 2. **The fix is the
    kit's** (`ui/forms/binding/AncestorReads.ts`, `@internal`): each loop of the scheduler (a
    `refresh()`, a tick, a reveal) is an ancestor pass, in which the last parent's two answers
    are kept, so the fields of one folder share one walk; a kit write of a `hidden` (a field's,
    a folder's) or a fieldset's `disabled` (`readFieldsetDisabled`) clears them, and outside a
    pass every read walks as before. `closest()` went 7.8 → 1.1 ms/s, the window 15.2 → 12.5 in
    the profile. It also takes care of the auditor's first finding: a stale entry's `isShown` in
    the tick (walked every frame so it's read on the first frame it shows, which stays) is one
    walk per folder. `AncestorReads.test.ts` (5); `ui/CLAUDE.md`'s scheduler line and test list.
  - **The perf-auditor's other findings, not changed:** the character window's default interval
    (0, every frame) is 5.x's; the Physics tab's 500 ms poll allocates per body
    (`getPhysicsEntitiesListData`, `refreshTiersReadout` with its folder shut) as 5.x's did; a
    monitor builds its text only when the value changed (p805 §4's second note: no change
    needed); the character window's `OTHER` rows' `JSON.stringify` and vector text, and the
    light window's managed colour string, are a few strings a frame. Candidates for p807's
    pass, which reworks the live figures.
  - **Each tab's build** (median of three, the gym; ms: the click, to the next frame), Phase 0 →
    Phase 6: Sky box 25.3 / 42.8 → 35.9 / 45.2, Physics API 11.0 / 23.0 → 12.7 / 16.6, Ray cast
    5.4 / 13.9 → 11.7 / 14.9, LOD 3.4 / 8.5 → 7.5 / 10.5, Assets 3.0 / 10.4 → 8.8 / 11.6, Spatial
    index 4.5 / 10.8 → 6.5 / 8.6, Debug tools 5.9 / 9.5 → 6.4 / 8.1, the other eight 0.8-1.7 /
    5.0-8.4 → 2.9-4.3 / 5.0-6.9. The kit builds its DOM in the click, where Tweakpane left more
    to the frame: the click is longer, to the frame (what a user waits) about the same, the sky
    box tab 2.4 ms longer. The drawer's open: the click 1.0-1.2 → 2.6-3.1 ms, to the frame
    3.5-6.0 → 5.7.
  - **The debug chunks** (`yarn build:test`, `.cache/p806/debugChunks.mts`, scratch; figures in
    `debugChunks-after.json`), Phase 0 → Phase 6: the lazy JS chunks with debug code 49, 638.7
    kB, 221.5 kB gzip → 53, 510.3 kB, **204.2 kB gzip** (17.3 kB gzip less, about 8 %); their CSS
    12 files, 51.3 kB, 12.6 kB gzip → 14, 38.0, 10.9; Tweakpane's chunk (148.6 kB, 30.5 gzip)
    gone; the debug modules 484.2 → 503.4 kB minified, the thin wrappers in the first download
    16.7 → 17.5; stats-gl 33.2 → 34.0 (p807's); the kit inside the debug chunks 2.8 → 4.0. The
    largest, gzip: `_dbg__Profiler` 15.8, `_dbg__MaterialEditor` 15.5, `_dbg__Character` 14.9,
    `_dbg__SkyBox` 13.3, `_dbg__Stats` 10.9, `_dbg__Assets` 10.3.
  - **Production** (D13): `yarn sbp --profile all` every budget within, first downloads app
    384.4, banner 287.4, uiKit 286.6 kB gzip (Phase 5's). `yarn verify:baselines`: no debug code;
    the `BindingScheduler` chunk 0.2 kB gzip larger in the app and the uiKit embed (the pass), and
    the new module's five `@internal` functions in `api.json`: recorded with `--update`.
  - **Checks:** `yarn test` (2246), both `tsc`, ESLint, the docs ratchet (the new module 100 %
    documented, recorded), `yarn verify:ui` (every state and script), the `debugger`
    configuration (all six scenes: shots, axe, the tab order, the undo / redo scripts).
    `devTools/hub/buildGuard.test.ts` failed once while `yarn sbp` built beside it (both write
    the build folders) and passes alone.
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

Run 2026-10-29 on `a0d3ced2` (`main`'s `src/`). The script is `.cache/p806/census.mts`
(gitignored: the TypeScript AST of the 109 files that are `_dbg__` or name the tab API or
Tweakpane), its output `.cache/p806/census.md` and `census.json`, then read by hand where a count
looked off.

**§1.1's counts, checked:** 26 sections, 20 `createDebuggerTab` calls (15 engine, 5 app), 7
`new Pane` in 6 files outside the builder. Two differ: 53 imperative `addBinding`s, not 54 (the
camera's ninth, `_dbg__CameraGUI.ts:275`, is commented out), and §1.1's "Params, Settings, Camera"
are the material editor's two tabs and a folder (§3's Phase 0, step 2).

**Declarative** (the builder's items, all 26 sections):

- 287 bindings (p804's 280 recounted): 115 on the tab's `state`, 172 with a `target`, every one
  labelled. 65 folders (16 with `expanded`, 16 with a `hidden` function), 76 buttons (22 labelled,
  29 with `disabled`, 7 `hidden`), 19 separators, 1 custom (the day-night speed buttons).
- 32 definition rows that a builder turns into bindings: the material editor's `MATERIAL_PARAMS`
  (24) and its Settings rows (8), with `view: 'color'` and the ranges added by conditional spreads.
  They port by changing their two builders (`_dbg__MaterialEditorParams.ts:314`,
  `_dbg__MaterialEditorSettings.ts:174`), not row by row.
- The params: `label` 287, `onChange` 174, `target` 172, `readonly` 79, `min` 63, `step` 63,
  `max` 37, `options` 35, `disabled` 34, `interval` 30 (`0` ×15, `250` ×4, `500` ×11), `format`
  22, `hidden` 22, `multiline` and `rows` 12, `view` 8 (all `'color'`), `color` 2, a spread 5 (the
  shared monitor params). Every one is a kit field prop but `color` (below).
- None uses `type: 'binding'`, `onCreate`, `persistExpanded` or `onChange`'s `api`: D3's
  compatibility rows for them are for apps.
- The handlers: most of the 174 pass a named function; inline, 12 read `last`, 12 `prev` and 2
  record undo. The rest of §1.4's `last` users are in the functions called.

**Imperative** (53 `addBinding`s, 19 `addButton`s, 5 `addFolder`s, 7 `addBlade`s, 7 `refresh()`s,
7 `dispose()`s), each window's bindings as grid items:

| Window (its `new Pane`)                    | Grid items                                                                                                                                                                                                                                                                                                                                                                                       | Beyond a rename                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera (`_dbg__CameraGUI.ts:215`)          | Helper (checkbox), position (vector; undo on `last`), responsive aspect (checkbox), reference aspect, fov (a slider: `min` and `max`), frustum size; a lens folder with near and far (unlabelled: their key); 2 buttons with `disabled`                                                                                                                                                          | The lens folder's `.on('fold')` → `folderExpanded` / `onFolderExpandedChange` on `uiState._lensSettingsOpen`                                            |
| Light readout (`_dbg__LightGUI.ts:480`)    | 6 monitors (`readonly`, `interval: 250` through a spread) on a getter object; position is a formatted string                                                                                                                                                                                                                                                                                     | -                                                                                                                                                       |
| Light editor (`_dbg__LightGUI.ts:558`)     | Visible, helper, symbol (checkboxes); sky, ground and colour (`view: 'color'` on hex numbers → `kind: 'color'`); intensity, distance, decay; two culling checkboxes; position and target (vectors; undo on `last`); cast shadow; the shadow folder (bias, normal bias, intensity and blur samples as sliders, radius); the shadow camera folder (near, far, left, right, top, bottom); 3 buttons | The two `view: 'list'` blades → unbound selects (`{ value }`, D4) and their `ListBladeApi` casts go; two `.on('fold')`; `disabled` is computed at build |
| Physics entity (`_dbg__PhysicsAPI.ts:484`) | The wireframe folder (visible, a session note monitor, the state's colour `view: 'color'`); position (vector); rotation (a `THREE.Euler`, `step: π / 8` → a rotation field in degrees); 7 buttons, 2 separators                                                                                                                                                                                  | The folder's `.on('fold')` (persisted); `folder.refresh()` ×2 and the inputs' `refresh()` ×2 → `grid.refresh()`                                         |
| Character (`_dbg__Character.ts:125`)       | Position (vector), rotation (a `THREE.Euler` → degrees); 5 buttons, a separator                                                                                                                                                                                                                                                                                                                  | The inputs' `refresh()` ×2 → `grid.refresh()`                                                                                                           |
| PostFX pass (`_dbg__PostFX.ts:398`)        | Enabled (checkbox), the JSON params as monitors, each param from `getParamBindingParams` (number, boolean, string, point, colour; `options` a select); a separator                                                                                                                                                                                                                               | A point's per-axis params (`{ x: { min, max, step } }`) → `axes`; a colour object's `color: { type }` (below)                                           |
| ECS world (`_dbg__ECS.ts:85`)              | Entities (a monitor with `format`); the storage folder (storage mode select, max entities); 2 buttons (one `disabled`)                                                                                                                                                                                                                                                                           | `pane.refresh()` → `grid.refresh()`                                                                                                                     |

**Outside D3's map:**

1. **`interval: 0` is refresh-only in Tweakpane** (`createTicker`: `interval === 0` makes a
   `ManualTicker`), and every frame in the kit (p804 D4). 15 declarative monitors use it (the sky
   box's base folder, LOD ×5, the spatial grid ×2, Debug tools' dev files status ×2, …): they
   change only when their tab refreshes (`refreshIntervalMs`, `onRefresh`, `updateDebuggerTab`).
   p804 §4's census counted them as every-frame monitors. Ported as they are, they'd read every
   frame. The kit has no refresh-only monitor (one without `interval` reads every 200 ms), so the
   builder needs one. Decided: the kit's `interval: 'refresh'`, which the builder maps
   `interval: 0` to (D4).
2. **`color: { type: 'float' }` on a number** (`_dbg__DebugTools.ts:682`, `:688`, the grid
   colours, `0x888888`): any `color` param makes a number a colour field in Tweakpane
   (`isForColor`), so they are colour fields today and become `kind: 'color'`. D3's row said
   `format: 'float'`, which the kit doesn't have (an object colour is floats, and `format` is the
   text function); the row is corrected.
3. **PostFX's colour objects:** `getParamBindingParams` passes `color: { type: 'float' }` when
   every channel is at most 1, else `'int'` (0-255). The kit's object colour is floats only, so
   the PostFX window (Phase 3) binds an int colour through `{ get, set }` scaling it. Today an HDR
   float colour (a channel over 1) is read as an int one; the port can fix that by knowing the
   pass's colour space rather than guessing from the value.
4. **Behaviour changes that aren't type breaks** (the migration page's): a boolean monitor reads
   "On" / "Off" where Tweakpane wrote "true" / "false" (`BooleanFormatter`); a monitor with
   `options` reads the option's label, where Tweakpane wrote the value.

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
