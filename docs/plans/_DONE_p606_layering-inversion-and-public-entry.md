Status: implemented (Phases 1-10)
Category: Architecture, Refactoring
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B, engine major)
Blocks: \_DONE_p607_sbp-foundation-feature-modules.md, p608_engine-folder-restructure.md, p510_headless-simulation-runtime.md
Related: \_DONE_p604_multiplayer-viability-study.md (the headless-core rules), \_DONE_p602_architecture-and-target-structure.md (D1, D3, D9, D10), \_DONE_p605_coding-standards-and-documentation-tooling.md (the `@example` rule)

# Layering Inversion and Public Entry

The engine stops importing the app, gets its public entry points, and the boundary becomes a lint
rule (p602 D1, D3, D9, D10). After this plan, the app and the toolkit reach the engine only through
`aekasha` / `aekasha/*`, so p608's folder moves no longer touch any consumer.

---

## 1. Goal

- **The engine imports nothing outside `src/_engine/`:** not the app, the toolkit, the `src/*.ts`
  root files or the generated data.
- **The engine owns its types:** system stages and their order constants live in the engine; app
  and toolkit components extend the engine's component map by declaration merging, without
  editing a shared file and without `as any`.
- **Configuration and data flow in:** `InitEngine({ config, data, start })`. No module reads
  `window.location` or `import.meta.env` at load (p604 §4.6).
- **One public import path per entry:** `aekasha`, `aekasha/<feature>`, `aekasha/ui`,
  `aekasha/debug`, `aekasha/schemas`, `aekasha/toolkit/<category>`.
- **The lint enforces it**, and the physics worker's headless boundary has a regression test.
- **No behaviour change:** every scene's snapshot and determinism hash, the LS keys, `__saveData`
  and the URL flags stay as they are (p600 §3.7).

## 2. Grounding (checked against the code, 2026-10-10)

Where the code has moved since the stub was written:

- **Engine → app root: 34 files, not 33.** 32 import `src/AppECSRegistry.ts`: 31 for the stages
  (21 `ECSSystemStage` only, 10 with `APP_RENDER_SYNC_ORDER`) and `core/ECS/ECSCoreComponents.ts`
  for `AppComponentType` / `AppComponentData`. `core/Config.ts:1` imports `../../CONFIG`.
  **Not in the stub:** `InitApp.ts:47` imports `../AppECSPlugins` for its side effect, so the engine
  registers the app's systems.
- **Toolkit → app root:** the four effects (`HoverEffect`, `SunShadowFit`, `FollowTool`,
  `MutualGravity`) import the stages; so do `utils/world/movingPlatform.ts` and
  `utils/cameras/followObjectCameraRig.ts`, engine files that p608's map moves to the toolkit. The
  `as any` storage reads are in three of the four effects (`HoverEffect.ts:27`,
  `SunShadowFit.ts:221`, `FollowTool.ts:37`); `MutualGravity` has none.
- **`ComponentType` is a runtime object** (`ECSCoreComponents.ts:121`, `{ ...CoreType, ...AppType }`),
  so declaration merging changes values, not only types:
  - The app reaches toolkit keys through it: `ComponentType.HOVER`, `.FOLLOW`, `.SUN_SHADOW_FIT`,
    `.SPIN` (5 app files).
  - It's enumerated at runtime in three places: `ECS.ts:297` pre-allocates a storage per type
    (harmless to lose: `getStorage` creates a missing one), `utils/ECSHelpers.ts:173` (the entity
    inspector's component list) and `_dbg__ProfilerObjects.ts:312` (the profiler's names). Without
    app types in the object, the last two stop listing app and toolkit components.
- **Declaration merging works through an entry** (TS 5.4.5, tested in a scratch project):
  `declare module 'aekasha' { interface ComponentDataMap { [HoverType.HOVER]: HoverData } }` merges
  through the entry's `export type { ComponentDataMap } from …` and through `export *`, with
  several augmenting modules, and the engine's own `K extends keyof ComponentDataMap` signatures
  see the new keys. It broke when one program augmented the same file through **two** specifiers.
  Rule: augment only `'aekasha'`.
- **Config at load:** `Config.ts:304-318` reads the URL params and `import.meta.env`, and
  `IS_DEBUG_ENV` (51 files), `IS_PROD_TEST_MODE` (11), `IS_PROD_ENV`, `IS_PROD_TEST_ENV`, `CUR_ENV`
  are `const`s computed from them at load. Module-load readers elsewhere: `ECS.ts:47`
  (`STORE_DEBUG_DATA`), plus `_dbg__SkyBox.ts:55` and `_dbg__DebugCamera.ts:12`, which load after
  `InitEngine` and are fine. The other `import.meta.env` reads (`AssetUrl.ts`, `DracoDecoder.ts`,
  `KTX2.ts`) are inside functions. (`APP_CONFIG` is the defaults object from before `loadConfig`
  merges `CONFIG.ts`; nothing reads it. Left for p612.)
- **`import type` is already done:** p605 turned on `verbatimModuleSyntax` and
  `consistent-type-imports`, and the three `LoopState` imports are `import type`. What's left of the
  stub's item is the regression test.
- **Out of this plan's scope, though p604 §4.6 lists them:** the `?worker` imports at load
  (`PhysicsAPI.ts:10`, `AssetsAPI.ts:7`) and `InitApp.ts`'s SCSS import. They're p607's (lazy
  physics, the install contract) and p510's.
- **Generated data:** read by `core/Scene.ts:20` (the 635 KB JSON), `SceneLoader.ts:61`,
  `Material.ts:5`, `PostFX.ts:29`, `_dbg__MaterialEditor.ts:20`. Paths named in `gatherAppData.ts:93-97`
  (`OUTPUT_FILE_*`, which `sceneGathererPlugin.ts` and `assetOutputsBuildPlugin.ts` use),
  `hub/paths.ts:55`, `verify/scenes.ts:61`, `devFiles/selfCheck.ts:43-44`, `checkVersions.ts:39-40`,
  `eslint.config.js:102`, `tsconfig.json`'s `typedocOptions`, `hub/api/extract.ts:49`,
  `devFiles/CLAUDE.md`, `refactor/moveRules.ts:54-61`.
- **Deep imports:** 41 app files import 57 engine modules; the app imports 7 toolkit modules; the
  toolkit imports 11 engine modules. `readme.md`'s examples and
  `hub/pages/documentation/code-blocks/intro.md` show deep paths too. No aliases exist yet.
- **Lint:** `eslint-plugin-import` 2.32.0 is installed but not loaded; the only resolver installed
  is `eslint-import-resolver-node` (no TypeScript resolver).
- **`@example`:** 2 (`LineManager.ts:62`, `PhysicsTierPolicy.ts:178`). `createLines`' example
  has `for (...)`, which doesn't parse, and free names (`box`, `ax`, …).
- **Versions:** engine 4.15.1 Afternoon, toolkit 1.4.1 Crescent, app 1.9.1 Preschooler.
  `checkVersions --against main` requires a bump on every merge that changes a part, so p600 §11's
  "later Stage B merges add to the same changelog entry" fails the check (see D5).

## 3. Decisions

Each had a recommendation; all five were confirmed as recommended on 2026-10-10 (the "As decided"
line under each). No Hub example scene: nothing here is visual (the ECS, `InitEngine` and migration
pages cover it).

