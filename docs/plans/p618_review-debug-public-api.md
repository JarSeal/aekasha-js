Status: draft | not-implemented
Category: Refactoring, Documentation, Debug
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p602_architecture-and-target-structure.md (D4: the debug placement), \_DONE_p605_coding-standards-and-documentation-tooling.md (the five `notExported` types), \_DONE_p607_sbp-foundation-feature-modules.md (D7: the foldability rules), \_DONE_p608_engine-folder-restructure.md (D3: the two wrappers left to this plan), \_DONE_p613_review-rendering-scene-assets.md (`saveTexture`, the PostFX source), \_DONE_p614_review-physics.md (`PhysicsProbeReport`), \_DONE_p617_review-input-ui-hud.md (the plan this one follows; the UI kit the panels use), p622_engine-6-major.md (what waits for the major: D3), p800 in `docs/templates/todo-plan-prompts.txt` (replaces the Tweakpane panels: D1)

# Review: Debug Public API

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to the debugger framework
and to every debug module in the engine, records the findings per file group, and fixes or files
them. Its aim, from the stub: an app writes its own debug tab, profiler figure, undo action or dev
files tool from the Hub page alone, through `aekasha/debug`. It also merges the two debug wrappers
p608 left, fixes the PostFX profiler source's side effect (p613), and decides `saveTexture`. The
Tweakpane panels' code isn't polished: p800 replaces it.

## 1. As found (2026-10-20, `main` at `d1cd0ae`, after p617's merge, Engine 5.8.0)

### 1.1 The stub's names, checked

| Stub | Now |
| --- | --- |
| "`createDebuggerTab`, `createProfilerTab`, `registerStatsSource`, `registerGPUMemorySource`, the dev files, undo / redo" | `debug/DebuggerGUI.ts` 411, `Profiler.ts` 286, `GPUMemory.ts` 71, `DevFiles.ts` 248 (+ `DevFilesProtocol.ts` 105), `UndoRedo.ts` 172. **`createProfilerTab` is on no entry** (nor `openProfilerTab`, `updateProfilerTab`, `isProfilerTabOpen`): the Hub and `debug/CLAUDE.md` describe profiler tabs, and only engine code can make one (§1.4, P1). |
| "views, draggable windows" | Views are on `aekasha` (`registerView`, `setActiveView`, …), reviewed and documented by p612. The windows are on `aekasha/ui` since p617 (D6 there). Both stay theirs: this plan checks only that the debug pages link them. |
| "the one debug-module loader" | `kernel/config/DebugModules.ts` (149): `loadDebugModuleAsync` (on `aekasha/debug`, 31 importers), `loadDebugModule` (the sync form, 3 callers), `useDebug`, `isDebugReady` (no caller). No app or toolkit file uses the loader: the Hub's example loads its `_dbg__` module with `if (IS_DEBUG_ENV) await import(…)`. |
| "the debug folders' structure after p608" | `debug/`: 18 public (thin) modules, 19 `_dbg__` modules, `profiler/` (9), `gpuMemory/` (5), `editors/` (8), `symbols/` (2 + assets). 13 more `debug/` folders, one per kernel area or feature (`kernel/{assets,camera,ecs,light,loop,render,scene}/debug`, `features/{character,lod,physics,postfx,skybox,spatial}/debug`). 116 engine `.ts` files are debug code (a `_dbg__` name or a `debug/` folder), 36,934 lines. |
| "`debug/Assets.ts` and `debug/PostFXProfiler.ts`" | As p608 left them (§1.4, S1). |
| "p800 replaces the panels" | p800 is still a prompt (`docs/templates/todo-plan-prompts.txt`), not a plan. It asks, among much else, for "a guide to how to create your own scene debugger drawer tab": this plan writes it for today's API, p800 rewrites it for its components. |

Earlier plans hand this one **every `_dbg__` module and `debug/` folder** in the engine (p612,
p613 and p614 left theirs here), not only the framework. The stub's "fix only what is broken or
blocks p800" sets how deep: D1.

### 1.2 The stub's inputs, checked

