Status: in progress | Phases 1-2 implemented
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

### Phase 3 — Noise library (D2)

**Exit:**

- Each periodic function tiles seamlessly in a 3×3 repeat preview.
- The non-periodic variants match the periodic ones statistically.
- SwiftShader WebGL2 doesn't hang (`yarn verify:scenes --webgl --only <the check scene>`).

### Phase 4 — Generators and procedural sets (D3)

1. `defineSurfaceGenerator`, `packSurfaceOutputs`.
2. The 10 generators.
3. `procedural` in the texture set schema (both documentation layers); bake on load; validation against arrays.
4. Live-mode wrapper for p305.

**Exit:** every generator bakes into all three packings and looks right on a gallery block.

### Phase 5 — Shared textures and export (D4, D5)

**Exit:**

- `macroNoise` and `rippleAtlas` exist as baked textures and as committed KTX2.
- Export → commit → `yarn assets` round trip works for one generator (`sandRipples` → a new set `sand03` is **not** added to the library, only demonstrated in the doc).

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
4. `readme.md` Features (engine: texture baker; toolkit: procedural surfaces); `src/_engine/kernel/render/CLAUDE.md` (the baker: MRT, layers, the queue and `textureBakeSystem`, the load path, the stats; the moved bake helpers) and `src/_engine/features/lod/impostors/CLAUDE.md` where it names them. Phase 2 updated `kernel/scene/CLAUDE.md` (`updateBakeStatusFn`), `debug/CLAUDE.md` and `features/skybox/CLAUDE.md` (the shared bake stats) already.

### Phase 7 — Versioning

1. Versions: engine minor (`bakeTexture`), toolkit minor (noise, generators, shared textures), app minor (`testDebugScene`'s bake check, Phase 1); `CHANGELOG.md`.
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
