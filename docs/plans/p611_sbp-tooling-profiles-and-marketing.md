Status: in progress | Phases 1-3 implemented
Category: Build, Dev tooling, Engine API, Marketing
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p607_sbp-foundation-feature-modules.md (the feature modules, the manifest, `sideEffects`), \_DONE_p601_refactoring-safety-net-tests-and-baselines.md (`bundle.json`), p612 (init / config), p613 (renderer), p617 (input): see §6

# SBP Tooling, Profiles and Marketing

**Branch:** `sbp-tooling-profiles-and-marketing`, from `main` at `711c720` (p610 merged), into
`main` (p600's Branches and PRs).

## 1. Goal

Make the Smallest Build Possible visible and enforced (p600 §4.3), prove it with a minimal
profile, make that profile **embeddable in any web page with one call**, and tell the world.

- **`yarn sbp`:** builds, then reports each feature's size, why each feature is in the bundle (the
  import chain from the entry), and the diff against the committed baseline. Budgets per profile,
  group and chunk; over budget fails `yarn build`, as the asset pipeline's budgets do.
- **Embedding (added in review, 2026-10-13):** `mountAekasha({ target, sceneId, width, height,
  … })` mounts the engine into an element of a page it doesn't own (a site background, a banner, a
  product view) and returns a handle to load scenes, pause and unmount. A profile builds as an ES
  module a site imports.
- **The banner profile:** one small scene, `features: []`, no debug, built as an embed. Its gzip
  size is the measured floor, and the Hub runs it live on the SBP feature page.
- **The lite-renderer study** (p600 §4.4): what a profile on three's classic `WebGLRenderer` without
  TSL would cost and save. A recommendation, not an implementation.
- **Marketing:** SBP as a core principle in the readme's "Why Ækasha?", the Hub homepage's featured
  features, a Hub feature page with the real numbers and the live embed, and the brand section in
  CLAUDE.md.

## 2. Grounding (checked against the code, 2026-10-13)

### 2.1 The bundle today (`devTools/verify/baselines/bundle.json`, last written by p610)

- **Main chunk** `assets/index.js`: 1448 kB, **394.3 kB gzip** (p607 ended at 376.9 kB; p610 added
  the input action layer and the character split). Its rendered modules: 165, 850.6 kB gzip summed.
- **By group** (gzip sum of the rendered modules): `three` 631.7 kB (4 modules: `three.webgpu.js`
  432.8 kB, `three.core.js` 193.8 kB, `three.tsl.js` 4.0 kB, …), `features/physics` 34.8 kB
  (`PhysicsAPI.ts` alone 15.4 kB, `PhysicsTierPolicy.ts` 3.8 kB), `features/skybox` 27.4 kB,
  `kernel/assets` 26.0 kB, `app` 14.1 kB (`src/generated/generatedAppData.json` 10.4 kB of it),
  `kernel/ecs` 14.1 kB, `ui` 13.4 kB (`DraggableWindow.ts` 7.4 kB, `CMP.ts` 4.8 kB),
  `kernel/input` 11.5 kB, `toolkit` 9.1 kB, `features/lines` 9.0 kB, `features/spatial` 8.6 kB,
  `features/lod` 7.9 kB, then everything else under 7 kB.
- **The stub's group names are gone:** p608 renamed `_engine/core`, `core/SkyBox`, `core/Physics`
  into `_engine/kernel/<area>` and `_engine/features/<name>` (`getModuleGroup` in `baselines.ts`),
  so p607's per-group numbers don't compare with today's (`PhysicsAPI.ts` was in the
  `_engine/core` lump then).
- **Lazy:** `rapier.js` 829.6 kB gzip (one chunk, worker and main thread), the loaders
  (`GLTFLoader.js` 13.6 kB, `KTX2Loader.js` 24.4 kB, `DRACOLoader.js` 3.1 kB, `HDRLoader.js`
  1.6 kB), each TSL material and PostFX file, each scene, the assets worker's jobs.

### 2.2 Found while grounding

- **Debug assets ship in a production `dist/`:** `3DSymbols.glb` (108.8 kB gzip) and
  `3DSymbolsTextures.png` (5.7 kB) are in `dist/assets/`. `debug/symbols/3DSymbols.ts` imports
  them as `?url`; the module has no rendered code in production (folded), but Vite emits an asset
  when it transforms its importer, before tree-shaking. Never loaded, but deployed. The production
  debug check (`debugInProduction.ts`) looks at chunk names and rendered modules only, so it
  doesn't see them.
- **The import graph is already measured:** the visualizer's data (`dist-stats/bundle-stats.html`)
  has `imported` / `importedBy` per module (`{ uid, dynamic }`), so the "why" chain needs no new
  Rollup plugin.
- **The template app's main chunk carries every scene's data** (`generatedAppData.json`, the
  production gather) and the shared UI kit, whatever the start scene uses.

### 2.3 What the engine assumes about the page (the embed's blockers)

The engine assumes it owns the whole page:

- **Fixed element ids:** `createRenderer` appends to `#mainCanvas` and looks up
  `#AEK_CANVAS_ELEM` (`kernel/render/Renderer.ts:13-14`, `:103`, `:112`); the HUD needs
  `#hudRoot` or `#guiContainer` (`ui/HUD.ts:15`). `src/index.html` provides them.
- **Window size:** `getWindowSize()` (`ui/Window.ts:5`, `window.innerWidth` / `innerHeight`) sizes
  the renderer (`MainLoop.ts:550`, the `canvasResizer`), the cameras (`kernel/camera/Camera.ts`)
  and the windows; everything resizes on `window` `resize` (`MainLoop.ts:556`).
- **Page-wide input:** keyboard (`KeyboardInput.ts:259`), mouse and wheel and `contextmenu`
  (`MouseInput.ts:299-305`), touch (`TouchInput.ts:258-262`) and gamepad listen on `window`.
- **Page-wide styles:** `InitEngine.ts:20` imports `ui/styles/index.scss`, whose `normalize.scss`
  and rules on `html`, `body`, `*` and `#mainCanvas` would restyle a host page. `sideEffects`
  keeps every `.scss` import.
- **Asset URLs resolve against the page:** `AssetUrl.ts:20`, `KTX2.ts:10` and `DracoDecoder.ts:31`
  build `new URL(import.meta.env.BASE_URL + path, document.baseURI)`. In an embed,
  `document.baseURI` is the host page, so `aek-assets/`, `basis/` and `draco/` would load from the
  host's origin.
