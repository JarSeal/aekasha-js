Status: implemented (Phases 0-8)
Category: Refactoring, Documentation, ECS
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p607_sbp-foundation-feature-modules.md (D6's type-only seams, the install contract and the loop seams this plan reviews: "From p607" below), \_DONE_p200_component-query-caching.md (its main-camera cache landed here, Phase 2), \_DONE_p604_multiplayer-viability-study.md (§4.4: the `appId` map), \_DONE_p606_layering-inversion-and-public-entry.md (the env flag pairs, `APP_CONFIG`, `CoreComponentType`: left to this plan), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (the embed's seams in init and the loop), \_DONE_p613_review-rendering-scene-assets.md (owns `Camera.ts` and the other 13 type-only seams)

# Review: ECS, Main Loop, Config and Init

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope,
records the findings per file group in an "As found" list, and fixes them or files them. It also
lands p200's main-camera cache, p604's `appId` map, and the choices p606, p607 and p611 left here.

## 1. As found (2026-10-14, branch `review-ecs-loop-config-init` at `40063d1`, = `main` after p611's merge)

### 1.1 The stub's paths moved

The stub was written before p608's move. Its names map to:

| Stub                                   | Now                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/ECS.ts`, `core/ECS/*`            | `kernel/ecs/` (`ECS.ts` 933 lines, `ECSCoreComponents.ts`, `ECSCoreSystems.ts`, `ECSHelpers.ts`, `ECSRegistry.ts`, `ECSComponentStorage.ts`, `TypedArrayTransformStore.ts`, `LodTargets.ts`, `SpatialMembership.ts`, `ObjectFrustumCullingSystem.ts`, `debug/ECSStressTest.ts`) |
| `MainLoop.ts`, the stages              | `kernel/loop/` (`MainLoop.ts` 808 lines, `SystemStages.ts`, `Workers.ts`)                                                                                                    |
| `Config.ts`                            | `kernel/config/` (`Config.ts` 701 lines, `DebugModules.ts`)                                                                                                                 |
| `InitApp.ts`                           | `kernel/init/` (`InitEngine.ts`, `Boot.ts`, `Features.ts`, `Kernel.ts`, `Mount.ts`)                                                                                         |
| `ViewManager.ts`                       | `kernel/render/Views.ts`                                                                                                                                                    |
| `CameraManager.ts` (p200)              | `kernel/camera/Camera.ts` (p613's file: this plan changes only the main-camera lookups)                                                                                     |
| "the culling systems"                  | `kernel/ecs/ObjectFrustumCullingSystem.ts` (in scope); light culling moved to `features/spatial/` (p616's)                                                                  |

Not in scope: `kernel/*/debug/_dbg__*` (p618 reviews the debug modules), and the files the other
Stage C plans own.

### 1.2 The stub's inputs that changed

- **`AppComponentData` no longer exists** (p606 replaced it with `ComponentDataMap` augmentation),
  and `ECSSystemStage` is on the `aekasha` entry now. Phase 0 runs `yarn hub:build` to see whether
  any `notExported` warning is left in scope (it found two others: Phase 0's As built).
- **The type-only seams:** 22 in the layout report, 9 of them in this plan's files
  (`ECSCoreComponents.ts` 6, `ECS.ts` 1, `LodTargets.ts` 1, `Config.ts` 1). The other 13 are in
  p613's files (assets, import, mesh, scene). D2 decides the rule for all of them.
- **The env flags are internal.** The entry exports only `IS_DEBUG_ENV` and `AppConfig` from
  `Config.ts`, so the duplicate pairs p606 left (D3) can be removed without a deprecation.

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder             | Exports undocumented | Members undocumented |
| ------------------ | -------------------: | -------------------: |
| `kernel/ecs`       |              33 of 78 |            112 of 158 |
| `kernel/ecs/debug` |                3 of 6 |                    — |
| `kernel/loop`      |              12 of 48 |                    — |
| `kernel/config`    |               3 of 32 |                 1 of 1 |
| `kernel/init`      |               0 of 18 |                    — |
| `Views.ts`         |                     0 |                    — |

The 112 members are mostly `ECSWorld`'s (the class is on the entry) and
`TypedArrayTransformStore`'s. `ECSHelpers.ts`' 13 entry functions have no JSDoc at all.

### 1.4 Findings by file group

Numbered for the phases to reference. **(bug)** marks wrong behaviour, **(SBP)** bytes,
**(perf)** per-frame cost; the rest are hygiene, placement and API shape.

**ECS (`ECS.ts`, `ECSHelpers.ts`, storage)**

- E1 **(bug)** `ECSWorld.clearWorld()` (public, no caller): clears storages without running any
  hook (leaks Object3Ds, bodies, lines), resets `nextEntityId` to 0 (the constructor starts at 1,
  so entity 0 appears, which `if (entityId)` checks treat as none), and keeps `generations`, so a
  stale id from before the clear becomes alive again.
- E2 **(bug)** `getEntitiesWith(type)` reads `this.storages.get(type)!`: a type nothing has added
  yet (an app or toolkit key) throws a `TypeError`. `getStorage` creates the empty storage instead.
- E3 `getEntityIdByAppId` scans every `APP_ID` (p604 §4.4). About 40 callers (scene code, Mesh,
  Light, Camera, Group, Scene, SpawnImported, the debug GUIs). Duplicate app ids aren't detected:
  the first entity created wins.
- E4 `storages: Map<ComponentType, IComponentStorage<any>>`: the one `any` (with its
  `eslint-disable`).
- E5 Physics in the kernel's ECS: `setTransform`, `setVelocity`, `setDisabled`, `getRigidBody`,
  `isEntityDynamic`, `_getWritableBody` and `_hasDynamicBody` drive `RigidBodyAPI`s and read
  `PHYSICS_SIM_TIER` (the type import is one of D2's seams; the behaviour works through component
  data, not an import). Public members of `ECSWorld`: kept, see D2.
- E6 Dead and stale text: `GEN_SHIFT`'s `@CONSIDER`, the commented-out sound code in
  `setDisabled`, comments naming `ECS/TypedArrayTransformStore.ts`, `PhysicsManager`.
- E7 `removeComponent` runs the remove hooks even when the entity doesn't have the component.
- E8 API shape: `registerECSModule` (a debug loader, named like a registration);
  `getEntityDiagnosticData` / `inspectEntity` read only the default world; `createRawEntity` is
  undocumented and a raw entity has no `APP_ID` or `TRANSFORM`.

**Components and registry (`ECSCoreComponents.ts`, `ECSRegistry.ts`)**

- C1 `ComponentType` and `CoreComponentType` are the same object (p606 left the choice here):
  `CoreComponentType` is used by 7 engine files, the toolkit (`FollowTool`, `HoverEffect`,
  `SunShadowFit`) and 2 app scenes.
- C2 72 lines of commented-out `createPhysicsEntity` (`@CHORE`s), `OBJECT3D_TAGS`' comment "This
  just makes shit faster..." and its `@QUESTION` / "From GEMINI" note.
- C3 Stale paths in comments: `Lod/LodSystem.ts`, `Spatial/SpatialIndexSystem.ts`,
  `ECS/LightObjectCullingSystem.ts`, `LineManager`, `Debug/_dbg__PhysicsDebugDraw.ts`.
- C4 Feature component keys in the kernel's enum (physics' four, the tiers, characters, LOD,
  spatial, instancing) and two debug keys for the stress test (`DEBUG_STRESS_TEST_*`). D2.

**Core systems and culling (`ECSCoreSystems.ts`, `ObjectFrustumCullingSystem.ts`)**

- S1 **(bug, edge)** The `DISABLED` hook disables the entity's `TARGET_LINK` target, and that
  target's hook its own: two entities that target each other recurse until the stack overflows
  (`addComponent` doesn't check whether the component is already there).
- S2 Two `@TODO: for physics, you need to take these into account as well` in the `DISABLED`
  hooks: `setDisabled` already handles the body, so these are stale.
- S3 **(perf)** `objectFrustumCullingSystem` calls `getMainCamera()` every frame, which builds an
  iterator over `TAG_IS_MAIN_CAMERA` (p200 §2.4). `LightObjectCullingSystem`, `LodSystem` and
  `PlayerBrains` call it too, so the cache helps all of them.
- S4 Stale comments: `LightManager.ts`, `LightObjectCullingSystem.ts`, `SpatialIndexSystem.ts`.
- S5 `MAX_SPOT_ANGLE`, `getMeshWorldBoundingSphere` and `objectFrustumCullingSystem` are exported
  without JSDoc; the first two are shared with spatial (p616's), the system only with the kernel.

**The loop (`MainLoop.ts`, `SystemStages.ts`, `Workers.ts`)**

- L1 **(bug)** The production loop with the max FPS limiter (`VITE_MAX_FPS`) returns early on a
  skipped frame **after physics but before the app stages** (`APP_POST_PHYSICS`, `APP_LOGIC`,
  `APP_RENDER_SYNC`, the app loopers, `LATE_MAIN`), so those lose the skipped frames' time, and the
  `TRANSFORM` sync lags. The debug loop runs every stage and skips only the render. D10.
- L2 **(bug, race)** `initMainLoop` starts the loop with `setTimeout(… requestAnimationFrame, 100)`
  when `masterPlay` is on. A `toggleMainPlay(true)` inside those 100 ms (`isMasterPlaying` is
  still false) requests a frame too, so two `requestAnimationFrame` chains run from then on, each
  frame twice.
- L3 **(perf)** The three loop functions are `async` with no `await`: each frame allocates a
  promise. `getAllECSWorlds()` is `Array.from(worldsById.values())`: 4 arrays per frame, plus one
  per fixed sub-step.
- L4 Three copies of the frame (`mainLoopForDebug`, `mainLoopForProduction`,
  `mainLoopForProductionWithFPSLimiter`) differ in a few branches. The production bundle already
  folds the debug one (checked: no view or stats code in `dist/`). D10.
- L5 API shape: `export let mainLoop` (a mutable export, undocumented); the listener sets
  `add*Fn(id, fn)` / `delete*Fn(id)` / `deleteAll*Fns()` (`deleteAddOnWindowBlurFn` is a typo),
  not `on*` returning the remover (internal: the callers are `PhysicsAPI.ts` and the three input
  devices); `getReadOnlyLoopState` copies through JSON; `setPlaySpeedMultiplier` undocumented.
- L6 Stale comments: `ViewManager.ts` (twice), `InitApp`.
- L7 `Workers.ts`' `initWorker` takes four positional parameters plus a string-or-options fifth
  (the standard: an options object past two parameters).

**Config (`Config.ts`, `DebugModules.ts`)**

- K1 **(bug)** `APP_CONFIG` is captured at module load, and `loadConfig` replaces `config` with a
  new object, so `APP_CONFIG` is always the defaults. Nothing reads it (p606 noted it).
- K2 **(bug, latent)** Two sets of physics defaults that disagree: `Config.ts`' (`workerTarget:
  'WORKER_THREAD'`, gravity 0) and `PhysicsAPI.ts`' `physicsState` (`'MAIN_THREAD'`, gravity
  −9.81). `loadConfig` merges per top-level key, so an app that passes a `physics` section without
  `workerTarget` gets `MAIN_THREAD`, while CLAUDE.md and `AppConfig` say the default is
  `WORKER_THREAD`. The template passes both, so nothing shows today. `assets` has the same
  duplication (equal values), and the debug-only defaults (`debugCamera`, `debugDrawer`'s tab list,
  `undoRedo`, `devFiles`) ship in production (**SBP**, ~0.3 kB). D4.
- K3 The six `@TODO: Replace … with this` pairs: `isDebugEnvironment()` / `IS_DEBUG_ENV`,
  `isProdTestMode()` / `IS_PROD_TEST_MODE` / `IS_PROD_TEST_ENV`, `isProductionEnvironment()` /
  `IS_PROD_ENV`, `getCurrentEnvironment()` / `CUR_ENV`, `getConfig()` / `APP_CONFIG`. D3.
- K4 `AppConfig` has no summary, and `physics`' fields `enabled`, `physicsEngine`, `workerTarget`,
  `worldStepEnabled`, `visualizerEnabled`, `gravity`, `timestep`, `backgroundBehavior`,
  `solverIterations` and `internalPgsIterations` have no doc. `Environments` (with `unitTest`) and
  `DebugPhysicsWireframeConfig` have none either. Stale paths: `PhysicsManager`, `Lod/LodSystem.ts`,
  `Debug/_dbg__PhysicsDebugDraw.ts`.
- K5 `DebugModules.ts`: `loadDebugModule` (sync) and `isDebugReady` — check for callers; the
  `DebugModuleRef` member is undocumented.

**Init (`Boot.ts`, `Features.ts`, `InitEngine.ts`, `Kernel.ts`, `Mount.ts`)**

- I1 **(SBP, not measured)** The features' `ctx.onDebug*` closures stay in a production bundle
  (p607 Phase 7); only `postFx()`'s call is gated with `if (IS_DEBUG_ENV)`. D9.
- I2 `bootEngineAsync` is about 145 lines (the limit is 150) and its debug block grows with every
  tool. Cameras, lights and input still register in the boot, not in `installKernel` (p607's
  note).
- I3 **(bug, silent)** The loop starts only `if (rootScene.children.length)`: an app whose `start`
  adds nothing to the root scene gets no loop and no message.
- I4 `ENGINE_FEATURE_FACTORIES` is a hand list a new engine feature must join (only the error
  text uses it).
- I5 `Mount.ts`' JSDoc links `{@link _engine/kernel/init/InitEngine!InitEngine}`: a module path in
  the link text the Hub renders as written. Check how the Hub shows it.
- I6 Re-mounting after `unmount()` throws: the registrations are static (p611). D8.

**Views (`Views.ts`)**

- V1 Stale comments: `InitApp`, `ViewManager`. Otherwise clean: documented, its async switch
  queued, its listeners return removers. Views are debug-only today (nothing registers one in
  production) but ship in the kernel, folded to a boolean check.

## 2. Decisions (confirmed 2026-10-14)

### D1. Scope: the kernel's ECS, loop, config, init and views

The files of §1.1, plus the main-camera lookups in `Camera.ts` (p200's cache). Everything else in
`Camera.ts` and the 13 type-only seams in p613's files stay with p613, which applies D2's rule.

### D2. The type-only seams stay; the rule is written down

All 22 cost no bytes. Moving the component data types into their features means each feature
augments `ComponentDataMap` and `AppConfig`, and the kernel's own code (`reconcileObject3DVisibility`
reads `TAG_LOD_CULLED`, `ECSWorld.setDisabled` reads `PHYSICS_SIM_TIER`) then names keys whose
types exist only when the feature's module is in the program. Moving the keys too would break
`ComponentType.LOD` and the others for apps (an engine major, which Stage C doesn't take).

**Recommended:** keep them, and make it a rule in the coding standards: "the kernel imports a
feature's types only with `import type`, only for component data, config and import params; the
layout report lists each". The physics members of `ECSWorld` (E5) stay public. The stress test's
two debug keys stay too (C4). Not recommended: augmentations (B), or moving the keys (C, breaking).

### D3. The env flags: the `IS_*` bindings win

The flags are what a production build folds. Remove `isDebugEnvironment`, `isProdTestMode`,
`isProductionEnvironment`, `IS_PROD_TEST_ENV`, `CUR_ENV` and `APP_CONFIG`, and move each caller to
`IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`, `IS_PROD_ENV`, `getCurrentEnvironment()` and `getConfig()`.
None is on an entry, so no deprecation. `isCurrentEnvironment` / `isNotCurrentEnvironment` stay
only if something calls them (Phase 4 checks).

### D4. Config: merged per section, one owner per default

`loadConfig` merges one level deeper: each section's keys over the engine's section (arrays and
`draggableWindows`' values replaced whole, as today). Each section has one set of defaults, kept
by the module that reads it: physics' in `PhysicsAPI.ts` (its `physicsState`), assets' in
`AssetsAPI.ts`, LOD's in `LodSystem.ts`; `Config.ts` keeps only what it reads itself (`ecs`) and
nothing debug-only. The documented `WORKER_THREAD` default becomes true for every app
(`physicsState.workerTarget` becomes `'WORKER_THREAD'`, gravity follows `physicsState`: −9.81).

**Behaviour change, on purpose:** an app that passes `physics` without `workerTarget` moves from
`MAIN_THREAD` to `WORKER_THREAD`; an app that passes no `physics` section gets gravity −9.81 instead
of 0. The template passes both, so no scene changes. The changelog says so.

### D5. `ComponentType` wins over `CoreComponentType`

`CoreComponentType` gets `@deprecated` (removed in engine 6.0.0). The engine, toolkit and app move
to `ComponentType`. The enum stays in `ECSRegistry.ts` (the debug listings print its values).

### D6. The `appId` map lives in each world

`ECSWorld` keeps a `Map<string, number>` updated where `APP_ID` is added, removed and deleted, so
`getEntityIdByAppId` is one lookup. The first entity with an id keeps it, as today; a later
duplicate logs a warning in the debug env (debug-only, so a scene that has one today keeps
working). When the holder is deleted, the next live entity with that id (if any) takes it over,
found by the old scan, which is rare. Mutating `APP_ID.id` in place isn't supported (nothing does
it; documented on the component).

### D7. p200's main-camera cache, as p200 §3 designs it

`Camera.ts` caches the main camera's entity id and object, set by `setMainCamera` (the one add
site) and cleared by an `onDeleteEntity` hook (default world only), and `getMainCamera` /
`getMainAppCameraId` read it. The hook registers in `registerCameraManager` (an install, not module
load). `PhysicsTierPolicy.ts:324`'s own query is p614's; the plan records it there.

### D8. One boot per page stays

Resetting the static registrations so a page can mount again would mean undoing every plugin,
hook and scene registration: a lot of machinery for an embed that unmounts and mounts again, which
no one has asked for. **Recommended:** keep the throw and its message, and file it as an issue
(`docs/issues/remount-after-unmount.md`) with what a reset would need.

### D9. `onDebug` closures: measure, then gate each call

Phase 0 measures what the features' `onDebug` / `onDebugAfterStart` closures keep in the
production bundle (`yarn sbp --why`, a grep of `dist/` for their callees). If they keep anything
real, each call is gated with `if (IS_DEBUG_ENV)` like `postFx()`'s, and `debugInProduction.ts`
gets a check that fails on an ungated one if that can be detected. Making `onDebug` itself fold
isn't possible: the closure is the argument, built before the call.

### D10. One loop function, the render skipped alone

The three loop variants become one frame function: the debug parts behind `IS_DEBUG_ENV` (which a
production build folds, as it does today), the max FPS limiter as a `loopState.maxFPS > 0` check
that skips only the render and the `LATE_MAIN` stage after it, in every build (L1). Not `async`
(L3). The variant choice in `initMainLoop` goes away.

**Behaviour change, on purpose:** with `VITE_MAX_FPS` in a production build, the app stages run
on the skipped frames as they already do in the debug env. The scene runner runs the debug env
without a cap, so no baseline moves.

### D11. The loop's listener sets become `on*` with a remover

`onVisibilityChange(fn)`, `onBeforeUnload(fn)` and `onWindowBlur(fn)`, each returning its remover,
replace the `add*Fn` / `delete*Fn` / `deleteAll*Fns` sets (internal, 4 callers). `mainLoop` stops
being an exported `let`.

### D12. Versions

Engine **minor** (5.1.0 → 5.2.0): `CoreComponentType` deprecated, `ComponentType` and the new
JSDoc, the behaviour changes of D4 and D10. Toolkit **patch** (its `CoreComponentType` uses), app
**patch** (two scenes). Project = engine.

### D13. No example scene

A review plan adds no feature to show. The Hub's ECS feature page gets the `appId` lookup and the
stage table checked against the code (Phase 7).

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs at the end of Phases 1, 3 and 5 and in Phase 8 (snapshots and
hashes unchanged unless a phase says otherwise). Each phase ends with its "As built" list and the
updated `docs.json` (`yarn verify:baselines --docs --update`, which refuses a grown count).

### Phase 0: baselines and measurements — done

1. `yarn verify:scenes --update` on this commit (= `main`), then `yarn verify:baselines` clean.
2. `yarn hub:build`: the `notExported` warnings in scope (§1.2), recorded here.
3. D9's measurement: what the `onDebug*` closures keep in `dist/`, per feature.
4. Record the numbers in this plan's §1 and confirm D1-D13 with the user.

**As built** (2026-10-14, at `40063d1`):

- **Scene baselines:** 104 runs recorded (`.cache/verify/scenes/webgpu/`), 409 s, exit 0.
- **`yarn verify:baselines`:** all unchanged (`bundle.json`: main chunk 832.7 kB gzip;
  `bundle.banner.json` 688.6 kB; `api.json` 2457 exports; `docs.json` exports 1664 / 2342, members
  216 / 444); no debug code in either production build.
- **`notExported`, 20 in the model (`.cache/hub/typedoc.json`'s `messages`), 2 in scope:**
  - `ECSCoreComponents.ts:156`: `ComponentDataMap`, named by `ComponentData`, is "not included in
    the documentation" although the entry exports it. Phase 1 finds why (the interface is empty
    apart from its `extends`, and the app's and toolkit's `declare module 'aekasha'` augment it).
  - `LodTargets.ts:26`: `LodTargetEntry`, named by the `@internal` `getLodTargets`. Phase 1
    exports the type `@internal`.
  - The stub's two (`ECSSystemStage`, `AppComponentData`) are gone. The other 18 belong to p613,
    p614, p616, p618, p619 and p610's character types (their stubs list theirs).
- **D9, the `onDebug*` closures in the production main chunk:** `onDebug` and
  `onDebugAfterStart` fold to `r=>{}`, but their 8 call sites stay with their arguments: the
  call sites are 187 characters, and the stubs they keep alive (each wrapper's body folded to
  `async()=>{await Wl()}`, `Wl` being the folded `loadDebugModuleAsync`) about 165 more, under
  0.2 kB gzip in all. One isn't empty: physics' `registerPhysicsWireframeDebugAsync` keeps
  `registerOnAllSceneEnterings('physicsWireframeMasterVisibilitySync', …)`, which runs after the
  `await` without a debug check. Never called in production, but shipped. Phase 5: each call gated
  with `if (IS_DEBUG_ENV)` (as `postFx()`'s is), and that registration moved behind the module
  check.

### Phase 1: the ECS core (`ECS.ts`, `ECSHelpers.ts`, `ECSComponentStorage.ts`, `TypedArrayTransformStore.ts`, `ECSRegistry.ts`, `ECSCoreComponents.ts`, `LodTargets.ts`, `SpatialMembership.ts`) — done

1. E1: `clearWorld` deletes every entity through `deleteEntity` (hooks run, generations bump,
   ids are recycled), like `deleteWorld` without unregistering. Tests: hooks run, a stale id stays
   dead, the next id isn't 0.
2. E2: `getEntitiesWith` goes through `getStorage`. Test with an unknown key.
3. D6: the per-world `appId` map, `getEntityIdByAppId` reads it. Tests: lookup, delete, duplicate
   (first keeps it, the next takes over), `clearNonPersistent`.
4. E4: `storages` typed without `any` (an `IComponentStorage<unknown>` map behind a typed
   accessor), the `eslint-disable` gone.
5. E7: `removeComponent` runs the hooks only when the entity has the component. Check the hooks
   that might rely on it first (the culling tags' removals are guarded already).
6. D5: `CoreComponentType` deprecated; engine, toolkit and app callers moved to `ComponentType`.
7. C2, C3, E6: the dead code and the stale paths.
8. JSDoc: every export and every public member of `ECSWorld`, `Transform`,
   `TypedArrayTransformStore` and `IComponentStorage` (summary, `@remarks` for the traps: the
   storage iteration order, the cold-path `Transform` copy in `TYPED_ARRAY` mode, the generation
   wrap); `@example` on `ECSWorld`, `getEntityIdByAppId` and the helpers' entry.
9. `yarn verify:scenes`: unchanged.

**As built:**

- **E1:** `clearWorld()` deletes every entity through `deleteEntity` and keeps the world
  registered with its systems; `deleteWorld` calls it.
- **E2:** `getEntitiesWith` goes through `getStorage`.
- **D6:** `ECSWorld` keeps `entityIdsByAppId` (the first entity created keeps an id) and
  `duplicatedAppIds` (the ids taken twice, so only those are scanned for the next holder when the
  holder is deleted or its `APP_ID` removed or replaced). Re-adding the same id keeps the holder.
  A new public member, `ECSWorld.getEntityIdByAppId(appId)`; the module function calls it. The
  duplicate warning is debug-env only and for fixed ids (`isFixed`): a generated UUID never
  repeats.
- **E4:** `storages` is `Map<ComponentType, IComponentStorage<unknown>>`, read back typed by a
  private `_getStorageOf`; the `any` and its `eslint-disable` are gone.
- **E7:** `removeComponent` returns early when the entity doesn't have the component. The
  `DISABLED` remove hooks that no longer run for an entity that wasn't disabled (on every
  `createEntity`, through `setDisabled(id, false)`) only recompute: the core visibility reconcile,
  LOD's priority queue and the light GUI's debug visuals.
- **D5:** `CoreComponentType` has `@deprecated` (the enum stays the definition and stays on the
  entry: hiding it would make `ComponentType`'s type name an unexported enum, a new `notExported`).
  Moved to `ComponentType`: `Camera.ts`, `Light.ts`, `Group.ts`, `Mesh.ts`, `ECSCoreSystems.ts`,
  `ECS.ts`, `_dbg__LightHelpers.ts`, `_dbg__RayTester.ts` (type positions as
  `CoreComponentData[typeof ComponentType.X]`), the toolkit's `FollowTool`, `HoverEffect` and
  `SunShadowFit`, and the app's `assetCompare`. No `no-deprecated` lint exists, so nothing else
  flags it.
- **E8:** `registerECSModule` renamed `registerECSDebugGUI` (`@internal`; its one caller is the
  boot). `createRawEntity` (the helper) and `OBJECT3D_TAGS` are `@internal`; the `update*` stage
  runners on `ECSWorld` too (the loop's).
- **C2, C3, E6:** the commented-out `createPhysicsEntity`, the `OBJECT3D_TAGS` comment and its
  `@QUESTION`, the sound stub in `setDisabled`, the `@CONSIDER` and `@TODO` (`ECSHelpers.ts`) and
  every stale path in the folder.
- **JSDoc:** `kernel/ecs` exports 45 / 78 → 76 / 79, members 46 / 158 → 159 / 159 (every
  `CoreComponentData` key, `ECSWorld`, `Transform`, `TypedArrayTransformStore`,
  `IComponentStorage`). `@example`s on `ECSWorld`, `getEntitiesWith`, `getEntityIdByAppId` and
  `setTransform` (type-checked by `examples.test.ts`). The 3 exports left are
  `ObjectFrustumCullingSystem.ts`' (Phase 2), and `kernel/ecs/debug`'s 3 (`ECSStressTest.ts`, added
  to Phase 2).
- **`notExported`:** `LodTargetEntry` is exported `@internal` (19 warnings left). `ComponentDataMap`
  stays: a mapped `ComponentData` didn't change it, so it isn't the alias: the interface is merged
  by the toolkit's and the app's `declare module 'aekasha'`, and TypeDoc resolves the reference to
  that merged symbol, which has no reflection. The Hub's extraction is p619's: its Inputs get it
  (Phase 8).
- `yarn verify:scenes`: 104 passed, snapshots and hashes unchanged (406.7 s).
- Tests (`ECS.test.ts`, 27): `clearWorld`, `getEntitiesWith` of an unknown type, `removeComponent`
  without the component, and the `appId` lookup (lookup, delete, duplicates handed over,
  `APP_ID` removed and replaced, separate worlds).

### Phase 2: core systems, frustum culling and the main-camera cache — done

1. S1: the `DISABLED` / `PERSISTENT` link hooks stop on an entity that already has the component.
   Test: two lights targeting each other.
2. S2, S4: the stale TODOs and comments.
3. D7: p200's cache in `Camera.ts`, with tests (set, switch, delete the main camera, a second
   world doesn't touch it).
4. The `perf-auditor` agent over `kernel/ecs/` (the per-frame systems, the `for … of` over storages
   and `boundingVolumeProviders`); its findings fixed or listed here.
5. JSDoc: S5, the rest of the folder, and `kernel/ecs/debug/ECSStressTest.ts`' three exports.

**As built:**

- **S1:** the `DISABLED` add hook and the `PERSISTENT` / `TARGET_LINK` add hooks skip a target
  that already has the component. That isn't enough on removal (the hooks run while the
  component is still there), so `ECSWorld.removeComponent` ignores a nested removal of the same
  entity and type while that removal's hooks run (`removingIds` / `removingTypes`, two arrays used
  as a stack: no allocation, `try` / `finally` around the hooks). Tests
  (`ECSCoreSystems.test.ts`): two entities targeting each other, disabled and enabled, made
  persistent and not; a link added to a persistent entity.
- **S2, S4:** the stale `@TODO`s and paths. Every export of `ObjectFrustumCullingSystem.ts` is
  `@internal` (none is on an entry; `MAX_SPOT_ANGLE` and `getMeshWorldBoundingSphere` are shared
  with spatial).
- **D7:** `Camera.ts` keeps `mainCameraEntityId` (the id only: the object is one `getComponent`,
  so a replaced `OBJECT3D` can't go stale), set in `setMainCamera` for the default world, cleared
  by `TAG_IS_MAIN_CAMERA`'s `onRemoveComponent` and `onDeleteEntity` hooks (default world only,
  registered in `registerCameraManager`). `getMainCamera` and `getMainAppCameraId` read it. Tests
  (`kernel/camera/Camera.test.ts`): switching, deleting, and another world's entity with the same
  id.
- **The `perf-auditor` agent** over `kernel/ecs` (no measurements; V8 reasoning). Fixed:
  - Point and spot lights' bounding spheres called `updateWorldMatrix(true, false)` before
    `getWorldPosition`, which does it again (three r186's `Object3D.getWorldPosition`): once per
    culled light per frame.
  - `entityLifetimeSystem` and `lookAtSystem` return at once on an empty storage (no iterator).
  - `addComponent` runs its hooks in an index loop (no closure per add; culling adds
    `TAG_FRUSTUM_CULLED` per crossing), like `removeComponent`.
  - The visibility hooks' `overrides` are frozen module constants (`IS_DISABLED`, `IS_ENABLED`,
    `FRUSTUM_CULLED`, `FRUSTUM_SHOWN`), not a literal per flip; `reconcileObject3DVisibility`
    takes `Readonly<…>`.
  - Left (its "leave"): `for (const [k, v] of map)` (TurboFan elides the pair; `forEach` or keys
    plus `get` cost more), the mesh provider's `getWorldPosition` matrix walk (skipping it changes
    what culling sees), a per-entity provider cache, `deleteEntity`'s closures (per delete, not per
    frame), the `isDisabled` lookup per entity. The `TYPED_ARRAY` cold path (`getPosition`, …
    allocate a `Transform`) is documented on the members.
- **JSDoc:** `kernel/ecs` exports 79 / 79; `kernel/ecs/debug` 4 / 4: `initECSStressTest`
  documented, `instancedSyncSystem` and `proximitySystem` no longer exported (nothing imported
  them).
- **`yarn verify:scenes`** (not in the plan's list for this phase, run because culling, the hooks
  and the main camera changed): 103 passed, and `thirdPersonGymScene` `workerSab` stopped on a
  page reload mid-run ("Execution context was destroyed … navigation"), not a diff; alone, all four
  of its targets pass with the baseline hash (`f5cf468f`). The plan file was edited during the run:
  no file is touched while a scene run runs from here on.

### Phase 3: the loop (`MainLoop.ts`, `SystemStages.ts`, `Workers.ts`) — done

1. D10: one frame function, not `async`; L1's fix.
2. L2: the start and `toggleMainPlay` share one "request a frame unless one is queued" guard.
   Test (with a stubbed `requestAnimationFrame`): toggling during the start delay queues one frame.
3. L3: `ECSWorld` keeps its world list as an array (rebuilt on create and delete);
   `getAllECSWorlds` returns it read-only, no copy.
4. D11: the `on*` listeners; `mainLoop` unexported.
5. L5-L7: `getReadOnlyLoopState` as a shallow copy (the state is flat), `initWorker` with an
   options object (its two callers updated), the stale comments.
6. JSDoc for the 12 undocumented exports; unit tests for the max FPS limiter's pacing and the
   elapsed time's pause discard (pure once their state is passed in).
7. The `perf-auditor` agent over `kernel/loop/`.
8. `yarn verify:scenes`: unchanged.

**As built:**

- **D10:** one `runFrame` (not `async`) replaces the three variants. The stats calls sit behind
  `IS_DEBUG_ENV` (folded in production: `verify:baselines` finds no debug code); the editor view
  branch stays a boolean check. The max FPS limiter skips only the render, `LATE_MAIN` and the late
  loopers (L1), now in every build: a plain development build (no `?isDebug`) honours
  `VITE_MAX_FPS` too, which the old variant choice didn't. The limiter's step is the pure
  `nextMaxFPSReference(nowMs, lastRenderMs, intervalMs)` (-1 skips), the elapsed time
  `advanceElapsedClock(clock, delta, isRunning)` on a module `ElapsedClock`: both `@internal`, tested.
- **L2:** `requestMainLoopFrame()` (`@internal`) asks for a frame unless one is queued
  (`isFrameRequested`, cleared when the frame starts) or the loop is stopped: the start's
  `setTimeout`, `toggleMainPlay` and the Loop tab's master toggle (`_dbg__MainLoop.ts`, which used
  `requestAnimationFrame(mainLoop)` itself) all go through it. `mainLoop` isn't exported anymore.
- **L3:** `ECSWorld` keeps `worldList` (a new array on every world create and delete):
  `getAllECSWorlds()` / `ECSWorld.getAllWorlds()` return it, typed `readonly ECSWorld[]`, no copy.
  The loop iterates it with index loops.
- **D11:** `onVisibilityChange(fn)`, `onBeforeUnload(fn)`, `onWindowBlur(fn)` (`@internal`, Sets,
  each returns its remover) replace the nine `add*Fn` / `delete*Fn` / `deleteAll*Fns` (and the
  `deleteAddOnWindowBlurFn` typo). Callers: `KeyboardInput.ts` (passes `clearHeldKeys` itself, so
  adding the listeners again after a removal adds nothing), `MouseInput.ts` and `TouchInput.ts`
  (keep the remover), `PhysicsAPI.ts` (the same handler on every world: the Set keeps one).
- **L5-L7:** `getReadOnlyLoopState` is a spread copy (the state is flat), documented as allocating;
  `initWorker` takes `InitWorkerOptions` (its two callers, `PhysicsAPI.ts` and `AssetsAPI.ts`);
  `isMainThread` / `isMainThreadSimple` (`Workers.ts`, no caller) removed; the stale comments
  (`ViewManager`, `PhysicsManager`, `Lod/`). `ECSSystemStage` documented with the stage order.
- **Not in the plan:** `renderScene` called `existsOrThrow(…, \`…${Boolean(renderer)}…\`)`, so the
  message string was built every frame; now an `if` throws (the renderer checked first, also for
  the editor view branch, which rendered before the check).
- **The `perf-auditor` agent** over `kernel/loop`: no allocation left in `MainLoop.ts` (one
  `performance.now()` per frame, in three's `Timer`, two with the limiter). Two in
  `KeyboardInput.ts`' `pollHeldKeyBindings`, once per fixed sub-step and held binding: a `.some`
  closure and `getChordArray`'s `[chord]` array. That file is p617's: its Inputs get them (Phase 8).
- **JSDoc:** `kernel/loop` exports 36 / 48 → 44 / 44.
- Tests (`MainLoop.test.ts`, 5, `requestAnimationFrame` stubbed): the limiter's pacing (30 and 50
  FPS caps on 60 Hz), its skip and re-anchor, the elapsed clock's dropped deltas, one frame chain.
- **Baselines** (`--update`): `api.json`'s 25 changes (the renamed, removed and added internal
  exports above, and Phase 1-2's `registerECSModule`, `LodTargetEntry` and the stress test's two
  systems); the main chunk is 1,065 B larger minified, +228 B gzip (395,593 → 395,821): the
  `appId` map, the removal guard and the loop. The report's "835.3 kB gzip" headline is the
  visualizer's pre-minification sum, which counts the new JSDoc.
