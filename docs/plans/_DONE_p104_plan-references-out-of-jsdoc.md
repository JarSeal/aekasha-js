Status: implemented (Phases 1-3)
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

### Phase 1: The rule and everything rendered — done

1. The lint rule as `warn` (D3), and the rule's text (D4).
2. A helper script in the scratchpad (not committed) that lists the blocks per file with their
   reference and whether the symbol renders on the Hub (read from the TypeDoc model the Hub's build
   caches in `.cache/hub/typedoc.json`).
3. The 285 rendered comments and the Hub's includes (D5).
4. `yarn hub:build`, then grep `dist-hub/documentation/` for `\b[pi]\d{3}\b`: 0. `yarn verify:baselines
   --docs`.

As built:

- **The pattern isn't `\b[pi]\d{3}\b`**: `_` is a word character, so `\b` misses `p303_….md` and
  `_DONE_p094`. The rule and every grep use `(?<![A-Za-z0-9])[pi]\d{3}(?![A-Za-z0-9])|_DONE_`
  (`PLAN_REFERENCE` in `eslint.config.js`; with `grep -P`). Every token it matched in the code was a
  plan or an issue (many of deleted plans); `p95`, `i32`, `p1000` don't match.
- **The rule** is `jsdoc/no-restricted-syntax` with `context: 'any'` and the selector
  `JsdocBlock:has([description=RE]), JsdocBlock:has([name=RE])`: every block (tags, `@example` code,
  Zod shape keys, blocks in function bodies), once per block at its `/**`. `[name=…]` is needed: a
  tag's first word is its `name` (`@remarks _DONE_p094_….md`). `match-description` was dropped: it
  checks only the tags listed one by one. Its own config entry after the JSDoc shape block, files
  `src/_engine/**/*.ts` and `src/toolkit/**/*.ts`, `**/*.test.ts` ignored.
- **The counts at the start** (2026-11-27, after the fog branch): 898 files, 16,979 blocks, 866
  flagged in 423 files; rendered 302 blocks (the helper first found 300: it tested the comment as
  JSON, where a line break's `\n` hid a reference starting a line from the lookbehind; the
  `hub:build` grep found the other two, `STREAMING_MIN_CELL_SIZE` and `BuiltInIcons.ts`' module
  comment, which every icon's page shows because TypeDoc puts the icons' source in vite's
  `client.d.ts`). After Phase 1: 566 flagged in 277 files, none rendered.
