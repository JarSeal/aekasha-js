Status: in progress | Phases 1-4 implemented
Category: Refactoring, Architecture
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B)
Blocks: p609_toolkit-and-app-restructure.md, p610_character-and-input-action-architecture.md, p611_sbp-tooling-profiles-and-marketing.md, p612_review-ecs-loop-config-init.md, p613_review-rendering-scene-assets.md, p615_review-sky-box.md, p616_review-lod-spatial-instancing-lines.md, p618_review-debug-public-api.md, p619_review-schemas-pipeline-devtools-hub.md, p510_headless-simulation-runtime.md
Related: \_DONE_p602_architecture-and-target-structure.md (the folder map, D2-D7), \_DONE_p607_sbp-foundation-feature-modules.md (the features, the seams and what they leave for the moves, folded into §2-§7), \_DONE_p606_layering-inversion-and-public-entry.md (the entries this plan re-points, `moveRules.ts`, the import codemod)

# Engine Folder Restructure

p602's folder map applied to the engine: `core/`, `workers/`, `styles/`, `3dModels/` and most of
`utils/` become `kernel/`, `features/`, `ui/` and `debug/`, by a codemod that reads
`devTools/refactor/moveMap.json` and runs again on a fresh `main` instead of being merged by hand.
Moves and renames only: no behaviour, public API or bundle content changes. The toolkit and the
app's moves (the map's `p609` entries) are p609's, with the same codemod.

---

## 1. Goal

- **The folder says what a file is** (p602 D2): `kernel/<area>/`, `features/<name>/`, `ui/`,
  `debug/`, `utils/` (pure), `schemas/`, `types/`. Each feature's code, worker, debug modules and
  nested `CLAUDE.md` in its folder (D4), and file names by D7.
- **Nothing a consumer sees changes:** the entries keep their files and their export lists
  (`api.json`'s `entries`), every scene's hash and snapshot stays, and the main chunk's code is the
  same (its modules have new paths).
- **Re-runnable:** the tree after the move is a function of `main` and the rules. If `main` moves
  while this branch is open, the move commit is dropped and generated again, never merged.
- **The tooling outlives the move:** p609 applies its entries with the same codemod, and
  `moveMap.ts`' layout report keeps checking the new layout's boundaries.

## 2. Grounding (checked against the code, 2026-10-12)

On `engine-folder-restructure`, cut from `main` at `4154a88` (the `stage-b` merge: Engine 5.0.0
Golden Hour, Toolkit 2.0.0 Half Moon, App 1.10.0). `npx tsx devTools/refactor/moveMap.ts --check`
passes: the map and its reports are current.

### 2.1 The move map

- **509 files:** p608 437 (move 400, keep 32, delete 3, split 2), p609 72 (move 63, keep 9).
  Every p608 entry is under `src/_engine/`; no app or toolkit file moves in this plan.
- **The 400 moves:** 312 `.ts`, 52 `.svg` (the icons), 21 `.scss`, 7 `.md` (the nested
  `CLAUDE.md` files, with their folders), the 3D symbols' `.glb`, `.png` and `.jpg`, two `.blend`,
  one `.kra` and the icons' licence.
- **23 are case-only renames in place:** the 19 schemas (`schemas/sceneSchema.ts` →
  `SceneSchema.ts`, `featureSchemas.test.ts` with its module), `utils/assert.ts`, `deepMerge.ts`
  (and its test), `jsIdentifier.ts`, and `moduleLoad.test.ts`. macOS's file system is
  case-insensitive (`core.ignorecase` is `true` here); Linux and WSL2's aren't.
- **The 32 keeps:** the 13 entries (`index.ts`, the 9 `features/<name>/index.ts`, `ui/`, `debug/`,
  `schemas/`), 12 `debug/*.ts` wrappers (the debugger framework's own API, p602 D4), the two
  `types/*.d.ts` and five `utils/` files (`Logger`, `LocalAndSessionStorage`, `PromiseResolver`
  and its test, `StatsClock`). **No entry file moves,** so `devTools/aliases.ts`, `tsconfig.json`'s
  `paths` and the Vite and Vitest aliases don't change; only the entries' re-export paths do.
- **p607's new files have their rules:** each `<Name>Feature.ts` into `features/<name>/`,
  `Features.ts` and `Kernel.ts` → `kernel/init/`, `SceneHooks.ts` → `kernel/scene/`,
  `RenderHooks.ts` → `kernel/render/`, `ECS/LodTargets.ts` and `ECS/SpatialMembership.ts` →
  `kernel/ecs/`, `Import/ImportPhysics.ts` → `features/physics/import/`, `assetsSwitchSimplify.ts`
  → `features/lod/worker/`, and the feature schemas next to their features. `Lod/LodFade.ts` (the
  dither fade the LOD system and the instanced LOD pools both draw with) goes to
  `kernel/render/LodFade.ts`. The schemas p607 moved stay on `aekasha/schemas` (no name in two
  entries), though `entryExports.json` files them under their folder's entry: it's evidence, not
  the entries.
- **The 3 deletes:** `utils/materials/checkerBoardPattern.ts` and `nestedGridPattern.ts` (no
  importers) and `core/UI/3DSymbols/3DSymbolsTextures.png~` (an editor backup).
- **The 2 splits:** `utils/helpers.ts` (624 lines, 30 exports into 9 modules) and
  `utils/constants.ts` (67 lines, 8 exports into 2). Neither has a top-level declaration that
  isn't exported, so each statement goes with its export. `helpers.ts` imports `Config.ts`
  (`IS_DEBUG_ENV`), `Logger`, `Material.ts`' `Materials` type and `constants.ts`'
  `textureMapKeys`; its targets import those, and each other, as their parts need.
- **Two wrappers move:** `debug/Assets.ts` → `kernel/assets/debug/Assets.ts` and
  `debug/PostFXProfiler.ts` → `features/postfx/debug/PostFXProfiler.ts`, both with the note "merged
  into the feature's public module with its move (p608 / p618)". The merge isn't a map action:
  the map only moves them. (D3: they stay in `debug/` until p618.)
- **The layout report on the target layout:** kernel → feature 23 type-only imports in 14 files
  (p607's notes counted 22; p607 D6: they move as they are), ui → kernel 2 runtime
  (`DraggableWindow.ts` → `Config.ts`, `addResizer`; p617), schemas → kernel 1 type-only
  (`_helperSchemas.ts` → `ManagedByData`). No feature cycle; feature → feature is character →
  physics (3 runtime, 2 type) and instancing → lod (1 type). Its "Imports of split, merged and
  deleted files" table is empty: every import of a split file names exports its split lists (no
  namespace import), and nothing imports a deleted file.

### 2.2 What the codemod rewrites

The import graph (`refactor/importGraph.ts`) reads 3385 imports in 515 modules (`src/` and
`devTools/`). The forms in them:

- **TypeScript:** static imports, `import type`, `export … from` and dynamic `import()`, all with
  string literal specifiers (91 dynamic ones in the engine, none computed). The debug loader's 64
  calls are `loadDebugModuleAsync(() => import('./Debug/_dbg__X'))`: plain dynamic imports, no
  path strings.
- **Vite suffixes:** 50 `?raw` (the icons' SVGs), 2 `?url` (`debug/3DSymbols.ts` → the symbols'
  `.glb` and `.png`), 2 `?worker` (`PhysicsAPI.ts` and `Assets/AssetsAPI.ts` → the worker entries).
- **Styles:** 16 TS imports of a `.module.scss`, 2 side-effect imports (`DropDown.ts` →
  `DropDown.scss`, `InitApp.ts` → `styles/index.scss`), and 27 `@use` / `@forward` lines with
  relative paths, among them a partial named without its underscore (`@use './debugTabButtons'`
  → `_debugTabButtons.scss`) and `styles/index.scss`' `@forward './debugger.scss'`, which the map
  splits up (`styles/` → `ui/styles/`, `debugger.scss` → `debug/`). The one `url()`
  (`DebuggerGUI.module.scss`) is an absolute `/debugger/…` path: nothing to rewrite.
- **A glob:** `moduleLoad.test.ts`' `import.meta.glob`, whose negations name the two worker
  entries, and its `import('./core/Config')`.
- **The devTools import the engine by deep relative path:** 64 imports in 25 files (the schemas,
  `debug/DevFilesProtocol`, `core/Lod/LodChain*` in `assetPipeline/lodChains.ts`,
  `debug/TestBridge` in `verify/scenes.ts`, …). `vite.config.ts` loads some of them through its
  plugins.
- **TypeDoc's module-qualified links:** 4 `{@link _engine/InitApp!InitEngine}` (`core/AppData.ts`
  3, `core/Scene.ts` 1). The one other path in a call is `Features.test.ts`'
  `vi.mock('../utils/Logger', …)`. No import sorting rule in the lint, so a specifier rewritten in
  place leaves the import order as it was.
- **Paths in text:** the layout report's "Paths outside the import graph" lists 31 files (the root
  `CLAUDE.md` 51 mentions of 45 paths, `core/Debug/CLAUDE.md` 12, `eslint.config.js` 8, …).