- **`yarn verify:scenes`:** 103 passed and `examplePhysics` `workerSab` stopped 0.7 s in on a page
  reload ("Execution context was destroyed … navigation"); alone, its four targets pass with the
  baseline hash (`74835516`). No file was touched during this run, so Phase 2's guess (the plan
  edit) was wrong: an intermittent reload of the runner's dev server, maybe Vite's dependency
  optimizer reloading on a dependency it found at runtime (not confirmed). Filed for p619 (Phase 8).

### Phase 4: config (`Config.ts`, `DebugModules.ts`) — done

1. D3: the duplicate flags and functions removed, callers moved (`APP_CONFIG` with them: K1).
2. D4: the per-section merge, the defaults moved to their readers, `physicsState`'s defaults
   aligned with the documented ones. Tests in `Config.test.ts`: a partial section keeps the other
   defaults, arrays replace.
3. K4: `AppConfig` documented key by key (the type is on the entry), the stale paths.
4. K5: `DebugModules.ts`' unused functions removed (if unused), the rest documented.
5. Check: `yarn build` and `yarn sbp` (the debug-only defaults gone from the main chunk).

**As built:**

- **D3:** removed `isDebugEnvironment`, `isProdTestMode`, `isProductionEnvironment`,
  `isCurrentEnvironment`, `isNotCurrentEnvironment` (no caller), `IS_PROD_TEST_ENV`, `CUR_ENV` and
  `APP_CONFIG`. 21 files moved to `IS_DEBUG_ENV` / `IS_PROD_TEST_MODE`; `_dbg__About.ts` and
  `ModuleLoad.test.ts` to `getCurrentEnvironment()`. The physics worker's own `isDebugEnvironment`
  (`EngineRapier.ts`' variable, the INIT message's field) stays: it isn't Config's.
  `IS_PROD_TEST_MODE`, `IS_PROD_ENV`, `getConfig` and `getEnvs` are `@internal` (none is on an
  entry); `IS_DEBUG_ENV` stays public.