- **Workers:** `import('./worker/PhysicsWorker?worker')` and the assets worker. A module worker
  must be same-origin with the page, so an embed served from another origin (a CDN) can't start
  them without a blob wrapper. Without COOP/COEP on the host page there's no `SharedArrayBuffer`;
  physics already falls back to one message per frame.
- **One engine per page:** the engine's state is module-level singletons (the world, the
  renderer, the loop, the registries).
- **Env:** `Config.ts:589` reads `import.meta.env`; a build replaces it statically.
- **The app's chrome:** the scene loader's full-screen overlay is the app's (`src/index.ts`), not
  the engine's.

### 2.4 What `yarn sbp` can read (from p607, still true)

- Each gathered scene's `__features` (the features its data uses; scene code isn't in it) and
  `InitEngine`'s `features` (code in the entry, which the tool doesn't run).
- `bundle.json`'s chunks, main chunk and main groups; `collectBundle` and `getModuleGroup` in
  `devTools/verify/baselines.ts` produce them; `isGrowthToFlag` (`bundleGrowth.ts`) is the
  tolerance; `findDebugCodeInBuild` the production debug check.
- `features: []` installs the kernel alone (ECS, meshes, groups, cameras, lights, raycasting,
  input, scenes, frustum culling), and nothing registers on import.

## 3. Decisions

### D1. `yarn sbp` shares the bundle model with `verify:baselines`

`collectBundle`, `getModuleGroup`, `stripHash` and the visualizer parsing move out of
`baselines.ts` into `devTools/sbp/bundleModel.ts`; `verify:baselines` imports them (no copy).
`yarn sbp` adds what the baseline doesn't: profiles, the initial / lazy split, the feature view,
the "why" chains, and budgets. `verify:baselines` stays the owner of the committed baselines (one
place records them). **Recommended.**

### D2. Profiles in `sbp.config.ts` at the repo root

Next to `assets.config.json`. A profile is `{ id, entry, scenes, budgets }`:

- `app`: the template app (`src/index.html`, every scene), its budgets.
- `banner`: the embed entry (D7), its one scene, its budgets.

Budgets are gzip bytes: `initial` (what loads before the first frame: the entry chunk and its
static imports), per chunk, per group. Over a budget fails; under it by more than a margin is
reported (so budgets get tightened, never drift). **Recommended.**

### D3. Groups, features and "why"

The report's rows are the existing groups; a `_engine/features/<name>` group is that feature.
For each feature in the initial chunks, "why" is the shortest chain of **static** imports from the
entry to the feature's first module (BFS over `imported`, dynamic edges skipped), printed as
`src/index.ts → aekasha/physics (features/physics/index.ts) → PhysicsFeature.ts`.
`yarn sbp --why <group | module path>` prints the chains for anything. The scenes' manifests
(`__features`) are shown next to it: a feature in the bundle that no scene's data needs is marked
(code may still use it). **Recommended.**

### D4. `yarn build` runs it, skippable

`yarn build` runs `yarn sbp --no-build --profile app` on the build it just made (no second app
build) and builds and checks `banner` (a small build, seconds). `AEK_SBP=false` skips both, like
`AEK_HUB=false`. **Recommended.**

### D5. Debug assets: the check and the fix

`findDebugCodeInBuild` also fails on a `dist/assets/` file whose only importers are debug modules
(from the visualizer's `?url` metas). The fix moves `3DSymbols.ts`' `?url` imports behind its
`_dbg__` module's `import()`, so a production build never transforms them. **Recommended.**

### D6. `mountAekasha`: the embed API (on `aekasha`)

Named by the coding standards (a verb, options object), not `Aekasha()`:

```ts
const handle = await mountAekasha({
  config, data, features,          // as InitEngine; a profile's entry binds them (D7)
  target: '#hero',                 // an element or a selector; the canvas goes inside it
  sceneId: 'banner',               // default: the config's start scene
  width: '100%', height: '60vh',   // any CSS length, set on the container and measured
  layout: 'INLINE',                // or 'BACKGROUND': fixed, behind the page, no pointer events
  canvas: { id, className, style }, // the user's canvasId / canvasClass / canvasInlineStyles
  input: 'NONE',                   // 'NONE' | 'CANVAS' (pointer on the canvas, keys while focused)
  pauseWhenHidden: true,           // IntersectionObserver + the existing visibilitychange
  reducedMotion: 'RESPECT',        // prefers-reduced-motion: one frame, then paused
  fallbackImage: 'banner.webp',    // shown when neither WebGPU nor WebGL2 is available
  assetBaseUrl,                    // default: the profile entry's own URL (D7)
  renderer: { … },                 // createRenderer's options
});
handle.loadScene('other'); handle.pause(); handle.resume(); handle.unmount();
```

- **Sizes are CSS strings**, put on the container; a `ResizeObserver` on it sizes the canvas and
  the cameras, so px, %, rem, vw, vh and `calc()` all work without parsing.
- **Non-breaking:** `InitEngine` stays the full-page boot. The new seams default to today's
  behaviour: the canvas parent (`#mainCanvas`), the size source (the window), the HUD root, input
  on `window`, the page styles. The template app doesn't change, and `verify:scenes` must not
  either.
- **Page styles** (`html`, `body`, `*`, `normalize`) split from the component styles into
  `ui/styles/page.scss`, loaded only by the full-page boot; the embed loads only what its
  container needs. Whether the full-page boot keeps a static import (no flash) or an `import()` is
  measured in Phase 3.
- **`unmount`** stops the loop, removes the listeners, observers and the canvas, and disposes the
  renderer. **One engine per page:** a second `mountAekasha` while one is mounted throws; mounting
  again after `unmount` is supported only if Phase 3 shows the singletons reset cleanly, otherwise
  it throws too and the limit is documented.
- **No scene loader UI:** the container shows `fallbackImage` (or nothing) until the first frame.

**Recommended.** Overlaps p612 (init), p613 (renderer) and p617 (input): §6.

### D7. A profile builds as an embed module

A profile's entry is a TS module that binds the app's parts and exports the mount:

```ts
// src/app/profiles/banner/banner.embed.ts
export const mount = (opts: EmbedMountOptions) =>
  mountAekasha({ config, data: bannerData, features: [], assetBaseUrl: new URL('.', import.meta.url).href, ...opts });
```

A site uses it as `import { mount } from './aekasha/banner.embed.js'; mount({ target: '#hero' })`.

- **Build:** a separate `vite build` per profile into `dist-embed/<profile>/` (gitignored), with the
  JS entry as Rollup's `input`, `preserveEntrySignatures: 'exports-only'`, `base: './'`, ES
  chunks and workers as files. Not Vite's library mode: whether it keeps workers as files and
  splits chunks is unverified, and the app build already does both. Phase 4 checks it against
  library mode and keeps the one that works.
- **Data per profile:** the gatherer writes `src/generated/profiles/<id>/` holding only the
  profile's scenes (`sbp.config.ts`' `scenes`) and their scene, TSL material and PostFX loaders.
  So a one-scene embed doesn't ship 25 scenes' data, and `sceneId` picks among what it has.