- **The rewording:** a reference that was provenance went to one `//` line above the `/**` (several
  joined: `// p348; the cross-fade: p351 §2.4; AUTO: p347`; an issue's file name for an issue). One
  that carried meaning became the fact: "p305's live layers" → "the terrain material's live
  layers", "p343's deterministic tier policy" → "the tier policy's `STEPS` cadence", "p800 D8's
  written deviation" → "a deliberate exception to the kit's accessibility rules", a future plan →
  "is planned". The `(pNNN Dn)` parentheticals made only of references (most of the UI kit's and
  the toolkit's) were removed by a script, `.cache/p104/auto.py`, and reviewed in the diff; the
  rest by hand. Over-long comment lines were rewrapped (Prettier doesn't).
- **The helpers are in the gitignored `.cache/p104/`**, not the scratchpad: they import `eslint` and
  `devTools/hub/api/` from the repo. `report.ts [--lint]` (the blocks, what renders, the includes;
  `report.md` / `report.json`), `show.mjs <prefix>`, `apply.py <edits.json>` (each change must
  match once inside its block), `auto.py <prefix> <out.json>`.
- **The Hub's includes** (112 of `src/` files; `devTools/` and `sbp.config.ts` aren't D5's): the
  comments reworded, the JSON `description`s too (no `//` in JSON: the reference went),
  `p304ProcRipples`' `name` "Procedural ripples". **Kept:** the ids `p304ProcRipples` and
  `p302_gradientMat` (an id is in scenes and `__saveData`; renaming one is its own change).
  `src/generated/generatedAppData.json` was gathered again (descriptions only; the asset pipeline's
  keys don't hash a JSON's text, so `assets.lock.json` didn't change).
- **The coding standards page's example uses `pNNN` / `iNNN`**, so `dist-hub/documentation/` keeps
  none.
- Also fixed: `InitEngine`'s "the template lists all ten" features (seventeen) → "every engine
  feature"; `_dbg__OnScreenTools.test.ts` failed on macOS (Node's `navigator.platform` is the host's:
  `Meta+S`), now pinned to Linux as `_dbg__DebugKeyShortcuts.test.ts` does (a commit of its own).
- **Left on rendered Hub pages outside `documentation/`** (D1 leaves the Hub's Markdown out, but the
  Verification grep covers them; decide in Phase 3): the UI kit's game page's prose "(p808's
  measurement)"; the smallest build page's include of `sbp.config.ts` (`// The banner embed (p611
  D8)`, `p611 Phase 4's report`); the terrain gallery's and showcase's scene names in images' `alt`
  ("Terrain gallery (p303, …, p310)", "Terrain showcase (p310)"); the toolkit page's
  `p302_gradientMat`; the homepage's What's new (the changelog's branch name) and an HTML comment
  in the shell (`p802 D6`, not shown).

### Phase 2: The rest of the engine — done

`src/_engine/` (kernel, features, ui, schemas, utils, debug, `_dbg__` files): the lint warnings
there to 0.

As built:

- **477 blocks in 252 files to 0**, by folder: kernel 97, `features/physics/` 124, the other
  features 97, ui + schemas + utils 73, debug 89 (the debug count grew by 4 between the first
  report and its turn: blocks other edits had split). `report.ts --lint` after it: engine 0,
  toolkit 87 in 24 files, rendered 0.
- **The same rewording as Phase 1**, by the same split: `auto.py` cut the parentheticals made only
  of references (304 blocks, each read in its context first), the rest by hand (187 blocks, some
  of them after an automatic cut). What
  became a fact rather than a `//` line: the kernel installers' "(the kernel, p607)" → "(part of
  the kernel)"; "p352's simulation tiers" → "the simulation tiers"; "p343's deterministic tier
  policy" → "the tier policy's `STEPS` cadence" (Phase 1's); "p299 places cells" → "the asset
  pipeline's atlas packing"; "p309's decals" → "the terrain decals"; "p057 couldn't reproduce it"
  → "a later check"; "pre-p094 keys" → "older versions' keys"; p420 (not started) → "the planned
  NPC simulation tiers". The issue files (i010, i120, i240, i250, `_DONE_on-screen-tools-…`)
  went to `//` lines, their warnings kept in words; RapierJoints.ts's "the issue's second symptom"
  names the symptom.
- **A `//` reference line already above a block takes the new references** (`// p250 D5; i250`)
  instead of a second line: `apply.py` merges into it when it holds a reference.
- **Line-start cuts:** a reference that began a line left a stub (` *.`, ` *: a scene`);
  `fixstubs.py` moves the punctuation up. Long lines were rewrapped, three that were too long
  before this branch too (Anchor.ts' `showAnchored`, `_dbg__GPUMemory.ts`'s header,
  `_dbg__SpatialGridReadouts.ts`).
- **Module headers an older mechanical edit had wrapped mid-sentence** (the material editor's
  modules, `_dbg__EditorDrawer.ts`, `_dbg__ViewCamera.ts`: "The material editor (p084,\n *
  p085), the first…") were rewrapped whole.
- **Not covered by the rule, left for Phase 3 to decide:** bare decision references with no plan
  number, which the lint can't see and a reader can't follow: 78 lines in 37 files of
  `src/_engine` (`(D6)`, `(§9 of the plan)`, `(Phase 0 finding 5)`, `DD5`; most in spatial,
  streaming, instancing, merging and the UI kit), all older than this branch. Where a cut of
  this phase orphaned one, it was fixed (DeviceObserver.ts, SceneDataLoader.ts,
  DefaultDebugKeyBindings.ts, `_dbg__GPUMemory.ts`, StreamingBodies.ts). Also seen:
  `_dbg__LightShadowItems.ts`' select still says "Tweakpane's `view: 'list'` blade".
