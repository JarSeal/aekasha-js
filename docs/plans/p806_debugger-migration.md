Status: in progress | Phase 0 implemented
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