### D1. The app migrates in this plan, and the boundary lint is an error everywhere

p602 D10 planned warnings for the app until p608's codemod migrated it; this plan's own done
criteria say the app imports only entries. **Recommended:** migrate the app here (Phase 7) and
make every boundary rule an error. p608 then only rewrites the entries' own re-export paths, and no
consumer sees its moves: from this plan on, a deep path is internal by definition. The import
codemod (`devTools/refactor/migrateToEntries.ts`) ships with the major (p600 §11) for apps made from
the template.

**As decided:** recommended (app migrated here, errors everywhere).

### D2. The kernel → feature seams are p607's

p602 D2 and its risk 2 say p606 designs the seams (a fixed-step hook, a render pipeline hook, scene
enter / exit hooks, import extensions, assets worker job kinds), and `moveRules.ts` cites p606 for
the import extension and for merging the debug wrappers. **Recommended:** p607 designs and builds
the seams with the install contract they belong to (`install(ctx)` fills them), and the debug
wrappers merge with their move (p608 / p618). p606 only fixes the notes that name it. Designing
the seams without the contract would be guesswork.

**As decided:** recommended (p607 designs and builds the seams).

### D3. Entry contents and the remaining layout questions

- **What an entry exports:** the `public` exports in `entryExports.json` (the app, the toolkit, a
  Hub `api:` link or the devTools use them), plus the `unreferenced` ones that are documented API
  for apps (reviewed per entry in Phase 3). `crossEntry` and `internal` exports aren't re-exported:
  engine code imports engine code by relative path, never through an entry.
- **No `@internal` tagging pass here.** TypeDoc keeps its source-file entry points in this plan
  (the Hub's API pages and the docs ratchet are per folder). Switching TypeDoc to the entries is
  p619's (with the renderer, p602 D3); then only what an entry exports is documented, and
  `@internal` is needed only for what an entry exports but apps shouldn't use.
- **The public surface is a baseline:** `api.json` gains each entry's export list (read from the
  AST with `refactor/importGraph.ts`), so `yarn verify:baselines` diffs the public surface itself.
- **`aekasha/schemas` stays its own entry**, and `utils/` goes in `aekasha` (p602 Phase 2's default,
  confirmed).
- **schemas → feature imports** (`impostorSchema`, `lodSchema`, `skyBoxSchema`): the feature's
  schema moves into its feature in p608 (a `moveRules.ts` change here), and the feature's entry
  exports it. `aekasha/schemas` keeps the shared and kernel schemas and re-exports the feature ones
  for the devTools. **Changed in Phase 3:** the move alone leaves `meshSchema → lodSchema`,
  `sceneSchema → skyBoxSchema` and `core/Scene.ts → impostorSchema`, so the three stay in
  `schemas/` and `aekasha/schemas`; composing the scene and mesh schemas from features is a seam
  for p607 (no `moveRules.ts` change).
- **`ui/` → kernel** (`DraggableWindow.ts` reads `Config.ts` and `addResizer`): p617's, with the UI
  kit. **`utils/PromiseResolver.ts` → `Config.ts`:** fixed here (Phase 5), as p602 D6 says.

**As decided:** recommended.

### D4. The environment is read at init, and the flags become live bindings

`InitEngine` calls `initEnvironment({ search, env })` first (defaults: `window.location.search`
when `window` exists, `import.meta.env`; a headless runner passes its own). The flags stay exported
under their names as `export let`, assigned there: an ES module import is a live binding, so every
reader at call time sees the value. Module-load readers (`ECS.ts:47`) become lazy. Before
`InitEngine` the flags read as production (all `false`), which a test can rely on. The duplicate
pairs (`isDebugEnvironment()` / `IS_DEBUG_ENV`, …) stay; p612 picks one.

**As decided:** recommended (environment read in `InitEngine`, flags as live bindings).

### D5. Stage B's branches and the version

`checkVersions` makes every merge that changes a part bump it, so Stage B plans can't share one
major across several merges to `main`. Options:

- **A (recommended): p606 and p607 on one integration branch (`stage-b`), merged to `main` once as
  engine 5.0.0 and toolkit 2.0.0.** Both change `InitEngine`'s signature (`{ config, data, start }`
  here, `features` in p607); one major means apps migrate once. From p608 on, the moves are internal
  (consumers use entries), so p608-p611 merge plan by plan as minor or patch bumps.
- **B:** p606 merges alone as 5.0.0, p607 as 6.0.0 (two majors and codenames in a row).
- **C:** one long-lived branch for all of Stage B (p606-p611). Fewest bumps, but `main` waits
  months and p608's codemod runs against a moving branch.

The app gets a minor bump (its code migrates; no app feature changes).

**As decided:** option A. This plan's branch merges into a `stage-b` integration branch (cut from
`main`), not into `main`; `stage-b` merges to `main` after p607 with the majors, whose codenames are
chosen then. **Changed in Phase 10:** `checkVersions` fails a major bump that keeps its codename,
so they're chosen here (engine 5.0.0 Golden Hour, toolkit 2.0.0 Half Moon); `stage-b`'s merge can
still rename them.

## 4. Design

### 4.1 Stages

`ECSSystemStage` and `APP_RENDER_SYNC_ORDER` move, unchanged in name and value, to
`src/_engine/core/ECS/SystemStages.ts` (p608 rule: `kernel/loop/SystemStages.ts`, p602 D2's "the
stages"). `AppECSRegistry.ts` keeps no re-export (p600 §11: no shims).

### 4.2 Components

```ts
// Engine (ECSCoreComponents.ts): the map is an interface, so it can be merged
export interface ComponentDataMap extends CoreComponentData {}
export type ComponentType = keyof ComponentDataMap;
export type ComponentData = ComponentDataMap;
export const ComponentType = CoreComponentType; // the engine's own keys only

// Toolkit (HoverEffect.ts)
export const HoverToolComponentType = { HOVER: '…' } as const;
declare module 'aekasha' {
  interface ComponentDataMap {
    [HoverToolComponentType.HOVER]: HoverComponentData;
  }
}
const storage = world.getStorage(HoverToolComponentType.HOVER); // typed, no `as any`
```

- `AppECSRegistry.ts` becomes the app's augmentation (its `HEALTH` and stress-test keys); the
  toolkit and the app's `SpinComponent` augment in their own files. App code uses each module's
  own key object (`HoverToolComponentType.HOVER`, not `ComponentType.HOVER`).
- The debug enumerations (`ECSHelpers.ts:173`, `_dbg__ProfilerObjects.ts:312`) list the types the
  world has a storage for (a new `ECSWorld.getComponentTypes()`), showing their values
  (`CORE_TRANSFORM`, `APP_SPIN`) instead of the core keys' names: a small visible change in the
  inspector and the profiler.

### 4.3 `InitEngine`

```ts
import { InitEngine } from 'aekasha';
import config from './CONFIG';
import { appData } from './generated';

InitEngine({ config, data: appData, start: async () => { … } });
```

- `data` is one object the gatherer generates in `src/generated/index.ts`: `{ json, scenes,
  tslMaterials, postFx }` (today's `generatedAppData.json`, `sceneFileObjects`,
  `tslMaterialFileObjects`, `postFxFileObjects`). The engine keeps it in one module
  (`core/AppData.ts`: `setAppData` from `InitEngine`, `getAppData()` for the five readers).
- `src/generated/` holds `generatedAppData.json`, `generatedAppFns.ts` and `index.ts`, all
  committed and written by `gatherAppData`. `checkVersions` keeps excluding them from every part.
- The app's plugins: `src/index.ts` imports `./AppECSPlugins` (after the engine, as today), until
  p607 turns them into an entry in `features`.

### 4.4 Entries and aliases

- Files, each re-exporting from today's paths (p608 moves the code under them and rewrites only
  these paths): `src/_engine/index.ts`; `src/_engine/features/<name>/index.ts` for physics,
  character, skybox, lod, spatial, instancing, lines, postfx, viewports; `src/_engine/ui/index.ts`,
  `debug/index.ts`, `schemas/index.ts`; `src/toolkit/<category>/index.ts` for ecs, geometry,
  materials. Named re-exports, not `export *`, so an entry lists its API.