- **D4, simpler than planned:** every reader already defaults its keys (`physicsState`,
  `initAssets`, `LodSystem.ts`, `initECSWorld`, the debug modules), so `Config.ts` keeps **no**
  defaults at all (`let config: AppConfig = {}`) and a per-section merge has nothing to merge.
  `loadConfig` copies the three sections it writes the env and debug overrides into (`physics`,
  `assets`, `ecs`): it used to write into the app's own `CONFIG.physics` object. `physicsState`'s
  `workerTarget` default is `'WORKER_THREAD'`, the documented one (D4's behaviour change; gravity
  was already −9.81 there). `DEFAULT_DEBUG_DRAWER_TAB_ORDER` stays in `Config.ts`: only the debugger
  reads it now, so it left the production bundle with the defaults object.
- **K4:** `AppConfig` has a summary, an `@example` and a doc on every `physics` key, `ecs` and
  `draggableWindows`; `Environments`, `DebugPhysicsWireframeConfig`; the stale paths.
- **K5:** everything in `DebugModules.ts` has callers (`loadDebugModule`: `Camera.ts`,
  `PhysicsAPI.ts`; `isDebugReady`: the on-screen tools); documented, `@template`s.
- **Not in the plan:** `DefaultDebugKeyBindings.test.ts` mocked `Config` with
  `{ ...(await importOriginal()) }`, which copies `IS_DEBUG_ENV`'s value at mock time (false):
  with the flags read directly (no `isDebugEnvironment()` to reach the real binding), two tests
  failed. The mock now defines the two flags as getters on the original module.
