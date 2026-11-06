Status: in progress | Phases 1-4 implemented (Phase 4 step 4 left for later), Phase 5 in progress
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

### Phase 2: Verification and baselines — done

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
- Step 4: `yarn verify:baselines` on a fresh build showed the Context's bundle numbers exactly (the
  growths only `GLTFLoader.js` +0.2 kB in all three profiles and `ambientOcclusion.tsl.js`
  +0.1 kB; `api.json`, `docs.json` unchanged, no debug code), recorded with `--update`, then
  "All baselines unchanged". `yarn sbp --profile all` flagged the embeds' initial, main chunk and
  `three` budgets well under; each went to `suggestBudget` (banner 313 / 311 / 262 → 277 / 275 /
  241 KiB, uiKit 298 / 296 / 261 → 276 / 274 / 240). The app's were about 9 % under, short of
  "well under", but r187 is what freed them, so they went to `suggestBudget` too (initial
  404 → 385, `assets/index.js` 401 → 380, `three` 265 → 249). After: every budget within but the
  app's `_engine/features/character` group (2.6 kB of 5 KiB), well under on `main` too (2,686 B
  in its `bundle.json`): not r187's, left for its own change. `yarn test`: 300 files, 2,641
  tests.

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

### Phase 3: Clean-ups r187 allows — done

Results so far (2026-11-05, macOS, Apple M2, Chrome, WebGPU, headed, the dev build):

- Step 1 measured: `skyShowcase`'s `dayNight` at each `env.size`, r186 (a `main` worktree) and
  r187 (this branch), the same probe (scratchpad). The Environment folder's GPU ms is unusable on
  this machine: the timestamp sums read 80-100 ms a bake on r187 and 79-700 ms on r186 (growing
  with the size) while ten bakes a frame cost ~60 ms of frame time, so the timestamps measure
  something else on Apple's GPU (headless and headed alike; `queue.onSubmittedWorkDone()` takes
  ~300 ms to resolve there too). So the cost is wall clock: the frame time with ten bakes a
  frame (`runRequestedEnvBake`) minus without, over ten, CPU and GPU together (the CPU alone
  1-3.5 ms a bake in the dev build):

  | `env.size` | r186 face | r186 ms / bake | r187 face | r187 ms / bake |
  | --- | --- | --- | --- | --- |
  | 64 | 64 (CubeUV 336 wide) | 2.2 | 256 | 5.9 |
  | 128 (the day-night default) | 128 (384) | 3.2-3.3 | 256 | 5.8-6.0 |
  | 256 | 256 (768) | 5.7 | 256 | 5.8-6.1 |
  | 512 | 512 (1536) | 14.6 | 512 | 11.4-11.9 |

  Two runs each, within 0.2 ms. So a day-night bake costs ~1.8× r186's (~+2.7 ms here), 256 the
  same and 512 less; 64 and 128 cost exactly 256's. The re-bake rate doesn't change with three:
  0.95 / s at ×1 and 1.0 / s at ×100 on `skyShowcase` (its 5-minute day turns the sun 1.2° / s,
  so the 1 / s cap binds at ×1 too; the default 20-minute day bakes every ~3.3 s).
- Step 1 decided (option B, 2026-11-05): 256 is the default with or without day-night, and
  `env.size` 64 and 128 are deprecated for engine 7.0.0. As built:
  - `getEnvSize` (`SkyComposite.ts`) gives the face size: the definition's (default 256) and at
    least `ENV_BAKE_MIN_SIZE` (256, now exported from `SkyEnvironment.ts`, which no longer clamps
    itself); `DAY_NIGHT_ENV_SIZE` is gone. So a change between 64 / 128 and 256 is no rebuild.
  - `DEPRECATED_ENV_SIZES` (`layers/Base.ts`, not the schema file: the warning imports it, and
    the schema file loads zod) carries the `@deprecated` tag for the 7.0.0 sweep; the schema's
    literals and the generated JSON schema stay (removing them is the breaking change). The
    schema's `size` doc and `SkyBoxEnvSizeSchema`'s say deprecated.
  - The debug env warns once per `registerSkyBox` and per applied `updateSkyBox` naming 64 or 128.
    The Environment folder offers 256 and 512, and `getDefValue` shows a deprecated size as 256.
  - Tests: `getEnvSize`'s cases (`SkyComposite.test.ts`); `SkyBox.test.ts`' rebuild case is 512
    now, and a deprecated size and day-night are uniform writes.
  - The sky box `CLAUDE.md` and the Hub's sky box guide say so (Phase 5's sky box line, done).
  - Not r187's, left open: the bake stats' GPU ms is unusable on Apple Silicon (above).
