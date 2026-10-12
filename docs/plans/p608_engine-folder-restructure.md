Status: stub — not-implemented
Category: Refactoring, Architecture
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B, engine major)
Blocked by: p299_texture-arrays-and-atlases.md (in progress: merged before the move)
Blocks: p609_toolkit-and-app-restructure.md, p610_character-and-input-action-architecture.md, p611_sbp-tooling-profiles-and-marketing.md, p612_review-ecs-loop-config-init.md, p613_review-rendering-scene-assets.md, p615_review-sky-box.md, p616_review-lod-spatial-instancing-lines.md, p618_review-debug-public-api.md, p619_review-schemas-pipeline-devtools-hub.md, p510_headless-simulation-runtime.md
Related: \_DONE_p607_sbp-foundation-feature-modules.md (the features, the seams and what they leave for the moves: "From p607" below), \_DONE_p606_layering-inversion-and-public-entry.md (the entries this plan re-points, `moveRules.ts`, the import codemod)

# Engine Folder Restructure — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Apply p602's folder map to the engine in one mechanical, re-runnable step: moves and renames only,
no behaviour change.

## Scope

- **A codemod** (`devTools/refactor/applyMoveMap.ts`) that reads p602's `moveMap.json`, `git mv`s
  every file and rewrites every import (relative imports, `?raw` / `?worker` suffixes, dynamic
  `import()`s, `loadDebugModuleAsync` paths, SCSS imports), plus the paths in `tsconfig.json`
  (`typedocOptions`), `vite.config.ts`, `eslint.config.js` (`SIMULATION_FILES`, the debug files'
  globs), `devTools/`, the Hub's `<<<` includes and CLAUDE.md. Re-runnable on a fresh `main`, so it
  never needs a hand merge.
- **Since p606, only the entries' own paths change for consumers:** the app and the toolkit import
  the engine only through `aekasha*` (a lint error otherwise), so the codemod rewrites the
  re-export paths in the entry files (`src/_engine/index.ts`, `features/*/index.ts`, `ui/`,
  `debug/`, `schemas/`), never an app import. Also: TypeDoc's module-qualified links, which name a
  module by its path from `src/` (`{@link _engine/InitApp!InitEngine}` in `core/AppData.ts` and
  `core/Scene.ts`; `InitApp.ts` moves to `kernel/init/InitEngine.ts`), and
  `devTools/refactor/moveRules.ts`' own `from` paths once applied (as p606 Phases 6-7 removed
  theirs).
- **The moves** (p602 D2-D7): `core/` into `kernel/` and `features/`; the debug modules next to
  their features (D4), each debug wrapper (`debug/*.ts`) merged into its feature's public module
  with its move (p606 D2; or p618); `ui/` (D5); `utils/` emptied of non-pure code (D6); the
  orphans deleted; the renames (D7: no `Manager` suffix, PascalCase, no `helpers.ts` /
  `Helpers.ts` pair). **Done in p606 Phase 7:** the gameplay pieces (`movingPlatform`,
  `followObjectCameraRig`) are in `src/toolkit/ecs/`, and the gym's test code (`PhysicsStressTest`,
  `world/characterTest*`, `characterObstacles.blend`) in `src/app/scenes/thirdPersonGymScene/`.
  **`ECSStressTest` stays in the engine** (`kernel/ecs/debug/`, `moveRules.ts` and p602 D6, not the
  app): since p606 Phase 4 it has its own core debug keys and hover system and reads nothing of the
  app or the toolkit.
- **What must survive** (p600 §3.7): LS keys, `__saveData`, URL flags, the Hub's `#region`
  includes, the generated data's shape, every scene's snapshot and hash.
- Runs when no other branch is open (p600 §12.4).

## From p607 (2026-10-12)

p607 (the feature modules) is done up to its changelog. What it leaves for the moves:

- **Its new files have their move rules** (`moveRules.ts`; `moveMap.ts --check` passes): each
  `<Name>Feature.ts` into `features/<name>/` (`core/PhysicsFeature.ts`, `core/ViewportsFeature.ts`
  included), `Features.ts` and `Kernel.ts` → `kernel/init/`, `SceneHooks.ts` → `kernel/scene/`,
  `RenderHooks.ts` → `kernel/render/`, `ECS/LodTargets.ts` and `ECS/SpatialMembership.ts` →
  `kernel/ecs/`, `Import/ImportPhysics.ts` → `features/physics/import/`,
  `workers/assets/assetsSwitchSimplify.ts` → `features/lod/worker/`, and the feature schemas it
  moved next to their features (`SkyBox/SkyBoxSchema.ts`, `Lod/LodSchema.ts`,
  `Lod/Impostors/ImpostorSchema.ts`, `PostFX/PostFXSchema.ts`, `Spatial/SpatialSchema.ts`).
- **Mapped but not moved:** `Lod/LodFade.ts` → `kernel/render/LodFade.ts` (the dither primitive
  the LOD system and the instanced LOD pools both draw with).
- **Engine paths p607 hard-coded,** for the codemod's list: `devTools/verify/debugInProduction.ts`
  (`/src/_engine/core/Debug/` and the `debug/*.ts` wrappers), `moduleSideEffects.test.ts`'
  `EXEMPT` (`core/Debug/`, the two worker entries) and `eslint.config.js`' `DEBUG_FILES` (already
  in the scope's list). When D4 moves the debug modules next to their features and the wrappers
  merge into their features' public modules (p606 D2), these patterns follow: `_dbg__*` stays the
  rule, the folder patterns go.
- **Merging a debug wrapper into a feature module** must keep its debug code foldable (p607 D7):
  the calls behind `IS_DEBUG_ENV`, none inside a `try` block (Rollup keeps a `try` block's calls
  whole), and a closure handed to `ctx.onDebug*` that would keep a module alive gated with
  `if (IS_DEBUG_ENV)`. `yarn verify:baselines`' production debug check catches a leftover.
- **The layout report:** "Kernel → feature" has no runtime or dynamic rows, 22 type-only ones
  (p607 D6: they move as they are; p612 decides). Its "Assets worker job modules" section lists the
  worker's two `import()`s of feature code (`assetsWorker.ts` → `assetsSwitchSimplify.ts`,
  `assetsSwitchGLTF.ts` → `LodChainGLTF.ts`), which `moveMap.ts` allows from
  `kernel/assets/worker/`. `moveMap.ts` skips the layer rules for an entry file. The only
  feature → feature runtime dependency is character → physics.
- **`entryExports.json` files an export under its folder's entry,** so the schemas p607 moved show
  under `aekasha/skybox` / `aekasha/lod` while `aekasha/schemas` exports them (p607 Phase 9: no
  name in two entries). Their entry stays `aekasha/schemas`.
- **The system order** is a scene runner baseline now (p607 Phase 1). Nothing registers at module
  load outside the `_dbg__` modules, so a move can't change it, but a `_dbg__` module that another
  imports statically still registers at its first importer's load: a moved import order there
  shows as a system order change.

## Inputs

- p602's move map and decisions; p601's runner and `api.json` (the public surface must not change
  in this plan: the entries re-export from the new paths, and `api.json`'s `entries` lists, p606,
  stay the same name for name).
- p606's tools: `refactor/importGraph.ts` resolves the `aekasha*` aliases (`ENTRY_FILES`), and
  `refactor/migrateToEntries.ts` is the model for a codemod (rules without the file system in a
  tested module, a `--check` mode, nothing written on an error).

## Done when

- The tree matches the map; `api.json`'s exports differ only by their modules' new paths, and its
  `entries` lists are unchanged; p601's runner, `yarn build`, `yarn hub:build` and the lint pass.
- The boundary lint passes unchanged (p606 made it an error everywhere: the app already imports
  only entries). No consumer sees the moves, so the Hub's migration guide gets no path list; an app
  that still deep-imports fails the lint before it gets here.
