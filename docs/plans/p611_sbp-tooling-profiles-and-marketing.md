Status: in progress | Phase 1 implemented
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
- **An icon budget** needs no code of its own: `ui/icons` is a group, and its production budget
  is 0 (the built-ins register only in the debug env).

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

### Phase 2: budgets, `yarn build`, debug assets

1. `sbp.config.ts` (D2) with the `app` profile's budgets, set from today's report plus a margin.
2. Over budget fails with the group or chunk, its size and the budget; well under is reported.
3. `yarn build` runs it (D4); `AEK_SBP=false` skips it.
4. The debug assets check and the `3DSymbols` fix (D5): `dist/assets/` loses 114.5 kB gzip;
   `bundle.json` updated with the change that explains it.

### Phase 3: `mountAekasha` (engine)

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

### Phase 4: profiles and the banner

1. Per-profile data from the gatherer (D7).
2. The embed build per profile into `dist-embed/<profile>/` (D7; library mode compared and the
   choice recorded); `yarn sbp --profile banner` measures it, its baseline next to `bundle.json`.
3. The banner scene and its entry under `src/app/profiles/banner/` (D8); its Hub image.
4. A plain HTML test page that mounts it at a size in %, in `BACKGROUND` layout and unmounts it,
   driven by the run-aekasha-js skill's Playwright: no error, the canvas sized to its container,
   no host style changed (computed styles on `body` before and after).
5. The banner's budgets in `sbp.config.ts`; `yarn build` checks them (D4).

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