- Tests (`Config.test.ts`): no engine defaults (a missing key stays missing); the env overrides
  land in copies, the app's section objects unchanged.
- **JSDoc:** `kernel/config` exports 29 / 32 → 24 / 24, members 1 / 1.
- **Baselines** (`--update`): `api.json`'s 8 removals; the main chunk −1,142 B minified, −432 B
  gzip (395,821 → 395,389): the defaults object and the tab-order list.
- **`yarn verify:scenes`:** 104 passed, nothing changed (the template passes `workerTarget`).

### Phase 5: init and views (`Boot.ts`, `Features.ts`, `InitEngine.ts`, `Kernel.ts`, `Mount.ts`, `Views.ts`) — done

1. D9: the `onDebug*` calls gated per Phase 0's measurement, and the check if feasible.
2. I2: cameras, lights and input registration moved into `installKernel` where their order allows
   it (the system order baseline, `systemOrder.test.ts`, must not change); the debug blocks moved
   into a `bootDebugAsync` beside it, so `bootEngineAsync` stays under the limit.
3. I3: a warning (and a debug toast) when `start` leaves the root scene empty.
4. I4: `ENGINE_FEATURE_FACTORIES` checked by a test against the feature entries' factories.
5. I5: the `{@link}` form the Hub renders right.
6. D8: the issue file.
7. V1 and the stale comments.
8. `yarn verify:scenes`, `yarn verify:embed`: unchanged.