- Step 2 done. Each removal was checked against a control: the same removal on r186 (the `main`
  worktree), which must show the trap, or a pass on r187 proves nothing.
  - `initEnvBakeTarget` **stays**. Without it `skyShowcase` fails on r187 as on r186 (100 and
    104 × "Destroyed texture [Texture "SkyBox.envBake"] used in a submit", `workerSab`): r187's
    fix (#35204, `Textures.updateTexture` creating a sampled render target texture with its
    target) goes through `texture.renderTarget`, and `CubeRenderTarget`'s constructor swaps its
    `CubeTexture` in through the `texture` setter, which sets no back-link (`renderTarget` stays
    null). A three bug: Phase 4 reports it. `space` and `largeWorld` pass without the clear on
    both versions.
  - `SkyStaticLayers`' `initTarget` **stays**: a `CubeRenderTarget` too, so the same missing
    link. No scene shows its trap even on r186 without it (`skyShowcase` and `space` load clean),
    so the runner can't decide either way; its remarks say so.
  - The sky light's forced first shadow render **is gone** (`SkyLights.ts`): a probe (scratchpad
    `lightProbe.mts`: `skyShowcase` at 01:00, the sun light's `castShadow` off and on, so a new
    light is created faded out, then noon) counts 120 × "Destroyed texture [1024² RG16Float]"
    (the VSM map) on r186 without it, 0 with it, and 0 on r187 either way: r187's
    `ShadowNode.setupShadow` sets `needsUpdate`, and a 2D target's texture has its back-link.
  - The remarks (`initEnvBakeTarget`, `setEnvBake`, `initTarget`, `setStaticLayers`,
    `syncSkyLights`), the sky box `CLAUDE.md`'s "Two traps" and p304's Context line say so.
    `syncSkyLights`' other trap (the `castShadow` crash under PostFX) keeps "three r186" for
    step 4.
