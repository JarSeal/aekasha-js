Status: in progress | Phases 0-5 implemented
Category: Refactoring, Documentation, Debug
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md, p800_debugger-ui-overhaul.md (only its p806, the debugger migration)
Related: \_DONE_p602_architecture-and-target-structure.md (D4: the debug placement), \_DONE_p605_coding-standards-and-documentation-tooling.md (the five `notExported` types), \_DONE_p607_sbp-foundation-feature-modules.md (D7: the foldability rules), \_DONE_p608_engine-folder-restructure.md (D3: the two wrappers left to this plan), \_DONE_p613_review-rendering-scene-assets.md (`saveTexture`, the PostFX source), \_DONE_p614_review-physics.md (`PhysicsProbeReport`), \_DONE_p617_review-input-ui-hud.md (the plan this one follows; the UI kit the panels use), p622_engine-6-major.md (what waits for the major: D3), p800_debugger-ui-overhaul.md (the epic that replaces the Tweakpane panels: D1; its p806 rewrites the "Write your own tab" guide)

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
  `_dbg__CharacterGizmos.ts` 947, `_dbg__DebugTools.ts` 897.
- Z3 Twelve functions over 150 lines (Phase 0, by the TypeScript AST). Two are the framework's:
  `registerBuiltInStatsSources` 211 (`profiler/_dbg__ProfilerSources.ts:376`) and
  `createEditorDrawer` 189 (`editors/_dbg__EditorDrawer.ts:75`); `createTabHost` is 149. The
  other ten are panels' content factories: `createEditLightContent` 499, `buildDebugToolsItems`
  467, `_createLodDebugGUI` 425 (its `content` 324), `_createSpatialGridDebugGUI` 372 (its
  `content` 197), `_createPhysicsAPIDebugGUI` 268 (its `content` 225), `createEditCameraContent`
  232, `createEditPhysicsEntityContent` 151.

**Found in Phase 0: the framework** (p600 §5's full read of `_dbg__DebuggerGUI.ts`,
`_dbg__TabHost.ts`, `_dbg__DebuggerPaneBuilder.ts`, `_dbg__DebuggerList.ts`, `_dbg__UndoRedo.ts`,
`_dbg__DevFiles.ts`, `profiler/`, `gpuMemory/`, `_dbg__GPUTimer.ts`)

- B3 **(bug)** A tab whose `content()` throws isn't caught (`_dbg__TabHost.ts`' `buildTabContent`,
  nor `mount`, nor the drawer's build). The drawer is rebuilt on every `setCurrentScene` (to
  change its title, `_updateDebuggerSceneTitle` → `_createDebugGui`) and on every tab registration,
  and each rebuild mounts the saved tab: while a throwing tab is the saved one, `setCurrentScene`
  throws before `initMainLoop()`, so **every scene load fails in the debug env** until the LS key
  is cleared. In the profiler window the same throw leaks the tab's stats source holds, which the
  Overview and Objects tabs take in `onRefresh`, before `content()` (the frame sampler stays added).
- B4 **(bug)** `createProfilerTab` before the profiler has loaded does nothing and says nothing
  (`useProfiler()?.`), B1's pattern: the features' `onDebug` hooks run before `registerProfiler`
  (`Boot.ts`), so a feature can't add a profiler tab from its install. `registerStatsSource` and
  `registerEntityWindowOpener` keep their input in the public module and work.
- B5 **(bug)** **A stats source an app or the toolkit registers is never shown.** The Overview and
  Objects tabs read sources only by their fixed ids (`OVERVIEW_METRICS`), so `registerStatsSource`
  does nothing visible for anyone but the engine, while the Hub ("your own figures join it") and
  `debug/CLAUDE.md` say it does.
- B6 With B2: in an editor view the PostFX row reads "available" and shows the last pass times as
  current (nothing renders the root scene's PostFX there).
- B7 `_dbg__GPUTimer.ts`' timestamp resolve has `.then().finally()` and no `.catch`: on a lost
  device every frame with records logs an unhandled rejection (plausible).
- F1 The whole drawer is rebuilt on every scene change (only its title text changed) and on every
  tab registration (each scene tab, one by one), re-running the saved tab's `content()` each time.
  An in-place title update removes the per-scene rebuild and narrows B3.
- F2 `_isDebuggerTabOpen` ignores the editor-view suspension, so `updateDebuggerTab` refreshes the
  drawer's hidden tab during an editor view (its doc says a hidden tab is skipped).
- F3 The tab host runs a changed CMP section's `html` twice per refresh (to compare, then in
  `update()`): the GPU memory tab walks the asset registries and the scene twice per 500 ms.
- F4 The drawer state is JSON-encoded twice (`lsSetItem(LS_KEY, JSON.stringify(…))`), and the
  read's `JSON.parse` has no `try`: a malformed value throws in the drawer's build.
- F5 Undo: an entry whose handler isn't registered (B1, or a scene's `_dbg__` module not loaded
  yet after a reload) stops undo at that entry for the whole timeline (warned, pointer kept).
  Right (skipping would apply out of order), undocumented. A coalesced drag writes the whole
  history to LS on every tick (debug cost only).
- P8 `createDebuggerTab`'s second parameter (`DebugGUIOpts`, on the entry) only sets the drawer
  button's place (`drawerBtnPlace`) for the whole drawer; nothing passes it.
- P9 `GPUMemoryResource` (named by `GPUMemorySource.getResources`) isn't on the entry, nor
  `GPU_MEMORY_TAB_ID` (for `openProfilerTab`); there is no `removeProfilerTab`.
- Doc drift: `debug/CLAUDE.md` says the frame probe is set in "all three loops" (one `runFrame`
  since p612 D10); `kernel/render/Object3DHelpers.ts` says `markDebugHelper` is on `aekasha/debug`
  (it's on no entry, P1); `_dbg__GPUTimer.ts:158`'s comment describes a check the code doesn't do.
- Clean: the pane builder (persistence, `onChange` suppression on refresh, folder states), the
  list (escaping, focus kept on a toggle), removal (a rebuild disposes every pane and list:
  `remove()` recurses), the dev files client, the stats sources' refcounting (unmount, window
  close, replace, unavailable then available), the census, the allocation tracker.

**Found in Phase 0: the panels, editors and tools** (D1's correctness read; confirmed by reading
the code path unless marked plausible; K1, K2, K5 and the stress test's ECS tab use rechecked by
hand)

- K1 **(bug)** Deleting the active camera from its edit window stops rendering: the button is
  disabled only for the last camera, `disposeCamera` clears the active camera and nothing picks
  another, so `renderScene` throws every frame (`_dbg__CameraGUI.ts:408`).
