Status: stub — not-implemented
Category: Refactoring, Documentation, Debug
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md

# Review: Debug Public API — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope, and records the findings per file group in an "As found" list.

## Scope

- The debugger framework's public API (`createDebuggerTab`, `createProfilerTab`, `registerStatsSource`, `registerGPUMemorySource`, the dev files, undo / redo, views, draggable windows) and the one debug-module loader: documented with examples, so an app writes its own tab from the Hub page alone.
- The debug folders' structure after p608 (p602 D4).
- **From p608 (D3):** the two debug wrappers p608 left in `debug/`, `debug/Assets.ts` and
  `debug/PostFXProfiler.ts`, merge into their features' public modules here (or stay, with the
  reason). A merged wrapper keeps its debug code foldable (p607 D7: the calls behind
  `IS_DEBUG_ENV`, none inside a `try` block, a closure handed to `ctx.onDebug*` that keeps a module
  alive gated with `if (IS_DEBUG_ENV)`); `yarn verify:baselines`' production debug check catches a
  leftover.
- **Not in scope:** polishing the Tweakpane panels' code (about 40% of the codebase). p800 replaces them; this plan only fixes what is broken or blocks p800.

## Inputs

- p602 D4, the p800 prompt.
- p605 Phase 5's `notExported` warnings in scope (`yarn hub:build` lists each with its file and line; export the type with a summary or change the signature): `PhysicsProbeReport`, `DrawerState`, `DebugKeyShortcutsTab` and `EnvBallOpts` (types in `_dbg__` modules, named by `debug/` entry points) and `AnyStatsSource` (named by `_getStatsSources`).
- p613 Phase 7 (the `perf-auditor` pass): the PostFX profiler source's `availability()`
  (`debug/profiler/_dbg__ProfilerSources.ts`) calls `getRenderPipeline()`, PostFX's provider,
  which builds the chain when it's due. In an editor view, where `renderScene()` doesn't read the
  provider, that poll builds the suspended root scene's chain. A side-effect-free check would do:
  PostFX's `isPostFxEnabled` (`@internal`) and an enabled pass (the module already imports
  `features/physics/` the same way).
- p613 Phase 5: `saveTexture` (`kernel/assets/Texture.ts`, `@internal`) is on no entry, so an app
  can't register a texture it built (a `DataTexture`, a canvas) for the scene release and the
  Assets tab, though `saveBufferGeometry` and `saveMaterial` are on `aekasha`. Decide whether it
  goes there too, with its ownership rules documented.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