- Step 3 measured (2026-11-06, Chromium headless, WebGPU, the dev build, `?isDebug=true`; the
  r186 worktree removed: no control needed). A probe (scratchpad `prewarmProbe.mts`) adds a new
  mesh to the Gym (PostFX `ambientOcclusion`: the MSAA scene pass and the depth / normal pre-pass
  with its MRT), a fresh `MeshStandardNodeMaterial` casting and receiving shadows, 4 m in front
  of the camera, and counts the node builds (`NodeManager._createNodeBuilder`) and render
  pipelines (`backend.createRenderPipeline`) made in the frames after the add:

  | Pre-warm before the add | First frames: builds / pipelines | Hitch |
  | --- | --- | --- |
  | none | 3 / 3 (scene pass, pre-pass MRT, shadow) | a 600 ms frame |
  | `preWarmMesh` as it is | 3 / 3: it compiled nothing (finding 1) | 254 ms |
  | depth 0, not frustum culled | 2 / 3 (pre-pass MRT, shadow; the scene pass's pipeline again) | 236 ms |
  | each scene pass's target and MRT (after depth 0, or alone) | 1 / 1 (the shadow) | none |
  | PostFX off, depth 0, not culled (the control) | 1 / 1 (the shadow) | none |

  Findings:
  1. **`preWarmMesh` is frustum culled**: `compileAsync` projects against its own camera (a
     default `PerspectiveCamera` at the origin looking down -z), so a mesh outside that frustum
     compiles nothing. Not r187's: since `preWarm` was written. The LOD stand-ins aren't culled
     (`createStandIn` sets `frustumCulled = false`); `createMeshEntity`'s own mesh is.
  2. **#35014 works, but doesn't save the hitch**: the scene pass reuses the depth-0 node build,
     but its pipeline key differs from depth 0's by the colour space alone (`srgb-linear` for the
     frame buffer target, empty for the pass's target), so the pipeline is made again; the
     pre-pass needs its own MRT build and pipeline. A depth-0 pre-warm under PostFX saves no
     hitch, with or without a pre-pass.
  3. The shadow pass's build is never pre-warmed (either path); no measurable hitch from it.
  4. **Compiling through a pass leaks its state into the frames**: a pass compile (three's
     `PassNode.compileAsync`, or the same target and MRT set around `renderer.compileAsync`)
     holds the renderer's target and MRT for the whole async compile. Three's
     `_finishPreCompile` puts back the MRT current at the call between its 8 ms slices, and node
     builds read the global target (`MRTNode.setup`, `NodeBuilder.getOutputType`,
     `isToneMappingState`), so neither can be restored early. Frames rendered meanwhile use the
     pass's target and MRT: the probe saw the PostFX output quad built with the pre-pass's MRT
     into the scene pass's target. A three report candidate (Phase 4).
- Step 3 decided (2026-11-06): the full fix. As built (`src/_engine/kernel/render/CLAUDE.md`'s
  Pre-warm compiles):
  - `kernel/render/CompileQueue.ts` (new, `@internal`): `runCompileAsync` runs the engine's
    compiles one at a time; `runWithClearRenderState` runs a render with no target and no MRT
    set and puts back what was (free when nothing is), around `MainLoop`'s whole `runFrame`,
    `renderScene` outside a frame, snapshots (`Snapshot.ts` saves its own previous target inside
    it), the impostor bakes (`withBakeRendererState`) and `getPMREMTexture`'s bakes.
  - The render seam: `RenderPipelineCompiler` (public type on `aekasha`, `api.json` gains it),
    `FeatureContext.setRenderPipeline(provider, compiler?)`, `getRenderPipelineCompiler`.
    PostFX's `compilePostFxScenePasses` compiles in the scene pass's target, then the
    pre-pass's with its MRT, configured as `PassNode.compileAsync` and `setup` configure them
    (samples, the output buffer type, the reversed depth type, the drawing buffer size), and
    skips the pre-pass when the chain was rebuilt meanwhile.
  - `preWarmMesh`: queued, awaits `renderer.init()`, the shadow check at its turn, unculled for
    the call's synchronous part, through the compiler while it returns a promise, else depth 0
    as before. `prewarmGeometry`: queued, its stand-in unculled.
  - Measured with the probe (fresh shaders per run, so the Metal shader cache doesn't hide the
    hitch; two runs): no pre-warm 440-640 ms of hitch, depth 0 ~200 ms, the engine's pre-warm
    through the passes none; the compile takes ~500-570 ms in the background with every frame
    16-18 ms, and no other object is built meanwhile (no state leaked into the frames).
  - Tests: `CompileQueue.test.ts` (new), `Mesh.test.ts` (the queue, the cull flag, the compiler's
    targets and camera), `Geometry.test.ts` (the stand-in unculled), `RenderHooks.test.ts`.
  - The Hub's rendering guide (a Post effects bullet; `aek:covers` gains Pre-warm compiles) and
    `kernel/init/CLAUDE.md`'s `setRenderPipeline`.
  - Left as is: the shadow pass's build isn't pre-warmed (no measurable hitch); a chain switched
    on or off after a pre-warm compiles on its first frame; no app scene uses `preWarm` today.
  - Checked: `tsc`, `tsc -p hub`, lint, `yarn test` (301 files, 2,653 tests), `yarn verify:scenes`
    (113 passed; the Gym's `workerMsg` snapshot failed once with scattered single pixels, mean
    0.5, the hash unchanged, and passed twice on rerun: the known worker target flake), `yarn
    build` (every SBP budget within, the Hub built), `yarn verify:baselines` recorded: first
    download +0.5 kB gzip in the app (`postfx` +0.2, `kernel/mesh` +0.1, `kernel/render` +0.2),
    +0.3 kB in each embed; `api.json` gains this step's exports and step 1's
    `DEPRECATED_ENV_SIZES` and `ENV_BAKE_MIN_SIZE` (not recorded then); no debug code.
- Step 4 done (2026-11-06): each of the 62 "r186" mentions under `src/`, `hub/` and `devTools/`
  checked against r187's source, diffed against r186.1's (`npm pack three@0.186.1` in the
  scratchpad). `devTools/` has none.
  - Still true, now "three (r186, r187)": render objects kept until the object's `dispose`
    (`LodFades.ts`, the LOD `CLAUDE.md`), a disposed geometry's attributes deleted on the GPU
    (`LodChains.ts`, `TextureAtlas.ts`), the impostor atlas's v origin, the instance matrix
    applied before `positionNode` (`OctahedralImpostorMaterial.ts`), `normalLocal` rotated per
    instance and `tangentLocal` not, double-sided normal maps (`CrossQuads.ts`; `Tangent.js`
    unchanged, `Normal.js` lost only deprecated exports), a render target's textures destroyed
    with it (`ImpostorBake.ts`: a render target texture registers no `dispose` listener), VSM
    drawing receivers and a shadow map once per camera and node frame, `FRAME` nodes
    (`Snapshot.ts`), the background's direction traps (`layers/Base.ts`: `materialEnvRotation`
    unchanged), the canvas alpha mode, `needsUpdate`, the GPU memory sizer (compressed 1 B, cube
    faces 1×1), the VSM blur targets and `_frameBufferTargets`, the test bridge's `NodeFrame`
    (`NodeFrame.js` identical), the GLTFParser's image loader test, DRACOLoader's
    `setDecoderConfig` (now "removed in r194"), and Moon's vec2 cast (`tsc` fails without it).
    `ambientOcclusion.postFx.json`'s "no effect since three r186" holds as written: both uniforms
    are still `@deprecated since r186` and unused by r187's GTAO. Ported-from-r186 provenance
    (`Atmosphere.ts`, `Clouds.ts`, `Sun.ts`) and dated r186 findings stay as they are (r187's
    SkyMesh changes are docs and `Fn` layouts only).
  - Corrected: `ImpostorSourceHash.ts` and the impostors `CLAUDE.md` (r187 widens an 8 or 16-bit
    attribute to 32 bits but an index only to 16, a 16-bit one kept; the hash still hashes the
    32-bit form, stable on both, so existing fingerprints stay); `NodeMaterial.clone()` keeps
    `alphaTest` on r187 (a Node check: 0 on r186, 0.5 on r187; r187's `copy` walks the prototype
    chain's setters), in `OctahedralImpostor.ts` and the impostors `CLAUDE.md`; `LodFades.ts`'
    "three keys its builds by uuid" (r186 only: D3); `ImpostorBake.ts`' destroyed-texture note
    (r186 only for 2D targets); the census (`_dbg__Census.ts`, the debug `CLAUDE.md`: r187's
    `StandardDrawingPipeline.project` / `isCulled`, the same rules but a `BundleGroup`'s children
    never culled, which the engine has none of); the frame order in `_dbg__GPUMemory.ts`,
    `_dbg__ProfilerSources.ts` and the debug `CLAUDE.md` (three's own animation frame ran before
    the engine's on r186, started by `init()`, and after it on r187, started by the first
    `render()`; the `LATE_MAIN` sampling is right either way); the smallest-build guide's floor:
    the p611 §7 probe page `webgpuTsl` (`.cache/probe/lite/`) rebuilt on r187 is 215.5 KiB gzip
    (237.7 on r186; `webgpuStandard` 215.2, so the banner's TSL functions now add 0.3 KiB, not
    29).
  - Not re-tested, said so: `layers/Stars.ts`' TSL `If` caching trap (r187 reworked TSL's
    temporary caching, `Node.isCacheable` and assignable nodes; the var stays).
  - `SkyLights.ts`' `castShadow` crash under PostFX: not reproduced on r186 (a detached `main`
    worktree, the control) or r187 with today's engine. Probe (scratchpad `castShadowProbe.mjs`:
    macOS, Chrome, WebGPU, `?isDebug=true&aekTest=true`): every shadow-casting
    `DirectionalLight`'s `castShadow` set false for 30 frames and true for 90, twice, on
    largeWorld (ambientOcclusion, the dayNight sun) and exampleHubHero (heroBloom); PostFX on
    throughout, no WebGPU error on either version. The finding (2026-09-30, three 0.186.1,
    `68e93e89`) predates later PostFX changes. The guard stays (it costs the same one material
    rebuild as a toggle); its remarks and the sky box `CLAUDE.md` say what was and wasn't
    reproduced.
  - Checked: `tsc`, `tsc -p hub`, lint on the changed files, `yarn test` (301 files, 2,653
    tests), `yarn verify:baselines --docs` (unchanged), `yarn hub:build`.

