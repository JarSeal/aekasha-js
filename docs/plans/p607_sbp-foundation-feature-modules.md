Status: stub — not-implemented
Category: Build, Performance, Architecture
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B, engine major)
Blocked by: p606_layering-inversion-and-public-entry.md
Blocks: p608_engine-folder-restructure.md, p611_sbp-tooling-profiles-and-marketing.md, p510_headless-simulation-runtime.md
Related: p990_follow-ups-from-done-plans.md (the two bundle items moved here), p240_client-device-capability-sniffer.md

# SBP Foundation: Feature Modules — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Make the engine tree-shakeable by construction (p600 §4.1) and install features explicitly
(p602 D8), so an app's bundle holds only what it uses. Today the main chunk is 1.77 MB gzip with
every subsystem in it (p600 §2.4).

## Scope

- **Rapier out of the main chunk:** `Physics/EngineRapier.ts:1` imports Rapier as a value and
  `Physics/ENGINES.ts:3` imports EngineRapier statically, which cancels the dynamic import at
  `ENGINES.ts:23`. Load the backend only through `import()`: ~829 kB gzip (47%) off the main chunk
  in `WORKER_THREAD` mode, a lazy chunk in `MAIN_THREAD` mode, nothing without physics.
- **The install contract:** `InitEngine({ features: [...] })` (p602 D8) with `install(ctx)` and the
  scene hooks the kernel calls today directly (physics world reset, sky box clear, spatial domain
  release in `SceneLoader.ts`).
- **No module-level registrations:** `ECSCoreSystems.ts`, the two culling systems, `MeshManager.ts`,
  `GroupManager.ts`, `SkyBox/SkyBox.ts:722`, `Lod/LodSystem.ts`, `Spatial/SpatialIndexSystem.ts`,
  `Character.ts`, `Raycast.ts` and `src/AppECSPlugins.ts` register from their feature's `install`.
- **`sideEffects`** in `package.json`, listing only the stylesheets.
- **`__AEK_DEBUG__`:** a compile-time define, `false` in `VITE_APP_ENV=production` builds, so the
  `debug/*` wrappers, `DefaultDebugKeyBindings`, debug branches in the managers, the Toaster and
  `3DSymbols` fold away; `true` in development and test builds (`?isDebug`, `?isProdTest` unchanged).
- **From p990:** the line core registered on first `createLines`, with `LineManager` hooking scene
  teardown itself (`SceneLoader.ts:50` imports `disposeNonPersistentLines` today); the icon registry
  (p602 D5), one module per icon instead of 49 `?raw` imports in `SvgIcon.ts`.
- **Lazy data maps:** `generatedAppFns.ts`'s TSL material and PostFX maps as `import()`s, so the
  TSL materials and GTAONode load with the scene that uses them.
- **Loaders:** GLTF, Draco, KTX2 and HDR loaders imported where used. (The `Addons.js` imports are
  gone: p606 Phase 5 found them, since Node can't load the barrel's `TTFLoader`.)
- **The feature manifest** (p600 §4.2): `gatherAppData` emits what the shipped scenes' data uses;
  a scene that needs an uninstalled feature fails the gather.

## From p606 (2026-10-11)

What p606 decided for this plan, and what it left where this plan picks it up:

- **The kernel → feature seams are this plan's** (p606 D2, superseding p602 D2's "p606 designs
  the seams"): design and build them with the install contract that fills them (`install(ctx)`),
  not before it. They are a fixed-step hook, a render pipeline hook, scene enter / exit hooks (the
  physics world reset, sky box clear, spatial domain release and line teardown `SceneLoader.ts`
  calls directly today), import extensions (`SpawnImported` reaching
  `Import/MeshColliderGeometry.ts`, `moveRules.ts`' note) and assets worker job kinds. The debug
  wrappers (`debug/*.ts`) merge into their features with their move (p608 / p618), not here.
- **The feature-schema seam** (p606 D3, changed in its Phase 3): moving each feature's schema into
  its feature leaves `meshSchema → lodSchema`, `sceneSchema → skyBoxSchema` and
  `core/Scene.ts → impostorSchema`, so the three stay in `schemas/` and `aekasha/schemas` until the
  scene and mesh schemas are composed from the installed features' parts. Design that composition
  here, with the feature manifest (above): then each feature's schema moves into its feature and
  its entry exports it, and `aekasha/schemas` re-exports them for the devTools.
- **`InitEngine({ config, data, start })`** is p606's (`InitApp.ts`); `features` joins it. Until
  then `src/index.ts` imports `./AppECSPlugins` right after `aekasha`, and that import becomes a
  feature entry in `features`.
- **Module-level registration in the dev server:** Vite's dev server doesn't tree-shake, so
  importing an entry runs every module it re-exports. In p606 Phase 7 `PhysicsTierPolicy.ts`'s
  `registerPlugin` (a no-op unless a policy has `cadence: 'FRAMES'`) started registering while
  `AppECSPlugins`' imports load, through `MovingPlatform`'s `aekasha/physics` import: a tie in
  system order moved in dev, not in builds. Install-time registration removes the class of
  problem.
- **The entries are side-effect free in the build** (`getEntryModuleSideEffects` in
  `devTools/aliases.ts`, `vite.config.ts`'s `treeshake.moduleSideEffects`): `package.json`'s
  `sideEffects` (above) must keep the 16 entry files free of side effects too, or the main chunk
  grows by everything an entry re-exports (5.1 kB gzip in Phase 7). An entry file holds only named
  `export … from` (`aliases.test.ts`).
- **Left at load by p606, this plan's** (p604 §4.6): the `?worker` imports (`PhysicsAPI.ts:10`,
  `Assets/AssetsAPI.ts:7`) and `InitApp.ts:27`'s SCSS import. Nothing else in the engine reads
  `window`, a flag or `getConfig` at load (`moduleLoad.test.ts` checks the first).
- **Lazy data maps:** the gatherer now writes `src/generated/generatedAppFns.ts`, and the engine
  reads it through `InitEngine`'s `data` (`core/AppData.ts`: `tslMaterialFiles`, `postFxFiles`),
  so the `import()` maps change `AppData`'s types and the gatherer, not an engine import.
- **Branch and versions** (p606 D5): from `stage-b`, merged into `stage-b`; then `stage-b` merges
  to `main` as engine 5.0.0 (Golden Hour) and toolkit 2.0.0 (Half Moon), already in `package.json`
  from p606's Phase 10; run `yarn checkVersions --against main`, not `--against stage-b` (which
  would ask for another engine bump). This plan adds to p606's `CHANGELOG.md` entry and to
  the Hub migration guide's "Engine 4 → 5" section (`hub/pages/documentation/migration/engine-5.md`):
  `features`, and anything else an app must change.

## Inputs

- p606 (above); p600 §2.4, §4; p602 D2, D5, D8; p990's line core and SVG icon items (moved here from its former "Bundle size and rendering" section).

## Done when

- The main chunk holds no Rapier in `WORKER_THREAD` mode; the app's main chunk diff in
  `bundle.json` is recorded in the changelog.
- No top-level `registerPlugin` / `registerComponentHooks` / `addSystem` outside `install` (a lint
  rule or a check script).
- A production build contains no debug wrapper code (`grep` the output for their names).
- p601's runner passes in all three physics targets.
