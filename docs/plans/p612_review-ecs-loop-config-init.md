Status: stub — not-implemented
Category: Refactoring, Documentation, ECS
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p607_sbp-foundation-feature-modules.md (D6's type-only seams, the install contract and the loop seams this plan reviews: "From p607" below)

# Review: ECS, Main Loop, Config and Init — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope, and records the findings per file group in an "As found" list.

## Scope

- The ECS (`core/ECS.ts`, `core/ECS/*`: 925 lines in `ECS.ts`; ECS class members documented 10 of 96), the core components and systems, the culling systems.
- The main loop (`MainLoop.ts`, its three variants, the stages, the step clock's frame side), `Config.ts` (6 TODOs), `InitApp.ts`, `ViewManager.ts`.
- **p200's recommendation:** cache the main-camera singleton-tag lookup (`p200_component-query-caching.md`).
- The id → entity map for `appId` (p604 §4.4) instead of `getEntityIdByAppId`'s linear scan.

## Inputs

- p200, p604 §4, p600 §2.
- p605 Phase 5's `notExported` warnings in scope (`yarn hub:build` lists each with its file and line; export the type with a summary or change the signature): `ECSSystemStage` and `AppComponentData` (`src/AppECSRegistry.ts`, the app's extension point, outside the documented API) named by `ECSWorld.addSystem` and `ComponentData`.

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

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