1. **`env.size` below 256** (D1). Measure a day-night bake at 256 against r186's 128 (the
   Environment folder's bake stats, GPU ms, on `skyShowcase`; p110's numbers are r186's) and the
   re-bake rate (`env.maxUpdatesPerSec`). Then decide: keep 64 / 128 as documented aliases of 256
   (today), or make the day-night default 256 explicitly and deprecate 64 / 128 for the next
   major (`@deprecated` in the schema, a warning in the debug env). Done: the second (above).
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

Results so far:

- Step 1 done (2026-11-06): `docs/issues/three-render-list-keeps-lights.md`, `not filed yet`. Its
  standalone page (Chrome 156 headless, Apple M2, macOS 26.5, `--expose-gc`; the run script in the
  scratchpad) on r187.0, 10 visits of a camera, two lights and a mesh through a new
  `RenderPipeline` with an MRT scene pass: 0 / 20 lights and 0 / 10 cameras collected, 13 cached
  contexts; `RenderList.clear()` patched to empty `lightsArray` 20 / 20 lights, 0 / 10 cameras;
  the contexts' `camera` nulled 20 / 20 and 10 / 10; one shared MRT node (D4's workaround) 20 / 20
  and 10 / 10 with 3 contexts. r186.1 keeps every light in every variant (`_bindingGroupsCache`,
  #34705), so the report is r187's. `dev`'s `RenderList.clear()` and `RenderContexts` are r187's.
  A trap for the method: the loop in the module's top level kept its last visit (the suspended
  async frame), which read as a retainer in three; the page runs the visits in a function.