- **Globs and regexes keyed on today's folders**, which aren't one-to-one string rewrites:
  - `eslint.config.js`: `DEBUG_FILES` and the debug files' override (`src/_engine/core/Debug/**`),
    `SIMULATION_FILES` (9 entries, two of them globs: `core/Physics/**/*.ts`,
    `core/Character/**/*.ts`) and the two per-file overrides (`DynamicCharacter.ts`,
    `PhysicsWallClock.ts`). `core/Physics/` lands in `features/physics/`, which also holds the
    facade, the worker, the import extension and the physics debug modules: the glob can't just
    follow it.
  - `devTools/verify/debugInProduction.ts`: a debug module is `_dbg__*` or under
    `/src/_engine/core/Debug/`, a wrapper any `/src/_engine/debug/*.ts` but the entry.
  - `devTools/verify/moduleSideEffects.test.ts`' `EXEMPT` (`core/Debug/`, the two worker entries).

### 2.3 Debug placement

- **Every `.ts` in `core/Debug/` is a `_dbg__` module** (92); the folder's other files are 15
  `.scss` and two `CLAUDE.md`. So the checks' `core/Debug/` patterns catch no TypeScript that
  `_dbg__*` doesn't.
- **What ships out of a future debug folder** (the visualizer data of the last production build,
  `dist-stats/`, mapped through `moveMap.json`): of the files that land in a `debug/` folder
  without a `_dbg__` name, only one has rendered code in production: `utils/helpers.ts` (10.4 kB
  in `index.js`), whose split sends the debug loaders (`loadDebugModule`, `loadDebugModuleAsync`,
  `useDebug`, `isDebugReady`, `DebugModuleRef`) to `debug/DebugModules.ts`. Shipping code calls
  them (they return `null` / `undefined` first in production, p607 D7), so that module would be a
  `debug/*.ts` file with rendered code: `debugInProduction.ts` fails it as a wrapper.
  `DefaultDebugKeyBindings.ts`, `core/Helpers.ts`, `PercentagePieHtml.ts`, `ECSStressTest.ts`, the
  3D symbols and the 12 kept wrappers render nothing.

### 2.4 Baselines keyed by path

- **`api.json`:** `modules` is keyed by source path (242 modules), so every moved module reads as
  "an export moved" and fails `yarn verify:baselines`. `entries` (16 entries, by name) doesn't
  change.
- **`docs.json`:** per folder (32: `engine/core/Lod`, `engine/workers/physics`, …). Its ratchet
  starts a new folder at no undocumented exports, so the moved folders fail until
  `--update --allow-docs-drop` (the verify `CLAUDE.md` already names p608 for that flag).
- **`bundle.json`:** chunks by file name; 7 are named after a module that's renamed
  (`assetsSwitchGLTF.js`, `assetsSwitchSimplify.js`, `assetsSwitchTexture.js`, `assetsWorker.js`
  twice, `physicsWorker.js` twice: each becomes PascalCase), which the diff reads as a removed and
  a new chunk. `mainGroups` has 16 groups per engine folder (`_engine/core/Lod`, …).
- **The scene runner's baselines** are per scene id and configuration, and the system order per
  system id: no paths.

### 2.5 The Hub and the docs

- **No Hub include or `#region` in engine code,** and no `repo:` link into it: the Hub build's
  include check has nothing to catch here.
- **The API pages are per module path** (`devTools/hub/api/model.ts`:
  `documentation/engine/core/SceneLoader/`; a module next to a same-named folder, `core/ECS.ts` and
  `core/ECS/`, has the folder's URL). Every engine API URL changes. 20 `hub:documentation/engine/…`
  links (19 targets: 17 under `core/`, `debug`, `schemas`) in 10 files; `yarn hub:build` fails on a
  dead one. The Hub server has no redirects (`devTools/hub/serve.ts` adds only a trailing slash).
- **`aek:covers`** names `CLAUDE.md` sections, not paths: the 7 nested `CLAUDE.md` files move with
  their folders and keep their sections.
- **Prose that names today's layout:** the root `CLAUDE.md` (35 lines with `core/…`), the nested
  ones, the feature guides (`physics` 4, `rendering` 3, …), `readme.md`'s tree (lines 161-166:
  `core/`, "`debug/` … lazy-load `core/Debug/_dbg__*`"), three `docs/issues/` files and
  `docs/techniques/hub-authoring.md`.
- **History that keeps today's paths:** the engine 5 migration guide
  (`hub/pages/documentation/migration/engine-5.md`, whose before / after examples import
  `./_engine/core/Renderer` and list the moved `utils/` files), `CHANGELOG.md` and the plans.

### 2.6 Blockers and branches

- **p299** (texture arrays and atlases, "in progress | Phases 0-4 implemented"): Phases 0-4 are on
  `main`; its branch `texture-arrays-and-atlases` has no commit `main` lacks, and its atlas work is
  in `CHANGELOG.md`. Phase 5 (material JSON binding) waits on p302 D4, and p302 is "draft |
  not-implemented". Phase 6 (docs and versioning) is partly done: `asset-optimization.md` has the
  atlas slots, the root `CLAUDE.md` the two suffixes. No p299 code is in flight; what's left would
  be written against the new paths. It doesn't block p608 (D1).
- **Other branches:** the local branches with commits `main` lacks are `donotdelete-pre-aekasha`
  and `test`, both at `46bdca0` (2026-03-26): an archive, not work in flight (p600 §12.4: p608 runs
  with no other branch open). Open PRs weren't listed (no `gh` here): check before Phase 1.
- **Versions:** p600 §11 and p606 D5 put the majors on `stage-b` (shipped as 5.0.0 / 2.0.0) and
  make p608-p611 minor or patch bumps, since consumers import only entries from 5.0.0 on.

## 3. Decisions

All recommended in the grounding's review and confirmed by the user (2026-10-12).

### D1. p299 doesn't block p608

p299's code is on `main` and its branch has nothing `main` lacks (§2.6). Phase 5 waits on p302,
which isn't started; Phase 6 is documents and a version bump. Holding a whole-engine move for them
would hold every Stage B and C plan behind p302. What p299 still writes uses the new paths (a note
in p299 says so). p600's roadmap and §9 drop "p299 merged" as p608's condition.

### D2. The debug loaders go to the kernel: `kernel/config/DebugModules.ts`