- Aliases from one list (`devTools/aliases.ts`) in `tsconfig.json`'s `paths` (TypeDoc and `tsx` read
  it), `vite.config.ts`'s `resolve.alias` (workers included) and `vitest.config.ts`.
  `aekasha/toolkit/*` is matched before `aekasha/*` (p602 D1).
- `moveRules.ts` gets a rule for every new file, so `moveMap.ts --check` stays green.

### 4.5 Boundary lint

| Rule | Where | What |
| --- | --- | --- |
| `import/no-restricted-paths` | `src/_engine/` | no `src/toolkit/`, `src/app/`, `src/*.ts`, `src/generated/` |
| `import/no-restricted-paths` | `src/toolkit/` | no `src/app/`, `src/*.ts`, `src/generated/` |
| `no-restricted-imports` | `src/_engine/` | no `aekasha*` (an entry imported inside the engine makes barrel cycles) |
| `no-restricted-imports` | toolkit, app, `src/*.ts`, `src/generated/` | no path into `_engine/` or another toolkit category's files: only `aekasha*` |
| `no-restricted-imports` | everything but `_dbg__*` and debug folders | no static or `export … from` import of a `_dbg__` module (a dynamic `import()` isn't checked by the rule, which is the point) |

The relative paths resolve with the node resolver and `.ts` in `import/resolver`'s extensions; no
new dependency.

### 4.6 `@example` check

A Vitest test (`devTools/verify/examples.test.ts`): extract each `@example` of the documented API
with the TypeScript AST, prepend an import of every name its entry exports, and type-check the
lot in one in-memory program with the real `tsconfig.json`. Free names (`box`, a variable the
reader has) are allowed: `Cannot find name` is the one error ignored; anything else fails with the
file and line. Runs in `yarn test`, so the Stop hook runs it.

### 4.7 Headless regression test

A Vitest test (`src/_engine/workers/physicsWorker.test.ts`) bundles `workers/physicsWorker.ts` with
esbuild (already installed with Vite; added as a direct devDependency at its version) and fails when
the metafile's inputs include `three`, `core/MainLoop.ts`, `core/Config.ts` or `core/PhysicsAPI.ts`
(p604 Phase 1's check).

## 5. Phases

Each phase leaves the tree compiling, lint-clean and the app working. Verification per phase:
`yarn test`, `yarn lint`, `tsc`, `yarn verify:scenes` (snapshots and hashes unchanged) and
`yarn verify:baselines` (`api.json`'s diff is only the phase's intended change); the phase lists
what it adds.

### Phase 1: the safety net — done

1. Record the scene baselines on `main`'s commit (`yarn verify:scenes --update`, before this
   branch's first change).
2. The headless regression test (§4.7).

**As built:**

- The scene baselines: 24 scenes × 4 configurations, WebGPU (macOS), all 96 recorded. The first
  run had 10 failures caused by editing files under the runner's dev server (reloads, a restart
  after `yarn add`, the mutation check below served for a moment), re-recorded clean. Don't edit
  the tree while the runner runs.
- `src/_engine/workers/physicsWorker.test.ts` (~140 ms): esbuild with `packages: 'external'`, and
  the Vite-only imports (styles, `?raw`, `?worker`) marked external by a plugin, so a regression
  fails the assertions by name instead of the build. Checked with a mutation (the worker's
  `LoopState` import written `import { type … }`): both tests failed, naming `Config.ts`,
  `PhysicsAPI.ts`, `three/webgpu` and 18 more packages.
- `esbuild` 0.25.12 is a direct devDependency; `moveRules.ts` maps the test next to the worker.

### Phase 2: the engine owns its stages; the app registers its own plugins — done

1. `core/ECS/SystemStages.ts` (§4.1); the 31 engine files, the 4 toolkit effects, the app and
   `ECS.test.ts` import it.
2. `InitApp.ts`'s `import '../AppECSPlugins'` moves to `src/index.ts`. The scene runner confirms the
   system order (registration order breaks ties within a stage and order) didn't change.
3. Engine → app root left: `Config.ts`'s `CONFIG` and `ECSCoreComponents.ts`'s component types.

**As built:**

- `core/ECS/SystemStages.ts` holds the enum and the constant verbatim; 30 engine files,
  `ECS.test.ts`, the 4 toolkit effects and 3 app files (`SpinSystem.ts`, `physicsTiers.ts`,
  `scene_thirdPersonGym.ts`) import it. `readme.md`'s ECS example imports it too (Phase 7 turns it
  into an entry import). `moveRules.ts` maps it to `kernel/loop/SystemStages.ts` (a file rule
  beating the `core/ECS/` folder rule).
- `src/index.ts` imports `./AppECSPlugins` right after `InitApp`, so the app's plugin now
  registers after every engine module `InitApp.ts` imports (it used to sit between them). Checked
  with every stage's `getSystemOrder` dumped in 5 runs (prodTest: `sceneTestECS`,
  `thirdPersonGymScene`, `physicsTiers`; debug: `sceneTestECS`, `thirdPersonGymScene`) before and
  after: identical except, in debug on the gym, `lightHelperSyncSystem` and
  `cameraHelperSyncSystem` (`LATE_MAIN`, order 0) swapped. Those two register from `_dbg__`
  modules that `registerLightManager` and `initDebugCamera` load with `import()` at init, so their
  order was already a race between two loads; they sync independent debug helpers. Left as is.
- The layout report's engine → app is down to `CONFIG.ts` and `AppECSRegistry.ts` (one importer
  each), and toolkit → app is gone. `api.json` gains the two exports at their new home, which
  `entryExports.json` lists as `public` in `aekasha`. The bundle moves about 0.2 kB gzip from the
  app group to `_engine/core/ECS`.
- Root `CLAUDE.md`'s ECS core line names the stages' new file (the rest of its update stays in
  Phase 9).
- `yarn verify:scenes`: 96 passed against the Phase 1 baselines.

### Phase 3: the entries and the aliases — done

1. The aliases (§4.4) in the three configs.
2. The entry files with the D3 contents; the user reviews each entry's list before they're
   committed.
3. `api.json` gains the entries' export lists (`devTools/verify/baselines.ts`).
4. Nothing imports the entries yet, so the bundle is unchanged.

**As built:**

