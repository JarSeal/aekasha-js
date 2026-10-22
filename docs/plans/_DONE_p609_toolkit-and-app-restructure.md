Status: implemented (Phases 1-4)
Category: Refactoring, Toolkit, App
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B)
Blocks: \_DONE_p620_review-toolkit-and-app-code.md
Related: \_DONE_p602_architecture-and-target-structure.md (D2, D7, D8), \_DONE_p608_engine-folder-restructure.md (the codemod, `moveRules.ts`, its D9 after-move rules), \_DONE_p300_asset-optimization-pipeline-plan.md (the asset pipeline's output paths), the "Toolkit and asset housekeeping" (p450) prompt in `docs/templates/todo-plan-prompts.txt` (its folder structure is absorbed here; its new assets, LOD test scene and the debugger test assets stay in p450)

# Toolkit and App Restructure

The toolkit and the app get the same clarity as the engine: the toolkit as a catalogue of
ready-made pieces by category, the app as one folder per scene with the assets only that scene
uses. Moves and renames only, with p608's codemod (`applyMoveMap.ts --plan p609`): every
`aekasha/toolkit/*` entry exports the same names, every scene keeps its id, and every scene's
hash, snapshot and system order stays the same.

## 1. As found (2026-10-13, branch `toolkit-and-app-restructure` at `de10424`, = `main` after p608's merge)

What changed since the stub was written:

- **The deprecated re-exports are gone.** `toolkit/ecs/InstancedMeshPool*.ts` was removed in
  p606 Phase 7 (`a2001ec`). Nothing to do.
- **`AppECSPlugins.ts` is already the app's feature** (p607): `appECSPlugins: EngineFeature`
  (`id: 'app'`), listed last in `src/index.ts`'s `features`. p602 D8 is done; the file keeps its
  name (the root `CLAUDE.md`'s Versioning and the Hub's `ecs-register-plugin` region name it).
- **The toolkit major already shipped** (2.0.0 Half Moon, with `stage-b`). The epic's §11 makes
  p608-p611 minor or patch bumps, and the entries keep their names, so this is a toolkit patch
  (D6), not "the toolkit major in the changelog".
- **The move is mostly prepared.** p608 left 72 `p609` entries in `moveMap.json` (63 moves, 9
  keeps); `applyMoveMap.ts`, `compareBaselines.ts` and `moveTree.test.ts` (which applies p609's
  plan to today's tree without an error) take `--plan p609`.
- **Gap: the codemod doesn't rewrite asset JSONs.** `moveText.ts`' `getTextKind` makes every
  `.json` but `tsconfig.json` / `package.json` a `scan` (reported, not rewritten), so a moved
  asset JSON's `$schema` (`../../../.schemas/…`, one more `../` per folder level), a scene's
  `sceneFile` (relative to `src/app/`, eg. `./scene01_v2.ts`, `debugScene.scene.ts`) and a
  relative source (`"image": "./source/p299Atlas/…"`, `"fileName": "./aekashaSymbol.glb"`) would
  break. `moveRules.ts`' note "the codemod rewrites its `sceneFile`" isn't true yet. Phase 1 adds it.
- **The asset pipeline names outputs by path** (`outputs.ts`: `src/public/aek-assets/<path under
src/>.<hash>.<ext>`), and the cache key holds that path: a single texture or model by its
  relative source's path (`getLogicalPath`), an array, atlas or pack by its JSON's
  (`getArrayLogicalPath`, `getAtlasLogicalPath`, `getPackLogicalPath`). So the moved Æ symbol,
  impostor atlases, p299 atlases and p299 arrays get new outputs and lock entries, and `yarn
assets` encodes them again (the textures with `ktx`). A single asset with a public source
  (`testImport`'s `/debugger/assets/…` GLB) keeps its output.
- The Hub finds a scene's image next to its scene file (`devTools/hub/scenes.ts`), so the
  `.hub.png` moves with it; the examples keep `src/app/examples/<name>/` (the Hub's example rule).

## 2. Decisions (confirmed 2026-10-13)

### D1. The toolkit's categories

```
src/toolkit/
  ecs/            index.ts → aekasha/toolkit/ecs
    effects/      a component + its system, put on an entity: FollowTool, HoverEffect, MutualGravity, SunShadowFit
    gameplay/     FollowObjectCameraRig, MovingPlatform
  geometry/       index.ts → aekasha/toolkit/geometry
    generate/     Asteroid, Foliage, Terrain
    scatter/      ScatterOnSurface
    SeededRandom.ts
  materials/      index.ts → aekasha/toolkit/materials
    <id>/         one folder per material: <id>.material.json, <id>.tsl.ts
    TriplanarProjection.ts   (the shared TSL helper)
  models/<category>/<id>/    asset JSON + source; first category brand/ (aekashaSymbol)
  textures/<id>/             (p450's PBR textures)
  skyboxes/<id>/             (p450's sky boxes)
```

- By kind, not a folder per piece: six one-file modules don't need six folders. A piece that
  grows a second file gets its own folder inside its kind.
- **Only code categories have an entry** (`ecs`, `geometry`, `materials`; `TOOLKIT_CATEGORIES`
  in `eslint.config.js` and `devTools/aliases.ts` unchanged). Models, textures and sky boxes are
  asset JSONs reached by id through the gatherer, so they get no `aekasha/toolkit/*` entry.
- **Model categories:** `brand/` now; p450's reference models (bunny, dragon, teapot, Suzanne)
  go in `reference/`, its tree in `nature/`.
- `textures/` and `skyboxes/` have no content yet (git keeps no empty folder): they're named in
  the docs and created by p450.
- `SeededRandom.ts` stays in the toolkit (the p450 prompt's question): the engine doesn't use it.
  The simulation lint's message points at it until p610's RNG service exists.

### D2. The app: one folder per scene, with the assets only it uses

```
src/app/
  scenes/<sceneId>/   <sceneId>.scene.json, <sceneId>.ts, _dbg__ module, <sceneId>.hub.png,
                      the scene's own modules and the asset JSONs only this scene uses
  examples/<name>/    unchanged (the Hub's example rule)
  cameras/ lights/ impostors/ skyboxes/ textures/ postFx/   the shared asset JSONs
```

- **Scene ids stay** (thirdPersonGymScene, topDownTestScene, sceneTestECS, testDebugScene,
  scene01V2 included): they key `__saveData`, the scene runner's baselines, the LS state and
  `?startScene=`. File and folder names follow the id, which makes them consistent.
- **"Only this scene uses it"** is decided by who names the asset's id (scene JSONs, scene code,
  other asset JSONs; a Hub mention of the same word as a field name doesn't count), scanned
  2026-10-13. The moving assets are listed as file rules in `moveRules.ts` with the scene in
  their note (the "edited by hand" part of the map), so the map can be generated again:

  | Scene                 | Assets that move into its folder                                                                                                                                                                                |
  | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `largeWorld`          | `cameras/largeWorldOverview`, `lights/largeWorldAmbient`, `lights/largeWorldSun`, `impostors/largeWorldTreeCross.*` (impostor, atlas, 2 PNGs)                                                                   |
  | `lodShowcase`         | `cameras/lodShowcaseCamera`, `impostors/lodShowcaseKnotImpostor.*`, `impostors/lodShowcaseTreeCross.*` (4 files each)                                                                                           |
  | `physicsTest`         | `cameras/physicsTestCamera`, `lights/physicsTestAmbient`, `lights/physicsTestSun`                                                                                                                               |
  | `physicsTiers`        | `cameras/physicsTiersOverview`, `lights/physicsTiersAmbient`, `lights/physicsTiersSun`                                                                                                                          |
  | `skyShowcase`         | `cameras/skyShowcaseCamera`                                                                                                                                                                                     |
  | `space`               | `cameras/spaceCamera`                                                                                                                                                                                           |
  | `thirdPersonGymScene` | `cameras/thirdPersonGymCamera`, `lights/thirdPersonGymAmbient`, `lights/thirdPersonGymSun`, `characterVisual.ts` (the top-down test imports it from there)                                                      |
  | `topDownTestScene`    | `cameras/topDownTestCamera`, `lights/topDownTestAmbient`, `lights/topDownTestSun`                                                                                                                               |
  | `assetCompare`        | `skyboxes/assetCompare`                                                                                                                                                                                         |
  | `textureArrays`       | `textures/p299TestArray`, `textures/p299TestArray1`                                                                                                                                                             |
  | `textureAtlases`      | `textures/p299TestAtlas`, `textures/p299TestAtlasImage`, `textures/source/p299Atlas/` (8 PNGs)                                                                                                                  |
  | `sceneTestECS`        | `cameras/mainCamera`, `lights/ambientLight`, `materials/testMaterial`, `materials/testTslMat` (+ `.tsl.ts`), `meshes/testMesh`, `meshes/testImportedMesh`, `geometries/testSphere`, `importedAssets/testImport` |

- **Stay shared:** `scene01Camera` / `scene01Ambient` / `scene01Sun` (scene01 and scene01V2),
  `largeWorldRockImpostor` (largeWorld and lodShowcase), `basicSkybox`, `dayNight`, `space`
  (skybox), `ambientOcclusion` (postFx), `testTexture`, and `p341AlphaCutTest` (no scene uses it;
  p620 decides whether it goes). `materials/`, `meshes/`, `geometries/` and `importedAssets/`
  end up empty and disappear.
- An asset that a second scene starts using moves back to its type folder (the rule for later
  work, written into the Hub's app-structure text in Phase 3).

### D3. The asset location question (the p450 prompt)

Answered by p300: an asset's source sits next to its JSON (in the toolkit or the app), and the
pipeline writes the shipped output to `src/public/aek-assets/` (generated and committed, so a
clone needs no encoder; `dist/aek-assets/` gets only what production loads). Toolkit sources
already live in the toolkit. **Handed back to p450:** the ~145 debugger test files in
`src/public/debugger/assets/` (sources used from public paths), which the prompt wants out of
`public/`. Phase 3 writes this into the p450 prompt.

### D4. The codemod reads asset JSONs

A rewriter for every gathered asset JSON under `src/` (by suffix, the gatherer's list): text
edits on the string values only (formatting and `__saveData` stay byte for byte), each edit
resolved against the file's old folder and written against its new one:

- `$schema`: the schema's file in `.schemas/`, written from the new folder (so the 10 scene JSONs
  whose `../.schemas/…` is broken today are fixed by their move);
- `sceneFile`: resolved from `src/app/` (the gatherer's base), with or without `.ts`, written as
  `./scenes/<id>/<id>.ts`;
- any other string starting `./` or `../` (`image`, `fileName`, layer paths): a tracked file,
  mapped and re-relativised. A relative path that resolves to no tracked file is an error;
  root-absolute paths (`/debugger/…`) are left alone.

A JSON that doesn't move but points at a moved file (a texture whose source folder moves) is
rewritten too. Tested on in-memory trees like the other rules.

**As built (Phase 1):** its own module, `devTools/refactor/moveJson.ts` (`isAssetJson`,
`rewriteAssetJson`, tests in `moveJson.test.ts`), called by `moveTree.ts`' `rewriteTree` next to
the stylesheet rewrite, not a `moveText.ts` text kind: JSONs stay `scan` there, so the leftovers
report still lists a path in a JSON string the rewrite doesn't own (a `description`). It parses
with `ts.parseJsonText` for the string positions. `$schema` changes only for a JSON that moves;
`sceneFile` keeps its `./` and `.ts` as written (`./oneMoreScene`, `debugScene.scene.ts`). A
third key the plan missed: **`tslFile`** (a material's or PostFX's TSL module), which the gatherer
resolves from the JSON's root under `src/` (`getBasePath`: `src/app/` or `src/toolkit/`), not
from the JSON's folder and without `./` (`"materials/asteroid.tsl.ts"`); it's resolved like
`sceneFile`, from that root.

### D5. After the move

As p608 D9: `moveRules.ts`' toolkit and app rules describe the layout (keep rules), so a new file
outside it fails `moveMap.ts`, and `moveTree.test.ts`' p609 test skips (no plan left to apply).
`MovePlan` keeps `'p609'` for `--verify-commit` and `compareBaselines` on the move commit.

### D6. Versions

- **Toolkit 2.0.1 → 2.0.2** (patch): moves only; every entry exports the same names. The Æ
  symbol's output URL changes, which nothing names by hand (it's in the generated data).
- **App 1.10.1 → 1.10.2** (patch): moves and renames, same scenes.
- **Engine:** unchanged unless a comment of the text rewrite lands in it (then a patch, as p608's
  toolkit and app patches).
- **Project:** the codemod's JSON rewrite, the rules.

No example scene: nothing new to show (the Hub's app-structure and toolkit pages change, Phase 3).

## 3. Phases

The move is one commit made by the codemod (`--verify-commit` checks it), so the phases split
around it: the tooling before, the outputs and fixes after, the docs last.

### Phase 1: the rules and the JSON rewrite — done

No file of the toolkit or the app changes.

1. Record the scene runner's baselines on this branch's base (`de10424` = `main`):
   `yarn verify:scenes --update`, in the background (Workflow's "Watching a long run").
2. D4: the asset JSON rewrite with its tests.
3. `moveRules.ts`: D1 (`ecs/gameplay/` for `FollowObjectCameraRig.ts` and `MovingPlatform.ts`,
   `models/brand/` without the "proposal" note), D2's asset file rules with their notes, the
   `sceneFile` note made true.
4. `npx tsx devTools/refactor/moveMap.ts`, then review `layoutReport.md` and the map's p609
   entries (expected: 72 + D2's 52 asset files).
5. `applyMoveMap.ts --plan p609 --dry-run`; its leftovers name what `MOVE_EDITS` needs (expected:
   the simulation lint message's `toolkit/geometry/seededRandom.ts`, any toolkit-relative path in
   a comment). Add those edits, dry-run again until it's clean.
6. `yarn test`, `yarn lint`. Commit.

**As built:**

- Step 1: 96 of 96 runs recorded (24 scenes × 4 configurations, WebGPU, `.cache/verify/scenes/webgpu/`).
- Step 2: `moveJson.ts` (D4's as built), with `tslFile`.
- Step 3: D2's assets are `SCENE_ONLY_ASSETS` in `moveRules.ts`, by scene id, paths from
  `src/app/` (a folder ends `/`, `name.*` takes an impostor's four files); a path that names no
  file throws, so the list can't go stale silently.
- Step 4: the map has 565 files, p609 124 (117 moves, 7 keeps: the four effects, the three
  entries); the layout report's 26 boundary violations are `main`'s.
- Step 5: the leftover scan reads only full and engine-relative paths, so it didn't name the lint
  message: a `grep` for toolkit-relative paths found it, the one entry in `MOVE_EDITS`. The first
  dry run also failed on `debugInProduction.test.ts`, whose fixture `/src/app/_dbg__spaceDemo.ts`
  (an id with a leading `/`, which the text rewrite doesn't match) was rewritten in the expected
  string only: the fixture is now `_dbg__demo.ts`, a path no plan moves. The last dry run: apply,
  `tsc`, `tsc -p hub`, `yarn test`, `yarn lint` and `yarn build` pass; 117 moves, 86 texts
  changed, 0 errors; its 64 leftovers are all in `assets.lock.json` and
  `src/generated/generatedAppData.json`, which Phase 2's `yarn assets` and gather write again.

### Phase 2: the move — done

1. `npx tsx devTools/refactor/applyMoveMap.ts --plan p609`: commit alone, its message naming the
   command and the base (`p609: apply the move map`).
2. `yarn setupAssetTools` (if `.tools/` has no `ktx`), then `yarn assets` (a full run: it prunes
   the old outputs and lock entries) and `yarn gatherAppData`. Commit the outputs, the lock and
   the generated data.
3. Checks: `applyMoveMap.ts --verify-commit <move sha>`, `compareBaselines.ts --plan p609 <base>`,
   `yarn test`, `yarn verify:scenes` (every configuration, against step 1's baselines),
   `yarn verify:baselines`, `yarn build`, `yarn hub:build`.
4. `applyMoveMap.ts --plan p609 --leftovers <base>`: fix what's left by hand (asset JSON
   descriptions naming old files, eg. `thirdPersonGymSun.light.json`'s), and give the three
   asset JSONs without a working `$schema` theirs (`testDebugScene` and `oneMoreScene` have
   none, `ambientLight.light.json` has the typo `"$schemas"`). Commit.

**As built:**

- The commits: `d04b076` (the move, on `ffa46d8`; `--verify-commit` passes), `eb5c2be` (the
  outputs, the lock, the generated data), `6876682` (the baselines), `9089c86` (the leftovers).
- Step 2: the 13 outputs of the moved assets came out byte for byte the same (same content
  hashes) under their new logical paths (`aek-assets/app/scenes/<id>/…`,
  `aek-assets/toolkit/models/brand/…`); the full run removed the 13 old ones. So the risk below
  didn't happen.
- Step 3: `compareBaselines.ts --plan p609 ffa46d8` passes (the bundle differs by nine renamed
  chunks: `scene01_v2.js` → `scene01V2.js`, `generateAsteroid.js` → `Asteroid.js`, …), after
  `yarn verify:baselines --update --allow-docs-drop` (committed). `yarn test`, `yarn build` and
  `yarn hub:build` pass. `yarn verify:scenes`: 93 of 96; **`lodShowcase`'s three debug
  configurations fail on the snapshot** (0.12-0.13 % of the pixels, max 47-49, all in the
  clouds), with the same probe hash. Not the move: `ffa46d8` (before it), run in a worktree
  against the same baselines, fails the same way. The scene's sky drifts between runs an hour
  apart (the sky box's env bakes are throttled by `performance.now()`), so its baseline only
  holds for a while; it's left for an issue file (Phase 4 asks).
- Step 4: the leftover report found nothing (it reads full paths); a `grep` for the old file
  names found eight: bare names in comments and asset descriptions (`scene01_v2.ts`,
  `scene_thirdPersonGym.ts`, `testECS.ts`, `topDownTest.scene.json`, …), the toolkit
  walkthrough's `src/toolkit/models/aekashaSymbol/` folder, `lod/CLAUDE.md`'s lanes folder and
  `debug/CLAUDE.md`'s `_dbg__spaceDemo.ts` example. The codemod had carried `ambientLight`'s
  misspelled `"$schemas"` value along as a relative path, so only its key changed.

### Phase 3: after the move, the docs and the Hub — done

1. D5: the rules become keep rules, `moveMap.ts` regenerates (every file a keep), the
   `moveTree.test.ts` skip.
2. Root `.claude/CLAUDE.md`: the three-folder split's toolkit (D1's categories, the models path)
   and app (D2) lines; nested `CLAUDE.md` files naming app paths (`features/lod/CLAUDE.md`'s
   `lodShowcase`, others the leftovers named).
3. The Hub: the toolkit pages (`hub/pages/examples/toolkit/`, the feature pages that name toolkit
   paths), the app-structure text (where a scene and its assets go, D2's rule for shared assets),
   `features/asset-optimization/guide.md`'s Æ symbol path. `yarn hub:build`.
4. `readme.md` where it lists the toolkit or the app layout.
5. D3 into the p450 prompt (`docs/templates/todo-plan-prompts.txt`): the asset location answer,
   the categories it fills, the debugger test assets it keeps.

**As built:**

- The commits: `de333d2` (the rules), `782e196` (the CLAUDE.md files), `80ac8f0` (the Hub),
  `db5b33b` (the readme), then the p450 prompt with this plan.
- Step 1: `moveRules.ts`' toolkit and app rules are keep rules; `getSubfolderRules` makes the
  "a folder per id" ones from the tracked files (`materials/<id>/`, `models/<category>/<id>/`,
  `textures/<id>/`, `skyboxes/<id>/`, `scenes/<sceneId>/`), so a loose file there has no rule.
  The app's rules list every asset type's folder (`materials/`, `meshes/`, … come back with the
  first shared asset, D2), and `moveMap.ts` now fails on an app file without a rule too. The map:
  636 files, all keeps (p608 441, p609 195). The skip is "no p609 move whose source is still
  tracked". A bug the move exposed: with no moved path, the leftover mentions' regex was an empty
  alternation that matched everywhere; the scan is skipped then.
- **Added: `src/app/shared/`** (confirmed 2026-10-13), for app code several scenes use (a
  copied toolkit piece among them), in the rules, the root `CLAUDE.md`, the Hub and the readme. D2
  had no place for it; `characterVisual.ts` stays in the gym's folder (p620 may move it).
- **Added: `src/generated/**` is out of the `prettier/prettier` lint rule.** The move made
  `generatedAppFns.ts`' `triplanarCheckerboard.tsl.ts` import longer than the print width, so the
  Stop hook's `lint --fix` and every gather undid each other (the committed form failed a plain
  `yarn lint`).
- Step 3: the app layout and D2's rule went into the Hub's Scenes and assets page (a new "Where
  the files go" section); the toolkit guide got D1's tree and the gameplay pieces it never listed
  (`createFollowObjectCameraRig`, `createMovingPlatform`); the quick start copies to
  `scenes/<id>/`. The Æ symbol's include was the codemod's already. The search index's 1.09 MB
  warning was there before.
- Step 4: the readme's toolkit list was stale besides the layout (a "checkerboard" material that
  doesn't exist; `MutualGravity`, the gameplay pieces and the asteroids missing), and its example
  scene JSON's `$schema` / `sceneFile` were wrong for a scene folder.
- Step 5: the prompt's location and structure paragraphs are replaced by what p300 and p609
  decided and what's left: filling the categories, and moving the ~145 debugger test files out
  of `public/` into the scene folders that use them.
- For Phase 4 (D6): the branch changes no engine code against `main`, only three nested
  `CLAUDE.md` files under `src/_engine/` (`debug/`, `features/lod/`, `features/lod/impostors/`),
  so the engine keeps 5.0.1 unless a docs-only change should count. The CHANGELOG's Project
  section gets the keep rules, `src/app/shared/` and the generated code's lint exception.

### Phase 4: versions and done — done

D6's bumps, the `CHANGELOG.md` entry (Toolkit, App, Project; Engine if touched), `yarn
checkVersions --against main`, mark the plan done (`docs/plans/CLAUDE.md`), p620's `Blocked by`
line. Then the PR: `toolkit-and-app-restructure` into `main` (the epic's Branches and PRs row).

**As built:**

- **Engine 5.0.2 (patch), not unchanged:** `yarn checkVersions --against main` counts any file
  under `src/_engine/`, and the branch changes three nested `CLAUDE.md` files there (no code),
  so the engine and the project version took a patch, as D6 says for a text change in it.
  Toolkit 2.0.2, App 1.10.2 as planned. The `CHANGELOG.md` entry has Engine, Toolkit, App and
  Project sections.
- `lodShowcase`'s snapshot drift (Phase 2) got an issue file,
  `docs/issues/lodshowcase-sky-snapshot-drift.md`: the view's clouds read three's TSL `time`
  (the wall clock), not the engine's elapsed time.
- p620's `Blocked by` (only this plan) is dropped.

## 4. Risks

- **Re-encoded outputs differ.** The arrays' and atlases' outputs are encoded again under their new paths;
  the same `ktx` version and input should give the same bytes, but a different hash only changes
  a URL. The scene runner's snapshots are the check.
- **A dev server running during the move** gathers half-moved trees: stop it for Phase 2.
- **Case-insensitive file systems:** the moves include no case-only rename except the toolkit's
  PascalCase ones (`seededRandom.ts` → `SeededRandom.ts`, `triplanarProjection.ts` →
  `TriplanarProjection.ts`), which the codemod renames through a temporary name.