- K2 **(bug)** Changing a scene helper's size or colour with its "Show" off makes it visible:
  `SceneHelpers.ts`' `create*Helper` adds a new, visible helper, and the checkbox stays off.
- K3 **(bug)** The 3D symbols' cloned materials (two per light, three per camera) are never
  disposed: the delete hook only `removeFromParent()`s (`symbols/3DSymbols.ts:160`,
  `_dbg__Symbols.ts:340`). Every scene visit leaves them.
- K4 Static component hooks registered inside a `registerPlugin` callback, so once per world that
  takes the global plugins: the symbols' (`_dbg__Symbols.ts:332`) and the light helpers'
  (`_dbg__LightHelpers.ts:45`). Guarded against duplicates, so a cost per added world only.
- K5 **(bug)** The About dialog's "Copy info" timer throws if the dialog closes within 2 s
  (`updateText` on a removed CMP, `_dbg__About.ts:263`).
- K6 An F9 / F10 press before the Debug tools tab exists (an app whose `start` shows UI before its
  first scene) is lost: the persist warns, the tab's hydration restores the old value
  (`_dbg__DebugTools.ts:263`; the on-screen tools toggle beside it handles the case). Plausible.
- K7 The test bridge's `freeze` runs once per page (`freezing` never reset): latent, the runner
  freezes once per page load.
- K8 **(bug)** The Assets window's "Generate LOD chain" stays on "Generating…" when the generation
  rejects (no catch, the refreshes skipped; `_dbg__Assets.ts:886`).
- K9 "Enable alpha" (Renderer tab) does nothing visible on WebGPU until a reload: the canvas'
  `alphaMode` is set at construction (three r186). Its undo is a no-op too.
- K10 The Ray cast tab's physics section is built once per mount: a world created or deleted while
  it's open isn't shown until it's reopened (`_dbg__Raycast.ts:305`).
- K11 The Assets tab's "Reload to apply" lights up with no change: it compares `JSON.stringify`
  of objects whose key order an edit changes (`_dbg__Assets.ts:345`).
- K12 **(bug)** Material editor: a selected material whose load fails leaves the Settings tab
  without its Stage and Preview folders (`refreshUI` doesn't rebuild when only the settings'
  presence changed).
- K13 **(bug)** Material editor: undoing a fov change while another material loads is written to
  the record, not the camera, and the next orbit end saves the old fov back.
- K14 Material editor: a scene loaded during the view (HMR) can leave a texture the editor copy
  used registered with the old scene as owner, after that owner's release ran. Plausible.
- K15 **(bug)** The ECS stress test (`kernel/ecs/debug/ECSStressTest.ts`; the ECS tab's benchmark
  buttons use its spawn and reset too): its `InstancedMesh` and counts outlive the scene (the
  spheres stay drawn in later scenes); the instance count isn't clamped to its 50,000 buffer; its
  `k` / `l` bindings have no `sceneId`; its proximity system keeps the first visit's target id.
- K16 Lights: `_dbg__LightHelpers.ts:112`'s visibility condition is inverted (overwritten right
  after, so latent); the `DISABLED` hooks reconcile debug visuals for every entity, not only
  lights (an LS parse per enable or disable); `refreshLightShadows` is called without a catch.
- K17 **(bug)** Physics wireframes: a build that rejects (a collider gone from the worker
  mid-build: a scene switch, a delete, the `REMOVED` tier) leaks the persistent fat lines it made
  (`_dbg__PhysicsDebugDraw.ts:674`).
- K18 The physics entity window's `shapeType()` query has no catch: deleting the entity before the
  worker answers is an unhandled rejection and a stale "Loading…".
