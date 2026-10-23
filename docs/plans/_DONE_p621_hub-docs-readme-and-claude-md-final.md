Status: implemented (Phases 1-5)
Category: Documentation, Hub
Epic: \_DONE_p600_whole-codebase-refactoring-and-documentation.md (Stage D)

# Hub Docs, Readme and CLAUDE.md: the Final Pass

## Goal

Close the epic: the Hub, the readme and CLAUDE.md describe the engine as it is after p600, and the
epic is marked done.

## 1. Grounding (checked against the code, 2026-10-23, `main` at `6da54c6`)

Every child plan p601-p620 is `_DONE_`. Most of the stub's scope was done by the children along
the way, so what's left is narrower than the stub listed.

### 1.1 Done already (no work here, only checked)

- **The SBP page:** `hub/pages/features/smallest-build/` (p611 Phase 6), with the banner live and
  its numbers generated from the report.
- **The coding standards:** `hub/pages/documentation/coding-standards/` (`intro.md`, `jsdoc.md`;
  p605, kept current by p606-p620).
- **The migration guide:** `hub/pages/documentation/migration/engine-5.md` holds p606's and
  p607's sections and p608's "Moved and removed modules" table. Stage C's bumps were minors and
  patches, so no other section is owed. What the next major removes is p622's.
- **JSDoc coverage at 100 %:** `devTools/verify/baselines/docs.json` is 2,401 / 2,401 exports and
  1,043 / 1,043 members (engine 2,321 / 890, toolkit 80 / 153).
- **The readme:** `InitEngine({ features })` in "Boot the engine" (p607), SBP in "Why Ækasha?" and
  Features (p611), the embed example (p611), the layout tree (p608, p609).
- **The commands from p601 and p611** are in the root CLAUDE.md's Commands and the readme's table.
- **Every script in `package.json`** but `codecat` / `cc` / `codecatAsExecutable` is in the
  readme's table (those three are personal tooling; left out, as today).

### 1.2 Left to do

- **No Architecture page.** The pieces are spread over the ECS feature page (stages, plugins),
  the quick start's "How the app starts" (the install), the coding standards (layering, the
  simulation rules) and the Characters and Input pages (p603's contracts: actors, controllers,
  brains, intents). Nothing shows the whole engine in one place, and nothing answers "where does
  my feature go".
- **`utils/SeededRandom.ts:4`'s `{@link getRandomStream}`** (the stub said `:15`; the comment
  moved) links nowhere: the name is in `utils/RandomStreams.ts:30`, which the file doesn't import.
  It's `yarn hub:build`'s only warning (p620's last build).
- **The root CLAUDE.md is 75.2 kB.** p605 left it at 44.4 kB with a target of "about 27 kB after
  p608 moves the rest"; p606-p620 added 31 kB instead, and p608 moved no section out. By section
  (bytes): Commands 12.2k, Three-folder split 7.8k, data pipeline 7.3k, Views 5.2k, ECS core 5.0k,
  Engine features 4.9k, Coding standards 3.9k, Build config 3.7k, Bootstrap 3.6k, Workflow 3.4k,
  Physics 3.3k, Viewports 3.0k, Snapshots 2.2k, Debug system 2.1k, Versioning 1.9k. p605 kept
  ECS core, views, viewports, snapshots, the data pipeline and bootstrap in the root "until p608
  gives them a folder" (p605 S9): they have folders now (`kernel/ecs/`, `kernel/render/`,
  `features/viewports/`, `devTools/gather/`, `kernel/init/`).
- **The nested CLAUDE.md files** (19) haven't been checked against the code as a set since p605;
  each Stage C plan updated the ones it touched.
