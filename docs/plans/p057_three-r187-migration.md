Status: in progress | Phase 1 implemented
Category: Rendering, Dependencies
Related: \_DONE_p056_three-bind-group-cache-light-leak.md (fixed by this plan's Phase 1), p058_shared-instanced-builds-for-lod-fades-and-impostors.md (D3's better fix), p311_sky-box-ktx2-cube-textures.md (r187's compressed cube support), p350_lod-system-research.md, p354_gpu-driven-culling.md, p375_batched-mesh-batches.md, p302_material-and-texture-system-refactor.md (r187 features noted there)

# Three r187 Migration — Plan

three r187 (`three@0.187.0`, `@types/three@0.187.0`, released 2026-10-30) replaces 0.186.1. Its
release notes: https://github.com/mrdoob/three.js/releases/tag/r187; its migration guide's
186 → 187 section: https://github.com/mrdoob/three.js/wiki/Migration-Guide#186--187.

Branch: `upgrade-three-js-to-r187` (from `main` at `a2f79542`, the engine 6.0.0 merge), into
`main`.

## Context (2026-11-05)

The upgrade was reviewed in three parts: what breaks at runtime that `tsc` doesn't catch (three's
private members, behaviour changes, addon paths), and the new features against the LOD, culling,
merging, material, texture and sky plans. The features went into those plans (see Related, and
the Plan changes list at the end). This plan is the upgrade itself.

### What r187 fixes for us

- **p056** (`_bindingGroupsCache` kept every disposed light): fixed upstream by #34707 (the cache
  moved into `Bindings`, an entry deleted with its bind group). The issue's standalone page
  (WebGPU, Chromium, macOS): r186.1 collected 0 / 10 disposed lights, r187.0 9 / 10 (with and
  without shadows; the tenth is the latest, held by bounded references). In the app it took one
  engine change more (D4).
- **The instance attribute leak** (`docs/issues/three-instanced-node-attribute-leak.md`):
  #34603 (each render object deletes its own node attributes) and #34690 (interleaved attributes
  counted once per buffer), both in r187. To confirm in Phase 2.
- **Build size** (`yarn verify:baselines`, against the committed `bundle*.json`): `three/tsl` is
  tree-shakeable (#34533) and unused maths classes drop (#34619). First download: the app
  381.6 → 365.2 kB gzip (its `three` group 254.5 → 239.3), the banner embed 285.2 → 263.7 (251.7
  → 231.1), the uiKit embed 284.5 → 263.1 (250.7 → 230.0). The lazy `GLTFLoader` chunk grew
  0.2 kB, `ambientOcclusion.tsl` 0.1 kB.

### What doesn't change

- `docs/issues/renderer-custom-tone-mapping.md`: r187 still registers nothing for
  `CustomToneMapping` (`StandardNodeLibrary.js`, `BasicNodeLibrary.js`), `ToneMappingNode` still
  logs "Unsupported", and `renderer.library.addToneMapping` is unchanged (per renderer, the first
  registration kept). The built-in curves are now written in the layout form
  `Fn(fn, { color: 'vec3', exposure: 'float', return: 'vec3' })`, the form an app's curve takes.
- `docs/issues/three-animation-classes-in-builds-without-models.md`: the animation classes are
  still in `build/three.core.js`, which the first download needs; #34619 drops only unused maths
  classes. The same now holds for TSL: a TSL function only a lazy chunk uses still sits in
  `three.tsl.js`, which `three.webgpu.js` imports statically.
- Checked unchanged or still working (the private members the engine reads): the test bridge's
  `NodeFrame.prototype.update` patch (`NodeFrame.js` identical), `Snapshot.ts`'s
  `renderer._nodes.nodeFrame.frameId`, the GPU timer's timestamp pools and `InspectorBase` tap,
  the census's `BatchedMesh` fields, `info.memory` / `info.memoryMap` / `info.render` (GPU memory's
  compressed-texture and cube-face workarounds still apply), the GPU memory tab's shadow node
  internals and `_frameBufferTargets`, the axes gizmo's OrbitControls fields, the 16 addon import
  paths (only the unused `libs/surfaceNet.js` went), `SkyMesh.js` (docs and `Fn` layout syntax
  only: the atmosphere port needs nothing, p990), and none of the r177 shims #34517 removed is
  used.

## Design

### D1 — PMREM on cube render targets (#34585)

r187's PMREMs are `CubeRenderTarget`s with only the prefiltered mips (down to 8 texels, `LOD_MIN`
3), `CubeUVReflectionMapping` is gone, and a PMREM face is at least 256 (`MIN_SIZE`).