- K19 The determinism probe's LS store (`AEK_debugPhysicsProbeRuns`) is never pruned, and its
  write comes before the report listeners: a full LS skips them, so `whenProbeDone` would time
  out. Plausible (the runner's browser starts empty).
- Determinism: no debug code writes simulation state from a per-frame stage (the reads checked
  every edit window, the character config and undo); `Math.random` and `performance.now` feed only
  visuals and measurements.

**Found in Phase 0: performance** (`perf-auditor` over D13's scope)

- Z2 **(perf, always-on)** `_dbg__Stats.ts`' TFPS panel keeps its samples with `push` / `shift`
  every frame (on by default). A ring buffer, or `profiler/_dbg__SampleWindow.ts`.
- Clean: `runFrame`'s debug calls, the gizmo and env ball (scratch objects), the camera and light
  helper syncs, the debug camera, the profiler's sources and sampler (refcounted, pooled), the
  census (throttled), the GPU timer, the GPU memory sampler (always on by design, typed arrays),
  the physics wireframe sync.

## 2. Decisions (confirmed 2026-10-20, as recommended)

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
`aekasha` (D9), B1's fix, deprecations. Toolkit **patch** (Phase 2: `bakeScatterToInstancedMesh`'s
JSDoc named the stress test's moved file; it names `createInstancedMeshPool` now, confirmed
2026-10-21). App **patch** if an app file changes (D12's example). Project = engine.

### D3. What waits for engine 6.0.0 (p622)

Listed in p622, deprecated here:

- P2's names on `aekasha/debug` that serve only `devTools/` (the protocol's route, header and meta
  constants, `AEK_GATHER_EVENT`, `DevFilesStageBody`, `DevFilesSaveDataWrite`,
  `DevFilesErrorBody`, the three test bridge types): `@deprecated`, removed from the entry in
  6.0.0 (`@internal` then).
- `createDebuggerTab`'s second parameter and `DebugGUIOpts` (P8): `@deprecated`, removed in
  6.0.0 (the drawer button stays in the middle; an app moves it with CSS).
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
- **Added in Phase 0** (the framework, each with a Node test where linkedom runs it):
  - B3: the tab host builds a tab inside a `try`; a throwing `content()` (or `onRefresh`) logs,
    shows an error line in the tab's place and leaves the host mountable, so neither the drawer
    nor `setCurrentScene` throws. The Overview and Objects tabs take their source holds in
    `onOpen` (released by its cleanup) instead of `onRefresh`.
  - B4: `Profiler.ts` keeps the tab definitions (as it keeps the stats sources) and the profiler
    mounts them when it loads; `removeProfilerTab` added beside it (P9).
  - B5: D14.
  - B6: the PostFX row reads "not rendered in this view" while an editor view is active.
  - B7: the resolve gets a `.catch` that logs once.
  - F1: `_updateDebuggerSceneTitle` updates the title in place when the drawer exists; a tab
    registration still rebuilds (the menu changes).
  - F2: `_isDebuggerTabOpen` is false while the drawer is suspended by a view.
  - F3: a section's html is computed once per refresh (passed to its update).
  - F4: the drawer state is written as an object (read back either way, so a saved string still
    loads) and a malformed value falls back to the defaults.
  - Z2: a ring buffer.
- **The panels** (D1: fixed because they're broken, checked by hand in the dev server; no Node
  tests): K1 (the active camera's delete disabled, its tooltip says why), K2, K3, K5, K8, K12,
  K13, K15 (with D7), K17, K18, and the one-line ones K4, K6, K7, K10, K11, K16, K19 (the listeners
  first, the write in a `try`). K9: the option reloads, as `antialias` does. K14: the copy's
  textures retagged to the current scene on the editor's exit.

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

- **Added** (minor): P1's list, and from Phase 0 `removeProfilerTab`, `GPU_MEMORY_TAB_ID` and
  `GPUMemoryResource` (P9).
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
- S3, **revised in Phase 0 (confirmed 2026-10-20):** the confirmed plan was to copy the stress test into the
  app and deprecate the engine's. Phase 0 found that the ECS tab's benchmark buttons use its
  spawn and reset too, so a copy would duplicate engine debug code in the app. Instead: the
  implementation moves to `kernel/ecs/debug/_dbg__ECSStressTest.ts` (the ECS tab imports it
  directly), with K15's fixes; `initECSStressTest` stays on `aekasha`, not deprecated, as a thin
  wrapper in `kernel/ecs/ECSStressTest.ts` that loads it through `loadDebugModuleAsync` (debug env
  only, folded in production), documented as a debug-only stress test. No app change.
- S4: the test buttons go.

**Alternative for S3:** as confirmed: the app gets its own copy (spawn, reset and the bindings),
the engine's `initECSStressTest` is deprecated, and the engine keeps only what the ECS tab needs.

### D8. Size and hygiene (Z1, H1, H2)

- Z1: each file over 800 gets the header line the coding standard asks for ("a Tweakpane panel:
  p800 replaces it, so it isn't split"). Z3: the framework's two functions over 150 are split
  (`registerBuiltInStatsSources` per source group, `createEditorDrawer` by its parts); the
  panels' ten get the same header note in their file.
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
fixed, the rest recorded. Phase 0 found one, Z2 (fixed in Phase 1), and F3 while a tab is open.

### D14. An app's stats sources in the profiler (B5; added in Phase 0, confirmed 2026-10-20)

The Overview lists every registered source that isn't a built-in one in a group of its own,
"App", after the engine's rows: its `label` and its value, n/a with its reason, "measuring…"
before its first value, acquired and released like the built-in rows (shown and visible). Its
rows join the Settings tab's order and visibility list (`overviewMetrics`) by source id, so they
can be hidden and moved like the others, and a saved list survives a source that comes and goes.
`StatsSource` gets an optional `format?: (value: T) => string` (minor); without it a number shows
with two decimals and a string as is, anything else as `JSON.stringify`. The Hub's example (D12)
registers one.

**Alternative:** no automatic rows: the entry exports a hold and read API for the sources
(`createStatsSourceHolder`, `readStatsSource`), and an app shows its figures in its own profiler
tab (P1).

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs in Phase 0 (`--update`, on `main`) and once in Phase 6 for
Phases 1-5 together (snapshots, hashes and system order unchanged unless a phase says otherwise;
no file edited while it runs). Each phase ends with its "As built" list, its files' JSDoc at
100 % and `docs.json` updated (`yarn verify:baselines --docs --update`).

### Phase 0: baselines, measurements and the framework read — done

1. `yarn verify:scenes --update` on this commit, then `yarn verify:baselines` clean.
2. `yarn hub:build`: the warnings in scope (§1.2's five expected).
3. `perf-auditor` over D13's scope; the functions over 150 lines in every debug file.
4. The framework read (§1.4's "Not yet read"), and the correctness read of the panels (D1), each
   finding added to §1.4.
5. `yarn sbp` (app and banner) for the debug check's numbers before the wrappers move.
6. Repro: B1 as an `it.fails` in `UndoRedo.test.ts` (and B3, B4 where Node can run them).

As built (2026-10-20, branch `review-debug-public-api` at `4f9d30f` = `main` plus the plan; WSL2,
headless Chromium, WebGL2 through SwiftShader):

- **D1-D13 confirmed** as recommended (2026-10-20), before Phase 0. Phase 0 added D14 and revised
  D7's S3, both confirmed as recommended (2026-10-20).
- **Steps 3 and 4 (the reads):** §1.4's "Found in Phase 0" blocks. The framework read in this
  session; the profiler and GPU memory, the panels (kernel areas, features, editors, tools) and the
  perf audit by agents, read-only, with K1, K2, K5 and the stress test's ECS tab use rechecked by
  hand. The functions over 150 lines measured with a script over the TypeScript AST (Z3; the perf
  agent's "none in the framework" was wrong).
- **Baselines (step 1):** `yarn verify:scenes --update` recorded 105 runs in 3,862 s. The three
  failures are `thirdPersonGymScene`'s debug configurations ("the physics probe didn't reach step
  600 in 300 s" on SwiftShader), the same three as every p616 and p617 run on this machine; its
  `prodTest` passes. `yarn verify:baselines`: all unchanged (the main chunk 186 modules at 832.0 kB
  gzip, the banner's 670.3 kB; `api.json` 2,526 exports, 808 on 16 entries; `docs.json` 2,275 /
  2,430 exports, 935 / 970 members), no debug code in either build.
- **`yarn hub:build` (step 2):** 438 pages; in scope exactly §1.2's five warnings
  (`PhysicsProbeReport`, `DrawerState`, `AnyStatsSource`, `DebugKeyShortcutsTab`, `EnvBallOpts`);
  the search index warning (1.66 MB) is older and p619's.
- **`yarn sbp --profile all` (step 5):** every budget within. The app's initial download 379.2 kB
  gzip (`_engine/kernel/assets` 18.2 kB initial and 8.7 kB lazy, `features/postfx` 2.0 kB); the
  banner's 285.5 kB. Phase 2 compares the wrappers' move against these.
- **Repro (step 6):** `debug/UndoRedo.test.ts` (B1, the real module: a handler registered before
  it loads, an undo returns `false`), `debug/Profiler.test.ts` (B4, the implementation mocked: the
  tab is never handed over), `debug/_dbg__TabHost.test.ts` (B3, linkedom: `content()`'s throw
  leaves `mount`; Tweakpane imports in Node with linkedom). Each `it.fails` checked to fail on its
  own assertion. `yarn test`: 102 files, 817 passed, 3 expected fails, 1 skipped.

### Phase 1: the bugs (D4, D14) and the tests (D11) — done

1. The framework: B1-B7, F1-F4, Z2 and D14, with D11's tests and Phase 0's repros turned into
   `it`s.
2. The panels: K1-K19 (D4), each checked by hand in the dev server (debug env, Chromium). K10
   still needs its own fix after F1: a physics world created or deleted while the Ray cast tab is
   open comes without a scene change, so the open-tab rebuild doesn't cover it.

As built, section 1 (2026-10-21, committed as `cc94f9b`):

- **B1:** `UndoRedo.ts` keeps the handlers (`registerUndoRedoActionHandler`, gated on
  `__AEK_DEBUG__` only, so it works before `initEnvironment` too; `_getUndoRedoActionHandler` and
  `RegisteredUndoRedoActionHandler`, `@internal`). `_dbg__UndoRedo.ts`' `_registerUndoRedoActionHandler`
  is the same function, so the engine's direct imports stay. A malformed stored history or settings
  value is ignored with a warning (it threw in the boot).
- **B3:** the tab host builds the heading's buttons and the sections in a `try`: a throw logs, leaves
  the heading and an error line (`.debuggerTabError`), skips `onOpen` and the interval, and keeps the
  tab mounted until another one is. A section refresh that throws logs once and stops the interval.
  The Overview takes its holds in `onOpen` and updates them in `onRefresh` only while open; the
  Objects tab takes them in `onOpen`.
- **B4:** `Profiler.ts` keeps the tabs created before the profiler loads (pending, in creation order,
  a replaced one keeping its place) and hands them over in `registerProfiler`; `removeProfilerTab`
  (public, documented; the entry export is Phase 3's) removes a pending tab or calls
  `_removeProfilerTab`, which rebuilds an open window.
- **B2 / B6:** the PostFX source's availability: `not rendered in this view` while an editor view is
  active, `PostFX off` (`isPostFxEnabled`), `no PostFX passes` (`getPostFxPasses()`), building
  nothing. Checked in the dev server (WebGL2, `topDownTestScene`, a Playwright script): a pass
  toggled off and on in the material editor isn't rebuilt there (it was before), and is by the
  Runtime view's render. The PostFX row reads "measuring…" in the Runtime view on SwiftShader before
  and after the change (older, not looked into).
- **F1, as built differently:** the title is updated in place, but the open tab is still rebuilt
  (`host.refresh(true)`) on a scene change: the cameras, lights, characters and Ray cast (K10) tabs
  build from the current scene's data and counted on the old whole-drawer rebuild. Only the drawer's
  chrome isn't rebuilt any more. **Confirmed 2026-10-21** (over making each tab refresh itself: that
  changes the tab contract for apps' tabs too, on panels p800 replaces); documented in Phase 4.
- **F3:** a changed section is rendered with the html string the comparison computed (a wrapper set
  as its `html` on its first change). Its build still computes it twice (creation, then the first
  comparison value).
- **F4:** written with `lsSetItem(key, object)` (the same stored text as before), read in a `try`, each
  field type-checked. `hydrateDebuggerTabState` ignores a malformed value too (it threw out of the
  registration).
- **D14:** app rows are `app:<sourceId>` entries in `overviewMetrics`, kept after the engine's
  (`sanitizeOverviewMetrics` partitions; `getOverviewMetricEntries` appends a source registered
  since, shown). The Overview renders them in a second `<tbody>` headed "App"; the Settings list
  shows them under an "App" heading, moving only within their group, an unregistered one labelled
  "(not registered)". A throwing `format` logs once per source and reads n/a.
- **Found by D11's loader test (fixed):** `loadDebugModuleAsync(…, true)` and `useDebug(ref, true)`
  loaded in any mode of a development build, not only prod test mode (every engine caller is gated
  by the boot, so nothing loaded wrongly; an app's ungated call would have).
- **Tests:** `UndoRedo.test.ts`, `Profiler.test.ts`, `_dbg__TabHost.test.ts` (the repros now `it`s),
  and new `GPUMemory.test.ts`, `DebuggerGUI.test.ts`, `DevFiles.test.ts`,
  `kernel/config/DebugModules.test.ts`, `_dbg__DebuggerGUI.test.ts` (F1, F2, F4, B3 in the drawer)
  and `profiler/_dbg__ProfilerOverview.test.ts` (D14). Each fails on the code before the fix.
  `yarn test`: 108 files, 864 passed, 1 skipped. `docs.json` recorded (debug 149 / 202).

As built, section 2 (2026-10-21, uncommitted on top of `cc94f9b`):

- **K1:** the camera window's delete is disabled, with a tooltip saying why, for the only camera,
  the active one and the main one (the debug camera's toggle returns to it), and re-checked on the
  click (the active camera can change while the window is open).
- **K2:** a `create*Helper` keeps the replaced helper's visibility (the "Show" setting when there
  is none); `toggle*Visibility` creates and then sets it.
- **K3:** the symbol's own materials are disposed on its entity's delete and on `DEBUG_SYMBOL`'s
  removal (the geometries are the templates'). **K4:** the symbols' and the light helpers'
  `TAG_IS_*` hooks registered once at their `_dbg__` module's load, not per world.
- **K5:** the About dialog's timer is cleared, and a pending copy's result dropped, when it closes.
- **K6:** F9 / F10 before the Debug tools tab exists write their value to its LS key, as the
  on-screen tools toggle did (`persistShortcutValue`, shared by the three).
- **K7:** `freezing` is reset once `whenProbeDone` has awaited it.
- **K8:** a failed LOD chain generation is logged and the window refreshed.
- **K9:** "Enable alpha (reloads)", not recorded to undo; its handler stays for older entries.
- **K10:** the Ray cast tab rebuilds itself (a microtask after the refresh that noticed) when the
  physics world comes or goes while it's mounted.
- **K11:** the boot overrides are compared by value (`haveBootOverridesChanged`).
- **K12:** the drawer also rebuilds when the selected material's stage settings come or go.
- **K13:** an undone or redone fov goes to the camera whenever the camera shows that material's
  pose (the previous material while another loads), before the selection check.
- **K14:** the textures the editor loaded during a visit are retagged to the current scene on its
  exit (`retagAssetOwner`).
- **K15 (in place; Phase 2 moves the file):** a scene exit hook (registered on the first spawn)
  removes and disposes the InstancedMesh and resets the counts; the instanced spawn stops at
  50,000 with a warning; `k` / `l` get the calling scene's id; the proximity system reads the
  latest target.
- **K16:** the light helper's initial visibility condition fixed; the `DISABLED` hooks reconcile
  only entities with a symbol or a light helper; the shadow map size rebuild is caught and logged,
  and re-checks the entity after its `import()`.
- **K17:** a wireframe build disposes every line it made unless it stored them (a rejected pose read
  included); the early return's own dispose loop went into the `finally`.
- **K18:** a rejected `shapeType()` shows "[Unavailable]".
- **K19:** the report goes to its listeners first; the stored runs are read and written in a `try`,
  and pruned to the newest 40.
- **Checked in the dev server** (WebGL2 on SwiftShader, `sceneTestECS`, a Playwright script): K1
  (the active camera's delete disabled, tooltip shown), K2 (a hidden grid stays hidden on a size
  change), K3 (a deleted light's two symbol materials disposed), K4 (the `TAG_IS_LIGHT` hook count
  unchanged by a new world), K5 (the dialog closed during a copy, no error), K15 (the mesh gone and
  the count 0 after a switch to `physicsTest`, the overfill stopped at 50,000), then all 15 drawer
  tabs opened in turn (none failed to build) and the material editor entered and left, with no
  console errors. K6-K14 and K16-K19 by reading the code path only: they need a state a script
  can't easily make (a key before the tab, a rejected generation or worker reply, an HMR scene load,
  a full LS).

### Phase 2: structure (D5, D7) — done

1. The two wrappers merged; the production check and `yarn sbp` against Phase 0's numbers.
2. S2's renames, S3's move with the thin wrapper (D7 as revised), S4's buttons; `moveMap.ts`
   regenerated.

As built, section 1 (2026-10-21, committed as `4b7e32c`):

- **`debug/Assets.ts` → `kernel/assets/AssetsAPI.ts`:** `createAssetsDebugGUI` at the file's end
  under `// Debug`, `@internal`; `Boot.ts` imports it with `initAssets`.
- **`debug/PostFXProfiler.ts` → `features/postfx/PostFX.ts`:** its four functions after
  `createPostFXDebugGUI`, each `@internal`, the two loads shared by a module-private
  `loadPostFxProfilerAsync`. `PostFXFeature.ts`, `_dbg__PostFX.ts` and `_dbg__ProfilerSources.ts`
  import them from `PostFX.ts`; the gated `ctx.onDebugAfterStart` closure is unchanged.
  `Config.ts`' `postFx.measureEnabled` says the PostFX tab and the profiler switch it live.
- **Checks:** `yarn verify:baselines`: no debug code in the production build or the banner,
  `bundle.json` and `bundle.banner.json` unchanged (186 modules, 832.0 kB gzip; 670.3 kB).
  `api.json` lists the five moves and Phase 1's three additions (`removeProfilerTab`,
  `_getUndoRedoActionHandler`, `RegisteredUndoRedoActionHandler`), recorded in Phase 3 with the
  rest. `docs.json`: `debug` 149 / 202 → 144 / 197, `features/postfx` 29 / 29,
  `kernel/assets` 127 / 127. `yarn sbp --profile all`: Phase 0's numbers exactly (the app's
  initial 379.2 kB, `kernel/assets` 18.2 / 8.7 kB, `features/postfx` 2.0 kB; the banner's
  285.5 kB), every budget within.

As built, section 2 (2026-10-21, uncommitted on top of `4b7e32c`; the renames staged, since
`moveMap.ts` reads the tracked tree):

- **S2:** `debug/SceneHelpers.ts` → `debug/_dbg__SceneHelpers.ts`, `debug/PercentagePieHtml.ts` →
  `debug/_dbg__PercentagePie.ts` (`PercentagePie.scss` keeps its name; its header comment and p622's
  line follow the rename). Their importers (`_dbg__DebugTools.ts`, `_dbg__Raycast.ts`) renamed.
  Their 10 exports leave TypeDoc and `api.json` with them (D6's removal of `PercentagePieHtml` and
  `PercentagePieOpts.size` is still Phase 3's).
- **S3:** the implementation is `kernel/ecs/debug/_dbg__ECSStressTest.ts` (spawn, reset, count,
  the systems, `_initECSStressTest(batchSize, targetId, sceneId)`, `@internal`); the ECS tab imports
  it directly. `kernel/ecs/ECSStressTest.ts` is the thin wrapper `aekasha` exports:
  `initECSStressTest` (same signature, still returns `void`) returns at once outside the debug env
  (so a production build folds it), resolves the calling scene's id, loads the module through
  `loadDebugModuleAsync` and binds the keys only while that scene is still loading or current. A
  failed load is the loader's log (the wrapper's `.catch` only stops the rejection). The JSDoc's
  `@remarks` says the keys come a moment after the call. `ECSRegistry.ts`' and
  `ECSCoreComponents.ts`' comments name the new file. The `kernel/ecs/debug` docs folder is gone
  (`docs.json`); `kernel/ecs` is 82 / 82. No app change.
- **The toolkit:** `ScatterOnSurface.ts`' `bakeScatterToInstancedMesh` JSDoc pointed at the stress
  test's old path; it points at the instancing feature's `createInstancedMeshPool` now (the public
  pattern for per-instance ECS state). A toolkit patch (D2).
- **S4:** the five test buttons and their TODO gone from the Debug tools tab's Logging folder, with
  the `openDraggableWindow`, `openDialog` and `addToast` imports only they used.
- **`moveMap.ts`:** regenerated, `--check` clean. Its diff also carries what earlier work left
  unregenerated (p617's `ui/CLAUDE.md` and entry counts, Phase 1's tests): 811 files mapped, 35
  boundary violations, 0 feature cycles.
- **Checks:** `tsc` (both), the lint and `yarn test` (108 files, 864 passed, 1 skipped).
  `yarn verify:baselines`: no debug code in the production build or the banner, both bundles
  unchanged (186 modules, 832.0 kB gzip; 670.3 kB). `api.json` (not recorded, Phase 3): section 1's
  eight, `initECSStressTest`'s move, and the 13 exports of the renamed and moved `_dbg__` modules
  removed. `docs.json` recorded: `debug` 141 / 187 (the 46 left are D10's, Phase 4),
  `features/postfx` 29 / 29, `kernel/assets` 127 / 127. `yarn sbp --profile all`: Phase 0's numbers
  (379.2 kB, 285.5 kB). In the dev server (debug env, WebGL2 on SwiftShader, `sceneTestECS`, a
  Playwright script): `k` and `l` spawn 100 each; in `physicsTest` `k` spawns nothing; back in
  `sceneTestECS` the keys are bound again and the count starts over; all 15 drawer tabs build, none
  of S4's buttons is left, no console errors.

### Phase 3: the API (D6, D9) and the deferrals (D3) — done

1. The entry's additions, the `@internal`s, the removals, P5's moves; `saveTexture` with its
   warning and a test.
2. p622's list; `api.json` (`yarn verify:baselines --update`) with the additions and removals.

As built, section 1 (2026-10-21, committed as `cf071c3`):

- **The entry (D6):** P1's list and P9's (`removeProfilerTab`, `GPU_MEMORY_TAB_ID`,
  `GPUMemoryResource`) on `aekasha/debug`, 26 names. Three more, each named by a public signature
  and on no entry: `DebugKeyBindingConfig` (`AppConfig.debugKeys`), `DevFilesSaveData`
  (`DevFileWrite`) and `DevFilesUnavailableReason` (`DevFilesStatus`).
- **`@internal`:** every other export of the thin modules, `debug/symbols/3DSymbols.ts` and
  `DebugModules.ts`' `loadDebugModule` and `useDebug` (an app reads the `current` of the ref
  `loadDebugModuleAsync` resolved with), 101 names (P5's four besides), each summary naming its user (a script added
  the tag and the sentence; the run-on sentences it made fixed by hand).
- **Removed:** D6's list (`isDebugReady`; `PercentagePieHtml` and `PercentagePieOpts.size` from
  `_dbg__PercentagePie.ts`; `getStatsConfig` with `_getStatsConfig`; the two deprecated
  `StatsOptions` flags, from `defaultStatsOptions` and `_dbg__Stats.ts` too;
  `TEST_BRIDGE_QUERY_PARAM`'s export). By the same rule (on no entry, no caller), four wrappers
  the P4 list missed, with their unused `_dbg__` sides: `createDebugGui`, `getDrawerState` (and
  `_getDrawerState`), `isDebuggerDisabled` (and `_isDebuggerDisabled`), `handleDebugCameraSwitch`
  (and `_handleDebugCameraSwitch`, a `@CHORE` stub). `isProfilerEnabledInProdTest` is no longer
  exported (only `Profiler.ts` reads it).
- **P5:** `PhysicsProbeReport` in `features/physics/PhysicsProbeTypes.ts` (`@internal`, its fields
  documented); `_dbg__PhysicsDeterminism.ts`, `_dbg__TestBridge.ts` and `TestBridge.ts` import it
  from there. `DebugKeyShortcutsTab` in `DebugTools.ts`, `EnvBallOpts` in `EnvBall.ts` (fields
  documented), both `@internal`, their `_dbg__` modules importing them back. `AnyStatsSource`
  exported `@internal`. `DrawerState` stays module-private: with `getDrawerState` gone nothing
  public names it.
- **`saveTexture` (D9):** on `aekasha`, documented like `saveMaterial`, with an `@example` (a
  `DataTexture`). It warns in the debug env when the id holds another texture. The registration is
  a module-private `registerTexture`, which `saveLoadedTexture` calls directly: two parallel loads of
  one id are expected there (the second is disposed), so they don't warn. The other engine callers
  can't hit a taken id (the impostor bakes delete first, `loadTexture` returns the cached one, the
  glTF import picks a free id). `kernel/assets/Texture.test.ts`: the registration, the warning (not
  for the same texture), and the quiet parallel load.
- **Checks:** `tsc` (both), `yarn lint`, `yarn test` (109 files, 867 passed, 1 skipped).
  `yarn verify:baselines`: no debug code in the production build or the banner, both bundles
  unchanged (`assets/EngineRapier.js` and `#2` swap 0.2 kB, their names' order, not this change).
  `api.json` (not recorded, section 2): Phase 2's 22 and this section's (the 29 entry names,
  `saveTexture`, the removals, P5's moves). `docs.json` recorded: `debug` 166 / 183,
  `debug/symbols` 5 / 5, `features/physics` 204 / 204, `kernel/config` 23 / 23. `moveMap.ts`
  regenerated (813 files).
- **Found in section 2:** `PercentagePieOpts.size` was still there (the removal's replace didn't
  match and nothing checked it); removed in section 2, the other removals checked by `grep`.

As built, section 2 (2026-10-21, uncommitted on top of `cf071c3`):

- **D3's deprecations:** each name with a summary and a `@deprecated` saying who uses it, that it
  leaves `aekasha/debug` in engine 6.0.0 (`@internal` then) and that there is no replacement: the
  dev files protocol's eight (`DevFilesProtocol.ts`; only the client and the dev server use them,
  the server by path), and the three test bridge result types (`TestBridge.ts`; only the bridge and
  the scene runner). On the declarations, as `CoreComponentType` did: no lint rule flags a
  deprecated use, so `devTools/`' path imports are unaffected. `DebugGUIOpts` documented and
  `@deprecated` (removed with `createDebuggerTab`'s second parameter, the button stays in the
  middle, CSS moves it), the parameter's `@param` saying so. The protocol file's text names the
  client functions in code spans, not `{@link}`s (it imports nothing, so TypeDoc couldn't resolve
  them).
- **p622:** a "From p618 (its D3)" block: the eleven names, `DebugGUIOpts` with the parameter, and
  P7's Tweakpane fields as p800's break (not deprecated; p800's own minor deprecates them if it
  lands first). The 6.0.0 list names the three files; "The deprecations without a version" now
  says none is left. p618 is in its Related line.
- **Baselines recorded:** `api.json` (2,512 exports in 322 modules, 838 on 16 entries: Phases 1-3's
  additions, moves and removals) and `docs.json` (`debug` 171 / 183). `bundle.json` and
  `bundle.banner.json` not recorded by `--update` (gzip shifts of a few bytes with new content
  hashes); only `assets/EngineRapier.js` and `#2`, which traded names in two builds in a row (the
  same two chunks, 36,634 and 35,913 bytes), swapped by hand. `yarn verify:baselines --no-build`
  exits 0: no debug code in the production build or the banner, the main chunk 186 modules at
  832.0 kB gzip, the banner's 670.3 kB. `moveMap.ts` regenerated (the documented counts changed),
  `--check` clean.
- **Checks:** `tsc` (both), `yarn lint`, `yarn test` (109 files, 867 passed, 1 skipped).

### Phase 4: docs and hygiene (D8, D10) — done

1. D10's docs, P6's stale text. `DebuggerTabDef` (`content`, `onRefresh`) and `debug/CLAUDE.md` say
   the open tab is rebuilt on a scene change (F1 as built) and the other tabs are built fresh on
   their next mount.
2. H1, H2, Z1's headers.

As built, section 1 (2026-10-21, uncommitted on top of `6390367`):

- **Coverage:** `debug` 183 / 183 exports and 3 / 3 members (`DevFilesError`'s `code`, `details`
  and constructor), recorded in `docs.json`. The type aliases' fields D10 names documented:
  `DebuggerListItem`, `DebuggerListToggle`, `DebuggerListDef`, every pane item
  (`DebuggerPaneBinding`, `…Folder`, `…Button`, `…Separator`, `…Custom`, `…Section`),
  `DebugToolsState`, `StatsSource`, `GPUMemorySource`, `UndoRedoEntry`, `UndoRedoActionHandler`,
  `DevFilesStatus`, `DevFileRead`, `DevFilesStatusBody`, `DevFilesSaveData`, `DevFilesCommitBody`
  (`ProfilerSettings` and `DebuggerTabDef` already were). `@template` on every generic type.
- **Tag style:** every old `@param name (type) text` and `@returns (type)` in the thin modules and
  `DebugModules.ts` rewritten or dropped (a tag that only repeated its name went, as the lint's
  `informative-docs` asks).
- **`@example`s** (each type-checked by `yarn test`): `createDebuggerTab`, `debuggerListCMP`,
  `addDebugToast`, `createProfilerTab`, `registerStatsSource`, `markDebugHelper`,
  `registerGPUMemorySource`, `registerUndoRedoActionHandler` (with
  `recordOrCoalesceUndoRedoAction` and `updateDebuggerTab`; `recordOrCoalesceUndoRedoAction`
  points at it), `writeDevFiles` (with `onDevDataGathered` and `DevFilesError`),
  `loadDebugModuleAsync`.
- **`@remarks`:** when each registration works. `createDebuggerTab` (found here, not fixed: B1's
  pattern) drops a tab created before the drawer loads, i.e. in a feature's `install`; the
  remark says to create it in `onDebug`, `start` or scene code. `registerUndoRedoActionHandler`
  works at any time, and undo stops at an entry without a handler (F5). `createProfilerTab`,
  `registerStatsSource` and `registerGPUMemorySource` are gated on `isProfilerLoadedInThisMode`.
  P7's Tweakpane fields on `DebuggerPaneBinding` and `DebuggerPaneCustom`. `updateDebuggerTab`
  is a no-op on a hidden tab. `loadDebugModuleAsync` says when a plain
  `if (IS_DEBUG_ENV) await import()` does the same (L2).
- **F1 as built:** `DebuggerTabDef.content` says the open tab is rebuilt on every scene change and
  a closed one is built fresh on its next mount; `content` and `onRefresh` say a throw shows an
  error line (B3). `debug/CLAUDE.md` says the same (the drawer's title updated in place, the drawer
  rebuilt only when a tab comes or goes) and `isDebuggerTabOpen`'s editor view case.
- **P6:** the stale text was already gone (`registerUndoRedoActionHandler`'s "at module load time"
  went with B1, `Config.ts`' `postFx` doc with Phase 2); `PostFXTypes.ts`' two "see
  getPostFxPassStats()" now say who reads them. Phase 0's doc drift: `debug/CLAUDE.md`'s "all three
  loops" (one `runFrame`); `_dbg__GPUTimer.ts`' release comment, which claimed a check the code
  doesn't make, now says what it does (the state before the first hold comes back, so a GPU panel
  switched on while held goes off with it). `Object3DHelpers.ts`' "`markDebugHelper` is on
  `aekasha/debug`" became true in Phase 3.
- **Checks:** `tsc` (both), `yarn lint`, `yarn test` (109 files, 867 passed, 1 skipped; the new
  examples among them). `yarn hub:build`: 434 pages; Phase 0's five `notExported` warnings are
  gone (the search index size warning is p619's). **Corrected in Phase 5 §3:** one warning in
  scope was missed (the log was filtered for words the warning lines don't contain):
  `openProfilerTab`'s `{@link GPU_MEMORY_TAB_ID}`, which `Profiler.ts` can't resolve. `moveMap.ts --check`
  clean.
- **Open (asked 2026-10-21):** `createDebuggerTab`'s drop before the drawer loads: a Phase 5 fix
  (pending tabs, as `createProfilerTab` keeps them) or an issue file. **Answered 2026-10-21: fixed
  in Phase 5** (its section 1).

As built, section 2 (2026-10-21, uncommitted on top of section 1):

- **H1:** the six `any` casts gone. `DEBUG_LIGHT_HELPER`'s helpers all have `update()` and
  `CameraHelper` has `dispose()` (on `Object3D` in three's types), so the light GUI's two
  position handlers and the camera helper's delete hook call them directly. `attachLightHelpers`
  takes a `THREE.Light` and narrows it itself: the helper and its shadow camera per light class
  (the old `'castShadow' in light` was true for any `Object3D`; the same three classes get a
  shadow camera helper as before). The probe's two `console.table`s got their reason.
- **H2:** `_dbg__Stats.ts`' TODO dropped as obsolete (the scene's object, triangle and vertex
  figures are the profiler's Objects tab and census, the imports the Assets tab).
  `_disableDebugger`'s is real (the on-screen tools stay clickable during a load; plausible
  effects: an undo mid-load, an editor view entered mid-load): filed as
  `docs/issues/on-screen-tools-during-scene-load.md`, the TODO naming it. Phase 5's "issue files
  (H2)" is done with it.
- **Z1 / Z3 headers:** a header line on each debug file over 800 lines or with a function over
  150, naming the function. The panels (`_dbg__Assets.ts`, `_dbg__PhysicsAPI.ts`,
  `_dbg__RayTester.ts`, `_dbg__LightGUI.ts`, `_dbg__DebugTools.ts`, `_dbg__SpatialGrid.ts`,
  `_dbg__CameraGUI.ts`, `_dbg__LOD.ts`): "a Tweakpane panel, which p800 replaces, so it isn't
  split (p618 D8)"; `_dbg__CharacterStateWindow.ts` the same as "debugger UI (HTML through CMP)",
  `_dbg__MaterialEditor.ts` as "an editor view's UI". The two that draw rather than show UI,
  `_dbg__PhysicsDebugDraw.ts` and `_dbg__CharacterGizmos.ts`, say what they hold and that p618
  reviewed them for correctness only (D1), to be split when next reworked: p800 doesn't replace
  them.
- **Z3 splits (the framework's):** `registerBuiltInStatsSources` (215 lines) into five group
  functions in the same registration order (frame, physics, memory, render, page);
  `createEditorDrawer` (189) with its elements (`createDrawerElements`) and its menu
  (`buildTabMenu`) moved out; and `createTabHost`, which B3's `try` had grown from 149 to 198, with
  its build helpers (`runOnRefresh`, `addCmpSectionRefresher`, `buildSections`,
  `buildTabContent`) moved to module level (they read only the host's `label`, now a parameter).
  No function in the framework is over 150 lines now; the code is moved, not changed. Not checked in
  the dev server: the tab host's and the drawer's tests cover the host, and Phase 6's scene run and
  drawer pass cover the rest.
- **Checks:** `tsc` (both), `yarn lint`, `yarn test` (109 files, 867 passed, 1 skipped).
  `yarn verify:baselines`: all unchanged, no debug code in the production build or the banner.
  `docs.json` unchanged, `moveMap.ts --check` clean.

### Phase 5: the Hub, `CLAUDE.md`, readme, and what's filed — done

1. D12's page (and the example, if chosen), `debug/CLAUDE.md`, the root's references.
2. The issue files (H2), p800's prompt (P7), `readme.md` if its debug line changes.
3. `yarn hub:build`.

As built, section 1 (2026-10-21, committed as `ce9d693`):

- **`createDebuggerTab` before the drawer loads (Phase 4's open item, fixed):** `DebuggerGUI.ts`
  keeps the tabs created before `registerDebuggerGUI` (pending, in creation order, a replaced one
  keeping its place, with its deprecated `opts`) and hands them over when the drawer loads, as
  `createProfilerTab` does; `removeDebuggerTab` drops a pending one. Both gated on `__AEK_DEBUG__`
  (folded in production). The JSDoc says it works at any time (the `install` remark gone).
  `DebuggerGUI.test.ts`: the early, replaced and removed tabs, and the hand-over after the load
  (fails on the code before the fix).
- **The example (D12, as recommended):** `_dbg__exampleDebugTab.ts` gets two more Hub regions.
  `debug-tab-undo`: one action type (`exampleBoxes.setting`, `'perScene'`) for both settings,
  recorded with `recordOrCoalesceUndoRedoAction` from each binding's `onChange` (key `count` or
  `color`), its handler applying the value, `persistDebuggerTabValue` and `updateDebuggerTab`.
  `debug-tab-profiler`: a stats source (`exampleBoxes.count`, `format` "N boxes"), removed on the
  scene's exit by a self-removing `registerOnAllSceneExits` hook (the scene's own
  `registerOnSceneExit` slot is left to the scene file). Both registered in `createBoxesTab`, so
  on every visit. The scene file is unchanged, and so is the scene's look (no new Hub image). An
  app patch (D2). Checked in the dev server (debug env, WebGL2 on SwiftShader, a Playwright
  script): typed changes to both fields record one entry each; two undos put back the colour and
  the count (the scene, the saved LS value and the tab's field), a redo reapplies; the Overview
  shows "Example boxes · 30 boxes" under App; the source is gone in `physicsTest` and back on the
  return; no console errors.
- **The Debug suite page (D12):** "Write your own tab" as a how-to (loading in debug builds: the
  plain `import()` or `loadDebugModuleAsync` for prod test mode (L2); a tab; state and
  persistence; refresh, with F1 as built; lists; scene tabs; toasts; P7's Tweakpane note), the
  profiler with its mode gate, your own figures (D14), profiler tabs, GPU memory sources and
  `markDebugHelper`; undo / redo with coalescing, scopes, the handler's save and refresh, and F5's
  stop; the dev file server with `readDevFile`'s hash, `DevFilesError`, `saveData` and
  `onDevDataGathered`. Key APIs regrouped with Phase 3's names. The intro's scene caption, the
  example page's intro, metas and walkthrough (two new sections, Undo and A figure in the
  profiler) follow the example.
- **`debug/CLAUDE.md`:** four new bullets (the entry's shape and deprecations, the "registrations
  work at any time" rule (B1, B4, this section's fix), the loader and which one an app uses,
  placement: the merged wrappers, the `_dbg__` renames, the stress test, the size headers) and one
  for undo / redo (buckets, coalescing, F5, the settings, the direct imports); the stats source
  bullet says an app's get "App" rows (D14), the drawer tab bullet "at any time". The root
  `CLAUDE.md` names none of the moved files: unchanged.
- **Checks:** `tsc` (both), the lint, `yarn test` (109 files, 869 passed, 1 skipped),
  `yarn hub:build` (435 pages; it missed Phase 4's link warning, see section 3).

As built, section 2 (2026-10-21, committed as `5901201`):

- **The issue files (H2):** nothing left; Phase 4 filed `docs/issues/on-screen-tools-during-scene-load.md`.
- **p800's prompt (`docs/templates/todo-plan-prompts.txt`):** a "(Added by p618, 2026-10-21.)"
  paragraph after p617's: the Debug suite page's "Write your own tab" and the debug tab example
  are the guide the prompt asks for, which p800 rewrites for its components; P7's Tweakpane fields
  (the binding's passed-through params, `onCreate`'s and `onChange`'s `BindingApi`, `custom`'s
  `Pane | FolderApi`), to be replaced by its components' binding options and deprecated in its own
  minor or changed with p622's major, the rest of `DebuggerTabDef` kept working; the tab contract
  as p618 left it (F1 as built, B3, the any-time registrations), a self-refreshing tab being p800's
  choice; the panels with their size headers (D1, D8) and the on-screen tools issue file to close.
- **`readme.md`:** the debug drawer bullet gets one sentence: an app adds its own tabs, profiler
  figures and tabs, GPU memory sources and undoable actions through `aekasha/debug` (D14 made the
  figures real), with the Debug suite page and the example. Nothing else in its debug lines
  changed.

As built, section 3 (2026-10-21, uncommitted on top of `5901201`):

- **`yarn hub:build`:** 435 pages. One warning in scope, from Phase 4 section 1 (`8a32410`) and
  missed by its check and section 1's: `Profiler.ts`' `openProfilerTab` had
  `{@link GPU_MEMORY_TAB_ID}`, which TypeDoc can't resolve there (`GPUMemory.ts` imports
  `Profiler.ts`, not the other way). Now a code span (the Hub page links the constant). Rebuilt:
  no warning in scope. The four left are outside it and older than the branch:
  `CharacterBrainKinds` (`features/character/ActorTypes.ts`), `ComponentDataMap`
  (`kernel/ecs/ECSCoreComponents.ts`; the branch changed only two comment paths there),
  `UnionToIntersection` (`schemas/FeatureSchemas.ts`) not in the docs, and `SeededRandom.ts`'
  `{@link getRandomStream}`; plus p619's search index size. Phase 6's `yarn hub:build` reads the
  `⚠` lines, not a word filter.
- **Checks:** `tsc`, the lint on `Profiler.ts`.

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
