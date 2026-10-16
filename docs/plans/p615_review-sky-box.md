Status: stub — not-implemented
Category: Refactoring, Documentation, Sky box
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md

# Review: Sky Box — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope, and records the findings per file group in an "As found" list.

## Scope

- `SkyBox/` (10 files) and `SkyBox/layers/` (8; 47 of 79 exports documented), its debug folders (17 files: structure and docs only, p800 rewrites the panels).
- The folder's nested `CLAUDE.md` (the sky box section, moved there verbatim by `_DONE_p605`) is checked against the code.

## Inputs

- p600 §2; the three r186 traps CLAUDE.md lists for the sky box (they become `@remarks`).
- p613 Phase 5 (D11's type test): `toSkyColor` (`features/skybox/SkyColor.ts`, 17 callers) reads
  a `{ r, g, b }` colour (the schema's `ColorJSON`, 0-255) as linear, while a `'#rrggbb'` string
  goes through `THREE.Color`'s sRGB conversion, so the two forms of one colour render differently.
  The kernel's `toThreeColor` (`kernel/render/ThreeMath.ts`, `@internal`) reads both as sRGB (the
  lights and the scene background since p613). No sky box JSON uses the object form yet (all 7
  write strings), so moving to `toThreeColor` changes no scene; the debug tab's colour pickers
  are the thing to check.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
