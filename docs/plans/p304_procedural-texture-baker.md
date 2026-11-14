Status: in progress | Phases 1-4 implemented
Category: Rendering, Materials, Procedural
Blocks: p305_terrain-material-generator.md (soft: macro noise and ripple atlas), p307_wet-and-dry-surface-states.md (ripple atlas), p309_terrain-decals.md (procedural decals)
Related: \_DONE_p342_dev-file-server.md (D5 writes its PNGs into the set's `source/` through it; its API now: `devTools/devFiles/CLAUDE.md`)
Epic: p301_terrain-texturing-epic.md

# Procedural Texture Baker

A material built from a TSL node graph runs its noise math for every covered pixel every frame. This plan lets a node graph be **baked once** into a mipmapped texture, so per-frame cost drops to one fetch. Baking can happen at load, on a parameter change, or in the browser for export as a committed and KTX2-encoded asset.

It adds:

- **`bakeTexture()`**, engine kernel: TSL node(s) → `Texture` / array texture, with MRT, mips, clear-once, asset ownership, a bake queue and GPU timing.
- **A periodic noise library** in the toolkit, so baked textures tile seamlessly.
- **Procedural surface generators** in the toolkit (one or more per terrain category, plus concrete), usable **baked** (as procedural texture sets) or **live** (evaluated in the material; never tiles, costs ALU).
- **Shared generated textures**: macro noise (p305) and the rain ripple atlas (p307).
- A debug "export PNG" tool: bake in the browser, commit the PNG, and let p300 encode it to KTX2. This is the bridge between the procedural and imported workflows.

---

## Context (grounded, re-grounded 2026-11-04)

- **Bake precedents:**
  - **The sky box's static layers** (`features/skybox/SkyStaticLayers.ts`) bake a `NodeMaterial` into a HalfFloat `CubeRenderTarget` (no mipmaps), throttled to one bake per `STATIC_LAYERS_THROTTLE_MS` (150 ms), skipped while a scene loads or before `renderer.hasInitialized()`. Its `initTarget` clears each face once on allocation: three (r186, r187) otherwise destroys the placeholder GPU texture in place on the first render without invalidating bind groups ("Destroyed texture used in a submit"; `src/_engine/features/skybox/CLAUDE.md`'s traps). The env bake (`SkyEnvironment.ts`) does the same. r187's fix (#35204: a sampled render target texture is created with its target) misses cube targets, whose texture has no `renderTarget` link (p057 Phase 3); a 2D or array target sampled before its first bake is safe on r187, a `CubeRenderTarget` needs the clear.
  - **The impostor bakes** (`features/lod/impostors/ImpostorBake.ts`, p351) are the closest: synchronous 2D bakes between frames into atlas targets, through `getBakeRenderer`, `withBakeRendererState` (restores the renderer state it touched) and `clearBakeTarget` (the clear-once rule), with a dilation pass and a readback for the export. The Assets tab's GPU preview (`kernel/assets/debug/_dbg__TexturePreview.ts`, p299) reuses them and reads back with `readRenderTargetPixelsAsync` (WebGPU rows top-first and padded to 256 bytes, WebGL2 bottom-first).
  - These helpers are in the LOD feature: the kernel may import a feature's types only (p612 D2, a lint rule), so a kernel `bakeTexture` can't use them where they are (D1).