**As built** (2026-10-15, one commit per section):

- **D9:** every `ctx.onDebug` / `ctx.onDebugAfterStart` call sits inside `if (IS_DEBUG_ENV)`
  (LOD, character, physics, sky box, spatial; PostFX's already did); both hook lists run only
  under that flag in the boot. `registerPhysicsWireframeDebugAsync` returns before its
  scene-enter registration when its module didn't load. The check: `findDebugCodeInBuild` takes
  the build's scripts (`BuildScript`, read by `baselines.ts` for the app and each embed) and
  reports each `.onDebug(` / `.onDebugAfterStart(` call left (property names aren't minified; the
  context's own `onDebug:r=>{}` isn't a call), tested on Phase 0's minified form.
  `FeatureContext.onDebug` has the rule as `@remarks`; root CLAUDE.md's "Production builds",
  `devTools/verify/CLAUDE.md` and the Hub's ECS guide say it too.
- **I2:** the input registers nothing at boot (each device adds its listeners on its first
  binding, the mouse its hover system on first use): p607's "and input" was stale. Cameras and
  lights split: `installCameras(ctx)` (the dispose hook, the main camera cache's hooks, the aspect
  resizer) and `installLights(ctx)` (the dispose hook) run last in `installKernel`, through the
  context; `registerCameraDebugGUI()` and `registerLightDebugGUI(world)` (the GUIs, their `onAdd`
  list hooks, the scene-enter syncs) run where the managers ran. `registerCameraManager` and
  `registerLightManager` are gone. Hook order holds: the only other hooks on those tags are the 3D
  symbols' and the light helpers' add hooks, and the GUI add hooks still register after them. The
  boot's debug blocks are `bootKernelDebugAsync` (before the features), `bootDebugToolsAsync`
  (debug env and prod test, before `start`) and `bootDebugAfterStartAsync`, each called behind its
  flags: `bootEngineAsync` 145 → 72 lines. The system order didn't change.
- **Not in the plan:** `initDebugCamera` was called in production too (a no-op there), and its
  loader calls kept `DebugModules.ts` in both main chunks; behind the flag now, the module left
  them.
- **I3:** `setCurrentScene` (`Scene.ts`) starts the loop too, so an empty root scene after
  `start` is fine while a load `start` didn't await runs. The boot warns only when the root scene
  is empty and `isCurrentlyLoading()` is false. No debug toast: in the debug env the debug camera
  is always a child, so it can't happen there. The warning is `__AEK_DEBUG__`-only (development
  and test builds, where `yarn dev` without `?isDebug` and prod test mode show it): shipped, it
  cost about 145 B gzip per build. No unit test (the boot would need ~30 mocks).
