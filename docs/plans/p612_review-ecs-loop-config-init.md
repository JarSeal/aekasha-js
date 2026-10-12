Status: stub — not-implemented
Category: Refactoring, Documentation, ECS
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocked by: p608_engine-folder-restructure.md
Blocks: p621_hub-docs-readme-and-claude-md-final.md

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
  yet (p607 D1): `physics()` keeps `config.physics`, which this plan reviews (eg. leaving the tiers
  and the tier policy out, p611).

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