- **QuadMesh precedent:** `features/viewports/Viewports.ts` composites with `THREE.QuadMesh`, saves and restores the render target, cube face and mip level, and never touches the scissor test (a leaked scissor breaks PMREM, three #31777).
- **GPU timing:** one owner, `debug/_dbg__GPUTimer.ts` (`_acquireGpuTimer`, `_onRenderContext`; a frame's sum is `debug/_dbg__GPUFrameTimes.ts`' `_acquireGpuFrameTimes` / `_onGpuFrameTime`; WebGPU with `timestamp-query`, WebGL 2 with `EXT_disjoint_timer_query_webgl2`; `src/_engine/debug/CLAUDE.md`'s GPU timing). The sky box's bake stats (`features/skybox/debug/_dbg__BakeStats.ts`) time each bake through it: the model for D1's stats.
- **Noise in the repo:**
  - `mx_noise_float`, `mx_fractal_noise_float` and `mx_worley_noise_float` (`toolkit/materials/asteroid/asteroid.tsl.ts`, `features/skybox/layers/Stars.ts`, `layers/Nebula.ts`).
  - `Nebula.ts` warns that `mx_fractal_noise_vec3` **hangs SwiftShader's WebGL2**.
  - None of these are periodic, so baking them gives visible tile seams.
- No `renderer.compute`, `StorageTexture` or render-target-array usage exists yet.
- **Dev files** (D5): `aekasha/debug` has `encodePNG`, `writeDevFiles`, `readDevFile` and `getDevFilesStatus` (`debug/DevFiles.ts`); the impostor export (`features/lod/debug/_dbg__ImpostorExport.ts`) is the worked example of a bake written into the repo through them, with the download fallback.

---

## Design

### D1 — `bakeTexture` (engine: `kernel/render/TextureBaker.ts`, on `aekasha`)

```ts
type BakeOutput = { name: string; node?: Node; colorSpace?: 'SRGB' | 'LINEAR'; type?: 'UNSIGNED_BYTE' | 'HALF_FLOAT' };

bakeTexture(opts: {
  id: string;                         // each output registered with saveTexture as `<id>.<name>`, owned like any texture
  size: number | [number, number];    // power of two recommended (mips, KTX2 export)
  outputs: BakeOutput[];              // 1 = plain target; 2-4 = MRT, one texture per output
  layers?: number;                    // > 1 = array texture; the graph reads `bakeLayer` (int uniform)
  build?: (ctx: { uv: Node; layer: Node; texel: Node }) => Record<string, Node>; // nodes by output name, for the outputs without a `node`
  mipmaps?: boolean;                  // default true
  wrap?: 'REPEAT' | 'CLAMP';          // default REPEAT
  anisotropy?: number | 'MAX';
  isPersistent?: boolean;
}): Promise<BakedTexture>;            // { textures: Record<name, Texture>, rebake(params?), dispose() }
```

- **Decided (2026-11-13):**
  - **Output ids:** each output is registered as `<id>.<name>` (the impostors' and set arrays' `<id>.<slot>`), a single output too.
  - **`node` or `build`:** an output's `node` is optional when `build` is given; `build` returns the nodes by output name, and an output with neither throws.
  - **Memory:** `getBakedTextureMemoryBytes({ size, outputs, layers?, mipmaps? })` is pure (unit-tested), and `BakedTexture.memoryBytes` carries the bake's.
  - **Phase 1's scheduling:** the bake renders right after its compile (no queue; Phase 2 adds it); after the compile's `await` it re-checks that it wasn't disposed and that no later `rebake` took over.
  - **The same id again:** `bakeTexture` with the id of a bake that's alive returns that bake (as `saveTexture` does; the debug env warns): dispose it first, or `rebake`.
- **Render:** a full-screen `QuadMesh` with a `NodeMaterial` whose output is `mrt({ … })` for several outputs.
  - Several outputs mean one `RenderTarget` with `count: n`.
  - Layers are rendered one by one into an array render target (three's array render target, chosen by layer). If three can't target array layers on both backends, the fallback bakes each layer into a 2D target and assembles them into a `DataArrayTexture` (p299's uncompressed path in `buildTextureArray`). three r187 fixed single-layer array render targets (#34510) and layer detection in `copyTextureToTexture()` (#35111) on the WebGL backend, which this path relies on: check on r187 or later.
  - **The bake helpers move to the kernel:** `getBakeRenderer`, `withBakeRendererState` and `clearBakeTarget` go from `features/lod/impostors/ImpostorBake.ts` to `kernel/render/BakeRenderer.ts` (`@internal`), and the impostor bakes and the texture preview import them from there. `withBakeRendererState` restores the target with its cube face and mip level (it already did before the move), the clear colour and auto clear, and the bake never touches the scissor, as `Viewports.ts`. `getBakeRenderer` throws before `InitEngine`; the impostor atlases' registered texture disposing its render target is the model for D1's ownership (`src/_engine/features/lod/impostors/CLAUDE.md`).
- **Clear once on allocation** (`clearBakeTarget`), the same rule as `initTarget`.
- **Mipmaps:**
  - Turn on the target texture's `generateMipmaps` and verify that three (r187 or later) generates them after the render on both backends.
  - Bake many layers or passes into one mipped target with `texture.mipmapsAutoUpdate = false` (three r187, #34630: the mips stay allocated, but they aren't regenerated after every render into it, which WebGPU's `finishRender` otherwise does), and set it back to `true` before the last render, so the mips are built once.
  - If not, add a small downsample chain (box filter, one `QuadMesh` pass per level), which also lets alpha-as-data be averaged correctly.
- **Pipeline compile:** `renderer.compileAsync(quad, camera)` before the first bake, so compiling doesn't stall the frame.
- **Scheduling:**
  - During scene load, bakes run inside the loader's hold, with loader status updates (`getLoaderStatusUpdater`).
  - Outside loads they queue into `textureBakeSystem` (`MAIN`), which runs at most one bake per frame and throttles rebakes of the same id to one per 150 ms (the latest request always runs; same rule as the static layers). The system is added by the first queued bake, not at module load or in the kernel's install, so an app that never bakes runs (and ships) none of it (SBP: nothing registers at load).
  - Async rules (the coding standards): after each `await` the bake re-checks that its id is still wanted and the scene that owns it is still current; a later `rebake` of the same id wins, and `dispose()` during a bake drops its result.
- **Memory:** `getBakedTextureMemoryBytes()` (RGBA8 1K + mips ≈ 5.6 MB; HalfFloat doubles that). This number goes into each page's "VRAM" section.
- **Stats (debug only):** last bake GPU ms per id through `_dbg__GPUTimer`, in a `_dbg__` module next to the baker (`kernel/render/debug/_dbg__TextureBakeStats.ts`, as the sky box's `_dbg__BakeStats.ts`), loaded through the debug loader (`useDebug` / `loadDebugModuleAsync`) so a production build folds it away. Shown in the gallery tab and, as a profiler figure, through `registerStatsSource` (`debug/Profiler.ts`: its Overview's App rows) later.

### D2 — Periodic noise library (toolkit: `src/toolkit/terrain/nodes/noise/`, on `aekasha/toolkit/terrain`)

Tileable baking needs noise with an integer period over the tile:

- `periodicValueNoise(p, period)`, `periodicGradientNoise(p, period)`: hash on `mod(cell, period)`.
- `periodicFbm(p, period, octaves, lacunarity = 2, gain)`: the period doubles with each octave, so every octave tiles.
- `periodicWorley(p, period) → { f1, f2, cellId }`: F1 gives pebbles, F2 − F1 gives cracks and cell edges.
- `domainWarp(p, period, strength)`.
- Each also has a **non-periodic** variant (`period = 0` selects it at build time) for live use in world space.
- Helpers:
  - `heightToNormal(heightFn, uv, texel, heightScale)`: central differences on the analytic height, so 4 extra evaluations at bake time only.
  - `heightToCavity(heightFn, uv, radius)`: 8-tap ring, for AO.
  - `hash22`, `hash12`.
- All of these use our own hashing, not `mx_*`, so they're safe on SwiftShader and deterministic across backends up to float precision. GPU float differences make baked textures visual-only data. Never derive gameplay from them.

### D3 — Procedural surface generators (toolkit: `src/toolkit/terrain/procedural/`, on `aekasha/toolkit/terrain`)

- **Shape:** each generator is `defineSurfaceGenerator({ id, category, params: ZodSchema, defaults, build(ctx, params) → { albedo, height, roughness, ao?, normal? } })`. `normal` defaults to `heightToNormal` and `ao` to `heightToCavity`.
- **Packing:** the generator's output is packed into the requested packing (FULL/LITE/MINIMAL from p303 D2) by a shared `packSurfaceOutputs` node function. A baked procedural set is therefore indistinguishable from an imported one.

| Generator       | Category | Idea                                                                             | Notable params                                  |
| --------------- | -------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `sandRipples`   | SAND     | Wind ripples (directional sine on warped coordinates) + grain noise              | direction, wavelength, warp, grain, colour pair |
| `sandFlat`      | SAND     | Fine grain + low-contrast mottling (a beach)                                     | grain, mottling, colours                        |
| `mudCracked`    | MUD      | Worley F2−F1 cracks, dried-mud plates curled at edges                            | crack width, plate size, moisture tint          |
| `mudSmooth`     | MUD      | Smooth fbm with glossy low spots (pairs with p307 puddles)                       | lumpiness, colours                              |
| `rockyGround`   | ROCKS    | Worley F1 pebbles with per-cell colour and height, fill noise between            | pebble size, density, colour spread             |
| `cliffStrata`   | CLIFF    | Banded strata along Y + fbm + crack lines (meant for triplanar; tiles in its UV) | strata frequency, tilt, crack density           |
| `snowDrift`     | SNOW     | Soft fbm drifts, roughness sparkle variation, faint blue AO                      | drift scale, sparkle                            |
| `iceSheet`      | ICE      | Cracks (Worley edges at two scales) + bubble specks; low roughness               | crack scales, bubble density, tint              |
| `grassGround`   | GRASS    | Ground seen through short grass: clumpy greens on soil, fine streak noise        | clump scale, green range, soil show-through     |
| `concretePores` | CONCRETE | Fine pores, fbm stains, form-work seams (optional)                               | pore density, stain strength, seam spacing      |

- **Procedural texture sets.** `*.textureSet.json` gains an alternative to `packings`:
  ```json
  "procedural": { "generator": "sandRipples", "params": { "wavelength": 0.12 }, "seed": 7, "size": 1024, "packing": "LITE" }
  ```
  - On load the set is baked (D1) into its packing's slots and then behaves like any set.
  - **Array limitation:** baked textures are uncompressed RGBA8 and imported sets are block-compressed, so they can't share a layer array. A terrain material uses either all-procedural or all-imported arrays, or the separate-binding path. p305 validates this and says so in the error.
- **Live mode.** The same `build` runs inside a material in world space with non-periodic noise.
  - p305's `proceduralLive` layer source uses it.
  - It never repeats and costs only ALU, which makes it useful for comparison and for large stylized surfaces.
  - It is too costly for first-person photoreal on low-end hardware, and the handbook page says so with gallery measurements.

### D4 — Shared generated textures (toolkit: the bake code in `src/toolkit/terrain/textures/`, the exported assets in `src/toolkit/textures/<id>/`)

- **`macroNoise`** (512², RGBA8, tileable over a large period):
  - R = low-frequency fbm (brightness);
  - G = a second fbm, decorrelated (hue / roughness);
  - B = Worley cells (patch masks);
  - A = blue-ish noise (dithering, the rule-noise base).
  - It is sampled by p305 at 1/40–1/300 m scales.
  - It is baked once at load, or exported and committed as KTX2 (`src/toolkit/textures/macroNoise/`; slot `data`, whose default codec is `none`, or UASTC set per asset; it's data).
- **`rippleAtlas`** (256², 4×4 cells, RGBA8): per cell, an expanding ring at a random phase. RG = ring normal XY, B = ring mask, A = cell time offset. p307 animates it with two time-offset samples.
- **`blueNoise`** (64², R8): a void-and-cluster approximation baked once, for dithered transitions (optional).

### D5 — Export to PNG (debug only)

- **Where:** in the gallery tab, and as `exportBakedTexture(id, output)` in `kernel/render/debug/_dbg__TextureBaker.ts` (debug only, reached through the debug loader).
- **What:** reads the target back with `renderer.readRenderTargetPixelsAsync` (per mip 0 only; mips are rebuilt by p300), encodes it with `encodePNG` (`aekasha/debug`; `flipY` if the readback is bottom-up) and writes `<id>_<output>.png` (8-bit; `HALF_FLOAT` outputs are tone-clamped with a warning) into the chosen texture set's `source/` (`src/toolkit/textures/<setId>/source/`, or an app set's; beside the gitignored `source/raw/` of fetched maps, p303 D5) with `writeDevFiles` (the dev file server: its paths and refusals in `devTools/devFiles/CLAUDE.md`). Overwriting an existing PNG asks first (it's read with `readDevFile` and its hash passed as `expectedHash`). When `getDevFilesStatus()` is unavailable (a LAN device, a build), it downloads the PNG instead.
- **Workflow** (documented in `procedural-textures.md`):

  1. Tune a generator live in the gallery.
  2. Export into a texture set's `source/` (committed, since it's not re-downloadable).
  3. Write pack recipes.
  4. `yarn assets` (the dev server already encodes a set its gather reads; `yarn assets` prunes stale outputs before a commit).

  The result is a compressed, imported set born procedural. It is the best of both: unique looks, made in-engine, compressed in VRAM, no bake at load.

---

## Phases

### Phase 1 — Bake core (D1, single output, 2D) — done

1. Move `getBakeRenderer`, `withBakeRendererState` and `clearBakeTarget` into `kernel/render/` (the impostor bakes and `_dbg__TexturePreview.ts` import them from there; the scene runner's LOD and texture scenes unchanged).
2. `bakeTexture`, clear-once, state save/restore, mip check (or downsample chain), ownership, memory number; summaries and `@example`s (it's on `aekasha`), unit tests for the pure parts (the memory figure, the throttle).
3. A debug-scene check (`testDebugScene`): bake a checker, sample it on a plane.

**Exit:**

- No "destroyed texture" errors on WebGPU.
- Identical output on WebGL2.
- Mips visibly present at a grazing angle.

**As built:**

- **Files:** the bake helpers in `kernel/render/BakeRenderer.ts` (step 1, commit `194fdcd5`); `kernel/render/TextureBaker.ts` (`bakeTexture` and its types); the pure sizes in `kernel/render/TextureBakeMemory.ts` (`getBakedTextureMemoryBytes`, public; `getBakeSize`, `getMipChainTexels`, `@internal`) with `TextureBakeMemory.test.ts`. On `aekasha`: `bakeTexture`, `getBakedTextureMemoryBytes`, `BakeBuildContext`, `BakedTexture`, `BakeOutput`, `BakeOutputType`, `BakeTextureOpts`, `BakedTextureMemoryOpts`.
- **Mips:** three r187 generates a render target's mips after the render on both backends (WebGPU here; WebGL2 through SwiftShader, `DRIVER_WEBGL=1`), so there's no downsample chain. The Risks row is settled for single renders; Phase 2's many-layer bakes still need `mipmapsAutoUpdate` (D1).
- **The render:** the material carries its own full-screen triangle `vertexNode` (three's `QuadMesh` triangle) and the bake calls `renderer.render(quad, quad.camera)`, not `quad.render()`: `QuadMesh.render()` swaps in its own `vertexNode` for the call, which the compile wouldn't see, so the compile would build another pipeline. The compile runs in the bake's target with no MRT, through `runCompileAsync`, and puts the target and MRT back (PostFX's `compileInScenePassAsync` pattern), because the build reads the target's colour space and type.
- **Orientation:** a material sampling the baked texture at a uv reads what the graph wrote at that uv (`ctx.uv` (0, 0) is the target's first row, as a render target's v = 0 is the top of the rendered image on both backends). For D5: the readback (`readRenderTargetRGBA8Async`) is top row first, so a PNG written as read has v = 0 at its top, where an imported PNG's top row is sampled at v = 1: the export must flip the rows to round-trip (check in Phase 5).
- **The handle:** `BakedTexture` is `{ id, textures, memoryBytes, rebake(), isDisposed(), dispose() }`. `rebake()` takes no params: it renders the graph again with its uniforms' current values (set them first), and a call during the first compile waits for it. Phase 2 decides whether `params` are needed (Phase 4's generators may set uniforms by name).
- **Phase 1's limits, lifted in Phase 2:** more than one output or layer throws; `ctx.layer` is an int uniform fixed at 0.
- **Ownership:** the texture is registered before the first `await`, so the scene loading owns it; deleting it (the scene's release, `deleteTexture`) disposes the target, the material and the bake, and a bake disposed during its compile never renders. A texture registered under an output's id by anything else throws (an exported KTX2 copy, later). SRGB needs `UNSIGNED_BYTE` (throws).
- **GPU memory tab:** baked textures are registered textures, which it lists already, so no `registerGPUMemorySource`.
- **The check (`testDebugScene`, `createTextureBakeCheckAsync`):** two floor strips left of the bottom row, a 64² checker (4 texels a cell) with a u (red) and v (blue) tint, baked with mips and, as the control, without: the mipped strip's far end is an even tint, the control's moirés, the same on WebGPU and WebGL2, with no console errors. The scene runner's `testDebugScene` snapshot changes there (record it again); its `debugger` shots were already stale since p303 (the material editor's list, the About window's versions).

### Phase 2 — MRT, arrays, scheduling (D1) — done

1. MRT outputs, array layers (or the 2D + assembly fallback), `compileAsync`.
2. `textureBakeSystem` queue, throttled rebake, loader integration, GPU timing.

**Exit:** a 3-output, 4-layer bake runs during scene load with progress shown, and a rebake from a slider never bakes more than once per frame.

**As built:**

- **No fallback:** three r187 renders into an array target's layer on both backends (`setRenderTarget(target, layer)` on a `RenderTarget` with `depth` > 1: WebGPU's `baseArrayLayer`, WebGL's `framebufferTextureLayer`), so there's no 2D + `DataArrayTexture` assembly. The Risks row is settled.
- **One target:** `count` = the outputs, `depth` = the layers; each texture gets its output's `type` and `colorSpace` (sRGB is the attachment format, `rgba8unorm-srgb`, so outputs mix) and its registry id `<id>.<name>` as its `name`. Several outputs are `fragmentNode = mrt({ '<id>.<name>': node })`: three's `MRTNode` finds an output's attachment by its texture's name, and an output struct as `fragmentNode` passes `NodeMaterial`'s fragment setup untouched. 1 to 4 outputs (WebGPU's default `maxColorAttachmentBytesPerSample`, 32, and an RGBA8 attachment costs 8 there), 1 to 256 layers (its default `maxTextureArrayLayers`); names required and unique.
- **Layers:** rendered one by one, `ctx.layer` an int uniform set before each; `mipmapsAutoUpdate` off until the last layer's render, so the mips (every layer's: WebGPU's mip pass walks `depthOrArrayLayers`) are built once. `clearBakeTarget` takes a `layer` (default 0), and the allocation clear clears every layer with the mips off.
- **`sampleArrayLayer`** (p299) also takes three's `isArrayTexture`: a baked array is neither a `DataArrayTexture` nor a `CompressedArrayTexture`. A baked array has no member list, so its layers are sampled by index.
- **The queue** (`kernel/render/TextureBakeQueue.ts`, pure, `TextureBakeQueue.test.ts`): one request per id, run in first-request order, one per `runNext(nowMs)`; requests made before it runs join it (its latest `run`, every promise settled together); a rebake of an id waits `TEXTURE_BAKE_THROTTLE_MS` (150) of `getElapsedTime()` after its last run, the latest request always running; `markRun` settles a request a load's render covered, `cancel` drops a disposed bake's. `textureBakeSystem` (`MAIN`, order 0) is added to the default world (a `WeakSet` of worlds) by the first queued render, never at load.
- **When a bake renders:** outside a load every render queues, the first one too, so `bakeTexture` resolves on the frame `textureBakeSystem` runs it. During a load (`isCurrentlyLoading()`) it renders at once, after its compile. `rebake()` before the first render resolves with it (that render reads the latest values); after it, it requests a render. Queued renders run in `MAIN`, so they wait while an editor view shows or the main loop is paused (the remarks say so).
- **Loader integration:** not through `getLoaderStatusUpdater`, whose params are scene code's own (the template's `loadedCount` / `totalCount`): a new optional `SceneLoader.updateBakeStatusFn(loader, { id, bakedCount, totalCount })` (`SceneLoadBakeStatus`, on `aekasha`), called through `reportSceneLoadBakeStatus` (`@internal`, the running load's loader) when a bake started during the load starts and when its first bake ends (rendered, failed or disposed). The counts start at the load's first bake and are dropped when it settles (`runWhenSceneLoadSettled`). The template's loader (`src/index.ts`, the Hub's `app-scene-loader` region) shows "Baking textures, n / m"; the UI kit walkthrough says so.
- **GPU timing:** the sky box's tracker moved to `debug/_dbg__BakeStats.ts` (`createBakeStats`, shared); `kernel/render/debug/_dbg__TextureBakeStats.ts` keeps one per id for the page's life, loaded through `loadDebugModuleAsync` before a bake's first render (debug env), and every render (all its layers) is timed. `getTextureBakeStats(id)` (on `aekasha`, `TextureBakeStats`: `bakes`, `cpuMs`, `gpuMs`, `bakesPerSec`, the tracker's formatted view) is undefined outside the debug env. GPU ms on WebGPU only (the tracker's rule); 0.2-0.4 ms for the 128² 3-output 4-layer bake on an M2. The profiler figure (`registerStatsSource`) is still later.
- **`params` on `rebake`:** not added; Phase 4's generators set their uniforms and call `rebake()`.
- **The check (`testDebugScene`, `createLayeredBakeCheckAsync`):** a 128² bake of three outputs (sRGB `albedo`, linear `data`, `HALF_FLOAT` `hdr` of 4 shown at a quarter) and four layers, 12 tiles between the top row and the crates, identical on WebGPU and WebGL2, each layer's mips present (sampled at level 5). It bakes during the load: the loader shows "Baking textures, 0 / 2 … 3 / 3". The scene's "Texture bakes" tab (`_dbg__testDebugScene.ts`) has the `phase` slider, a "Rebake ×20" burst and the stats: 60 slider changes over 41 frames (684 ms of the test clock) made 6 bakes, the burst one. The scene runner's `testDebugScene` snapshot changes again (record it).

### Phase 3 — Noise library (D2) — done

**Exit:**

- Each periodic function tiles seamlessly in a 3×3 repeat preview.
- The non-periodic variants match the periodic ones statistically.
- SwiftShader WebGL2 doesn't hang (`yarn verify:scenes --webgl --only <the check scene>`).

**As built:**

- **Files:** `src/toolkit/terrain/nodes/noise/`: `Period.ts` (`NoisePeriod`, the check, the cell wrap), `Hash.ts`, `Noise.ts`, `Worley.ts`, `HeightMaps.ts`, a `*.test.ts` each; all on `aekasha/toolkit/terrain`. The `terrain/nodes/` layout rule covers the folder.
- **Names (decided 2026-11-13):** not D2's `periodic*`. `valueNoise`, `gradientNoise`, `fbm`, `domainWarp`, `worley`, `hash12`, `hash22`, `heightToNormal`, `heightToCavity`, each with an optional `period`: left out or 0 is the non-periodic variant (live, world space), chosen at build time.
- **2D only** (`p: Node<'vec2'>`, in cells): a bake's uv, p305's world xz and `cliffStrata`'s UV are all 2D.
- **Options objects** (the coding standards): `valueNoise(p, { period?, seed? })`, `gradientNoise(p, { period?, seed? })`, `fbm(p, { octaves, lacunarity? = 2, gain? = 0.5, period?, seed? })`, `domainWarp(p, { strength, octaves? = 3, lacunarity?, gain?, period?, seed? })`, `worley(p, { period?, seed?, jitter? = 1 })`, `hash12` / `hash22(p, { period?, seed? })`, `heightToNormal(height, { uv, texel, heightScale })`, `heightToCavity(height, { uv, radius, strength? = 4 })`. The height helpers take the height as a function of uv (`HeightFunction`).
- **The period:** a whole number, a pair, or a vec2 node (a uniform: a slider changes it without a rebuild; its octave periods are rounded in the shader); a fraction or a negative throws (it would leave a seam). The wrap is `cell − period × floor((cell + 0.5) / period)`, not TSL's `mod`: WGSL's division may be off by 2.5 ULP, and `mod(9, 3)` could floor to the wrong period. `hash12` / `hash22` take a period too, so per-cell variation tiles.
- **fbm's octaves:** each octave's period is `round(period × lacunarityⁱ)` (at least 1) and its frequency that over the period, so every octave tiles at any lacunarity (4, 10, 25 at 2.5); each octave has its own seed; 1 to 12 octaves, unrolled at build time; `gain` can be a node. The sum is divided by the amplitudes' sum.
- **Ranges:** value, gradient and fbm about −1..1 (gradient × √2; fbm mostly within ±0.5); Worley `f1` / `f2` in cells (`f1` up to about 1.06 at jitter 1), `cellId` and the hashes [0, 1) (the top 24 bits: never 1); the normal a unit vector, +Y along +v; the cavity 0..1, 1 open.
- **The hash:** pcg2d (Jarzynski and Olano 2020), per component (WGSL shifts a vector only by a vector), the cell through int to uint (a negative float straight to uint saturates at 0 on WGSL), the seed × the golden ratio's odd constant xored into x. A seed is a whole number (wrapped to 32 bits) or an int / uint node.
- **Shader functions:** the hash, value and gradient noise and Worley (a plain and a periodic one each) are layout functions (`Fn` with a full layout: `aekHashCell`, `aekGradientNoisePeriodic`, `aekWorley`, …), one function each in a shader however often a graph calls them; fbm, the warp and the height helpers call them inline. three's call node doesn't cache its result, so `worley` stores its `vec3` in a `.toVar()` and `f1`, `f2` and `cellId` read it: one 3 × 3 search per call (checked in the WGSL and GLSL: one call, 11 hashes).
- **Worley:** a 3 × 3 search, exact F1 at jitter ≤ 1 (a larger number throws); `cellId` is a separate hash of the nearest cell (its own seed).
- **The check scene (`src/app/scenes/noiseLibrary/`):** a 3 × 3 grid of tile pairs, a function each: the periodic bake (256²) repeated 3 × 3 on one quad, beside the same graph live without a period (`noiseRows.ts`). During the load each function is baked at 32 cells, periodic and offset non-periodic, read back (`readRenderTargetPixelsAsync` on the texture's `renderTarget`) and checked (`noiseChecks.ts`, tested): the wrap step against the largest step inside, `|f(uv) − f(uv + (1, −2) tiles)|` within a byte of 0, the means within 0.03 and the spreads within 10 % + 0.01. A failure is an `lerror`, so the scene runner fails on it; `window.__noiseLibrary` and the scene's "Noise library" tab show the figures. Every function passes on WebGPU and WebGL2 (SwiftShader, no hang; `yarn verify:scenes --webgl --only noiseLibrary`, 15-28 s a configuration), with the same figures to the third decimal. At 32 cells the seam check is weak (the steps inside are large): the periodicity check carries it, and the 6-cell tiles show a seam.
- **Phase 4 builds on:** the generators' `build` reads these through `aekasha/toolkit/terrain` with `period: <the generator's cells>` baked and no period live; `normal` defaults to `heightToNormal(height, { uv, texel: ctx.texel, heightScale })` and `ao` to `heightToCavity`; a generator's scale param can be a uniform `period` (no rebuild). The live mode's `heightToNormal` costs 4 height evaluations a pixel: p305's live layer source may prefer `bumpNormalView` (the material's derivatives) there.

### Phase 4 — Generators and procedural sets (D3) — done

1. `defineSurfaceGenerator`, `packSurfaceOutputs`.
2. The 10 generators.
3. `procedural` in the texture set schema (both documentation layers); bake on load; validation against arrays.
4. Live-mode wrapper for p305.

**Exit:** every generator bakes into all three packings and looks right on a gallery block.

**Decided (2026-11-14), where the code had moved past D3:**

- **The engine reaches a generator through the gathered code** (A): a generator is a `<id>.generator.ts` module (in `src/toolkit/terrain/procedural/<id>/`, or an app's), the gatherer writes `textureSetGeneratorObjects` (`() => import(…)` by id) into `generatedAppFns.ts` as it does `tslMaterialFileObjects`, and the layer lint's generated-code exception takes `*.generator.ts` beside `*.tsl.ts`. An unknown `generator` fails the gather; each generator is its own chunk; an app without a procedural set ships none. The engine side is a type only, `TextureSetGenerator` (`{ id, category, buildPacking(bakeCtx, { packing, params, seed, physicalSize, heightScale }) }`, on `aekasha/texturesets`), which the toolkit's generators satisfy, so the engine imports no toolkit code.
- **Params without zod** (D3's `params: ZodSchema` would put zod into the toolkit's runtime: 22 kB gzip, the texture sets' trap): a plain spec per param (`number` with `min` / `max` / `step`, `color` as sRGB `#rrggbb`, `boolean`), checked when the graph is built (the error names the generator and the param; section 3's load names the set too); the gather checks only the values' shape. Numbers and colours are uniforms (a slider rebakes without a rebuild); `isStatic` numbers and booleans are build-time values (octave counts, a seam toggle). The same spec gives Phase 6's gallery sliders.
- **One packing per procedural set JSON** (`procedural.packing`, the set's only and default packing). The exit's "all three packings" is checked from code (`bakeSurfaceGenerator`).
- **Set arrays refuse a procedural set** (stronger than D3's "no mixing"): `TextureSetArray.ts` assembles members on the CPU (KTX2 levels or an image's canvas readback), which a render target texture can't be. An all-procedural array (one layered `bakeTexture`) is p305's, if it wants one.
- **The exit's check is its own verification scene, `proceduralSurfaces`** (the 10 generators on blocks, a packing switch in its tab, readback checks that each slot is written and each bake tiles, reusing `noiseLibrary`'s `noiseChecks`), with a procedural set JSON or two for the JSON path. Phase 6 adds the gallery's "Procedural" row as planned.

**As built (section 1):**

- **Engine:** `features/texturesets/TextureSetGenerator.ts` (types only): `TextureSetGenerator`, `TextureSetGeneratorBuildOpts`, `TextureSetGeneratorParams`, and `TextureSetCategory` (the schema's, a type), on `aekasha/texturesets`.
- **Toolkit** (`src/toolkit/terrain/procedural/`, its layout rule; all on `aekasha/toolkit/terrain`): `SurfaceParams.ts` (the spec types; `buildSurfaceParams`, `checkSurfaceParamSpecs` `@internal`), `PackSurface.ts` (`packSurfaceOutputs`, `getSurfacePackingOutputs`, `doesPackingStoreNormal`; the packings' slots repeated, not the schema's value, which brings zod), `SurfaceGenerator.ts` (`defineSurfaceGenerator`; `createSurfaceContext`, `buildSurfacePacking` `@internal`), `BakeSurface.ts` (`bakeSurfaceGenerator` → `BakedSurface`: `bake`, `packing`, `generator`, `get/setParams`, `get/setSeed`; LITE and 1024² by default; an id's surface returned while its bake is alive or baking). A test each.
- **The context:** `uv` in tiles, `isLive`, `tileSize` (metres), `texel` (live: a 1024² texel), `cells(count)` (a whole number baked, a float node rounded in the shader; live, period 0), `seed(index?)` (a uint uniform, the derived ones stepped by an odd constant).
- **The defaults:** the normal `heightToNormal` at `heightScale / physicalSize.x`, only for `FULL` and `LITE`; the AO `heightToCavity` at `cavity.radius` (metres, default 0.03) / `physicalSize.x`, strength 4. Their taps call one layout function per build (`aekSurfaceHeight_<id>_<n>`, named apart so two in one shader don't clash) whose inputs are the uv, the seed and the uniform params: three caches a layout function's code per backend (`buildFunctionNode`), so a body reading a uniform itself would lose the uniform's declaration in the next shader built with it. The point's own height is the surface's (no extra evaluation). Not yet compiled on a GPU: section 2's scene checks it on both backends.
- **The seed is a uniform too,** so a seed slider rebakes without a rebuild.

**As built (section 2):**

- **The generators:** `src/toolkit/terrain/procedural/<id>/<id>.generator.ts`, each exporting `generator` (the gathered loader's name, section 3), on `aekasha/toolkit/terrain` as their id (`export { generator as sandRipples } …`); `SurfaceNodes.ts` holds their `@internal` helpers (`toUnit`, `perCell`, `below`). `ctx.cells` also takes a pair or a vec2 node (cells longer on one axis: the strata's cracks, the grass's blade streaks). Scale params are in metres (`tileSize.x / size` cells, rounded in the shader), so a slider changes them without a rebuild.
- **Departures from D3's table:** `cliffStrata` has no linear tilt but an `undulation` (bands bent by a periodic fbm): bands that differ can't tile under a tilt (a tile's edge would meet another band), so a tilt is the material's (turn the UV). `concretePores`' seams are a static toggle plus a static `seamCount`. `sandRipples`' direction and wavelength are rounded to whole waves per tile along each axis when baked.
- **The check scene** (`src/app/scenes/proceduralSurfaces/`, a debug scene): the 10 generators on 6 × 6 m generated blocks with a 35° ramp (two rows of five), each `bakeSurfaceGenerator` 512² `LITE`, drawn by `surfaceShading.ts` (the bake's textures as a `{ textureSet }`-like bundle through `sampleTextureSet`, world tiling over the generator's `physicalSize`). During the load (`surfaceChecks.ts`, tested): the shown `LITE` bake and a 256² `FULL` and `MINIMAL` bake read back, each slot's channels as p303 D2 packs them (varies, or a mean range: the normal's B ≥ 0.75, A 1, ORM's B 0) and no seam; and a 256² bake of `|slot(uv) − slot(uv + (1, −2))| × 100` of the `LITE` slots through `buildPacking` at both points (a texel is off past 4 / 25500; at most 0.1 % off: a texel within float precision of a Voronoi edge may pick the other cell). A failure is an `lerror`. Its tab: the shown packing (every block baked again) and each generator's results; `window.__proceduralSurfaces` holds the results and `viewBlock(id | null)` (a block's close-up, or the overview). `noiseChecks.ts`' image statistics moved to `src/app/shared/channelStats.ts` (two scenes use them).
- **Measured (2026-11-14, M2, WebGPU):** every generator passes in every packing; the 40 load bakes take 3.5-4.7 s; a whole tile away, no texel is off (the largest difference 2 / 25500). WebGL2 through SwiftShader (no hang): the same passes and figures, the same picture, the load 206 s (software rendering: the scene runner's `--webgl` run needs a long timeout). The height function with the uniforms as its inputs compiles and runs (section 1's open point). Looks: a baseline next to the imported sets (the scene's DAY_NIGHT light makes light albedos read pale, as the gallery's sets); Phase 6's gallery row tunes them side by side.

**As built (section 3):**

- **The schema** (`schemas/TextureSetSchema.ts`, both documentation layers): `procedural` (`generator`, `params?` by name: a number, an sRGB `#rrggbb` colour or a boolean, `seed?` a whole number, `size?` one side or `[w, h]` in 1-8192, `packing?`) in place of `packings`, now optional; a refinement refuses both or neither, and a `defaultPacking` other than the procedural packing. `TEXTURE_SET_PROCEDURAL_DEFAULTS` (`LITE`, 1024, seed 0), `TextureSetProcedural`, `TextureSetProceduralDef` (every field given) on `aekasha/schemas` (the def on `aekasha/texturesets` too). `TextureSetDef` keeps `packings` required: **the gatherer names a procedural set's slots `<setId>.<slot>`**, the ids its bake registers, so the resolver, `getTextureSetPackingTextures` and the lookups needed no change.
- **The gather** (`devTools/gather/textureSets.ts`): the walk also lists `*.generator.ts` (`GatherContext.generatorFiles`), `readGenerators` maps them by id (`Registries.generators`; a duplicate fails), and a procedural set fails on an unknown generator (naming the known ones), gets its defaults filled and its slot ids claimed in the textures' id space (a texture asset with one fails). Its textures are never appended to a scene's `textures`, and `getTextureSetInputDependencies` (`TextureSetRefs.ts`, shared with the runtime) names none for it. `setTextureSetGeneratorLoaders` (after the scene pass) writes `textureSetGeneratorObjects` for each generator a set in the output names (development: every set; production: the shipped scenes'), and `index.ts` passes it as `AppData.textureSetGeneratorFiles` (optional in the kernel's type), both only when there's one, so an app without a procedural set has no byte of it; an embed profile picks its scenes' sets' generators. The layer lint's generated-code exception takes the toolkit's `*.generator.ts`. The generated data's key order is kept (an unchanged repo gathers byte for byte as before).
- **The bake on load** (`features/texturesets/TextureSetBakes.ts`, `import()`ed by the feature on first need, so the baker isn't in the feature's chunk): `bakeProceduralTextureSetAsync(set)` loads the generator's module (cached; its `generator` export checked: a `buildPacking` function and the id), then one `bakeTexture({ id: setId, size, outputs: the packing's slots })` whose `build` is `buildPacking(ctx, { packing, params, seed, physicalSize, heightScale })` (the set's facts, not the generator's defaults: the JSON requires them as any set does). Registered textures are re-tagged instead and a running bake is shared; the owner scope is captured at the call. Errors name the set and the generator. The scene hooks: `worldCleared` starts the scene's procedural bakes next to its set arrays (synchronously once the module and generator are loaded), `beforeAssets` awaits both; a failed bake is an `lerror` and the load goes on (white). `loadTextureSetAsync` bakes a procedural set in the caller's scope. A code-made material naming one needs `loadTextureSetAsync` first (its dependencies are none: nothing declares the textures).
- **Size** (`yarn sbp`): the feature's first-download group grew from 976 B to 1090 B gzip (the scene hook's start of the bakes; `loadTextureSetAsync`'s procedural branch, `loadProceduralTextureSetAsync`, sits in the lazy chunk), so its budget went 1 → 1.25 KiB (`sbp.config.ts`). The lazy chunks (set arrays and bakes) are 3.6 KiB. `bundle.json` and `api.json` aren't updated yet (`yarn verify:baselines --update` with the commit).
- **Set arrays refuse a procedural set**: `buildTextureSetArray` and `setTextureSetArrayLayer` throw naming it, and the gather fails on one in a listed set array or a `{ textureSetArray }` list.
- **Verification:** `proceduralSurfaces` lists two JSON sets (`p304ProcRipples`: `sandRipples`, `LITE` by default, params, seed 11, 256²; `p304ProcCracks`: `mudCracked`, `FULL`, seed 3, 256²), drawn in a third row through the toolkit's `textureSetSurface` (`matOverrides.inputs.surface`). Each slot is read back, checked as the generators' are and compared byte for byte (`compareImages`) with a `bakeSurfaceGenerator` of the same values, and `loadTextureSetAsync` must return the load's textures (`window.__proceduralSurfaces.results.jsonSets`, the tab's "JSON set" folders). The overview camera moved back for the row. Measured (2026-11-14, M2, WebGPU, the scene runner's four configurations): every check passes, the JSON bakes equal the code bakes (no byte off). Not run on WebGL2 yet. Tests: the schema's, the refs', `TextureSetBakes.test.ts`, the feature's hooks and load, the arrays' refusals, `output.test.ts` (the loaders, the index), the gather's "p304 D3" cases and `compareImages`.

**As built (section 4):**

- **`createLiveSurface(generator, { uv?, seed?, params?, physicalSize?, heightScale?, normal?, ao? })`** (`src/toolkit/terrain/procedural/LiveSurface.ts`, on `aekasha/toolkit/terrain` with `LiveSurface` and `LiveSurfaceOpts`): the generator's `build` as a material's graph, `ctx.isLive` true and `ctx.cells` without a period. The point defaults to the world's `(x, −z) / physicalSize` (`textureSetSurface`'s `WORLD_XZ`, so a live surface has its bake's scale and orientation); p305 passes its own for a layer's `tiling`, `rotation` or a triplanar plane. A function of its own, not a method of the generator: a bake-only app's generator chunks carry none of it. The engine has no part in it (nothing is baked or registered).
- **What it returns:** `albedo` (without AO), `height`, `roughness`, `normalTS`, `ao`, `isAoBaked: false` (named as `sampleTextureSet`'s sample, a `FULL` one's, so p305 blends a live layer as a sampled one), the `uv`, the facts in effect (`physicalSize`, `heightScale`) and `get/setParams`, `get/setSeed` (uniforms of its own per call: a slider changes the next frame; a static param or toggle that changes throws, as a bake's).
- **The normal and the AO are opt-in** (a bake's taps cost 4 and 8 more evaluations of the height per pixel, every frame): by default `normalTS` and `ao` are null unless the generator's `build` gives them, and the material bumps the height (`bumpNormalView(height × heightScale)`, no extra evaluation). `normal: 'TAPS'` is `heightToNormal` a 1024² texel apart, `ao: 'CAVITY'` is `heightToCavity`, both through the height's layout function as a bake's.
- **Shared with the bake:** `buildSurfaceGraph` (`SurfaceGenerator.ts`, `@internal`: the params, the seed, the context, `build` and the taps' height), which `buildSurfacePacking` now calls; the baked graphs are unchanged (the JSON bakes still equal the code bakes byte for byte).
- **Not filtered:** a live surface has no mips, so detail finer than a pixel shimmers at a distance (the overview's live cracks). p305's distance fade or the handbook's "poor fit" rows answer it, not the wrapper.
- **Verification** (`proceduralSurfaces`): per generator a 256² bake of its live surface over one tile, read back (`checkLiveSurface`: the albedo and the height vary, at least half the texels differ a whole tile away, the taps' normal faces out and its AO is open; `results.generators.<id>.live`, the tab's "Live" field); two live blocks in the front row outside the JSON sets' (`sandRipples` bumped, `mudCracked` with the taps and the cavity), each built from its set's values as p305's `PROCEDURAL_LIVE` will; the tab's "Surface" switch (Baked / Live, `window.__proceduralSurfaces.setShownLive`) draws the ten blocks live. Measured (2026-11-14, M2, WebGPU): every check passes, 99.7-100 % of the texels differ a tile away, the taps' mean normal z 0.94-1.00; the live blocks match their bakes' look close up. Not run on WebGL2 yet. Tests: `LiveSurface.test.ts`, the generators' live builds, `checkLiveSurface`.
- **Open for p305:** its layer names a procedural set, and the engine's generator loader (`TextureSetBakes.ts`' `loadGeneratorAsync`) is internal: p305 needs a public way from a set's `procedural.generator` to the generator (an engine `loadTextureSetGeneratorAsync(id)` on `aekasha/texturesets`, in the lazy chunk), and checks that what it loads is a toolkit generator (`build`) before running it live. The baselines (`api.json`: the three new names; the scene's snapshot: the two live blocks) are recorded with this section's commit.

### Phase 5 — Shared textures and export (D4, D5)

1. The bake code of `macroNoise` and `rippleAtlas` (D4), with their check.
2. `exportBakedTexture` (D5): the readback, the PNG, the dev files write and the download fallback, with a button to drive it.
3. The committed KTX2 copies of the two textures (`src/toolkit/textures/macroNoise/`, `rippleAtlas/`), exported with section 2's tool, and the round trip for `sandRipples`.

**Exit:**

- `macroNoise` and `rippleAtlas` exist as baked textures and as committed KTX2.
- Export → commit → `yarn assets` round trip works for one generator (`sandRipples` → a new set `sand03` is **not** added to the library, only demonstrated in the doc).

**As built (section 1):**

- **Files** (`src/toolkit/terrain/textures/`, its layout rule; on `aekasha/toolkit/terrain`): `MacroNoise.ts` (`bakeMacroNoise`, `BakeMacroNoiseOpts`), `RippleAtlas.ts` (`bakeRippleAtlas`, `decodeRippleAtlas`, `BakeRippleAtlasOpts`, `DecodeRippleAtlasOpts`, `RippleRings`), a test each. Each bake is one `bakeTexture` with one linear RGBA8 output named `data` (mips, `REPEAT`), so the textures are `macroNoise.data` and `rippleAtlas.data` by default (`id`, `size`, `seed`, `anisotropy`, `isPersistent` as options; the handle is `bakeTexture`'s). The seed is a build-time value, not a uniform: these are baked once.
- **`macroNoise`** (512²): R an fbm of 4 cells and 5 octaves, G one of 6 cells and 4 octaves on another seed, both × 1.8 around 0.5; B Worley patches, 5 a tile, borders bent by a warp: each cell's own level (`cellId`) faded to 0.5 within 0.25 of `f2 − f1` of its border, so a threshold cuts soft-edged patches; A a white noise per texel less its 3 × 3 neighbourhood's weighted mean (a high pass), around 0.5. A isn't evenly spread (σ 0.154): a dither threshold from it is biased towards 0.5, which D4's optional `blueNoise` would answer (not built).
- **`rippleAtlas` is not a ring at a moment** (D4's "an expanding ring at a random phase" can't be animated from one sample): it holds where a texel is in its drop's ring, and the material makes the ring. RG = the direction away from the texel's drop (`× 0.5 + 0.5`, +y along +v; fading in from the centre and out at the rim), B = 1 at the drop falling to 0 at the ring's largest radius (0.33 of a cell; the drop is within ±0.15 of its cell's centre, so no ring is cut and the cells' border texels are empty), A = the cell's time offset. `decodeRippleAtlas(sample, time, { width?, halfWaves? })` is the other half, here so the layout and its decode stay in one file: `age = fract(A + time)`, a wave train (`halfWaves`, default 3, over `width`, default 0.33 of the radius) behind the front at radius `age`, × `(1 − age)` × B, returning `normalXY` (the direction × that, signed) and `mask` (its size). `time` is in ring lifetimes and the caller's (p307's `surfaceTime / lifetime`); p307 layers two samples at other scales and times. `cells` (default 4, 1-16) is an option.
- **The check** is `noiseLibrary`'s ninth pair (`sharedTextures.ts`, `sharedTextureChecks.ts`, tested): the macro noise's channels a quarter each (A magnified), and the atlas's RGB, its time offsets and the decoded rings (one sample, and two layered) at a fixed time (`window.__noiseLibrary.setRippleTime(t)` moves them). Both bakes are read back: R, G and B around 0.5, using the byte and stepping no more across the wrap than inside; A's neighbouring texels unlike each other (their correlation under −0.1, across the wrap too); per atlas cell a drop (the mask's peak), no mask on its border texels, one time offset, no direction off the ring and every ring texel's direction away from the drop. A failure is an `lerror`; `results.shared` and the tab's "Shared texture" folders hold the figures.
- **Measured (2026-11-14, M2):** every check passes on WebGPU and on WebGL2 (SwiftShader), with the same figures to the sixth decimal: R σ 0.183, G σ 0.178, B mean 0.453 and σ 0.180, A's neighbour correlation −0.242 (the kernel's own figure is −0.244) and −0.283 across the wrap; the atlas's lowest peak 0.976, 15 time offsets for 16 cells. **Trap:** three's `readRenderTargetPixelsAsync` is bottom row first on WebGL2, which only a check with a side (the atlas's directions) sees: the scene flips the rows there; section 2's export reads through the kernel's `readRenderTargetRGBA8Async` (top row first on both).
- **For section 3:** a committed copy can't be registered as `macroNoise.data` while a bake of that id is alive (D1: a texture registered under an output's id by anything else throws), so the committed assets' ids need deciding (proposed: `macroNoise` and `rippleAtlas`, the bakes' ids without the output, so a scene uses one or the other by id).
- The scene runner's `noiseLibrary` snapshot changes (the ninth pair): record it, and `api.json` (the seven new names), with this section's commit.

**As built (section 2):**

- **`exportBakedTexture({ id, output, dir, fileName?, overwrite? })`** (on `aekasha`, with `ExportBakedTextureOpts` and `BakedTextureExport`; an options object, not D5's `(id, output)`): a thin wrapper in `TextureBaker.ts` that loads `kernel/render/debug/_dbg__TextureBaker.ts` (`exportBakedTextureAsync`) through the debug loader and rejects outside the debug env. It finds the bake through the texture registry (`<id>.<output>`, its `renderTarget` and its index among the target's textures), so it needs nothing of the baker's state. `readRenderTargetRGBA8Async` (`Snapshot.ts`) takes an optional `textureIndex` for an MRT target's other outputs.
- **The file:** `<dir>/<id>_<output>.png` (`fileName` for another name), `dir` any folder the dev files write (a set's `source/`); level 0, the bytes as stored (an `SRGB` output sRGB-encoded), the rows flipped (`encodePNG`'s `flipY`: the bake's first row is v = 0, a PNG's top row is sampled at v = 1; section 3's round trip checks it).
- **Asking is the caller's:** it resolves `{ path, status, reason?, clampedValues }`, `status` one of `CREATED`, `UPDATED`, `UNCHANGED` (the file has these bytes: no write, nothing asked), `EXISTS` (another file is there and `overwrite` isn't set: nothing written, so a tool asks and calls again with `overwrite: true`) or `DOWNLOADED` (`getDevFilesStatus()` unavailable: the browser downloads it, `reason` says why, a warning names the path). A write passes the read's hash as `expectedHash` (`null` for a new file), and a `CONFLICT` rejects with "changed on disk while exporting".
- **`HALF_FLOAT`:** read back as half floats (rows as the RGBA8 readback's: padded on WebGPU, bottom-up on WebGL), clamped to 0..1 with a warning naming the count (`clampedValues`); no tone mapping. Unit-tested only: the repo's one `HALF_FLOAT` bake (`testDebugScene`'s `p304_layered`) is layered, and **an array bake is refused** (the error says to bake the layer on its own).
- **The buttons** (the gallery tab's are Phase 6's): `src/app/shared/_dbg__exportBake.ts` (`exportBakeOutputsAsync`: each output in turn, a browser confirm on `EXISTS`, a toast with each file's outcome), used by `noiseLibrary`'s tab ("Export PNG" in each shared texture's folder, into `src/toolkit/textures/<id>/source/<id>.png`) and `proceduralSurfaces`' tab ("Export PNGs" per generator: the shown bake's slots as `<generator>_<slot>.png` into the tab's "Export folder", default `src/app/textures/<generator>Baked/source`).
- **Checked (2026-11-14, M2, through `yarn dev`'s file server from a headless page):** both shared textures exported (`CREATED`, 512² and 256² RGBA PNGs), again `UNCHANGED`; an unknown output and a folder in `src/_engine/` rejected with their reasons. From WebGL2 (SwiftShader) the atlas is byte for byte the WebGPU file (`UNCHANGED`: the rows' order agrees across the backends) and the macro noise isn't (`EXISTS`: its fbm rounds differently in places), so **export the committed copies from one backend** (WebGPU). Tests: `_dbg__TextureBaker.test.ts` (the attachment read, the flip, each status, the download, the half floats on both row orders, the refusals).
- **Left in the tree for section 3:** `src/toolkit/textures/macroNoise/source/macroNoise.png` and `rippleAtlas/source/rippleAtlas.png` (the check's exports, WebGPU), untracked, with no texture JSON yet. `api.json` gains three more names.

### Phase 6 — Gallery row, handbook, Hub

1. **Gallery** (`terrainGallery`): a "Procedural" row with one block per generator, toggling **imported / baked / live** for categories that have both, plus last-bake GPU ms and per-block frame GPU ms (p310 standardizes the measurement).
2. **`docs/techniques/procedural-textures.md`** (page template), covering:
   - live vs baked vs exported (decision table);
   - the VRAM and download trade-offs (baked = uncompressed; exported = compressed);
   - tileability and periodic noise;
   - seeds and determinism (visual only);
   - writing a generator (a worked example: `sandRipples` line by line);
   - "Best for": stylized PBR, top-down/RTS, procedural worlds, game jams with no texture budget, unique non-repeating large surfaces (live), and NOT first-person photoreal on low-end (live).
3. **The Hub:** the terrain feature page (p301 §5) gets procedural textures and the baker (linking `procedural-textures.md` with a `repo:` link), the rendering or toolkit page `bakeTexture` and the noise helpers; `yarn hub:build`.
4. `readme.md` Features (engine: texture baker; toolkit: the periodic noise library and procedural surfaces); `src/_engine/kernel/render/CLAUDE.md` (the baker: MRT, layers, the queue and `textureBakeSystem`, the load path, the stats; the moved bake helpers) and `src/_engine/features/lod/impostors/CLAUDE.md` where it names them. Phase 2 updated `kernel/scene/CLAUDE.md` (`updateBakeStatusFn`), `debug/CLAUDE.md` and `features/skybox/CLAUDE.md` (the shared bake stats) already.

### Phase 7 — Versioning

1. Versions: engine minor (`bakeTexture`), toolkit minor (noise, generators, shared textures), app minor (`testDebugScene`'s bake checks, Phases 1-2; the `noiseLibrary` verification scene, Phase 3); `CHANGELOG.md`.
2. Mark the plan done (`docs/plans/CLAUDE.md`).

---

## Risks

| Risk                                                               | Mitigation                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| r187 doesn't render into array render target layers on one backend | 2D bake + p299's uncompressed array assembly (Phase 2 decides)              |
| r187 doesn't generate mips for render targets on one backend       | Own downsample chain (Phase 1)                                              |
| Pipeline compile hitches on first bake                             | `compileAsync` before baking; bakes at load                                 |
| Baked VRAM adds up (16 procedural sets at 1K LITE ≈ 180 MB)        | The handbook's export → KTX2 path; `size` per set; the gallery shows memory |
| Live procedural is costly per pixel                                | Measured in the gallery; tiers; the handbook's "poor fit" rows              |
| Float differences across GPUs                                      | Visual-only data; never feed gameplay or colliders from baked textures      |
