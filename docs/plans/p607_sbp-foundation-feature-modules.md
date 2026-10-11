Status: in progress | Phases 1-2 implemented
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

### Phase 3: `__AEK_DEBUG__`

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
    `loadDebugModuleAsync` there kept its argument. Fixed with `if (__AEK_DEBUG__ && IS_DEBUG_ENV)`:
    a literal folds from the first pass. App code in `start` that gates a debug `import()` needs
    the same (Phase 10's Hub text says so).
  - Rollup keeps the `register*` wrappers' declarations (never called) and the empty
    `if (IS_DEBUG_ENV) ;` shells; the minifier removes most of it.
- Bundle after step 1: no `_dbg__` chunk and no `tweakpane.js` in `dist/`; `index.js` 430.5 →
  402.2 kB gzip (−28.3 kB: `three` −9.0, `_engine/core` −12.2, `debug` −5.4); gone with their only
  non-debug importer: `Snapshot`, `OrbitControls`, `DevFiles`, `DialogWindow`, `ECSStressTest`.
  Three lazy chunks grew by taking in chunks that existed only because debug code shared them:
  `physicsTiers` +4.0 kB (`PhysicsTierPolicy`), `InstancedMeshPool` +5.7 kB (`ImpostorBake`,
  `OctahedralImpostor`), `generateFoliage` +2.1 kB (`CrossQuads`). The 14 `debug/*.ts` wrappers are still in main (2.1 kB
  gzip), as hollow shells.

### Phase 4: the install contract and the kernel

1. `core/Features.ts`: the types, `FeatureContext` (the ECS members and `onDebug*` now; the seams
   come with their features), the install runner, `requires` checks.
2. `InitEngine({ features })` (optional, §4.1). The kernel's registrations move into
   `installKernel` (§4.2).
3. The app's plugins become `appECSPlugins` (D9); `exampleHud.ts` and `scene01.ts` lose their
   top-level statements; the Hub region `ecs-register-plugin` moves with the code.
4. The allow-list loses the kernel's and the app's entries; the system order is unchanged.

### Phase 5: physics and character

1. The seams these need: `addSceneHooks` (D4: all phases), `setFixedStepDriver` (D5).
2. `physics()`: boot (`initPhysics`, the first world), the manager, tiers, tier policy, the
   transform reset listener, the scene hooks, the fixed-step driver, its debug GUIs and the
   determinism probe. `character()` with `requires: ['physics']`.
3. `SceneLoader.ts`, `MainLoop.ts` and `InitApp.ts` stop importing physics and characters.
4. Hashes in all three targets, with and without the probe; `physicsTiers` in all three.

### Phase 6: sky box, spatial, LOD, instancing

1. `skyBox()` (the scene data hooks, `retainedTextures`), `spatial()` (light culling, the domain
   hooks), `lod()`, `instancing()`.
2. The kernel registries for LOD targets and spatial radii; `getConservativeGeometryRadius` moves
   (D5). The layout report's feature dependencies: character → physics only.

### Phase 7: lines, PostFX, viewports, import; `features` required

1. `lines()` (D3), `postFx()` (`setRenderPipeline`; `Snapshot.ts` reads the seam), `viewports()`
   (`addAfterRender`).
2. The import extensions (physics, LOD) and the assets worker's job modules (D5).
3. `features` required; `InitEngine` installs nothing on its own. The allow-list is empty.
4. The layout report's "Kernel → feature" has no runtime or dynamic rows.

### Phase 8: the SBP packaging

1. `sideEffects` (D13), measured against the entries' `moduleSideEffects`.
2. The icon registry (D12).
3. Loaders where used (D14).
4. Lazy TSL material and PostFX maps (D11): the gatherer, `AppData`'s types, the scene loader's
   preload, the material editor.

### Phase 9: the manifest and the feature schemas

1. The composed scene and mesh schemas; the three feature schemas move next to their features,
   their entries export them, `aekasha/schemas` re-exports them (D10). `.schemas/` unchanged.
2. The manifest in the generated data, `InitEngine`'s check, a unit test for both.

### Phase 10: Hub, CLAUDE.md, readme, migration guide

1. Hub: each feature page's `features` line; the ECS guide and walkthrough (`appECSPlugins`); the
   Quick start's "How the app starts"; the icons (UI pages); the migration guide's "Engine 4 → 5":
   `features`, `appECSPlugins`, icons, `loadTslMaterialFileAsync`. `yarn hub:build`.
2. Root `CLAUDE.md` (Bootstrap flow, ECS core's plugin registration, Build config: the define and
   `sideEffects`, Coding standards' "no module-level side effects" names the test), the nested
   ones the phases touched, `readme.md` (`InitEngine`'s example, a "Smallest build" line).
3. p608, p611, p612 and p510's stubs: what this plan did and left.

### Phase 11: changelog and mark done

`CHANGELOG.md`'s `stage-b` entry gains this plan (Engine, Toolkit if touched, App, Project) with
the main chunk's before / after from `bundle.json`; no new version bump (D5 of p606: the majors
are `stage-b`'s); `yarn checkVersions --against main`; mark the plan done. Then the PR into
`stage-b`, and `stage-b`'s PR into `main`.

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