- **I4:** `ENGINE_FEATURE_FACTORIES` is exported `@internal`; `FeatureFactories.test.ts` globs
  `features/*/*Feature.ts` and their `index.ts` entries, calls each module's one function (the
  factory), and rebuilds the map (`id → "name() from 'aekasha/<folder>'"`, the entry exporting the
  same function) to compare with it.
- **I5, in the renderer instead:** TypeDoc resolves `{@link _engine/kernel/init/InitEngine!InitEngine}`
  but keeps the reference as the link text. The Hub's `linkLabel` (`devTools/hub/api/comments.ts`)
  shows a declaration reference's name after the `!`, so the six links (`Mount.ts`, `Scene.ts`,
  `AppData.ts`) read `InitEngine`; a module that can't import the name keeps that form. Tests:
  `comments.test.ts`. TypeDoc's own theme (`yarn docs`) still shows the reference.
- **D8:** `docs/issues/remount-after-unmount.md` (won't fix until an app needs it): what the boot
  fills (361 module-level `let`s and collections in 75 shipping engine files, the static ECS
  registries, the seams), and what a reset needs. `mountAekasha`'s JSDoc links it.
- **V1 and the stale comments:** `Views.ts`' `InitApp`; the 20 `ViewManager.ts` mentions in 18
  files (most outside this plan's scope, the debug modules included: a word swap to `Views.ts`);
  `MaterialEditor.ts`' "InitApp's debug block"; the comment lines over 100 characters in scope.
  `devTools/refactor/` and the engine-5 migration page keep the old names on purpose.
- **Left to Phase 7:** root CLAUDE.md's Bootstrap flow ("registers the Camera/Light managers,
  inits the debug camera") and Engine features ("cameras, lights and input still register in
  `InitEngine`") describe the boot before I2.
- **Found, not this plan's:** `yarn hub:build` warns on 7 `{@link}`s that link nowhere
  (`CharacterTypes.ts`, `LodSystem.ts`, `ActionTypes.ts`, `SeededRandom.ts`), and the search index
  is 1.24 MB, over its 1 MB warning (`devTools/hub/CLAUDE.md` says 1,006 kB): Phase 7 compares with
  `main`.
- **Baselines** (`--update`): `api.json`'s 7 changes (the two managers removed; `installCameras`,
  `installLights`, `registerCameraDebugGUI`, `registerLightDebugGUI`, `ENGINE_FEATURE_FACTORIES`
  added, all `@internal`); the main chunk −782 B minified, −362 B gzip (395,452 → 395,090), the
  banner's −227 B, −91 B (305,443 → 305,352).
- **Checks:** `yarn verify:scenes` 104 passed (408.2 s), snapshots and hashes unchanged, no page
  reload this time; `yarn verify:embed` all passed; `yarn test` 57 files.

### Phase 6: the rules written down — done

1. D2's rule in the coding standards (`hub/pages/documentation/coding-standards/intro.md`) and
   CLAUDE.md's Three-folder split.
2. The findings this plan files rather than fixes (`docs/issues/`), each named in §1.

**As built:**

- **The seams, recounted:** the committed layout report was stale (last written in p611 Phase 4);
  regenerated (`moveMap.ts`, with `moveMap.json` and `entryExports.json`), it has 23 type-only
  kernel → feature imports in 14 files, none at runtime: 8 in this plan's files
  (`ECSCoreComponents.ts` 5, `ECS.ts`, `LodTargets.ts`, `Config.ts`), 15 in p613's. §1.2's 22 / 9 / 13
  counted differently; the set is the same.
- **D2's wording widened:** "component data, config and import params" left out `Scene.ts`'
  `SkyBoxDef` / `PostFxPassProps` / `ImpostorDef`, `Mesh.ts`' LOD defs and the assets worker's LOD
  chain types. The rule says "the data the kernel holds or carries for a feature" and lists those
  kinds: component data, config, scene and mesh definitions, import params, the assets worker's
  messages.
- **Written in:** the coding standards' Layering (a bullet after the lint's), CLAUDE.md's
  Three-folder split (the `no-restricted-imports` bullet) and its Coding standards line.