- **The helpers added** (`.cache/p104/`): `scan.py <prefix>...` (report.json's shape from the
  files, no ESLint), `blocks.py <prefix> [--count]` (the flagged blocks with line numbers),
  `review.py <edits.json>` (each cut in context, `BAD` at a line start), `fixstubs.py <file>...`;
  `auto.py` takes `--all` (not only rendered blocks) and a report path; the batches are
  `p2-<folder>-auto.json` / `p2-<folder>-manual.json`.
- Checked after each folder: ESLint, `tsc` (and `tsc -p hub` for the kit), `yarn test`,
  `yarn verify:baselines --docs` (4652 / 4652 exports, unchanged).

### Phase 3: The toolkit, the rule's error, the release — done

1. `src/toolkit/` (the terrain material's config and define first: most of them).
2. The rule to `error`; `yarn lint` clean.
3. `yarn docs`, then grep `docs-api/` for the pattern (Phase 1's As built): 0.
4. Versions: engine patch, toolkit patch (docs only); the `CHANGELOG.md` entry (Engine, Toolkit,
   Project for the lint rule); `yarn checkVersions --against main`; mark the plan done.

As built:

- **The toolkit's 87 blocks in 24 files to 0** (123 in 40 on `main`; Phase 1 did the rendered
  ones), in three stops: `terrain/material/` (63; `auto.py` 54, by hand 10), the rest of
  `terrain/` (18, by hand) and `materials/` with `geometry/` (6, `auto.py`). The batches are
  `p3-<folder>-auto.json` / `p3-<folder>-manual.json`. What became a fact: "(p240's scale)" →
  "(the engine's `QualityLevel` scale)"; "p303 D2's packings" → "by its set's packing"; the
  planar frame's "p305 D5 projects it" → "a projection covers it"; "p307's regional wetness" →
  "the wet response's regional wetness"; the `TAPS` view's "p301 §6's estimate made visible" →
  "as `estimateTerrainFetches` counts them".
- **The rule is `error`**; `yarn lint` 0 errors (its 4 warnings are the generated
  `generatedAppFns.ts`' `camelcase`, older than this branch). `yarn docs`: 5,352 pages, 0 matches.
- **Phase 1's leftovers on the Hub, decided:** reworded the UI kit's game page ("200 anchors
  measured about 0.1 ms a frame"), `sbp.config.ts`' `banner-profile` region (the facts kept; the
  plans on one `//` line above the `#region` marker, outside the include) and the two scenes'
  names, which are their images' `alt` ("Terrain gallery", "Terrain showcase"; an app patch).
  Kept, as Verification says: `p302_gradientMat`, the homepage's What's new and the shell's HTML
  comment.
- **Versions:** engine (and project) 6.30.0 → 6.30.1, toolkit 3.8.1 → 3.8.2, app 1.38.0 →
  1.38.1. The branch is shared with p105 (not started): its entry and bumps extend this one, a
  minor bump raising these patches.

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
- `yarn hub:build` and `yarn docs`, then a grep of `dist-hub/` and `docs-api/` for
  `(?<![A-Za-z0-9])[pi]\d{3}(?![A-Za-z0-9])|_DONE_` (`grep -P`; Phase 1's As built) outside the
  Project section (`dist-hub/project/`), the Issues pages and the Versions section (the
  changelog cites plans; it's history, out of scope): 0, but for three left on purpose: the
  toolkit page's `p302_gradientMat` (an asset id: renaming it is its own change), the homepage's
  What's new (the changelog's latest branch name) and the shell's HTML comment `p802 D6` (not
  shown).