- `SkyEnvironment.ts`' env bake target is allocated as `PMREMGenerator._allocateTarget` does
  (a `CubeRenderTarget` of the face size, HalfFloat, linear-sRGB, no depth, size-only `mipmaps`
  entries, `isPMREMTexture`), and the env bake types name `CubeRenderTarget`.
- **`env.size` 64 and 128 bake at 256** (`getEnvBakeFaceSize`, module-local): three's generator
  renders its source cube at 256 whatever it's asked, so a smaller target would only mismatch it.
  The schema keeps the four values (a removal is a breaking change) and documents the 256 floor;
  the default stays "256, or 128 with day-night", which now means 256 either way. Phase 3
  decides whether that stays.
- Memory (HalfFloat, with mips): r186's CubeUV target at 128 was 384 × 512 (1.5 MB), at 256
  768 × 1024 (6.3 MB), at 512 1536 × 2048 (25 MB); r187's cube is ~4.2 MB at 256 and ~16.8 MB at
  512. So a day-night sky (128 before) costs ~2.6 MB more, every other size less.
- `getPMREMTexture` returns the source texture until the renderer has initialized: r187's
  `fromEquirectangular` / `fromCubemap` throw before `renderer.init()` (r186 baked
  asynchronously), and the generator is always disposed right after its bake.