- **The readme:**
  - The Roadmap lists "Component query caching", done (`_DONE_p200`, its cache in p612).
  - No test checks that its examples compile (the stub's done criterion). The `@example` check
    (`devTools/verify/examples.ts`' `checkExamples`) type-checks code blocks against the entries,
    free names allowed: the readme's `ts` blocks fit it as they are.
  - p555's open question (p990): the Features list could shrink to links to the Hub's feature
    pages. There is still no hosted Hub (`hub:build`'s `public` mode exists, no URL), so a link
    from GitHub can only point at the page's source in `hub/pages/`.
- **The epic:** `p600_…`'s status is `draft | epic — not-implemented`; 23 files name its file.

### 1.3 The child plans after the epic

Every `_DONE_p601`-`_DONE_p620` is still cited: by open plans (p622 cites p606-p620, p800 p602,
p607, p608, p613, p617, p618; p420-p428 and p510-p512 p603, p604, p610, p614) and by source and
CLAUDE.md comments ("p607 D7", "p612 D6"; from 3 files for p604 to 101 for p619). The plans rule
keeps a done plan "if it provides useful information for another feature", which all of them do.

## 2. Decisions

### D1. An Architecture page in the Documentation section

`hub/pages/documentation/architecture/` (`aek:order` before the code blocks page), one page that
shows the whole engine and links to the pages with the detail, never repeating them:

1. **Three layers:** engine ← toolkit ← app, the entries, what the lint enforces (a short version of
   the coding standards' Layering, linking it).
2. **The kernel and the features:** what every app runs, the nine features, `InitEngine`'s order
   (config, kernel, features in list order, scenes, debug, `start`), the `FeatureContext`, the
   scene manifest. A diagram (inline SVG or an ASCII block; whichever the Hub's Markdown renders
   best in both themes).
3. **A frame:** the stages in order, `APP_PHYSICS_STEP` per sub-step, where physics syncs into ECS
   and ECS into three.
4. **A scene load:** the steps of `loadScene`, the hooks a feature gets, deterministic loads.
5. **Threads:** the physics worker and its transport, the assets worker's jobs.
6. **Simulation and presentation:** p600 §3.4's split, linking the coding standards' Simulation
   section.
7. **The debug layer:** `_dbg__` modules, the loaders, the fold.
8. **Where your feature goes** (the stub's "gameplay contracts"): a table from "what I'm adding"
   to its place (an engine feature, a toolkit category, the app; a component and system, a
   brain, a controller, an action map, a scene hook), with p603's contracts (actor, controller,
   brain, intent) in a paragraph each, linking the Characters and Input pages.

The page takes `aek:covers` for the root sections it now describes, "Three-folder split",
"Bootstrap flow" and "Build config notes" (a page's covers aren't limited to feature pages,
`devTools/hub/claudeMd.ts`), which leave `hub.config.ts`' `coverageIgnore`. The Documentation
intro and the quick start link it.

### D2. The readme keeps its Features list

Without a hosted Hub, a reader on GitHub sees only the readme, and links to `hub/pages/*/intro.md`
show raw HTML and Markdown slots. So the Features list stays, checked against the code, and
each item keeps its pointer to the Hub's feature page in the section's first line as today. p990's
p555 item is resolved by this decision and deleted. Revisit when the Hub has a URL (then each
item becomes a line and a link).

### D3. The readme's examples are checked by `yarn test`

`devTools/verify/examples.ts` gets `collectReadmeExamples()`: each fenced `ts` block of
`readme.md` is an `ExampleBlock` (file `readme.md`, its line), and `examples.test.ts` checks them
with the engine's in the same program (no second program, so about the same 1.3 s). `jsonc` and
`html` blocks are skipped as today. A block that fails is fixed in the readme, never exempted.
The readme's "Examples compile" sentence in the coding standards (`jsdoc.md`) and
`devTools/verify/CLAUDE.md` name it.

### D4. The root CLAUDE.md goes back to its map: at or under 45 kB

- **Out, into nested files next to the code (moved verbatim first, then checked):**
  - ECS core → `src/_engine/kernel/ecs/CLAUDE.md` (plugins, component types, app ids, managed
    entities, stages, the loop). The root keeps the stage order in one line.
  - Views and Snapshots → `src/_engine/kernel/render/CLAUDE.md`.
  - Viewports → `src/_engine/features/viewports/CLAUDE.md`.
  - The data pipeline → `devTools/gather/CLAUDE.md` (the gatherer, the generated files, the
    manifest, `__saveData`), and its scene load paragraph → `src/_engine/kernel/scene/CLAUDE.md`.
  - Engine features and the Bootstrap flow's detail → `src/_engine/kernel/init/CLAUDE.md` (the
    `FeatureContext`, the install, production-build traps, `mountAekasha`). The root keeps the
    boot order in a few lines.
  - Commands: one line each; the flags and their detail go to the nested file the command already
    points at (`devTools/verify/`, `sbp/`, `assetPipeline/`, `devFiles/`, `hub/`, `layout/`
    gets one for the layout check and the codemod).
- **Stays in the root:** the brand, the command one-liners, the map (every nested file in one
  line), the three-folder split (shortened: the rules are in `layoutRules.ts` and the lint), the
  boot and frame outline, the Physics rules every simulation file follows, the Debug system's
  pattern, the Hub rules, Build config, the coding standards, versioning and workflow.
- The nested files' `##` headings keep the root `###` names (`ECS core`, `Views`, …), so no
  `aek:covers` changes (p605's rule). Each new file starts with its one-line scope.
- 45 kB is p605's first target; p605's 27 kB assumed the root lost more than these sections, and
  the Workflow and coding standards it keeps have grown since. Lower if it comes out lower.

### D5. Every `_DONE_p6xx` child plan is kept

By §1.3: each is cited. The epic file becomes `_DONE_p600_…` and is kept too (p622, p800 and the
p42x / p51x plans cite its sections). Nothing is removed by this plan.

### D6. No example scene

The plan changes documents and one dev tool, no engine behaviour. The Architecture page shows no
scene; its diagram is the picture.

### D7. Versioning

- **Engine: patch** (`SeededRandom.ts`' JSDoc, and any JSDoc a check in Phase 3 finds wrong), as
  p605's comment-only changes were.
- **Toolkit and app:** unchanged unless Phase 3 touches their files (then a patch each).
- **Project:** the `CHANGELOG.md` entry's Project section (the Hub page, the readme, CLAUDE.md, the
  readme check).
- Branch `hub-docs-readme-and-claude-md-final` from `main`, into `main`; its PR closes the epic
  (p600's table).

## 3. Phases

Each phase is one reviewable commit; none changes runtime code, so the verification is
`yarn test`, `yarn lint`, `yarn hub:build` (no warning) and `yarn verify:baselines --docs`, and
`yarn build` with the full `yarn verify:baselines` in Phase 5. No `yarn verify:scenes` (no
runtime change; the scene runner checks nothing a document changes).

### Phase 1: the fixes and the readme check — done

1. `utils/SeededRandom.ts`: a `{@link}` resolves in the file's scope (TypeDoc), and the file
   can't import `getRandomStream` without importing `RandomStreams.ts` into a module that
   doesn't use it. Either a declaration reference TypeDoc resolves across modules, if the Hub's
   link check accepts one, or the name in backticks with its entry ("`getRandomStream`
   (`aekasha`)"), which the coding standards allow for a name the link can't reach.
2. D3: `collectReadmeExamples`, its test, the fixes it finds in the readme's examples.
3. The readme's Roadmap: "Component query caching" out; each other item checked against an open
   plan.
4. `yarn hub:build`: no warnings.

**As built:**

- `SeededRandom.ts`: the module-qualified form the coding standards give for a name the file
  doesn't import (`{@link _engine/utils/RandomStreams!getRandomStream}`), as `LodSystem.ts` and
  `DraggableWindowTypes.ts` write theirs. `yarn hub:build`: 90 pages, 935 names, no warning.
- `examples.ts`: `extractMarkdownExamples(file, text)` (the tag's fence reader on the file's
  lines, each block owned by the heading above it) and `collectReadmeExamples()`; the test checks
  the readme's blocks in the same program as the engine's, with a unit test of the extraction. The
  readme's six `ts` blocks type-check as they are (no fix needed); a broken option and a misspelled
  method were caught at their readme lines in a trial. Named in `devTools/verify/CLAUDE.md`, the
  root's `yarn test` line and the coding standards' "Examples compile".
- The Roadmap: "Component query caching" out. The rest have open plans (p355 the material editor's
  saves, p102, p250, p500, p240, p354), but scene-JSON physics, which has none and isn't built
  (kept: a wish, not a claim).
- **Found and fixed (outside the plan's scope; the Stop hook blocks on it):**
  `ScatterOnSurface.test.ts`' three `scaleRange` cases (p620's hashes) failed on an arm64 Mac with
  Node 22.13.0, also at the commit that recorded them (`b3fdf1f`), with the same three: the hash
  read raw Float64 bits, which differ in the last place between machines (V8's sin / cos can, by
  build; the quaternions' `setFromAxisAngle`). It now hashes the values rounded to 1e-9; a probe
  with sin and cos one ulp off gave the same hash. All four hashes re-recorded (toolkit test only,
  no bump). **To check on the machine that recorded the old ones:** `yarn test` passes there too.
  `yarn test`: 1,228 passed.

### Phase 2: the Architecture page — done

1. D1's page, its diagram, its `aek:covers`, `coverageIgnore` without the three names.
2. Links to it: the Documentation intro, the quick start's "How the app starts", the Features
   intro, the coding standards' Layering.
3. `yarn hub:build` and a look at it in `yarn dev` (both themes, phone width).

**As built:**

- `hub/pages/documentation/architecture/` (`aek:order` 60, before the migration guide): `intro`
  and `guide` slots, D1's eight sections plus "The build" (what Build config notes holds that an
  app developer needs: the aliases, `sideEffects`, the lazy parts, `yarn sbp`), and "Actors,
  controllers, brains and intents" under "Where your feature goes". The diagrams are three
  `text noLineNumbers` blocks (the Hub's existing diagram form, `scenes-and-assets`), kept at or
  under 72 characters so they fit the content column; no SVG.
- Written against the code, not only the CLAUDE.md text: the frame order from `runFrame` and
  `ECSWorld.update*Loop` (a scene's app loopers run after the worlds' `APP_RENDER_SYNC`, before
  the render), the assets worker's defaults from `AppConfig.assets`, the actor record from
  `CharacterObject` (`controller`, `brain`; there is no `ACTOR` component, p603 C1's name).
- `aek:covers`: "Three-folder split, Bootstrap flow, Build config notes", out of `coverageIgnore`
  (left: the plans, the Hub, the verify commands).
- Linked from the Documentation intro, the Features intro, the quick start's "How the app starts"
  and the coding standards' Layering.
- `yarn hub:build`: 91 pages, no warning; light, dark and 390 px wide checked in Chrome on
  `yarn hub:preview` (no page overflow).

### Phase 3: CLAUDE.md — done

1. **Moves (verbatim):** D4's sections into their nested files, the root's map updated. A script
   diff shows every moved line in exactly one file (p605 Phase 6's check).
2. **Checked against the code:** every backticked path, file and exported name in the root, the 19
   nested files and D4's 7 new ones resolves (a throwaway script in the scratchpad: paths with `fs.existsSync`,
   names with a grep of `export`), and every claim a section makes about a subsystem is read
   against its code. Findings are fixed in the text; a finding that is a code bug goes to
   `docs/issues/`.
3. The root at or under 45 kB; `yarn hub:build` (the coverage check sees every section).

**As built:**

- **Moves:** 7 new nested files, each with its one-line scope and a line in the root's map:
  `kernel/ecs/` (`## ECS core`), `kernel/init/` (`## Bootstrap flow`, `## Engine features`),
  `kernel/scene/` (`## Scene loads`: the data pipeline's scene load paragraph and Commands'
  `?startScene` sentences), `kernel/render/` (`## Snapshots`, `## Views`), `features/viewports/`
  (`## Viewports`), `devTools/gather/` (`## Scene/asset data pipeline (JSON → generated code)`)
  and `devTools/layout/` (`## Layout check`: the layout check and the codemod). Commands' long
  lines went to the nested files they pointed at: `yarn docs` → `devTools/hub/`, `yarn assets` →
  `devTools/assetPipeline/`, `yarn test` → `devTools/verify/` (a bullet under "Verify commands";
  the root keeps the test-writing rules in one line, since they apply anywhere in `src/`).
  `yarn hub:build`'s dropped parenthetical was already in `devTools/hub/CLAUDE.md`. The check
  script (against a copy of the old root): 49 lines moved, each in exactly one nested file; the
  rest were edited in place.
- **The root keeps** short outlines under `ECS core` (the stage order), `Scene/asset data
  pipeline` and `Bootstrap flow` (the boot order, the nine features). Engine features, Viewports,
  Snapshots and Views are gone from it. 75.2 kB → 43.2 kB.
- **Two new section names** ("Layout check", "Scene loads": no root `###` to keep) went into the
  Architecture page's `aek:covers`, not `coverageIgnore`. The stages and the main loop stay in
  `kernel/ecs/CLAUDE.md` as D4 said, though their code is in `kernel/loop/` (a session reading
  `MainLoop.ts` doesn't load that file).
- **Checks:** a resolve script (every backticked path exists, every name occurs in the code, every
  `_DONE_pXXX` named is in `docs/plans/`) and a pairing script (a name sits in the file its
  sentence names) over the root and all 26 nested files. The root and the 7 new files were read
  against the code (the boot, the frame, the feature list, `FeatureContext`, `SceneHooks`,
  `FixedStepDriver`, `ViewDef`, the snapshot and viewport options, the scene load steps, the
  gatherer, the feature → feature imports, the scripts, the Build config, the toolkit layout, the
  simulation lint). The 19 older nested files got the two scripts and their quoted constants
  (ports, versions, timeouts, sizes; all right), not a claim-by-claim read.
- **Fixed in the text (no code bug, no issue file):** the moved text's references to root
  sections that left (and the older files' "the root's Views" / "Engine features"); `kernel/input`
  named a test bridge `playInput` that doesn't exist (the bridge's `installTestInput` plays the
  runner's `window.__AEK_TEST_INPUT__`); `FeatureContext`'s `config` and `isInstalled` were
  missing; `?startScene`'s scene code comes from `getAppData().sceneFiles`; the drawer key is
  rebindable in `src/CONFIG.ts`, not rebound; p450 is still a prompt
  (`docs/templates/todo-plan-prompts.txt`); the loop starts once the root scene has children.
- `yarn test` 1,228 passed, `yarn lint` clean, `yarn verify:baselines --docs` unchanged,
  `yarn hub:build` 91 pages with no warning.

### Phase 4: the readme and the Hub's remaining pages — done

1. The readme against the code: Features (D2), Technical highlights, Project structure (the new
   nested files aren't in it; `devTools/` line), Documentation (the Architecture page), the
   examples' prose. Every claim checked like Phase 3's step 2.
2. The Hub homepage and Features intro (the four principles, the featured features), and the
   migration guide's intro (a line naming p622's major as the next section).
3. p990: the p555 item deleted (D2).

**As built:**

- **The readme** (D2 followed: the Features list kept, each item checked against the code). Fixed:
  the Examples prose (ten Hub examples, nine scenes: the UI kit's was missing); the other scenes
  (`sceneTestECS` is the start scene, not "an ECS stress test"; the LOD and sky showcases, `space`
  and the texture scenes added); the stress tests' places (the ECS tab, the gym scene); the
  drawer's tabs (cameras, lights and debug tools were missing); the ECS item (plugins and hooks
  register from an install, not "at runtime"); the frame row (the physics step after each
  `APP_PHYSICS_STEP`, and the render before `LATE_MAIN`, as `runFrame` runs them). Added: the
  nested `CLAUDE.md` files in Project structure (one note on the `_engine/` and `devTools/` lines,
  not a list), a `.claude/` line, `utils/`' hashes and seeded random, the Architecture page and
  the nested files' map in Documentation. Checked and unchanged: the 16 entries, the physics
  claims (the `MESSAGE_BATCH` fallback, the single STEP message, heightfields, joints, shape
  casts), the input loop hook, the editor views' suspension, the save data's major-version
  warning, the debug keys. The six `ts` blocks still type-check (`yarn test`).
- **The Hub:** the homepage's four featured features already are one per principle (rendering,
  ECS, physics, smallest build), and the three featured examples match their scenes. Changed: the
  Features intro's Modular infinity (the features listed at boot, not "opt-in plugins and
  systems") and Threaded reality (a worker "by default"), the physics card's description likewise,
  the homepage's Features tagline (all four principles) and its intro (a link to Architecture).
- **The migration guide:** the intro names engine 6.0.0 (p622) as the next section, with the
  `@deprecated` names in the API reference as the way over before it. Found outside the plan:
  "Engine 4 → 5" still had a "Not released yet" note, though 5.0.0 and toolkit 2.0.0 shipped
  together on 2026-10-11 (`engine-v5.0.0`); replaced by a line saying the minors since don't
  break, so it is the only section to follow from engine 4.
- **p990:** no p555 item to delete: `22e859c` ("Plan cleanup", 2026-10-09) had already moved the
  readme question into this plan, two hours after its stub (§1.2 still placed it in p990), and
  p990's line 6 records the move. Its "More examples" item was stale instead (Characters has
  `exampleCharacter`; the Spatial index page points at `largeWorld`, the others at none): fixed.
- `yarn test` 1,228 passed; `yarn hub:build` 91 pages, no warning.

### Phase 5: close the epic — done

1. Verification: `yarn test`, `yarn lint`, `yarn build` (with `yarn sbp`), `yarn hub:build` with no
   warnings, `yarn verify:baselines`.
2. Versions (D7), the `CHANGELOG.md` entry, `yarn checkVersions --against main`.
3. Mark this plan done (`_DONE_p621_…`), then the epic: status `implemented (Stages A-D)`,
   `git mv` to `_DONE_p600_…`, its roadmap row and `Blocks` line, and the 23 files that name it
   (the plans' `Epic:` / `Related:` lines, CLAUDE.md, the Hub if any).
4. Time for the PR (p600's table): `hub-docs-readme-and-claude-md-final` into `main`.

**As built:**

- **Verification:** `yarn test` 1,228 passed, `yarn lint` clean, `yarn build` exit 0 (`yarn sbp`:
  the app 379.8 kB gzip before the first frame, the banner 285.5 kB, every budget within),
  `yarn hub:build` 91 pages with no warning, `yarn verify:baselines` all unchanged (docs 2,401 /
  2,401 exports, 1,043 / 1,043 members; no debug code in either build). The root CLAUDE.md is
  43.2 kB. Two notes in the build's log aren't this branch's and were left: Vite's
  `new URL(".", import.meta.url)` notice in the banner embed's build, and `yarn sbp`'s "well
  under" on `assets/index.css` (0.9 kB of 3 kB: lower it to 2 KiB).
- **Versions (D7 differs):** Engine 5.10.2 and the project with it; **Toolkit 2.2.1**, though D7
  and Phase 1's "As built" said no toolkit bump: `checkVersions --against main` fails on any
  changed file under `src/toolkit/`, a test included, and Phase 1 changed
  `ScatterOnSurface.test.ts` (D7's "then a patch each", from Phase 1 instead of Phase 3). App
  1.14.0 unchanged. The `CHANGELOG.md` entry has Engine, Toolkit and Project sections;
  `yarn checkVersions --against main` passes.
- **The epic:** `_DONE_p600_…`, status `implemented (Stages A-D)`; its `Blocks` line and roadmap
  row name `_DONE_p621_…`, and its Branches and PRs table's Stage D row names the branch. The 23
  files naming its file are all plans (the twenty children's and this plan's `Epic:` lines,
  p622's and p800's `Related:` lines); no CLAUDE.md or Hub file names it
  (`devTools/verify/baselines.ts` and `devTools/layout/layoutRules.ts` cite "p600" by number
  only). The ten plans whose `Blocks` named this plan follow its rename.

## Done when

- `yarn hub:build` passes with no warnings; JSDoc coverage stays at 100 % (`docs.json`); the
  readme's examples compile (`yarn test`).
- The root CLAUDE.md is at or under 45 kB, and every path and name in the CLAUDE.md files
  resolves.
- The Architecture page is on the Hub, and the epic is `_DONE_`.