- **Not in the plan: a lint for it.** `KERNEL_FEATURE_IMPORT` (`eslint.config.js`): in
  `src/_engine/kernel/**`, a `^(../)+features/` specifier is an error unless it's `import type`
  (`allowTypeImports`, as the `_dbg__` rule). A kernel `_dbg__` module isn't checked (the debug
  files' later config entries replace it), nor an `import()` (the assets worker's job modules). The
  kernel lints clean; checked on stdin: a runtime import fails, a type import and `../init/Features`
  pass.
- **Section 2, the findings left: no new issue file.** §1's findings against Phases 1-5's As
  built: every one is fixed, decided to stay (E5, C4: D2), or filed already (I6: D8's
  `remount-after-unmount.md`). No `@TODO` / `@CHORE` / `@QUESTION` is left in the plan's files.
  One was neither: E8's `getEntityDiagnosticData` / `inspectEntity` read only the default world.
  A few lines, so fixed instead of filed: an optional `ecsWorld` (the other helpers' shape;
  `inspectEntity` takes it in its options), tested in `ECS.test.ts`. Neither is on an entry.
- **Plan items, not issue files** (other plans' files; Phase 8 writes them into those plans'
  Inputs): p613 and p614 (D2's rule, now in the coding standards and the lint), p614
  (`PhysicsTierPolicy.ts`' own main-camera query), p617 (`pollHeldKeyBindings`' closure and array
  per sub-step), p619 (the `ComponentDataMap` `notExported`; the scene runner's intermittent page
  reload). Phase 7 keeps Phase 5's `hub:build` findings (the 7 `{@link}`s, the search index, now
  1.25 MB).

### Phase 7: the Hub, CLAUDE.md and readme — done

1. The ECS feature page (`hub/pages/features/ecs/`: ECS core, Engine features), the Viewports page's
   Views section, the ECS and quick-start examples: checked against the code (the `appId` lookup,
   the stage table, the config merge).
2. CLAUDE.md: Config and the env flags (Bootstrap flow, the `?isDebug` paragraph), the ECS core
   section (`ComponentType` only, the `appId` map), the loop. `readme.md` if its `AppConfig` or
   `addSystem` examples changed.
3. `yarn hub:build`: no new warning, no dead link.

**As built** (2026-10-15, one commit per section):

- **The pages, checked:** the ECS page's stage table and pause rule match `runFrame`; the Viewports
  page's Views section matches `Views.ts`; the physics page's defaults match `physicsState` after
  D4; the examples' included regions didn't change. Fixed: the ECS page's `appId` option (one
  lookup, keep ids unique: the first entity keeps one, the debug env warns about the second) and
  a bullet on D10's frame cap (a frame not drawn runs every stage up to `APP_RENDER_SYNC`, skips
  the render and `LATE_MAIN`); the quick start's "each top-level key merged over the engine's
  defaults" (D4: a key left out keeps the default of the module that reads it) and "`IS_DEBUG_ENV`
  and the other flags" (D3: the one public flag).
- **The migration page isn't used for D4 and D10** (§4's Risk 3 said it would): it has one section
  per major, for changes that break an app's code, and this is a minor. The changelog says both
  (Phase 8).
- **CLAUDE.md:** ECS core gets `CoreComponentType`'s deprecation, an App ids bullet (D6), the
  remove hooks' rule (E7, S1) and a loop bullet (D10, L2, L3, D11); the `?isDebug` paragraph names
  the flag bindings left (D3); Bootstrap flow (`loadConfig` without defaults, cameras and lights in
  `installKernel`, the three debug steps, the empty root scene) and Engine features (I2) as the
  boot is; Physics and Views name `runFrame` instead of the loop variants. Also
  `kernel/input/CLAUDE.md`'s "every loop variant", `setFrameProbe`'s JSDoc, and `readme.md`'s
  config sentence (D4); its `AppConfig` and `addSystem` examples still match.
- **`yarn hub:build`, compared with `main`** (`40063d1`, built in a scratch worktree): 26 warnings,
  every one on `main` too but the search index's size; `LodTargetEntry`'s `notExported` is gone
  (Phase 1). The 19 `notExported` are Phase 1's (`ComponentDataMap` the one in scope). The 7
  `{@link}`s that link nowhere name an export their file doesn't import (TypeDoc resolves a link
  in the file's scope): `CharacterTypes.ts` (`getBodyKind`), `LodSystem.ts` (`LodTarget`),
  `ActionTypes.ts` (`setActionContextEnabled`, `createActionMap` twice), `SeededRandom.ts`
  (`getRandomStream`); Phase 8 hands them to their plans. The search index is 1,316,018 B (309,347
  gzip), `main`'s 1,291,232 (302,450): +24.8 kB raw, +6.9 kB gzip, this plan's new JSDoc (each
  documented symbol stores its first sentence). `main` is over the 1 MB warning already;
  `devTools/hub/CLAUDE.md`'s "1,006 kB, under the warning" corrected.

### Phase 8: versions and done — done

1. D12's bumps, a `CHANGELOG.md` entry (the two behaviour changes called out),
   `yarn checkVersions --against main`.
2. `yarn test`, `yarn verify:scenes`, `yarn verify:baselines` (no unexplained growth), `yarn build`,
   `yarn hub:build`.