p602 D6 sent `helpers.ts`' debug loaders to `debug/DebugModules.ts`. They're the one gate every
module's debug path goes through, and shipping code calls them (§2.3), so they're kernel code that
reads the flags: next to `Config.ts`, which defines `IS_DEBUG_ENV` and reads `__AEK_DEBUG__`. A
`moveRules.ts` change (the split's five targets). It keeps D4 below true without an exception:
**a debug folder holds nothing that ships.**

### D3. The debug wrappers merge in p618, not here

`debug/Assets.ts` and `debug/PostFXProfiler.ts` stay in `debug/` (their two file rules go, so
they're keeps like the other 12). Merging a wrapper into its feature's public module edits code
(p607 D7's foldability rules: no debug call in a `try`, gated `ctx.onDebug*` closures), which a
mechanical, re-runnable move shouldn't, and moving a wrapper without merging it would leave an
`aekasha/debug` export in a feature folder for a while (`entryExports.json` would file it under
the feature). p618 decides per wrapper and merges them with the review of the debug entry. This
plan's stub had "each debug wrapper merged … with its move": that moves there.

### D4. Debug code is found by name, and debug folders by the production check

- **The lint (`DEBUG_FILES`, the debug files' override) and the side-effects test (`EXEMPT`) key
  on `_dbg__*` alone:** every `.ts` under `core/Debug/` is one already (§2.3), so dropping the
  folder patterns changes no file's rules. The worker entries stay exempt by their paths.
- **`debugInProduction.ts`:** a debug module is `_dbg__*`, or any module under a folder of the
  engine named `debug`, matched without case (`src/_engine/debug/`, `kernel/<area>/debug/`,
  `features/<name>/debug/`, and today's `core/Debug/`, the only other one), except the entry
  `src/_engine/debug/index.ts`. That replaces both today's `core/Debug/` pattern and the wrapper
  regex, keeps catching the `.module.scss` files (the test's `About.module.scss` case), holds on
  today's tree (the wrappers render nothing) and holds after the move with no edit (D2: the
  loaders are out of `debug/`).
- These changes don't depend on the move, so they land before it (Phase 1), and the move's edit
  table (D5) has fewer patterns to carry.

### D5. Globs and regexes go through a checked edit table

The codemod rewrites exact paths itself. What it can't (a glob or regex that stands for a folder,
§2.2) is an explicit table next to the rules: file, the text to find, its replacement. An edit
whose text isn't found fails the run, so a `main` that changed the line is caught on the rerun, not
merged past. Each glob edit is checked: the old glob expanded on the tree before the move, mapped
through the move map, must equal the new glob expanded after it.

**The sets stay equal.** `SIMULATION_FILES`' `core/Physics/**` and `core/Character/**` don't become
`features/physics/**` and `features/character/**`: those folders also hold the feature's install,
its entry, the physics import extension and the debug modules, which the simulation lint doesn't
cover today. The new entries list the same files (globs with `ignores`, or file paths). Widening
the lint to a whole feature folder is p614's (physics) and p610's (characters) call.

### D6. Which text the codemod rewrites

- **Rewritten:** exact paths, in their full (`src/_engine/core/Scene.ts`) and engine-relative
  (`core/Scene.ts`) forms, with or without `.ts`, in the `CLAUDE.md` files, `hub/pages/`,
  `docs/issues/`, `docs/techniques/`, `readme.md`, the configs and `devTools/` (§2.2's list), and
  TypeDoc's module-qualified links in code comments (`{@link _engine/InitApp!InitEngine}` →
  `{@link _engine/kernel/init/InitEngine!InitEngine}`).
- **Not rewritten (history):** `CHANGELOG.md`, `docs/plans/` (a plan is grounded against the code
  when it's expanded, as the stubs p608 blocks will be), the migration guides
  (`hub/pages/documentation/migration/`: engine 5's before / after examples are the old paths) and
  `devTools/refactor/` (D9 handles the rules).
- **By hand, in the Hub and CLAUDE.md phase:** prose that describes the layout rather than naming
  a file (the root `CLAUDE.md`'s "Three-folder split" and Architecture map, `readme.md`'s tree,
  "`core/` into …" sentences) and short forms the codemod can't tell apart (`Lod/LodSchema.ts`
  without its `core/`). The codemod lists every remaining mention of an old path it didn't rewrite.
- **The devTools keep their deep relative imports** (rewritten to the new paths). Moving them to
  the entries is p619's review: some import internals no entry exports (`LodChainGLTF`,
  `GeometryTransfer`).

### D7. The Hub's API URLs change, without redirects

The API pages are per module path (§2.5), so every engine URL moves. The codemod rewrites each
`hub:documentation/engine/<path>` link to the page of the module it names (a folder link to the
folder its files land in; one whose files scatter is an error to fix by hand). No redirects: they
would serve one interim layout, since p619 switches the API reference to the entries, which
changes the URLs again. `yarn hub:build` fails on any dead link left.

### D8. Versioning: Engine patch, 5.0.0 → 5.0.1

p600 §11 makes Stage C's "internal refactors" patches, and p606 D5 says p608-p611 are minor or
patch bumps because consumers import only entries from 5.0.0 on. p608 adds no API and changes no
entry's exports (`api.json`'s `entries` stay), so it's a patch: **Engine 5.0.1 (Golden Hour), the
project version with it.** Toolkit 2.0.0 and App 1.10.0 don't change (no file of theirs moves:
the toolkit and the app import only entries). The `CHANGELOG.md` entry has an Engine section (the
moves, the new layout, the Hub's new API URLs) and a Project section (the codemod, the checks'
new debug rule).

### D9. After the move, the rules describe the new layout

Once applied, the p608 rules' `from` paths no longer exist (as p606 Phases 6-7 removed their own
rules). They're replaced by keep rules for the new layout (`kernel/`, `features/`, `ui/`, `debug/`,
`utils/`, `schemas/`, `types/`, and the engine root's files), so `moveMap.ts` still maps every
engine file, a new file outside the layout fails it, and the layout report keeps checking the
boundaries. p609's rules (the toolkit and the app, which don't move here) stay as they are.

### D10. No example scene

Nothing visible changes; the scene runner checks every existing scene in every configuration, and
the Hub phase updates text and links only.

## 4. The codemod

`devTools/refactor/applyMoveMap.ts`, modelled on p606's `migrateToEntries.ts`: the rules in modules
without the file system, tested on in-memory trees; everything computed before anything is
written, and nothing written on an error.

```
npx tsx devTools/refactor/applyMoveMap.ts --plan p608            # apply to the working tree
npx tsx devTools/refactor/applyMoveMap.ts --plan p608 --dry-run  # apply in a scratch worktree, then tsc + tests there
npx tsx devTools/refactor/applyMoveMap.ts --verify-commit <sha>  # is <sha> exactly the tool's output on its parent?
npx tsx devTools/refactor/applyMoveMap.ts --leftovers <base-sha> # old paths still named, by <base-sha>'s map
npx tsx devTools/refactor/compareBaselines.ts <base-sha>         # the baselines after the move, against <base-sha>'s mapped through the map
```

`--plan` picks the map's entries (`p608`, later `p609`); the other plan's files stay where they are
but are rewritten when they import a moved one.

### 4.1 Modules

| Module                | What                                                                                                                                                                          | Tested by                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `moveApply.ts`        | The path map (old → new for every tracked file, unmoved ones to themselves), the specifier and text rewrites, the result: renames, deletes, new texts, leftovers, errors      | `moveApply.test.ts`: small trees in memory (no fixture under `src/`: it would be gathered and linted) |
| `moveText.ts`         | The text rewrite (D6's file kinds, paths, `hub:` links, TypeDoc's links, comments only for `src/` modules) and the leftovers; split from `moveApply.ts` for the 800-line rule | `moveText.test.ts`                                                                                    |
| `moveSplit.ts`        | Splits a module per export (§4.4)                                                                                                                                             | `moveSplit.test.ts`                                                                                   |
| `moveEdits.ts`        | The edit table (D5): `{ file, find, replace, glob? }`                                                                                                                         | the glob check, at run time                                                                           |
| `moveTree.ts`         | `rewriteTree`: the rewrite, the splits, the edit table and the leftovers on a whole tree (Phase 3: out of `moveApply.ts`, so no module imports in a cycle)                    | `moveTree.test.ts`, today's tree included                                                             |
| `applyMoveMap.ts`     | The CLI: preconditions, reading, `git mv`, writing, Prettier, the report, `--dry-run`, `--verify-commit`                                                                      | the dry run on the real tree                                                                          |
| `compareBaselines.ts` | §4.7                                                                                                                                                                          | `compareBaselines.test.ts`                                                                            |

