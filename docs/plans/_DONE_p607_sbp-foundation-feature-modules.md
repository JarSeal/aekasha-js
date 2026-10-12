Status: implemented (Phases 1-11)
Category: Build, Performance, Architecture
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B, engine major)
Blocks: p608_engine-folder-restructure.md, p611_sbp-tooling-profiles-and-marketing.md, p510_headless-simulation-runtime.md
Related: \_DONE_p606_layering-inversion-and-public-entry.md (the entries, `InitEngine`'s options, the branch), \_DONE_p602_architecture-and-target-structure.md (D2, D5, D8), p612_review-ecs-loop-config-init.md (the type-only seams, D6), p240_client-device-capability-sniffer.md

# SBP Foundation: Feature Modules

The engine becomes tree-shakeable by construction (p600 §4.1) and its features are installed
explicitly (p602 D8): `InitEngine({ config, data, features, start })`. After this plan, an app's
bundle holds what it lists and uses: Rapier leaves the main chunk, the debug wrappers fold out of
production builds, and nothing registers itself at module load.

**Branch:** `sbp-foundation-feature-modules`, cut from `stage-b` at `996d9b4` (p606 merged), merged
back into `stage-b` (p600's "Branches and PRs").

---

## 1. Goal

- **Rapier out of the main chunk:** loaded only by `import()`; not loaded at all without physics.
- **The install contract:** `features: [physics(), skyBox(), …]`, each `{ id, install(ctx) }`, and
  the kernel → feature seams it fills (p606 D2): scene hooks, a fixed-step driver, the render
  pipeline, import extensions, the assets worker's job modules.
- **No module-level side effects** outside entries and the debug loader's modules, checked by a
  test.
- **`__AEK_DEBUG__`:** debug code folds out of `VITE_APP_ENV=production` builds.
- **The SBP leftovers:** `sideEffects`, the icon registry, lazy TSL material / PostFX maps, loaders
  imported where used.
- **The feature manifest:** the gathered data says which features each scene needs, and the
  feature schemas move into their features (p606 D3's seam).
- **No behaviour change:** every scene's snapshot and determinism hash in all three physics
  targets, the system order, the LS keys, `__saveData` and the URL flags stay (p600 §3.7).

## 2. Grounding (checked against the code, 2026-10-11)

### 2.1 Bundle (`devTools/verify/baselines/bundle.json`, the production build)

The main chunk `assets/index.js`: 222 modules, **6.75 MB rendered, 1.78 MB gzip**. By group (gzip):
`@dimforge/rapier3d-compat` 829 kB, `three` 690 kB, `_engine/core` 74 kB, `core/UI` 30 kB,
`core/SkyBox` 29 kB, `core/Physics` 20 kB, `app` 14 kB, `toolkit` 13 kB, `utils` 12 kB,
`core/Import` 12 kB, `core/Spatial` 10 kB, `core/Lines` 9 kB, `core/Lod` 8 kB, `debug` 7.7 kB,
`core/ECS` 7 kB, `core/Input` 6 kB. `physicsWorker.js` is 848 kB gzip (its own Rapier copy),
`assetsWorker.js` 108 kB.

### 2.2 Rapier

- `Physics/ENGINES.ts:3` imports `./EngineRapier` as a namespace (`engineAPI: RapierAPI`), and
  `EngineRapier.ts:1` imports Rapier as a value. The `import()` at `ENGINES.ts:23` is cancelled.
- The only readers are `Physics/PhysicsUtils.ts`' `initPhysicsEngine` (returns `engineAPI`; called
  by `PhysicsAPI.ts:300` in `MAIN_THREAD` mode and by the worker at `physicsWorker.ts:440`) and
  `_dbg__About.ts` (names and package only). `PhysicsAPITypes.ts` imports `ENGINES` as a type. No
  other value import of Rapier in `src/`. The fix is local: `ENGINES` holds a loader, and
  `initPhysicsEngine` awaits it.

### 2.3 Module-level side effects

A TS AST scan of every top-level expression statement outside `_dbg__` files and `core/Debug/`
finds **47 in 22 files**, not the stub's 11:

- `ECSWorld.registerPlugin` / `registerCorePlugin` / `registerComponentHooks`: `ECSCoreSystems.ts`
  (5), `ObjectFrustumCullingSystem.ts` (2), `LightObjectCullingSystem.ts` (2), `MeshManager.ts`,
  `GroupManager.ts`, `Raycast.ts`, `Character.ts` (2), `SkyBox/SkyBox.ts`, `Lod/LodSystem.ts` (6),
  `Spatial/SpatialIndexSystem.ts` (3), `Instancing/InstancedMeshPool.ts` (2),
  `PhysicsTiers.ts` (2), `PhysicsTierPolicy.ts`, `src/AppECSPlugins.ts`. **Not in the stub:**
  `InstancedMeshPool`, `PhysicsTiers`, `PhysicsTierPolicy`.
- Other registrations: `ECSWorld.registerTransformResetListener` (`PhysicsManager.ts:724`),
  `registerSpatialRadiusProvider` (`SpatialIndexSystem.ts` 3, `InstancedMeshPool.ts:35`),
  `registerLodTarget` (`InstancedMeshPool.ts:173`), `onGeometryDeleted` (`ImpostorRegistry.ts:53`,
  `LodChains.ts:352`, both lazy chunks), `registerOnAllSceneExits` and `onECSWorldRegistryChange`
  (`PhysicsTierPolicy.ts:647`, `:656`).
- Legitimate: the two worker entries (`self.onmessage`, `postMessage`) and `src/index.ts`
  (`InitEngine`). The app: `examples/exampleHud.ts:10` (`registerOnAllSceneExits`) and
  `scene01.ts:244` (`createKeyBinding`, in a lazy scene module).
- The `_dbg__` modules register at load too (36 statements); they're reached only through the
  debug loader's `import()`, so their load is their install and they cost a production build
  nothing.
- `ECSWorld` keeps plugins in registration order (`corePlugins`, then `plugins`), and the order
  breaks ties within a stage and order: install order must reproduce today's import order.

### 2.4 Kernel → feature (`devTools/refactor/layoutReport.md`)

29 runtime, 18 type-only and 3 dynamic imports in 19 files. The runtime ones, by seam:

- **`InitApp.ts`:** every feature's boot and debug registration (physics init and world, the
  physics manager and determinism probe, the line manager, the sky box / LOD / spatial / character
  / raycast / PostFX debug GUIs, `initPostFX`, the PostFX profiler, light culling by import).
- **Scene load (`SceneLoader.ts:540-668`):** in order, `holdPhysicsStepping`,
  `deleteAllCharacters`, `deleteAllPhysicsEntities`, (kernel: groups), `disposeNonPersistentLines`,
  (kernel: loopers), `clearSkyBox`, (kernel: windows, exit hooks, ray helpers, worlds,
  `clearNonPersistent`), `releaseSceneSpatialDomains` / `registerSceneSpatialDomains`,
  (`createCameras`), `resetPhysicsWorld`, (assets, scene code, `setCurrentScene`),
  `activateSceneDefaultSkyBox`, (object3Ds, enter hooks), `resetRayCastStats` /
  `resetPhysicsRayStats`, `settlePendingPhysicsEntities`, `releasePhysicsStepping` (and again in
  `.finally`).
- **Scene data (`Scene.ts`):** `registerSkyBox` per scene sky box at registration (`:769`),
  `clearSkyBox` / `getSceneSkyBoxTextureIds` / `getActiveSkyBoxTexture` on scene delete (`:252`);
  `Assets/SceneAssetRelease.ts:12` keeps the active sky box texture.
- **The loop (`MainLoop.ts`):** `latchPhysicsSnapshot`, `stepPhysics` (with held-key polling and
  `flushPhysicsEvents` per sub-step), `getPhysicsState`; `getActivePostFxPipeline` and
  `renderViewports` in `renderScene`. `Snapshot.ts:31` reads `getActivePostFxPipeline`.
- **Import:** `SpawnImported.ts` (a lazy chunk) → `createPhysicsEntity` and
  `MeshColliderGeometry`; `ImportRegistry.ts` → `LodChainGLTF` (`readGLTFLodChains`,
  `deserializeLodChain`), `LodChainRequests`, and `LodChains` by `import()`.
- **Assets worker:** `assetsSwitchGLTF.ts` → `LodChainGLTF`, `assetsSwitchSimplify.ts` →
  `LodSimplify` (inside the worker bundle).
- **Feature → feature:** character → physics (3 runtime), instancing → lod (`registerLodTarget`)
  and spatial (`registerSpatialRadiusProvider`), lod → spatial (`getConservativeGeometryRadius`).
- **Type-only (18):** component data and config types in `ECSCoreComponents.ts`, `ECS.ts`,
  `Config.ts`, the import and assets types. No bundle effect (D6).

### 2.5 Debug gating

- `IS_DEBUG_ENV` and its siblings are `export let` set by `initEnvironment` (`Config.ts:581`); 128
  reads outside debug code, 28 modules `import()` a `_dbg__` module through `loadDebugModule*`
  (`utils/helpers.ts:489`, `:511`). Everything the stub names is already behind a flag:
  `load3DSymbols` returns unless `IS_DEBUG_ENV` (and is the only reason `GLTFLoader` is in main
  besides `Import/GLTFSource.ts`), the Toaster is created in `InitApp.ts`' debug block,
  `registerDefaultDebugKeyBindings` runs there.
- **Spike (2026-10-11, the repo's Rollup):** a `let` flag whose only reassignment sits after
  `if (!__AEK_DEBUG__) return;` is folded to its initial value with the define `false`: the
  `if (IS_DEBUG_ENV)` branch, the wrapper module it was the only user of, and the `_dbg__` chunk
  its `import()` named all disappeared; with `true` everything stayed. So the define reaches every
  read without touching the call sites.
- `devTools/verify/baselines.ts` measures the production build, so the fold shows in
  `bundle.json`.

### 2.6 The SBP leftovers

- **Icons:** `core/UI/icons/SvgIcon.ts` has 49 `?raw` imports (10.5 kB gzip together). Outside
  debug code only `InitApp.ts` (the debug toaster's 4), `DraggableWindow.ts` (`config.icon`),
  `DropDown.ts`, `DefaultDebugKeyBindings.ts` and `ViewManager.ts` (`'runtime'`, a type) use them.
  `SvgIconKey` is a public type (`DraggableWindow`, `ViewDef`, `DebuggerGUI`).
- **Lines:** `registerLineManager()` (`LineManager.ts:42`) adds the line time system and the
  `LINE` hooks; `SceneLoader.ts:51` calls `disposeNonPersistentLines`.
- **Generated maps:** `generatedAppFns.ts:3-8` imports 4 TSL material files and 2 PostFX pass
  files as namespaces. Readers: `Material.ts:333` (sync, in `createMaterial`, only for a material
  with a `tslFile`, which needs a `*.material.json`), `PostFX.ts:122`, `_dbg__MaterialEditor.ts:717`.
- **Loaders:** `GLTFLoader` static in `Import/GLTFSource.ts:2` and `debug/3DSymbols.ts:2`,
  `DRACOLoader` in `Import/DracoDecoder.ts:1`, `HDRLoader` in `Texture.ts:3`; `KTX2Loader` is
  already lazy (`Import/KTX2.ts:31`). In the assets worker: `assetsSwitchGLTF.ts` (GLTF, Draco,
  KTX2) and `assetsSwitchTexture.ts` (HDR), all static.
- **At load (p604 §4.6):** `PhysicsAPI.ts:10` (`physicsWorker?worker`), `Assets/AssetsAPI.ts:7`
  (`assetsWorker?worker`), `InitApp.ts:27` (`./styles/index.scss`).
- **`package.json`** has no `sideEffects`; `vite.config.ts`' `treeshake.moduleSideEffects` is
  `getEntryModuleSideEffects` (only the 16 entry files are free of side effects). Stylesheets:
  `styles/index.scss`, `DropDown.scss`, and 2 `*.module.scss` outside debug code.

### 2.7 The entries and the app

- The 9 feature entries exist (`aekasha/physics`, `character`, `skybox`, `lod`, `spatial`,
  `instancing`, `lines`, `postfx`, `viewports`), so each factory has its entry. An entry file holds
  only named `export … from` (`aliases.test.ts`), so a factory lives in a module next to its
  feature.
- `src/AppECSPlugins.ts` registers one plugin with the 6 toolkit effects and `SpinSystem` (Hub
  region `ecs-register-plugin`); `src/index.ts` imports it after `aekasha`.
- Versions on `stage-b`: engine 5.0.0 Golden Hour, toolkit 2.0.0 Half Moon, app 1.10.0 (p606
  Phase 10). `CHANGELOG.md`'s `## 2026-10-11 — stage-b` entry is the one this plan extends.

## 3. Decisions

Each had a recommendation; all fifteen, and "no example scene", were confirmed as recommended on
2026-10-11.

### D1. The feature shape and the install context

```ts
export type EngineFeature = {
  id: string; // 'physics', 'skybox', …, or an app's own
  requires?: string[]; // installed earlier in the list, or InitEngine fails naming both
  install: (ctx: FeatureContext) => void | Promise<void>;
};
```

`InitEngine` installs the kernel first (§4.2), then each feature in list order, awaiting each
`install`, at the point where physics boots today (after the camera and light managers and the
debug camera). `FeatureContext` is the only way a feature reaches the kernel's seams:

| Member | What |
| --- | --- |
| `config` | the merged `AppConfig`, read-only |
| `isInstalled(id)` | for optional cooperation (instancing with LOD) |
| `registerPlugin`, `registerComponentHooks`, `registerTransformResetListener` | `ECSWorld`'s, unchanged |
| `addSceneHooks(hooks)` | the scene seams (D4) |
| `setFixedStepDriver(driver)` | the loop's physics seam (D5); one driver, a second fails |
| `setRenderPipeline(provider)`, `addAfterRender(fn)` | the render seams (D5) |
| `registerImportExtension(ext)` | the import seam (D5) |
| `onDebug(fn)`, `onDebugAfterStart(fn)` | run in `InitEngine`'s debug blocks, in install order, behind `__AEK_DEBUG__ && IS_DEBUG_ENV` |

**Recommended.** Factories take an options object when they have options (none do yet; physics
keeps `config.physics`, p612 reviews it). Installing is once per page: `InitEngine` runs once.

### D2. The kernel installs itself; 9 features

- **Kernel** (not listed, always installed, p602 D2's "a minimal banner needs it"): the ECS core
  systems, frustum culling, meshes, groups, raycasting (p602 D2: `kernel/render/`), cameras,
  lights, input. Their module-level registrations move into one `installKernel(ctx)` in today's
  import order.
- **Features:** `physics()`, `character()` (`requires: ['physics']`), `skyBox()`, `lod()`,
  `spatial()` (owns light culling, p602 D2), `instancing()`, `lines()`, `postFx()`, `viewports()`,
  each exported by its entry. No preset (p602 D8). The template's `src/index.ts` lists all nine
  and the app's own feature (D9).
- **`physics.enabled`** keeps its meaning (installed, world not created at boot); not installing
  `physics()` is "no physics, no Rapier".

**Recommended.**

### D3. Lines: a feature, not "on first use"

p990's item said the line core registers on the first `createLines`. p602 D8 chose one rule
("some register on import, some on first call" is what it rejected). **Recommended:** `lines()`,
like the others; its install adds the time system, the hooks and its scene exit hook, and
`SceneLoader.ts` stops importing `LineManager`. Without it `createLines` throws, naming the
feature.

### D4. The scene seams

`addSceneHooks({ … })` with these phases, at the place of today's calls, so the order inside a load
stays as §2.4 lists it:

| Hook | Where | Order | Today |
| --- | --- | --- | --- |
| `loadStart()` | first thing after `loadStartFn` | install | `holdPhysicsStepping` |
| `exit(prevSceneId)` | before the kernel's group delete | reverse install | characters, physics entities, lines, sky box clear |
| `worldCleared(world, prevSceneId, nextSceneData)` | after `clearNonPersistent` | install | spatial domains release / register |
| `beforeAssets()` (awaited) | after `createCameras` | install | `resetPhysicsWorld` |
| `created(sceneId)` (awaited) | after `setCurrentScene` | install | `activateSceneDefaultSkyBox` |
| `entered()` (awaited) | before `loadEndFn` | install | ray stats, `settlePendingPhysicsEntities`, `releasePhysicsStepping` |
| `loadSettled()` | the load's `.finally` | install | `releasePhysicsStepping` |
| `sceneRegistered(sceneId, data)`, `sceneDeleted(sceneId)` | `Scene.ts` | install | `registerSkyBox`, the sky box texture release |
| `retainedTextures()` | `SceneAssetRelease.ts` | — | `getActiveSkyBoxTexture` |

Exit hooks run in reverse install order so a dependent tears down first (characters before
physics, as today). Lines move from before the kernel's looper delete to the `exit` phase: a
change in order between independent steps, checked by the scene runner.

**Recommended.** Today's `registerOnAllSceneExits` / `registerOnAllSceneEnterings` stay for app
code; features use the hooks (ordered, awaited where needed).

### D5. The loop, render, import and assets worker seams

- **Fixed step:** `setFixedStepDriver({ latch, step, getState })`: the loop calls `latch()` where
  it calls `latchPhysicsSnapshot`, and `step(loopState, onBeforeStep)` where it calls
  `stepPhysics`. Without a driver the loop polls held keys once per frame (today's fallback
  without physics). The physics feature sets it.
- **Render:** `setRenderPipeline(() => pipeline | null)` (PostFX; `MainLoop.renderScene` and
  `Snapshot.ts` read it) and `addAfterRender(fn)` (viewports).
- **Import:** `registerImportExtension({ id, … })`: physics adds the collider and body spawn
  (`SpawnImported.ts`' physics half and `MeshColliderGeometry.ts`), LOD the chain read and
  registration (`ImportRegistry.ts`' LOD calls). A node or option that needs a missing extension
  warns once, naming the feature.
- **Assets worker:** a worker can't receive code, so job kinds aren't registered: the worker
  `import()`s each job's module on its first job (`assetsSwitchGLTF`, `assetsSwitchTexture`,
  `assetsSwitchSimplify`; the worker is an ES module, so it can split). An app without LOD never
  loads `LodSimplify`.
- **Feature → feature:** the LOD target registry (`registerLodTarget`) and the spatial radius
  providers become small kernel registries the features read, so instancing registers into them
  without importing LOD or spatial; `getConservativeGeometryRadius` moves to the kernel's geometry
  helpers. The layout report's feature dependencies are then character → physics only.

**Recommended.**

### D6. The type-only seams stay

The 18 type-only kernel → feature imports (component data, `AppConfig.physics`, import params)
cost no bytes. Moving them into their features means features augmenting `ComponentDataMap` and
`AppConfig`, which changes the public types of the core component map. **Recommended:** not here;
p612 (ECS, loop, config) owns them, and p608 moves the files with the type imports as they are.
p612's stub gets the list.

### D7. `__AEK_DEBUG__`: the define plus one guard

- `vite.config.ts` defines `__AEK_DEBUG__` as `VITE_APP_ENV !== 'production'` (dev server and
  builds, workers included); `vitest.config.ts` defines it `true`; a `declare const` in
  `src/_engine/types/`.
- `initEnvironment` assigns `IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`, `IS_PROD_TEST_ENV` only
  `if (__AEK_DEBUG__)`; every read folds (§2.5's spike). No call site changes. The
  `loadDebugModule*` helpers start with `if (!__AEK_DEBUG__) return null`.
- **The check:** `yarn verify:baselines` fails when the production build has a `_dbg__` chunk or
  a `debug/*.ts` wrapper in the main chunk's module list (from the same build it measures).

**Recommended.** `?isDebug` / `?isProdTest` behave as today in development and test builds.

### D8. No module-level side effects: a test

`devTools/verify/moduleSideEffects.test.ts`: no top-level expression statement in
`src/_engine/`, `src/toolkit/`, `src/app/` and `src/*.ts`, except `_dbg__` files and
`core/Debug/**` (loaded only by the debug loader), the two worker entries and `src/index.ts`.
Starts with an allow-list of §2.3's statements, shrinks per phase, empty at the end. A top-level
`const x = register()` isn't caught (no such case today); the coding standard says it.
**Recommended** (the stub's "a lint rule or a check script"; a test runs in the Stop hook like
`aliases.test.ts`).

### D9. The app's plugins are a feature

`src/AppECSPlugins.ts` keeps its name and exports `appECSPlugins: EngineFeature`
(`id: 'app'`), whose `install` registers today's plugin; `src/index.ts` lists it last and stops
importing the file for its effect. The toolkit's `register*Effect(world)` functions don't change.
The two app statements (`exampleHud.ts`, `scene01.ts`) move into a function their scene calls.
**Recommended.**

### D10. The manifest and the schema composition

- **Composition:** `sceneSchema` and `meshSchema` are built from the kernel's fields and each
  feature's part (`{ feature: 'skybox', scene: { skyBox, skyboxes } }`, `{ feature: 'lod', mesh:
  { lod }, asset: impostors }`, PostFX's and spatial's scene fields). The gatherer composes them
  with every engine feature (it validates any app's data). Then `skyBoxSchema`, `lodSchema` and
  `impostorSchema` move next to their features (still under `core/` until p608), their entries
  export them, and `aekasha/schemas` re-exports them for the devTools. The JSON Schemas in
  `.schemas/` stay byte-identical.
- **Manifest:** the gatherer writes each scene's feature ids (the parts its data uses) into the
  generated data; `InitEngine` checks them against the installed features and throws, naming the
  scene and the feature (every environment: a clear error beats a blank sky).
- **Changed from the stub:** the gather can't fail on an uninstalled feature: the feature list is
  code in `src/index.ts`, which it doesn't run. The boot check fails instead, and the scene runner
  boots every scene. Using the manifest to fold code paths (p600 §4.2's constants) is p611's.

**Recommended.**

### D11. Lazy TSL material and PostFX maps

The generated maps become `{ [id]: () => import('…') }`. The scene loader loads the files its
scene's materials and PostFX passes name, with its other assets, into a cache `createMaterial` and
the PostFX builder read synchronously as today; `loadTslMaterialFileAsync(id)` (exported) for a
material created outside a scene load, and a clear error when it wasn't loaded. **Recommended.**

### D12. Icons: a registry

`registerIcon(name, svg)` and `getSvgIcon(name, size?)` (`aekasha/ui`); one module per built-in
icon (`core/UI/icons/<Name>.ts`, a `?raw` re-export). The kernel registers the icons kernel code
uses; the debugger registers its own in its `_dbg__` init; an app registers its own.
`SvgIconKey` becomes `BuiltInIconName | (string & {})`. **Recommended** (p602 D5).

### D13. `sideEffects` and the entries

`"sideEffects": ["**/*.scss", "**/*.css"]`. Whether Vite applies it to the project's own files,
and how it combines with `getEntryModuleSideEffects` (a resolver's `moduleSideEffects` and the
option can override each other), isn't verified: Phase 8 measures it, and the bundle baseline and
the system order decide which stays. **Recommended.**

### D14. Loaders where used

`GLTFLoader` and `DRACOLoader` `import()`ed on the first main-thread GLTF load (`GLTFSource.ts`,
`DracoDecoder.ts`), `HDRLoader` on the first `.hdr` (`Texture.ts`). The worker's loaders follow
its job modules (D5). **Recommended.**

### D15. The imports at load

The two `?worker` imports become `import()`s at the worker's start (`initPhysics`, the assets
worker's first request). `InitApp.ts`' SCSS import stays: `InitApp.ts` is the browser boot, which a
headless runner (p510) doesn't import. p510's stub says so. **Recommended.**

### Not decided here: an example scene

Nothing here is visual. p611's "banner" profile is the SBP example; the Hub's feature pages show
each `features` line. **Recommended:** no example scene. **As decided:** none.

## 4. Design

### 4.1 `InitEngine`

```ts
import { InitEngine } from 'aekasha';
import { physics } from 'aekasha/physics';
import { skyBox } from 'aekasha/skybox';
import { appECSPlugins } from './AppECSPlugins';

InitEngine({
  config,
  data: appData,
  features: [physics(), skyBox(), /* … */ appECSPlugins],
  start: async () => { … },
});
```

`features` is optional while the phases convert the features (`InitEngine` installs every
unconverted one itself, in today's order) and required from Phase 7 on.

### 4.2 Install order

The kernel's registrations run in today's import order (`ECSCoreSystems`, frustum culling,
`MeshManager`, `GroupManager`, `Raycast`), then the features in list order. The template's list
reproduces today's order: physics, character, skybox, lod, spatial (light culling), instancing,
lines, postfx, viewports, app. Phase 1's system-order record proves each step.

### 4.3 Where the code goes

A factory and its install live in `<feature folder>/<Feature>Feature.ts` (`core/SkyBox/SkyBoxFeature.ts`,
`core/PhysicsFeature.ts` next to `PhysicsAPI.ts`), the contract in `core/Features.ts`
(`EngineFeature`, `FeatureContext`, the hook runners). `moveRules.ts` gets a rule for each
(`features/<name>/` and `kernel/init/`).

## 5. Phases

Each phase leaves the tree compiling, lint-clean and every scene passing. Verification per phase:
`yarn test`, `yarn lint`, `tsc`, `yarn verify:scenes` (snapshots, hashes and the system order
unchanged) and `yarn verify:baselines` (`bundle.json` / `api.json` diffs are the phase's own).

### Phase 1: the safety net — done

1. Scene baselines on `stage-b`'s commit (`yarn verify:scenes --update`, before any change).
2. The system order as a baseline: the test bridge returns every world's `getSystemOrder()` per
   stage, and the runner records and diffs it per scene and configuration (p606 did it by hand
   five times).
3. The module-level side effects test (D8) with §2.3's allow-list.

**As built:**

- **Order changed:** step 2 came before step 1's recording, so one `--update` records the
  snapshots, hashes and system orders together. The bridge change is debug-only and registers no
  system; a first run started before it was stopped before it recorded anything.
- The bridge's `getSystemOrder()` (`TestBridgeSystemOrder`: world id → stage → `id@order`; bridge
  version 3). The runner reads it last on the page (after the probe or the prod test settle, so
  the debug modules' lazily registered systems are in), records it in each baseline entry
  (`systemOrder`, an optional field: the format version stays 1) and fails on a difference
  (`devTools/verify/systemOrder.ts`' `diffSystemOrders`: the first position that differs per
  stage, or the systems added and removed; `systemOrder.test.ts`). Chromium only.
- **Found by it:** p606 Phase 2's race was live. `lightHelperSyncSystem` and
  `cameraHelperSyncSystem` (`LATE_MAIN`, order 0) swapped in 16 of 96 runs of a stability run,
  and nothing else moved. They registered when their fire-and-forget `loadDebugModule` chunks
  landed (`LightManager.ts`, `CameraManager.ts`). Fixed rather than ignored: `registerLightManager`
  is `async` and awaits its two debug modules (`InitApp.ts` awaits it), and `initDebugCamera`
  awaits its helpers module, so the light helpers' system always registers first. That await
  opened a second race in `MAIN`: `debugCameraSystem` (`_dbg__DebugCamera`, which
  `_dbg__CameraGUI` imports) against the core plugin `lineTimeSystem` (`registerLineManager`),
  which had always won because nothing was awaited between them. `registerCameraManager` is
  `async` too and awaits its GUI module. The order in this stretch of `InitEngine` is now fixed:
  the debug camera's systems, the light helpers', then the line time system. Debug env only; a
  comparison with `stage-b`'s baselines showed only system order changes (hashes and snapshots
  passed). Phase 5 moves these debug loads into `onDebug` hooks, awaited in install order.
- `devTools/verify/moduleSideEffects.test.ts`: §2.3's scan as a test, `NOT_YET_INSTALLED` with
  42 statements in 19 files (§2.3's 47, minus the workers' 4 and `src/index.ts`, exempt
  like `_dbg__*` and `core/Debug/**`). A count that drops must drop in the list too, so it only
  shrinks. Checked with a mutation (a top-level `console.log` in a toolkit file, and a count set
  above its file's real one: both reported).
- `devTools/verify/CLAUDE.md` and root `CLAUDE.md`'s `yarn test` line name both.
- Checks: the scene baselines (24 scenes × 4 configurations, WebGPU, macOS) recorded with the
  system order on this phase's runtime, then two runs against them: 96 passed each, so the order
  is stable. `yarn test` 222 passed. Baselines: `api.json` gains `TestBridgeSystemOrder`,
  `bundle.json` only `_dbg__TestBridge.js` (+0.1 kB gzip; the other chunks' few-byte jitter left
  out), `docs.json` `engine/debug` 133 / 184.

### Phase 2: Rapier out of the main chunk — done

1. `ENGINES.ts`: `loadEngineAPI: () => import('./EngineRapier')`; `initPhysicsEngine` awaits it
   (main thread and worker). `_dbg__About.ts` unchanged.
2. The `?worker` imports load at the worker's start (D15).
3. Bundle: the main chunk loses `rapier.mjs` (−829 kB gzip expected) and `EngineRapier`; in
   `MAIN_THREAD` mode it's a lazy chunk. Hashes in all three targets.

**As built:**

- `ENGINES.ts`: `loadEngineAPI: () => import('./EngineRapier')` instead of the namespace import;
  `initPhysicsEngine` loads the engine and its API together (`Promise.all`), on the main thread
  and in the worker. `_dbg__About.ts` reads only the names, unchanged.
- `PhysicsAPI.ts` imports `physicsWorker?worker` in `initPhysics`' `WORKER_THREAD` branch, and
  `AssetsAPI.ts`' `startWorker` imports `assetsWorker?worker` before `initWorker` (its `.catch`
  covers a failed import too).
- Bundle (§2.1's 1.78 MB is the main chunk's modules' gzip sum, 1738 KiB; the file itself
  gzips to 1251 KiB): the file `index.js` 1251.3 → 430.5 kB gzip (−821 kB), its modules'
  sum 1738 → 916 kB; `core/Physics` in main 19.7 → 7.2 kB (`EngineRapier` gone),
  `@dimforge/rapier3d-compat` and `_engine/workers` gone from it. **Not expected:** the worker is
  split too (it's an ES module worker): `physicsWorker.js` 828 → 9.2 kB, and Rapier is one lazy
  `rapier.js` (810 kB) that the worker and, in `MAIN_THREAD` mode, the main thread load: Vite
  emits it once (the same content hash), so `dist/` holds one Rapier instead of two. New chunks:
  `rapier.js`, two `EngineRapier.js` (the page's and the worker's, 9.3 / 9.2 kB) and the two
  `?worker` wrappers (0.1 kB each).
- Checks: `yarn verify:scenes` 96 passed (dev server, where nothing is split). The split only
  exists in a build, so the runner also ran against a `VITE_APP_ENV=test` build under
  `vite preview` (`--url`; `workerMsg`, `mainThread`, `prodTest`: preview sends no COOP / COEP,
  so no `workerSab`): every hash matched, so Rapier loads from its chunk in the worker and on the
  page. Two differences there, both also on the parent commit's build: the system order (p606
  Phase 7's dev vs build tie: `physicsTierPolicyFrameSystem` registers early only on the dev
  server, where the baselines are recorded) and `textureAtlases` (below). `api.json` unchanged.
- **Found, not this plan's:** `textureAtlases` fails in every build. `src/app/textureAtlases.ts:79`'s
  `local = (url) => url.pathname.slice(1)` turns a PNG Vite inlined as a `data:` URL (under
  `assetsInlineLimit`, 4 kB) into `mage/png;base64,…`, so `textureAtlases/albedo_red` doesn't
  load (2 errors, a different snapshot). The dev server serves paths, so the runner never saw it.
- **Running the runner against a build** writes `dist-stats/` too (the visualizer ignores
  `--outDir`): `verify:baselines --no-build` then refuses; run it with a build.

### Phase 3: `__AEK_DEBUG__` — done

1. The define, the declaration, `initEnvironment`'s guard, the loader guards (D7).
2. The production check in `verify:baselines`.
3. Bundle: the debug wrappers, `DefaultDebugKeyBindings`, the Toaster, `3DSymbols` and the
   debug-only branches leave main. The debug and prodTest configurations pass unchanged.

**As built (step 1):**

- **The define is `VITE_APP_ENV` is 'development' or 'test'**, not D7's `!== 'production'`:
  `yarn build` sets no `VITE_APP_ENV` (`initEnvironment` reads anything else as production), so
  `!== 'production'` would have been true there. It's read from `process.env` like the scripts set
  it (no `.env` files). `vitest.config.ts`: `true`. Declared in `types/typings.d.ts`.
- `initEnvironment` assigns the three flags after `if (!__AEK_DEBUG__) return;` (`IS_PROD_ENV` and
  `CUR_ENV` before it). `isDebugEnvironment()` / `isProdTestMode()` return `IS_DEBUG_ENV` /
  `IS_PROD_TEST_MODE` (the same formulas) instead of recomputing from the query params, so their
  calls fold too (`MainLoop`'s `mainLoopForDebug`, the input debug branches). Both loaders start
  with `if (!__AEK_DEBUG__) return null`.
- **§2.5's spike holds only partly in the real graph.** Rollup does know every flag read is
  `false` (checked by instrumenting Rollup: never reassigned, no TDZ), and the code behind them
  goes, but two things kept `_dbg__` chunks:
  - `loadDebugModuleAsync`'s `includeInProdTestMode = false` default: Rollup drops a call's
    arguments only when no parameter is used, and a default counts, so the six `…, true)` calls
    (DebuggerGUI, Profiler, GPUMemory, OnScreenTools, MainLoop, Character) kept their `import()`.
    The parameter is optional now, without a default (same behaviour).
  - `src/index.ts`'s `if (IS_DEBUG_ENV) { … await import('…/_dbg__exampleHub') }` inside
    `InitEngine`'s `start` callback: Rollup includes that callback's code whole, renders the dead
    branch as `if (IS_DEBUG_ENV) ;`, and the `import()` inside still creates an orphan chunk
    (nothing loads it; it pulled `Snapshot` and `DevFiles` along). The scenes' identical
    `if (IS_DEBUG_ENV) { await import() }` blocks fold, and so does the engine's. Even
    `loadDebugModuleAsync` there kept its argument. Step 1 used `if (__AEK_DEBUG__ && IS_DEBUG_ENV)`
    there; **step 3 found the cause and reverted it** (below): `InitEngine`'s `try` block.
  - Rollup keeps the `register*` wrappers' declarations (never called) and the empty
    `if (IS_DEBUG_ENV) ;` shells; the minifier removes most of it. Same cause.
- Bundle after step 1: no `_dbg__` chunk and no `tweakpane.js` in `dist/`; `index.js` 430.5 →
  402.2 kB gzip (−28.3 kB: `three` −9.0, `_engine/core` −12.2, `debug` −5.4); gone with their only
  non-debug importer: `Snapshot`, `OrbitControls`, `DevFiles`, `DialogWindow`, `ECSStressTest`.
  Three lazy chunks grew by taking in chunks that existed only because debug code shared them:
  `physicsTiers` +4.0 kB (`PhysicsTierPolicy`), `InstancedMeshPool` +5.7 kB (`ImpostorBake`,
  `OctahedralImpostor`), `generateFoliage` +2.1 kB (`CrossQuads`). The 14 `debug/*.ts` wrappers
  are still in main (2.1 kB gzip), as hollow shells.

**As built (step 2):**

- `devTools/verify/debugInProduction.ts` (`findDebugCodeInBuild`, tested): a `_dbg__*` file in
  `dist/assets/`, a `_dbg__` or `core/Debug/` module with rendered code in any chunk, or a
  `debug/*.ts` wrapper (the entry `index.ts` aside) with rendered code in any chunk. Stricter than
  D7's "main chunk" (a wrapper in a lazy chunk ships too). The visualizer also lists tree-shaken
  modules (without a chunk), so only rendered code counts.
- `verify:baselines` runs it on every bundle run, after the three baselines (`production build:
  debug code`): each finding fails the run, and `--update` records nothing while there is one. The
  build passes `VITE_APP_ENV=production` itself. `--no-build` after `yarn build:test` fails by
  design, and the message says so.
- Checked with a mutation: a `VITE_APP_ENV=test` build reports 58 debug files, 110 modules and 16
  wrappers, and `--update` refuses. On the production build it reports the 14 wrappers in
  `assets/index.js` and nothing else: step 3's list.

**As built (step 3):**

- **The cause of step 1's leftovers: Rollup's `treeshake.tryCatchDeoptimization`** (on by
  default). `InitEngine`'s whole body was a `try { … } catch`, and Rollup includes everything in
  a `try` block whole, and fully includes the arguments of a parameter called there: so every
  `if (IS_DEBUG_ENV) { await registerX() }` block's call stayed (rendered as `if (IS_DEBUG_ENV) ;`,
  but `registerX` and its wrapper module stayed), and `await start()` kept the app's whole
  `start` callback, hence `_dbg__exampleHub`'s orphan chunk. Fixed in `InitApp.ts`: the body is
  `initEngineAsync`, and `InitEngine = (options) => initEngineAsync(options).catch(…)` with the
  same log and error (the same rejection as before). `src/index.ts` is back to a plain
  `if (IS_DEBUG_ENV)`. Not `tryCatchDeoptimization: false`: that changes how every `try` in three
  and Rapier is shaken (feature detection relies on it). **A `try` block around debug-gated code
  keeps it in a production build:** later phases' install code (`onDebug` hooks run inside one?)
  must keep debug calls out of `try` blocks, or behind `__AEK_DEBUG__`.
- `useDebug` and `isDebugReady` start with `__AEK_DEBUG__ &&`: their result folds, so a wrapper
  whose body is `useDebug(ref)?.fn()` becomes empty and leaves with its calls.
- Five call sites got the flag their callee already checks, so a production build drops the
  call (an `await` of an empty async function, or a call whose arguments read properties, stays
  otherwise): `InitApp.ts`' `load3DSymbols()` (`IS_DEBUG_ENV`) and `registerTestBridge()`
  (`IS_DEBUG_ENV || IS_PROD_TEST_MODE`), `Scene.ts`' `updateDebuggerSceneTitle`, `PhysicsAPI.ts`'
  `updatePhysicsPanel` (the `TRANSFORMS_PUSH` one), and `SceneLoader.ts`' missing debugger
  loader fallback (`IS_DEBUG_ENV &&`: only the debug env targets that loader). Debug env and
  prodTest unchanged; production loses two `await`s of resolved promises in `InitEngine`.
- Bundle (`bundle.json` recorded): `index.js` 430.5 → 401.3 kB gzip (−29.1 kB), its modules
  218 → 197 (gzip sum 916 → 871 kB); `_engine/debug` gone from main (the 14 wrappers), and with it
  `DefaultDebugKeyBindings` (`core/Input` −2.9 kB), the Toaster and `3DSymbols` (`core/UI`
  −3.4 kB); `three` −9.0 kB (`OrbitControls` and the debug-only helpers). `GLTFLoader` and
  `DRACOLoader` stay in main for `Import/GLTFSource.ts` (Phase 8, D14). The debug check: none.
  `api.json` and `docs.json` unchanged.
- Checks: `yarn verify:scenes` 96 passed (24 scenes × 4 configurations, WebGPU, macOS): hashes,
  snapshots and the system order unchanged, so the debug and prodTest configurations behave as
  before (the dev server, where `__AEK_DEBUG__` is true). `yarn test` 225 passed, lint, `tsc`
  (both projects), the docs ratchet.

### Phase 4: the install contract and the kernel — done

1. `core/Features.ts`: the types, `FeatureContext` (the ECS members and `onDebug*` now; the seams
   come with their features), the install runner, `requires` checks.
2. `InitEngine({ features })` (optional, §4.1). The kernel's registrations move into
   `installKernel` (§4.2).
3. The app's plugins become `appECSPlugins` (D9); `exampleHud.ts` and `scene01.ts` lose their
   top-level statements; the Hub region `ecs-register-plugin` moves with the code.
4. The allow-list loses the kernel's and the app's entries; the system order is unchanged.

**As built:**

- **`core/Features.ts`:** the public types `EngineFeature`, `FeatureContext` and
  `FeatureDebugHook` (on `aekasha`); internal `createFeatureHost(config)` (the context plus the
  installed ids and the two debug hook lists, on a host object `InitEngine` owns, not in module
  state), `checkFeatures` (an id listed twice, a `requires` id missing or listed later: throws
  naming both, before anything installs), `installFeaturesAsync` (list order, each awaited; a
  failure is caught with a promise `.catch`, not a `try` block, logged with the feature's id and
  rethrown: the lib is ES2021, no `Error` `cause`) and `runFeatureDebugHooksAsync`.
  `core/Features.test.ts` (9 tests). Move rules: `Features.ts`, its test and `Kernel.ts` →
  `kernel/init/`.
- **Changed from D1's table:** the context also has `registerCorePlugin` (the kernel's core
  plugin needs it, and `lines()` will: `lineTimeSystem` is a core plugin, Phase 7).
- `onDebug` / `onDebugAfterStart` keep a hook only `if (__AEK_DEBUG__)`. Nothing calls them yet:
  **Phase 5 checks that a production build drops an `onDebug` closure and its `import()`** (the
  debug check in `verify:baselines`). Rollup may not see through `ctx.onDebug` (a method of an
  object passed as a parameter) to its empty body; if the chunk stays, the call sites become
  `if (IS_DEBUG_ENV) ctx.onDebug(…)` (installs run after `initEnvironment`, so the flag is set).
- **The install points follow the recorded system order, not just §4.2.** Today the kernel's and
  the features' load-time registrations interleave (dev server evaluation order: Raycast,
  PhysicsManager, Character, GroupManager, ECSCoreSystems, frustum culling, MeshManager, Spatial,
  SkyBox, light culling, LOD, InitApp, PhysicsTiers, PhysicsTierPolicy, AppECSPlugins). The ties
  that involve kernel or app systems (every recorded entry): `MAIN` / `LATE_MAIN` /
  `APP_RENDER_SYNC@0` (the core plugin's systems first), `LATE_MAIN@-1000`
  (`rayCastFrameEndSystem` before `physicsRayStatsFrameEndSystem`), `APP_LOGIC@0`
  (`physicsTierPolicyFrameSystem` before the app's), `APP_RENDER_SYNC@-0.5`
  (`followObjectCameraRigSystem` before `physicsWireframeSystem`). So:
  - `installKernel` (`core/Kernel.ts`: core systems, frustum culling, meshes, groups, raycast;
    no two share a stage and order or a component type) runs **right before `initECSWorld`**.
  - The listed features install after the debug camera, before `registerPhysicsManager` (D1's
    point). Their debug hooks run at the end of the first `IS_DEBUG_ENV` block, the after-start
    ones after `createSkyBoxDebugGUI` (before the toaster); neither inside a `try`.
  - The kernel's `DISABLED` and `TAG_FRUSTUM_CULLED` hooks now run after LOD's (still at load):
    LOD's only queue a selection, no interaction.
  - **For Phase 5:** with `physics()` before `app` in the list, the ties above hold as long as
    `physicsTierPolicyFrameSystem` registers in physics' install and `physicsWireframeSystem`
    after the app's install (today its debug chunk registers it, fire-and-forget, from
    `registerPhysicsManager`). Keep `physicsInterpolationSystem` and
    `physicsRayStatsFrameEndSystem` after the kernel (they are).
- Each kernel module's statements are an internal `install…(ctx)` in the module
  (`installCoreSystems`, `installObjectFrustumCulling` with its hook moved next to its plugin,
  `installMeshes`, `installGroups`, `installRaycast`). `InitApp.ts` imports `Kernel.ts` where
  the side-effect imports were, so the modules still registering at load evaluate in the same
  relative order (checked with an evaluation-order script); light culling's side-effect import
  stays until Phase 6.
- `InitEngine`: `features?: EngineFeature[]` (default `[]`), `checkFeatures` right after
  `loadConfig`; the `@example` lists `features: [appECSPlugins]`. Cameras, lights and input still
  register in `InitEngine` itself.
- **The app (D9):** `appECSPlugins` (`id: 'app'`), the Hub region `ecs-register-plugin` around
  the whole feature; `src/index.ts` lists it and no longer imports the file for its effect.
  `createExampleHud` registers the exit hook (by id, so once), `scene01`'s key binding is created
  in its scene function (replaced by id on a later visit, still bound after the scene). The Hub's
  prose about `AppECSPlugins.ts` is Phase 10's.
- The allow-list: 29 statements in 11 files left (physics, character, sky box, light culling,
  LOD, spatial, instancing; 42 in 19 before).
- Checks: `yarn verify:scenes` 96 passed after section 2 and again after section 3 (24 scenes ×
  4 configurations, WebGPU, macOS): hashes, snapshots and the system order unchanged. `yarn test`
  234 passed, lint, `tsc` (both projects), the docs ratchet, `yarn hub:build` (the moved region).
  Baselines recorded: `api.json` gains the three public types on `aekasha` and the internal
  installers and runner; `bundle.json`'s main chunk `_engine/core` 58.7 → 59.5 kB gzip (25 → 27
  modules: `Features.ts`, `Kernel.ts`), the file `index.js` 411.0 → 411.6 kB gzip; `docs.json`
  better coverage. The production build's debug check: none.

### Phase 5: physics and character — done

1. The seams these need: `addSceneHooks` (D4: all phases), `setFixedStepDriver` (D5).
2. `physics()`: boot (`initPhysics`, the first world), the manager, tiers, tier policy, the
   transform reset listener, the scene hooks, the fixed-step driver, its debug GUIs and the
   determinism probe. `character()` with `requires: ['physics']`.
3. `SceneLoader.ts`, `MainLoop.ts` and `InitApp.ts` stop importing physics and characters.
4. Hashes in all three targets, with and without the probe; `physicsTiers` in all three.

**As built:**

- **The scene seams:** `core/SceneHooks.ts` (`SceneHooks`, public on `aekasha`; internal
  `addSceneHooks`, which returns the remover, and a runner per phase; `SceneHooks.test.ts`).
  Each phase runs the hooks in install order, `exit` in reverse; the awaited phases await each
  hook (only the hooks that have the phase, so no extra `await`s). **Only the load phases**
  (`loadStart`, `exit`, `worldCleared`, `beforeAssets`, `created`, `entered`, `loadSettled`),
  each wired into `loadScene` where D4 says (`worldCleared` and `created` have no hook yet).
  **`sceneRegistered`, `sceneDeleted` and `retainedTextures` are Phase 6's**, with the sky box:
  `registerScenesFromGeneratedData` runs before the features install, so a `sceneRegistered` hook
  added in an install misses every scene. Phase 6 either registers the scenes after the installs
  or replays the registered scenes to a hook when it's added.
- **The fixed-step seam:** `FixedStepDriver` in `MainLoop.ts` (public with `LoopState`, now
  documented), internal `setFixedStepDriver` (a second throws). **Changed from D5's
  `{ latch, step, getState }`:** `{ latch, step, flushEvents, isStepping }`. A boolean keeps
  `PhysicsState` out of the kernel; `flushEvents` because the loop owns the sub-step's order
  (held keys, the events, the `APP_PHYSICS_STEP` systems) and the events sit in its middle. The
  loop calls `step(loopState, runFixedSubStep)` while playing and `step(loopState)` while paused
  (it notes the pause); without a driver, or while `!isStepping()`, it polls held keys once per
  frame. `MainLoop.ts` and `SceneLoader.ts` import no physics or character module.
- `FeatureContext` gains `addSceneHooks` and `setFixedStepDriver`.
- **`physics()`** (`core/PhysicsFeature.ts`, on `aekasha/physics`) installs, in order:
  `installPhysicsTiers`, `installPhysicsTierPolicy`, `installPhysicsEntities` (was
  `registerPhysicsManager`: the transform reset listener, the moved-body listener, the
  `TAG_IS_PHYSICS_OBJECT` hook and the default world's three systems, still that world only), the
  driver, the scene hooks, `initPhysics(true)`, `registerPhysicsAPIDebugGUI` (`if (IS_DEBUG_ENV)`,
  in the install: it must precede the first world), the first world when `physics.enabled`;
  `onDebug`: the collider wireframes (`registerPhysicsWireframeDebugAsync`, awaited now), then
  the determinism probe; `onDebugAfterStart`: the Physics API tab. The tier policy's
  scene-scoped cleanup moved from `registerOnAllSceneExits` into physics' `exit` hook
  (`deleteScenePhysicsTierPolicies(prevSceneId)`, after `deleteAllPhysicsEntities`: the same
  relative order).
- **`character()`** (`core/Character/CharacterFeature.ts`, on `aekasha/character`,
  `requires: ['physics']`): `installCharacters`, the `exit` hook (`deleteAllCharacters`, before
  physics' by the reverse order), `onDebug(registerCharacterTools)`,
  `onDebugAfterStart(createCharactersDebuggerGUI)`.
- `InitApp.ts` imports neither; the template lists `[physics(), character(), appECSPlugins]`,
  and so does `InitEngine`'s `@example`. The allow-list: 21 statements in 7 files (sky box,
  light culling, LOD, spatial, instancing). The layout report: the only kernel → physics runtime
  rows left are `SpawnImported.ts`' (Phase 7's import extension); none for character.
- **Found by the system order:** `physicsWireframeSystem` registered before the app's
  `followObjectCameraRigSystem` (`APP_RENDER_SYNC@-0.5`) in every debug run. `_dbg__PhysicsAPI`
  imports `_dbg__PhysicsDebugDraw` statically and loads in physics' install, so the wireframe
  module's load-time registrations ran before the app's install. They're now
  `_installPhysicsWireframes()` (once), which the `onDebug` hook calls. **A `_dbg__` module that
  another one imports registers at the first importer's load:** a debug module whose systems tie
  with the app's registers from an install function, not at load.
- Order changes the runner doesn't record, all between independent steps: the tiers', policy's
  and characters' plugins now follow the kernel's non-core ones (no shared stage and order); the
  wireframe visibility sync and the probe's enter / exit callbacks register at the end of the
  first debug block instead of right after the physics boot. **The drawer tab order is
  unchanged** (listed before and after with `?isDebug=true`, risk 3).
- **The `onDebug` folding check (Phase 4's open point): it folds.** The production build's debug
  check finds nothing, so Rollup drops the `ctx.onDebug(…)` closures and their `import()`s; the
  call sites need no `IS_DEBUG_ENV`.
- Bundle (`bundle.json` recorded): `index.js` 402.0 → 406.0 kB gzip (+4.0 kB),
  `physicsTiers.js` 6.2 → 2.2 kB (−4.0 kB): the tiers and the tier policy were in the
  `physicsTiers` scene's lazy chunk (they registered when they loaded), and `physics()` installs
  them. In return the system order is the same in a build as on the dev server
  (`physicsTierPolicyFrameSystem` registered late in a build, Phase 2). A `physics()` option to
  leave them out is possible later (D1: no options yet). Main `_engine/core` 59.5 → 67.2 kB
  (27 → 31 modules).
- Checks: `yarn verify:scenes` 96 passed after each section (24 scenes × 4 configurations,
  WebGPU, macOS): hashes (the probe in the three debug targets; `prodTest` without it),
  snapshots and the system order unchanged, `physicsTiers` included. Against a
  `VITE_APP_ENV=test` build under `vite preview` (`--url`; `workerMsg`, `mainThread`, `prodTest`,
  as in Phase 2): every scene the build ships passed (60), hashes and the system order matching
  the dev server's baselines, **so Phase 2's dev vs build tie is gone**. The 12 failures are the
  four `isDebugScene` scenes (`assetCompare`, `testDebugScene`, `textureArrays`,
  `textureAtlases`), which the production gather leaves out of a build by design: the runner's
  `?startScene` falls back. `yarn test`
  239 passed, lint, `tsc` (both projects), the docs ratchet. `api.json`: the new public
  `physics`, `character`, `SceneHooks`, `FixedStepDriver`, `LoopState` on their entries, the
  internal installers and runners, `registerPhysicsManager` gone; `docs.json` better coverage.

### Phase 6: sky box, spatial, LOD, instancing — done

1. `skyBox()` (the scene data hooks, `retainedTextures`), `spatial()` (light culling, the domain
   hooks), `lod()`, `instancing()`. The scene data phases (`sceneRegistered`, `sceneDeleted`,
   `retainedTextures`) join `SceneHooks` here, with the registration timing Phase 5's "As built"
   names; the sky box's `created` and spatial's `worldCleared` call sites already exist.
2. The kernel registries for LOD targets and spatial radii; `getConservativeGeometryRadius` moves
   (D5). The layout report's feature dependencies: character → physics only.

**As built (section 1):**

- **The scene data phases** join `SceneHooks`: `sceneRegistered(sceneId, data)`,
  `sceneDeleted(sceneId)` (both run in install order, from `Scene.ts`) and
  `retainedTextures(): readonly Texture[]` (`getSceneRetainedTextures()` collects every hook's into
  a `Set`, read once per `releaseSceneOwnedAssets`). Tested in `SceneHooks.test.ts`.
- **Registration timing: the scenes register after the installs**, not a replay.
  `registerScenesFromGeneratedData()` moved in `InitEngine` from before `load3DSymbols` to right
  after `installFeaturesAsync`; nothing in between reads the scenes (checked: the camera, light and
  line managers, the debug camera, `3DSymbols`, physics' install). A hook added later sees no
  earlier scene (none is, today).
- **`worldCleared`'s next scene id** is `nextSceneData.id` (the loader's fallback data for a
  code-only scene sets it too; every gathered scene's key is its `id`).
- **`skyBox()`** (`core/SkyBox/SkyBoxFeature.ts`, id `'skybox'`): `installSkyBoxSystem` (was the
  module's plugin), `skyBoxSceneHooks` (`sceneRegistered`: the scene's JSON `skyboxes`;
  `sceneDeleted`: `Scene.ts`' old texture release, moved as is; `retainedTextures`: the active
  texture; `exit`: `clearSkyBox`; `created`: `activateSceneDefaultSkyBox`), `onDebug`:
  `registerSkyBoxDebugGUI`, `onDebugAfterStart`: `createSkyBoxDebugGUI`. **Order change (D4):**
  the clear moved from after the groups, lines and loopers to the `exit` phase, before characters
  and physics (reverse install order). Every hash and snapshot passed.
- **`spatial()`** (`core/Spatial/SpatialFeature.ts`): `installSpatialIndex` (the six statements,
  in their order), `installLightObjectCulling` (the two), `spatialSceneHooks.worldCleared` (the
  loader's release / register, moved as is; the `worldCleared` call site had no hook before, so
  it's the same place), `onDebug`: `registerSpatialIndexDebugGUI`.
- **`lod()`** (`core/Lod/LodFeature.ts`): `installLodSystem` (the hook objects stay where they
  were as named consts, registered in their old order), `onDebug`: `registerLodDebugGUI`. The
  kernel's `DISABLED` / `TAG_FRUSTUM_CULLED` hooks run before LOD's again (pre-p607's order).
- **The two lazy LOD modules** (`LodChains.ts`, `Impostors/ImpostorRegistry.ts`) add their
  `onGeometryDeleted` listener with their first chain / record instead of at load: with no
  record there's nothing to release, and the modules stay lazy chunks. Not a feature install:
  they're the modules' own bookkeeping (D3's "one rule" is about features).
- **`instancing()`** (`core/Instancing/InstancingFeature.ts`): `installInstancedMeshPools` (the
  radius provider, the slot hooks, the LOD target, the sync system, in their order). No
  `requires`: registering the LOD target and the radius provider without `lod()` / `spatial()`
  is harmless (section 2 makes them kernel registries anyway).
- **Not expected: the system order changes**, by one system: `instancedMeshPoolSync@0` registered
  only when a scene's lazy module imported the pool (`largeWorld`, `lodShowcase`, `exampleLod`),
  and now every world with global plugins has it from boot, at the position it had in those
  three scenes (after `physicsInterpolationSystem`). `yarn verify:scenes`: 12 passed, 84 failed,
  every failure only `added instancedMeshPoolSync@0`; one new tie, in `physicsTiers`
  (before the scene's `physicsTiersTintSystem`, independent). The baselines are re-recorded for it.
- The debug block: the three debug GUIs move from `InitEngine`'s blocks into the features'
  `onDebug` hooks (the end of the first debug block, after physics' and character's). The drawer
  tab order comes from `DEFAULT_DEBUG_DRAWER_TAB_ORDER`, so it doesn't change (risk 3). The
  modules' load-time registrations (`_dbg__SkyBox`'s manager info and undo handlers) don't
  depend on order; `spatialGridVisualizerSystem` stays between the camera helpers and the GPU
  memory sampler.
- `InitApp.ts` imports none of the four; the template lists
  `[physics(), character(), skyBox(), lod(), spatial(), instancing(), appECSPlugins]`, and so does
  `InitEngine`'s `@example`. **The side effects allow-list is empty** (Phase 7's step 3, earlier:
  lines already register in `registerLineManager`). The layout report: no kernel → sky box or
  spatial runtime rows; LOD's left are Phase 7's (import, assets worker).
- Bundle: `index.js` 406.0 → 408.5 kB gzip (`core/Instancing` 0 → 3.0 kB, the four feature
  modules); the lazy `InstancedMeshPool.js` (8.2 kB) is gone and `OctahedralImpostor.js`
  (6.0 kB, the impostor code it carried) is new. The production debug check: none. `api.json`:
  the four factories on their entries, the installers, scene hook objects and runners.

**As built (section 2):**

- **`core/ECS/LodTargets.ts`** (kernel, → `kernel/ecs/`): `registerLodTarget` (moved from
  `LodSystem.ts`, still on `aekasha/lod`) and internal `getLodTargets()`, which the LOD
  selection reads. It imports the `LodTarget` type from `Lod/LodTypes.ts` (type only, D6).
- **`core/ECS/SpatialMembership.ts`** (kernel): the radius provider registry
  (`registerSpatialRadiusProvider`, `SpatialRadiusProvider`, still on `aekasha/spatial`; internal
  `findSpatialRadiusProvider`) and, **not in D5**, the domain membership seam: internal
  `SpatialDomainMembership` (`hasDomain`, `join`), which `spatial()`'s install sets
  (`setSpatialDomainMembership`, from `getSpatialDomain` / `joinSpatialDomain`). **Why:** the
  grounding (§2.4) missed that the pools' `spatialDomain` option calls `joinSpatialDomain`, so the
  registries alone left instancing → spatial (and the 7.6 kB index in any build with
  `instancing()`). Without `spatial()` a pool with a `spatialDomain` warns once per spawn and
  indexes nothing.
- **`getConservativeGeometryRadius`** moved to `core/Geometry.ts` (still on `aekasha/spatial`);
  `LodSystem.ts`, `LodAuto.ts`, the pools and the spatial index import it from there.
- **`Lod/LodFade.ts` is the kernel's in the target layout** (a `moveRules.ts` rule:
  `kernel/render/LodFade.ts`), not moved now: the grounding missed it too. It's the dither
  primitive (three only), which the LOD system and the instanced LOD pools both draw with.
  p608 moves the file.
- The layout report's feature dependencies: character → physics (3 runtime, 2 type), and
  instancing → lod type only (`LodData`, `LodDef`, `LodResolvedLevel`, `LodTarget`, D6). No
  feature → feature runtime row besides character's.
- Checks: `yarn verify:scenes` 96 passed after section 1's re-recorded baselines and again after
  section 2 (24 scenes × 4 configurations, WebGPU, macOS): hashes, snapshots and the system order.
  `yarn test` 241 passed, lint, `tsc` (both projects), the docs ratchet, `yarn hub:build`.
  Baselines recorded: `api.json` (the three moves, the new internals), `bundle.json` (main
  `core/ECS` 6.7 → 7.3 kB gzip, `core/Spatial` 7.6 → 7.4 kB), `docs.json`. The production debug
  check: none.

### Phase 7: lines, PostFX, viewports, import; `features` required — done

1. `lines()` (D3), `postFx()` (`setRenderPipeline`; `Snapshot.ts` reads the seam), `viewports()`
   (`addAfterRender`).
2. The import extensions (physics, LOD) and the assets worker's job modules (D5).
3. `features` required; `InitEngine` installs nothing on its own. The allow-list is empty (it
   already is: Phase 6 removed its last entries; keep it so).
4. The layout report's "Kernel → feature" has no runtime or dynamic rows.

**As built (section 1):**

- **The render seams:** `core/RenderHooks.ts` (kernel, → `kernel/render/`): the public types
  `RenderPipelineProvider` and `AfterRenderHook` (on `aekasha`, in `FeatureContext`'s signature),
  internal `setRenderPipeline` (a second throws, like the fixed-step driver), `getRenderPipeline`,
  `addAfterRender` (returns the remover) and `runAfterRenderHooks`; `RenderHooks.test.ts`. Its own
  module rather than `MainLoop.ts` (721 lines): `Snapshot.ts` and the profiler read it too. `MainLoop.renderScene`
  renders through `getRenderPipeline()` and runs the after-render hooks in both branches (an editor
  view too, as before); `Snapshot.ts` and `_dbg__ProfilerSources.ts` read `getRenderPipeline()`.
  `FeatureContext` gains `setRenderPipeline` and `addAfterRender`.
- **`lines()`** (`core/Lines/LinesFeature.ts`): `installLines` (was `registerLineManager`: the
  time system, now `installLineTimeSystem(ctx)` through `ctx.registerCorePlugin`, and the `LINE`
  hooks) and `linesSceneHooks.exit` (`disposeNonPersistentLines`). Without it `createLines` throws,
  naming the feature (D3). **Order change (D4):** the dispose moved from after the groups' delete to
  the `exit` phase (before the sky box's clear, by the reverse order). `lineTimeSystem@0` keeps its
  place in `MAIN` (nothing installed between registers a `MAIN@0` system).
- **`postFx()`** (`core/PostFX/PostFXFeature.ts`, id `'postfx'`): `installPostFx` (was
  `initPostFX`: reads `AppConfig.postFx.enabled` from the context), `setRenderPipeline(
  getActivePostFxPipeline)`, and **the scene hooks instead of `registerOnAllSceneExits` /
  `registerOnAllSceneEnterings`** (D4: features use the hooks): `exit` disposes the chain,
  `created` builds the next one. `created`, not `entered`: the debug tab's `postFxDebugSync`
  (an all-scenes enter hook) must run after the build, and `entered` comes after the enter hooks.
  So the chain is set up after the sky box's `created` (awaited) and before the scene's JSON objects
  and enter hooks, instead of after them; nothing awaits in between, so no frame renders
  differently, and a scene's own enter hook now sees its chain. `onDebugAfterStart`:
  `registerPostFxProfiler`, then `createPostFXDebugGUI` (was `InitEngine`'s after-start block;
  now after physics', character's and the sky box's after-start hooks; the tab order comes from
  `DEFAULT_DEBUG_DRAWER_TAB_ORDER`).
- **`viewports()`** (`core/ViewportsFeature.ts`, a move rule → `features/viewports/`):
  `installViewports` (`addAfterRender(renderViewports)`; `renderViewports` isn't exported any
  more) and `viewportsSceneHooks.exit` (`deleteSceneViewports(prevSceneId)`, was an all-scenes exit
  hook added on the first `createViewport`). Without it `createViewport` throws, naming the feature.
  Like PostFX's dispose, it now runs before the exited scene's own exit hooks, not after them
  (`deleteViewport` of a gone id is a no-op).
- **Not in the plan: the engine's debug tools that draw with a feature.** The ray helpers, the
  collider wireframes, the LOD and spatial overlays and the character gizmos draw lines; the axes
  gizmo and the environment ball are viewports. In a debug env without that feature they're off,
  with one log line per tool (internal `isLinesInstalledFor(tool)`, `isViewportsInstalledFor(tool)`,
  checked where each creates its first line or viewport; the wireframes skip their whole install),
  instead of throwing at boot or every frame.
- `InitApp.ts` imports none of the three; the template and `InitEngine`'s `@example` list all nine
  features and the app's. `features`' JSDoc: a feature not listed isn't installed.
- The layout report: no kernel → lines, PostFX or viewports runtime rows (7 runtime rows left:
  section 2's import and assets worker rows). Regenerating it also caught up Phase 6 section 2's
  moves (`LodTargets`, `SpatialMembership`, `getConservativeGeometryRadius`), which that commit's
  generated files had missed.
- Root `CLAUDE.md`'s Viewports paragraph names the after-render hook (the rest is Phase 10's).
- **Found by the production debug check: a closure handed to `ctx.onDebug*` stays in a production
  build** (Phase 5's "it folds" holds for the `import()`s, which their callees' own flags fold, not
  for the closures). `postFx()`'s after-start closure kept `debug/PostFXProfiler.ts` (an empty
  `registerPostFxProfiler`) in `index.js`; the call site is now `if (IS_DEBUG_ENV)
  ctx.onDebugAfterStart(…)` (installs run after `initEnvironment`). The earlier features' closures
  call non-wrapper functions, so the check can't see them: they're likely dead code in main too
  (not measured); Phase 8 can gate them the same way when it measures.
- Checks: `yarn verify:scenes` 96 passed (24 scenes × 4 configurations, WebGPU, macOS): hashes,
  snapshots and the system order unchanged. `yarn test` 243 passed, lint, `tsc`, the docs ratchet,
  `yarn hub:build`. Baselines recorded: `api.json` (the three factories on their entries, the two
  public types on `aekasha`, the installers and seams; `registerLineManager`, `initPostFX`,
  `renderViewports` gone), `bundle.json` (`index.js` 418.4 → 420.0 kB gzip; main `_engine/core`
  67.2 → 69.6 kB, 31 → 33 modules; `EngineRapier.js`' "+0.1 kB" is the two same-named chunks
  paired the other way round, the bytes are the baseline's), `docs.json`. The production debug
  check: none.

**As built (section 2):**

- **The import seam:** `core/Import/ImportExtensions.ts` (kernel): the public types
  `ImportExtension` (`{ id, spawnPhysics?, lodChains? }`), `ImportPhysicsSpawn` and
  `ImportLodChainsExtension`; internal `registerImportExtension` (each member has one provider, a
  second throws), `getImportPhysicsSpawn`, `getImportLodChains` and
  `warnMissingImportExtension(featureId, use)` (once per feature and use);
  `ImportExtensions.test.ts`. `FeatureContext.registerImportExtension`. **Changed from D5's
  `{ id, … }`:** the members are named per cooperation, not generic hooks: the kernel's import
  has exactly two, and the worker side is LOD-specific anyway. Their LOD types
  (`ExtractedLodChain`, `GLTFLodChains`, `TransferableLodChain`) are type-only imports (D6), not on
  an entry (`hub:build`'s `notExported` only flags module-local types).
- **Physics:** `SpawnImported.ts`' physics half is `Import/ImportPhysics.ts`'
  `spawnImportedPhysics({ nodes, params, appIdPrefix })` (a move rule → `features/physics/import/`),
  and the spawn node type is the public `ImportSpawnNode` (`ImportTypes.ts`). `physics()` registers
  `physicsImportExtension`, whose `spawnPhysics` `import()`s that module on the first spawn with
  physics nodes (it and `MeshColliderGeometry` stay out of main, as they were). Every app spawn is
  awaited by its scene code, so the extra load stays inside the held load. Without `physics()`, a
  spawn with physics nodes warns once and spawns the meshes only.
- **LOD:** `Lod/LodImport.ts`' `lodImportExtension` (`read: readGLTFLodChains`, `deserialize:
  deserializeLodChain`, and `requestLodChains` / `registerPrebuiltLodChains` moved from
  `ImportRegistry.ts` as they were), which `lod()` registers. Without `lod()`: `lodChain` warns
  once, and a file's prebuilt chains aren't read (its level meshes are never loaded). The
  primitive key moved to the kernel: `getGLTFPrimitiveKey` in `GLTFExtract.ts` (was
  `getGLTFLodChainKey` in `LodChainGLTF.ts`).
- **`lod: 'AUTO'`** (the layout report's `MeshManager.ts` → `LodAuto` dynamic row, not in §2.4):
  `MeshManager.ts`' internal `setAutoLodResolverLoader(loader)` (and the `AutoLodResolver` type),
  which `lod()` sets to `() => import('./LodAuto')…`; `setMeshLod` checks `isCurrent()` after the
  load as before (one microtask later). Without `lod()`, `AUTO` warns once and resolves false. Like
  Phase 6's `setSpatialDomainMembership`, a direct internal setter, not a context member.
- **The assets worker** (`assetsWorker.ts`) `import()`s each job module on its first job (texture,
  GLTF, simplify; a failed load is tried again by the next job), and the GLTF job `import()`s
  `LodChainGLTF` only when the request's new `readLodChains` is set (`loadGLTFInWorker`'s option:
  the main thread sets it when the LOD extension is registered). `assetsSwitchSimplify.ts` is
  LOD's (a move rule → `features/lod/worker/`).
- **The layout report:** "Kernel → feature" has **no runtime and no dynamic rows** (0 / 22 type /
  0: Phase 7's step 4, done here). **New, not in the plan:** the worker's two `import()`s of
  feature code (`assetsWorker.ts` → `assetsSwitchSimplify.ts`, `assetsSwitchGLTF.ts` →
  `LodChainGLTF.ts`) are listed in their own section, "Assets worker job modules" (`moveMap.ts`:
  a dynamic import from `kernel/assets/worker/` to a feature), not as violations: a worker can't be
  handed code, so naming its jobs' modules is D5's seam; a static one would still be a violation.
- `Lod/CLAUDE.md` names the extension, the resolver and the lazy job module.
- Bundle (`bundle.json` recorded): `index.js` 420.0 → 420.7 kB gzip (main `core/Lod` +0.8 kB:
  `LodImport`; `core/Import` +0.2 kB). The worker splits: `assetsWorker.js` 105.2 kB → its entry
  1.0 kB, with lazy `assetsSwitchGLTF.js` (50.6 kB), a worker-side `three.core.js` (50.8 kB),
  `assetsSwitchTexture.js` (1.9 kB), `assetsSwitchSimplify.js` (1.8 kB), `GeometryTransfer.js`
  (1.8 kB) and `LodChainGLTF.js` (1.0 kB); `SpawnImported.js` 3.0 → 1.4 kB and a new
  `ImportPhysics.js` (2.0 kB). The production debug check: none.
- Checks: `yarn verify:scenes` 96 passed (dev server: hashes, snapshots, system order). Against a
  `VITE_APP_ENV=test` build under `vite preview` (`workerMsg`, `mainThread`, `prodTest`, where the
  worker's job modules and `ImportPhysics` really are separate chunks): 60 passed, the 12 failures
  the four `isDebugScene` scenes a build leaves out (as in Phase 5). `yarn test` 244 passed, lint,
  `tsc`, the docs ratchet, `yarn hub:build` (in `build:test`), `moveMap.ts --check`. `api.json`
  and `docs.json` recorded.

**As built (section 3):**

- `InitEngineOptions.features` is required (no default); its JSDoc says the engine installs
  nothing else and `[]` is the kernel alone. `checkFeatures` throws a clear error when an app
  leaves it out anyway (JS, or an app from before p607), tested in `Features.test.ts`.
- The side effects allow-list (`NOT_YET_INSTALLED`) stays empty. Step 4 was done in section 2.
- **For Phase 10**, besides its list: `readme.md`'s "Boot the engine" example and the migration
  guide's `src/index.ts` diff have no `features` (they don't compile against the required option
  now); the quick start includes the real `src/index.ts`, only its prose lacks `features`. Root
  `CLAUDE.md`: the Bootstrap flow (the Line manager and `initPostFX` are gone, the features
  install after the debug camera), the `yarn test` line's "p607 shrinks its allow-list to none",
  and `devTools/verify/CLAUDE.md`'s `NOT_YET_INSTALLED` sentence; the layout report's new
  "Assets worker job modules" section (`devTools/refactor/`).
- Checks: `yarn verify:scenes` 96 passed (hashes, snapshots, system order). `yarn test` 245
  passed, lint, `tsc` (both projects), the docs ratchet; `yarn verify:baselines` unchanged, the
  production debug check: none.

### Phase 8: the SBP packaging — done

1. `sideEffects` (D13), measured against the entries' `moduleSideEffects`.
2. The icon registry (D12).
3. Loaders where used (D14).
4. Lazy TSL material and PostFX maps (D11): the gatherer, `AppData`'s types, the scene loader's
   preload, the material editor.

**As built (section 1):**

- **How the field reaches Rollup (Vite 6.4.3, read in its code):** Vite's resolver answers a
  relative import in a build with `moduleSideEffects: pkg.hasSideEffects(id)` (the nearest
  `package.json`; `null` without the field), and Rollup takes the resolver's answer over
  `treeshake.moduleSideEffects` (`resolvedId.moduleSideEffects ?? hasModuleSideEffects(id)`). An
  absolute or aliased path gets no answer, so the option still applied to the entries.
- **Measured** (`.cache/runs/`, per-chunk rendered modules from the visualizer): with
  `["**/*.scss", "**/*.css"]` the production build's main chunk loses `Lines/LineBuilders.ts`
  (into the lazy `physicsTiers.js`, the one scene that draws with it) and `ViewManager.ts` (every
  reader folds without the debug env), and `OctahedralImpostor.js` loses `ImpostorSourceHash.ts`:
  `index.js` −305 B, `physicsTiers.js` +303 B. The workers are byte for byte the same. **Without
  `getEntryModuleSideEffects`** (the field kept), every chunk holds the same modules (±5 B: the
  chunks' import order and minified names): the entries only re-export, and what they re-export is
  now side-effect free through the field. **So the field stays and the option went** (D13: one
  mechanism, the standard one an app's bundler reads too): `vite.config.ts`' `rollupOptions` and
  `aliases.ts`' `getEntryModuleSideEffects` are gone.
- **The `_dbg__` modules:** a `VITE_APP_ENV=test` build with and without the field holds the same
  rendered modules except `LineBuilders.ts` (its own lazy chunk there), so no debug module that
  another one imports lost its load-time registrations. No bare `import './x.ts'` in `src/` or
  `hub/`; the two stylesheet imports stay (`**/*.scss`).
- **Not expected: esbuild reads the field too.** Vite bundles `vite.config.ts` with its local
  imports through esbuild, which dropped `devTools/hub/build.ts`' `import './cards'` (a warning
  at config load): the dev server's Hub would have lost its `::: cards` directive. The Hub's
  directives register at load by design (`markdown.ts`, `code.ts`, `scenes.ts`, `claudeMd.ts`,
  `cards.ts`), and `devTools/` never ships, so the field lists `"./devTools/**"` (checked: the
  config bundle has every directive). The Hub's Vite-built scripts are identical with the field.
- Root `CLAUDE.md`'s Build config bullet and the migration guide's "Before you start" name the
  field instead of the option. **For Phase 10:** the guide's `import './AppECSPlugins'` line (and
  any bare import of an app module) would be dropped by a build now: say so where it becomes
  `appECSPlugins`. `CHANGELOG.md`'s p606 line naming `treeshake.moduleSideEffects` is Phase 11's.
- Checks: the field only acts in a build, so the runner ran against a `VITE_APP_ENV=test` build
  under `vite preview` (`workerMsg`, `mainThread`, `prodTest`): 60 passed (hashes, snapshots, the
  system order), the 12 failures the four `isDebugScene` scenes a build leaves out (as in Phases 5
  and 7). On the dev server 95 of 96 passed; the first run (`assetCompare workerSab`) lost its page
  to a navigation with the dev server's socket refused, and passed on its own rerun (likely Vite
  re-optimizing after the config change; not confirmed). `yarn verify:baselines` recorded
  (`bundle.json` as above; `api.json`, `docs.json` unchanged; the production debug check: none).
  `yarn test` 245 passed, lint, `tsc` (both projects, in `build:test`), `yarn hub:build` (in
  `build:test`; its search index warning, 1.04 MB over 1.00 MB, comes with the API docs and isn't
  this change's).

**As built (section 2):**

- **The registry** (`core/UI/icons/SvgIcon.ts`, on `aekasha/ui`): `registerIcon(name, svg)` (a
  name registered again gets the new SVG, so an app can restyle a built-in), `getSvgIcon(name,
  size?)` (an unregistered name renders `??`, as before, and warns once) and
  `registerBuiltInIcons()`. `BuiltInIconName` is the 49 names as a union (not `keyof typeof` the
  map: TypeDoc then documents the names, and warned about the undocumented map), and the name →
  SVG map `BUILT_IN_ICONS` `satisfies Record<BuiltInIconName, string>`, so a name missing from
  either fails `tsc`. Only `registerBuiltInIcons` reads the map, so a build without the call drops
  it. `SvgIconKey` is `BuiltInIconName | (string & {})`.
- **Changed from D12:** not one module per icon but one module of named re-exports,
  `core/UI/icons/BuiltInIcons.ts` (`export { default as gearIcon } from './svg/gear-fill.svg?raw'`,
  49 lines, each `<name>Icon`; the licence and the SVG form notes moved there). Each `?raw` file is
  its own module, so a build keeps the ones used either way; one file instead of 49, and
  re-exports need no doc comment (the Hub's coverage rule). All 49 are on `aekasha/ui`, so an app
  can register a single built-in.
- **Who registers:** no kernel code names an icon outside debug paths (`DraggableWindow` shows
  whatever `config.icon` its caller passes; the toaster's, the key bindings' and the views' icons
  are debug env), so the kernel registers none. **Changed from D12's "the debugger in its `_dbg__`
  init":** `InitEngine` calls `registerBuiltInIcons()` right after `addWindowListeners`, behind
  `IS_DEBUG_ENV || IS_PROD_TEST_MODE` (before any debug module loads; prod test mode shows the
  on-screen tools' icons). The names are spread over about 20 `_dbg__` modules and three debug
  wrappers, and one call before them all can't miss one. A production build folds the call and
  keeps no SVG. The app and the toolkit use no icons today.
- `core/Debug/CLAUDE.md` (drawer tabs) says how an `icon` resolves.
- Bundle: `index.js` 410.8 → 400.3 kB gzip (−10.6 kB), its modules 215 → 166; main `core/UI`
  25.7 → 7.8 kB gzip (52 → 3 modules). `api.json`: the 49 icons and the three registry names on
  `aekasha/ui`; `docs.json`: `core/UI/icons` 1 / 2 → 6 / 6 documented. The production debug
  check: none.
- **For Phase 10:** the UI pages (the registry, the built-ins, `aekasha/ui`), and the migration
  guide: an app's own `icon` (a draggable window's, a debug tab's or a view's) shows `??` in a
  production build until the app registers it (the debug env has every built-in).
- Checks: in the browser (dev server, a Playwright script): `?isDebug=true` with the drawer open,
  32 icons, all with their SVG; `?isProdTest=true`, 3; no `??`, no "No icon" warning, no error.
  `yarn verify:scenes` 96 passed (hashes, snapshots, the system order). `yarn test` 245 passed,
  lint, `tsc` (both projects), `yarn hub:build`; `verify:baselines` recorded.

**As built (section 3):**

- **`GLTFLoader`** (`Import/GLTFSource.ts`): the shared loader is created after
  `import('three/addons/loaders/GLTFLoader.js')` on the first `loadGLTF` (a parallel first call
  keeps the one created first). It takes `BufferGeometryUtils` and `SkeletonUtils` (its imports)
  and three's `three.module.js` (`GLTFLoader` imports `three`, not `three/webgpu`) out of main.
- **`DRACOLoader`, further than D14:** not on the first GLTF load but on the first file that uses
  `KHR_draco_mesh_compression`, like meshopt and KTX2 already were: `getGLTFDecoderNeeds` has
  `draco`, and `setGLTFDecoders` sets the DRACO loader per parse when given (the worker ignores the
  new need: its job module creates its own). `DracoDecoder.ts`' internal `getDracoLoader` is
  `getDracoLoaderAsync` (the module import, then one shared loader; re-checked after the await).
  `getDracoWorkerSettings` no longer creates the loader to learn the decoder: the loader's while it
  exists, else the config's (`getConfiguredDecoder`), the same values. Since the GLTF loader gets
  the current DRACO loader per parse, `disposeDracoLoader`'s old caveat (a GLTF loader keeping the
  disposed one) is gone from its JSDoc.
- **`HDRLoader`** (`Texture.ts`): imported with the first `.hdr` (`importHDRLoader`). The async
  main-thread path awaits it. **The sync path** (`createTexture`, behind `loadTexture`) returns a
  `DataTexture` at once, as `HDRLoader.load` did, and copies onto it what the loader sets once the
  file is in (`applyLoadedHDRTexture`: the image, wraps, filters, anisotropy, colour space, flipY,
  type, generateMipmaps, `needsUpdate`; three r186's `_applyTexData` with HDRLoader's parse
  result), so `texOpts`' format and mapping survive as before. Checked in the browser against
  `HDRLoader`'s own result for the same file: every field the same, the mapping kept, one
  `needsUpdate`, no error.
- The worker's loaders were already lazy (Phase 7's job modules); `debug/3DSymbols.ts`' static
  `GLTFLoader` folds out of production with its wrapper.
- Bundle: `index.js` 400.3 → 382.3 kB gzip (−18.0 kB), modules 166 → 160; main `three` 665.2 →
  626.8 kB (12 → 6 modules). New lazy chunks: `GLTFLoader.js` 13.2 kB (with `SkeletonUtils`),
  `DRACOLoader.js` 3.0 kB, `BufferGeometryUtils.js` 2.2 kB (shared with the lazy scenes and
  `MeshColliderGeometry`), `HDRLoader.js` 1.6 kB, and a second `three.module.js` (0.2 kB, the
  `three` entry's own module; the first is the worker's). `api.json`: `getDracoLoader` →
  `getDracoLoaderAsync` (internal). The production debug check: none.
- Checks: imports load on the main thread by default (`assets.workerTarget`), so the scenes cover
  the lazy paths (the imported models, the toolkit's Draco Æ in `exampleToolkit`, `scene01_v2`'s
  `.hdr` sky box). `yarn verify:scenes` 96 passed on the dev server; against a
  `VITE_APP_ENV=test` build under `vite preview` (`workerMsg`, `mainThread`, `prodTest`, where the
  loaders are their own chunks) 60 passed, the 12 failures the four `isDebugScene` scenes (as
  before). `yarn test` 245 passed, lint, `tsc` (both projects) and `yarn hub:build` (in
  `build:test`); `verify:baselines` recorded.

**As built (section 4):**

- **The gatherer** writes `tslMaterialFileObjects` and `postFxFileObjects` as
  `{ id: () => import('…tsl.ts') }` (no namespace imports any more; its `toUniqueJsIdentifier`
  import went, the util stays public). `AppData.tslMaterialFiles` / `postFxFiles` are
  `Record<string, () => Promise<Record<string, unknown>>>`; the generated `index.ts` type-checks
  against them as it is. **Lost:** the generated file named each JSON `nodes` socket
  (`colorNode: ns.colorNode`), so `tsc` failed on a socket its file doesn't export; now
  `createMaterial` warns at runtime ("Could not locate node"), as it already did for a socket the
  JSON didn't list.
- **Materials** (`Material.ts`): `loadTslMaterialFileAsync(materialId)` (on `aekasha`; resolves
  false when the app's data has no file for the id) fills a module cache that `createMaterial`
  reads synchronously as before. A TSL material whose file the data has but nobody loaded throws
  naming `loadTslMaterialFileAsync`; the old error stays for an id without a file. The dead
  `=== ''` branch went (`existsOrThrow` throws on `''`). `loadNextSceneAssets` loads the scene's
  TSL materials' files in the same `Promise.all` as its textures and imports (D11's "with its
  other assets"); a failed file fails the load, as `createMaterial` would have.
- **PostFX** (`PostFX.ts`): `loadScenePostFxFilesAsync(sceneId)` (internal) loads the files of the
  scene options' `postFx` entries into its own cache, which `resolvePostFxPass` reads. **Where,
  changed from D11's "the scene loader":** `postFx()`'s `created` hook awaits it before
  `buildPostFxForScene`: the kernel's loader can't import the feature, and the chain is known only
  once the scene code has run (it can set the options). A file that fails is logged and its pass
  left out, as a pass without a file is. Frames during the wait render without PostFX, as they
  already did from the `exit` hook's dispose to the build.
- **The material editor** loads the selected material's TSL file with its textures; a failed file
  shows as the load's error (the existing toast and drawer status). Its "not in this build" check
  reads the loaders, unchanged.
- An edited `.tsl.ts` still has no HMR boundary, so the dev server reloads the page as before.
- Bundle: `index.js` 382.3 → 376.9 kB gzip (−5.4 kB), modules 160 → 151; main `toolkit` 12.9 →
  8.5 kB, `app` 13.5 → 12.5 kB, `three` 626.8 → 616.9 kB (`GTAONode` and `BloomNode` go with the
  two PostFX files). New lazy chunks: one per TSL / PostFX file (`ambientOcclusion.tsl.js` 2.7 kB,
  `heroBloom.tsl.js` 2.0 kB, `triplanarGrid.tsl.js` 1.1 kB, `asteroid.tsl.js` 0.8 kB,
  `triplanarCheckerboard.tsl.js` 0.6 kB, `testTslMat.tsl.js` 0.2 kB) and the shared
  `triplanarProjection.js` (0.8 kB). `api.json`: `loadTslMaterialFileAsync` (public),
  `loadScenePostFxFilesAsync` (internal). The production debug check: none.
- **For Phase 10:** the migration guide's `loadTslMaterialFileAsync` (a TSL material created
  outside a scene load); root `CLAUDE.md`'s data pipeline names the generated loaders.
- Checks: `yarn verify:scenes` 96 passed on the dev server; against a `VITE_APP_ENV=test` build
  under `vite preview` (`workerMsg`, `mainThread`, `prodTest`, each TSL and PostFX file its own
  chunk) 60 passed, the 12 failures the four `isDebugScene` scenes (as before). The scenes cover
  the TSL materials (`sceneTestECS`, `space`, the gym, `topDownTest`, the examples) and both PostFX
  passes (`largeWorld`, the gym, `topDownTest`, `exampleHubHero`). In the browser (dev server):
  the material editor restored on each of the four TSL materials, no failed load, no error, the
  grid's lines drawn; touching `testTslMat.tsl.ts` reloaded the page. `yarn test` 245 passed (the
  new `@example` included), lint, `tsc` (both projects) and `yarn hub:build` (in `build:test`);
  `verify:baselines` recorded.

### Phase 9: the manifest and the feature schemas — done

1. The composed scene and mesh schemas; the three feature schemas move next to their features,
   their entries export them, `aekasha/schemas` re-exports them (D10). `.schemas/` unchanged.
2. The manifest in the generated data, `InitEngine`'s check, a unit test for both.

**As built (section 1):**

- **The parts:** `schemas/featureSchemas.ts` (kernel): the public type `FeatureSchemaPart`
  (`{ feature, scene?, mesh? }`: Zod shapes) and internal `mergeFeatureSchemaShapes` (the kernel's
  fields, then each part's in part order; a field two parts give, or one the kernel has, throws
  naming both owners) and `FeatureSchemaShape` (the parts' fields as one shape type). Each part
  sits next to its feature: `skyBoxSchemaPart` (`skyboxes`, in `SkyBox/SkyBoxSchema.ts`),
  `lodSchemaPart` (scene `impostors`, mesh `lod`, in `Lod/LodSchema.ts`), `postFxSchemaPart`
  (`postFx`, `postFxEnabled`, `PostFX/PostFXSchema.ts`) and `spatialSchemaPart` (`spatialDomains`,
  `Spatial/SpatialSchema.ts`). **Changed from D10:** no `asset` member: the gatherer's per-type
  passes (`*.skybox.json`, `*.impostor.json`, `*.postFx.json`) are code, so a part listing its
  asset type would change nothing; the gatherer imports those schemas from their new files.
- **The composition:** `sceneSchema.ts` and `meshSchema.ts` hold the kernel's fields and export
  `createSceneAssetSchema(parts)` / `createMeshAssetSchema(parts)` (public, typed by the parts:
  `const` type parameter), which replace the `SceneAssetSchema` / `MeshAssetSchema` values on
  `aekasha/schemas` (no reader besides the gatherer). A part's fields are allowed in the save
  entries too (a mesh's before `__meta`, where they were). `SceneAsset` / `MeshAsset` are the
  kernel's fields now (the debug tools read only those). `featureSchemas.test.ts` (5 tests).
- **The gatherer** composes them in `devTools/engineSchemas.ts`: `ENGINE_SCHEMA_PARTS` (sky box,
  PostFX, spatial, LOD: the JSON Schemas' property order before p607, not the install order),
  `SceneAssetSchema`, `MeshAssetSchema` and their types, imported from the `aekasha/schemas` entry
  file. **`.schemas/` is byte-identical**, and so is `src/generated/generatedAppData.json`
  (development and production gathers, before and after).
- **The moves:** `skyBoxSchema.ts` → `core/SkyBox/SkyBoxSchema.ts`, `lodSchema.ts` →
  `core/Lod/LodSchema.ts`, `impostorSchema.ts` → `core/Lod/Impostors/ImpostorSchema.ts`
  (PascalCase, the coding standard's; the folder rules map them). `postFxSchema.ts` and
  `spatialDomainSchema.ts` stay in `schemas/` (no feature imports; the kernel reads their types),
  and so does `lodChainSchema.ts` (the kernel's import option `lodChain`, which warns without
  `lod()`, Phase 7).
- **Changed from D10 (asked, 2026-10-12): the moved schemas stay on `aekasha/schemas` only**, not
  on their feature entries too: no name is in two entries, and `migrateToEntries`' rules treat a
  name two entries export as an error. The parts are on `aekasha/schemas` with them.
- **The layout report:** "schemas → feature" is gone (3 runtime, 1 type). `moveMap.ts` skips the
  layer rules for an entry file (an entry re-exports its names from wherever the code is; only
  `aekasha/schemas` had such rows). Kernel → feature gains one type row (`Scene.ts`'
  `ImpostorDef`, a `schemas/` import before; D6). **For p608:** `entryExports.json` files an
  export under its folder's entry, so the moved schema names show under `aekasha/skybox` /
  `aekasha/lod` there while `aekasha/schemas` exports them.
- The 20 undocumented exports the moved files carried (the sky box layers' schemas, the impostor
  asset schemas) got their summaries, so the docs ratchet passes without `--allow-docs-drop`.
- Nested `CLAUDE.md`s (`SkyBox/`, `Lod/`, `Lod/Impostors/`) name the new files.
- Checks: `yarn test` 250 passed (the new `@example` included), lint, `tsc` (both projects),
  `yarn hub:build`, `moveMap.ts` regenerated. `verify:baselines`: `bundle.json` unchanged (no
  runtime code moved: the runtime imports these files' types only), `api.json` (the moves, the
  two factories and the four parts on `aekasha/schemas`, `SceneAssetSchema` / `MeshAssetSchema`
  and the unread `SceneOverrides`, `MeshOverrides`, `MeshPropsSchema` gone) and `docs.json`
  recorded; the production debug check: none. No `verify:scenes` run: the generated data is
  byte-identical; section 2 (the boot check) runs it for the phase.

**As built (section 2):**

- **The manifest:** each gathered scene gets `__features` (`string[]`, development and
  production), from `getSceneFeatureIds(scene, parts = ENGINE_SCHEMA_PARTS)` in
  `devTools/engineSchemas.ts`: a part's feature when the resolved scene uses one of its `scene`
  fields, or one of its meshes (`{ props }`, after the save entry's merge) one of its `mesh`
  fields; "uses" is given and not an empty list. In part order. Always written, `[]` included: a
  scene without the key is data from before the manifest, which the check skips. `SceneData`
  documents it. Only data counts: a sky box or LOD made in scene code isn't in it (the template's
  `exampleLod` is `['skybox']`: its levels are code). Today's 24 scenes: 11 list `skybox`, 4
  `postfx`, 2 `lod` (`largeWorld`, `lodShowcase`), 1 `spatial` (`largeWorld`), 12 none.
- **The check:** `checkSceneFeatures(scenes, features)` (`core/Features.ts`, internal), which
  `InitEngine` calls right after `checkFeatures`, before `setAppData` and anything boots (D10's
  "against the installed features": the list is what installs, so it fails before an install
  instead of after). Every scene, loaded or not, every environment; one error naming each scene
  and missing feature, with the engine feature's factory and entry (`skyBox() from
  'aekasha/skybox'`), and "List it, or take its fields out of the scene's data."
- Tests: `Features.test.ts` (3: passes, names each scene / feature / factory, skips a scene
  without a manifest), `devTools/engineSchemas.test.ts` (6: kernel-only, each scene field in
  part order, a mesh field, empty lists, given parts, the engine parts' fields).
- **For Phase 10:** root `CLAUDE.md`'s data pipeline (step 3: `__features`; step 2: the composed
  scene and mesh schemas, `devTools/engineSchemas.ts`) and Bootstrap flow (the scene check after
  the feature check), the Hub's data pipeline / scene JSON pages (the manifest and the boot
  error), the migration guide (a scene whose data uses a feature the app leaves out now fails
  the boot).
- Checks: `yarn verify:scenes` 96 passed (24 scenes × 4 configurations, WebGPU, macOS): hashes,
  snapshots and the system order unchanged, so every scene's manifest passes the template's list.
  `yarn test` 259 passed, lint, `tsc` (both projects). Baselines recorded: `bundle.json`
  (`index.js` +0.4 kB gzip, the check; `EngineRapier.js`' ±0.1 kB is the two same-named chunks
  paired the other way round, as in Phase 7), `api.json` (`checkSceneFeatures`, internal),
  `docs.json`. The production debug check: none.

### Phase 10: Hub, CLAUDE.md, readme, migration guide — done

1. Hub: each feature page's `features` line; the ECS guide and walkthrough (`appECSPlugins`); the
   Quick start's "How the app starts"; the icons (UI pages); the migration guide's "Engine 4 → 5":
   `features`, `appECSPlugins`, icons, `loadTslMaterialFileAsync`. `yarn hub:build`.
2. Root `CLAUDE.md` (Bootstrap flow, ECS core's plugin registration, Build config: the define and
   `sideEffects`, Coding standards' "no module-level side effects" names the test), the nested
   ones the phases touched, `readme.md` (`InitEngine`'s example, a "Smallest build" line).
3. p608, p611, p612 and p510's stubs: what this plan did and left.

**As built:**

- **The Hub (section 1):** each feature page's guide starts with "Installing it" (the factory, its
  entry, what happens without it; PostFX's is in Rendering's "Post effects", instancing's in the LOD
  page). The ECS guide has a "Features" section (the kernel, list order, `requires`, `onDebug`, no
  registration at load) and "Plugins and hooks" shows `appECSPlugins`; the ECS walkthrough's step
  4, the toolkit pages, the Quick start's "How the app starts" (a `features` bullet and the boot
  check) follow. Scenes and assets: the lazy TSL / PostFX loaders and "The feature manifest" (the
  boot error quoted). The Documentation page's entries table names the factories and `aekasha/ui`'s
  icons. The coding standards' "Smallest build" names `sideEffects`, `moduleSideEffects.test.ts` and
  the debug fold. The migration guide: `features` in the `src/index.ts` diff, the `__AEK_DEBUG__`
  define in "Before you start", and new sections Features, Your ECS plugins are a feature (with the
  `sideEffects` trap for a bare `import './AppECSPlugins'`), Icons, TSL files load with their
  scene, and Scene and mesh schemas (`SceneAssetSchema` / `MeshAssetSchema` were public).
- **Changed from step 1: no UI pages exist,** so the icon registry is a section of the debug suite
  guide (tabs, views and windows take an `icon`) and a row of the entries table. `lines()` has no
  feature page either: it's in the factory lists.
- **Prettier and shiki's notation:** Prettier moves a trailing `// [!code ++]` onto its own line in
  a code block that parses, which shifts what it marks; the migration guide uses range markers on
  their own line (`// [!code --:4]`), which it leaves alone.
- **Root `CLAUDE.md` (section 2):** a new Architecture section, **Engine features** (the contract,
  the context's seams, install order as system order, the production traps, what happens without a
  feature, the assets worker's job modules), covered by the ECS page's `aek:covers`; the Bootstrap
  flow in the code's order; ECS core's plugin registration; the data pipeline's composed schemas,
  generated loaders and manifest; Physics (`physics()`, the driver's latch, the scene hooks); Debug
  system and Build config (`__AEK_DEBUG__`); the `yarn test` and move map lines; Coding standards'
  "Smallest build". `devTools/verify/CLAUDE.md`'s `NOT_YET_INSTALLED` sentence; `SkyBox/CLAUDE.md`
  names `skyBox()` (the other features' nested files already did).
- **`readme.md`:** "Boot the engine" lists `[physics(), skyBox(), postFx(), appECSPlugins]`
  (example 2's scene has `skyboxes`), example 5's plugin is `appECSPlugins`, a "Feature modules"
  bullet, the icon registry, a "Smallest build" highlight row (its numbers left to the changelog,
  Phase 11) and the `__AEK_DEBUG__` fold in "Tree-shaking".
- **The stubs (section 3):** a "From p607" section each: p608 (the new files' move rules,
  `LodFade.ts` mapped not moved, the hard-coded debug paths in `debugInProduction.ts`,
  `moduleSideEffects.test.ts` and `eslint.config.js`, merging a wrapper keeps it foldable, the
  layout report, `entryExports.json`'s schema entries, the system order), p611 (the main chunk's
  numbers by group, what `yarn sbp` can read, the banner profile's `features: []`, the manifest
  fold, a `physics()` option, an icon budget), p612 (D6's 22 type-only imports by kind, init, the
  `onDebug` closures not measured, the loop seams, factory options), p510 (the `?worker` /
  Rapier `import()`s, installs, `FixedStepDriver`; left: the SCSS import, `InitEngine`'s DOM work,
  the kernel's render systems).
- **`moveMap.ts --check` was stale** (Phase 9's new test file, the names Phases 8-9 added, and the
  paths this phase's CLAUDE.md and Hub text name): regenerated.
- Checks: `yarn hub:build` passes (305 pages; the search index 1.07 MB, was 1.04 MB: the warning
  stays; `{@link LodTarget}` at `LodSystem.ts:989` links nowhere, from Phase 6's move, left for
  p616), the CLAUDE.md coverage check, `moveMap.ts --check`, Prettier on the edited files.

### Phase 11: changelog and mark done — done

`CHANGELOG.md`'s `stage-b` entry gains this plan (Engine, Toolkit if touched, App, Project) with
the main chunk's before / after from `bundle.json`; no new version bump (D5 of p606: the majors
are `stage-b`'s); `yarn checkVersions --against main`; mark the plan done. Then the PR into
`stage-b`, and `stage-b`'s PR into `main`.

**As built** (section 1: the changelog; section 2: the version check and marking the plan done):

- **`CHANGELOG.md`'s `## 2026-10-11 — stage-b`** gains this plan in all four parts. The main chunk's
  before / after is `bundle.json` at `996d9b4` (p606's end) against Phase 10's: `index.js` 1251.3 →
  377.2 kB gzip (3778 → 1396 kB minified), 222 → 151 modules, the modules' gzip sum 1738.4 → 817.7
  kB, with the groups that changed; `dist/`'s JavaScript 2703 → 1629 kB gzip, one Rapier chunk, no
  `_dbg__` chunk (57 before) and no `tweakpane.js`. The baseline tool's `kB` is 1024 bytes, and so
  are the entry's.
- **p606's lines the merged entry would contradict are rewritten, not added to:** `InitEngine`'s
  signature and `import './AppECSPlugins'` (Engine and App), "The bundle is the same size" (now the
  before / after, keeping p606's moved groups), the entries' side-effect line and the Project
  aliases bullet (`treeshake.moduleSideEffects` → `package.json`'s `sideEffects`, a bullet of its
  own), and the Hub's search index (1.01 → 1.07 MB).
- **Toolkit:** its only change is `registerFollowObjectCameraRigSystem`'s JSDoc; the entry adds that
  and the TSL materials becoming lazy chunks (the gatherer's doing). The date stays: it becomes
  `stage-b`'s merge's (p600's table).
- No version bump (p606 D5); `yarn checkVersions --against main` passes (Engine 5.0.0, Toolkit
  2.0.0, App 1.10.0).
- **Marked done** as p606 was: `p600` (`Blocks` and the Stage B table) and `_DONE_p606` (`Blocks`)
  renamed; the `Blocked by` on p608, p611 and p510 dropped, with a `Related` line each instead; p612
  gets one too (it has a "From p607" section). No `CLAUDE.md`, Hub page or `devTools/` file names the
  file. Root `CLAUDE.md`, the nested ones and `readme.md` were Phase 10's.
- **§6 holds:** no Rapier in the main chunk (Phase 2), the allow-list empty (Phase 6, kept by Phase
  7), no debug code in the production build (Phase 3's check, none since), the runner passing in all
  three targets with the system order recorded (every phase; the one change, Phase 6's
  `instancedMeshPoolSync`, re-recorded), "Kernel → feature" with no runtime or dynamic rows (Phase 7).

## 6. Done when

- The main chunk holds no Rapier in `WORKER_THREAD` mode; the main chunk's before / after is in the
  changelog.
- The module-level side effects test has an empty allow-list.
- The production build has no `_dbg__` chunk and no debug wrapper in main (`verify:baselines`).
- p601's runner passes in all three physics targets, with the system order unchanged.
- The layout report's "Kernel → feature" has no runtime or dynamic imports.

## 7. Risks

1. **System order.** Moving registrations from import time to install time changes when ties
   resolve. Phase 1's recorded order catches it per phase; the fix is the install order.
2. **Scene load order.** A hook at a slightly different place than today's call (lines, D4) can
   change a hash. The runner catches it in every target.
3. **The debug drawer's tab order** follows the debug registrations, which move into `onDebug`
   hooks in install order. Checked by hand in Phases 5-7 against today's.
4. **`sideEffects` and the entries' `moduleSideEffects`** may interact (D13): a module dropped by
   mistake shows in the bundle diff and as a failing scene.
5. **The dev server doesn't tree-shake:** importing an entry still loads every module it
   re-exports, but with no module-level registration that no longer changes behaviour.