- Upstream reports better PMREM quality, 16-25 % faster environment sampling, slower generation
  for 1K sources and faster for 2K: lit materials and blurred backgrounds look slightly different
  (Phase 2's baselines).

### D2 — The GPU memory tab's PMREM generator fields

`_dbg__GPUMemorySources.ts`' `skyBox.envBake` source read r186's `_pingPongRenderTarget`,
`_lodMeshes` and `_backgroundBox`; r187's working set is `_sourceTarget` (the source cube) and
`_boxMesh`. Without the change the source yields `undefined`s and the generator's working set
goes untracked.

### D3 — InstancedMeshes share shader builds (#35007, #34872)

r187 dropped the `InstancedMesh`'s uuid from its render object's cache key: instanced meshes with
the same material and attribute layout share one node build, and three looks a cached build up
(`NodeManager.getForRender`, keyed by `renderObject.initialCacheKey`) before any node's `setup`
runs. Two engine nodes bind a per-mesh buffer in `setup` from `builder.object`:

- `LodFadeMaskNode` (`kernel/render/LodFade.ts`): the mesh's `lodFade` attribute.
- `ImpostorInstanceMatrixNode` (`features/lod/impostors/OctahedralImpostorMaterial.ts`): the
  second binding of the mesh's instance matrix.

So a shared build bound the first mesh's buffer for every mesh, or none: in lodShowcase 4 of the
8 fading `InstancedMesh`es (the tree grove's levels on one material, the knot lane's) drew with
another mesh's fades (a probe wrapping `renderer._nodes._createNodeBuilder`). A mesh without a fade
can also lend its build to one with.

Fix: both `setup`s mark an `InstancedMesh`'s build object-specific (`builder.objectSpecific =
true`, which `NodeManager` never caches), the fade mask for every `InstancedMesh` it sees (with or
without a fade). That's r186's behaviour for these meshes only; every other instanced mesh shares
builds. After the fix the probe counts 8 of 8 with a build of their own. p058 is the better fix
(per-object bindings that keep the sharing).

### D4 — p056's last retainer: a render context per MRT, and a render list's lights

With #34707 in, the app still kept every Gym visit's lights (a heap snapshot, WeakMap edges
followed only when both key and table were reached):

```
renderer._renderContexts._renderContexts['<attachments>-<mrt id>-perspective-<depth>']
  -> RenderContext.camera (the last camera rendered with that context: a Gym camera)
renderer._renderLists.lists (ChainMap [scene, camera, lighting])
  -> [root scene, that camera, lighting] RenderList -> lightsArray -> the Gym's lights
```

- `RenderContexts.get` keys a context by attachment state, **MRT id**, camera type and call
  depth, and never evicts one. PostFX's normal pre-pass (`PostFX.ts`, for a pass that reads
  depth or normals: the Gym's `ambientOcclusion`) made a new `mrt({ output: normalView })` per
  build, so every Gym visit added a context that kept that visit's camera.
- `RenderList.clear()` (an idle list, after 10 frames) resets its render items but not
  `lightsArray` (r187 `RenderList.js`), so the camera's list kept its lights. A three bug: Phase 4
  reports it.

Engine fix: one pre-pass MRT for every build (`prePassMRT` in `PostFX.ts`), so the contexts stay
bounded. Measured (Gym ↔ `testDebugScene`, Chromium, WebGPU, `--expose-gc`, lights registered in a
`FinalizationRegistry`, `BufferGeometry` counted with CDP `queryObjects` after a forced GC):

| Build | Gym lights collected (of 2 per visit) | `BufferGeometry` in the light scene after visits 1-4 |
| --- | --- | --- |
| r187, before D4 | 0 / 8 | 35 / 35 / 35 / 35 (58 each with `?isDebug=true`) |
| r187 + `RenderList.clear` also emptying `lightsArray` (a page patch) | 6 / 8 | same |
| r187 + D4 | 4 / 8 at 4 visits, 8 / 12 at 6: the first and the latest visit's stay | same |

So the light leak is bounded (two visits' lights, through contexts only the first visit and the
latest visit used) and the geometries are flat. (p056's own geometry growth, 55 / 71 / 103 on
r183, is gone. A trap for the method: each `Runtime.queryObjects` result keeps its objects alive
in the CDP session until its object group is released, which grew the count by 8 per visit until
the script released it.)

### D5 — Behaviour changes that need no code

- The renderer's internal animation loop starts on the first `render()` / `compute()`, not in
  `init()` (#35278, #35279): three's callback can run after `runFrame` in a frame. The `LATE_MAIN`
  samplers aren't affected; code reading `info.render` from a timer would see 0; TSL `time` starts
  at the first render (the test bridge pins it anyway).
- Shadows with `autoUpdate = false` and `needsUpdate` render once instead of twice (#34794), and
  `setupShadow` forces one update (#35093): the sky lights' `shadow.autoUpdate` handling
  (`SkyLights.ts`) keeps working; Phase 3 checks its first-render workaround.
- r187 creates a render target's textures with the target (#35204), so the "sampled before its
  first render" trap (`initEnvBakeTarget`, `SkyStaticLayers.ts`' `initTarget`, `SkyLights.ts`'
  first shadow render, the sky box `CLAUDE.md`'s "Two traps") may be gone. The workarounds are
  harmless; Phase 3 removes each only after a WebGPU run without it.
- TSL coerces operands and math parameters to a common type (#33695): shaders mixing int and
  float (`layers/Stars.ts`, `kernel/assets/TextureArray.ts`, `_dbg__TexturePreview.ts`, the app's
  `textureArrays` scene) may compile differently.

### D6 — Expected visual changes

PMREM (D1, the roughness ramp #34645), the ACES Filmic fit (#35110), physical specular in direct
light (#34764), GTAO (off-screen and centre-texel samples, `projectionDepth`), the shadow changes
(D5). The scene runner's snapshots move; the probe hashes and the system order must not.

## Phases

### Phase 1: The upgrade and what broke — done

- `three` 0.187.0, `@types/three` 0.187.0 (`package.json`, `yarn.lock`).
- D1 (`SkyEnvironment.ts`, `SkyBoxSchema.ts`'s `env.size` doc, the sky box `CLAUDE.md`), D2
  (`_dbg__GPUMemorySources.ts`), D3 (`LodFade.ts`, `OctahedralImpostorMaterial.ts`, the LOD and
  impostor `CLAUDE.md`s), D4 (`PostFX.ts`).
- Checked: `tsc` and `tsc -p hub`, `yarn lint` on the changed files, `yarn test` (300 files, 2,641
  tests), `yarn build` (SBP budgets, the Hub), `yarn verify:baselines --no-build` (the bundle
  diffs above, no debug code in any build), p056's standalone page and the app cycle (D4), the
  instanced build probe (D3).

As built:

- `getEnvBakeFaceSize` stays module-local (no API change: `api.json` unchanged).
- The probe scripts are in the session's scratchpad, not the repo; their method is D3's and D4's
  text. The cycle's page helpers import the engine modules from the URLs the app loaded them from
  (`performance.setResourceTimingBufferSize` first, as p056's Method said).

### Phase 2: Verification and baselines

Results so far (2026-11-05, macOS, Chromium, WebGPU):

- Step 1's first run: 79 passed, 35 failed, every failure a snapshot or a debugger shot; no new
  console error, probe hash, system order or character path change (the `!` notes are the worker
  targets' known nondeterminism, `thirdPersonGymScene` and `space` `workerMsg`). Snapshots: an even
  IBL shift everywhere (lodShowcase mean ~0.5 levels, the shapes identical), the Gym the largest
  (mean 4.7, max 59, 0.5 % of the pixels, on edges: GTAO and shadows), topDown mean 2.4. Debugger
  shots: `window.about` (three's version), `profiler.gpuMemory` (the env bake's sizes, D1),
  `stats.panels` (only the masked TFPS figure's width: a run-to-run number, not r187), and
  `drawer.assetCompare` a note (its load order). Recorded with `--update` on this branch (114
  recorded, nothing but allowed errors), then the plain run: 114 passed, 0 failed, 13 snapshots
  within tolerance (mean ≤ 0.1), `drawer.assetCompare`'s load-order note again; no `!` worker
  target note this time.
- Step 2: `yarn verify:embed` passed (both profiles, every scenario). `yarn verify:ui` failed one
  state of 1 piece, `settingsMenu`'s "Changed from outside" in light (mean 0.10, 0.40 %: the UI
  scale field's change tint not yet faded); `--no-build --only settingsMenu` passed on the same
  build, so a timing flake in the kit alone (no three in it). `yarn verify:devFiles` failed one
  check, "/@fs/ outside the repo is refused" (HTTP 200): macOS has no `/etc/hostname`, and Vite
  serves its SPA fallback for a missing file (a probe: `/@fs/etc/hostname` 200 with
  `index.html`, `/@fs/etc/hosts` 403), so the check now asks for `/etc/hosts`
  (`devTools/devFiles/selfCheck.ts`; a Project changelog line), then 61 / 61 passed.
  `yarn verify:scenes --browser firefox` (Firefox 155.0, WebGL2): 81 passed, every hash Chromium's.
- Step 3 done: the issue's round trip is flat (62 attributes, 1.51 MB on all four `largeWorld`
  visits); the issue is closed, and the Hub's rendering guide says both leaks are fixed (Phase 5's
  step 1, done early).

1. `yarn verify:scenes` against `main`'s baselines (recorded 2026-11-05 on the engine 6.0.0
   code). Expected: snapshot diffs (D6) and nothing else; a changed probe hash, system order,
   character path or a new console error is a regression to fix. Look at each failed snapshot's
   `*.diff.png` (`.cache/verify/scenes/webgpu/last-run/`) and record what moved here. Then
   `yarn verify:scenes --update` on this branch, and `yarn verify:scenes` once more to pass.
2. `yarn verify:ui`, `yarn verify:embed`, `yarn verify:devFiles`, and
   `yarn verify:scenes --browser firefox` (determinism across engines).
3. The instance attribute leak: the issue's console round trip (`largeWorld` ↔ `skyShowcase`, four
   visits) and the GPU memory tab's snapshot. If the attribute count and size stay the same from
   the second visit on and **Left behind** lists no interleaved attributes, close the issue
   (status `fixed | three r187`, the numbers in it).
4. `yarn verify:baselines --update` (the bundle drop, after a fresh build) and lower the SBP
   budgets `yarn sbp` flags as well under (`sbp.config.ts`: the `three` groups, the embeds'
   initial and main chunk budgets), in the same commit.

### Phase 3: Clean-ups r187 allows

1. **`env.size` below 256** (D1). Measure a day-night bake at 256 against r186's 128 (the
   Environment folder's bake stats, GPU ms, on `skyShowcase`; p110's numbers are r186's) and the
   re-bake rate (`env.maxUpdatesPerSec`). Then decide: keep 64 / 128 as documented aliases of 256
   (today), or make the day-night default 256 explicitly and deprecate 64 / 128 for the next
   major (`@deprecated` in the schema, a warning in the debug env).
2. **The first-render workarounds** (D5): drop `initEnvBakeTarget`, `SkyStaticLayers`'
   `initTarget` and the sky light's forced first shadow render one at a time, each with a
   `verify:scenes` run on WebGPU (`skyShowcase`, `space`, `largeWorld`) watching for "Destroyed
   texture used in a submit"; keep any that's still needed and correct its `@remarks` to r187.
   Update the sky box `CLAUDE.md`'s "Two traps" and p304's Context line with the result.
3. **The pre-warm under PostFX** (#35014 shares node builds across call depths; GPU pipelines are
   still per target format): measure a PostFX scene's first frame after `preWarmMesh`
   (`kernel/mesh/Mesh.ts`), and if it still compiles, pre-warm through the scene pass
   (`scenePass.compileAsync(renderer)`, `PassNode.compileAsync`, #35168). p353 §1 notes the same
   for priming.
4. **The "r186" comments** (36 files under `src/`, `hub/`, `devTools/`): each says what three
   r186 did; re-check it against r187 and say "three (r186, r187)" where it still holds, or
   correct it. Known stale: `ImpostorSourceHash.ts` (r187 no longer widens a 16-bit index; the hash
   keeps normalizing, so existing fingerprints stay), the ordering claims in `_dbg__GPUMemory.ts`
   and `_dbg__ProfilerSources.ts`, the GTAO param labels in `ambientOcclusion.postFx.json`,
   `AssetsWorker.ts`' GLTFParser check, the test bridge's "three r186's fields" in
   `src/_engine/debug/CLAUDE.md`, and the profiler census's "repeats three r186's
   `_projectObject`" (r187 moved it into `StandardDrawingPipeline.project`, same rules).

### Phase 4: Upstream report

1. An issue file, `docs/issues/three-render-list-keeps-lights.md`, in the form of
   `three-bind-group-cache-light-leak.md` (the report's text, a standalone page as the repro): an
   idle `RenderList`'s `clear()` keeps `lightsArray`, and `RenderContexts` keeps a context per MRT
   id for the renderer's lifetime, each holding the last camera it rendered, so an app that makes
   an MRT per scene keeps each scene's camera and lights. Suggested fixes: `lightsArray.length = 0`
   in `clear()`, and the context's `camera` dropped when its list goes idle (or the context cache
   evicted with the MRT).
2. The user posts it upstream (an outward action) and its number goes here and in the issue
   file. D4 stays either way.
3. ~~Add the r187 findings to `renderer-custom-tone-mapping.md` and
   `three-animation-classes-in-builds-without-models.md`~~ (done with Phase 1: a "three r187"
   section in each).

### Phase 5: Hub, docs and versioning

1. The Hub's rendering guide (`hub/pages/features/rendering/guide.md`, Known issues): the light
   leak and the instance attribute leak are fixed with r187 (link the closed issues); the sky box
   page's `env.size` (the 256 floor).
2. `CHANGELOG.md`: Engine (three r187; the PMREM change and its look; `env.size` below 256 bakes at
   256; the LOD fade and impostor build fix; the PostFX pre-pass MRT; smaller first download),
   Project (the baselines, the SBP budgets, the dev files self-check's `/@fs/` probe on macOS).
3. Versions: an engine minor (6.1.0: a dependency upgrade that changes rendered output and
   `env.size`'s cost), the project version with it; the toolkit and app keep theirs unless Phase 3
   touches them. `yarn checkVersions --against main`.
4. Mark this plan done; time for the PR (`upgrade-three-js-to-r187` into `main`).

## Plan changes made with this plan (2026-11-05)

- p354: r187's `renderer.drawingPipeline` hook and the experimental `MeshletDrawingPipeline` /
  `VisibilityBufferDrawingPipeline` in "What's known"; Phase 0 evaluates the drop-in first; the
  instance attribute leak bullet updated.
- p350 §7, §7.1 and the Tier 4 row: three's meshlet pipeline makes Tier 4 an evaluation, not a
  build.
- p375 and p370 §2.1, open question 4: r187 merges consecutive `BatchedMesh` draws sharing a
  geometry range, so a batch grouped by geometry lowers the draw count too; the spike measures
  sorted and grouped orders, and the gate counts draw-count wins.
- p353 §1, §5, Phase 0: `compileAsync`'s parallel builds and 8 ms slices, shared node builds across
  call depths, `PassNode.compileAsync` for priming under PostFX.
- p302 D1 (texture transforms update live, #35062), D2 (variants as `NodeMaterialInstance`s), the
  Phase 3 spike and its Risks row; p374 open question 3 (a shared-shader tier).
- p304 (array render target fixes, `mipmapsAutoUpdate` for multi-pass bakes), p307 (SSR more
  viable, EON rough diffuse, `BumpMapNode`'s `normalNode`), p427 (`lensDirt`), p990 (SkyMesh
  checked; the lite embed's gap smaller).
- New: p058 (shared instanced builds for the fades and impostors, `referenceAttribute`, the
  impostor bake's `mipmapsAutoUpdate`), p311 (KTX2 cube sky boxes and pre-filtered environments).
- Judged not relevant for now: occlusion queries per camera (#35066), ArrayCamera per-sub-camera
  culling (#35164), the loaders' priority and HTTP cache options (#34936; the engine fetches
  itself), depth-only render targets (#34782), ClusteredLighting spot lights (#34978), the
  `getTextureGradient()` context (#35121; the engine passes explicit UVs), LightProbeGrid,
  LightMapper and `unwrapUVs` (no baked GI plan; day-night limits baked GI).