It reuses `importGraph.ts` (`parseModuleSource`, `resolveSpecifier`), `moveRules.ts`' types and
`devTools/hub/api/model.ts`' page URL rule (so a rewritten `hub:` link is the URL the generator
makes). Each module stays under the 800-line rule.

### 4.2 Preconditions

- A clean working tree, and `moveMap.ts --check` passing: the map was generated from this tree
  (D9's "regenerate on a fresh `main`").
- Every entry's `from` exists, every `to` is free (or the file's own path in another case), and no
  two files land on one path (the map checks it too; checked again on the tree it runs on).

### 4.3 What it rewrites

Every rewrite resolves against the **old** tree and writes against the **new** one: a specifier is
resolved from its importer's old path to the old target, both are mapped, and the new specifier is
the relative path between their new paths.

- **TypeScript** (`src/`, `devTools/`, `hub/`'s TypeScript, `vite.config.ts`, `vitest.config.ts`),
  from the AST, replacing only the string literal's range (quotes kept, no reordering):
  - import and `export … from` declarations, `import type`, dynamic `import('…')`;
  - the first argument of `vi.mock`, `vi.doMock`, `vi.importActual` (`Features.test.ts` mocks
    `'../utils/Logger'`) and of `new URL('…', import.meta.url)`;
  - `import.meta.glob`'s patterns: each pattern's matches on the old tree, mapped, must be what the
    rewritten pattern matches on the new one (a folder that moved whole keeps its pattern shape);
    otherwise it's an error for the edit table.
  - **The specifier's style is kept:** with or without `.ts`, `/index` written or not, the query
    (`?raw`, `?url`, `?worker`) as it was, `./` for a sibling. The `aekasha*` aliases and packages
    are left alone.
  - **An import of a split file** becomes one declaration per target module, each with the names
    that go there, in the original's place and kind (`import type` stays `import type`). A
    namespace import of a split file is an error (none today, §2.1).
- **SCSS:** `@use`, `@forward` and `@import` with a relative path, resolved as Sass does (as
  written, `.scss`, the `_partial`, `index.scss`), the written form kept (`'./debugTabButtons'`
  stays without its underscore). `sass:` modules and absolute `url()`s are left alone.
- **Text** (D6's list of files and folders, and the comments of every TypeScript file):
  - a moved file's path in its full (`src/_engine/core/Scene.ts`) and engine-relative
    (`core/Scene.ts`) forms, with or without `.ts`, between the same boundaries `moveMap.ts`' report
    uses (`(?<![\w/.-])…(?![\w/.-])`, so `'../core/Scene'` inside an import isn't matched twice);
  - `hub:documentation/engine/<path>` links, to the page of the module or folder they name (D7),
    with their `#anchor`;
  - TypeDoc's `{@link _engine/<path>!Name}`.
- **The edit table** last (D5): each `find` must occur exactly as often as the entry says (once by
  default), and a `glob` entry is checked file set against file set.

### 4.4 Splitting a file

`utils/helpers.ts` and `utils/constants.ts` (§2.1) are split by their top-level statements: each
goes to the target of the export it declares, with its leading comments and JSDoc. Each target
module gets the original's imports that its statements use (by identifier, from the AST), imports
of the other parts it uses (`removeObjectFromMemory` and its siblings stay together; a part that
uses `textureMapKeys` imports it from `utils/Constants.ts`), and nothing else. A target that's
also a moved file's path (`kernel/render/Object3DHelpers.ts` gets `isOnlyObject3D`), another split's
target (`kernel/render/ThreeMath.ts` takes parts of both) or the source's own new name
(`utils/constants.ts` → `utils/Constants.ts`) gets the parts appended after its own code, in
`moveRules.ts`' order, with the imports merged and deduplicated. Errors: a non-exported top-level
statement, an export with no target (the map checks it), a part that would import itself in a
cycle the original didn't have.

### 4.5 Applying it

1. Everything above in memory, then the report: the moves, the splits, the texts changed, the
   **leftovers** (every mention of an old path the rewrite didn't take, in files outside D6's
   history list: the hand list for the Hub and CLAUDE.md phase) and the errors. On an error,
   nothing is written.
2. `git mv` every move in two steps through a temporary name (`a.ts` → `a.ts.p608tmp` → its
   target), which makes case-only renames work on macOS's case-insensitive file system and keeps a
   move from landing on a path another one is about to leave. `git rm` the deletes and the split
   sources, write the new texts, `git add` them, remove the emptied folders.
3. Prettier on every written file (a longer path can wrap a line), as `migrateToEntries.ts` does.
   No other formatting.

`--dry-run` runs the same on a scratch worktree of `HEAD` (`.cache/refactor/worktree/`, with a
`node_modules` symlink), then `tsc`, `tsc -p hub` and `yarn test` there, and removes it: the whole
move checked before the working tree sees it.

### 4.6 Re-runnable: the commit layout

The branch keeps its commits in three groups, so a moved `main` costs a rerun, not a merge:

1. **Before the move:** the codemod, its tests, the rules changes (D2, D3), the checks' debug rule
   (D4) and this plan. Small files that rarely meet `main`'s changes.
2. **The move:** one commit, the tool's output and nothing else, its message naming the command and
   the commit it ran on. `--verify-commit <sha>` reruns the tool on `<sha>`'s parent in a scratch
   worktree and fails on any difference, so a review checks the tool, not 400 files.
3. **After the move:** the rules for the new layout (D9), the prose (the Hub and CLAUDE.md phase),
   the new baselines, the version and the changelog. They touch the new paths and the prose.

When `main` moves: rebase group 1 onto it, drop the move commit, regenerate the map
(`moveMap.ts`), run the tool again and commit, then cherry-pick group 3 (git's rename detection
carries a prose edit; a conflict there is in a document, not in code).

### 4.7 The baselines after the move

`compareBaselines.ts <base-sha>` reads the three baselines at `<base-sha>` (`git show`) and the ones
`yarn verify:baselines --update --allow-docs-drop` just wrote, maps the old ones through the move
map, and fails unless:

- **`api.json`:** the mapped `modules` equal the new ones (a split's exports under their targets),
  and `entries` are identical;
- **`docs.json`:** the totals are equal, and every undocumented name is undocumented in the same
  module at its new path (the per-folder counts follow);
- **`bundle.json`:** each chunk, its name mapped (§2.4's 7 renamed chunks), is within the diff's
  tolerance (1 % or 2 kB of gzip), no chunk is new or gone, and the main chunk's totals are within
  it too (its groups are renamed, so they're compared as a sum).

So the `--update` that goes into group 3 is checked to differ from `main`'s only by paths.

## 5. Phases

Phases 1-4 are commit group 1 (§4.6): nothing moves, `main`'s tree keeps working after each.
Phase 5 is the move commit and the first of group 3, Phases 6-7 the rest of group 3. Every phase
leaves the tree compiling and lint-clean (the Stop hook), and runs `yarn test`. Long runs go to the
background with a log (root `CLAUDE.md`, "Watching a long run").

### Phase 1: the rules and the checks before the move — done

1. **Nothing else open:** no PR open against `main` (GitHub; `gh` isn't installed here) and no
   branch with work in flight (§2.6). If one is, it merges first or waits for p608.
2. **The scene baselines on `main`** (plans `CLAUDE.md`): in a worktree of `main` at the branch's
   base, `yarn verify:scenes --update` (all four configurations; WebGPU on this machine's GPU).
   Phase 5 compares against them.
3. **`moveRules.ts`:** D2 (`loadDebugModule`, `loadDebugModuleAsync`, `useDebug`, `isDebugReady`,
   `DebugModuleRef` → `kernel/config/DebugModules.ts`) and D3 (the two wrapper rules go; their
   `WRAPPER_NOTE` with them). `moveMap.ts` regenerates the map and its reports; the report's
   counts change by those files only.
4. **D4, the debug rule:**
   - `eslint.config.js`: `DEBUG_FILES` and the debug files' override lose
     `src/_engine/core/Debug/**/*.ts` (`src/**/_dbg__*.ts` and `src/_engine/**/_dbg__*.ts` stay).
   - `moduleSideEffects.test.ts`' `EXEMPT` loses `/^src\/_engine\/core\/Debug\//`.
   - `debugInProduction.ts`: the case-insensitive `debug` folder rule replaces `isDebugModule`'s
     folder test and `isDebugWrapper` (one finding kind, "debug module"); its test gets a case per
     folder kind (`core/Debug/`, `debug/`, `kernel/x/debug/`, `features/x/debug/`, the entry
     allowed) and keeps the `.module.scss` one.
   - The lines that describe these checks: `devTools/verify/CLAUDE.md` (the debug check and the
     side-effects test) and the root `CLAUDE.md`'s rules that name `core/Debug/**` as a debug
     location.
5. **Verification:** `yarn lint` (no file's rules changed: nothing new is reported),
   `yarn test`, `yarn verify:baselines` (passes with no baseline change: the debug check finds
   nothing on today's build), `moveMap.ts --check`.

As built:

- **Nothing open (2026-10-12):** no open PR (the public GitHub API, `JarSeal/aekasha-js`). Besides
  §2.6's two archives, `origin/wall-slide-feature` (`81442ab`, 2025-10-08, "Proto a wall slide
  sensor", remote only) has a commit `main` lacks: a year-old character prototype, not work in
  flight; picked up after p608, it's rewritten against `features/character/`. The branch is
  `engine-folder-restructured` (with a "d"), not `engine-folder-restructure`.
- **The scene baselines:** recorded on `4154a88` (`baseline.json`'s commit, clean): 96 runs (24
  scenes × 4 configurations, headless WebGPU on the Mac, 6 minutes), 72 snapshots. Three character
  scenes have no hash (characters aren't deterministic yet), so Phase 5 compares only their
  snapshots, errors and system order. The worktree was in the session's scratchpad with an APFS
  clone of `node_modules` (`cp -cR`) and its `.cache/verify` linked to the repo's, so the baselines
  landed where Phase 5 reads them. A `node_modules` symlink is enough for `tsc` and Vitest (Phase 4's
  dry run), but not for a Vite server: it resolves the real path, outside the worktree's
  `server.fs.allow`, and shares the prebundle cache with the repo.
- **The map:** p608 now has move 398 and keep 34 (the two wrappers are keeps; totals unchanged: 509,
  p608 437, p609 72), and the split rule's note names D2. `entryExports.json` files exactly 10 names
  under another entry: the five loaders `aekasha/debug` → `aekasha`, `createAssetsDebugGUI`
  `aekasha` → `aekasha/debug`, the four `PostFXProfiler` exports `aekasha/postfx` →
  `aekasha/debug`. The layout report's boundary violations (26) and cycles (none) don't change.
- **The production check's test** also passes three near misses: a folder that only starts with
  `debug` (`features/debugDraw/`), a `debug/` folder outside the engine (`src/app/debug/`) and
  `node_modules/debug/`.
- **The root `CLAUDE.md`'s Debug system** line on `__AEK_DEBUG__` says what `yarn verify:baselines`
  fails on (a `_dbg__` module, or any module in an engine folder named `debug`), besides the
  layering lint's line.
- **Verification:** `yarn lint` reports nothing (no error, no warning), `yarn test` 260 tests in 24
  files, `yarn verify:baselines` "All baselines unchanged" with "production build: debug code
  none", `tsc` and `tsc -p hub`, `moveMap.ts --check`.

### Phase 2: the rewrite rules — done

`devTools/refactor/moveApply.ts` and its tests (§4.1, §4.3), no file system:

1. The path map from `moveMap.json`'s entries for a plan, the split targets per export, and the
   inverse (new → old) for the leftovers report.
2. The TypeScript rewrite: the specifier forms of §4.3, the style kept, a split file's import
   divided per target; `import.meta.glob` patterns mapped and checked file set for file set.
3. The SCSS rewrite with Sass's resolution.
4. The text rewrite: full and engine-relative paths, `hub:documentation/engine/…` links through
   `devTools/hub/api/model.ts`' URL rule, TypeDoc's `{@link _engine/…!…}`; D6's exclusions; the
   leftovers (an old path not rewritten, per file and line).
5. Tests: a moved importer and a moved target (each with and without the other), `.ts` written
   or not, `/index`, `?raw` / `?url` / `?worker`, `import type`, `export … from`, `import()`,
   `vi.mock`, `new URL`, a glob whose folder moved whole and one whose files scatter (an error), a
   split import into two targets, a namespace import of a split file (an error), `@use` of a
   partial, `@forward`, a `sass:` module untouched, a path in a comment, a path inside an import
   not matched twice, a `hub:` link with an anchor, a folder link whose files scatter (an error),
   an excluded file untouched, a case-only rename.
6. **Verification:** `yarn test`, `yarn lint`.

As built:

- **Two modules:** `moveApply.ts` (743 lines: `buildPathMap`, `rewriteTypeScript`,
  `rewriteStylesheet`, and `rewriteTree`, which runs them and the text rewrite on a tree's texts
  and returns the changed texts by old path, the leftovers by new path and the errors) and
  `moveText.ts` (`getTextKind`, `createTextContext`, `rewriteText`, `findLeftovers`), each with
  its test. A split file and a deleted one aren't rewritten (Phase 3 splits the former).
- **The path map** also checks two paths that differ only by case and an action the codemod has no
  rule for (`merge`); a split target may land on any path (§4.4 appends there). On today's tree:
  398 moves (23 case-only), 3 deletes, 2 splits, 1200 files → 1204 (9 split targets are new paths;
  `Object3DHelpers.ts` is a moved file's).
- **A form §4.3 didn't list:** `typeof import('…')` types (`ts.ImportTypeNode`, about 10, all into
  `core/Debug/`); an `import('…').Name` type of a split file follows its name. Also rewritten:
  `vi.unmock` / `vi.doUnmock` / `vi.importMock`. A `new URL` whose base isn't `import.meta.url`
  isn't a path. A specifier naming a folder (`new URL('.', import.meta.url)`) keeps naming it (an
  error if the folder is empty after the move); one naming nothing is left alone unless its
  importer moves. Every new specifier is checked to resolve to its file in the tree after the move.
- **Globs:** the matcher is the module's own (`**`, `*`, `?`; braces and extglobs are errors):
  `picomatch` and `minimatch` are only transitive dependencies. A pattern's folder follows its
  files when they land in one folder at the same depth below it (a subfolder's name may change
  case).
- **A divided import** keeps its keyword, quotes, indentation, inline `type` and aliases; it can
  leave two imports of one module (a value and a type import, as `LightManager.ts` has today).
  The lint has no `import/no-duplicates`, and merging them would reorder the imports.
- **Stylesheets:** a URL without `./` is tried relative to the stylesheet first, as Sass does; one
  that doesn't resolve (a load path, a package) is left alone.
- **Text:** `devTools/verify/baselines/` is history too (§4.7 maps the baselines; a rewritten
  `api.json` would land in the move commit). The path boundary lets a full stop followed by a
  space or the end close a path (`core/Scene.` at a sentence's end). An engine-relative form
  without `.ts` needs a `/` (`InitApp` alone is a word). A `hub:` link to a module wins over a
  folder of its name (`core/ECS`); a split module's page follows its anchor's export.
  `devTools/hub/api/model.ts` exports the URL rule as `getApiPagePath`.
- **On today's tree, in memory** (912 text files, 1.8 s): 533 modules with no TypeScript error,
  334 files changed (270 modules' comments, 22 devTools and config modules, 25 documents, 17
  stylesheets), and:
  - **2 errors:** the folder links `hub:documentation/engine/debug` (15 modules stay in `debug/`,
    `3DSymbols.ts` goes to `debug/symbols/`) and `…/core/Lod` (22 to `features/lod/`, `LodFade.ts`
    to `kernel/render/`). Phase 3's edit table takes them.
  - **13 leftovers in 10 files**, one of them code: `physicsWorker.test.ts`' `FORBIDDEN_MODULES`
    (`'core/MainLoop.ts'`, …) is matched against esbuild's bundle inputs, so after the move the
    boundary test would pass for nothing. A string in `src/`, which D6 leaves alone: Phase 3's
    edit table. The rest are prose and comments for Phase 6 (two `.scss` comments, the root
    `CLAUDE.md`'s `utils/helpers.ts`, three modules' comments naming it, `driver.mjs`,
    `docs/templates/`, a Hub SCSS comment).
- **Verification:** `yarn test` 283 tests in 26 files, `yarn lint` clean, `tsc` and `tsc -p hub`,
  `moveMap.ts --check` (`layoutReport.md` regenerated: `model.ts`' new JSDoc names a moving path).

### Phase 3: splitting and the edit table — done

1. `moveSplit.ts` (§4.4) and its tests: statements per export with their comments, imports by use,
   imports between the parts, appending to a target that's also a moved file or another split's
   target, the source's own case-renamed path; the errors (a non-exported statement, an export
   without a target, a new cycle).
2. `moveEdits.ts` (D5), with the entries the tree needs: `SIMULATION_FILES`' two globs (the same
   files: `features/physics/` and `features/character/` with `ignores` for the feature's install,
   entry, import extension and debug modules, or the files listed), `moduleSideEffects.test.ts`'
   worker entries regex, `physicsWorker.test.ts`' `FORBIDDEN_MODULES` (engine-relative paths in a
   string, Phase 2's leftovers), the two `hub:` folder links whose modules scatter (`debug` and
   `core/Lod`, Phase 2's errors), and whatever the dry run (Phase 4) turns up.
   - **The table runs last, but an error stops the run before it:** the text rewrite skips a
     `hub:` link (or any match) that an edit table entry's `find` covers, so the entry decides
     its replacement. Each `find` checked to occur
     as often as the entry says, each glob entry checked file set against file set.
3. **Verification:** `yarn test` (including the split of today's `helpers.ts` and `constants.ts`
   in memory: every export lands in its target; Phase 4's dry run compiles the parts), `yarn lint`.

As built:

- **A fourth module, `moveTree.ts`:** `rewriteTree(map, texts, edits)` moved out of `moveApply.ts`
  (which would otherwise import `moveSplit.ts`, which imports it). It runs each file's rewrite
  (the table's `find`s protected), then the splits (each split file's comments rewritten first),
  then the table, each step only when the one before had no error, then the leftovers on the
  result. It returns `changed` (by the path before the move; a moved file a split appends to
  included), `created` (the split targets that are no file's path, by the path after the move),
  `leftovers` and `errors`. `moveApply.ts` exports `moveSpecifier` (with a `newImporter`
  parameter: a split target writes the split file's specifiers), `toSpecifier` and the glob
  helpers. Lines: `moveApply` 700, `moveSplit` 708, `moveEdits` 299, `moveText` 313, `moveTree` 103.
- **`moveSplit.ts` (`splitModules`):** a statement takes the comments above it and one after it on
  its line. Uses are read with a type checker on the split file alone (an in-memory program,
  `noLib`), so a local or a property named like an import isn't one. A binding a target uses only
  in types is an `import type` (`verbatimModuleSyntax`, `consistent-type-imports` with separate
  type imports), each original import's names in its order, then the other parts' names; a
  re-export whose name lands in its own target is dropped (`helpers.ts`' `isOnlyObject3D`, so
  `Object3DHelpers.ts` gets nothing appended). Merging into a target file deduplicates a binding,
  turns a type-only namespace or default import into a value one when a part needs it, adds a
  named binding to an import of its module and kind, and errors on anything else (a name bound or
  declared twice, a type-only named binding a part needs as a value, the file importing itself).
  The cycle check is on runtime imports only (a type import and an `import()` add no edge): a
  cycle through a target after the move is an error unless its modules, mapped back, were one
  cycle before it.
- **Two orders §4.4 didn't fix:** parts from two split files in one target (`ThreeMath.ts`) come
  in `moveMap.json`'s order (alphabetical: `constants.ts`' before `helpers.ts`'), not
  `moveRules.ts`' (the split sees only the map); within a file, the statements' order, which keeps
  a constant declared before a top-level use. Neighbours in the source keep what separated them
  (`ThreeVector3`, `ThreeQuoternion`, `ThreeEuler` stay on consecutive lines); other parts are
  separated by a blank line.
- **Errors besides §4.4's:** a default export, `export *`, a side-effect import, a comment above an
  import (nothing to go with), text after the last statement, a split name the file doesn't
  export, one statement declaring names with different targets.
- **Today's split:** `helpers.ts` and `constants.ts` into 9 modules (`AssetFiles`, `Disposal`,
  `ThreeMath`, `Numbers`, `MeshUserData`, `Workers`, `DebugModules`, `LightHelpers`, `Constants`;
  `Object3DHelpers.ts` already exports its name), no new cycle. `Disposal.ts` imports `THREE` and
  `Materials` as types and `textureMapKeys` from `utils/Constants`; `DebugModules.ts` imports
  `lerror` and `IS_DEBUG_ENV`; `MeshUserData.ts` imports `ThreeVector3` from `../render/ThreeMath`.
- **`moveEdits.ts` (`MOVE_EDITS`, 10 entries, each with its plan and a `why`):** a `check` per
  entry where one applies: `globs` (the quoted patterns of `find` and `replace` are exactly the
  declared sets; the old set expanded on the tree before the move, mapped, equals the new one with
  its ignores on the tree after it), `regex` (the same, with the literal in both texts) and
  `paths` (each quoted path, from the repo root, `src/_engine/` or the file's folder, maps to the
  replacement's at its index). The entries:
  - `eslint.config.js`: `SIMULATION_FILES` → `features/physics/**/*.ts`,
    `features/character/**/*.ts` and the two toolkit files, with a new `SIMULATION_IGNORES`
    (`features/*/index.ts`, `features/*/debug/**`, `PhysicsFeature.ts`, `physics/import/**`,
    `physics/worker/PhysicsWorker.test.ts`; `CharacterFeature.ts` is in the set today, so it stays
    in); the rule's config gets `ignores: SIMULATION_IGNORES`; the comment that named the codemod.
    The per-file overrides are exact paths: the text rewrite takes them.
  - `moduleSideEffects.test.ts`' worker entries regex.
  - `physicsWorker.test.ts`: `FORBIDDEN_MODULES`, and `path.resolve(__dirname,
'physicsWorker.ts')` (not in Phase 2's leftovers: a bare file name isn't a path form; a
    case-sensitive file system would fail it).
  - `devTools/verify/baselines.ts`' `getModuleGroup` and its comment: `kernel/` and `features/`
    keep their subfolders apart in the bundle baseline's groups, as `core/` did (§4.7 sums them, so
    it's for the report).
  - The two `hub:` folder links: `engine/debug` stays (the folder's page stays), `engine/core/Lod`
    → `engine/features/lod`.
- **On today's tree in memory** (1005 text files, about 2 s): no error, 338 files changed, 9
  created, 10 leftovers (Phase 2's 13 minus `FORBIDDEN_MODULES`' 3): the root `CLAUDE.md`'s
  `utils/helpers.ts`, three modules' comments naming it, two `.scss` comments (`index.scss` 2,
  `OnScreenTools.module.scss`), `driver.mjs`, `docs/templates/todo-plan-prompts.txt`,
  `hub/_assets/scss/_api.scss`: all Phase 6's.
- **Tests:** `moveSplit.test.ts` (in-memory trees), `moveEdits.test.ts` (each check passing and
  failing, counts, a missing file, the plan filter, the text rewrite leaving a `find` to the
  table), `moveTree.test.ts` (a small tree, and today's tree with `MOVE_EDITS`: no error, every
  split export in its target, every import of a created module resolving; the rewrite test moved
  there from `moveText.test.ts`).
- **Verification:** `yarn test` 298 tests in 29 files, `yarn lint` clean, `tsc` and `tsc -p hub`,
  `moveMap.ts --check`.

### Phase 4: the command, the dry run and the baseline comparison — done

1. `applyMoveMap.ts` (§4.2, §4.5): the preconditions, `git mv` through a temporary name, the
   deletes and splits, the writes (`rewriteTree(map, texts, MOVE_EDITS)`: `changed` at each file's
   new path, `created` as new files, every split file `git rm`'d; `utils/constants.ts` →
   `utils/Constants.ts` is a removal and a new file differing only by case, so it goes through
   the temporary name too), Prettier, the report (written to
   `.cache/refactor/p608-report.md` as well as printed), `--dry-run`, `--verify-commit <sha>` and
   `--leftovers <base-sha>`.
2. `compareBaselines.ts` and its test (§4.7): on the committed baselines and a hand-made mapped
   copy (a moved module, a split export, a renamed chunk within and over the tolerance, an
   undocumented name that changed module).
3. **The dry run, until it's clean:** `applyMoveMap.ts --plan p608 --dry-run`. Each failure is a
   rule, an edit table entry or a codemod fix in this group, never a hand edit of the result.
   Clean means `tsc`, `tsc -p hub` and `yarn test` pass in the worktree, `yarn lint` passes there
   too (run it in the worktree before it's removed), and every leftover in the report is prose for
   Phase 6 or history.
4. **Verification:** `yarn test`, `yarn lint`, the dry run clean.

As built:

- **`applyMoveMap.ts` (500 lines):** `--plan <plan>` applies; `--dry-run [--keep-worktree]`;
  `--verify-commit <sha> [--plan <plan>]` (the plan read from the commit message's
  `applyMoveMap.ts --plan pNNN` otherwise); **`--leftovers` needs `--plan`**
  (`--plan p608 --leftovers <base-sha>`): the map at the move's base still lists p609's moves,
  which aren't done.
  - **Preconditions** besides §4.2's: a target taken by a file git doesn't track (an ignored one),
    and a folder whose name changes only by case (none today: `git mv` through a temporary name
    renames files, not folders) are errors.
  - **Prettier** formats a written file only when its text before the move was Prettier-clean, and
    every created one ("no other formatting"): two documents aren't
    (`docs/issues/three-instanced-node-attribute-leak.md`,
    `hub/pages/documentation/coding-standards/jsdoc.md`); the report lists them.
  - **The split files** are `git rm`'d before any part is written, so `utils/constants.ts` →
    `utils/Constants.ts` needs no temporary name (macOS sees a removed file, then a new one).
  - **The report** (`.cache/refactor/<plan>-report.md`): the counts, errors, leftovers, the files
    not formatted, then every move, delete, split target, changed and created file. The console
    prints the counts, the leftovers and the errors, and the commit command naming the base.
  - **`--dry-run`** snapshots the working tree as a commit (uncommitted and untracked files, through
    a temporary index: the real index isn't touched; a new file needs `git add -N` before
    `moveMap.ts --check` counts it), checks it out in a scratch worktree, runs **the worktree's own
    copy** of the tool (the exact command, its precondition included), then `tsc`, `tsc -p hub`,
    `yarn test`, `yarn lint` **and `yarn build`** (added: the only check of the Vite build's
    stylesheet loads and `?worker` / `?raw` / `?url` imports, and of the Hub's `api:` and `hub:`
    links after D7's rewrite). Its report is copied to `.cache/refactor/<plan>-dry-run-report.md`.
  - **The scratch worktrees are outside the repo** (`os.tmpdir()/aekasha-applyMoveMap/`), not in
    `.cache/refactor/`: inside the repo TypeDoc names the sources from the main repo's root
    (`.cache/refactor/worktree/src/_engine/…`), the Hub's API model finds no module, and the Hub
    build fails on every `api:` link. With the `node_modules` symlink resolving outside the
    worktree, the Hub also warns about 57 `{@link}`s in `@types/three`: an artifact of the
    worktree, not of the move.
  - **The apply** takes about 30 s (the `git mv`s: two per move).
- **`compareBaselines.ts`** (`--plan <plan> <base-sha>`, pure functions tested, the command run
  only as the main module): `api.json` mapped per export (a re-export a split target declares is
  dropped, a deleted module's exports go; a module that exports nothing is compared by its path),
  `entries` identical. **`docs.json`'s totals can't stay equal:** the two deleted
  `utils/materials/` modules are in the baselines (4 undocumented exports), so the expected totals
  are the old ones less what the deletes counted (a deleted class or interface would be an error:
  its members can't be counted). Chunks: a name after a renamed module takes its new name (on
  today's map exactly §2.4's five names, seven chunks); chunks of one name are paired by size,
  since their `#2` order follows the content hash. A chunk outside the tolerance names the split
  parts the last build (`dist-stats/`) put in it. The tolerance rule moved to
  `devTools/verify/bundleGrowth.ts` (`baselines.ts` runs on import); `baselines.ts` exports its
  baseline types.
- **The tests hold on the moved tree too:** `compareBaselines.test.ts` builds the map on its own
  files (not the working tree's); `moveTree.test.ts`' test on today's tree skips once the map's p608
  moves are done (the move commit, before step 3 of Phase 5); its timeout is 30 s (about 2 s alone,
  over 5 s next to a dry run).
- **Dry run fixes:** `debugInProduction.test.ts`' `core/Debug/` case named a real file
  (`About.module.scss`), whose expectation the text rewrite changed but not its input (after a
  `/`, no path boundary): it names a file that doesn't exist (`Panel.module.scss`), as its
  `_dbg__Profiler.ts` case does, so no edit table entry (one keeping the text would stay a leftover
  for good). `layoutReport.md` regenerated (the new modules).
- **The clean dry run:** 398 moves (23 case-only), 3 deletes, 2 splits into 9 new modules, 337 texts
  changed, 35 emptied folders removed; apply, `tsc`, `tsc -p hub`, `yarn test` (304 passed, 1
  skipped), `yarn lint` and `yarn build` pass. The Hub's warnings are today's (the search index
  1.07 → 1.08 MB, longer URLs) plus the worktree's `@types/three` ones. 10 leftovers, all Phase 6's
  (Phase 3's list).
- **Verification:** `yarn test` 305 tests in 30 files, `yarn lint` clean, `tsc` and `tsc -p hub`,
  `moveMap.ts --check`.

### Phase 5: the move

1. **A fresh base:** if `main` has moved since the branch's base, rebase group 1 onto it, run
   `moveMap.ts` (regenerate the map) and the dry run again, and record the scene baselines again
   on that `main` (Phase 1, step 2). Nothing else may be open (Phase 1, step 1).
2. **The move commit:** `applyMoveMap.ts --plan p608`, then commit everything it changed and
   nothing else, with the command and the base in the message ("p608: apply the move map",
   `applyMoveMap.ts --plan p608` on `<sha>`). `applyMoveMap.ts --verify-commit HEAD` passes.
3. **The rules for the new layout** (D9), its own commit: `MOVE_EDITS`' p608 entries go (their
   `find`s are gone) and `moveTree.test.ts`' test on today's tree applies the p609 plan (or goes to
   p609; it skips on the move commit), `compareBaselines.test.ts` reads the map of the move's base
   (after D9 the current map has no p608 move: its expectations would fail), `moveRules.ts`' p608 rules become keep rules for the new folders, `moveMap.ts` regenerates (every engine file a keep; the p609 entries
   unchanged), and the layout report shows the same boundary violations as before the move, by
   their new paths (23 kernel → feature type-only, 2 ui → kernel, 1 schemas → kernel), and the same
   two assets worker job imports (`moveMap.ts` allows them from `kernel/assets/worker/`).
4. **Verification:**
   - `tsc`, `tsc -p hub`, `yarn lint`, `yarn test`, `moveMap.ts --check`.
   - `yarn build` (type-check, the production build, the Hub).
   - `yarn verify:scenes`: every scene in all four configurations against Phase 1's baselines:
     no new error, the same hashes, the snapshots within tolerance and **the same system order**
     (a `_dbg__` module that another imports statically registers at its first importer's load,
     p607: a moved import order there would show here).
   - `yarn verify:baselines --update --allow-docs-drop`, then
     `compareBaselines.ts --plan p608 <base sha>`
     (§4.7). Commit the three baselines only when it passes ("the baselines by their new paths").
   - By hand: `yarn dev` with `?isDebug=true` (the drawer, a few debug tabs from different
     features, the profiler window, the material editor view: their `import()`s and SCSS moved)
     and `?isProdTest=true`; `yarn dev:https` isn't needed (no server change).
   - What must survive (p600 §3.7), by construction: the codemod changes import specifiers and
     comments in `src/`, never another string, so LS keys, URL flags and `__saveData` keys can't
     change; `yarn gatherAppData` leaves `src/generated/` and `.schemas/` unchanged
     (`git status` clean after it).

### Phase 6: the Hub, CLAUDE.md and the readme

The list is `applyMoveMap.ts --plan p608 --leftovers <base sha>`: the old paths still named anywhere outside
D6's history, read from the map at the move's base (after D9 the current map only has the new
layout). Each item is fixed by hand, and the report reruns to empty.

1. **Root `.claude/CLAUDE.md`:** the "Three-folder split" (the engine's folders: `kernel/`,
   `features/`, `ui/`, `debug/`, `utils/`, `schemas/`, `types/`, what each holds), the
   Architecture map's nested `CLAUDE.md` paths (`src/_engine/core/SkyBox/CLAUDE.md` →
   `features/skybox/CLAUDE.md`, …), the Debug system (the `_dbg__` modules next to their features,
   the framework in `debug/`, D4's rule), and every section's file paths the codemod didn't
   rewrite.
2. **The nested `CLAUDE.md` files** (moved with their folders, §2.1): their own paths and
   first lines. `core/Debug/CLAUDE.md` (now `debug/CLAUDE.md`) describes debug tools that moved
   next to their features (character debugging, physics): it says where they are, or the part
   moves into the feature's nested file where one exists. Their `##` sections keep their names, so
   `aek:covers` and `hub.config.ts`' `coverageIgnore` don't change.
3. **The Hub pages:** the feature guides' prose paths, `docs/techniques/hub-authoring.md`, the
   coding-standards page where it names folders. Not the migration guides (D6). No example scene
   (D10).
4. **`readme.md`:** the project tree (`core/` → the new folders; "`debug/` … lazy-load
   `core/Debug/_dbg__*`") and the Engine section's paths. The Features list doesn't change.
5. **`docs/issues/`:** the three files that name moved paths, by the codemod or by hand.
6. **Verification:** `yarn hub:build` (no dead `hub:` link; the API section shows the new tree),
   `yarn hub:preview` (the Documentation section's engine tree, a feature page's API links),
   `yarn verify:baselines --docs`, `--leftovers` empty, and a grep for the old folder names
   (`core/`, `workers/`, `styles/`, `3dModels/`, `utils/helpers`) outside D6's history finding
   nothing about the engine (prose naming a folder without a file isn't in `--leftovers`).

### Phase 7: versioning, changelog and mark done

1. `package.json`: `engine_metadata.version` and `version` 5.0.0 → 5.0.1, codename Golden Hour
   kept (D8). Toolkit and app unchanged.
2. `CHANGELOG.md`: a new entry for the branch, "Engine 5.0.1 (Golden Hour)" (the new layout in one
   paragraph, the renames' rule, the debug loaders in `kernel/config/`, the Hub's API URLs moved,
   nothing for consumers to change) and "Project" (`applyMoveMap.ts`, `compareBaselines.ts`, the
   checks' debug rule, the rules for the new layout).
3. `yarn checkVersions --against main`.
4. Mark the plan done (plans `CLAUDE.md`): Status `implemented (Phases 1-7)`, `git mv` to
   `_DONE_p608_engine-folder-restructure.md`, the references: the `Blocked by` lines of p609-p613,
   p615, p616, p618, p619 and p510 (dropped where p608 was the only blocker), p600's roadmap row and
   §11 / "Branches and PRs" where they name p608, p299's note, the `CLAUDE.md` mentions
   (`devTools/verify/CLAUDE.md`'s "p608's moves rename folders").
5. **Time for a PR:** `engine-folder-restructure` → `main` (p600's "Branches and PRs"), opened when
   asked; after the merge, `yarn tagRelease` and push `engine-v5.0.1`.

## 6. Done when

- The tree matches the map: `moveMap.ts --check` passes with the rules for the new layout (D9),
  and its layout report shows the same boundary violations as before the move, by their new paths.
- The move commit is exactly the tool's output (`--verify-commit`).
- `compareBaselines.ts` passes against the base: `api.json`'s exports differ only by their
  modules' new paths, its `entries` are unchanged, `docs.json` has the same documented and
  undocumented names, and the bundle's chunks are within the tolerance under their mapped names.
- `yarn verify:scenes` passes against `main`'s baselines in all four configurations: errors,
  hashes, snapshots and the system order.
- `yarn test`, `yarn lint`, `yarn build` and `yarn hub:build` pass; the boundary lint unchanged
  (p606 made it an error everywhere, so no consumer imports a moved path, and the migration guide
  gets no path list).
- What must survive (p600 §3.7): LS keys, `__saveData`, URL flags, the generated data's shape (by
  construction, §5 Phase 5), every scene's snapshot and hash (the runner).
- `--leftovers` is empty; the root and nested `CLAUDE.md` files, the readme and the Hub describe
  the new layout.
- Engine 5.0.1 in `package.json` and `CHANGELOG.md`; `yarn checkVersions --against main` passes.

## 7. Risks

1. **The split can change the chunks.** A part of `helpers.ts` used only by lazy code (a
   `ThreeMath` helper only a feature's chunk needs) may now land in that chunk instead of the main
   one: a bundle change, though a smaller main chunk. `compareBaselines.ts` names each chunk
   outside the tolerance with the modules that moved between chunks; a difference made only of
   split parts is recorded in the commit message and the changelog, anything else is a bug in the
   codemod.
2. **Evaluation order.** Nothing registers at module load outside `_dbg__` modules (p607), and the
   codemod keeps every module's import order, so a move can't reorder systems. Two exceptions to
   watch: a `_dbg__` module another one imports statically registers at its first importer's load,
   and the split parts evaluate in a new order (their top level is declarations and scratch objects,
   no registrations). The runner's system order baseline catches either.
3. **Case-only renames on other machines.** A checkout on a case-insensitive file system can keep
   an old name after a pull (an editor holding the file open, a stale build cache). Mitigation: the
   rename goes through a temporary name in one commit, `tsc`'s consistent-casing check fails on a
   wrong-case import, and the other machine (WSL2) runs `yarn test` and `tsc` after pulling the
   merge.
4. **`main` moves while the branch is open.** Each rerun costs a regenerated move and the full
   verification (the scene matrix takes the longest). Mitigation: nothing else open (Phase 1), the
   move late in the branch (Phase 5), group 3 small and cherry-picked.
5. **The Hub's API URLs change** (D7). Bookmarks and outside links to engine API pages break until
   p619 settles the reference on the entries; the changelog says so.
6. **Prose the codemod can't see.** A folder named without a file (`core/`), a short form relative
   to a nested file's folder. Phase 6's grep and the `CLAUDE.md` review catch what `--leftovers`
   doesn't; a stale sentence is a documentation bug, not a broken build.
7. **The wrappers stay two-step** (D3): until p618, `debug/Assets.ts` and `debug/PostFXProfiler.ts`
   are wrappers outside their features. Merging one must keep its debug code foldable (p607 D7: the
   calls behind `IS_DEBUG_ENV`, none in a `try` block, a closure handed to `ctx.onDebug*` that
   keeps a module alive gated with `if (IS_DEBUG_ENV)`); the production debug check catches a
   leftover. p618's stub has the note.