- **Same origin first:** the embed's files are served from the site's own origin. Cross-origin
  hosting (a CDN, workers through a blob wrapper) is out of scope; a profile with workers says so.

**Recommended.**

### D8. The banner scene: code-made, no loaders

The floor is a profile without any loader: a scene whose geometry is made in code (a slowly
turning shape with a TSL material, one light, the camera, a transparent background so the page
shows through). The Æ symbol would cost `GLTFLoader` 13.6 kB, `DRACOLoader` 3.1 kB and the Draco
decoder 88.5 kB gzip: the Hub page can show it as a second number ("with a glTF model"), not the
floor. **Recommended.**

### D9. The Hub runs the banner live

The public Hub runs no engine today (`hub/CLAUDE.md`: a `::: scene` panel shows an image). The SBP
feature page is the exception:

- **A directive `::: embed <profile> [height]`** renders a container with the profile's Hub image as
  the poster and a small script that `import()`s the profile's embed module when the container
  scrolls into view (`IntersectionObserver`), then mounts it (`layout: 'INLINE'`, `input: 'NONE'`,
  `pauseWhenHidden`). Reduced motion keeps the poster with a play button. No WebGPU / WebGL2: the
  poster stays, with a line saying why.
- **`public`:** `yarn hub:build` copies `dist-embed/<profile>/` into `dist-hub/_assets/embed/<profile>/`
  (built first when missing; `--no-embed` skips the live part and keeps the poster), cached by
  `_headers` as the other `_assets/*`. **`dev`:** the page imports the profile's entry from the dev
  server (the Hub is served by it), so an edit shows without a build.