- **p605's `notExported` types:** still there, as named: `PhysicsProbeReport`
  (`features/physics/debug/_dbg__PhysicsDeterminism.ts`, named by `debug/TestBridge.ts`'
  `TestBridgeProbeResult`, which is on the entry), `DrawerState` (`_dbg__DebuggerGUI.ts`, module
  private, named by `getDrawerState`'s inferred return), `DebugKeyShortcutsTab`
  (`_dbg__DebugKeyShortcuts.ts`, named by `DebugTools.ts`' `openDebugKeyShortcutsDialog`),
  `EnvBallOpts` (`_dbg__EnvBall.ts`, named by `EnvBall.ts`' `initEnvBall`) and `AnyStatsSource`
  (`Profiler.ts`, module private, named by `_getStatsSources`). Phase 0's `yarn hub:build`
  confirms the list.
- **p613's PostFX source:** confirmed. `_dbg__ProfilerSources.ts:518`'s `availability()` returns
  `getRenderPipeline() ? true : 'PostFX off'`, and the provider builds the chain when it's due.
  `features/postfx/PostFX.ts` has `isPostFxEnabled` (`@internal`) and `getPostFxPasses`.
- **p613's `saveTexture`:** confirmed: `kernel/assets/Texture.ts:638`, `@internal`, 11 engine
  callers (impostors, the glTF import, texture arrays, the sync loader). `saveBufferGeometry` and
  `saveMaterial` are on `aekasha` with their ownership rules and an `@example`, and both warn in
  the debug env when an id is taken by another object; `saveTexture` doesn't warn.
- **p608 D3's wrappers:** still two-step, as §1.4's S1 describes.
- **p617:** left `debug/DefaultDebugKeyBindings.ts` to this plan (only its import changed there),
  and moved the debug CSS out of the kit's styles (`debug/Stats.scss`, `PercentagePie.scss`,
  `DebugToaster.scss`): done, nothing left.

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder | Exports | Members |
| --- | ---: | ---: |
| `debug` | 146 / 199 | 0 / 3 (`DevFilesError`'s `code`, `details`, constructor) |
| `debug/symbols` | 0 / 5 | 0 / 0 |
| `kernel/ecs/debug` | 4 / 4 | 0 / 0 |

TypeDoc reads only the non-`_dbg__` modules, so the count is the 18 thin modules, `3DSymbols.ts`
and `ECSStressTest.ts`. The 53 undocumented in `debug/`: `DebugTools` 3, `DebuggerGUI` 11,
`DevFiles` 4, `DevFilesProtocol` 5, `GPUMemory` 1, `OnScreenTools` 4, `PercentagePieHtml` 1,
`Profiler` 3, `SceneHelpers` 6, `Stats` 7, `TestBridge` 3, `UndoRedo` 5. Every type in scope is a
type alias, so their fields go uncounted (as in p617): `DebuggerTabDef`'s are documented, the
list item's, the pane items' and `DebugToolsState`'s mostly not. The documented ones use the old
tag style throughout (`@param id (string) tab id`, `@returns TCMP or undefined`).

### 1.4 Findings by file group

Numbered for the phases. **(bug)** marks wrong behaviour, **(SBP)** bytes or work in a build that
doesn't need them; the rest are API shape, placement and hygiene. Read from the code, not yet
reproduced. Phase 0 adds what the perf audit and the framework read find.

**The public API (`debug/index.ts` and the thin modules)**

- P1 **Missing from the entry**, though the Hub or `debug/CLAUDE.md` tells apps to use them:
  - Profiler tabs: `createProfilerTab`, `openProfilerTab`, `updateProfilerTab`,
    `isProfilerTabOpen`; and the gate `CLAUDE.md` says to use, `isProfilerLoadedInThisMode`.
  - `markDebugHelper` ("debug code that adds objects to the root scene marks them"), and
    `registerEntityWindowOpener` with `EntityWindowOpener`.
  - Undo: `recordOrCoalesceUndoRedoAction` (what every slider binding needs: one entry per drag;
    six engine debug modules use it).
  - Dev files: `onDevDataGathered` (its event type is on the entry, the function isn't) and
    `getDevFilesSaveHistorySize` (a `saveData` write's doc links it, and a tool disables its save
    button on 0).
  - Tabs: `isDebuggerTabOpen`, and the types `DebuggerTabDef` names: `DebuggerTabSection`,
    `DebuggerPaneSection`, `DebuggerPaneItem`, `DebuggerPaneBinding`, `DebuggerPaneFolder`,
    `DebuggerPaneButton`, `DebuggerPaneSeparator`, `DebuggerPaneCustom`, `DebuggerStateKey`,
    `DebuggerDyn`, `DebuggerListToggle`. Without them an app can't type a function that returns
    pane items, as the physics and sky box debug modules do (`DebuggerPaneItem<S>[]`).
- P2 **On the entry for no app:** the dev server protocol (`DEV_FILES_ROUTE_BASE`,
  `DEV_FILES_TOKEN_HEADER`, `DEV_FILES_TOKEN_META`, `DEV_FILES_HASH_HEADER`, `AEK_GATHER_EVENT`,
  `DevFilesStageBody`, `DevFilesSaveDataWrite`, `DevFilesErrorBody`) and the test bridge's result
  types (`TestBridgeProbeResult`, `TestBridgeSceneReady`, `TestBridgeSnapshot`). `devTools/`
  imports all of them by path, not through the entry. The protocol bodies the client API names
  (`DevFilesStatusBody`, `DevFilesCommitBody`, `DevFilesConflicts`, `DevFilesSchemaIssues`,
  `DevFilesErrorCode`, `DevFilesWriteStatus`, `DevDataGatheredEvent`) stay public. Removing a
  name from an entry is breaking (D3).
- P3 **Exported, on no entry, not `@internal`**, about 120 names: the boot's own
  (`register*Module`, `registerDebuggerGUI`, `createDebugGui`, `initStats`, `InitOnScreenTools`,
  `registerProfiler`, …), the debug keys' and on-screen tools' (`toggleAxesGizmo`,
  `toggleOnScreenDropDown`, `playInProdTestMode`, …), constants (`DEBUG_TOASTER_ID`,
  `DEBUG_CAMERA_ID`, `PROFILER_*`, `GPU_MEMORY_TAB_ID`, the debug keys' map ids), and the
  profiler's settings API. `entryExports.json` files 79 as cross-entry and 78 as internal.
- P4 **No caller:** `isDebugReady`, `PercentagePieHtml` (and `PercentagePieOpts.size`,
  `@deprecated` with no version), `getStatsConfig`, `StatsOptions`' two `@deprecated` folder
  flags (no version). `TEST_BRIDGE_QUERY_PARAM` is read only in its module.
- P5 The five `notExported` types (§1.2): three are module types in `_dbg__` files that a thin
  module names, so the thin module can't export them; the other two are private.
- P6 Docs: §1.3's 53, the old tag style, and stale text: `registerUndoRedoActionHandler` says
  "Call once per action type, at module load time" (the side-effects rule forbids that outside
  `_dbg__` modules, and B1 makes it wrong too); `PostFXProfiler.ts` and `Config.ts`' `postFx`
  docs name `setPostFxMeasureEnabled()` and `getPostFxPassStats()` as if public.
- P7 **Tweakpane in the public contract:** `DebuggerPaneBinding` passes any other field to
  Tweakpane's `addBinding` and has `onCreate(api: BindingApi)`, and `DebuggerPaneCustom.build`
  gets a Tweakpane `Pane | FolderApi`. p800 replaces Tweakpane, so these break with it. Not fixed
  here (D3): documented as Tweakpane's, so an app knows what p800 will change.

**The loader (`kernel/config/DebugModules.ts`)**

- L1 Two loaders (`loadDebugModule`, sync; `loadDebugModuleAsync`) where p602 D4 says "the one
  loader". The sync one has three callers that can't await (the debug camera's import in
  `Camera.ts`, the ray helpers in `PhysicsQueryStats.ts`, `_dbg__OnScreenTools.ts`' physics draw).
  Both fold out of a production build. `isDebugReady` has no caller (P4).
- L2 An app's own debug module needs none of it: `if (IS_DEBUG_ENV) await import('./_dbg__x')`
  folds the same way (the Hub's example). `loadDebugModuleAsync` adds the prod test mode opt-in
  and an error log. The Hub page says neither which to use nor why.

**Undo / redo (`UndoRedo.ts`, `_dbg__UndoRedo.ts`)**

- B1 **(bug)** `registerUndoRedoActionHandler` is `useDebug(debugGUI)?._register…`: before the
  undo module has loaded (the boot loads it in its debug step, after the features' installs), the
  call does nothing and says nothing, and that action is never undoable. The engine's own modules
  dodge it by importing `_dbg__UndoRedo.ts` directly (the sky box, the material editor). An app
  that registers in a feature's install or before `InitEngine` loses its handler; one that
  registers in `start` or a scene is fine. The public module should keep the handlers itself (as
  `Profiler.ts` keeps the stats sources) and hand them to the implementation.

**The profiler (`Profiler.ts`, `profiler/`)**

- B2 **(bug, p613)** The PostFX source's `availability()` builds the PostFX chain when it polls
  in an editor view.

**The wrappers and the structure**

- S1 `debug/Assets.ts` (11 lines, `createAssetsDebugGUI`, called by `kernel/init/Boot.ts`) and
  `debug/PostFXProfiler.ts` (43, called by `PostFXFeature.ts` inside `if (IS_DEBUG_ENV)`, and by
  `_dbg__PostFX.ts` and `_dbg__ProfilerSources.ts`). Every other kernel area and feature reaches
  its debug module from its own public module (`Renderer.ts`' `createRendererDebugGUI`,
  `Light.ts`, `PostFX.ts`' `createPostFXDebugGUI`): `kernel/assets/AssetsAPI.ts` (529 lines) and
  `features/postfx/PostFX.ts` (479) take them.
- S2 Debug-only modules without the `_dbg__` name, each used by one `_dbg__` module:
  `debug/SceneHelpers.ts` (the Debug tools tab's grid and axes helpers; imports three) and
  `debug/PercentagePieHtml.ts` (the ray cast stats' pie). p608 D4: debug code is found by name.
- S3 `kernel/ecs/debug/ECSStressTest.ts` (275 lines) is on `aekasha` (`initECSStressTest`): a
  debug-only demo (binds `k` and `l`, spawns spheres) that one app scene uses
  (`sceneTestECS`). The engine's only non-`_dbg__` module in a kernel or feature debug folder, and
  the entry's only demo code (p608 took "demo code out of the engine").
- S4 `_dbg__DebugTools.ts:830`: "@TODO: REMOVE THESE!" over test buttons in the shipping Debug
  tools tab ("OPEN DRAGGABLE WINDOW", …).
- The rest of `debug/` matches p602 D4 (the drawer, tab host, pane builder, list, undo / redo,
  profiler, GPU memory, on-screen tools, editor views, dev files client, the About dialog, the
  debug keys, the 3D symbols, the test bridge). The thin modules that only the boot calls stay in
  `debug/` as the framework's own, `@internal` (P3).

**Type hygiene (all 116 debug files)**

- H1 Eight `eslint-disable`s without a `-- reason`: six `no-explicit-any` around light and camera
  helpers (`_dbg__LightGUI.ts` 3, `_dbg__LightHelpers.ts` 2, `_dbg__CameraHelpers.ts` 1; each a
  helper's `update` / `dispose` or a light passed as `any`), two `no-console` in
  `_dbg__PhysicsDeterminism.ts` (the probe's report, on purpose).
- H2 Three TODOs: S4's; `_dbg__DebuggerGUI.ts:415` ("disable also the on screen tools", in
  `_disableDebugger`); `_dbg__Stats.ts:406` (current-scene stats in the Statistics tab, which the
  profiler's GPU memory tab now has).

**Size**

- Z1 Nine files over 800 lines, all Tweakpane panels or editors: `_dbg__CharacterStateWindow.ts`
  1,490, `_dbg__LightGUI.ts` 1,475, `_dbg__RayTester.ts` 1,264, `_dbg__PhysicsAPI.ts` 1,177,
  `_dbg__Assets.ts` 1,102, `_dbg__PhysicsDebugDraw.ts` 1,094, `_dbg__MaterialEditor.ts` 1,044,
  `_dbg__CharacterGizmos.ts` 947, `_dbg__DebugTools.ts` 897. Functions over 150 lines: Phase 0.

**Not yet read**

The framework's implementation (`_dbg__DebuggerGUI.ts`, `_dbg__TabHost.ts`,
`_dbg__DebuggerPaneBuilder.ts`, `_dbg__DebuggerList.ts`, `_dbg__UndoRedo.ts`, `_dbg__DevFiles.ts`,
`profiler/`, `gpuMemory/`, about 6,000 lines) gets p600 §5's full read in Phase 0: it's what the
public API runs. The rest, the panels, editors and tools (about 28,000 lines), get the correctness items
only (D1), by a read for async and stale references across scene switches and for disposal, plus
the scene runner's debug configurations.

## 2. Decisions (proposed 2026-10-20, to confirm)

### D1. Scope

- **Full review (p600 §5):** `debug/` (the thin modules, the entry, the framework's `_dbg__`
  modules, `profiler/`, `gpuMemory/`, `symbols/`), `kernel/config/DebugModules.ts`, and the two
  wrappers' targets where they merge.
- **Correctness, placement and hygiene only:** every other `_dbg__` module and `debug/` folder in
  the engine (the panels, the editors, the debug keys). No panel's code is restructured or
  restyled, and no file over 800 is split (Z1, D8): p800 replaces them.
- **Not in scope:** the app's and toolkit's `_dbg__` modules (p620), the views' and windows' own
  API (p612, p617), Tweakpane's replacement (p800).

### D2. Versions

Engine **minor** (5.8.0 → 5.9.0): names added to `aekasha/debug` (D6) and `saveTexture` on
`aekasha` (D9), B1's fix, deprecations. Toolkit: no change expected. App **patch** if an app file
changes (S3's copy, D12's example). Project = engine.

### D3. What waits for engine 6.0.0 (p622)

Listed in p622, deprecated here:

- P2's names on `aekasha/debug` that serve only `devTools/` (the protocol's route, header and meta
  constants, `AEK_GATHER_EVENT`, `DevFilesStageBody`, `DevFilesSaveDataWrite`,
  `DevFilesErrorBody`, the three test bridge types): `@deprecated`, removed from the entry in
  6.0.0 (`@internal` then).
- `initECSStressTest` on `aekasha` (S3, D7).
- P7, Tweakpane in the tab types: not deprecated (nothing replaces it yet); p800's break, noted in
  p622 and in p800's prompt.

### D4. The bugs first, with tests

- B1: `UndoRedo.ts` keeps the registered handlers in a module map (registration works before the
  implementation loads, in any mode), and `_dbg__UndoRedo.ts` reads them from it; the engine's
  modules keep their direct imports. A test: a handler registered before the module loads is used
  by an undo after it.
- B2: the PostFX source's availability reads `isPostFxEnabled()` and whether a pass is enabled
  (`getPostFxPasses()`), building nothing; `_dbg__ProfilerSources.ts` imports them from
  `features/postfx/` (the source already imports `features/physics/` this way). Checked in an
  editor view in the dev server: the chain isn't built while the view is active.
- Phase 0's framework read and perf audit may add bugs; each gets a test where Node can run it.

### D5. The wrappers merge (S1)

- `debug/Assets.ts` → `kernel/assets/AssetsAPI.ts`: `createAssetsDebugGUI`, `@internal`, the boot
  imports it from there.
- `debug/PostFXProfiler.ts` → `features/postfx/PostFX.ts`, next to `createPostFXDebugGUI`: its
  four functions `@internal` (an app reads PostFX figures in the profiler). `Config.ts`'
  `postFx.measureEnabled` doc says the PostFX tab and the profiler turn it on.
- Both keep p607 D7's rules (calls behind `IS_DEBUG_ENV`, none in a `try`, the gated
  `ctx.onDebugAfterStart` closure); `yarn verify:baselines`' production check and `yarn sbp`
  (the banner unchanged, the app's main chunk within noise) confirm.

### D6. The public API of `aekasha/debug`

- **Added** (minor): P1's list.
- **`@internal`**, each with a summary naming its user: everything else exported in scope and on
  no entry (P3).
- **Removed** (on no entry, no caller): `isDebugReady`, `PercentagePieHtml`, `getStatsConfig`,
  `PercentagePieOpts.size` and `StatsOptions`' two deprecated flags; `TEST_BRIDGE_QUERY_PARAM`'s
  export.
- **P5:** `PhysicsProbeReport` moves to a type-only module the test bridge can name
  (`features/physics/PhysicsProbeTypes.ts`, `@internal`); `DebugKeyShortcutsTab` and
  `EnvBallOpts` move into the thin modules that name them (`DebugTools.ts`, `EnvBall.ts`) and the
  `_dbg__` modules import them back; `DrawerState` and `AnyStatsSource` are exported `@internal`.
- **The loader (L1, L2):** both loaders stay, documented (the sync one for a caller that can't
  await, `@internal`); `isDebugReady` goes (P4). The Hub says what an app uses: a plain
  `if (IS_DEBUG_ENV) await import()`, or `loadDebugModuleAsync` for a module that also loads in
  prod test mode.

**Alternative for P1:** only the profiler tabs and `markDebugHelper` (the Hub names them); the
pane types and the rest stay off the entry until p800 shapes its own.

### D7. Placement (S2, S3, S4)

- S2: `debug/SceneHelpers.ts` → `debug/_dbg__SceneHelpers.ts`, `debug/PercentagePieHtml.ts` →
  `debug/_dbg__PercentagePie.ts` (with its stylesheet's import), their importers renamed.
  `moveMap.ts` regenerated.
- S3: the stress test is copied into the app (`app/scenes/sceneTestECS/ECSStressTest.ts`, through
  the entries, an app patch); the engine's stays on `aekasha`, `@deprecated` (removed in 6.0.0),
  and moves to `kernel/ecs/debug/_dbg__ECSStressTest.ts` only then.
- S4: the test buttons go.

**Alternative for S3:** leave it on the entry, documented as a debug-only stress test.

### D8. Size and hygiene (Z1, H1, H2)

- Z1: each file over 800 gets the header line the coding standard asks for ("a Tweakpane panel:
  p800 replaces it, so it isn't split"). A function over 150 lines (Phase 0) in the framework is
  split; one in a panel gets the same note.
- H1: the six `any` casts typed (three's helper types have `update` / `dispose`; a light is a
  `THREE.Light`); the two `no-console` get their reason.
- H2: S4's goes with the buttons; `_disableDebugger`'s and `_dbg__Stats.ts`' are filed as one
  issue for p800 (`docs/issues/`), or dropped if Phase 0 finds them obsolete.

### D9. `saveTexture` on `aekasha`

Added, documented like `saveMaterial` (ownership: the scene loading or current; an id already
registered keeps its texture; dispose the one passed in), with an `@example` (a `DataTexture`)
and the same debug env warning when an id is taken by another texture. The signature stays
(`texture, givenId?, isPersistent?`), as `saveMaterial`'s.

**Alternative:** stays `@internal`; an app passes its texture to a material directly, unregistered
(no scene release, not in the Assets tab).

### D10. Documentation

§1.3's exports to 100 % (`debug` 199, `debug/symbols` 5, `DevFilesError`'s members), entry names
first, and by reading the type aliases' fields (`DebuggerListItem`, the pane items,
`DebugToolsState`, `StatsSource`, `GPUMemorySource`, `UndoRedoEntry`, `ProfilerSettings`). p605's
style. `@example` on what an app calls: `createDebuggerTab`, `createProfilerTab`,
`debuggerListCMP`, `registerStatsSource`, `registerGPUMemorySource`, `registerUndoRedoActionHandler`
with `recordOrCoalesceUndoRedoAction`, `writeDevFiles` with `onDevDataGathered`, `markDebugHelper`,
`loadDebugModuleAsync`. `@remarks` for the traps: when each registration works (B1, the profiler's
mode gate), P7's Tweakpane fields, `updateDebuggerTab` being a no-op on a hidden tab.

### D11. Tests (Node)

- `UndoRedo.test.ts`: B1; record, coalesce within and past the window, undo / redo across the
  scene and global buckets, the LS round trip (linkedom not needed: the storage stubbed).
- `Profiler.test.ts`: `registerStatsSource`'s replace and remove (the remover of a replaced source
  does nothing), the entity window openers' priority order, the mode gate.
- `GPUMemory.test.ts`: register, replace, remove.
- `DebuggerGUI.test.ts`: `hydrateDebuggerTabState` (only `persistKeys`, a nested key whole, a
  malformed LS value ignored), `addDebugToastWhenReady`'s queue.
- `DevFiles.test.ts`: `UNAVAILABLE` outside the debug env, `onDevDataGathered`'s remover before
  the module has loaded, `getDevFilesSaveHistorySize`'s fallbacks.
- `DebugModules.test.ts`: the loaders' refs and modes (the production folding is the baselines'
  check, not a test's).

### D12. The Hub and `CLAUDE.md`

- The Debug suite page: "Write your own tab" as a full how-to (state and persistence, lists,
  toasts, scene tabs, refresh), profiler figures and tabs, GPU memory sources, undo / redo with
  coalescing, dev files with the gather event, `markDebugHelper`, and which loader an app uses
  (L2). Key APIs updated.
- **Example scene (to confirm):** the debug tab example (`examples/debugTab/`) grows a profiler
  figure (`registerStatsSource`, the box count) and undo for its two settings, so the page shows
  each extension point running. **Alternative:** snippets on the page only.
- `debug/CLAUDE.md`: the moved wrappers, B1's registration rule, the new entry names, the renamed
  modules; the root `CLAUDE.md` only where it names a moved file.

### D13. Performance

Debug code never ships, but the profiler's figures are measured in the debug env, so what the
debug systems cost per frame shows in them. `perf-auditor` runs over `debug/` (the framework, the
on-screen tools, the gizmo and env ball, the stats) and the kernel's and features' per-frame debug
systems in Phase 0; what it finds in an always-on system (one that runs with the drawer closed) is
fixed, the rest recorded.

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs in Phase 0 (`--update`, on `main`) and once in Phase 6 for
Phases 1-5 together (snapshots, hashes and system order unchanged unless a phase says otherwise;
no file edited while it runs). Each phase ends with its "As built" list, its files' JSDoc at
100 % and `docs.json` updated (`yarn verify:baselines --docs --update`).

### Phase 0: baselines, measurements and the framework read

1. `yarn verify:scenes --update` on this commit, then `yarn verify:baselines` clean.
2. `yarn hub:build`: the warnings in scope (§1.2's five expected).
3. `perf-auditor` over D13's scope; the functions over 150 lines in every debug file.
4. The framework read (§1.4's "Not yet read"), and the correctness read of the panels (D1), each
   finding added to §1.4.
5. `yarn sbp` (app and banner) for the debug check's numbers before the wrappers move.
6. Repro: B1 as an `it.fails` in `UndoRedo.test.ts`.

### Phase 1: the bugs (D4) and the tests (D11)

1. B1, B2 and Phase 0's.
2. D11's tests.

### Phase 2: structure (D5, D7)

1. The two wrappers merged; the production check and `yarn sbp` against Phase 0's numbers.
2. S2's renames, S3's copy and deprecation, S4's buttons; `moveMap.ts` regenerated.

### Phase 3: the API (D6, D9) and the deferrals (D3)

1. The entry's additions, the `@internal`s, the removals, P5's moves; `saveTexture` with its
   warning and a test.
2. p622's list; `api.json` (`yarn verify:baselines --update`) with the additions and removals.

### Phase 4: docs and hygiene (D8, D10)

1. D10's docs, P6's stale text.
2. H1, H2, Z1's headers.

### Phase 5: the Hub, `CLAUDE.md`, readme, and what's filed

1. D12's page (and the example, if chosen), `debug/CLAUDE.md`, the root's references.
2. The issue files (H2), p800's prompt (P7), `readme.md` if its debug line changes.
3. `yarn hub:build`.

### Phase 6: versions and done

1. `yarn verify:scenes` (Phases 1-5; `--update --only exampleDebugTab` first if D12 changes the
   example's snapshot), `yarn verify:baselines`, `yarn build`, `yarn hub:build`.
2. `package.json` (D2), the `CHANGELOG.md` entry, `yarn checkVersions --against main`.
3. Mark the plan done (`docs/plans/CLAUDE.md`), p621's and p622's references.

## 4. Risks

- **The debug env is the scene runner's main configuration.** A change to the framework (B1, the
  wrappers, the renames) that breaks a debug module's load breaks every debug run: Phase 6's full
  run and a pass through the drawer tabs and the profiler in the dev server catch it.
- **Folding:** a merged wrapper that leaves a debug call outside `IS_DEBUG_ENV`, or in a `try`,
  ships the debug chunk. `yarn verify:baselines` fails on it.
- **The panels' read is shallow by design** (D1): a bug in a panel that only shows when its tab is
  used can survive. p800 rewrites them.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