- Step 2 done (2026-11-06): `docs/issues/three-cube-render-target-texture-link.md`, `not filed
  yet`. Its page (r187.0, the same machine): a PMREM target allocated as `_allocateTarget` does,
  the scene's `environmentNode` for 3 frames, then one `fromScene` bake into it: the backend
  creates the texture at the first sample, the bake destroys and creates it (`updateRenderTarget`
  sets `textureNeedsUpdate` on a target's first setup), and all 10 frames after fail with
  "Destroyed texture … used in a submit". `texture.renderTarget = target` first (the suggested
  fix): one create, no error; the clear (our workaround): the same. As a material's `envNode` the
  texture is destroyed and created the same way but its bind group is refreshed: no error (why
  the scene environment's isn't is untraced; the report says so). `dev`'s constructor and setter
  are r187's. r186.1 isn't comparable (CubeUV PMREMs). The remarks on `initEnvBakeTarget` and
  `initTarget` and the sky box `CLAUDE.md`'s "Two traps" name the issue file.
- Step 3 done (2026-11-06): **already fixed on three's `dev`** by #35359 ("WebGPURenderer: Rewrite
  `compileAsync()`", merged 2026-11-05, after r187), so
  `docs/issues/three-pass-compile-holds-renderer-state.md` is a record, not a report (`open |
  fixed upstream on dev`). Its page (a `RenderPipeline` with an MRT scene pass in
  `setAnimationLoop`, 40 new materials pre-warmed through the pass): on r187 every frame during
  the compile starts with the pass's target and MRT, the output quad gets a build in them and
  renders into the pass's own texture while sampling it (2 validation errors a frame, nothing
  drawn); the engine's per-frame guard: none of that. On #35359's sources (a sparse checkout of
  `src/` at `7d4a7890fc`, served locally: jsDelivr refuses three's repo): `PassNode.compileAsync`
  clean; state set by hand and restored right after the synchronous call clean; held until the
  compile resolves (the engine's `compileInScenePassAsync` pattern) still leaks. So for the
  release with #35359: `compileInScenePassAsync` restores right after the call, then
  `runWithClearRenderState` can go after a re-measure, and `runCompileAsync` gets its own check
  (the issue file's last section; `CompileQueue.ts`' header and the render `CLAUDE.md` name it).
  On r187, restoring right after the call doesn't help (each yield puts the pass's MRT back).
- Step 4 is left for later (the user's call, 2026-11-06): steps 1 and 2's files stay `not filed
  yet`; nothing in the engine waits on them (D4 and the clears stay until three ships fixes).

1. An issue file, `docs/issues/three-render-list-keeps-lights.md`, in the form of
   `three-bind-group-cache-light-leak.md` (the report's text, a standalone page as the repro): an
   idle `RenderList`'s `clear()` keeps `lightsArray`, and `RenderContexts` keeps a context per MRT
   id for the renderer's lifetime, each holding the last camera it rendered, so an app that makes
   an MRT per scene keeps each scene's camera and lights. Suggested fixes: `lightsArray.length = 0`
   in `clear()`, and the context's `camera` dropped when its list goes idle (or the context cache
   evicted with the MRT).
2. A second issue file, `docs/issues/three-cube-render-target-texture-link.md` (Phase 3 step 2):
   `CubeRenderTarget`'s cube texture has no `renderTarget` back-link (the constructor's
   `this.texture = new CubeTexture(…)` goes through `RenderTarget`'s `texture` setter, which only
   stores it), so #35204's "created with their render target" path misses cube targets, and a
   cube target sampled before its first render still gets its texture destroyed in place
   ("Destroyed texture used in a submit"). Repro: a `CubeRenderTarget` sampled by a material,
   then rendered into by `PMREMGenerator.fromScene`. Suggested fix: the setter (or
   `CubeRenderTarget`'s constructor) setting `value.renderTarget = this`. Once fixed upstream,
   `initEnvBakeTarget` and `initTarget` can go.
3. A third issue file, `docs/issues/three-pass-compile-holds-renderer-state.md` (Phase 3 step
   3): `PassNode.compileAsync` sets the renderer's target and MRT and restores them only after
   `renderer.compileAsync` resolves, which yields to the next frame every 8 ms
   (`_finishPreCompile` puts back the MRT current at the call), so an app's animation loop
   renders those frames into the pass's target with its MRT. Node builds read the global target
   (`MRTNode.setup`, `NodeBuilder.getOutputType`), so the caller can't restore it early. Repro:
   a `RenderPipeline` with an MRT pass, a new material compiled with the pass's
   `compileAsync` while the loop runs. Suggested fix: carry the target in the per-item
   precompilation state (as the MRT is) and restore the pre-call target and MRT at every yield.
   The engine's guard (`CompileQueue.ts`) stays until then.
4. The user posts them upstream (an outward action) and their numbers go here and in the issue
   files. D4 stays either way.
5. ~~Add the r187 findings to `renderer-custom-tone-mapping.md` and
   `three-animation-classes-in-builds-without-models.md`~~ (done with Phase 1: a "three r187"
   section in each).

### Phase 5: Hub, docs and versioning

Results so far:

- Step 1 done (2026-11-06): the leaks' lines (Phase 2 step 3) and the sky box guide's `env.size`
  (Phase 3 step 1) were in already; the rendering guide's Known issues now also links Phase 4's
  three issue files, each with the engine's workaround (and that a pass compile of an app's own
  still meets the third).
- Step 2 done (2026-11-06): `CHANGELOG.md`'s `upgrade-three-js-to-r187` entry, Engine 6.1.0
  (Sunset) and Project. The toolkit and the app have no changes on the branch, so no sections.
  The sizes are the committed baselines' main chunks (gzip KiB, `main` against this branch), not
  the Context's first-download figures, which include the other initial files.

1. The Hub's rendering guide (`hub/pages/features/rendering/guide.md`, Known issues): the light
   leak and the instance attribute leak are fixed with r187 (link the closed issues); the sky box
   page's `env.size` (the 256 floor).
2. `CHANGELOG.md`: Engine (three r187; the PMREM change and its look; `env.size` 64 and 128
   deprecated, removed in 7.0.0: they bake at 256, the day-night default is 256, and a day-night
   bake costs ~1.8× r186's (Phase 3's table); the LOD fade and impostor build fix; the PostFX pre-pass MRT; a pre-warm compiles for the PostFX
   scene passes and is no longer frustum culled, `FeatureContext.setRenderPipeline`'s `compiler`
   and `RenderPipelineCompiler`, the engine's compiles one at a time and every render without a
   held target or MRT; smaller first download),
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