- **The numbers are generated:** the page's sizes come from the last `yarn sbp` report
  (`.cache/sbp/report.json`, committed as the banner's baseline, D1), through a `{{sbp:banner.initial}}`
  helper, so the page can't state a stale number.

**Recommended.**

### D10. What's left to studies, not code

From p607's "left to this plan":

- **Folding code paths from the manifest** (p600 §4.2's constants) and **a `physics()` option to
  leave the tiers and the tier policy out** (`PhysicsTiers.ts` 2.4 kB + `PhysicsTierPolicy.ts`
  3.8 kB gzip in main today) change engine APIs that
  p612 and p614 review. Phase 5 measures what each would save from the `yarn sbp` report and
  writes the recommendation into p612 / p614.
- **An icon budget** needs no code of its own: ~~`ui/icons` is a group~~ `modules` budgets on the
  built-in icons' files, at 0 (the built-ins register only in the debug env; Phase 2's As built).

**Recommended.**

## 4. Phases

Each phase leaves `main`'s behaviour as it was until the phase that changes it on purpose. Checks
for every phase: `yarn test`, lint, `tsc` (both projects), and for a phase that touches `src/`
`yarn verify:scenes` (record the scene baselines on `main` first) and `yarn verify:baselines`.

### Phase 1: `yarn sbp`, the report — done

1. `devTools/sbp/bundleModel.ts` (D1): the bundle collection moved out of `baselines.ts`, which
   imports it; `bundle.json` unchanged (`verify:baselines` passes with no diff).
2. The initial / lazy split: the entry chunk and its static imports (the manifest's `imports`),
   the rest lazy.
3. The feature view and the "why" chains (D3), with `--why`; the scenes' `__features` next to it.
4. The diff against `bundle.json` for the `app` profile (`isGrowthToFlag`).
5. `yarn sbp [--profile <id>] [--no-build] [--why <x>] [--json]`, its output into
   `.cache/sbp/progress.log` (the verify commands' pattern) and `.cache/sbp/report.json`.
6. Tests: the BFS and the split on a small synthetic visualizer graph (no build in a test).

As built:

- **The shared modules** (D1), in `devTools/sbp/`: `bundleModel.ts` (`collectBundle`,
  `getModuleGroup`, `stripHash`, `sortKeys`, the visualizer parsing, `keyFiles`; `collectBundle`
  also returns the manifest, the parsed visualizer data and each hashed file name → its key, and
  throws instead of exiting), `bundleDiff.ts` (`diffBundle`, `formatKB`, `readBundleBaseline`)
  and `appBuild.ts` (`runYarn`, `buildAppBundle`: `yarn build`'s bundle steps). `baselines.ts`
  imports all three; p608's `compareBaselines.ts` reads the visualizer through `bundleModel.ts`
  too. `bundle.json` unchanged.
- **The rest:** `bundleSplit.ts` (the split), `bundleWhy.ts` (the graph, the chains, `--why`),
  `bundleFeatures.ts` (the feature view, the scenes' `__features`), `report.ts` (the report and
  its text), `config.ts` (`SbpProfile`, `checkSbpProfiles`), the command `devTools/sbp.ts`
  (`yarn sbp`), and `testBuild.ts`, the tests' synthetic build (27 tests in `devTools/sbp/`).
- **`sbp.config.ts` exists already**, with the `app` profile alone (`{ id, entry, scenes? }`,
  `scenes` omitted = all) and no budgets: Phase 2 adds `budgets` to `SbpProfile`. It's in
  `tsconfig.json`'s `include`. `checkSbpProfiles` rejects any entry but `src/index.html` until
  Phase 4 builds embeds (`devTools/sbp.ts` calls `buildAppBundle` for the build).
- **The split:** initial is the entry chunk, its manifest `imports` (transitively) and their CSS;
  everything else in `dist/assets/` is lazy, including the worker chunks (which the manifest
  doesn't list) and the `?url` files (`3DSymbols.glb`, so Phase 2's debug asset check reads the
  visualizer's `?url` metas, not the split). `dist/index.html` isn't counted. A group's lazy size
  counts a module once per chunk (a worker's copy is downloaded again).
- **The chains:** each module's load is `initial`, `lazy` or `none` (no rendered code: tree-shaken,
  or an entry that only re-exports). `findBestImportChain` tries static chains through shipping
  modules (load not `none`, or an entry file) first, then with `import()`s, then through any
  module: the visualizer's graph is before tree-shaking, and the shortest chain to GLTFLoader went
  through the tree-shaken `3DSymbols.ts`. A feature's chain ends at its nearest module with
  initial code. Labels: an entry as `aekasha/physics (features/physics/index.ts)`, an engine
  module from `_engine/`, a module in the previous one's folder by its file, `⇢` for an
  `import()`; an HTML entry is left out.
- **`--why`** takes a group (`_engine/features/physics`, `features/physics`, `physics`,
  `kernel/assets`, `three`; one chain, to its nearest initial module) or a path (a module id's end,
  else any part; a chain each, up to 8), and prints only that. No match exits 1.
- **The scenes** come from `src/generated/generatedAppData.json` (a build ends with the dev
  gather) minus `isDebugScene` ones, which the production gather leaves out. Only the features
  with a schema part (sky box, PostFX, spatial, LOD) can be in a manifest, so only they can be
  flagged as needed by no scene's data; the others read "code only".
- **No failing yet:** the diff against `bundle.json` (the `app` profile only) is printed and
  recorded, never a failure; `verify:baselines` stays its gate. Errors exit 2.
- **Output:** `progressLog.ts` gained `setProgressLogFile` (`.cache/sbp/progress.log`) and
  `setProgressLogConsole` (`--json`: stdout carries only the report, errors still go to stderr).
  `.cache/sbp/report.json` is `{ formatVersion, profiles: { [id]: ProfileReport } }`
  (`ProfileReport`: `profile`, `initial` / `lazy` (`total`, `files`), `groups`, `features` with
  `why` as one line, `diff`); a run replaces its profile and keeps the others.
- **Units:** `formatKB` (shared with `verify:baselines`) divides by 1024, so the tools print KiB as
  "kB", while §2.1's numbers are decimal (394.3 kB = 385.1 KiB, the 850.6 kB sum = 830.7 KiB).
  Budgets are bytes, so Phase 2 isn't affected; Phase 6's page picks one unit and says which.
- **Today's report:** initial 387.7 KiB gzip (`index.js` 385.1, `index.css` 2.7), lazy 73 files
  1778.2 KiB; `3DSymbols.glb` (106.2 KiB) is the fourth largest lazy file; every feature is in the
  initial chunks only through `src/index.ts`'s import of its entry; `PhysicsTiers.ts` is in them
  through `aekasha/physics` (D10). LOD's chain ends at `LodChainGLTF.ts`, the assets worker's
  GLTF job, which has code in the main chunk: worth a look in Phase 5.
- **Docs wait for Phase 6** as planned (Commands, `devTools/sbp/CLAUDE.md`, `AEK_SBP`);
  `devTools/verify/CLAUDE.md` names the shared modules now.

### Phase 2: budgets, `yarn build`, debug assets — done

1. `sbp.config.ts` (D2) with the `app` profile's budgets, set from today's report plus a margin.
2. Over budget fails with the group or chunk, its size and the budget; well under is reported.
3. `yarn build` runs it (D4); `AEK_SBP=false` skips it.
4. The debug assets check and the `3DSymbols` fix (D5): `dist/assets/` loses 114.5 kB gzip;
   `bundle.json` updated with the change that explains it.

As built:

- **Budgets** (`SbpBudgets` in `devTools/sbp/config.ts`, `budgets?` on `SbpProfile`; gzip bytes,
  written `404 * KIB`): `initial` (the report's `initial.total`), `chunks` (a `bundle.json` key,
  initial or lazy), `groups` (a group's code in the initial chunks, before minification, as the
  report's groups) and `modules` (a file or a folder ending in `/` under `src/`, measured as the
  groups). A chunk budget without its file fails (`missing`); a group without initial code is 0.
  The `app` profile has 25: `initial` 404 KiB, 5 chunks, 17 groups (`three`, every feature, the
  kernel areas over 5 KiB, `ui`, `app`, `toolkit`; the `initial` budget covers the rest) and 2
  modules. Each is the size plus about 4% (at least 1 KiB), rounded up to a whole KiB
  (`suggestBudget`). "Well under" is more than 10% of the budget and more than 2 KiB
  (`isWellUnderBudget`), so a small budget's headroom isn't reported; the line suggests the
  tighter value.
- **D10's icon budget:** `ui/icons` isn't a group (`getModuleGroup` splits only `kernel/` and
  `features/`; the icons are in `_engine/ui`), and `SvgIcon.ts` (266 B) ships. So the `modules`
  budgets exist: `_engine/ui/icons/BuiltInIcons.ts` and `_engine/ui/icons/svg/` at 0.
- **The check** (`devTools/sbp/budgets.ts`): `checkBudgets` in `measureProfile`; the report's
  `budgets` (null without any; `REPORT_FORMAT_VERSION` 2) and its last section: one line when all
  are within, else each failure and each budget to lower. `yarn sbp` exits 1 on a failure (as
  `yarn assets` does), never with `--why`.
- **`yarn build`** runs `yarn sbp --no-build --profile app --brief` after the dev gather (it reads
  the manifests) and before `yarn hub:build` (Phase 6's `{{sbp:…}}` reads the report). `--brief`
  prints the totals and the budgets; the whole report still goes to the log and `report.json`.
  `AEK_SBP=false` makes `yarn sbp` print one line and exit 0. `build:test` doesn't run it (a debug
  build: the budgets would fail). D4's `banner` part waits for Phase 4's embed build.
- **D5's fix as planned doesn't work:** a production build still loads the `_dbg__` modules (97 in
  its graph), since Rollup loads every `import()`, and Vite emits a `?url` file when it loads the
  module. Measured with a scratch Vite 6.4 build (`__AEK_DEBUG__` false): an `import()` in a
  loader's closure, or after `if (!__AEK_DEBUG__) return`, still emits; one inside
  `if (__AEK_DEBUG__) { … }` or `__AEK_DEBUG__ ? … : null` doesn't. So the `?url` imports moved
  into `_dbg__Symbols.ts` (which re-exports them), and `load3DSymbols` loads it with
  `__AEK_DEBUG__ ? await loadDebugModuleAsync(() => import('./_dbg__Symbols')) : null`, then reads
  the URLs from it. `loadDebugModule`'s comment names the trap. Checked in the debug env: the
  symbols load, no error.
- **The debug assets check** (`findDebugCodeInBuild`, now an options object
  `{ files, modules, assets }`): `listEmittedAssets` (`bundleModel.ts`, on `CollectedBundle` as
  `assets`) reads the manifest's entries that aren't chunks or CSS, each with its source's module
  id and the visualizer's importers of it (any query). A file is a finding when its source is in a
  debug folder or every importer is a debug module; a `new URL` file has no importers listed, so
  only its path counts. Before the fix it named `3DSymbols.glb` and `3DSymbolsTextures.png`.
- **`bundle.json`** recorded: the two files gone (108.8 + 5.7 kB gzip), the main chunk unchanged;
  the other chunks moved a few gzip bytes each (the content hashes they import changed).
- **Docs wait for Phase 6** as planned: `devTools/verify/CLAUDE.md` (the debug assets check),
  Commands (`yarn sbp`, `--brief`, `AEK_SBP`), `devTools/sbp/CLAUDE.md`; the `__AEK_DEBUG__ ?`
  trap belongs in `src/_engine/debug/CLAUDE.md` (Debug system) too.

### Phase 3: `mountAekasha` (engine) — done

1. The seams, each defaulting to today: the canvas parent element and the canvas's attributes
   (`Renderer.ts`), a size source (`getCanvasSize`, the window by default, a container's
   `ResizeObserver` when mounted) read by the renderer's resizer and the cameras instead of
   `getWindowSize` (the debug windows keep the window), the HUD root inside the container.
2. Input scope (D6): `NONE` installs no listeners; `CANVAS` puts the pointer listeners on the
   canvas and the key listeners on it while focused (`tabindex`).
3. Page styles split (D6); the full-page boot's import measured both ways.
4. `assetBaseUrl` for `AssetUrl.ts`, `KTX2.ts`, `DracoDecoder.ts`.
5. `mountAekasha` and its handle; `pauseWhenHidden`, reduced motion, `fallbackImage`, `unmount`;
   one engine per page (D6).
6. Tests (the size source, the input scope, the options' defaults, a second mount throwing);
   `verify:scenes` unchanged; `api.json` gains the new names (`--update`).

As built:

- **The scene baselines** were recorded on `main` (`711c720`) in a worktree. A worktree lacks the
  gitignored `src/public/debugger/assets/testOptimized/phase1/` (`assetCompare`'s toolbox): copy it
  in, or `assetCompare`'s snapshots differ.
- **The size source** (`kernel/render/CanvasSize.ts`): `getCanvasSize()` (on `aekasha`; aspect 1
  while the height is 0), `onCanvasResize` (the main loop's resizers run from it, replacing its
  window listener), `setCanvasSizeSource` / `createElementSizeSource` (`@internal`; a
  `ResizeObserver` plus the window's `resize`, so the debug windows still follow the window). The
  cameras (and the camera debug GUI) read it; the draggable windows and the drawer keep
  `getWindowSize`.
- **`createRenderer({ parent, canvas: { id, className, style } })`** (`CreateRendererOptions`,
  `RendererCanvasOptions` on `aekasha`): `style` is a CSS string set before `setSize`; both kept out
  of the options it saves to LS. `getCanvasParentElem` returns the parent it used, `getCanvasElem`
  the renderer's canvas.
- **The HUD:** `createHudContainer(slot?)`. The UI kit's root replaces the element it attaches to
  (`CMP`'s `replaceRootDom`: the template's `#guiContainer` is replaced), so the mount passes an
  empty slot in its container; the container's `contain: layout` keeps the HUD's fixed elements
  inside it.
- **The input scope** (`InputState.ts`, `@internal`): `WINDOW` (default), `CANVAS` (pointer and touch
  on the canvas, `mouseup` on the window, passive; keys on the canvas with `tabindex="0"`, held keys
  cleared on `blur`, attached once the renderer exists; gamepads read only while the canvas has
  focus, released when it loses it), `NONE` (no listeners, no gamepad reads). Each device registers
  its remover (`addInputListenerRemover`, also in `NONE`, so a removal resets it: a test found it
  missing); `removeAllInputListeners()` calls them, so the mount imports no device module. The
  page-height wheel unit (`Actions.ts`) still reads `window.innerHeight`.
- **The styles:** `ui/styles/page.scss` (normalize, `html`, `*`, `body`, `#mainCanvas`,
  `#guiContainer`) and `index.scss` (the components'). Measured with scratch builds: a static import
  in a module the embed doesn't use doesn't reach its CSS (no CSS at all for an entry using
  `createRenderer` and `getCanvasSize`); the full-page boot with a static import ships one file
  (2,759 B gzip), with `import()` two (2,045 + 922 B) applied after the JS (a flash, and a
  top-level statement `moduleSideEffects.test.ts` forbids). Kept static; `index.css` unchanged
  (9,788 B, the same rules reordered). **The dev server doesn't tree-shake**, so an embed served by
  it gets `page.scss` (black body, normalize): dev only, accepted (the user's call); the Phase 4
  test page checks the built embed.
- **The asset base** (`AssetUrl.ts`, `@internal`): `setAssetBaseUrl` (a folder URL, relative to the
  document, a missing trailing slash added) **replaces** Vite's `base`: `getAppBaseUrl()` is it or
  `base` against the document (`aek-assets/`, `basis/`, `draco/`), and `resolveFileUrl()` resolves a
  file name against it or the document. Used by `toAppUrl`, KTX2's transcoder, Draco's default and
  configured paths, `Texture.ts` (its async resolver, the legacy synchronous `createTexture` /
  `loadTextures` and the cube's `setPath`) and `GLTFSource.ts`; the debug-only Assets tab still uses
  the document. So an embed's entry must sit at the root of its folder, or pass `'..'` (Phase 4).
- **The boot** moved into `kernel/init/Boot.ts` (`bootEngineAsync`, `BootOptions` with `hudSlot`,
  `isEngineBooted`; `@internal`); `InitEngine.ts` imports `page.scss`, then the boot (which imports
  `index.scss`), so the CSS order holds. One boot per page load: a second throws.
- **`mountAekasha`** (`kernel/init/Mount.ts`; `MountAekashaOptions`, `AekashaMount` on `aekasha`):
  - The container: a `div.aekMount.aekMount_<LAYOUT>` in the target (nothing else on the page
    changes), holding the canvas's own parent (`position: absolute; inset: 0`: a scene load sets
    `pointer-events` on the canvas's parent, which in `BACKGROUND` must stay the container's), the
    HUD slot and the fallback image (a `div` with a `cover` background). `INLINE`: relative;
    `BACKGROUND`: fixed, `z-index: -1`, no pointer events. Both `overflow: hidden`, `contain:
    layout`. The canvas gets `display: block` before the user's style. A container without a height
    is warned about.
  - **`sceneId` defaults to the first scene in `data`** (the config has no start scene). The mount
    creates its own scene loader (no UI; `loadScene` throws without one).
  - The loop's holds (`user`, `outOfView` from an `IntersectionObserver`, `reducedMotion`) drive
    `toggleMainPlay`. Reduced motion pauses after the first loop frame (the second render: the first
    is `initMainLoop`'s, before any system), as the fallback image goes away; `resume()` lifts it.
    The first-frame hook removes itself in a microtask (removing it during the hooks' loop would
    skip the next hook).
  - **A failed boot resolves with the fallback handle** (`isFallback`, logged), torn down but the
    container kept with its image; no WebGPU or WebGL2: the same without booting. The boot's
    rejection is handled with `.then(ok, fail)`, not a `try` block.
  - `unmount()`: the observer, `stopMainLoop()` (a flag each loop variant checks first, so a queued
    frame doesn't run on a disposed renderer; the resize, visibility, `beforeunload`, `blur`
    listeners removed), `removeAllInputListeners()`, `stopAssetsWorker()` (`AssetsAPI.ts`), the
    renderer disposed, the container removed, the seams reset. **Mounting again throws** (also after
    `unmount()`): the registrations are static and can't be undone (p612). A physics worker isn't
    stopped (`physics()` has no stop, p614).
  - Checked in Chrome (WebGPU) with a scratch page in the dev server: the canvas at 50% of a
    600×300 host (298×296), following a host resize; paused out of view and on `pause()`; reduced
    motion paused after the first frame; `BACKGROUND` behind the page's text with no pointer
    events (the canvas's parent too, after the scene load); no WebGPU / WebGL2: the fallback; a
    second mount throws, also after `unmount()`, which left the host empty; the host's styles
    unchanged by the mount.
- **A scratch embed** (an entry with `mountAekasha` alone, `features: []`): 2.0 kB gzip CSS (the
  components' only) and a 303 kB gzip entry chunk (three), plus `three.core` 51.7 kB. The physics
  and assets worker chunks and the Draco and Basis decoders are emitted as lazy files (never loaded,
  but deployed): Phase 4's look. The probe script is `.cache/probe/build.mts` (gitignored).
- **Tests** (31): `CanvasSize.test.ts` (the sources, the switch, the listeners), `InputScope.test.ts`
  (each scope for keys, the wheel and the gamepad, the blur, the removal), `AssetUrl.test.ts` (the
  default against the old formula for `/`, `./` and `/sub/`, the asset base, Draco's paths) and
  `Mount.test.ts` (every module the mount drives mocked: the defaults, the layouts, the holds, the
  fallback, unmount, a second mount throwing). `verify:scenes` 100 / 100 after each section.
- **Baselines:** `api.json` (the names above; on `aekasha`: `mountAekasha`, `getCanvasSize`,
  `AekashaMount`, `MountAekashaOptions`, `CanvasSize`, `CreateRendererOptions`,
  `RendererCanvasOptions`), `docs.json` (every new export documented), `bundle.json` (the main
  chunk +1.4 kB gzip: input 0.7, render 0.5, init 0.2; the `EngineRapier.js` pair's 0.1 kB swap is
  noise); the `app` budgets all within (initial 388.5 KiB).
- **Overlaps (§6):** a "From p611" section in p612 (the boot, the loop), p613 (the size source, the
  renderer's options, the asset base, the styles) and p617 (the input scope, the HUD slot, and the
  UI kit's `rem`s, which assume `page.scss`' 62.5% root font size: 1.6× in an embed's HUD).
- **Docs:** the input `CLAUDE.md` (the scope); the root `CLAUDE.md`'s two `initEngineAsync`
  mentions. The rest waits for Phase 6 (the Hub's embed page, the readme, the Bootstrap flow).

### Phase 4: profiles and the banner

1. Per-profile data from the gatherer (D7).
2. The embed build per profile into `dist-embed/<profile>/` (D7; library mode compared and the
   choice recorded); `yarn sbp --profile banner` measures it, its baseline next to `bundle.json`.
   From Phase 3: `assetBaseUrl` replaces Vite's `base`, so the entry module sits at the folder's
   root (or the entry passes `new URL('..', import.meta.url)`); and a scratch embed emitted the
   physics and assets worker chunks and the decoders as lazy files: keep them out of a profile that
   can't load them.
3. The banner scene and its entry under `src/app/profiles/banner/` (D8); its Hub image.
4. A plain HTML test page that mounts it at a size in %, in `BACKGROUND` layout and unmounts it,
   driven by the run-aekasha-js skill's Playwright: no error, the canvas sized to its container,
   no host style changed (computed styles on `body` before and after).
5. The banner's budgets in `sbp.config.ts`; `yarn build` checks them (D4).

As built:

- **§1, the per-profile data:** `devTools/gatherOutput.ts` holds the gatherer's output: the
  loaders as data (`GeneratedLoaders`: scene, TSL material and PostFX files by id, as paths from
  `src/`), `formatGeneratedAppFns` (the text the gatherer built inline, byte for byte: both modes'
  `src/generated/` unchanged, checked against `HEAD`'s gatherer), `writeGeneratedOutput` (the
  three files; the import prefix is the folder's path to `src/`), `selectProfileOutput` and
  `removeStaleProfileOutputs`. An embed profile (any entry but `src/index.html`,
  `getEmbedProfiles`) gets `src/generated/profiles/<id>/`: its scenes in the profile's order (the
  first is the mount's default), their scene files, and the TSL material and PostFX files those
  scenes list (as the production gather picks them). Its JSON is `{ scenes }` in both modes: the
  dev registries serve the debugger's asset lists, and the runtime's two reads of them
  (`PostFX.ts`, `TextureArray.ts`) are dev fallbacks. A profile naming a scene the data doesn't have
  or a debug scene fails the gather (both modes), as `checkSbpProfiles`' problems do; a folder no
  profile writes is removed, and `profiles/` once empty. `gatherSceneData({ profiles })` defaults to
  `sbp.config.ts`. `checkSbpProfiles` now takes an embed: a `.ts` entry under `src/`, `scenes`
  required, none twice. The dev plugin ignores all of `src/generated/`. Tests:
  `gatherOutput.test.ts`, `config.test.ts`.
- **§2, the embed build** (`devTools/sbp/embedBuild.ts`): `AEK_EMBED_PROFILE=<id> vite build`
  builds the profile instead of the app (`vite.config.ts` merges `getEmbedBuildConfig` and swaps
  `assetOutputsBuildPlugin` for `embedOutputsPlugin` and the visualizer's file for
  `dist-stats/embed-<id>/`): the entry at `dist-embed/<id>/<name>.js` without a hash
  (`entryFileNames: '[name].js'`), the rest in `assets/`, `base: './'`, `publicDir: false`
  (the app's copies all of `src/public/`, 433 MB). `dist-embed/` is gitignored.
  - **Library mode compared** (Vite 6.4, `formats: ['es']`, the same entry): workers stay files,
    but every `new URL` file is inlined as base64 (the GLTF job 148 kB → 2.7 MB, `DRACOLoader`
    1.76 MB, `KTX2Loader` 848 kB with the decoders in them), ES output isn't minified (the main
    chunk 2.09 MB vs 1.08 MB) and its CSS isn't linked either. Kept the app-style build.
  - **The entry is a facade:** with `preserveEntrySignatures: 'exports-only'` and the scenes'
    and materials' chunks importing the engine, Rollup puts the code in a shared chunk
    (`assets/<name>.js`, the same key as the facade's name) and the entry re-exports `mount`
    (0.2 kB). `findMainChunkFile` (`bundleModel.ts`) makes the main chunk the largest of the entry
    and its static imports, which leaves the app's `assets/index.js`.
  - **The CSS:** Vite emits a JS entry's CSS but nothing links it (checked: no chunk names it). The
    plugin prepends a loop adding a `<link>` per CSS file of the entry and its static imports
    (`viteMetadata.importedCss`), resolved against `import.meta.url`.
  - **The data's files:** every `__url` of the profile's data copied from `src/public/`, `basis/`
    when one is a KTX2, `draco/` when the data has imported assets; a missing file fails the build.
  - **The prune:** after the build, a crawl from the entry, its CSS and the copied files through
    the text files (JS, CSS) keeps every file whose name a kept file contains, and removes the
    rest (listed in `.vite/aek-pruned.json`; `collectBundle` drops the visualizer's parts in
    them). With `features: []` that's the physics worker, `EngineRapier` and Rapier (emitted only
    because Vite bundles a `?worker` when it loads its importer). **The assets worker, its jobs,
    the loaders and their decoders stay:** the kernel's asset code names them, so a scene file
    can load a model or a KTX2 texture; dropping them by data would 404 such a scene. They're
    deployed, never downloaded unless used: 753.8 KiB gzip of lazy files in the probe below.
  - **Measuring:** `collectBundle(build)` takes a `BuildLocation` (`APP_BUILD`, or
    `getEmbedBuildLocation(id)`: every file of the folder but `.vite/`, so the entry, the data's
    files and the decoders count); the budgets' `chunks` keys may name a root file (an embed's
    entry). `buildBundles({ isApp, embedIds })` (`appBuild.ts`) builds on one production gather.
    `yarn sbp --profile <embed>` builds and measures it; its diff reads `bundle.<id>.json`
    (`getBundleBaselineFile`), "no baseline" until one is recorded.
  - **`verify:baselines`** builds every embed profile after the app, diffs and records each as
    `bundle.<id>.json` next to `bundle.json`, and runs the debug check on each (none). `bundle.json`
    unchanged.
  - **A temporary `probe` profile** (`src/app/profiles/probe/`, `exampleQuickStart`, marked
    TEMPORARY; §3 replaces it with the banner, nothing recorded for it): initial 299.6 KiB gzip
    (the shared chunk 297.5, three nearly all of it; the CSS 2.0; the facade 0.2), lazy 26 files
    753.8 KiB. Checked in Chrome from a plain host page served statically: mounted (not the
    fallback), the canvas 300×300 at `width: '50%'` of a 600×300 target, the CSS linked, the host's
    styles untouched, and only the facade, the shared chunk, the CSS, the scene's and its material's
    chunks requested.
  - Tests: `embedBuild.test.ts` (the crawl), `bundleModel.test.ts` (the main chunk),
    `bundleDiff.test.ts` (the baseline's name).
- **§3, the banner** (`src/app/profiles/banner/`, laid out as a scene folder; `sbp.config.ts`'
  `banner` profile replaced the probe):
  - **The scene** (`banner.scene.json`, `banner.ts`): a dodecahedron (Plato's solid of the aether,
    the fifth element) from three's `DodecahedronGeometry` through `saveBufferGeometry`, turned
    by a scene app looper (`createSceneAppLooper`, `world.setTransform`: the app's `SpinComponent`
    needs `appECSPlugins`, which a `features: []` embed doesn't install). The camera
    (`bannerCamera`, fov 35 at z 6), one directional light (`bannerLight`, neutral white: an orange
    light on the teal turned it muddy green) and the material come from JSON; no background.
  - **The material** (`bannerAether.material.json`, `.tsl.ts`, `STANDARDNODEMATERIAL`): `colorNode`
    an indigo-to-teal gradient up the shape (object space), `emissiveNode` a cyan rim
    (`1 - |n·v|`, view space, breathing with `time`) plus the brand orange on the faces turned
    upward (world space, so it travels over the shape). A polyhedron's normals are its faces', so
    every face is one tint. The three typings infer `vec3` for the rim's float chain unless each
    step is annotated `Node<'float'>`.
  - **The entry** (`banner.embed.ts`): `mount(opts: BannerMountOptions)` binds the profile's data,
    `features: []`, `renderer: { alpha: true, antialias: true }` (the caller's merged over) and
    `assetBaseUrl: new URL('.', import.meta.url)` in a build only (`import.meta.env.DEV` folds it;
    the dev server serves the files from its root). Regions `banner-scene` and `banner-embed` name
    Phase 6's pages.
  - **The Hub image** (`banner.hub.png`, CARD 1600 × 1000, transparent): `_dbg__exampleHub.ts` gives
    `banner` the Hub tab (`OTHER_HUB_SCENES`) and saves it without the background
    (`TRANSPARENT_HUB_SCENES`, `takeSnapshotAsync({ transparent })`), the poster of D9's
    `::: embed`, which the page shows through as it does the live embed. Saved by calling
    `saveHubImageAsync` from Playwright in the debug env.
  - **Measured** (`yarn sbp --profile banner`): initial **300.6 KiB gzip** (the shared chunk 298.4,
    the CSS 2.0, the facade 0.2; three 608 kB of the modules' 686 kB), no feature in the build, lazy
    26 files 752.9 KiB. The built embed over a host page's gradient: transparent, turning (two
    frames apart differ), not the fallback, no error but the browser's own favicon request.
  - **Elsewhere:** `moveRules.ts` maps `src/app/profiles/<id>/` (a subfolder rule under the app
    layout's plan id: the codemod's `MovePlan` lists the plans whose moves it applies, and this is
    a keep); `moveMap.ts`' outputs regenerated (stale since Phase 3's new engine files; boundary
    violations unchanged). `moveMap.ts` reads the git index, so it fails on the committed probe
    until §3's deletion is staged. The root `CLAUDE.md`'s app layout lists `profiles/<id>/`.
    `verify:scenes --only banner`: new in all four configurations, no error (no baseline yet;
    record it with `--update --only banner`).
- **§4, the test page as a command:** `yarn verify:embed [--profile <id>] [--no-build] [--headed]
  [--webgl]` (`devTools/verify/embed.ts`), so the check repeats (Phase 6's live Hub embed, any
  later engine change) instead of a one-off script. It builds the embed profiles (unless
  `--no-build`), serves `devTools/verify/embedHost.html` (a plain page with its own styles, a
  heading, a link, a button and an input) at `/` and the build at `/aekasha/` from its own static
  server (8093; the favicon a 204, so no error), and drives Chromium, one page load per scenario
  (one mount per page load):
  - `INLINE`, `width: '50%'`, `height: '80%'` of a 640 × 360 target: the container, the canvas
    and its drawing buffer at 320 × 288, something drawn (the target's screenshot differs from the
    empty one), all at 400 × 320 when the target grows to 800 × 400; after `unmount()` no
    container or canvas and the target empty; a second mount rejects.
  - `BACKGROUND`: the container and the canvas fill the viewport at 0, 0, something drawn behind
    the content (the page's screenshot differs), `elementFromPoint` on the heading's centre is the
    heading and in the middle not the embed; nothing left after `unmount()`.
  - In both, every computed property of `html`, `body`, `h1`, `p`, `a`, `button`, `input` and the
    target (`HOST_STYLE_SELECTORS`, `embedChecks.ts`, tested) compared before, while mounted and
    after the unmount, and no console or page error.
  - Checked that it catches a change: a `body { letter-spacing }` appended to the built CSS failed
    both scenarios, naming each element's property. Banner: all pass on WebGPU (3 s without the
    build, 11 s with it) and on WebGL2 through SwiftShader (`--webgl`).
  - The browser launch moved out of `scenes.ts` into `devTools/verify/browser.ts` (`isWSL`,
    `findBrowserExecutable`, `launchChromium`, which throws), shared by both; the scene runner
    passes as before. Documented in `devTools/verify/CLAUDE.md` and the root Commands; the readme
    waits for Phase 6.
  - A caveat for Phase 6's embed page: `BACKGROUND` is `z-index: -1` in the root stacking context,
    so it shows through a background on `body` (it propagates to the canvas when `html` has none),
    but a page whose `html` and `body` both have one should paint `body`'s over it (from CSS's
    painting order, not tested: check it with the embed page's example).

### Phase 5: studies

1. **The lite renderer** (p600 §4.4): measure a throwaway `WebGLRenderer` + `MeshStandardMaterial`
   page with the same scene (not committed), list what the engine would need for a second
   material path (materials, sky box, PostFX, the LOD dither, impostors are TSL), and recommend.
   Written into this plan's §7.
2. **The manifest fold and the `physics()` option** (D10): the savings from the report, the
   recommendation written into p612 and p614.

### Phase 6: Hub, readme, CLAUDE.md

1. The `::: embed` directive and the `{{sbp:…}}` helper (D9); `hub:build` copies the embed.
2. **Feature page `hub/pages/features/smallest-build/`** (`aek:group` Performance,
   `aek:featured`): what SBP is, the live banner, the real numbers (the floor, the app, the
   three floor and why), what's lazy, `yarn sbp`, the budgets, the lite study's verdict, `aek:covers`.
3. **Example page `hub/pages/examples/embed/`**: embedding a scene in a site, the entry's and the
   page's code as regions, the options, the limits (same origin, one per page).
4. The homepage's featured features (a fifth card, or replacing one: decided with the page),
   the readme's "Why Ækasha?" and Features, the brand section in `.claude/CLAUDE.md` (a fourth
   principle), Commands (`yarn sbp`, `AEK_SBP`), `devTools/sbp/CLAUDE.md` (new, in the map),
   `hub/CLAUDE.md` (the embed directive; the public Hub's exception), `devTools/verify/CLAUDE.md`
   (the debug assets check).
5. `yarn hub:build`, `yarn hub:preview` with the live embed checked in a browser.

### Phase 7: versioning, changelog, mark done

- Engine **minor** (5.1.0 → 5.2.0: `mountAekasha`, the seams), Toolkit unchanged, App **minor**
  (1.11.0 → 1.12.0: the banner profile), Project entries for `yarn sbp` and the Hub.
- `CHANGELOG.md`, `yarn checkVersions --against main`, the plan marked done (docs/plans/CLAUDE.md).

## 5. Done when

- `yarn sbp` reports sizes, features, "why" and the diff, and runs in `yarn build` (skippable),
  with budgets for the app and the banner.
- `mountAekasha` mounts a profile into a page without changing it, and the template app boots as
  before.
- The banner runs live on the Hub's SBP feature page with its measured size; the readme and the
  Hub say what SBP is.

## 6. Overlaps

p612 (init, config), p613 (renderer) and p617 (input) review the code Phase 3 touches. Phase 3
adds the seams the embed needs and nothing else; each of those plans gets a line naming the seams
so their reviews start from them.

## 7. The lite-renderer study

(Phase 5.)

## 8. Risks

- **The seams leak:** something still reads the window (a camera, a debug tool shown in prod
  test). The Phase 4 test page in a smaller container catches the visible ones.
- **Re-mounting:** the singletons may not reset cleanly; then one mount per page load is the
  documented limit.
- **The Hub gets heavier:** only the SBP page loads the embed, only when it's visible.
