Status: stub — not-implemented
Category: Refactoring, Documentation, Dev tooling
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md

# Review: Schemas, Data Pipeline, Dev Tools and Hub Generator — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope, and records the findings per file group in an "As found" list.

## Scope

- `schemas/` (19 files, 38 of 154 exports documented, 57 Zod-inferred types with 1 comment): documented at the schema (`.describe()` feeds the JSON Schemas' editor tooltips too) or the inferred type, per p605.
- `devTools/gatherAppData.ts`, the asset pipeline (`devTools/assetPipeline/`), the dev files server, the Hub generator (`devTools/hub/`), `devTools/verify/` (p601).
- The Hub's API renderer adapted to the entry points (p602 D3): a module per public entry, the `api:` links fixed.

## Inputs

- p602 D3, p605.
- p605 Phase 5: the Hub's search index was 1,006 kB, under its 1 MB warning after clipping the API summaries to 120 characters. p612 Phase 7 measured it over the warning on `main` too (1,291,232 B, 302,450 gzip at `40063d1`) and 1,316,018 B after p612's JSDoc (each documented symbol stores its first sentence); `yarn hub:build` warns on every run. The next cut is the stored `path` (about 130 kB: 255 page paths repeated per document), a path table on both sides of `searchProtocol.ts`. The schemas' shape keys have no JSDoc yet, so the zod-expanded fields show "No description".
- p612 Phase 1: `ComponentDataMap`'s `notExported` (`ECSCoreComponents.ts`, named by
  `ComponentData`) although the entry exports it. The interface is merged by the toolkit's and the
  app's `declare module 'aekasha'`, and TypeDoc resolves the reference to that merged symbol, which
  has no reflection (a mapped `ComponentData` didn't change it): the Hub's extraction.
- p612 Phases 2-3: the scene runner stopped twice on a page reload mid-run ("Execution context was
  destroyed … navigation": `thirdPersonGymScene` `workerSab`, then `examplePhysics` `workerSab`),
  with no file touched in the second; each scene passed alone with its baseline hash. Not
  reproduced in Phases 5 and 8. A guess, not confirmed: Vite's dependency optimizer reloading on a
  dependency it finds at runtime.
- p612 Phase 8: `yarn sbp`'s group sizes are the modules' gzip before minification, so comments
  count, and the docs ratchet and the group budgets pull against each other: p612's JSDoc grew
  `_engine/kernel/ecs` 14.1 → 16.1 KiB (its minified code about +0.4 KiB), and its budget was raised
  to 17 KiB. Measure the groups on minified code (or without comments).
- p612 Phase 8: `bundleModel.ts`' `keyFiles` numbers same-named chunks (`EngineRapier.js#2`,
  `three.module.js#2`) in the sorted order of their hashed names, so a change elsewhere that moves a
  hash swaps their keys, and `yarn verify:baselines` reports a change with no file's size changed.
  A key from the chunk's content (its facade module or its importer) would be stable.
- p613 Phase 5 (D11): `schemas/RuntimeTypes.test.ts` checks each asset JSON's type against the
  runtime type it reaches (geometry, material, texture, camera, light, mesh, scene). Where the two
  differ only in how the schema is written, the test swaps in the runtime's type, each commented
  there; tighten them on the schema side and drop the swap:
  - `TexOptsSchema`: three's constants (`wrapS`, `minFilter`, …) are plain numbers (p302's D1
    adds named enums, so coordinate), and `image` is `unknown` (a JSON has none: drop it).
  - A light's shadow tuples (`shadowMapSize`, `shadowCameraNearFar`, `shadowCameraFrustum`) use
    `z.array(z.number()).length(n)`, which zod types as `number[]`; `z.tuple` would say it. A
    spot light's `map` is `string | unknown`: `z.string()` (an id).
  - Materials: one object with a `type` enum, against the runtime's member per type
    (`PerType` in the test). A `z.discriminatedUnion` on `type` would match.
  - The scene's inline `meshes` and `importedAssets` aren't validated at all
    (`record<string, unknown>`). The mesh JSON's pair is in the test; an inline import's isn't.
- p613 Phase 5: `ColorJSON` (`schemas/_HelperSchemas.ts`, `{ r, g, b }` 0-255) is on no entry, so
  the runtime types that take it (`LightProps`' colours, `SceneData.backgroundColor`) write it
  inline. Put it on `aekasha/schemas` with a summary, or keep it off and say why.
- p613 Phase 7: `schemas/PostFxSchema.ts`' two comments cite plans that are gone
  (`_DONE_p070_post-fx-system.md`, `_DONE_p071_post-fx-debugger-ui.md`): keep what they explain
  (params as raw JSON values, not uniform nodes; `paramsMeta` as debugger-only hints) and drop the
  paths.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
