Status: draft | not-implemented
Category: Documentation, Refactoring
Related: _DONE_p103_small-bug-fixes-and-tweaks.md (the list this item came from)

# Plan References out of JSDoc — Plan

The engine's and the toolkit's JSDoc cite the plans that made them: `(p607 D7)`, `p610's`, `(p303
Phase 4)`, `i250`. In the code that's useful provenance; in the docs it's noise, and it reaches
readers: the Hub's API Documentation renders the summaries and their details, the search shows each
summary's first sentence as its snippet, and `yarn docs` renders every export. The Hub is going to be
published, so its pages should read as documentation of the engine, not of its history.

The rule this plan sets: **no plan or issue reference inside a `/** */` comment in `src/_engine/` or
`src/toolkit/`.** A reference a maintainer needs moves to a `//` line comment next to the code, which
nothing renders; one that carried meaning is reworded as the fact it pointed at.

## Context (measured 2026-11-25)

- 873 non-test files in `src/_engine` and `src/toolkit` hold 16,544 `/** */` blocks; **839 of them**
  contain `\b[pi]\d{3}\b` (12 only an issue reference).
- What renders where:
  - **The Hub** (`devTools/hub/api/`): a page per export on an entry (`devTools/hub/CLAUDE.md`, the
    API Documentation). 285 comments on 267 public symbols carry a reference. `@internal` members of
    a public class or interface render too, with an "internal" badge (`renderSymbol.ts`), so they
    count.
  - **The Hub's search**: each summary's first sentence is the snippet.
  - **`yarn docs`** (TypeDoc's own theme, `docs-api/`): every export, `@internal` included
    (`tsconfig.json`'s TypeDoc options exclude only `_dbg__`, tests and `index.ts`).
  - **The editor's hover**: all of them.
- Shapes: `(pNNN DN` 330, `(pNNN` 139, `(pNNN Phase N` 54, bare `pNNN` 54, `(pNNN §N` 36, `pNNN DN`
  35, `(pNNN TN` 27.
- The most: `src/toolkit/terrain/material/TerrainMaterialConfig.ts` 36, `TerrainDefine.ts` 25,
  `src/_engine/schemas/TextureSetSchema.ts` 11, `src/_engine/ui/forms/PropertyGridItems.ts` 11,
  `kernel/deviceCapabilities/DeviceScoring.ts` 9, the physics feature's `PhysicsBodies.ts`,
  `PhysicsEntity.ts`, `types/PhysicsBackendTypes.ts` and `worker/PhysicsWorker.ts` 8 each. Most
  rendered: `TextureSetSchema.ts` 9, `TerrainMaterialConfig.ts` 8, `kernel/config/Config.ts` 7,
  `PropertyGridItems.ts` 7, `features/merging/MergeTypes.ts` 6, `features/streaming/StreamingManifest.ts` 6.
- `//` comments: 720 lines in 487 files. TypeDoc never reads them. The one way they reach a reader
  is a Hub include (`<<<`) of a file or region: confirmed in
  `src/toolkit/terrain/procedural/sandRipples/sandRipples.generator.ts` (line 1, included whole).
- No rule says anything about it today: the root `.claude/CLAUDE.md`'s JSDoc line and
  `hub/pages/documentation/coding-standards/jsdoc.md` don't mention plan references.

## Decisions

**D1. The rule's scope.** Every `/** */` block in `src/_engine/**` and `src/toolkit/**`, tests aside;
`_dbg__` files included (they're excluded from the docs, but one rule is easier to follow than a
rule with holes, and the hover shows them). Patterns: `\bp\d{3}\b` and `\bi\d{3}\b`, and the plan
and issue file names (`p303_….md`, `i250_….md`, `_DONE_…`). Not the app (`src/app/`), `devTools/` or
the `docs/` and `hub/` Markdown: the Project section's pages are about the plans.

**D2. What a reference becomes.** Read each one; no blind regex.

- Pure provenance (`(p607 D7)` after a sentence that stands on its own): removed from the JSDoc; when
  it explains *why* the code is as it is, it moves to a `//` comment by the code it explains, or to
  the line above the `/**` when it's about the whole declaration.
- A reference that carries meaning (`p622 removed X`, `since p305 Phase 8`, `see p610 D5`): reworded
  as the fact (`removed in 6.0.0`, `the procedural layer's own input`), with a version where one helps.
  A link target becomes the Hub page or the nested `CLAUDE.md` section that holds the decision.
- An issue (`i250`): a JSDoc that warns about a known problem keeps the warning in words (`Rapier
  mis-solves the joints of disabled bodies`); the issue's file name moves to a `//` comment, or to a
  `{@link}`-free mention of the Hub's issue page when a reader should follow it (`see the Hub's
  issue "Rapier joint on disabled bodies panics"`).
- A summary must not become empty: the docs ratchet (`yarn verify:baselines --docs`) counts
  undocumented exports per folder, and the count may not grow.

**D3. Enforcement.** A lint rule in `eslint.config.js`' jsdoc block, files `src/_engine/**/*.ts` and
`src/toolkit/**/*.ts`, tests excluded:

- `jsdoc/no-restricted-syntax` with a selector on the block's text, or `jsdoc/match-description` with
  a negative pattern (it checks the description and, with `tags`, the tags' text). Check which one
  `eslint-plugin-jsdoc` 63.3.3 (pinned, `.nvmrc`'s Node) supports for the whole block, tags included;
  failing both, a small local rule in `eslint.config.js` that reads the source code's comments.
- Its message names the fix: "Plan and issue references go in `//` comments, not JSDoc (see the
  coding standards' JSDoc page)."
- `warn` until the last phase (the hooks run `--fix` on every edit and fail on errors, and the rule
  can't autofix), then `error`.
- No `--fix`: rewording needs a person.

**D4. Where the rule is written.** The root `.claude/CLAUDE.md`'s Coding standards, its JSDoc line
(one clause: "no plan or issue references (`//` comments hold provenance)"), and
`hub/pages/documentation/coding-standards/jsdoc.md` with an example of before and after.

**D5. Hub includes.** The Hub's includes of engine and toolkit code are part of the rendered surface:
list every `<<<` include of a `src/_engine` or `src/toolkit` file (`hub/pages/**/*.md`) and reword
the plan references inside the included lines (whole file or region). The app's included files
(`src/app/…`) are the example's own code: their references go too where a reader sees them, as the
same rule's spirit, but no lint rule covers the app.

## Phases

### Phase 1: The rule and everything rendered

1. The lint rule as `warn` (D3), and the rule's text (D4).
2. A helper script in the scratchpad (not committed) that lists the blocks per file with their
   reference and whether the symbol renders on the Hub (read from the TypeDoc model the Hub's build
   caches in `.cache/hub/typedoc.json`).
3. The 285 rendered comments and the Hub's includes (D5).
4. `yarn hub:build`, then grep `dist-hub/documentation/` for `\b[pi]\d{3}\b`: 0. `yarn verify:baselines
   --docs`.

### Phase 2: The rest of the engine

`src/_engine/` (kernel, features, ui, schemas, utils, debug, `_dbg__` files): the lint warnings
there to 0.

### Phase 3: The toolkit, the rule's error, the release

1. `src/toolkit/` (the terrain material's config and define first: most of them).
2. The rule to `error`; `yarn lint` clean.
3. `yarn docs`, then grep `docs-api/` for the patterns: 0.
4. Versions: engine patch, toolkit patch (docs only); the `CHANGELOG.md` entry (Engine, Toolkit,
   Project for the lint rule); `yarn checkVersions --against main`; mark the plan done.

Each phase is one or more commits (by folder is fine: the diff is large).

## Risks

- The diff is large and touches many files; it conflicts with branches that edit the same JSDoc.
  Land it between bigger branches, by phase.
- A reworded sentence can lose a nuance the reference carried. When unsure, keep the reference as a
  `//` comment as well.
- The plans' own workflow finds code by plan number (`grep p305`): moving references into `//`
  comments keeps that working; dropping them wouldn't.

## Verification

- `yarn lint` (the rule at `error`: no matches), `yarn test`, `tsc`.
- `yarn verify:baselines --docs` (the ratchet doesn't drop) and `yarn verify:baselines`.
- `yarn hub:build` and `yarn docs`, then a grep of `dist-hub/` and `docs-api/` for `\b[pi]\d{3}\b`
  outside the Project section (`dist-hub/project/`), the Issues pages and the Versions section (the
  changelog cites plans; it's history, out of scope): 0.