- `devTools/aliases.ts` (`ENTRY_FILES`) is the list: `getViteAliases` for `vite.config.ts` and
  `vitest.config.ts`, and a copy in `tsconfig.json`'s `paths` that `devTools/aliases.test.ts`
  checks. One exact alias per entry (`^aekasha$`, `^aekasha/physics$`), not §4.4's wildcards: an
  unknown entry fails to resolve, and Vite's string aliases match by prefix.
- 16 entries, 503 names, named re-exports from today's paths (`export { … } from` and separate
  `export type { … } from`). The lists, as reviewed:
  - every `public` export in `entryExports.json`, except the Rapier backend's `createJoint` /
    `deleteJoint` (the facade's are exported) and the TSL materials' `colorNode` / `normalNode`
    (asset files, imported by path from the generated code);
  - 54 names added by hand where they complete an exported API, `crossEntry` / `internal` ones
    included, since D3's rule alone exported `createKeyBinding` without `deleteKeyBinding`: the
    input bindings' create / delete / enable, the time getters, the inverse operations
    (`unregisterView`, `deleteSceneMainLooper`, `removeMeshLod`, `removeToast`, …), the ECS
    transform helpers, the physics facade's async create / delete / get (not the `*Sync` ones),
    `PhysicsCapacityError`, the lines' `*ToSegments` builders and `preloadFatLineBackend`,
    `triplanarProjection`;
  - the types an exported function's or class's own signature names, one level deep (options and
    return types). Following them further pulled in the physics backend's internals through
    `AppConfig`.
  - Left out: raycasting, light aiming, the loop's play state, the `remove*FromMemory` helpers, the
    LS helpers, the physics `*Sync` variants and snapshots, the UI kit past `CMP` and toasts (p617).
- TypeDoc leaves the entries out (`**/index.ts` in `typedocOptions.exclude`, the Hub extract's
  `EXCLUDED_FILE_REGEX`), so the per-module API and the docs ratchet are unchanged until p619.
- `api.json` gains `entries` (entry → names, read with `parseModuleSource`; an `export *` fails
  the run), diffed as added / removed names per entry.
- `moveRules.ts`: keep rules for `src/_engine/index.ts`, `src/_engine/features/`, `src/_engine/ui/`
  and the three toolkit `index.ts` files.
- The bundle and `docs.json` unchanged; `verify:scenes` not run (nothing imports an entry, and the
  bundle is the same).
- Root `CLAUDE.md`'s "No TS path aliases" line rewritten now (it was false); the rest stays in
  Phase 9.

### Phase 4: component types by declaration merging — done

1. `ComponentDataMap` (§4.2); `ECSCoreComponents.ts` loses its app imports.
2. The toolkit effects and `SpinComponent` augment `'aekasha'`; the `as any` reads go.
   `AppECSRegistry.ts` keeps the app's own keys.
3. App code switches to each module's key object; the two debug enumerations use
   `getComponentTypes()`.
4. The Hub regions `ecs-component-types` and `ecs-component-data` change shape: their page is
   updated here (`yarn hub:build`).

**As built:**

- `ECSCoreComponents.ts`: `interface ComponentDataMap extends CoreComponentData {}` (an
  `eslint-disable` for `no-empty-object-type` with its reason), `type ComponentType = keyof
  ComponentDataMap`, `type ComponentData = ComponentDataMap`, and the value `ComponentType` is
  `CoreComponentType` itself. `aekasha` exports the `ComponentDataMap` type; `CoreComponentType`
  stays exported next to the now identical `ComponentType` value (p612 picks one). `tsc` confirmed
  the merge through `'aekasha'` while the toolkit and the app still import the engine by deep path.
- **Not in the plan:** `utils/ECSStressTest.ts` (staying in the engine, `kernel/ecs/debug/`, p602
  D6) read the app's `INSTANCED_STRESS_TEST_DATA` and the toolkit's `HOVER`, and its spheres only
  bobbed because the app registers the toolkit's hover system. It now has two core debug keys,
  `DEBUG_STRESS_TEST_INSTANCE` and `DEBUG_STRESS_TEST_HOVER`, and its own `APP_LOGIC` hover
  system (`ecsStressTestHoverSystem`, the toolkit's motion, registered on the first spawn of either
  mode). The engine can't augment the map itself: a relative path would be the second specifier.
  p608's line sending `ECSStressTest` to the app contradicts `moveRules.ts`; Phase 9 fixes it.
- The toolkit effects and `SpinComponent.ts` augment `'aekasha'` (`SpinComponent.ts` in a new
  region, `spin-component-map`); the `as any` reads, the effects' file-level `no-explicit-any`
  disables and `SunShadowFit`'s import-cycle comment are gone. The wrapper interfaces
  `HoverComponentData`, `FollowComponentData`, `SunShadowFitComponentData` are removed;
  `aekasha/toolkit/ecs` exports the data types (`HoverToolData`, `FollowToolData`,
  `SunShadowFitData`) instead. `AppECSRegistry.ts` keeps only `HEALTH`, with no imports.
- 9 app files use the modules' key objects (deep paths until Phase 7).
- `ECSWorld.getComponentTypes()` (the types with a storage); the entity inspector's tag list and
  the profiler's component counts show values (`CORE_TRANSFORM`). App and toolkit storages are
  created on first use now; none of those types has hooks, so `deleteEntity`'s hook order is the
  same.
- Hub: the walkthrough's §2 is "Adding it to the component map" (`#spin-component-map`), the ECS
  guide's paragraph and link follow, and `hub/CLAUDE.md` drops `AppECSRegistry.ts`'s regions.
  Also updated now, since they'd be false until Phase 9: `readme.md`'s §5 component snippet and
  its tree line, and root `CLAUDE.md`'s "Component types" line.
- The layout report's engine → app is down to `Config.ts`. Baselines: `api.json` as above,
  `bundle.json` +0.2 kB gzip in the `ECSStressTest` chunk (its hover system), the main app group
  −0.1 kB.
- `yarn verify:scenes`: 96 passed against the Phase 1 baselines.

### Phase 5: config flows in, the environment is read at init — done

1. `InitEngine({ config, start })` (the `data` option comes in Phase 6); `Config.ts` loses
   `../../CONFIG`; `loadConfig(appConfig)`.
2. `initEnvironment` (D4); `ECS.ts:47` lazy; the Config stubs in the unit tests drop out (a test
   that needs the debug env calls `initEnvironment`).
3. `utils/PromiseResolver.ts` stops importing `Config.ts` (its debug flag is passed in).
4. Check: importing every engine module in Node (Vitest) reads no `window` at load.

**As built:**

- `InitEngine({ config, start }: InitEngineOptions)` (`start: () => Promise<void>`); `aekasha`
  exports the type, which carries the entry's `@example`. `loadConfig(appConfig = {})` merges it
  as `CONFIG.ts` was merged. `src/index.ts` passes `./CONFIG`; `readme.md`'s example 1 and §6
  follow now (the rest of its update stays in Phase 9). The layout report's "Engine → app" is
  gone (only the generated data is left, Phase 6).
- `initEnvironment({ search?, env? })` (`Config.ts`, with the type `EnvironmentInput`; in no
  entry, p510 decides how a headless runner reaches it). `env` is copied, so `loadConfig`'s
  write-backs no longer touch `import.meta.env`. `IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`,
  `IS_PROD_TEST_ENV`, `IS_PROD_ENV` and `CUR_ENV` are `export let`; before init they read as
  production (`IS_PROD_ENV` is `true`, D4's "all false" meant the debug flags). `InitEngine`
  runs `initEnvironment()`, `loadConfig(config)`, `addWindowListeners()` first.
- **Not in §2:** `MainLoop.ts` added its `beforeunload` / `blur` listeners at load. They're in
  `addWindowListeners()` (idempotent), not `initMainLoop`, which runs only when the root scene
  has children.
- Every call made at module load in `src/` was listed (TS AST) and the non-debug callees
  checked: none reads a flag, `getConfig` or `window`. The load-time readers left are `_dbg__`
  modules, which load after `InitEngine`.
- `ECS.ts`: `STORE_DEBUG_DATA` is gone; `addComponent` reads the flags only for `DEBUG_DATA`.
- `PromiseResolver.ts` imports nothing: `resolveRequest(requestId, value)` (`rejectRequest`'s
  order) returns whether the request was pending, and `PhysicsAPI`'s `onWorkerMessage` logs a
  missing one under `IS_DEBUG_ENV`. `AssetsAPI` checks `isRequestPending` first, so its log
  could never fire. The layout report's "utils → kernel" is gone.
- Tests: `ECS.test.ts` lost its `window` stub; `Config.test.ts` (the flags before and after
  `initEnvironment`, `loadConfig`'s merge and env parsing), `PromiseResolver.test.ts`, and
  `src/_engine/moduleLoad.test.ts`: every engine module (313, `_dbg__` included; the two worker
  entries left out) imported in Node without a DOM, each failure naming the first `src/` stack
  frame, and the flags still production after. Checked with a mutation (a `window` read at the
  end of `LodSystem.ts`). `yarn test` goes from ~0.7 s to ~1.9 s, mostly three's `webgpu`.
- **Found by the check:** `Texture.ts`, `ECSCoreComponents.ts` and `MeshColliderGeometry.ts`
  imported three's `Addons.js` barrel, which re-exports `TTFLoader` and its `https://` import of
  opentype (Node can't load it; the build drops it). They import the modules directly now.
- **For Phase 8:** `import/no-mutable-exports` needs an exception for `Config.ts`'s flags.
- `entryExports.json` also catches up with Phase 4 (the removed `*ComponentData` wrappers,
  `ComponentDataMap`).
- Baselines: `api.json` gains `initEnvironment`, `EnvironmentInput`, `addWindowListeners`,
  `InitEngineOptions` and `aekasha`'s `InitEngineOptions`; `bundle.json` unchanged.
- `yarn verify:scenes`: 96 passed against the Phase 1 baselines (the debug and prodTest
  configurations set their flags in `InitEngine` in time).

### Phase 6: the generated code moves out — done

1. `gatherAppData` writes `src/generated/` (§4.3) and every path in §2's list follows.
2. `InitEngine({ data })`; `core/AppData.ts`; the five readers use `getAppData()`.
3. The two `p606` rules leave `moveRules.ts` once the files have moved, and the regenerated map has
   no `p606` entries.

**As built:**

- `gatherAppData.ts`: `OUTPUT_DIR` (`src/generated/`) with `OUTPUT_FILE_DATA`, `OUTPUT_FILE_FN`
  and `OUTPUT_FILE_INDEX`. The two files were `git mv`'d; regenerated, the JSON is byte-identical
  and `generatedAppFns.ts` differs only in its `import type` lines (`../_engine/core/…`). The
  `'../${basePath}/…'` imports don't change: `..` is `src/` from both folders. `index.ts` is the
  same on every gather (a constant in the gatherer).
- **Names changed from §4.3** (confirmed): `AppData` is `{ json, sceneFiles, tslMaterialFiles,
  postFxFiles }`, since `data.scenes` would sit next to `data.json.scenes` and `data.postFx` (the
  pass files) next to `data.json.postFx` (the pass assets). `data` is required: a missing one fails
  `tsc`, not `loadScene`.
- `core/AppData.ts`: `AppData` and `GeneratedAppJson` (`{ scenes: Record<string, unknown>;
  [section: string]: unknown }`: a production gather writes only `scenes`, and every reader
  outside `Scene.ts` casts), both exported by `aekasha`; `setAppData` / `getAppData`, `@internal`
  and in no entry. `sceneFiles` reuses `LoadSceneProps['nextSceneFn']`'s type. Empty until
  `InitEngine` runs `setAppData(data)`, right after `loadConfig`. The JSON's inferred type assigns
  to `GeneratedAppJson` without a cast.
- **Not in §2:** `getGeneratedAppData` / `getGeneratedSceneData` (`Scene.ts`, in `aekasha`) have
  8 more readers (debug modules, `TextureArray.ts`, the app's `textureArrays.ts`). They stay, as
  wrappers over `getAppData().json`, now with JSDoc. Three readers lost their `as Record<…>` casts.
- `sceneGathererPlugin.ts` skips `OUTPUT_FILE_INDEX` as its own output; `devFiles/selfCheck.ts`
  restores `index.ts` too. `checkVersions.ts` drops the two excludes: `src/generated/` is in no
  part. The `generatedApp*` excludes of TypeDoc and the Hub extract are gone (the folder is outside
  their scope; the API hash is unchanged); ESLint's JSDoc block ignores `src/generated/**`.
- `src/generated/index.ts` and `generatedAppFns.ts` import the engine by relative path; Phase 7's
  gatherer change makes them `aekasha` imports (`AppData`, `SceneData`, `ScenePrimitiveAssets` are
  all in the entry).
- `moveRules.ts`: the two `p606` rules gone; new rules for `core/AppData.ts`
  (`kernel/scene/AppData.ts`) and, missing since Phase 5 (`moveMap.ts --check` failed on a clean
  `HEAD`), `core/Config.test.ts` (`kernel/config/`) and `moduleLoad.test.ts` (the engine root,
  `ModuleLoad.test.ts` per D7). The layout report's "Engine → generated data" row is gone and the
  map has no `p606` entries.
- Docs now, since they'd be false until Phase 9: root `CLAUDE.md`'s data pipeline step 3 and
  `yarn docs` line, `devFiles/CLAUDE.md`, `devTools/hub/CLAUDE.md`, `hub/CLAUDE.md`,
  `hub-authoring.md`; `readme.md`'s example 1 (`data: appData`) and its tree (`generated/`).
- Baselines: `api.json` gains `AppData`, `GeneratedAppJson`, `getAppData`, `setAppData` and
  `aekasha`'s two types; `docs.json` engine/core 373 / 523 → 379 / 527 documented; `bundle.json`
  moves the JSON from the main chunk's `_engine` group to `app` (−9.8 / +10.0 kB gzip), and the
  shared texture atlas / impostor bake chunk is named `ImpostorBake.js` instead of
  `TextureAtlas.js` (same 3968 bytes: Rollup names it after one of its modules).
- `yarn verify:scenes`: 96 passed against the Phase 1 baselines.

### Phase 7: the app, the toolkit and the docs' code use the entries — done

1. `devTools/refactor/migrateToEntries.ts`: rewrites deep engine and toolkit imports in the given
   folders to entry imports (each name to its entry, grouped, `import type` kept), from the entries'
   export lists. Fails on a name no entry exports (a gap in Phase 3's lists).
2. Run on `src/app/`, `src/*.ts`, `src/toolkit/` and `src/generated/` (the gatherer emits entry
   imports); the toolkit's internal imports between categories go through entries too.
3. First (found in Phase 3): the engine files whose target is outside the engine move there, ahead
   of p608 (their `moveRules.ts` rules get `plan: 'p606'`). `utils/cameras/followObjectCameraRig.ts`
   (with `utils/commontTypes.ts` merged in) and `utils/world/movingPlatform.ts` go to
   `src/toolkit/ecs/`, so `aekasha/toolkit/ecs` stops re-exporting from `../../_engine/`; the gym's
   `utils/PhysicsStressTest.ts`, `utils/world/characterTestObjects.ts` and
   `characterTestObstacles.ts` (and `3dModels/characterObstacles.blend`) go to the app, since no
   entry can export them.
4. `refactor/importGraph.ts` resolves the aliases (`ENTRY_FILES`), or `moveMap.ts` loses every
   consumer that imports an entry.
5. `package.json` has no `sideEffects`: check the bundle baseline for modules a barrel import
   pulls in (and the system order, risk 1).
6. `readme.md`'s examples and the Hub's code blocks use `aekasha` imports.

**As built** (in the order A: step 4, B: step 3, C: step 1, D: steps 2 and 5, E: step 6):

- `importGraph.ts`: `resolveSpecifier` / `buildImportGraph` take `{ exists, aliases? }`; an exact
  alias resolves to its entry file (`moveMap.ts` passes `ENTRY_FILES`), any other bare specifier is
  still a package. With the app on entries, `entryExports.json` came out unchanged. Phase 6 had left
  `layoutReport.md` and `entryExports.json` stale (`core/AppData.ts`); regenerated then.
- The moves: `utils/cameras/followObjectCameraRig.ts` → `toolkit/ecs/FollowObjectCameraRig.ts`
  (`commontTypes.ts`'s `XYZObject` inlined into its one use, the `offset` option),
  `utils/world/movingPlatform.ts` → `toolkit/ecs/MovingPlatform.ts`; `PhysicsStressTest.ts`,
  `characterTestObjects.ts`, `characterTestObstacles.ts` and `characterObstacles.blend` →
  `src/app/scenes/thirdPersonGymScene/` (the gym's scene file stays in `src/app/` until p609).
  `eslint.config.js`'s `SIMULATION_FILES` follows. Their rules left `moveRules.ts` once applied (as in
  Phase 6), not `plan: 'p606'`; the two toolkit files have keep rules (`plan: 'p609'`, which picks
  their folder). The six exports the docs ratchet flagged in `toolkit/ecs` got JSDoc instead of a
  docs drop. `createMovingPlatform`'s `opts.deleteMeshOptions` is never read (`controls.delete()`
  deletes the entity only); its type says so, behaviour unchanged.
- **Not in the plan:** the toolkit's deprecated re-exports `ecs/InstancedMeshPool.ts` and
  `InstancedMeshPoolTypes.ts` (`export *` of the engine, "until the toolkit's next major", no
  importers) are deleted: the toolkit major is `stage-b`'s (D5). For Phase 10's changelog.
- The codemod is two files, as `importGraph.ts` / `moveMap.ts`: `refactor/entryImports.ts` (the
  rules, no file system, `entryImports.test.ts`) and `refactor/migrateToEntries.ts` (the CLI:
  `[--check] <folder | file>...`, walks `src/`, Prettier, writes nothing on an error). One value
  import and one `import type` per entry at the first import's place (`separate-type-imports`; an
  inline `type` stays inline, a value import left with inline types only becomes `import type`),
  an entry import already there merged in. Left alone: engine modules, imports within a toolkit
  category, `.tsl.ts` imports. Errors: a name in no entry or in two, a namespace / default /
  side-effect / dynamic import, `export *`, an alias without its file.
- Run on `src/app`, `src/toolkit`, `src/generated` and the root `.ts` files: 57 of 70 modules
  rewritten, no name missing from an entry (Phase 3's lists covered them all). `gatherAppData.ts`
  emits `import type { SceneData, ScenePrimitiveAssets } from 'aekasha'` and `index.ts`'s
  `import type { AppData } from 'aekasha'`; a gather is byte-identical to the codemod's output.
- **Step 5, the bundle:** without a change, the main chunk grew 5.1 kB gzip and lost the lazy
  `ECSStressTest` and `PhysicsTierPolicy` chunks: an entry file counted as having side effects, so
  `src/index.ts`'s `aekasha` import made the main chunk run every module the entry re-exports.
  `getEntryModuleSideEffects` (`devTools/aliases.ts`) in `vite.config.ts`'s
  `build.rollupOptions.treeshake.moduleSideEffects` marks the 16 entry files only as side-effect
  free; the bundle baseline is then unchanged (the module order inside the main chunk isn't).
  An entry file must stay re-exports only (Phase 8).
- **Step 5, the system order** (every stage's `getSystemOrder`, Phase 2's five runs, before and
  after, on the dev server and on `VITE_APP_ENV=test` builds): the builds are identical (bar Phase 2's
  `cameraHelperSyncSystem` / `lightHelperSyncSystem` race). On the dev server one tie moved:
  `physicsTierPolicyFrameSystem` (`APP_LOGIC`, order 0) now registers before the toolkit's and the
  app's order-0 systems. The dev server doesn't tree-shake, so `MovingPlatform`'s `aekasha/physics`
  import runs `PhysicsTierPolicy`'s `registerPlugin` while `AppECSPlugins`' imports load (before,
  a debug module or the physics tiers scene loaded it later). Accepted (confirmed): the system
  returns at once unless a policy has `cadence: 'FRAMES'`, which no scene sets; p607 removes
  registration at module load.
- `readme.md`'s examples 1, 4, 5 and `hub/pages/documentation/code-blocks/intro.md` import from
  `aekasha` / `aekasha/physics` (the page's line highlights follow). `yarn hub:build` passes; its
  four `{@link InitEngine}` warnings (`AppData.ts`, `Scene.ts`, from Phase 6) are Phase 9's.
- `yarn verify:scenes`: 96 passed against the Phase 1 baselines; `verify:baselines` unchanged
  after B's update (`api.json`: the moved and removed exports; `bundle.json`: 3.9 kB gzip from the
  main chunk's `_engine/utils` group to `toolkit`; `docs.json`: `toolkit/ecs` 10 / 10).

### Phase 8: the boundary lint and the `@example` check — done

1. `eslint-plugin-import` loaded; the rules in §4.5, errors everywhere (D1).
2. The `@example` check (§4.6); `createLines`' example fixed so it parses.
3. The generated code's imports of the TSL material files (`*.tsl.ts`, toolkit and app) are asset
   imports by path: an exception to the "only `aekasha*`" rule.
4. The done check: `grep` finds no engine import of the app, the toolkit, `src/*.ts` or
   `src/generated/`.
5. An entry file holds only `export … from` (found in Phase 7: `getEntryModuleSideEffects` declares
   them side-effect free, so the build would drop anything else they run). A check next to
   `baselines.ts`' `export *` failure, or in `aliases.test.ts`.

**As built** (A: steps 1, 3, 4; B: step 2; C: step 5):

- **The tree already followed every rule:** a trial config flagged nothing, so the lint is a config
  change only (`eslint.config.js`, +89 lines). Each rule was checked with a mutation file per zone.
  `yarn lint` on `src/` takes 9.3 s instead of 8.6 s.
- **Changed from §4.5:** every path rule is one `import/no-restricted-paths` with zones
  (`LAYER_ZONES`), the "consumers → `_engine/`" row included (§4.5 had `no-restricted-imports`):
  it resolves the path, so the depth of the `../` doesn't matter, and it checks `import type` and
  `import()` too (risk 3's second specifier is a type import). The zones: the engine imports no
  toolkit, app, `src/generated/` or `src/*.ts`; the toolkit no app, `src/generated/` or `src/*.ts`;
  nothing outside the engine an `_engine/` path; a toolkit category no other category's files
  (`TOOLKIT_CATEGORIES`, the `aekasha/toolkit/*` entries' folders, listed by hand); the app and
  `src/*.ts` no toolkit file. The node resolver with `.ts` resolves them, and leaves the `aekasha*`
  aliases unresolved (so unchecked).
- **Trap:** in a zone whose `from` is a glob, `except` isn't resolved against `basePath`: the
  exceptions are absolute (`import.meta.dirname`). And one zone's `from` must be all globs or none.
- The `_dbg__` rule and "no `aekasha*` in the engine" are `@typescript-eslint/no-restricted-imports`
  (regex patterns), for `allowTypeImports` on the first: an `import type` of a `_dbg__` module is
  erased. Exempt from the `_dbg__` rule: `_dbg__*` files anywhere (the app has 5) and
  `core/Debug/**`; `src/_engine/debug/*.ts` (the thin public entries) isn't exempt, and uses only
  `import()`. The engine's debug files keep the `aekasha*` rule.
- **Step 3 is narrower than written:** only the generated code's 3 toolkit `*.tsl.ts` imports need
  the exception (a glob `except` on the generated → toolkit zone); no rule restricts generated →
  app, so its app `.tsl.ts` imports and dynamic scene imports need none.
- Phase 5's `import/no-mutable-exports` note doesn't apply: §4.5 doesn't turn the rule on, and the
  plugin's `recommended` set isn't loaded.
- Step 4: all 2,082 relative specifiers in the 342 engine files resolved; none leaves
  `src/_engine/`.
- **The `@example` check** (`devTools/verify/examples.ts`, `examples.test.ts`). There were 4
  examples, not 2: Phases 4 and 5 added `InitEngine`'s (fenced, importing `./CONFIG` and
  `./generated`) and `ComponentDataMap`'s (a `declare module 'aekasha'`).
  - Extraction: the TS AST finds each tag, and the code comes from the raw comment, so each block
    knows its source line. Each fenced block is one example (other languages than ts / js are
    skipped); an unfenced tag is all code, as TypeDoc reads it. Scope: TypeDoc's (`src/_engine`,
    `src/toolkit`, minus `_dbg__*`, tests, `index.ts`).
  - Each example is a virtual module in `src/__examples__/` (a folder that doesn't exist), with
    one header line importing the entry names it uses but doesn't import or declare (from any
    entry, values and `import type` apart for `verbatimModuleSyntax`) and `export {}` (examples
    don't share a scope). One program: the real `tsconfig.json` with its `.d.ts` roots, minus
    `noUnusedLocals` / `noUnusedParameters`; only the examples' diagnostics count.
  - Free, beyond §4.6's "Cannot find name": 2304, 2552 (its "Did you mean" form), 18004 (a
    shorthand property of one), and 2307 for a relative specifier (the reader's own module). A
    misspelled entry fails.
  - `createLines`' loop is `for (const [a, b] of pairs) w.vec(a, b);`. Before the fix the check
    reported it at `LineManager.ts:69` (TS1109); a mutation of `InitEngine`'s example
    (`sceneId: 42`) failed at `InitApp.ts:94` (TS2322).
  - The test checks the repo's examples and four fixtures in one program (about 1.3 s); `yarn
    test` takes 2.3 s.
  - Limits: an example's `'aekasha'` augmentation merges into the shared program (two
    conflicting ones would clash; there's one); an internal name no entry exports passes as a free
    name.
- Step 5 is in `aliases.test.ts`: every statement of an entry file is a named `export … from`
  (checked with a mutation: `export *`, a side-effect import, a local export, a call, a
  declaration, a local `export { y }`, each reported with its line). `baselines.ts`' own
  `export *` failure stays.
- Baselines: `bundle.json`, `api.json` and `docs.json` unchanged. `verify:scenes` not run: no
  runtime code changed (one JSDoc comment).

### Phase 9: Hub, CLAUDE.md and the migration guide — done

1. Hub: the ECS pages (stages, component types by augmentation), the `InitEngine` and getting
   started pages, the code-blocks page, and **the migration guide's first section** (a new
   `documentation/migration/` page: `InitEngine`'s options, the stages' new home, component keys by
   module, deep imports → entries with `migrateToEntries.ts`). `yarn hub:build`.
2. Root `CLAUDE.md`: ECS core (stages, component types), the data pipeline's paths, Bootstrap flow,
   "Three-folder split" (now a lint rule), "No TS path aliases" (now there are), the commands
   (`migrateToEntries.ts`). `devFiles/CLAUDE.md` and `hub/CLAUDE.md` paths. `readme.md`: the
   examples' imports and `InitEngine`'s signature.
3. p602's `moveRules.ts` notes and p607 / p608 / p510's stubs updated for D2 and what this plan
   did (p510 still cites the `LoopState` imports as open). p607's stub gets the feature-schema seam
   (D3, changed in Phase 3). p608's §"The moves" keeps `ECSStressTest` in the kernel
   (`moveRules.ts`, p602 D6), not the app (found in Phase 4), and its gameplay and test moves are
   done (Phase 7).
4. Found in Phase 7: root `CLAUDE.md`'s Build config notes (the entries' `moduleSideEffects`, and
   "Nothing imports them yet" is false now) and the commands (`migrateToEntries.ts`); the four
   `{@link InitEngine}` in `AppData.ts` / `Scene.ts` that TypeDoc can't resolve (no import in
   scope: `{@link InitApp!InitEngine}`). `readme.md`'s examples' imports and the code-blocks page
   are done (Phase 7).
5. Found in Phase 8: root `CLAUDE.md`'s "Three-folder split" says nothing in `eslint.config.js`
   enforces the boundary (it does now: `LAYER_ZONES`, the `_dbg__` and `aekasha*` rules), and its
   `yarn test` line gets the `@example` and entry-file checks; `devTools/verify/CLAUDE.md` gets the
   `@example` check (`examples.ts`). The Hub's coding standards: `intro.md`'s layering rules name
   the lint; `jsdoc.md`'s "Examples compile" says how it's checked (`yarn test`, free names and
   the reader's relative imports allowed) and its tag table's "imports are left out" allows an
   example's own imports (`InitEngine`'s has them).

**As built** (A: the Hub pages; B: the migration guide; C: CLAUDE.md files, `readme.md`, the
links; D: the plans and `moveRules.ts`):

- **Already done by earlier phases:** the ECS pages' augmentation (Phase 4), the code-blocks page
  and `readme.md`'s examples (Phase 7), the paths in `devFiles/CLAUDE.md`, `hub/CLAUDE.md`, the
  data pipeline and `yarn docs` lines (Phase 6).
- **There was no `InitEngine` page** in the Hub (step 1 names one). The Quick start's `setup.md` has
  "How the app starts" instead: `<<< src/index.ts collapse` (a whole-file include, so no region
  can drift) and `config`, `data`, `start`, the `./AppECSPlugins` import, entry-only imports and the
  flags reading as production until `InitEngine`.
- Hub, the rest of A: the ECS guide (`ComponentType` from `aekasha` holds the engine's keys, the
  module key objects, `ECSSystemStage` and `APP_RENDER_SYNC_ORDER` as `api:` links, where
  `AppECSPlugins.ts` is imported) and walkthrough (the stages come from `aekasha`);
  scenes-and-assets (`src/generated/`, `data`); the Documentation intro's "Importing the engine"
  (the 16 entries, what each holds, the lint; the API pages are still per module until p619); the
  coding standards (step 5) and `jsdoc.md`'s `{@link}` row (below).
- **The migration guide** is `hub/pages/documentation/migration/` (`intro.md`, `engine-5.md`):
  "Engine 4 → 5" with a "not released yet" note and no codenames (D5 picks them at `stage-b`'s
  merge). Before you start (the template's engine, toolkit, `devTools/` and configs first),
  `InitEngine`'s options as a diff, the stages, component types (an old → new table, the real
  `src/AppECSRegistry.ts` included), `migrateToEntries.ts` and its errors, the moved and removed
  modules (Phase 7's, `commontTypes.ts`, the toolkit's `InstancedMeshPool` re-exports), the lint.
  p607 adds `features` to the same section.
- **The links:** `{@link InitApp!InitEngine}` (step 4) doesn't resolve: TypeDoc names a module by
  its path from `src/`, so it's `{@link _engine/InitApp!InitEngine}` (3 in `AppData.ts`, 1 in
  `Scene.ts`). p608's stub says its codemod rewrites such links.
- **Root `CLAUDE.md`, not in step 2's list:** the `yarn test` line said `Config.ts` reads `window` at
  load and is stubbed (false since Phase 5; no test stubs a global now); it names
  `moduleLoad.test.ts`, how a test turns the debug env on (`VITE_APP_ENV: 'development'`: without
  it a production build ignores the URL) and the three structural tests. The Coding standards'
  Layering and Public API lines name the lint and the entry-file rule. Bootstrap flow is checked
  against `InitApp.ts` step by step. The Three-folder split lists the zones and the config's two
  traps.
- `readme.md`: the tree (`index.ts`, `features/`, `utils/` and `toolkit/` lines), the
  "convention" sentence, a "Public entries" highlight, the migration guide under Documentation.
- `moveRules.ts`: `WRAPPER_NOTE` and `MeshColliderGeometry`'s note name p608 / p618 and p607 (D2);
  `MovePlan` loses `'p606'` (no rule uses it since Phases 6-7). The regenerated `entryExports.json`
  and `layoutReport.md` also pick up the Hub's new `api:` links and two modules from Phase 8 (the
  reports were stale; `--check` passes now).
- Plans: p607 gets "From p606" (the seams, the feature-schema seam, `features` in `InitEngine`, the
  dev server's module-level registrations, the entries' side effects, the `?worker` and SCSS
  imports, the lazy data maps' new home, the branch and the migration guide); its "Loaders and
  barrels" item lost the `Addons.js` half (Phase 5). p608: its codemod rewrites the entries'
  re-export paths, `eslint.config.js` and the module-qualified links; the gameplay and test moves
  are done and `ECSStressTest` stays in the kernel; `api.json` changes by path only, its `entries`
  not at all; no path list in the migration guide. p510: the `LoopState` trap and the load-time
  reads are fixed (Phases 1, 5), the `?worker` / SCSS imports are p607's, so it's blocked by p607
  too (and p607 blocks it).
- **The Hub's search index is over its budget:** 1.01 MB against `devTools/hub/build.ts`'s 1 MiB
  warning (it was 1008 kB before this phase; A and B's pages tipped it). A warning, left for p619
  (the Hub tooling's review), as decided.
- Checks: `yarn test` (218), `yarn verify:baselines --docs` unchanged, `yarn hub:build` with 17
  warnings (TypeDoc's 16 `notExported` and the search index; the four `{@link InitEngine}` gone),
  `moveMap.ts --check`. No runtime code changed (JSDoc only), so no `verify:scenes`.

### Phase 10: versioning and mark done — done

Per D5: bump the engine and toolkit majors (new codenames) and the app minor, the `CHANGELOG.md`
entry (Engine, Toolkit, App, Project), `yarn checkVersions --against main`, mark the plan done
(`docs/plans/CLAUDE.md`).

**As built** (A: the versions; B: the changelog; C: marking the plan done):

- **The codenames are chosen here, not at `stage-b`'s merge** (D5's note, confirmed):
  `checkVersions` fails a major bump that keeps its codename. Engine 5.0.0 Golden Hour (the sun's
  path after Afternoon; root `CLAUDE.md`'s sequence names both now), toolkit 2.0.0 Half Moon, app
  1.10.0 Preschooler, project 5.0.0. p600 §11 and its branch table, and p607's "Branch and
  versions", say so, and that p607 checks `--against main` (against `stage-b`, the engine would
  need another bump).
- `CHANGELOG.md`'s entry is `## 2026-10-11 — stage-b`: the branch that merges to `main`, which
  p607 adds to; the date becomes the merge's (p600's table). `src/index.ts` is listed under App,
  though `checkVersions` counts it in no part.
- Marked done: the references in p600, p601, p602 and p604 renamed; the `Blocked by` on p510, p607
  and p608 dropped, with a `Related` line each instead. No `CLAUDE.md` or Hub page names the file.
- `yarn checkVersions --against main` passes.

## 6. Done when

- `grep` finds no engine import of `src/app`, `src/toolkit`, `src/*.ts` or `src/generated/`, and
  the lint enforces it as an error.
- The app and the toolkit import the engine only through `aekasha` entries, with no lint warning.
- `yarn test` (with the headless and `@example` checks), `yarn verify:scenes` and
  `yarn verify:baselines` pass; `api.json`'s diff is the intended public surface.
- The engine major started (`CHANGELOG.md`), and the migration guide's first section is written.

## 7. Risks

1. **Module evaluation order.** Moving the app plugins' import and importing through barrels can
   change when a module's top-level registration runs, and with it the order of systems that tie
   (same stage and order). The scene runner's hashes and snapshots catch it; the fix is the import
   order, until p607 removes module-level registrations.
2. **Live-binding flags before `InitEngine`.** Code that reads a flag at load sees production. The
   grep in §2 found one engine case; a missed one shows up as debug data or tooling missing in the
   debug env, which the runner's debug configuration exercises.
3. **Declaration merging through a second specifier** breaks the merge silently on some keys (§2).
   The lint's "only `aekasha*`" rule makes the second specifier impossible outside the engine.
4. **The entries' lists are API decisions** made before Stage C's reviews; an export left out shows
   up as a migration failure in Phase 7, one added by mistake is removed in Stage C (a breaking
   change after the major). Phase 3's review leans towards leaving out.