3. Mark the plan done (`docs/plans/CLAUDE.md`), drop p200's "lands in p612" (p200 itself then has
   nothing left: mark it done too), update the other stubs' inputs: p613 and p614 (D2's rule, D7's
   `PhysicsTierPolicy` note), p617 (`pollHeldKeyBindings`' closure and array per sub-step, Phase 3),
   p619 (the `ComponentDataMap` `notExported` from the augmentations, Phase 1; the scene runner's
   intermittent page reload, Phases 2-3; the search index over its 1 MB warning, Phase 7), and
   Phase 7's `{@link}`s that link nowhere: p614 (`CharacterTypes.ts`), p616 (`LodSystem.ts`), p617
   (`ActionTypes.ts`), and `SeededRandom.ts`, which no review plan lists (`utils/`).
4. Time for a PR: this branch into `main` (p600's "Branches and PRs").

**As built** (2026-10-15):

- **Versions, D12 moved:** p611 merged at engine 5.2.0 after D12 was written, so its levels apply
  to the current numbers: engine 5.2.0 → 5.3.0 (project the same), toolkit 2.1.0 → 2.1.1, app
  1.12.0 → 1.12.1. `yarn checkVersions --against main` passes.
- **The changelog** ("2026-10-15 — review-ecs-loop-config-init") calls out both behaviour changes.
  D4's is narrower than written: without `physics.enabled` nothing initializes (on `main` too), so
  an app passing no `physics` section gets gravity −9.81 instead of 0 only when `VITE_PHYS_ENABLED`
  alone turns physics on. The `workerTarget` change (a partial section now runs on
  `WORKER_THREAD`) is as written.
- **Checks:** `yarn test` 57 files (492 passed, 1 skipped); `yarn verify:scenes` 104 passed,
  hashes, snapshots and system order unchanged (407.9 s); `yarn hub:build` 360 pages, Phase 7's 26
  warnings, no dead link.
- **`yarn build` failed on an SBP budget**, which no phase had recorded (Phase 4's step 5 didn't
  either): `_engine/kernel/ecs` 16.1 KiB gzip in the app, 15.6 in the banner, budget 15. A group is
  measured before minification, so the JSDoc of Phases 1-2 counts: on `main` the group was 14.1;
  minified with comments stripped, the folder's code grew 8.1 → 8.5 KiB (the `appId` map, the
  removal guard, `clearWorld`; the debug-only warning not folded in that measurement). The budget is
  17 KiB in both profiles (`sbp.config.ts`, with the reason); the build passes.
- **`yarn verify:baselines` reported one change** with no file's size changed: `keyFiles` numbers
  same-named chunks in the sorted order of their hashed names, and a hash moved, so
  `EngineRapier.js` and `EngineRapier.js#2` swapped. `--update` recorded it (and `three.module.js`'s
  pair, and gzip sizes 1-4 B apart from the chunks naming each other's new hashes); the rerun is
  clean. The main chunk is 395,092 B gzip (−501 B against `main`), the banner's 305,348 (−246 B).
- **Handed on**, each in its plan's Inputs: p613 (D2's rule, its 15 seams), p614 (D2's rule and
  `ECSWorld`'s physics members, `PhysicsTierPolicy.ts:324`'s query, `CharacterTypes.ts`' link),
  p616 (`LodSystem.ts`' link), p617 (`pollHeldKeyBindings`' allocations, `ActionTypes.ts`' three
  links), p619 (`ComponentDataMap`'s `notExported`, the scene runner's page reloads, the search
  index's size, and this phase's two: group budgets that count comments, `#2` keys that follow
  hashes), and p621 (`SeededRandom.ts`' link: no review plan has `utils/`, and p990 is for plans
  whose files were removed).
- **p200** is done: its one phase landed in Phase 2 (D7), and it's `_DONE_p200_…` now.

## 4. Risks

1. **System order.** Moving cameras, lights and input into `installKernel` (Phase 5) reorders
   registrations; the system order baseline catches it, and the step is dropped if the order can't
   be kept.
2. **The `appId` map's duplicates.** A scene that relies on a later duplicate winning would change;
   none is known (the scan returns the first today too).
3. **D4's defaults.** An app outside the template that passes a partial `physics` section changes
   worker target; the changelog and the migration page say so.
4. **Determinism.** D10 and the hook changes touch every frame; the scene runner's hashes are the
   check, in all three physics targets.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.

## From p607 (2026-10-12)

- **The type-only kernel → feature imports (p607 D6), 22 in the layout report**, which p608 moves as
  they are. Removing them means features augmenting `ComponentDataMap` and `AppConfig` (`declare
module 'aekasha'`), which changes the public types of the core component map: this plan decides.
  By kind: component data in `ECS/ECSCoreComponents.ts` (`CharacterObject`,
  `InstancedMeshSlotData`, `LodData`, `ColliderAPI` / `RigidBodyAPI`, the tier data), `RigidBodyAPI`
  in `ECS.ts`, `AppConfig.physics`' types in `Config.ts`, the import params (`CustomProps.ts`,
  `ImportTypes.ts`: physics params, `LodChainOptions`; `ImportExtensions.ts`, `GLTFExtract.ts`,
  `ImportRegistry.ts`: the LOD chain types), the assets worker's (`AssetsAPI.ts`,
  `AssetsAPITypes.ts`, `assetsSwitchGLTF.ts`: `LodSimplify` / `LodChainGLTF` types),
  `MeshManager.ts`' LOD defs, `ECS/LodTargets.ts`' `LodTarget`, and `Scene.ts`' `SkyBoxDef`,
  `PostFxPassProps` and `ImpostorDef`.
- **Init (`InitApp.ts`):** its body is `initEngineAsync` (no `try` block: Rollup keeps a `try`
  block's calls whole); the kernel installs in `installKernel` (`core/Kernel.ts`), but cameras,
  lights and input still register in `InitEngine` itself; `registerBuiltInIcons()` runs there for
  the debug tools. The features install through `core/Features.ts`' context; two seams aren't on it
  (`setSpatialDomainMembership`, `setAutoLodResolverLoader`, internal setters). `Features.ts`'
  `ENGINE_FEATURE_FACTORIES` (the boot check's error text) is a hand list a new engine feature
  joins.
- **Debug hooks in production:** a closure handed to `ctx.onDebug*` stays in the bundle (p607
  Phase 7). `postFx()`'s call is gated with `if (IS_DEBUG_ENV)`; the other features' closures call
  non-wrapper functions, so the production debug check can't see them, and they may be dead code
  in main (not measured): measure and gate them, or make `onDebug` fold.
- **The loop:** the fixed-step seam is `MainLoop.ts`' `FixedStepDriver` (`latch`, `step`,
  `flushEvents`, `isStepping`), the render seams `core/RenderHooks.ts`. Factories take no options
  yet (p607 D1): `physics()` keeps `config.physics`, which this plan reviews. Leaving the tiers and
  the tier policy out was measured in p611 Phase 5: a feature of its own, not an option, in p614's
  "From p611".

## From p611 (2026-10-14)

The embed's seams (p611 Phase 3, D6), each defaulting to the full-page boot's behaviour:

- **The boot** is `kernel/init/Boot.ts`' `bootEngineAsync` (`@internal`; `InitEngine` is the
  full-page wrapper that adds `page.scss`), shared with `mountAekasha` (`kernel/init/Mount.ts`). It
  runs once per page load (`isEngineBooted`): a second `InitEngine` or mount throws. Mounting again
  after `unmount()` throws too, since the registrations (`ECSWorld.registerPlugin`, the features'
  installs, the scene registry) are static and can't be undone: resetting them is this plan's call.
  `BootOptions.hudSlot` is the element the HUD root replaces.
- **The loop:** `initMainLoop` subscribes its resizers with `onCanvasResize`
  (`kernel/render/CanvasSize.ts`) instead of the window's `resize`; `stopMainLoop()` (`@internal`)
  stops it for good, a queued frame included (a flag each loop variant checks first), and removes
  the resize, visibility, `beforeunload` and `blur` listeners.
- **Not stopped by `unmount()`:** a physics worker (`physics()` has no stop; p614).

**The manifest fold** (p600 §4.2's constants, left to p611 by p607 D10; measured in p611 Phase 5
§2): build-time constants from the gathered data, so code paths no shipped scene's data needs fold
away, as `__AEK_DEBUG__` folds the debug code.

- **The template app saves nothing:** some scene's data uses every data-driven path. Each of the
  four features with a schema part is in a manifest (sky box in 10 scenes, PostFX in 4, LOD in 2,
  spatial in 1), the sky boxes use every layer between them (`dayNight` all but the nebulae, which
  `space` and `exampleHubHero` have), and `exampleToolkit` and
  `sceneTestECS` (the first scene) import assets. It pays in an app with fewer scenes, and in an
  embed (each profile has its own data, `src/generated/profiles/<id>/`).
- **Measured on the banner:** folding the one data-only kernel path it doesn't use, the scene's
  imported assets (`SceneLoader.ts`' branch and `SceneAssetRelease.ts`' release, with
  `if (false as boolean)` in a scratch build), takes its initial 300.6 → 285.1 KiB gzip (−5.2%) and
  its deployed lazy files 752.9 → 729.3 KiB (p613's "From p611" has the breakdown).
- **Safe only on a branch that reads scene data:** the public API keeps what it imports, so code
  that calls `importAssetAsync` still works when the data branch folds. The sky box layers aren't
  such a branch (their pre-minification sizes: the eight layers 12.9 kB, `SkyLights.ts` 3.5,
  `SkyTime.ts` 1.5, `SkyStaticLayers.ts` 1.0): the composite reads a definition that scene code
  can make too, so folding a layer no data names would break a code-made sky. Leaving layers out
  needs an API (eg. `skyBox()` taking the layers it may build, p615), not a manifest.
- **The mechanism, if built:** defines computed from the gathered data at build time, one per
  data-only path (`__AEK_DATA_IMPORTS__`), from the app's data or the embed profile's (the
  production gather runs before `vite build` in `yarn build` and `buildBundles`), `true` in the dev
  server and the tests. `vite.config.ts` would read the gathered JSON when it loads, and the
  scene runner couldn't see a wrong fold (it runs the dev data).
- **Recommendation: don't build it now.** The one candidate found folds better as an `import()`
  (p613's "From p611": loaded when a scene's data names an imported asset), which saves the same
  bytes in every build, the app's initial chunk included, with no build-time constants and no
  build that differs from the dev server. Revisit when a data-only path can't be lazy (it must run
  synchronously) and is worth more than a few KiB. The manifest stays what p607 made it: the
  boot's check that `features` covers the scenes.
