Status: stub — not-implemented
Category: Build, Dev tooling, Marketing
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p607_sbp-foundation-feature-modules.md (the main chunk measured, the manifest, `sideEffects`: "From p607" below)

# SBP Tooling, Profiles and Marketing — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Make the Smallest Build Possible visible and enforced (p600 §4.3), prove it with a minimal
example, and tell the world.

## Scope

- **`yarn sbp`:** builds, then reports each feature's size from the module graph, why each
  feature is in the bundle (the import chain from the entry), and the diff against p601's
  `bundle.json`. Budgets per feature and chunk in config; over budget fails, as the asset
  pipeline's budgets do.
- **The banner profile:** an example scene and app entry with a renderer, one scene, a camera and a
  mesh, no physics and no debug. Its gzip size is the measured floor and the Hub example's number.
- **The lite-renderer study** (p600 §4.4): what a profile on three's classic WebGLRenderer without
  TSL would cost the engine (a second material path) and save (well under the 635 kB gzip WebGPU
  floor). A recommendation, not an implementation.
- **Marketing:** SBP as a core principle in the readme's "Why Ækasha?", the Hub homepage's featured
  features, a Hub feature page with the real numbers, and the brand section in CLAUDE.md.

## From p607 (2026-10-12)

- **What p607 measured:** the main chunk `assets/index.js` went from 1251 kB to 377 kB gzip
  (`bundle.json`, p606's end to p607's; the rendered modules' gzip sum 1738 → 818 kB). By group
  (gzip sum), main now holds `three` 617 kB (4 modules), `_engine/core` 71 kB, `core/SkyBox`
  27 kB, `app` 13 kB, `core/Import` 12 kB, `utils` 10 kB, `core/Lod` 9 kB, `toolkit` 8 kB,
  `core/Lines` 8 kB, `core/UI` 8 kB, `core/Spatial` 7 kB, `core/ECS` 7 kB, `core/Physics` 7 kB.
  Rapier (one 810 kB lazy chunk, shared by the worker and the main thread), the glTF / Draco / HDR
  loaders, each TSL material and PostFX file and the assets worker's jobs load on demand.
- **What `yarn sbp` can read:** the gathered data's per-scene manifest (`__features`, the features
  a scene's data uses; scene code isn't in it) and `InitEngine`'s `features`; `bundle.json`'s
  chunks, main chunk and main groups; the production debug check (`findDebugCodeInBuild`).
- **The banner profile** is possible now: `features: []` installs the kernel alone (the ECS,
  meshes, groups, cameras, lights, raycasting, input, scenes), and nothing registers on import, so
  its bundle is what it uses. The kernel still holds frustum culling, groups and raycasting.
- **Left to this plan:** folding code paths from the manifest (p600 §4.2's constants: p607 D10
  only checks it at boot); a `physics()` option to leave the simulation tiers and the tier policy
  out (p607 Phase 5: they're in main for every app with physics, about 4 kB gzip; p607 D1 gave the
  factories no options, and p612 reviews `config.physics`); an icon budget (a production build
  keeps only the icons the app registers, p607 D12).

## Inputs

- p600 §4; p607's feature modules and manifest; p601's baselines.

## Done when

- `yarn sbp` runs in `yarn build` (skippable), with budgets for the app and the banner profile.
- The banner example is in the Hub with its measured size; the readme and the Hub say what SBP is.
