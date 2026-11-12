Status: implemented (Phases 0-7)
Category: Rendering, LOD, GPU
Epic: \_DONE_p350_lod-system-research.md (Tier 3)
Related: \_DONE_p348_ecs-lod-selection.md (the CPU path's rules, ported here), \_DONE_p351_impostor-billboard-lod.md (cross-fades; impostor levels are levels here too), \_DONE_p058_shared-instanced-builds-for-lod-fades-and-impostors.md (per-object binding, shared builds), \_DONE_p353_macro-streaming-grid.md (a cell's content can add and remove a set's instances), p308_terrain-scatter.md (its static instance chunks, D1, are the CPU-side static case; a set is the large one), p240_client-device-capability-sniffer.md (whether a device takes the GPU path), p370_static-mesh-merging-and-texture-atlas-systems.md (indirect draws inside merged groups, its open question 3), \_DONE_p375_batched-mesh-batches.md

# GPU-Driven Culling & Per-Instance LOD

Moves culling and LOD selection of large instanced content off the CPU. An **instance set** keeps
its instances as plain data in GPU buffers, with no entity per instance. Each frame a compute
pass selects every instance's level with the CPU path's rules (screen size, hysteresis,
cross-fades), and for each camera that renders the set it frustum-culls them and appends the
visible ones to per-level lists. Each (level, material group) is one indirect draw whose instance
count the pass wrote. A hundred thousand or a million trees cost a few dispatches and a few
indirect draws per camera, and a flat ~0.5-1.5 ms of CPU frame (Phase 0).

The CPU path (`createInstancedLodPool`, an entity per instance) stays. It's the default below
about 20k instances, the only path for instances that gameplay addresses, and what WebGL2 runs
when a set falls back (D9).

---

## 1. Grounding

- **three r187's WebGPU backend** has indirect draws (`geometry.setIndirect(attribute, offset)`,
  an `IndirectStorageBufferAttribute`, `drawIndexedIndirect`), compute (`renderer.compute`, also
  from inside a render) and a drawing pipeline hook (`renderer.drawingPipeline`, a
  `StandardDrawingPipeline`, marked experimental: `begin(camera, renderContext)`,
  `beginRenderList`, `project`, `isCulled(object, camera)`, `finishRenderList`, `prepareAsync`;
  `Renderer.js:1114`, `:2139`). Every render calls it, the nested shadow renders and the VSM
  blur quads included. A `StorageBufferAttribute`'s `updateRanges` upload partially
  (`WebGPUAttributeUtils.js:272`).
- **WebGL2 has no compute** (`forceWebGL`, or no WebGPU). The engine reads the backend as
  `renderer.backend.isWebGPUBackend` (`kernel/render/Renderer.ts`, `StreamingPriming.ts`).
- **The engine has no compute passes and doesn't set `drawingPipeline`** (2026-11-09). The GPU
  timer (`src/_engine/debug/_dbg__GPUTimer.ts`) times compute dispatches already, and the stats
  panels show them.
- **The CPU path** (`features/instancing/CLAUDE.md`, `features/lod/CLAUDE.md`):
  `createInstancedLodPool` gives every instance an entity with `INSTANCED_MESH_SLOT` and `LOD`,
  one `InstancedMesh` per level, instances moved between them through `registerLodTarget`
  (`kernel/ecs/LodTargets.ts`, the kernel registry that lets instancing reach LOD without
  importing it: a feature imports no other feature's code). The selection is `selectLevel`
  (`LodSystem.ts:368`). The measure is `LodMeasure.ts`: the camera terms
  (`computeCameraTerms`), a pool instance's screen size from its origin with level 0's
  conservative radius, against `getLodSelectionCamera()` (the main camera, or the active one
  with the `useActiveCamera` debug option). The fades are `LodFades.ts` and `lodFadeSystem`. The
  settings are in `LodSettings.ts`: the global bias, `fadeSeconds`, and the debug options
  `freeze`, `forceLevel`, `useActiveCamera` and `fadeTimeScale`.
- **The dither** (`kernel/render/LodFade.ts`): one `LodFadeMaskNode` that every dither-enabled
  material shares. It reads the drawn object's fades at draw time: an InstancedMesh's
  per-instance `lodFade` attribute, and the per-object pair of LOD fade and visibility fade (the
  visibility fade is streaming's, p353 Phase 5 D5). They bind per object, so the builds are
  shared (p058 D2). `lodDither` isn't on an entry.
- **The octahedral impostor's material positions its own billboard**
  (`impostors/OctahedralImpostorMaterial.ts`). Its `positionNode` reads the drawn mesh's instance
  matrix again, picked at setup by the drawn object: `instanceMatrix` through a
  `referenceAttribute` for an InstancedMesh, the identity otherwise.
- **The ECS world's entity cap.** The default `maxEntities` is 100,000 (`VITE_ECS_MAX_ENTITIES`,
  `Config.ts`). A pool past it fails to load (Phase 0).
- **SBP** (`devTools/sbp/CLAUDE.md`): `yarn sbp` budgets the `features/instancing` and
  `features/lod` groups' first-download code, and the banner budgets every feature group at 0. A
  module that only an `import()` reaches is lazy and adds nothing to the first download.
- **Phase 0's numbers** (§3, Phase 0) are from the debug env on the dev server, an Apple M2 and
  Chrome. Nothing has been measured yet on a production build, another GPU or WebGL2.

## 2. Decisions

### D1 — An instance set: a new API, not a flag on the pool

`createInstanceSetAsync(opts)` (`features/instancing/InstanceSet.ts`, on `aekasha/instancing`).
Its instances are plain data (D2), so it can't be a flag on `createInstancedLodPool`, whose
instances are entities. The options mirror the LOD pool's:

```ts
type CreateInstanceSetOptions = {
  world: ECSWorld; // the owning entity's world (a scene's content, cleared with it)
  levels: InstancedLodPoolLevel[]; // the pool's level shape: geometry, material(s), screenSize, castShadow
  maxInstances: number; // sized once, at most 2^24 (D4)
  lod?: Omit<LodDef, 'levels'>; // cullScreenSize, hysteresis, bias, fadeSeconds
  receiveShadow?: boolean;
  maxVisible?: number; // per camera and level (D4); default min(maxInstances, 65,536)
  preWarm?: boolean; // compiles the draws' materials (D8)
  entityOpts?: CoreEntityOpts;
};
```

It returns an `InstanceSet`:

- `object` is a `THREE.Group` that holds the set's draws. Add it directly under the root scene.
- `entityId` is the owning entity. Deleting it disposes everything, so a scene switch clears the
  set like any other content.
- `backend` is `'GPU'` or `'CPU'` (D9).
- `addInstances(placements | matrices)` takes `InstancePlacement[]` or a `Float32Array` of 16
  floats each, and returns an `InstanceRange` (or `null` past `maxInstances`).
  `removeInstances(range)` frees the range for a later add. The cull covers instances up to the
  highest range in use, and a freed range's instances are skipped.
- `setInstanceMatrices(range, matrices, offset?)` moves instances (D2).
- `count` is the live instance count.

It's async because each backend is a module of its own behind an `import()` (D10). The promise
resolves `null` when the owning world's scene exited meanwhile, so the caller re-checks as after
any `await`. A set with one level and no `cullScreenSize` is a GPU frustum-culled instanced mesh,
with no LOD.

A streamed cell's content (p353) adds a range in its `load` and removes it in its `unload`, and
one set serves every cell. Content that wants the cells' visibility fade passes its fade with the
range (`addInstances(…, { fade })`). That waits for a phase that needs it (§5).

### D2 — Plain data: what a set gives up

- No ECS tags (`TAG_FRUSTUM_CULLED`, `TAG_LOD_CULLED`), no spatial domain, no raycast (the draws
  sit at the origin and `raycast` does nothing), and no "is this instance visible" for gameplay.
  Gameplay that needs any of these uses the pool.
- Uniform scale only (`InstancePlacement.scale` is a number already). The vertex stage turns the
  normal with the matrix's rotation, and a set fails a non-uniform matrix in its debug check.
- Moving instances: `setInstanceMatrices` writes the CPU copy and adds an update range. The
  ranges upload once a frame, before the first dispatch. A set is meant for static or rarely
  moving content: a sway or wind belongs in the material.

### D3 — The CPU path's rules, written once

- The pure core of the selection (`selectLevel`, the cull test with its hysteresis) and of a
  fade's step (start, mid-fade change, advance, end) moves to `src/_engine/utils/LodRules.ts`. It
  works on plain numbers. `LodSystem.ts` and `LodFades.ts` call it, so does the CPU fallback (D9),
  and its tests are the reference the TSL port mirrors line by line, as the spike's did.
  Node can't run TSL, so the GPU side's parity is checked in the browser, against the pool, by
  `instanceStress`'s readback (Phase 0's parity table).
- **A fade ends at `progress ≥ 1 − 1e-5`** on both paths (`LOD_FADE_END_EPSILON`, in
  `LodRules.ts`). Under the fixed delta, a 0.25 s fade then lasts 15 frames on both backends,
  where today the CPU path's f64 sum takes 16 (Phase 0). This changes `lodFadeSystem` by one
  frame per fade, and Phase 1 reruns the scene runner to check that no baseline moves.
- **The per-frame inputs are lod()'s.** `lodSelectionSystem` writes the frame's camera terms
  (from `getLodSelectionCamera()`), the global bias, the frame's fade step (with
  `fadeTimeScale`), `freeze` and `forceLevel` once a frame, through a kernel seam next to the LOD
  targets (`kernel/ecs/LodTargets.ts`: `setLodFrameInputs` / `getLodFrameInputs`, `@internal`).
  A set reads them there, so instancing still imports no LOD code. Without `lod()`, a set with
  more than one level or a `cullScreenSize` warns once and draws level 0, as a pool does.

### D4 — The buffers

Per set, on the GPU path:

| Buffer | Per | Size | Read by |
| --- | --- | ---: | --- |
| Matrices: affine, 3 `vec4` rows | instance | 48 B | the vertex stage only |
| Cull record: the origin, and scale × level 0's conservative radius | instance | 16 B | the select and the cull |
| State: level and outgoing level (8 bits each), and the fade progress (f32) | instance | 8 B | the select (written), the culls |
| Visible list: an entry packs the instance (24 bits) and its signed fade (8 bits) | (slot, level) × `maxVisible` | 4 B | the vertex and fragment stages |
| Draw args: `drawIndexedIndirect`'s five, padded | (slot, level, group) | 32 B | the draws |

- **The cull record replaces the four matrix columns** in the compute. The record's sphere (the
  origin, with the conservative radius) is what the CPU path measures a pool instance's screen
  size with. It also contains level 0's own bounding sphere, so it serves as the frustum test's
  sphere: a little looser than the spike's, and read in one 16-byte load instead of 64. Phase 0
  found the cull's cost is reading the matrix, so Phase 1 measures what this saves.
- **The lists are budgeted, not sized by the instance count.** Phase 0's list, sized by the
  count with a separate fade per entry, was 48 MB at 1M with two slots. With a budget it's
  slots × levels × `maxVisible` × 4 B: 3 MB for 3 levels, 4 slots and 65,536. An entry past
  the budget is dropped and counted, and the debug tab shows the count (D11). The 8-bit fade has
  255 steps, finer than a 15-frame fade needs.
- At 1M instances that's 48 + 16 + 8 MB. The matrices are most of it, and they're also the CPU
  copy the set keeps for `setInstanceMatrices` and the fallback.

### D5 — The kernel owns the drawing pipeline

`kernel/render/DrawingPipeline.ts` installs one `StandardDrawingPipeline` subclass on
`renderer.drawingPipeline` with the first hook and puts three's back with the last.
`addDrawingPipelineHook({ begin?, isCulled?, finishRenderList? })` returns the remover and is
`@internal`. Three's experimental interface stays behind this one file, and a later user (p370's
indirect draws, p375) shares it. The module is imported only by the GPU backend, so it's lazy
too (D10).

- **A set dispatches only for the renders that reach it.** `isCulled` sees the set's draws
  during the projection, and `finishRenderList` dispatches that render's cull. That's after the
  projection and before any draw is encoded, which is where three's meshlet pipeline dispatches.
  So a render of another scene (an impostor bake, the sky's layers, a snapshot of an editor view)
  costs the set nothing. Phase 0 dispatched in `begin`. Phase 1 checks that `finishRenderList`
  runs before a nested shadow render, which starts while the outer render's list is drawn.

### D6 — A slot per camera

- A camera gets a slot on its first render that reaches the set: its draws (a mesh per (level,
  group)) and, on its first dispatch, its lists and args. A slot unused for 120 frames is
  released. `maxSlots` (default 8) caps them: past the cap, a camera draws none of the set, and
  the debug env warns once.
- **Every slot draws the levels selected against `getLodSelectionCamera()`**, as the CPU path's
  viewports, debug camera and snapshots do. Only the frustum is the slot's own camera's.
- **A shadow camera's slot draws only the casting levels** (`castShadow` per level). A camera is
  a shadow camera when it's the `shadow.camera` of a light in the root scene, cached per camera.
- **Nested renders need their own slots** (the sun's shadow inside the main render, Phase 0).
  Sequential renders of one camera re-dispatch into its slot before each render. A point light's
  six faces reuse its `shadow.camera` (`PointShadowNode.js:290-334`), and each face's draws run
  before the next face's dispatch in queue order. Phase 3 checks this.
- One dispatch per slot. The single dispatch for every slot (each instance tested against every
  frustum, the record read once) needs the shadow cameras' matrices before the view's render.
  Phase 0 found it worth it only above about 500k, so it's left out unless Phase 3's
  measurements ask for it (§5).

### D7 — The state advances once a frame

The frame's first dispatch of a set runs the select and the advance, and writes the state. Every
later dispatch in the frame (the shadow slot, a viewport) only reads it. The frame is the main
loop's frame counter. This fixes the spike's double advance when one camera renders twice in a
frame. The select applies the debug options as `lodSelectionSystem` does: `freeze` keeps the
levels, `forceLevel` puts every instance at that level (none culled), and `fadeTimeScale` scales
the step.

### D8 — The level materials, a draw per (level, group)

As Phase 0's part 3:

- A set draws with its levels' materials as given (classic or node). Each source material gets
  one node variant (`renderer.library.fromMaterial`, the values copied, the identity and
  listeners left out). The variants share one vertex fetch (`positionNode`, through the visible
  list's entry) and one mask. A mesh's list is a per-object uniform, so the builds are the CPU
  path's: one per (material, pass), whatever the levels, groups and slots.
- **The dither is the engine's.** `LodFadeMaskNode` learns a third source: a set's draw reads its
  entry's fade, ANDed with the object's visibility fade as before. A material's other mask (an
  alpha cut) is kept, where Phase 0's variant replaced it. The set calls `enableLodDither` on its
  sources as the pool does.
- **A material that positions its own instances** (the octahedral impostor) reads the instance
  matrix through an engine node that resolves per drawn object: an InstancedMesh's
  `instanceMatrix`, or the set's fetched matrix (`instanceSetMatrix`, `@internal`). Its variant
  keeps its own `positionNode`. `OctahedralImpostorMaterial.ts`'s setup-time choice of the
  `instanceMatrix` reference or the identity becomes that node's. The node lives in
  `kernel/render/`, so neither feature imports the other.
- A geometry has one indirect offset, so each group of a level is its own mesh and its own args
  (its `firstIndex` and `indexCount`). The cull counts into group 0's args, and a finalize pass
  in the same compute call copies the count to the level's other groups.
- `preWarm: true` compiles the variants with the engine's compile queue (`preWarmObjectsAsync`,
  `kernel/render/CLAUDE.md`'s Pre-warm compiles), one draw per (material, level) at slot 0.

### D9 — The CPU fallback (WebGL2): the same set, no compute

On a backend without compute, `createInstanceSetAsync` loads the CPU module, and `backend` is
`'CPU'`. Same API, same data, same rules:

- An `InstancedMesh` per level, its `instanceMatrix` and `lodFade` written from the typed arrays.
  Each frame a loop runs D3's pure functions over the instances (no entities, no storages), and
  rewrites only the levels whose membership changed.
- No per-instance frustum culling: three culls each level mesh as a whole by its bounds, as with
  the pool. A set's visual result is the pool's: the same counts per level, the same fades.
- It's the pool's per-instance CPU cost without the ECS: Phase 4 measures how much the ECS was
  of the pool's ~110 ns per instance. A device where even that is too slow is p240's case (a
  lower density, or no set).
- The other way, a set backed by a LOD pool on WebGL2, would bring back the entity per instance
  and the 100k cap. That's what a set exists to remove.

### D10 — Where the code goes

All of it is in `features/instancing/`:

- `InstanceSet.ts` is the front: the options, the owning entity and the backend choice. It's
  small and on the entry, and it adds about a kilobyte to the `features/instancing` group's
  first download.
- `InstanceSetGpu.ts` (and its TSL, `InstanceSetNodes.ts`) and `InstanceSetCpu.ts` are each an
  `import()` from it.
- A build that never creates a set ships only the front, and a device downloads only its own
  backend. The kernel modules the GPU backend alone imports (`DrawingPipeline.ts`) land in its
  chunk.
- `yarn sbp`: the instancing and LOD groups stay within their budgets, the banner's feature
  groups at 0, and the report shows the two backend chunks as lazy.

### D11 — Debug

- **The LOD tab gets an Instance sets folder.** Per set it shows the backend, the instance
  count, the slots (each one's camera) and, per (slot, level), the drawn count and the overflow.
  These come from an async readback of the args, debug only, a few times a second. Three's
  `info.render` counts an indirect draw's call but not its triangles, so the folder shows the
  triangles from the counts.
- **The GPU memory tab** gets the set's storage buffers through `registerGPUMemorySource`
  (`aekasha/debug`), under the set's owner, if three's `info.memory` doesn't already place them
  under one.
- The LOD overlay and the per-entity window have no entity to show. A set's level colours (a
  debug variant per level) wait for a need (§5).
- `freeze`, `forceLevel` and `fadeTimeScale` work on sets through D3's inputs, so the tab's
  controls drive both paths.

### D12 — The verification scene

`instanceStress` (`src/app/scenes/instanceStress/`) moves onto the engine API: its spike module
`gpuCullSpike.ts` is removed in Phase 1 and its `?stressPath=gpu` creates a set. It keeps its
flags, its tab and `window.__aekInstanceStress.measure`, and it's where the parity with the pool
is checked (its readback), on both backends. It gets a `scenes.config.ts` entry: a snapshot at
`?stressCamera=STILL` per path. Whether the Hub also gets an example scene or a `lodShowcase` lane
is §4's question.

## 3. Phases

### Phase 0 — Spike — done (2026-11-09)

Branch `p354-phase0-spike`. Measured on a new scene, `instanceStress` (`src/app/scenes/instanceStress/`),
not on largeWorld or lodShowcase: neither scales its instance count. A square forest of trees (three
mesh levels of 12, 6 and 3 radial segments, cull at 0.006, 6 m apart) with the camera circling
inside it at 25 m. The CPU path is tiles of 128 × 128 trees, one `createInstancedLodPool` each.
`?stressInstances=N`, `?stressPath=gpu`, `?stressPipeline=meshlet` and `?stressCamera=STILL`
choose the case, and the scene's tab does the same. Its `_dbg__` module brackets the engine's
systems with app systems at fractional orders, and `window.__aekInstanceStress.measure(frames)`
averages them. The harness was a Playwright script outside the repo: 120 warm-up frames, then 300
measured, the GPU and compute figures read from the stats panels.

Conditions: Apple M2, Chrome with WebGPU (Metal), headless, 1600 × 900, the debug env on the dev
server (unminified). The test bridge's fixed frame delta puts the camera on the same path in every
run. Production builds will be somewhat faster per instance. The ratios and the scaling are what
count here. `VITE_ECS_MAX_ENTITIES=600000` was needed past 100k (see below).

#### The CPU path (instanced LOD pools), camera circling

| Trees | Pool sync | LOD systems | Render submit | CPU frame | GPU frame |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5k | 0.37 ms | 0.80 ms | 1.04 ms | 2.3 ms | 1.74 ms |
| 20k | 0.74 ms | 1.86 ms | 2.11 ms | 4.7 ms | 2.63 ms |
| 50k | 1.42 ms | 4.01 ms | 1.65 ms | 7.1 ms | 3.30 ms |
| 100k | 2.89 ms | 8.61 ms | 2.66 ms | 14.2 ms | 4.88 ms |
| 200k | 5.35 ms | 19.6 ms | 3.57 ms | 28.6 ms (35 fps) | 6.15 ms |

- **Where it stops scaling.** Linear in the instance count: the pool sync costs about 27 ns per
  instance with nothing moving, the LOD selection about 80-90 ns, plus the fades. The LOD
  systems and the sync together pass half a 60 fps frame (8 ms) at about 70k instances. The
  whole CPU frame passes 16.7 ms between 100k and 200k (about 115k). With the camera still
  (nothing changes level), 100k costs 9.6 ms of CPU frame: the selection alone is 6.7 ms.
- **Every instance is measured, in view or not.** Pool instances don't opt into the ECS frustum
  culling, and three culls a level mesh only as a whole. At 100k the CPU path draws about 92k
  instances, most of them behind the camera, so the GPU pays for them too.
- **The ECS world's entity cap.** One entity per instance: a world's default `maxEntities` is
  100,000 (`VITE_ECS_MAX_ENTITIES`, `Config.ts`), so a 100k-tree scene fails to load in the
  default world, the camera and the level meshes included. The GPU path must not spend an
  entity per instance.

#### Three's `MeshletDrawingPipeline` as a drop-in (the same pools)

| Trees | GPU frame (standard → meshlet) | Its compute | CPU frame |
| ---: | ---: | ---: | ---: |
| 5k | 1.74 → 1.80 ms | 0.18 ms | 2.3 → 1.4 ms |
| 20k | 2.63 → 3.96 ms | 0.46 ms | 4.7 → 4.2 ms |
| 50k | 3.30 → 7.27 ms | 0.96 ms | 7.1 → 7.4 ms |
| 100k | 4.88 → 7.78 ms | 1.41 ms | 14.2 → 15.6 ms |

- It took the pools over with nothing changed: 2 draws, every level of every pool, the classic
  Lambert materials and the LOD dither's `maskNode` (it isn't on its list of refused nodes). The
  trees looked right and nothing errored.
- **It's slower for this content.** The GPU frame grows up to 2.2× and its render submit too
  (4.65 ms against 2.66 ms at 100k). It still traverses the scene and uploads the transforms
  every frame. It also removes none of the ECS cost, the pool sync and the LOD selection, which
  is what limits the CPU path. Small instanced meshes of a few dozen triangles fill 64-triangle
  clusters badly, and its per-cluster work doesn't pay for itself.
- Not measured: huge single meshes and static `BundleGroup` content, the case it's made for
  (Tier 4's question), and its fallback under the app's VSM shadows (the scene's sun has none).
  Instanced LOD content stays on this plan's path.

#### The hand-written path (`instanceStress/gpuCullSpike.ts`)

Every instance's matrix sits in one storage buffer (4 `vec4` columns each). Each frame a compute
pass resets the level counts, frustum-culls each instance's level-0 sphere against the main
camera, picks its level by the CPU path's rule (`radius × k / distance`, without hysteresis or
fades) and appends its index to that level's visible list with an `atomicAdd` on the level's
indirect args. Each level is one plain `Mesh` with `geometry.setIndirect(args, level × 32)`, drawn
with `drawIndexedIndirect`. Its `positionNode` fetches the matrix through the visible list.
There are no entities.

| Trees | CPU frame | GPU frame | Compute | Drawn (levels 0 / 1 / 2) |
| ---: | ---: | ---: | ---: | ---: |
| 5k | 0.41 ms | 1.15 ms | 0.02 ms | 52 / 343 / 856 |
| 20k | 0.47 ms | 2.43 ms | 0.05 ms | 28 / 366 / 4,411 |
| 50k | 0.46 ms | 1.60 ms | 0.10 ms | 26 / 348 / 7,272 |
| 100k | 0.57 ms | 2.36 ms | 0.18 ms | 14 / 362 / 8,800 |
| 200k | 0.52 ms | 1.72 ms | 0.24 ms | 15 / 342 / 9,512 |
| 500k | 1.08 ms | 2.25 ms | 0.93 ms | 15 / 336 / 9,564 |
| 1M | 1.01 ms | 2.50 ms | 1.61 ms | 11 / 333 / 9,531 |

- These levels were measured from the sphere's centre, coarser than the CPU path's (corrected in
  "Hysteresis and cross-fades on the GPU", below): the drawn counts and GPU frames here are low.
- **The CPU cost is flat:** about 0.1-0.2 ms for the dispatch call whatever the count. At 100k it
  replaces 14.2 ms of CPU frame with 0.57 ms, and draws about 9k instances instead of 92k. The
  GPU frame is lower too, since only what's in view is drawn.
- **The compute is about 1.6 ns per instance** (1M in 1.6 ms) with a flat list. Past about 500k,
  a coarse pre-cull by cell (cull whole cells, then their instances) is worth it. Below that, one
  flat dispatch is fine.
- The drawn counts come from a readback of the args (`renderer.getArrayBufferAsync`, debug
  only): three's `info.render` counts an indirect draw's call but not its triangles (open
  question 5).
- One draw per level and material: `setIndirect` takes one offset per geometry, so every group of
  a multi-material geometry (the tree's trunk and foliage) would draw the same args. The spike
  draws one material per level, coloured by height. The real path needs a draw per (level, group):
  a geometry per group sharing the attributes, its own args with the group's `firstIndex` and
  `indexCount`.
- The level materials are node materials of the spike's own, with a `positionNode` per level (the
  list's base). The real path keeps the pool's materials and binds the list per object, as p058
  did for the fades, so the levels share one build.
- The dispatch ran from an ECS system before the render, against the main camera only, so a
  shadow pass would draw the main camera's lists. `renderer.drawingPipeline` calls `begin(camera,
  renderContext)` and `finishRenderList` for every render, the shadow passes included, and
  three's meshlet pipeline dispatches its compute in `finishRenderList`. That is the hook for
  culling per camera (open questions 1 and 4), not measured yet.
- WebGL2 has no compute: the scene falls back to the CPU path with a warning.

#### The cull per camera through `renderer.drawingPipeline`, the VSM sun shadow on

The spike's dispatch moved from the ECS system into a `StandardDrawingPipeline` subclass
(`createGpuCullPipeline`, `gpuCullSpike.ts`), installed on the GPU path's load and restored on
its exit. `?stressShadow=true` turns on the sun's shadow on both paths: the app's VSM
(`src/index.ts`), the `MEDIUM` preset (1024², 8 blur samples), fitted to the view by the toolkit's
`SunShadowFit` (160 m, 10 m toward the sun, physicsTiers' values), and a ground quad to catch it.
The JSON lights are created after the scene code, so the shadow is set up on the scene's enter.
`?stressDispatch=system` keeps Phase 0's ECS-system dispatch for an A/B. Same machine and harness
as above.

**How it works.** `begin(camera)` runs for every render, the nested ones included, and picks the
camera's cull slot: slot 0 for the view camera, slot 1 for the sun's `shadow.camera`, none for
anything else. It then dispatches that slot's reset and cull (`renderer.compute` inside the
render, as three's meshlet pipeline does). `isCulled` keeps each level mesh to its own slot's
camera. Each slot needs its own args and visible lists, and its own level meshes, because three
renders the shadow map in the middle of the main render. `ShadowNode.updateBefore` runs from the
first object that needs it, after the main list is projected and part of it is encoded. A shared
list would get the shadow camera's cull before the main pass's draws run. The shadow slot culls
against the shadow camera's frustum but picks each instance's level from the view camera. That
way a shadow matches the level drawn on screen, and only the casting levels (0 and 1 here) draw
into it. The shadow pass's override material takes the level mesh's `positionNode`
(`Renderer.js:3945`), so the instance fetch works there unchanged. The VSM blur passes (quad
renders) also call `begin`, but they have no slot and dispatch nothing: one shadowed light costs
two dispatches a frame.

| Trees | CPU path: GPU frame, no shadow → shadow | GPU path: GPU frame, no shadow → shadow | CPU frame with the shadow, CPU path / GPU path | Compute, no shadow → shadow | Shadow slot drawn (L0 / L1) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5k | 1.96 → 6.32 ms | 3.16 → 7.46 ms¹ | 1.7 / 1.3 ms | 0.02 → 0.07 ms | 173 / 785 |
| 20k | 2.60 → 7.74 ms | 1.32 → 7.59 ms | 4.6 / 1.5 ms | 0.12 → 0.12 ms | 158 / 845 |
| 50k | 3.43 → 9.15 ms | 1.56 → 7.63 ms | 8.3 / 1.6 ms | 0.17 → 0.30 ms | 156 / 811 |
| 100k | 4.74 → 10.54 ms | 1.95 → 6.98 ms | 13.5 / 1.4 ms | 0.33 → 0.30 ms | 146 / 837 |
| 200k | 5.21 → 11.75 ms | 1.77 → 7.18 ms | 25.9 / 1.4 ms | 0.49 → 0.78 ms | 151 / 818 |
| 500k | | 1.66 → 6.26 ms | — / 1.4 ms | 0.70 → 1.26 ms | 151 / 825 |
| 1M | | 1.72 → 6.09 ms | — / 1.4 ms | 1.26 → 2.13 ms | 153 / 806 |

¹ The sweep's first page (a cold GPU). Two re-runs gave 5.0 and 5.4 ms with the shadow, against
6.8 and 7.5 ms for the CPU path. The GPU timer's run-to-run spread is about ±1 ms.

- **The shadow has a fixed cost of about 4-5 ms of GPU frame on this GPU**, whatever the
  content: one tree measures 0.8-1.0 ms without it and 5.0-6.1 ms with it (the 1024² map, its two
  blur passes, the ground and every receiver sampling it). Above that fixed cost, the GPU path's
  shadow adds little at any count: its shadow slot draws the same ~1k casting instances in the
  shadow frustum from 5k to 1M trees. The CPU path's shadow grows with the count: 4.4 ms over
  its no-shadow frame at 5k, 6.5 ms at 200k, and its triangles double (515k → 1.03M at 20k,
  1.29M → 2.61M at 200k). Its shadow pass draws whole pools wherever their bounds touch the
  shadow frustum, and every level of them. VSM draws a receiver into the shadow map whatever its
  `castShadow` (the impostors' trap, `features/lod/impostors/CLAUDE.md`), so the coarsest level's
  `castShadow: false` saves nothing. At 100k the GPU path's GPU frame is 7.0 ms against 10.5.
- **The CPU cost stays flat:** about 0.1 ms per dispatch, and a CPU frame of about 1.4 ms with
  the shadow from 5k to 1M trees (25.9 ms on the CPU path at 200k).
- **The drawing pipeline hook costs nothing measurable.** In the same session, A/B at 20k and
  100k twice each: the ECS-system dispatch measured 0.96-1.21 ms of CPU frame, the pipeline's
  0.76-1.05 ms. Phase 0's 0.4-0.6 ms was that session's state: the CPU path measured slower
  there too (4.7 against 3.8 ms at 20k).
- **The shadow slot doubles the compute** (1.26 → 2.13 ms at 1M), since every slot reads every
  instance. There are two ways to win it back: one dispatch that tests each instance against
  every slot's frustum and reads the matrix once, or the coarse cell pre-cull. The single
  dispatch needs the shadow camera's matrices before the view's `begin`: three sets them in
  `ShadowNode.updateBefore`, inside the render, so the cull would call
  `light.shadow.updateMatrices(light)` itself. Below about 500k neither is needed.
- **A camera with no slot draws none of the forest.** Here that's fine, but the real path has
  to give a slot to every camera that renders it: a second view (`viewports()`), an env bake, a
  spot light's shadow (one camera) or a point light's (six). Slots are allocated on first sight,
  with a cap that falls back to drawing nothing. The lists grow with the slots: count × levels ×
  slots uints is 24 MB at 1M with two slots. The real path sizes them by a visible budget per
  slot, not by the instance count.
- The spike builds a level material per slot (five pipelines here): the shared builds are part 3.

#### Hysteresis and cross-fades on the GPU

The spike now applies the CPU path's rules (`features/lod/CLAUDE.md`: `selectLevel`, the cull
test, `LodFades.ts`). Each instance has a state word (its level and the level it fades out of, 8
bits each, with values for culled and none) and a fade progress (a float). The view slot's cull
first selects every instance's level, in view or not, as the CPU path does for pool instances
(they have no frustum culling there). The selection uses the hysteresis: a coarser level, or the
cull, is taken only below `screenSize × (1 − h)`, and an instance coming back from culled comes
from beyond the last level. A change starts a fade: a change mid-fade ends the running one, the
first selection never fades, and a fade to or from culled has one copy. Then the fade advances by
`dt / fadeSeconds`. The order is the CPU path's: select, then advance, so a new fade's first frame
draws at one step. The state is written back only when it changed or fades. Then the frustum
test, and the instance in view is appended twice when fading: its level's copy at `t` and the
outgoing level's at `t − 1`. Each visible-list entry carries its fade in a parallel float list.
The level material's `maskNode` dithers with it, through a varying from the vertex stage and the
engine's noise (`kernel/render/LodFade.ts`, copied: `lodDither` isn't public). The shadow slot
reads the state the view slot wrote this frame (its dispatch runs first, inside the main render)
and appends the casting levels' copies the same way, so shadows dither with the same split. The
fades' clock is the frame delta (a scene looper), the same `dt` the CPU path's fade system takes.
New flags: `?stressFadeSeconds=` (both paths, `LodDef.fadeSeconds`) and `?stressOrbitHold=true`
(the camera holds at its start until `measure(frames, true)` starts the orbit with the first
measured frame).

**The measure changed with it.** A pool instance's screen size is measured from the instance's
origin with level 0's conservative radius (`getConservativeGeometryRadius`: the sphere's centre's
distance from the origin plus its radius; `LodMeasure.ts`), and the GPU path now does the same.
Phase 0 and part 1 measured from the sphere's centre with its radius. For this tree that's about
half the radius, so the levels were coarser and the cull nearer. At 20k the view slot drew
29 / 358 / 4,316 per level then and 205 / 1,338 / 3,448 now; at 1M, 9.5k instances then and about
40k now. Their GPU frames above are low by that much. Their conclusions (the flat CPU cost, the
shadow's cost flat with the count) hold; the GPU frames below supersede them.

**Parity with the CPU path** (20k, the held orbit, 300 frames, the state read back at the
measure's last frame):

| Fades | CPU path: per level / fading | GPU path: per level / fading |
| --- | --- | --- |
| off (`0`) | 960 / 5,429 / 13,611, 0 | 960 / 5,429 / 13,611, 0 |
| 0.25 s | 993 / 5,533 / 13,694, 220 | 991 / 5,522 / 13,685, 198 |
| 1 s | 1,110 / 5,851 / 13,963, 924 | 1,112 / 5,868 / 13,965, 945 |

(A fading instance counts in both its levels.)

- **The selection is identical**, the hysteresis included: with the fades off the counts match
  exactly, so the readback lands on the same frame as well.
- **The fades differ by one frame, from float rounding alone.** At the fixed 1/60 s delta, a
  0.25 s fade lasts 16 frames on the CPU path: 15 steps of `dt / 0.25` add up to just under 1 in
  f64. It lasts 15 frames in the shader's f32. A 1 s fade lasts 60 frames against 61. Each frame
  of difference shifts the fading count by about a frame's worth of fade starts (15-20 here).
  The fix is to end a fade at `progress ≥ 1 − ε` (ε about 1e-5) on both paths, a one-line change
  to `lodFadeSystem` too. Then both backends agree frame for frame under the fixed delta (the
  scene runner's), and a 0.25 s fade lasts 15 frames as it should.

**The cost** (the same orbit as Phase 0, not held; compute and GPU frame from the stats panels):

| Trees | Compute: fades 0.25 s / fades off / part 1 (no state) | GPU frame: fades on / off | CPU frame | Fading |
| ---: | ---: | ---: | ---: | ---: |
| 20k | 0.05 / 0.05 / 0.12 ms | 1.56 / 1.44 ms | 0.4-0.5 ms | 192 |
| 100k | 0.20 / 0.22 / 0.33 ms | 2.66 / 2.54 ms | 0.4-0.5 ms | 833 |
| 200k | 0.33 / 0.62 / 0.49 ms | 3.20 / 3.31 ms | 0.4-1.2 ms | 2,037 |
| 500k | 0.61 / 1.03 / 0.70 ms | 3.64 / 3.92 ms | 0.4-1.1 ms | 4,589 |
| 1M | 1.10 / 1.55 / 1.26 ms | 3.69 / 3.68 ms | 0.5-1.2 ms | 8,394 |

With the shadow too (fades 0.25 s): compute 0.13 / 0.47 / 0.85 / 1.53 / 2.34 ms and GPU frame
6.0 / 6.6 / 7.4 / 7.9 / 7.9 ms from 20k to 1M, the shadow slot drawing about 570 / 2,500 per
casting level. The CPU path, the same run: 100k at 4.5 ms of GPU frame with the fades off and
4.9 ms with them on, and 12.0 / 12.6 ms of CPU frame.

- **The state costs no measurable compute.** Fades on, fades off and part 1's stateless cull are
  within the run-to-run spread; fades on even measured lowest. The cull's cost is reading the
  matrix: the state adds an 8-byte read, and a write only for the instances that changed or fade.
  The fades off-screen run too (8.4k at 1M) and cost nothing visible.
- **The dither costs no measurable GPU frame either:** fades on and off are within the spread on
  both paths (the CPU path's 2.60 against 2.61 ms at 20k). The mask's discard is in every level
  material on both paths anyway (`enableLodDither` on the pools' materials).
- **With the CPU path's levels, the GPU path still draws its frame in about half the time**: 2.5-2.7
  ms at 100k against 4.5-4.9, and 3.7-4.2 ms at 1M, where it draws about 40k instances. That's
  the cull distance's doing (content's choice: an impostor level or a nearer cull), not the
  path's.
- **The memory grows with the fades:** 8 bytes of state per instance, and a fade per list entry
  that doubles the lists. At 1M with 3 levels and 2 slots, that's 24 MB of indices plus 24 MB of
  fades. Two fixes make it small: the budgeted lists (part 1), and packing the fade into the
  entry (an index of 24 bits and a fade of 8: 255 steps are finer than a 15-frame fade needs).
- **The fades must advance once a frame, not once a cull.** Here the view slot's cull advances
  them, and it runs once a frame. A second render of the view camera in one frame would advance
  them twice. The real path advances the state in the frame's first view dispatch, or in a
  separate state pass, and the other slots only read it.
- The visible lists' order changes from frame to frame (the atomics). That's harmless for opaque
  content, and the state itself is deterministic: one thread per instance, no races.

#### The pools' own materials, a draw per (level, group)

The GPU path now draws with the CPU path's materials: `createMaterial`'s classic
`MeshLambertMaterial`s, one for the trunk and one for the foliage, by the tree geometry's groups.

- **A draw per (slot, level, group).** A geometry has one indirect offset, so each group of a
  level is its own `Mesh`. Its geometry shares the level's attributes and index, and its own args
  hold the group's `firstIndex` and `indexCount`. The cull counts into group 0's args. A finalize
  pass, run after the cull in the same compute call, copies the count into the level's other
  groups' args (`atomicLoad` / `atomicStore`, one thread per (level, other group)). Here that's
  6 indirect draws for the view and 4 for the shadow.
- **One node variant per source material.** `renderer.library.fromMaterial` gives the classic
  material's node class with its values. The variant copies them, leaving out the identity and
  `_listeners`, so its dispose doesn't fire the source's listeners. It takes a `positionNode` (the
  fetch through the visible list) and a `maskNode` (the entry's fade), and every mesh shares both
  nodes. The list a mesh reads is a per-object uniform (`uniform(0, 'uint').onObjectUpdate(...)`,
  as `LodFade.ts`'s object fade), written before each of its draws. The variant replaces the
  source's mask: a pool material's LOD dither reads an InstancedMesh's fade, which a GPU-path
  mesh doesn't have. The engine version teaches `LodFadeMaskNode` a third source instead, so a
  material's other mask (an alpha cut) is kept. The variants are disposed with the forest, the
  sources never.
- **The builds are the CPU path's: one per (material, pass), shared by every level, group and
  slot.** Read from three's caches (`_nodes.nodeBuilderCache`, `_pipelines`), the whole scene at
  5k / 20k:

  | | Node builds | Vertex / fragment programs | Render pipelines | Compute pipelines |
  | --- | ---: | ---: | ---: | ---: |
  | CPU path | 3 | 3 / 3 | 3 | 0 |
  | GPU path | 3 | 3 / 3 | 3 | 3 |
  | CPU path, shadow on | 9 | 7 / 8 | 8 | 0 |
  | GPU path, shadow on | 9 | 7 / 8 | 8 | 6 |

  The GPU path adds only its compute pipelines (reset, cull, finalize: 3 per slot). On both paths
  one render pipeline draws every tree in the view: the trunk's and foliage's programs differ
  only in their uniforms. Three keys a plain mesh's build by its material's content (its nodes
  included) and `receiveShadow`, not by the object. A variant per mesh (`?stressSharedBuilds=false`)
  shares nearly as well: 11 node builds instead of 9. What makes builds shareable is the shared
  nodes. Part 2's level materials held a per-level constant list base, which cost one build per
  (slot, level).
- **The look is the CPU path's.** At the same camera pose (`?stressCamera=STILL`, 20k, the
  shadow on), 0.12% of the scene's pixels differ by more than 8/255 and none by more than 64:
  the shadow map's edges and the order of overlapping copies.
- **The cost:** no clear change. GPU frame from 20k to 1M: 1.7 / 3.2-3.8 / 3.7 / 5.2 /
  3.9-4.7 ms without the shadow, 7.8 / 5.9-7.1 / 9.5 / 9.8 / 7.4-9.9 ms with it (repeated
  cases as ranges). Part 2 measured 2.7 and 3.7 ms at 100k and 1M without the shadow, so the
  doubled draws may cost up to about 0.5 ms; with the shadow it's within the spread. A
  production build with longer runs settles it (Phase 1). The CPU path in the same run measured
  8.1 and 11.2 ms with the shadow at 20k and 100k. The CPU frame stays 0.5-1.4 ms.

#### What this means for the real plan

1. **The GPU path is worth building, for static instanced content above about 20-50k instances.**
   It removes the per-instance CPU work, the entity per instance and the cap, and the off-screen
   draws. Below about 20k the CPU path costs under 2 ms of LOD and sync: it stays the default,
   and the only path on WebGL2.
2. **The instance data lives in buffers, not entities** (open question 2): a GPU pool's
   instances are plain data, its placements written once (a static scatter, p308's static cells,
   streamed cells). Moving instances, if any, go through a dirty list. Gameplay reading "is this
   visible" stays on the CPU path (the stub's ECS note).
3. **Not three's meshlet pipeline** for instanced LOD content: slower here, and it keeps the CPU
   cost.
4. **Still to measure before committing to phases:** ~~the per-camera cull through
   `drawingPipeline` with the VSM sun shadow on~~ (measured above: a slot per camera, two
   dispatches a frame, the shadow's cost flat with the count), ~~hysteresis and cross-fades on the
   GPU~~ (measured above: the CPU path's selection exactly, the fades within a frame, no
   measurable cost), and ~~the draw per (level, group) with the pools' own materials~~ (measured
   above: the CPU path's builds and look, a finalize pass for the groups' counts).
5. **Not measured:** occlusion culling (open question 3; at about 9k drawn instances it has little
   to win here), other GPUs (an integrated Intel or a phone, which p240's device level would
   gate), and a production build.

Each phase leaves the tree as the root's Workflow asks: `yarn test`, lint and both type-checks
clean (the Stop hook), and the docs ratchet holding. Each phase also runs:

- `yarn verify:scenes --only lodShowcase,largeWorld,instanceStress`: the pool's scenes don't
  move, Phase 1's ε fix included. Record the baselines on `main` first.
- `yarn verify:baselines`: the new API's exports, a lazy chunk per backend, and no debug code in
  the build. Update the baselines only in the phase that explains the change.
- `yarn sbp`: D10's budgets.

Every measurement goes in the phase's "As built" with its conditions, as Phase 0's did.

### Phase 1 — A set on WebGPU: the cull, the levels, one camera — done

1. **The rules (D3).** Add `src/_engine/utils/LodRules.ts`: the selection with its hysteresis,
   the cull test, the fade step and `LOD_FADE_END_EPSILON`. `selectLevel` (`LodSystem.ts`) and
   `LodFades.ts` call it. Unit tests cover the CPU path's cases (`LodSystem.test.ts`' selection
   cases move there) and the ε end (a 0.25 s fade at 1/60 s lasts 15 frames).
2. **The frame inputs (D3).** Add `setLodFrameInputs` / `getLodFrameInputs` in
   `kernel/ecs/LodTargets.ts`, written by `lodSelectionSystem` once a frame: the camera terms,
   the bias, the fade step, `freeze` and `forceLevel`. A test checks they're written with no
   `LOD` entity in the world too.
3. **The drawing pipeline seam (D5).** Add `kernel/render/DrawingPipeline.ts` with
   `addDrawingPipelineHook`: installed with the first hook, three's restored with the last, and
   the hooks called in the order they were added. Tests in Node with a stub renderer.
4. **The front (D1, D2, D10).** Add `features/instancing/InstanceSet.ts`:
   - `createInstanceSetAsync` and its options' checks: the levels as the pool checks them,
     `maxInstances ≤ 2^24`, `maxVisible`.
   - The owning entity (a `TAG_IS_MESH`-like delete hook that disposes the set), `object`, and
     `addInstances` (append only here; Phase 5 adds the removal).
   - The backend choice and its `import()`. Until Phase 4, a set on WebGL2 warns once and draws
     nothing.
   - On the entry, with JSDoc and an `@example`. Unit tests: the checks, the ranges, a scene
     exit during the import resolving `null`.
5. **The GPU backend, one slot.**
   - `InstanceSetGpu.ts` and `InstanceSetNodes.ts`: the buffers (D4: the affine matrices, the
     cull records, the state, the budgeted packed lists, the args) and the select, cull and
     finalize passes.
   - The select applies the hysteresis and switches levels instantly in this phase. A set with
     `fadeSeconds > 0` draws without fades and says so in its JSDoc, until Phase 2.
   - The variants and the draws per (level, group) (D8, without the mask's new source yet).
   - The cull is dispatched through the seam in `finishRenderList`, for the main camera only. Any
     other camera draws none of the set until Phase 3.
6. **`instanceStress` on the engine API (D12).** `?stressPath=gpu` creates a set, and
   `gpuCullSpike.ts` is removed. The tab and `measure()` read the set's debug readback (a
   `_dbg__` helper of the set's, the first part of D11). It gets a `scenes.config.ts` entry: a
   snapshot per path at `?stressCamera=STILL`, 20k trees, no fades.
7. **The harness, committed.** Phase 0's Playwright script becomes
   `devTools/bench/instanceStress.ts`, run with `npx tsx …` and given a layout rule for
   `devTools/bench/`. It takes the counts, paths and flags, and prints Phase 0's tables. It
   measures the dev server or a `yarn build:test` build (minified, `?isProdTest=true&aekTest=true`).
   The first step finds which of the scene's readouts load in prod test mode, and reads the rest
   from the harness's own frame timing.
8. **The nested `CLAUDE.md` files.** `features/instancing/CLAUDE.md` gets an
   "Instance sets" section, and `features/lod/CLAUDE.md` names `LodRules.ts` and the frame inputs.
   The Hub waits for Phase 6.

**Verification:**

- **Parity with the pool.** At 20k on the held orbit with the fades off, the per-level counts
  are the pool's exactly (Phase 0's first parity row). At `?stressCamera=STILL` the snapshot
  differs from the pool's by no more than Phase 0's 0.12% of pixels over 8/255.
- **The builds** are Phase 0's table: 3 node builds and 3 render pipelines, plus the 3 compute
  pipelines.
- **The cost**, on a `yarn build:test` build, 20k to 1M:
  - The CPU frame stays flat, under 1.5 ms.
  - The compute is compared with Phase 0's at the same drawn counts, to see what the cull
    record saves.
  - The GPU frame settles whether the draw per group costs about 0.5 ms (Phase 0, part 3).
- The ε fix moves no scene runner baseline. If one moves, its reason goes in "As built", and
  the baseline is updated in this phase.

**As built** (steps 1-8, 2026-11-09, commits up to `ce6733b0`, and the verification after them):

- **Step 1, the rules.** `utils/LodRules.ts`: `selectLodLevel` (the old `selectLevel`),
  `isLodCulledAt`, `selectLodTarget` (the cull test, then the level; from culled it comes from beyond
  the last level), `isLodChangeFaded`, `getLodFadeDelta`, `advanceLodFade` (exactly 1 at the end),
  `LOD_FADE_END_EPSILON`, the sentinels `LOD_LEVEL_NONE` (-1) and `LOD_LEVEL_CULLED` (-2), and
  `stepLodInstanceState` (an instance's frame: the target, then a fade's start and advance), which
  no path calls yet: it's the reference for Phase 2's TSL and Phase 4's CPU backend.
  `DEFAULT_LOD_HYSTERESIS` moved there (instancing can't import `lod`); `aekasha/lod` re-exports it.
  `LodSystem.test.ts`' selection cases moved to `LodRules.test.ts`.
- **Step 2, the frame inputs.** The main loop had no frame counter (D7 assumed one): `getMainLoopFrame()`
  (`MainLoop.ts`, `@internal`) counts every `runFrameWork`. `LodFrameInputs` (`LodTargets.ts`) has the
  frame (-1 until written, so for good without `lod()`), `hasCamera`, the camera position, `k` (the
  global bias in it), `isOrtho`, `bias`, the global `fadeSeconds` (not in D3's list: a set without its
  own needs it, and can't read `LodSettings`), `fadeStep`, `isFrozen` and `forceLevel`.
  `lodSelectionSystem(world, dt)` writes them before its early returns, once a frame across worlds,
  and reuses the terms. Written in `APP_RENDER_SYNC`: a paused app loop keeps the last frame's.
- **Step 3, the seam.** `addDrawingPipelineHook(renderer, hook)` takes the renderer (the tests' stub;
  no `Renderer.ts` imports in the lazy chunk). `isCulled` is tri-state (`undefined` passes on, then
  three's test). `finishRenderList` fires for the render's own list only (the first begun after
  `begin`): three finishes a `BundleGroup`'s list inside the projection too. A pipeline set over the
  engine's meanwhile stays (the remover warns). `getDrawingPipelineHooks` for tests and tools.
- **Step 4, the front.** A core component `INSTANCE_SET` (`InstanceSetData` in `InstanceSetTypes.ts`,
  with the backend contract) disposes the set. The owning entity is created before the `import()`,
  and `world.isAlive` after it says whether the scene exited (`createPhysicsEntity`'s pattern).
  `entityOpts.persistent` is applied by the set (`createEntity` doesn't:
  `docs/issues/entity-persistent-flag-not-applied.md`, which now names the pool's same gap). A
  non-uniform matrix warns in the debug env instead of failing (debug and production behave alike).
  No `preWarm` option until Phase 5. The front keeps no CPU copy: `writeInstances(start, matrices16,
  count)` hands the matrices to the backend's own layout. WebGL2 gets an empty backend that warns once.
- **Step 5, the GPU backend.** The state is one `uint` (Phase 2 adds the progress float). The counters
  are apart from the args: an append past `maxVisible` is only counted, and the finalize writes
  `min(count, maxVisible)` into each group's args. The frustum sphere is the record's grown by the
  largest level's conservative radius over level 0's. One cull kernel with a mode uniform (`SELECT`,
  `FORCE`, `HOLD`), so `forceLevel` and `freeze` already work (Phase 2 step 3 keeps `fadeTimeScale`
  and the side-by-side check). One module-level pipeline hook for every GPU set; only the main
  camera's renders draw one. The cull's dispatch count is the extent (three recomputes it, 2D past
  the limit). The draws' wrapper geometries aren't disposed (three would free the level geometries'
  shared buffers); variants copy the source's values once and replace its `positionNode` (a debug
  warning). A list entry's fade byte is 0 until Phase 2.
- **Step 6, `instanceStress`.** `readInstanceSetStatsAsync(set, { state? })` is public on
  `aekasha/instancing` (the app reads it), debug env and prod test mode, through
  `debug/_dbg__InstanceSet.ts`: the last dispatch's drawn and overflowed instances per level, and
  every instance's level. The scene runner got scene `params` and `variants` (chosen over one path or
  none: `sceneSelect.ts`' `getSceneTargets`, `devTools/verify/CLAUDE.md`); `instanceStress` runs as
  `instanceStress@pools` and `instanceStress@set` (20k, `STILL`, no fades). Measured (Apple M2, Chrome,
  headless WebGPU, debug env, dev server):
  - Parity at 20k, the held orbit, fades off, 300 frames: the set's state per level is 960 / 5,429 /
    13,611, the pools' and Phase 0's first row exactly.
  - The runner's snapshots, `@set` against `@pools` in each debug configuration: one pixel of 147,456
    (0.0007%) over 8/255, none over 9/255.
  - Builds: 3 node builds and 3 render pipelines, plus 3 compute pipelines (Phase 0's table).
  - CPU frame 1.1 ms (the set) against 4.6 ms (the pools); in view 221 / 1,384 / 3,392 (Phase 0's
    205 / 1,338 / 3,448 with its tighter sphere).
  - three's `info.render` counts neither the set's indirect draws nor their triangles (Phase 0 thought
    it counted the calls): D11's folder reads the set's own counts.
  - The runner hung once after a Vite reload mid-page, in code that predates this plan:
    `docs/issues/scene-runner-hangs-after-a-vite-reload.md`.
- **Step 7, the bench.** `devTools/bench/instanceStress.ts` (CLI) and `instanceStressBench.ts` (its pure
  parts, tested). No layout rule: `layoutRules.ts` covers `src/` only. The first step's finding: the
  scene's probe loaded in the debug env only; it now loads through `loadDebugModuleAsync(…, true)`, so
  prod test mode has `measure()`, but no stats panels, so no GPU or compute figures there: a minified
  build's GPU side is `--build --mode debug`. Its own dev server sets `VITE_ECS_MAX_ENTITIES` for pool
  cases past 90k; `--build` serves `dist/` with COOP / COEP and collapses doubled slashes (a build asks
  for `//debugger/…`). At 20k on the orbit: the pools' CPU frame 3.86 / 3.65 / 3.51 ms (dev debug,
  dev prod test, test build prod test), the set's 0.49 / 0.45 / 0.42 ms; GPU frame (dev debug) 2.59 ms
  against 1.59 ms.
- **Step 8, the notes.** `features/instancing/CLAUDE.md`'s "Instance sets", `features/lod/CLAUDE.md`'s
  `LodRules.ts` and frame inputs bullets. From Phase 6 step 2, done early: "Instance sets" is in the
  LOD page's `aek:covers` (`yarn hub:build` fails on an uncovered `##` section). Still Phase 6's: the
  root map's instancing line, `kernel/render/CLAUDE.md`'s Drawing pipeline section, `devTools/bench/`
  under the root's Commands, and the LOD page's content.

- **The verification** (2026-11-09, Apple M2, Chrome, headless WebGPU):
  - **The scene runner.** Baselines recorded on `main` (`73663bb6`, a worktree whose `.cache` linked
    this checkout's: the baselines are local) for `lodShowcase` and `largeWorld`, then the branch:
    every run passed, the probe hashes and system orders unchanged. The ε fix moves no pool baseline:
    largeWorld's snapshots are identical, lodShowcase's `workerSab` and `debugger` within tolerance
    (mean 0.008, 0.00% changed, max 3/255). `instanceStress@pools` and `@set` recorded.
  - **`yarn verify:baselines`, then `--update`.** `api.json`: the new exports (`aekasha/instancing`
    gains `createInstanceSetAsync`, `readInstanceSetStatsAsync`, `CreateInstanceSetOptions`,
    `InstanceRange`, `InstanceSet`, `InstanceSetBackendKind`, `InstanceSetStats`), `selectLevel`
    removed, `DEFAULT_LOD_HYSTERESIS` moved to `utils/LodRules.ts`; docs 100%. The main chunk
    371.6 → 373.7 kB gzip: instancing +1.2 kB (the front, D10's kilobyte), lod +0.1, ecs +0.2, utils
    +0.2, app +0.2. `InstanceSetGpu.js` is lazy (3.7 kB gzip: `InstanceSetGpu.ts` and
    `InstanceSetNodes.ts`, 3.2 kB, with `DrawingPipeline.ts`, 0.8 kB). `instanceStress.js` new (2.1 kB),
    and `Foliage.js` (0.6 kB) split out of `largeWorldRock.js`, the tree geometry now shared by two
    scenes. The embeds unchanged; no debug code in the build or either embed.
  - **`yarn sbp --profile all`.** `features/instancing` 3.9 kB against its 4 KiB (Phase 2's front
    growth will need it raised), `features/lod` 5.4 against 7 KiB, the GPU backend lazy, the banner's
    and uiKit's budgets all within. The `app` group failed by 63 B (14,399 B against 14 KiB): the
    `instanceStress` scene's JSON (+2.6 kB raw of `generatedAppData.json`), which every scene puts in
    the first download. Raised to 15 KiB in `sbp.config.ts` with that reason.
  - **The bench** on a `yarn build:test` build (minified, `VITE_ECS_MAX_ENTITIES=1110000`), 1600 ×
    900, the orbit, the fades at the scene's default (the set draws without them). CPU frame, prod test
    mode, 300 frames:

    | Trees | 20k | 50k | 100k | 200k | 500k | 1M |
    | --- | ---: | ---: | ---: | ---: | ---: | ---: |
    | The set | 0.49 | 1.12 | 1.41 | 1.16 | 1.16 | 1.11 ms |
    | The pools | 3.56 | 7.19 | 12.08 | 24.56 | 60.37 | 166.03 ms |

    The set's CPU frame is flat and under 1.5 ms; most of it is the render submit (0.4-1.1 ms, rising
    with the GPU frame, so likely the wait on the GPU; not checked). The pools' LOD systems grow faster
    than linear past 500k (45.8 ms, then 141.6 ms at 1M). Debug env, 1,200 frames (the pools at 1M
    from a 300-frame run: 1,200 frames of 168 ms passed the bench's answer timeout):

    | Trees | 20k | 100k | 200k | 500k | 1M |
    | --- | ---: | ---: | ---: | ---: | ---: |
    | Compute, the set | 0.04 | 0.15 | 0.27 | 0.47 | 0.69 ms |
    | Compute, Phase 0 (fades off / on) | 0.05 / 0.05 | 0.22 / 0.20 | 0.62 / 0.33 | 1.03 / 0.61 | 1.55 / 1.10 ms |
    | GPU frame, the set | 1.50 | 2.84 | 3.70 | 4.18 | 4.69 ms |
    | GPU frame, the pools | 2.60 | 5.15 | 5.42 | 6.90 | 7.07 ms |
    | GPU frame, Phase 0 part 2 (a draw per level) | 1.44 | 2.54 | 3.31 | 3.92 | 3.68 ms |

    - **The cull record about halves the compute at 500k-1M** (40-55% under Phase 0's, at the same
      drawn counts: 187 / 1,361 / 37,880 at 1M, Phase 0's "about 40k"). At 100k and below it's within
      the spread. No overflow at any count (the largest list 37.9k of 65,536).
    - **The GPU frame is 55-65% of the pools'.** Against part 2 the set measures 0.3-0.4 ms more at
      100k-500k and about 1 ms at 1M, within the spread at 20k. That's Phase 0's "up to about 0.5 ms"
      for the draw per group, but it includes part 2's own height-coloured material against the pools'
      Lambert ones, so the draws' share isn't isolated. The 300-frame run's 1M measured 4.18 ms: about
      ±0.5 ms run to run.
    - Builds: 3 node builds and 6 pipelines (3 render, 3 compute) at every count. The pool path shows 4
      and 4 from 100k up (3 and 3 below), not looked into.

### Phase 2 — Cross-fades and the debug options — done

1. **The fades in the select.** Add the state's outgoing level and progress, the fade's start,
   its mid-fade change and its advance by the frame inputs' step (D3's rules, ported). The two
   copies are appended with their packed signed fades (D4). A fade to or from culled has one
   copy.
2. **The mask (D8).** `LodFadeMaskNode` (`kernel/render/LodFade.ts`) gets its third source, the
   set entry's fade, read through the vertex stage. It's ANDed with the object's visibility fade
   on the same noise, and a material's other mask is kept. The variant no longer replaces the
   source's mask: the set calls `enableLodDither` on its sources. The file's header comment says
   where each kind of drawn object reads its fade.
3. **The debug options.** `freeze`, `forceLevel` and `fadeTimeScale` come through the frame
   inputs. Check them against the pool from the LOD tab, side by side in `instanceStress`.
4. **D11's tab folder.** The LOD tab's Instance sets folder, with the backend, the counts per
   level, the fading count and the overflow.

**Verification:**

- **Parity, frame for frame.** At 20k on the held orbit, with fades off, 0.25 s and 1 s, the
  counts per level and fading match the pool's exactly at the measure's last frame. With the ε
  fix on both paths, no frame of difference is left (Phase 0's table had 198 against 220).
- With `fadeTimeScale` at 0.1, the dither looks the same as the pool's (a snapshot pair at a
  held fade, the `STILL` camera).
- Fades cost no measurable compute or GPU frame, as Phase 0 found, now on the minified build.

**As built** (steps 1-4, 2026-11-09, commits `3bf645a6` to `360a3b5a`, and the verification
after them):

- **Step 1, the fades in the select.** `InstanceSetNodes.ts`' cull ports `stepLodInstanceState`
  after `selectLodTarget`. The state word keeps the level and the outgoing level. The progress is
  an `f32` buffer of its own (D4's 8 B), read only while a fade runs and written only when the
  state changes or a fade runs. A list entry's fade byte is `127 + round(t × 127)` for the
  incoming copy and `round(t × 127)` for the outgoing one: both copies decode from one rounded
  `t`, so they split the pixels exactly (127 steps a side, not D4's 255; 254 draws whole). The
  mode gains `ADVANCE`: under `freeze` (or with no selection camera) the levels hold and the fades
  run, as `lodFadeSystem` does. `FORCE` now fades as the ECS path's forced level does, and
  without `lod()` it draws level 0 unfaded. The fade's delta is a uniform,
  `getLodFadeDelta(inputs.fadeStep, lod.fadeSeconds ?? inputs.fadeSeconds)`, so the shader only
  adds and clamps at `1 − ε`. `InstanceSetStats.state` gained `fading`, and a fading instance
  counts in both its levels, as a pool's level meshes hold it.
- **Step 2, the mask.** `LodFadeMaskNode`'s third source is keyed by material:
  `setMaterialLodFade(material, fade)` (`@internal`). A material with its own fade uses it in
  place of the object's LOD fade, still ANDed with the object's visibility fade. The fetch returns
  `{ position, fade }`; the fade is a flat varying decoded from the entry's byte. The set calls
  `enableLodDither` on its sources before building the variants, which copy the whole mask.
- **Step 3, the debug options.** They already reached the set through the frame inputs (steps
  1-2). The LOD tab's "Force level" listed only the `LOD` entities' levels, so on a set path it
  offered "Level 0" alone. That needed D11's seam a step early: `registerLodContentDebugSource` /
  `getLodContentDebugSources` (`kernel/ecs/LodTargets.ts`, `@internal`, called only by debug code).
  `instancing()`'s `onDebug` loads `_dbg__InstanceSet.ts`, which registers a source over the
  front's live sets (`getLiveInstanceSets`, kept in the debug env only). The check drives the LOD
  tab's controls through the test bridge (chosen over making `setLodDebugOptions` public or adding
  a bridge method): `devTools/bench/instanceStressLodTab.ts`, with its pure parts tested
  (`instanceStressLodTabChecks.ts`). Its held fade dispatches the time scale's keys inside the
  page around the scene's `measure(75)`, so both paths advance exactly 75 frames.
- **Step 4, the tab folder.** "Instance sets" has a field per set, labelled with the set's name,
  in 19-character lines (the Entities counts' width; a table of three columns wrapped in the
  drawer): the backend and instances; per level the copies drawn (the main camera's) over the
  instances selected; then culled, fading, overflow, and the triangles drawn (the drawn copies ×
  each level's triangles). The figures come from a `state: true` readback that each refresh of
  the open tab asks for, one at a time per set, so a closed tab reads nothing. A set added or
  removed, or another level count, rebuilds the tab.

- **The verification** (2026-11-09, Apple M2, Chrome, headless WebGPU):
  - **Parity, frame for frame** (step 1's bench, 20k, the held orbit, 300 frames, the dev server,
    debug env): the per-level state and the fading count are the pool's exactly.

    | Fades | Pools: per level / fading | Set: per level / fading |
    | --- | --- | --- |
    | off | 960 / 5,429 / 13,611, 0 | 960 / 5,429 / 13,611, 0 |
    | 0.25 s | 991 / 5,522 / 13,685, 198 | 991 / 5,522 / 13,685, 198 |
    | 1 s | 1,110 / 5,851 / 13,963, 924 | 1,110 / 5,851 / 13,963, 924 |

    Phase 0's frame of difference (220 against 198) is gone: with the ε end, the pool's 0.25 s
    fade lasts 15 frames too.
  - **The LOD tab check** (20k, 0.25 s): both paths agree at every checkpoint. Settled
    861 / 4,763 / 14,376. Time scale 0, then Force level 1: 15,237 fading, held at 0. 75 frames at
    0.1: held at 0.5. Time scale 1: 0 / 20,000 / 0. Force level Off: 861 / 5,818 / 13,321 (from
    level 1, the hysteresis keeps 1,055 of level 2's band at level 1, on both paths). Freeze, then
    120 frames of the orbit: unchanged.
  - **The held fade's snapshot pair** (1024 × 576, fades held at 0.5): the set's against the
    pools' differs in 0.01% of pixels (mean 0.004), within the scene runner's tolerance. Had the
    set drawn both copies of its 15k fading trees whole, their silhouettes would differ far more.
  - **The cost**, on a `yarn build:test` build (minified), the orbit, 600 frames, debug mode (for
    the stats panels), fades off / 0.25 s:

    | Trees | 20k | 100k | 200k | 500k | 1M |
    | --- | ---: | ---: | ---: | ---: | ---: |
    | Compute | 0.06 / 0.06 | 0.19 / 0.19 | 0.30 / 0.28 | 0.46 / 0.55 | 0.80 / 0.80 ms |
    | GPU frame | 1.53 / 1.53 | 3.16 / 3.21 | 3.79 / 3.83 | 4.29 / 4.49 | 4.60 / 4.73 ms |
    | Fading | 0 / 229 | 0 / 762 | 0 / 1,980 | 0 / 5,331 | 0 / 8,163 |

    The fades cost no measurable compute or GPU frame: every pair is within Phase 1's ±0.5 ms
    spread. The compute matches Phase 1's (0.04-0.69 ms). The CPU frame in prod test mode, fades
    on, measured 0.39-0.56 ms at 20k and 1M on a quiet machine. A run straight after the long
    verification chain read 1.0-1.2 ms with fades off and on alike, so that was the machine's
    state. Builds: 3 node builds and 6 pipelines at every count, as in Phase 1. No overflow.
  - **`yarn verify:scenes --only lodShowcase,largeWorld,instanceStress`**: 17 runs pass. The
    pool scenes and their probe hashes are unchanged; `instanceStress@set` is within tolerance
    of its Phase 1 snapshot (fades off: mean 0.001, max 9/255).
  - **`yarn verify:baselines --update`**: the lazy `InstanceSetGpu.js` 3.7 → 4.1 kB gzip (the
    fades and the dither), and ten `@internal` exports added (the debug seam, `setMaterialLodFade`,
    the fade byte's constants, the live sets). The main chunk and both embeds are unchanged; docs
    100%; no debug code in any build.
  - **`yarn sbp --profile all`**: `features/instancing` is still 3.9 kB against its 4 KiB (the
    debug seam and the live-set list fold out of production), so no raise. `features/lod` is 5.4
    against 7 KiB, and every budget is within.

### Phase 3 — Every camera: shadows, viewports, the debug camera — done

1. **Slots (D6).** Allocate on first sight, release after 120 unused frames, cap at `maxSlots`
   (and warn once past it). Each slot has its draws, lists and args.
2. **The dispatch per render (D5).** In `finishRenderList`, for the slots that the render's
   projection reached. The first step confirms the order with a nested shadow render: does the
   main render's `finishRenderList` run before `ShadowNode.updateBefore` starts the shadow's
   render? If it doesn't, fall back to Phase 0's `begin` and record why.
3. **Once a frame (D7).** The frame's first dispatch selects and advances, and the others only
   read the state. Test: two renders of the main camera in one frame advance a fade once.
4. **Shadow cameras.** A light's `shadow.camera` is recognized, and its slot draws only the
   casting levels. Cover the sun (VSM, `SunShadowFit`), a spot light (one camera) and a point
   light (six faces in one slot, sequential).
5. **Other cameras.** A viewport (`viewports()`), the debug camera, `takeSnapshotAsync` of the
   root scene, and the pre-warm camera (`compileAsync`). Each draws its frustum of the main
   camera's levels.

From Phase 2 (its "As built"), for these steps:

- **The shadow pass's dither.** A set variant's mask finds its fade by the material being built
  (`setMaterialLodFade`, keyed on `builder.material`). Step 4 checks what the shadow pass builds a
  set draw with: if it's an override material rather than the variant, the lookup misses, and the
  set's two copies of a fade cast whole. Then the fade moves to a key that the shadow build also
  sees (the drawn object, or the variant's `castShadowNode` / `maskShadowNode`).
- **A slot's copies.** The cull already appends a fading instance's two copies from the state, so
  a later slot's dispatch (`HOLD`) appends them with the same fade bytes. The shadow slot needs
  only its casting levels' lists.
- **The tab per slot (D11).** `LodContentDebugStats` has one camera's `drawn` and `overflow`; this
  phase makes them per slot (each slot's camera named), and `readInstanceSetStatsAsync` reads
  every slot's counters.

**Verification:**

- **`?stressShadow=true`** (the VSM sun) has the CPU path's look: Phase 0's pixel diff. Its cost
  is Phase 0's: the shadow's fixed cost plus about 1k casting instances, whatever the count.
- **A spot light and a point light** (new `instanceStress` flags) shadow the set with every
  face correct. Check it with snapshots against the pool path at 5k (the pool's point shadow is
  the reference).
- **A viewport** of the scene and **the debug camera** show the set. A snapshot of the root
  scene matches the canvas. An impostor bake or a sky bake dispatches nothing (the readback's
  dispatch count).
- **The compute with N slots** at 200k, 500k and 1M. If it passes about 2 ms at 1M with the sun,
  §5's single dispatch or cell pre-cull becomes a step here. Otherwise it's left for later.

**As built** (step by step, 2026-11-09):

- **Step 1, the slots.** `maxSlots` is an option (`CreateInstanceSetOptions`, default 8, a
  positive integer; the front's three count checks share one helper). How a camera gets its slot
  on its first render: the set's group holds a **probe**, a `Mesh` the hook always culls (empty
  geometry, an invisible material: never listed under another pipeline either). three's
  `StandardDrawingPipeline.project` reads an object's `children` after its own `isCulled`, so the
  probe's `isCulled` picks the render's slot (found, or taken from the free ones) and the slot's
  group under the probe is projected in that same render. **The lists, counters and args are one
  buffer each, sized for `maxSlots` at creation**, not grown per slot (D6 said "on its first
  dispatch"): the vertex fetch binds one lists buffer, which keeps every slot's draws on one build
  (D8), and growing the args while a nested render takes a slot (the sun's, during the view's
  draws) would move the buffer the outer render's draws still read. three r187 does rebind a
  storage binding whose attribute changed (`Bindings._update`), but the outer draws would read the
  new args without the outer dispatch's counts. A `slotLevel` uniform (slot × levels) puts each
  dispatch in its slot's part; a slot's meshes read theirs through the list base and their own
  indirect offset. A slot's draws are made on its index's first use and kept, detached, while it's
  free. A slot no render reached for 120 main loop frames is released (checked once a frame, in a
  render that reaches the set). Past `maxSlots` a camera draws none of the set, and the debug env
  warns once per set. **A shadow render gets no slot until step 4** (`isShadowPassMaterial` on the
  probe's root scene's `overrideMaterial`, three's shadow pass): its slot would draw every level,
  and VSM draws a receiving level whatever its `castShadow`. `readInstanceSetStatsAsync` gained
  `slots` (each camera's drawn and overflow per level: `main`, else its name, or its type and id;
  `InstanceSetSlotStats`, public), while `drawn` and `overflow` stay the main camera's, which
  `instanceStress`, the bench and the LOD tab read. `instanceStress`' `__aekInstanceStress` has
  `stats(state?)` for page scripts.
  - **D7's rule changed: the state moves in the frame's first dispatch after `lod()` wrote the
    frame's inputs**, not in its first dispatch. With every camera dispatching, a dispatch could run
    before the inputs existed: `compileAsync` at the scene's load, before the first frame. Phase 2's
    code read the unwritten inputs as "no `lod()`": it warned, forced level 0, and the first real
    selection then started from level 0, so the hysteresis kept a band of trees a level finer
    (`instanceStress@set` failed the scene runner: mean 0.140, 0.26% changed). Now a dispatch whose
    frame the inputs aren't from only reads the state, and "no `lod()`" is concluded only when
    nothing was written a whole frame after the set's first dispatch (an app loop paused from the
    boot would read as that too).
  - The first frames' renders during a load go through the active camera, the debug camera until
    the scene's main camera exists: it takes a slot then, released 120 frames later.
  - Verified (Apple M2, Chrome, headless WebGPU, the dev server, debug env): `yarn verify:scenes
    --only instanceStress` passes all 8 runs (`@set` in each configuration against its Phase 2
    snapshot). A page check at 20k, `STILL`: the main camera's slot draws 207 / 1,427 / 3,421; F1
    puts the debug camera in a slot of its own (drawing 0 / 21 / 21 in its frustum, the main
    camera's levels), and 140 frames after F1 again only the main camera's slot is left.
    `yarn sbp`: `features/instancing` 4,044 → 4,102 B gzip (the option), over its 4 KiB, raised
    to 5 KiB in `sbp.config.ts` with that reason; the lazy `InstanceSetGpu.js` 4.1 → 4.8 kB gzip.
- **Step 2, the dispatch per render.** It went in with step 1: `finishRenderList` dispatches the
  sets whose probes the render's projection reached, each into the render's slot. **The order
  holds, so no fallback to `begin`.** A trace of one frame with the sun's VSM shadow
  (`?stressShadow=true`, 20k, `STILL`), wrapping three's own prototypes (the app's instance of
  the prebundled `three_webgpu.js`, found by its resource entry) in a page:

  ```
  render Scene / PerspectiveCamera (the view) {
    begin, finishRenderList, compute (the view's slot)
    renderShadow DirectionalLight {
      render Shadow Map / OrthographicCamera (the sun's) { begin, finishRenderList }
    }
    render Mesh / OrthographicCamera (the VSM blur, twice) { begin, finishRenderList }
    begin, finishRenderList (the output pass's quad)
  }
  ```

  The view's `finishRenderList` and its dispatch run before `ShadowNode.renderShadow` starts the
  nested render. The shadow render dispatches nothing yet (step 1's gate); the blur and output
  quads' scenes don't hold the set, so they dispatch nothing either. With step 1's reading of three
  (each `compute` and each render submits on its own, in call order), every render's draws read its
  own dispatch. `InstanceSetGpu.test.ts` covers the backend's hook in Node: three's real
  `StandardDrawingPipeline.project` on a stub renderer, the passes a stand-in recording each
  dispatch's mode and slot. It covers a slot taken and drawn in the camera's first render, each
  camera drawing only its own slot, no slot or dispatch for another scene, a hidden set or a
  shadow pass, the cap and the release after 120 frames, the dispose, and step 3's D7 cases.
  Two mutations (every slot's draws passing the cull, the state moving before the inputs) each
  fail it.
- **Step 3, once a frame.** The code is step 1's D7 rule (the frame's first dispatch after the
  inputs moves the state, every other one only reads it), and its Node test is step 2's file:
  two renders of one camera in a frame, then another camera, select once and hold four times; a
  dispatch before the frame's inputs holds; no inputs a whole frame after the first dispatch
  forces level 0. The readback's slots gained `dispatches` (since the camera took the slot; step 5
  reads it for the bakes). **The page check** (20k, the held orbit, 1 s fades, 120 frames, the
  dev server, debug env): the set alone, the set with test bridge snapshots taken back to back
  (each a second render of the main camera in its frame), and the pools.

  | Run | Main slot's dispatches | State per level / fading |
  | --- | ---: | --- |
  | The set alone | 149 | 1,083 / 5,502 / 14,267, 852 |
  | The set, 248 snapshots meanwhile | 397 | 1,083 / 5,502 / 14,267, 852 |
  | The pools alone | | 1,083 / 5,502 / 14,267, 852 |

  Every snapshot dispatched into the main camera's slot (397 − 149 = 248) and advanced nothing,
  and the set's state is still the pools' exactly after step 1's change to D7.
- **Step 4, the shadow cameras.** **A shadow render is recognized by three's shadow pass, not by
  a light lookup** (D6 said "the `shadow.camera` of a light in the root scene, cached per camera"):
  the probe's root scene has a shadow pass material as its `overrideMaterial`
  (`isShadowPassMaterial`, set by `ShadowNode.updateShadow` for the render). That's free per
  render, needs no cache, and covers every light kind and any scene. A shadow render's slot draws
  the casting levels only (`castShadow` per level, default true): a `levelMask` uniform keeps its
  dispatch from appending the other levels (a bit per level below 32; a level past that always
  passes, and the hook culls its draw), and the hook culls the other levels' draws, which VSM
  would draw into the shadow map as receivers whatever their `castShadow`. Each draw now has its
  level's `castShadow` (three's shadow pass lists only casters). A set with no casting level
  takes no slot for a shadow. The readback names a shadow slot after its light (`<name or type>
  shadow`).
  - **The shadow pass's dither (Phase 2's note): it missed, and the fade moved to the object.**
    three's shadow pass builds a draw with its shadow pass material, whose `colorNode` wraps the
    source material's `maskNode` (`Renderer._getShadowNodes`), so `builder.material` there is the
    shadow material and `setMaterialLodFade`'s lookup missed: both copies of a fade cast whole.
    `setMaterialLodFade` is now `setObjectLodFadeNode(object, fade)` (`LodFade.ts`, `@internal`),
    keyed on the drawn object, which both builds see; the set calls it on each draw before its
    first build. Builds still share: every draw of a set's material reads its set's one fade node,
    and its position fetch (the set's own) already keys the builds apart from other sets' and
    from the pools'. `LodFade.test.ts` sets up the mask for the object with the source material
    and with another (the shadow pass's), and finds the node in both.
  - `instanceStress` gained `?stressLight=spot|point`: a spot light 30 m above the halfway point
    of the still camera's view, aimed where it looks, or a point light 10 m up among the trees
    there (its shadows fall every way, so several cube faces show), each with a 1024² map, on the
    ground the sun's shadow uses. The LOD tab check gained `--shadow sun|spot|point`.
  - **Verified** (Apple M2, Chrome, headless WebGPU, the dev server, debug env). Snapshots at 5k,
    `STILL`, no fades, the set against the pools (1024 × 576):

    | Light | Pixels over 8/255 | Mean / max delta | Shadow slot drew (L0 / L1 / L2) | Its dispatches a frame |
    | --- | ---: | --- | --- | ---: |
    | Sun (VSM, fitted) | 0.027% | 0.006 / 55 | 603 / 1,492 / 0 | 1 |
    | Spot | 0.000% | 0.000 / 27 | 148 / 383 / 0 | 1 |
    | Point | 0.002% | 0.000 / 14 | 374 / 77 / 0 (the last face's) | 6 (354 against the view's 59) |

    Phase 0's VSM comparison was 0.12% at 20k. The pools draw their non-casting level 2 into the
    VSM map as a receiver and the set doesn't: within these figures. The LOD tab check at 20k
    with a shadow: both paths agree at every checkpoint, and the held fade's snapshots (15,237
    trees at 0.5) differ by a mean of 0.019 with the sun (0.02% of pixels) and 0.003 with the
    point light. With the shadow pass's dither broken on purpose (the object's node read only
    when the material being built is the object's own), they differ by 0.148 and 0.056 (0.06%
    of pixels), seven to nineteen times more, yet both stay within the scene runner's tolerance:
    the blurred and soft shadows keep nearly every pixel under 8/255. So the check measures this
    bug but doesn't fail on it. `yarn verify:scenes --only lodShowcase,largeWorld,instanceStress`:
    all 17 runs pass after the `LodFade.ts` change. The cost with the shadow (D6's "about 1k
    casting instances, whatever the count") is measured with the phase's verification, after
    step 5.
- **Step 5, the other cameras.** No engine change was needed for them: each is a render that
  reaches the set's probe. What changed is the tab (D11, Phase 2's "the tab per slot"):
  `LodContentDebugInfo` gained `cameraCount` (the slots held now, read synchronously, so the
  field's line count is known before a readback), and `LodContentDebugStats` gained `cameras`
  (each slot's name and drawn copies per level). The set's field adds a "Cameras" heading and a
  line per camera, the name cut to leave room for the counts. Overflow and Triangles now sum
  every camera's, as three's `info.render` counts every render's. A camera starting or stopping
  to draw a set changes the folder's signature and rebuilds it, as a set coming or going does.
  D11's per (slot, level) overflow doesn't fit a 19-character field: the readback has it
  (`InstanceSetStats.slots`). `instanceStress` gained `?stressViewport=true`, a 320 × 180
  picture-in-picture of the root scene from 150 m above where the still camera looks.
  - **Verified** (20k, `STILL`, no fades, the dev server, debug env):
    - A viewport: over 60 frames the main camera's and the overview's slots each gained 60
      dispatches, and no other camera took a slot. The viewport's pixels on the page, the set's
      against the pools': identical (max delta 0).
    - The debug camera: step 1 (its own slot, its frustum, the main camera's levels).
    - A snapshot of the root scene (`takeSnapshotAsync`) against the canvas on the page (the HUD
      hidden): identical (max delta 0).
    - A `compileAsync` of the root scene with a new camera at the main camera's pose (the
      renderer and scene caught from three's `Renderer.render`): the camera took a slot, it
      dispatched once, and the state was unchanged. The engine's pre-warm camera is one shared
      camera, so a pre-warm takes one slot, released 120 frames later.
    - Bakes: no camera but the main one, the overview and the debug camera at the load ever took
      a slot. The renders per frame are the view, the shadow's, its blur quads and the output
      pass (step 2's trace), and only the ones whose scene holds the set dispatch. `instanceStress`
      has no impostor bake: a bake renders its own scene, which holds no probe (the Node test's
      "a render that doesn't reach the set").

- **The verification** (2026-11-09, Apple M2, Chrome, headless WebGPU):
  - **The cost**, on a `yarn build:test` build (minified, `VITE_ECS_MAX_ENTITIES=1110000`), the
    bench's debug mode (for the stats panels), 1600 × 900, the orbit, 600 frames, fades off:

    | Trees | 20k | 100k | 200k | 500k | 1M |
    | --- | ---: | ---: | ---: | ---: | ---: |
    | The set: GPU frame, no shadow → the sun's | 1.46 → 7.62 | 3.04 → 8.61 | 3.65 → 7.87 | 4.31 → 9.02 | 4.84 → 8.69 ms |
    | The set: compute, no shadow → the sun's | 0.06 → 0.14 | 0.17 → 0.23 | 0.25 → 0.33 | 0.41 → 0.67 | 0.61 → 1.07 ms |
    | The set: CPU frame with the sun's | 1.40 | 1.39 | 1.48 | 1.32 | 1.53 ms |
    | The sun's slot drew (L0 / L1; L2 casts nothing) | 829 / 2,022 | 790 / 2,212 | 780 / 2,210 | 789 / 2,137 | 778 / 2,151 |
    | The pools: GPU frame, no shadow → the sun's | 2.77 → 8.59 | 4.93 → 13.11 | | | ms |
    | The pools: CPU frame, no shadow → the sun's | 4.49 → 4.52 | 12.97 → 14.38 | | | ms |

    - **The shadow's cost is Phase 0's: a fixed cost plus the casting instances in its frustum,
      whatever the count.** The sun's slot draws about 3k copies from 20k to 1M trees (D6's
      "about 1k" was Phase 0's tighter sphere and older measure; Phase 0 part 2 counted about
      570 / 2,500), and the GPU frame with it stays at 7.6-9.0 ms. The pools' shadow grows with
      the count: 13.1 ms at 100k against the set's 8.6.
    - **The compute with two slots is 1.07 ms at 1M**, under the 2 ms that would have made §5's
      single dispatch or the cell pre-cull a step here (Phase 0's spike: 2.13 ms). Left for later.
    - The CPU frame with the shadow stays flat at 1.3-1.5 ms (0.5-0.9 ms without it: the shadow
      render's submit).
    - **Builds: 4 node builds and 7 pipelines without the shadow** (Phases 1-2: 3 and 6), 10 and
      12 with it. The extra one is a second build of the tree material without lights: the
      scene's first frames render it through the debug camera (the active camera until the
      scene's own exists) before the scene's JSON lights are created, and the set now draws for
      that camera (a slot). Its fragment program's outgoing light is the emissive alone. The
      pools pay the same once a load spans frames (Phase 1's "4 and 4 from 100k up, not looked
      into"). It's the engine rendering a half-built scene, not this plan's: one extra compile
      per level material on the load.
  - **`yarn verify:scenes --only lodShowcase,largeWorld,instanceStress`**: 17 runs pass.
  - **`yarn verify:baselines`, then `--update`**: the lazy `InstanceSetGpu.js` 4.1 → 4.9 kB gzip
    (the slots, the level mask, the shadow slot), `instanceStress.js` 2.1 → 2.6 kB (its lights,
    viewport and stats); the API's `setMaterialLodFade` → `setObjectLodFadeNode`, `ALL_LEVELS`,
    `InstanceSetDebugSlot` added (`@internal`), and `InstanceSetSlotStats` on
    `aekasha/instancing`. The main chunk and both embeds unchanged; docs 100%; no debug code in
    any build.
  - **`yarn sbp --profile all`**: every budget within (`features/instancing` at 5 KiB since
    step 1).

### Phase 4 — The CPU fallback (WebGL2) — done

1. **`InstanceSetCpu.ts` (D9).** An `InstancedMesh` per level with its `lodFade` attribute. The
   per-frame loop over the typed arrays runs `LodRules.ts`' selection and fades, and rewrites
   only the levels whose membership changed (a swap-remove per change, as the pool does). It runs
   at `APP_RENDER_SYNC_ORDER.LOD_SELECTION`, right after `lodSelectionSystem`, on its frame
   inputs. Its bounds are the union of the instances' records, kept per level mesh.
2. **The backend choice.** No compute means the CPU module, and `backend: 'CPU'`. A debug
   option forces it on WebGPU too (the LOD tab), to compare both backends on one device.
3. **Node tests.** The CPU backend's per-level membership after a scripted camera path matches a
   loop of `LodRules.ts` written in the test, and the swap-remove keeps every instance in
   exactly one level, or two while it fades.

From Phase 3 (its "As built"), for these steps:

- **No slots on the CPU backend.** three culls each level's `InstancedMesh` per camera by its
  bounds, so every camera (shadows included) is three's, as with the pool. Each level mesh takes
  its level's `castShadow`; VSM then draws a non-casting level into the shadow map as a receiver,
  as the pools do (the set's GPU slots don't). The backend's `debugBuffers` is absent, so
  `readInstanceSetStatsAsync` resolves `null` and the LOD tab's `cameraCount` is 0: give the CPU
  backend a readback of its own (`drawn` from its level meshes' counts, `slots: []`, the state
  from its typed arrays) so `instanceStress`' `measure()` and the bench read it like the GPU one.
- **The dither is the pool's**: an `InstancedMesh`'s `lodFade` attribute (`createLodFadeAttribute`),
  not `setObjectLodFadeNode`, which is the GPU draws' per-object node.
- **Once a frame**: the loop runs at `APP_RENDER_SYNC_ORDER.LOD_SELECTION`, after
  `lodSelectionSystem` wrote the frame's inputs, so Phase 3's rule (the state moves in the frame's
  first dispatch after the inputs) holds by its order. Its "no `lod()`" case is the inputs' frame
  still -1 at that point.
- `instanceStress` has `?stressShadow=true`, `?stressLight=spot|point` and `?stressViewport=true`:
  Phase 3's shadow and viewport checks (a snapshot pair against the pools per light, at 5k and
  `STILL`) apply to the CPU backend unchanged.

**Verification:**

- `instanceStress --webgl` (`yarn verify:scenes --webgl`, and the harness): counts per level and
  fading identical to the pool's at 20k with fades off, 0.25 s and 1 s, and the snapshots match.
- **The cost per instance** against the pool's at 5k, 20k and 100k on WebGL2 (the pool needs
  `VITE_ECS_MAX_ENTITIES` past 100k). This tells how much of the pool's ~110 ns was the ECS. The
  result goes into the Hub page's "which to use" (Phase 6) and p240's notes.
- The forced CPU backend on WebGPU gives the same counts as the GPU backend.

**As built** (step by step, 2026-11-09):

- **Step 1, `InstanceSetCpu.ts`.** As step 1 says, with these choices:
  - **The system is added by the backend**, to the set's world with its first CPU set (removed
    with its last), at `LOD_SELECTION`: equal orders run in registration order, so it runs after
    `lod()`'s systems whatever the feature order, and the front's first download gains nothing.
    The backend params gained `world`.
  - Per instance: the matrix (16 floats, the copies' source), the record (origin, scale × level
    0's conservative radius), the level and outgoing level (`Int16Array`, `LodRules.ts`'
    sentinels), the progress (`Float64Array`: the ECS path's numbers, so the pool's parity is
    exact) and the slot of each copy; per level mesh the instance in each slot (the swap-remove
    patches the instance it moves). A copy in a mesh both the old and the new state have stays in
    place (a change back mid-fade reuses both copies), the others are swap-removed, then the new
    ones appended.
  - The bounds: every instance's sphere at its largest level's radius, grown as instances are
    written, set on every level mesh. An instance written again moves its drawn copies.
  - **Uploads: a changed level mesh uploads its live part only** (`[0, count)` through
    `updateRanges`; both of three's backends honour them), nothing for an empty one. Added in the
    verification: whole buffers (each sized for every instance) made the set's render submit
    2.59 ms against the pools' 1.59 at 20k with 1 s fades; with the ranges 0.74 ms.
  - **The readback** (Phase 3's note): `debugCpu` (the state arrays and level meshes), read by
    `_dbg__InstanceSet.ts` synchronously: `drawn` the level meshes' counts, `slots: []`, no
    overflow, the state counted as the GPU's (one count for both). The LOD tab's triangles for a
    set without slots come from `drawn`.
  - Memory: each level mesh is sized for every instance, as a pool's, plus the backend's matrix
    copy: about 64 B × (levels + 1) + 36 B per instance, so about 300 MB at 1M with 3 levels.
- **Step 2, the backend choice.** The front imports `InstanceSetCpu.ts` where the empty backend
  was (done in step 1, to run it). The forced CPU backend is a checkbox in the LOD tab's Instance
  sets folder, "CPU backend (next sets)" (debug env, not persisted: tick it, then reload the
  scene), through a new optional `toggles` list on the kernel's debug source
  (`LodContentDebugToggle`, an accessor `value`), so `lod()` still imports nothing of
  instancing; underneath, `setInstanceSetCpuBackendForced` (`@internal`, read behind
  `IS_DEBUG_ENV`). `instanceStress` draws `?stressPath=gpu` as a set on WebGL2 too (its WebGL2
  fallback to the pools went; the URL values stay), its readout names the set's backend and
  `measure()` reports it (`setBackend`). The LOD tab check gained `--set-backend cpu` (the box
  ticked, the scene reloaded from its own tab, the backend asserted) and the bench a `set-cpu`
  path (debug env only), both through `devTools/bench/instanceStressPage.ts`; the bench's tables
  name what drew each case (`pools`, `set (GPU)`, `set (CPU)`).
- **Step 3, the Node tests.** `InstanceSetCpu.test.ts` (15 tests): 600 frames of a camera path
  (out and back with a fast wobble: fades, fades to and from culled, changes mid-fade) against a
  loop of `LodRules.ts` in the test, each level mesh read back (each instance by its x): exactly
  the rules' instances, each copy once, with its fade and its whole matrix; the backend's state
  arrays the rules' too. Plus: no fades (one mesh or none), the first selection and the global
  fade seconds, once a frame, a hold on another frame's inputs, `freeze`, a forced level (and
  past the last), no `lod()`, the uploads and their ranges, the meshes' shadows and raycast, the
  bounds, a rewritten instance, the system per world, the dispose. Four mutations (no swap-remove
  patch, the outgoing copy whole, a step per system run, every mesh uploaded every frame) each
  fail it.
  - **No `lod()` is now the GPU backend's rule** (written with the tests): only when nothing was
    written a whole frame after the set's first step. Step 1 concluded it on the first step,
    which in a world that runs before the one `lod()` writes in would force level 0 and leave a
    band of instances a level finer (Phase 3's finding).

- **The verification** (2026-11-09, Apple M2, Chrome; WebGL2 is SwiftShader, headless Chromium's
  only WebGL2 on macOS too):
  - **Parity** (the bench, the held orbit, 300 frames, the dev server, debug env): the state per
    level and the fading count are the pools' exactly, and Phase 2's.

    | Run | Fades | Pools: per level, fading | Set (GPU) | Set (CPU) |
    | --- | --- | --- | --- | --- |
    | WebGPU, 20k | off | 960 / 5,429 / 13,611, 0 | the same | the same |
    | WebGPU, 20k | 0.25 s | 991 / 5,522 / 13,685, 198 | the same | the same |
    | WebGPU, 20k | 1 s | 1,110 / 5,851 / 13,963, 924 | the same | the same |
    | WebGL2, 5k | off | 925 / 2,997 / 1,078, 0 | | the same |
    | WebGL2, 5k | 0.25 s | 946 / 3,019 / 1,090, 55 | | the same |
    | WebGL2, 5k | 1 s | 999 / 3,098 / 1,126, 223 | | the same |

    WebGL2 at 5k, not 20k: on SwiftShader 300 frames of 20k pools pass the bench's answer
    timeout. The CPU set builds 3 node builds and 3 pipelines, as the pools.
  - **The LOD tab check** (`instanceStressLodTab.ts`, 0.25 s): WebGPU at 20k with
    `--set-backend cpu` and WebGL2 at 5k: both paths agree at all six checkpoints, and the held
    fade's snapshots are pixel-identical (max delta 0: both draw an `InstancedMesh` per level with
    the `lodFade` attribute). One earlier `--set-backend cpu` run timed out after its reload and
    didn't again (the run before it had Vite reloads from edits under the run).
  - **The cost** (a `yarn build:test` build, `VITE_ECS_MAX_ENTITIES=1110000`, the orbit, the
    default fades). WebGPU, the bench's debug mode (the forced backend is a debug option),
    120 + 300 frames:

    | Trees | 5k | 20k | 100k |
    | --- | ---: | ---: | ---: |
    | Pools: LOD + sync | 0.70 ms (140 ns each) | 1.97 ms (98 ns) | 12.97 ms (130 ns) |
    | Set, CPU backend: LOD + sync | 0.10 ms (20 ns) | 0.27 ms (13 ns) | 1.71 ms (17 ns) |
    | Set, GPU backend: LOD + sync | 0.03 ms | 0.03 ms | 0.03 ms |
    | CPU frame: pools / CPU set / GPU set | 1.50 / 0.60 / 0.49 ms | 3.59 / 1.29 / 0.44 ms | 15.92 / 2.70 / 0.54 ms |
    | GPU frame: pools / CPU set / GPU set | 1.97 / 1.63 / 1.25 ms | 2.60 / 2.66 / 1.71 ms | 5.08 / 7.04 / 2.92 ms |

    WebGL2 (SwiftShader), prod test mode, 30 + 90 frames (100k: 3 + 12, more passed the answer
    timeout): the pools' LOD + sync 0.47 / 1.93 / 19.46 ms (94 / 97 / 195 ns each), the CPU set's
    0.10 / 0.24 / 1.70 ms (20 / 12 / 17 ns).
    - **The ECS was about 85-90% of the pool's per-instance cost**: the same selection and fades
      without entities cost 12-20 ns an instance against the pools' 94-195 ns, on either
      renderer. For the Hub's "which to use" (Phase 6) and p240: on WebGL2 a set costs about a
      tenth of the pools' CPU, linear in the count (1.7 ms at 100k).
    - **The CPU set's GPU side grows faster than the pools' past 20k.** One `InstancedMesh` per
      level for the whole set, so three culls level 2's 84k copies only together: at 100k the
      GPU frame is 7.04 ms against the pools' 5.08 (`instanceStress`' pools are 128 × 128
      tiles, whose tiles behind the camera three culls). On SwiftShader the same shows as 1.81M
      triangles against 1.14M a frame, frames of 3.3 s against 1.4 s, and a render submit
      blocked on the software renderer (440 ms against 2 ms). At 20k, mostly in view, they're
      equal. §5's "spatial chunks for the CPU backend" is the follow-up.
  - **Shadows** (Phase 3's checks, `instanceStressLodTab.ts --count 5k --set-backend cpu
    --shadow sun|spot|point`): both paths agree at all six checkpoints and the held fade's
    snapshots are pixel-identical, shadows included. Each level mesh casts by its level's
    `castShadow`, and VSM draws a non-casting level as a receiver, the pools' way. Viewports
    weren't checked again: three culls a level mesh for a viewport's camera as for any.
  - **The scene runner.** WebGPU, `--only lodShowcase,largeWorld,instanceStress`: 17 runs pass,
    the probe hashes unchanged (and `instanceStress`' 8 again after the fix below). WebGL2,
    `--only instanceStress --webgl --config quick --update` (local baselines): `@set` (the CPU
    backend) and `@pools` snapshots identical (max delta 0).
  - **`yarn verify:baselines --update`**: a new lazy chunk, `InstanceSetCpu.js` (2.0 kB gzip),
    and five `@internal` names (`createCpuInstanceSetBackend`, `InstanceSetCpuDebugData`,
    `setInstanceSetCpuBackendForced`, `isInstanceSetCpuBackendForced`, `LodContentDebugToggle`).
    The main chunk and both embeds unchanged; docs 100%; no debug code in any build.
  - **`yarn sbp --profile all`**: `features/instancing` 3.9 kB initial (its 5 KiB budget), 6.3
    kB lazy (both backends); every budget within.
  - **Found on the way, fixed in `instanceStress`:** `registerOnSceneExit` keeps one function per
    scene, and the scene registered four (the probe's, the meshlet pipeline's restore, the shadow
    ground's, the extra light's): the last replaced the others. With a shadow the ground's won, so
    the probe's systems outlived a reload (the reloaded scene's own were skipped as duplicates by
    `addSystem`'s id check, so its `measure()` never answered) and a `?stressLight=` light stayed
    after the scene; without one the probe's replaced the meshlet pipeline's restore. The scene
    now has one exit function running a list (`onInstanceStressExit`). The checks' forced reload
    also waits for a new window global, not for the old one to go: a small scene's reload swaps
    them between two polls.

### Phase 5 — Ranges, moving instances, impostor levels, memory — done

1. **Removal and reuse (D1).** `removeInstances(range)` marks the range's state dead (skipped
   by the select and the culls), and a free list hands it to a later `addInstances` of equal or
   smaller size (first fit). The cull's extent is the highest live range. Unit tests cover the
   free list and the dead instances' skip.
2. **Moving instances (D2).** `setInstanceMatrices` writes the CPU copy and the cull records, and
   adds `updateRanges` that upload once a frame before the first dispatch, merged when adjacent.
   The debug check fails a non-uniform scale.
3. **A streamed set.** An `instanceStress` flag splits the forest into cells of
   `registerStreamingCellContent`, each adding its range in `load` and removing it in `unload`.
   This is the case p353's "an instanced LOD pool's instances aren't faded" leaves open: whether
   a range gets the cells' visibility fade is decided here, from how it looks.
4. **Impostor levels (D8).** The instance matrix node in `kernel/render/`
   (`instanceSetMatrix`, resolving an InstancedMesh's `instanceMatrix`, a set's fetch, or the
   identity), used by `OctahedralImpostorMaterial.ts`. Cover a set ending in cross-quads (plain
   geometry, nothing new) and one ending in an octahedral impostor, in the shadow pass too.
5. **Memory.** The GPU memory tab's view of the set's buffers (D11: `registerGPUMemorySource` if
   three's `info.memory` doesn't place them under the set's owner). Check that disposing a set
   (a scene switch) frees all of it: the GPU memory tab's high-water and snapshot diff
   (`_DONE_p345`).
6. **`preWarm` (D8).** Through `preWarmObjectsAsync`. A set created with it shows no compile
   hitch on its first frame.

From Phase 4 (its "As built"), for these steps:

- **Every step has a CPU backend half** (`InstanceSetCpu.ts`), and its Node test file covers it
  as the GPU half's browser checks do:
  - Removal: the range's copies swap-removed from their level meshes (its instances' slots), its
    state marked dead and skipped by the loop; the free list is the front's, shared.
  - Moving: `writeInstances` already rewrites an instance's matrix, record and drawn copies and
    grows the bounds (never shrinking, as a pool's); `setInstanceMatrices` calls it.
  - Impostor levels: a level mesh is an `InstancedMesh`, so the octahedral impostor's material
    reads its `instanceMatrix` as on a pool: check it, nothing to build.
  - Memory: the level meshes' instance matrices and `lodFade` attributes (three's own) and the
    backend's arrays (CPU only); each level mesh is sized for every instance (about 64 B ×
    (levels + 1) + 36 B per instance). Step 5 checks the GPU memory tab shows them under the
    set's owner, as for the GPU backend's buffers.
  - `preWarm`: the level meshes, a pool's.
- **The uploads are ranges already** on the CPU backend (`[0, count)` per changed level mesh):
  step 2's "merged when adjacent" is the GPU backend's part.
- The streamed set (step 3) on WebGL2 draws on the CPU backend: a cell's range added and
  removed is a swap-remove per copy.

**As built** (step by step, 2026-11-09):

- **Step 1, removal and reuse.** The free list is its own pure module, `InstanceRanges.ts`
  (`createInstanceRanges(capacity)`, `@internal`, tested alone): an add takes the first free
  range it fits in (first fit by start, the rest staying free), else appends at the end; a removed
  range merges with its free neighbours, and one at the end lowers the end with the free range it
  then touches, so the end (the backend's extent) is always the highest live range's. The front's
  `removeInstances(range)` returns a boolean: false (and a warning) for a range that isn't one an
  add returned, removed already or in part; false silently once the set is disposed (a cell
  unloading after its scene's switch); true for an empty range. `count` is now the live instances,
  and an add that fits nowhere says so (live count, no removed range that large).
  - **The backend contract split**: `addInstances` (starts a range: not selected, whatever a
    removed range drew there), `writeInstances` (rewrites live instances, which keep their state:
    step 2's `setInstanceMatrices`), `removeInstances` and `setExtent` (the front's end; the
    backends no longer grow it in `writeInstances`). The debug types lost `getExtent`: the
    readback walks the front's live ranges (`getInstanceSetDebugInfo(set).ranges`, the GPU one
    snapshotted before its reads), and `InstanceSetStats` gained `extent` (public: step 3's "no
    growth past the first lap" reads it).
  - **GPU**: a removed instance's state word is `STATE_REMOVED` (`LEVEL_REMOVED` 0xfd in the level
    byte), and the cull returns on it first, before the record or the progress. The state is the
    GPU's, so an add or a removal uploads that range of the CPU array, **only once the passes ran
    once**: three creates a buffer from its whole array and doesn't clear the update ranges added
    before (`Attributes.update`), so a range added before the creation would be uploaded again at
    the next update, over the GPU's state (every instance back to unselected). The progress isn't
    reset: it's read only while a fade runs. A dispatch with no live instance still runs (the
    cull's `count` at least 1), so the reset and finalize zero the slot's draws (before, a set
    with no instance didn't dispatch, and its draws would have kept the last counts).
  - **CPU**: a removal swap-removes the range's copies (both of a fading one's) and marks its
    instances `LEVEL_REMOVED` (-3, the backend's own, next to `LodRules.ts`' sentinels), which the
    loop skips first; an add resets the state to unselected. The bounds don't shrink, as a pool's.
  - Tests: `InstanceRanges.test.ts` (first fit, merging, the end, only live ranges, cells loading
    and unloading in turns: no overlap, no growth past the first lap), the front's (the backend's
    calls and extent, reuse, the refusals), the CPU backend's (600 frames of the camera path with a
    middle range and the top one removed while instances fade, then re-added in parts: the level
    meshes are the rules' reference with the removed ones left out, and an added instance's first
    selection doesn't fade; two mutations, no skip in the loop and no swap-remove of the outgoing
    copy, each fail it) and the GPU backend's (the state words, no upload range before the first
    dispatch and only the changed ranges after it, the dispatch with no live instance).
  - **Verified in the page** (a scratch script, 20k, `STILL`, no fades, Apple M2, Chrome, headless
    WebGPU, the dev server, debug env; `instanceStress`' probe gained `set()` for page scripts):
    the scene's range removed, then A (5,000 in view) and B (3,000 behind the camera) added, A
    removed with B live above it, C (2,000) added, then B removed:

    | Step | Live | Extent | GPU: drawn (main camera) | State per level (both backends) |
    | --- | ---: | ---: | --- | --- |
    | The scene | 20,000 | 20,000 | 207 / 1,427 / 3,421 | 861 / 4,763 / 14,376 |
    | Its range removed | 0 | 0 | 0 / 0 / 0 | 0 / 0 / 0 |
    | A and B added | 8,000 | 8,000 | 701 / 3,025 / 1,189 | 773 / 3,482 / 3,745 |
    | A removed (below B) | 3,000 | 8,000 | 0 / 0 / 0 | 0 / 444 / 2,556 |
    | C added: takes `{ 0, 2000 }` | 5,000 | 8,000 | 701 / 1,214 / 0 | 773 / 1,671 / 2,556 |
    | B removed | 2,000 | 2,000 | 701 / 1,214 / 0 | 773 / 1,227 / 0 |

    A's instances, below the extent, draw nothing once removed, and the forced CPU backend's state
    is the GPU's at every step. The bench's `forceSetCpuBackendAsync` failed once ("the set is on
    the GPU backend after the reload") and passed on the rerun: Phase 4's flake of the same
    helper, not looked into.
  - `yarn verify:scenes --only instanceStress`: all 8 runs pass (`@set` within tolerance of its
    snapshot: mean 0.001, max 9/255, as in Phase 2). `yarn sbp`: `features/instancing` 3.9 → 4.4
    kB gzip of its 5 KiB (the ranges module and `removeInstances`: 4 modules first-download),
    the lazy `InstanceSetCpu.js` 2.0 → 2.1 kB; every budget within. Steps 2 and 6 add to the
    front too, with about 0.6 kB left.
- **Step 2, moving instances.** `setInstanceMatrices(range, instances, offset?)` takes placements
  or matrices, as `addInstances` does, and returns a boolean: false (and a warning) for a range
  that isn't live, false once the set is disposed; it throws when the instances don't fit in the
  range from `offset` (a caller's bug, as matrices that aren't 16 floats each). The instances keep
  their levels and fades (the backend's `writeInstances`). **A non-uniform scale still warns in
  the debug env and doesn't fail** (Phase 1's choice, kept over this step's "fails": the debug
  and production builds behave alike), now for every write. `InstanceRanges` gained `isLive`.
  - **GPU**: the matrices and records written are uploaded at the backend's next dispatch, before
    its passes (`uploadWrites`), not at the write: a write touching the last pending one (an
    overlap or adjacent) merges into it, so a frame's writes in order, one instance a call, are
    one range per buffer. Past 256 separate ranges they become one range over them all, so a set
    no render reaches (hidden) while it moves keeps no growing list. Nothing is added before the
    first dispatch, for step 1's reason (three creates the buffers from the whole arrays): this
    also ends a whole re-upload of the first add's ranges, which lingered until the first move.
  - **CPU**: `writeInstances` already moved the drawn copies (both of a fading instance's) and
    the record; it now sets the level meshes' bounds only when they grew, so a move inside them,
    one call per instance, costs no bounds work.
  - Tests: the front's (an offset, placements and matrices, the refusals and the throw), the GPU
    backend's (no range until the dispatch, ordered and overlapping writes as one range and one
    apart as another, one version bump each, nothing new at the next dispatch, at most 256 ranges
    with every write covered) and the CPU backend's (400 frames of the camera path with an
    instance stepping 25 m off the line every third frame, fades included: the meshes are the
    rules' reference with every copy at its new place, at the move and after the step; a move
    inside the bounds leaves them). Not moving a fading instance's outgoing copy fails it.
  - `instanceStress` gained `?stressMove=<share>` (the set path; the pools warn): a round-robin
    block of that share of the trees each frame, one `setInstanceMatrices` call per tree, each
    turned and swayed along x by the scene's time. The bench gained `--move <share>`.
  - **Verified** (Apple M2, Chrome, headless WebGPU, the dev server, debug env, 100k trees):
    - **One upload a frame per buffer.** `GPUQueue.writeBuffer` counted in the page (`STILL`,
      120 frames): none a frame without moves; with `?stressMove=0.01` exactly 2 a frame, the
      records' 16,000 B and the matrices' 48,000 B (1,000 trees as one range each).
    - **The CPU frame** (the bench, the orbit, 120 + 300 frames), without → with 1% moved a frame:
      the GPU set 0.49 → 0.62 ms (render submit 0.40 → 0.52), under 2 ms; the CPU backend 2.28 →
      2.20 ms, its selection loop's cost (Phase 4's 2.70 ms on a build) and within its spread.
    - The first bench run broke on a Vite reload from an edit under it (the forced CPU backend's
      flag lives in `InstanceSet.ts`, so the reload reset it: "the set is on the GPU backend
      after the reload"); step 1's flake of that helper may have been the same.
    - `yarn verify:scenes --only instanceStress`: all 8 runs pass. `yarn sbp`: `features/instancing`
      4.4 → 4.6 kB gzip of its 5 KiB (step 6's `preWarm` has about 0.4 kB left), the lazy
      `InstanceSetGpu.js` 4.9 → 5.1 kB, `instanceStress.js` 2.5 → 2.8 kB; every budget within.
- **Step 3, a streamed set.** No engine change: a set's ranges are what streamed content needs.
  `instanceStress` gained `?stressStream=<cellSize>` (the set path; a power of two of at least
  32 m), in `instanceStressStreaming.ts`: the trees cut into world streaming's cells, each cell
  one unit of code content (`registerStreamingCellContent`, `loadedAt: 'NEAR_AND_FAR'`) whose
  `load` adds the cell's matrices (made once at the scene's load) as a range and returns no
  entity, and whose `unload` removes the range. One set, sized for every tree, serves every cell.
  `setSceneStreamingSettings` turns it on from the scene code (and back to the JSON's, none, on a
  load without it); `?stressStreamFar=<ring>` overrides the far ring and `?stressOrbitSeconds=`
  the orbit's period (a 15 s orbit makes 30 s two laps). The probe's `stream()` returns what the
  module measured: the loads and unloads (those during play apart from the load's), each one's
  time, the extent per orbit lap (the scene's own live ranges' end), the adds that found no room,
  and the pops (below).
  - **The visibility fade: decided against, for now.** The far ring defaults to the set's own
    cull distance: the farthest a tree is drawn (level 0's conservative radius at the largest
    scale, the main camera's field of view and the LOD bias, against the cull size less the
    hysteresis, which a drawn tree and a new one's first selection use), in cells. Then a cell
    loads before its trees would be drawn and unloads after the set has culled them, and a range
    needs no fade. The scene counts the pops at each load and unload during play: the cell's
    trees in the main camera's frustum at a screen size the set draws. With that ring, none, on
    both backends. With a smaller one (far ring 4 against the 8 the cull distance asks at 256 m),
    580,671 tree copies popped in over 623 loads in 30 s, nearly every loading cell's whole
    content, far away but visible. (No pop out in any run: the orbit leaves the unloading cells
    behind its camera.) So content streamed from a ring short of its cull distance would want
    the cells' fade, which is D1's `addInstances(…, { fade })`, still left for a need (§5): the
    rule for now is a ring past the set's cull distance, or a cull short of the ring.
  - **Found on the way, fixed in `instanceStress`:** `registerOnSceneEnter` keeps one function
    per scene, like the exit (Phase 4), and the scene registered up to three (the sun's shadow, a
    light, the viewport): the last one won, and one an earlier load registered ran on a load that
    set none. The scene now has one enter function running this load's list. And the bench's
    `forceSetCpuBackendAsync` (Phase 4's and steps 1-2's flake): the LOD tab rebuilds its Instance
    sets folder when a set's cameras change, and a key pressed on the control a rebuild replaced
    is lost. It now reads the checkbox back, focused anew, and presses only while it's unticked
    (three tries); with that, the forced runs passed every time.
  - **Verified** (Apple M2, Chrome, headless WebGPU, the dev server, debug env; a scratch script:
    the orbit held through the scene's load and 60 frames, then 1,800 or 3,600 frames of the test
    bridge's fixed delta, the frame intervals timed in the page by `requestAnimationFrame`):

    | Run | Cells (window) | Play loads / unloads | Max load / unload | Frames over 33 ms (max) | Extent per lap | Live |
    | --- | --- | ---: | ---: | --- | --- | ---: |
    | 1M, GPU, 2 laps | 576 (17 × 17) | 1,197 / 1,248 | 2.3 / 0.1 ms | 0 (30.8 ms) | 529,958, 505,764 | 424,405 |
    | 500k, GPU, 4 laps | 324 (17 × 17) | 1,043 / 1,111 | 4.2 / 1.7 ms | 0 (24.3 ms) | 481,774, 380,316, 380,857, 381,379 | 364,704 |
    | 500k, CPU (forced), 4 laps | 324 | 1,043 / 1,043 | 0.9 / 0.2 ms | 0 (29.8 ms) | 376,567, 381,027, 381,831, 385,491 | 364,704 |
    | 500k, GPU, far ring 4 | 324 (9 × 9) | 623 / 623 | 4.4 / 0.8 ms | 0 (22.9 ms) | 181,842, 179,478 | 135,738 |

    256 m cells, the cull distance 1,818 m (far ring 8), the orbit at 0.3 of the forest's side.
    No add found no room. **The free list is reused, and the extent stays bounded but not flat:**
    after the first lap it moves by a cell or two a lap (cells hold 1,600-1,900 trees, so a freed
    range can be a few trees short of the next cell, which then goes to the end). A Node run of
    the same pattern over ten laps (18 × 18 cells of 1,600-1,900, a 13 × 13 window on the orbit)
    puts first fit's extent at 277-285k for 254k live (9-12% over, wobbling, not growing), and
    best fit's at 270-278k: kept first fit, as planned. The 1M run's 1,794 pops in were the 51
    cells that loaded in the frames after the scene was entered, the camera still: the load
    builds part of the ring and the rest arrives over the first frames (the streaming budget),
    so a streamed set's farthest cells pop in at the start.
  - A cell's load costs 0.12-0.18 ms on average (1,600-1,900 trees), its unload 0.003-0.008 ms;
    the CPU frame during the flights 0.67-0.95 ms (GPU) and 5.3 ms (the CPU backend's loop over
    365k live instances, its known cost).
  - `yarn test` (321 files), lint and both type-checks pass; `yarn verify:scenes --only
    instanceStress`: all 8 runs. `yarn sbp`: every budget within, the engine's groups unchanged
    by this step (`features/instancing` 4.6 kB); the lazy `instanceStress.js` 2.8 → 4.1 kB (the
    streaming module and the scene's enter list), on the scene's own chunk.
- **Step 4, impostor levels.** As D8, with these names and one addition:
  - **`kernel/render/InstanceMatrix.ts`**: `drawnInstanceMatrix` (named for what it is, not
    `instanceSetMatrix`: it serves InstancedMeshes too), a node resolved at setup by the drawn
    object: an InstancedMesh's `instanceMatrix` (three's `referenceAttribute`, one node for every
    InstancedMesh: p058's shared build), an object's own node (`setObjectInstanceMatrixNode`), else
    the identity. It's keyed on the object, as `setObjectLodFadeNode` is, so the shadow pass's
    builds (the drawn object with the shadow pass's material) resolve it too.
    `setMaterialPositionsInstances` / `doesMaterialPositionInstances` mark a material whose
    `positionNode` places each instance itself. All `@internal`; neither feature imports the other.
  - `OctahedralImpostorMaterial.ts` reads `drawnInstanceMatrix` (its own setup-time node went), and
    `buildOctahedralImpostor` marks its material. The pools' impostors draw as before (below).
  - The GPU backend's fetch returns `matrix` too (the rows as a `mat4`'s columns). A marked
    source's variant keeps its `positionNode` and each draw gets `fetch.matrix`; an unmarked one's
    is replaced by the fetch, with the debug warning, as before.
  - **Added: the kept `positionNode` is wrapped per set** (`SetPositionNode`, a node whose setup is
    the source's). A build is keyed by its material's nodes, and each node's key includes its id
    (`Node.customCacheKey`), so two sets' variants of one impostor would share a build, the shadow
    pass's too (its override material takes the variant's `positionNode`), and the second set would
    draw the first one's instances. A plain material's variants differ already: their
    `positionNode` is the set's own fetch.
  - Cross-quads are plain geometry (no `positionNode`): nothing to build, as the plan said. On the
    CPU backend a level mesh is an InstancedMesh, so the impostor reads three's `instanceMatrix`.
  - Tests: `InstanceMatrix.test.ts` (the InstancedMesh's shared reference, an object's node in its
    own and another material's build, the identity, the mark), and the GPU backend's (a marked
    material keeps its `positionNode` under a key of each set's, each draw resolves its own set's
    matrix whatever material builds it; an unmarked one's own is replaced).
  - `instanceStress` gained `?stressImpostor=crossQuads|octahedral`: the last level an impostor
    of level 0 (`generateCrossQuads`, or `generateOctahedralImpostor` hemi), baked at the load,
    casting shadows, on both paths. Building the coarsest mesh level anyway left a registered
    geometry no level held, which a reload found again (a warning): only the levels used are
    built.
  - **Verified** (20k, `STILL`, no fades, 1024 × 576, Apple M2, Chrome, headless WebGPU, the dev
    server, debug env): the set's snapshot against the pools':

    | Last level | Shadow | Set (GPU) vs pools | Set (CPU, forced) vs pools | The shadow slot drew (L0 / L1 / L2) |
    | --- | --- | --- | --- | --- |
    | Cross-quads | none | mean 0.0003, 1 pixel over 8/255 | | |
    | Cross-quads | the sun's VSM | mean 0.0006, max 18/255 | | 578 / 2,437 / 1,193 |
    | Octahedral | none | mean 0.0001, 1 pixel over 8/255 | identical | |
    | Octahedral | the sun's VSM | mean 0.0003, max 18/255 | identical | 574 / 2,433 / 1,186 |

    The state per level is the pools' in every case (861 / 4,763 / 14,376), no console error. A
    mutation (the draws not given `fetch.matrix`, so the billboard reads the identity) changes
    3.1% of the pixels (mean 3.73): every impostor at the origin.
  - **The pools' impostors draw as before**: `yarn verify:scenes --only
    lodShowcase,largeWorld,instanceStress` passes all 17 runs, and `streamingGrid` (its far rocks
    an InstancedMesh of an octahedral impostor; no local baseline, so recorded on the step's
    parent first, the changes stashed) all 5, identical. `yarn test` (322 files), lint and both
    type-checks pass. `yarn sbp`: every budget within; `features/lod` 5.4 kB and
    `features/instancing` 4.6 kB unchanged; `InstanceMatrix.ts` is a lazy chunk of its own
    (0.3 kB, shared by the GPU backend and the impostor code), the GPU backend 5.1 → 5.3 kB, and
    the app's lazy `Foliage.js` 0.6 → 2.7 kB (Rollup moved the impostor generators into the chunk
    the tree scenes share, now that `instanceStress` imports them too).
- **Step 5, memory.** three's `info.memory` counts a set's buffers only by kind (storage,
  indirect, instance attributes), so each set registers a GPU memory source:
  - **The source**: the front registers one per set (`registerGPUMemorySource`, id
    `instanceSet.<entityId>`, label `Instance set "<label>" (GPU|CPU)`), owned by the scene it was
    made for (the loading scene, else the current one; a persistent set's is the engine's), removed
    in the set's dispose. Its resources are the backend's new `debugMemory()` (on the contract):
    the GPU backend's seven buffers, the CPU backend's level meshes' instance matrices and `lodFade`
    attributes. `__AEK_DEBUG__` first, as `Viewports.ts`: a production build folds it and the GPU
    memory module out of the front (`features/instancing` stays 4.6 kB).
  - **The catch-all counts last**: the engine's "Instance buffers (InstancedMesh)" source (every
    InstancedMesh in the root scene) was registered first and so counted the CPU backend's level
    meshes. `collectGPUMemorySources` now counts the engine's catch-all sources
    (`CATCH_ALL_SOURCE_IDS`) after every other, so a source naming its own instance buffers keeps
    them.
  - **Found and fixed: a GPU set's level buffers outlived it.** The scene switch left the tree
    levels' vertex and index buffers in three's totals (the pools didn't). three frees a geometry's
    buffers on its dispose only when it drew that geometry itself (`Geometries.initGeometry` adds
    the listener), and the GPU backend draws its levels only through its wrappers (a geometry has
    one indirect offset), which it never disposed (disposing them would free the buffers the level
    geometry, and any pool or set on it, still uses). So the registry's dispose of a level freed
    nothing in three, and every wrapper stayed in `info.memory.geometries` too. Now the backend
    forwards a level geometry's dispose to its attributes and index (`attribute.dispose()`, which
    three r187's `Attributes` hears; nothing for an attribute three has no buffer of or freed
    already, and an interleaved one isn't an event dispatcher), and its own dispose detaches each
    wrapper's shared index and attributes before disposing it. The CPU backend's level meshes draw
    the level geometries themselves: nothing to do.
  - Tests: the front's (the source's id, label, owner and resources, removed on the dispose; a
    persistent set's without owner) and the GPU backend's (its dispose frees its seven buffers and
    each wrapper with nothing shared left on it, and none of the level's shared buffers; a level
    geometry's dispose after the set's frees its buffers, once). Not forwarding the dispose, and not
    detaching the index, each fail one.
  - **Verified** (a scratch script, `STILL`, Apple M2, Chrome, headless WebGPU, the dev server,
    debug env): the sources as the GPU memory tab collects them, then a snapshot
    (`takeGPUMemorySnapshot`), `loadScene` to `testDebugScene` and its diff:

    | Run | The set's row (owner `instanceStress`) | InstancedMesh row | After the switch | Left behind by the visit |
    | --- | --- | --- | --- | --- |
    | 1M, GPU, before the fix | 74.67 MB, 7 buffers | 0 | storage 6 → 0 (74.66 MB → 0), indirect 1 → 0, geometries 14 → 21 | the pools' (below) + the 3 levels' 6 vertex and 3 index buffers |
    | 20k / 1M, GPU | 3.20 / 74.67 MB, 7 buffers | 0 | storage 6 → 0, indirect 1 → 0, geometries 14 → 9 | the pools' |
    | 1M, CPU (forced) | 194.55 MB, 6 buffers | 0 | attributes 194.58 → 0.19 MB, total 228.0 → 38.5 MB | the pools' |
    | 20k, pools | | 3.66 MB, 12 objects | | a 33 × 33 vertex grid with its index, a 3-vertex attribute, a 1024 × 576 target and its depth, 4 programs |

    The GPU row is D4's arithmetic: 48 + 16 + 4 + 4 MB per million instances (matrices, records,
    state, progress) plus 6 MiB of lists (8 slots × 3 levels × 65,536 × 4 B); the CPU row three
    level meshes of a 64 MB matrix and a 4 MB fade each, sized for every instance (Phase 4's ~300
    MB at 1M was that plus the backend's own arrays, which are CPU memory). What the pools' visit
    leaves is the same on both paths, so not the set's (not looked into: neither the forest nor the
    shadow ground).
  - `yarn sbp`: every budget within; `features/instancing` 4.6 kB (unchanged: the source folds
    out of production), the lazy `InstanceSetGpu.js` 5.3 → 5.5 kB (the forwarding and the
    wrappers' dispose). `yarn test` (322 files), lint and both type-checks pass.
- **Step 6, `preWarm`.** `CreateInstanceSetOptions.preWarm` (default false) reaches the backend
  as a param; the front adds nothing else. Each backend compiles through `preWarmObjectsAsync`
  once the set's group is `added` (the caller adds it after the front resolves, so it can't be at
  creation):
  - **GPU**: the group. The compile goes through the drawing pipeline like a render: the probe
    takes a slot for the compile's camera (the pre-warm camera, released after 120 frames unused,
    or under PostFX the scene pass's camera), and the slot's draws, under the probe, are projected
    and built in the same call: every (level, group) draw, so every source's variant, whose build
    every slot shares. The compile's `finishRenderList` dispatches, which builds the three compute
    pipelines (synchronous in three, but there, not in a frame). Not D8's "a draw per (material,
    level) at slot 0": a slot is per camera, and any slot's draws are the same builds.
  - **CPU**: the level meshes, not the group: `preWarmObjectsAsync` unculls only the objects it's
    given, and a level mesh's bounds are empty until its instances are written. An empty one
    compiles too (three's compile path doesn't skip a `count` of 0).
  - **Found: a pre-warm during a scene load compiled the wrong variant.** A load runs the scene
    code before it creates the scene data's lights and meshes (`createNextSceneObject3Ds`, after
    `setCurrentScene` and the created hooks), so a set made by scene code was compiled without
    the scene's lights: a variant of a lit material no frame draws (the WGSL diff: no irradiance,
    no direct light). `kernel/scene/SceneLoader.ts` gained `runWhenSceneLoadSettled(run)`
    (`@internal`): now, or once the running load has settled (a one-shot `loadSettled` hook), and
    the backends pre-warm through it. `runSceneLoadSettledHooks` now walks a copy of the hooks, as
    the created and entered ones do: a hook removing itself skipped the next one. A lit mesh that
    scene code makes with `createMeshEntity({ preWarm })` likely compiles without the lights the
    same way (`preWarmMesh` queues its compile at once): not checked or changed here.
  - **A set made by scene code needs no pre-warm**, measured on `instanceStress`: the load renders
    frames while its hooks await (behind the loader), and one of them builds the set's lit
    pipeline synchronously; the first frame after the load builds nothing, with `preWarm` or
    without. (Every lit material in the scene builds twice: once in the load's first render, at
    `setCurrentScene`, before the lights exist, and again once they do. Not the set's.) `preWarm`
    is for a set made during play.
  - Tests: the backends' (each compiles once its group is added, once, the GPU one the group,
    whose projection then lists its slot's draws, the CPU one its level meshes; nothing without
    it), the front's (the option reaches the backend, default false) and `runWhenSceneLoadSettled`'s
    in `SceneLoader.test.ts` (at once outside a load; inside one after the entered hooks, each
    once, two in a row both run, another `loadSettled` hook still runs; after a failed load too).
    The index walk over the live hooks fails two of them.
  - `instanceStress` gained `?stressPreWarm=true` (its set made with `preWarm`).
  - **Verified** (a scratch script, Apple M2, Chrome, headless WebGPU, the dev server, debug env,
    `instanceStress` at 20k `STILL`): after the scene is ready, the page makes a second set of a
    material the scene doesn't use (a Phong sphere, 2,000 instances in front of the camera) and
    adds it; `GPUDevice`'s pipeline and shader calls are wrapped (synchronous or async, and in which
    `requestAnimationFrame` callback), and the callbacks timed, 40 frames:

    | Backend | `preWarm` | The set's builds in a frame | Longest callback | Frame intervals |
    | --- | --- | --- | --- | --- |
    | GPU (3 runs) | off | 7 in the first frame drawing it: 3 compute and 1 render pipeline, 3 shader modules | 5.7-9.2 ms | 15.8-17.1 ms |
    | GPU (3 runs) | on | none: between frames at the add, the render pipeline async | 0.7 ms | 16.1-16.6 ms |
    | CPU, forced (2 runs) | off | its render pipeline, synchronous | 5.6-6.5 ms | one run 257 ms once |
    | CPU, forced (2 runs) | on | none (async) | 2.3-2.4 ms (the backend's loop) | 15.9-16.5 ms |

    Both draw the whole set afterwards (1,654 copies on the GPU's main camera, 2,000 on the CPU's
    level mesh). The pre-warm still runs on the main thread (the node builds; three's compile
    yields every 8 ms), between frames rather than in one, and three skips a draw whose async
    pipeline isn't ready, so a pre-warmed set can show a frame or two after it's added.

**Verification:**

- A scene switch away from `instanceStress` at 1M leaves no set buffer in the GPU memory tab's
  snapshot diff.
- Streaming the forest's cells in and out for 30 s on a fly-through: no frame over 33 ms caused
  by the set (p353 Phase 1's measure), the free list reused (no growth past the first lap), and
  no instance drawn from a removed range (the readback).
- Moving 1% of the instances a frame costs one upload per frame, and the CPU frame stays under
  2 ms at 100k.
- Octahedral impostor levels match the pool's (the snapshot pair), shadows included.

## 4. Hub, docs and versioning

The Hub's example is a `lodShowcase` lane (decided 2026-11-09). There's no example scene of its
own: `instanceStress` covers the scaling, and the lane shows the parity next to the pool's lane.

### Phase 6 — The Hub, the lane and the docs — done

1. **The `lodShowcase` lane** (`src/app/scenes/lodShowcase/lanes/instanceSetGrove.ts`, "Instance
   set and cross-quads").
   - It's `treeGrove`'s lane drawn by an instance set: the same tree levels and cross-quads, the
     same cull, the same bands from `layout.ts`. The two lanes sit side by side, and every level
     and the cull are on screen from the start camera.
   - Its description names the backend it runs on, so on WebGL2 it says the CPU backend.
   - The "LOD demo" tab gets its camera stops (each switch, just inside and just past) and its
     levels and triangles, read from the set's readback rather than from entities.
   - `lodShowcase`'s scene runner baseline changes with the new lane. Update it in this phase,
     and give the reason in the commit.
2. **The LOD feature page** (`hub/pages/features/lod/`).
   - `guide.md`'s "Many instances" gets a part on instance sets: what a set is and what it gives
     up (D2), when to take it over a pool (about 20-50k static instances and up, with Phase 1's
     and Phase 4's production numbers), the backends (D9), the cameras (D6), the ranges and
     streamed cells (Phase 5), and the debug folder (D11).
   - A snippet from the lane, through a `#region` marker that names the page in its note.
   - `index.html`'s `aek:covers` gets "Instance sets" (the new `##` section of
     `features/instancing/CLAUDE.md`, Phase 1). Key APIs gets `createInstanceSetAsync`.
   - The intro's "Thousands of instances cost a draw call per level" gets its sentence on sets.
3. **The nested `CLAUDE.md` files.**
   - `features/instancing/CLAUDE.md`'s Instance sets section as built (the backends, the slots,
     the seams it uses, the traps found on the way).
   - `features/lod/CLAUDE.md`: `LodRules.ts`, the frame inputs, the new lane in the lane list,
     and p354 off its "later LOD plans" list.
   - `kernel/render/CLAUDE.md`: a "Drawing pipeline" section for `DrawingPipeline.ts`, and the
     instance matrix node. A new `##` section needs an `aek:covers` too: the Rendering page's, or
     a `coverageIgnore` entry with its reason.
4. **The root `.claude/CLAUDE.md`**: the map's instancing line ("instanced mesh pools and
   instance sets"), and `devTools/bench/` under Commands (Phase 1's harness).
5. **`readme.md`**:
   - Features: the instanced mesh pools' entry gets instance sets (GPU culled and LOD-selected
     on WebGPU, the same rules on the CPU on WebGL2, no entity per instance).
   - The performance table gets a row for instance sets: the flat CPU cost, and a dispatch and a
     draw per level and group per camera.
6. `yarn hub:build` and `yarn hub:preview`: the page's snippet and links resolve. `yarn docs` has
   the new API.

**Verification:** `yarn hub:build` passes (no dead `hub:` link, no moved `#region`, every
`##` section covered). `yarn verify:scenes --only lodShowcase` passes on both backends with the
updated baseline. The page reads right in both themes (`yarn hub:preview`).

**As built** (section by section, 2026-11-10, commits "phase 6 - section 1" to "section 5", and the
verification after them):

- **Section 1, the lane.** `lanes/instanceSetGrove.ts` as planned. The pool lane's trees became
  `createShowcaseTrees(ctx)` in `lanes/treeGrove.ts` (the levels, the LOD, level 0's radius and the
  placements, one seed), which both lanes call: the second call reuses the registered geometries
  (`getGeometry(id) ??`: `saveBufferGeometry` warns on a second geometry under one id), and the
  materials and the cross-quads return the first call's. The scene has 7 lane slots (the set lane
  in slot 1, next to the pool's; the generated chain still in the centre). A lane may return
  `instanceSet` (the set, its instances' origins and each level's triangles) and a `description`
  (the backend's). The "LOD demo" tab's stops measure a set lane from its instances' origins, and
  its row comes from `readInstanceSetStatsAsync` with `state` (asked for by the open tab's refresh,
  one at a time per set, kept per set so a late readback of an earlier visit's set lands nowhere):
  the selected levels, culled, fading, the backend, and the triangles the main camera's last
  dispatch drew. On both backends the row is the pool lane's (`L0 3 · L1 3 · L2 3 · culled 1`,
  234 triangles). `lodShowcase`'s baselines moved with the lane (mean 7.8-7.9, 14.8% of pixels: the
  new lane and the lanes it moved over; no console error, the probe hashes unchanged), recorded
  again on WebGPU and on WebGL2 (local baselines). `lodShowcase.hub.png` saved again from the
  start view.
- **Section 2, the LOD page.** The set's part is a `## Instance sets` with `###` subsections (a pool
  or a set, two backends, every camera, ranges and streamed cells, memory, seeing a set work), not
  `####` under "Many instances": the page's "On this page" lists h2 and h3 only. "Which to use" is
  Phase 4's table (5k / 20k / 100k: pools, the CPU backend, the GPU backend, CPU and GPU frame, one
  minified build), Phase 1's 1M CPU frames (166 against 1.1 ms) and Phase 3's sun shadow (8.6
  against 13.1 ms at 100k). A dev-only block names `instanceStress` and the bench. Found:
  `yarn hub:build` warned that `InstanceSetData` (`@internal`) is named by the public
  `CoreComponentData` (Phase 1's leak); it's now a type on `aekasha/instancing`, as the pool's
  `InstancedMeshSlotData` is. Found on the dev server: the dev Hub checks `api:` links against the
  last API model it built, and an engine save only marks it stale, so the page failed on
  `InstanceSet.setInstanceMatrices` and `.removeInstances` (Phase 5's) until an API page was
  opened (which rebuilds it). Not changed here.
- **Section 3, the nested `CLAUDE.md` files.** `kernel/render/CLAUDE.md`'s "Drawing pipeline" (the
  hook, its order with nested renders, and the drawn object's nodes: `drawnInstanceMatrix` and
  `setObjectLodFadeNode`), covered by the Rendering page (`aek:covers`, and a sentence in its
  "More on screen"); `coverageIgnore` stays empty. `features/instancing/CLAUDE.md` gained the seams
  a set uses in one bullet, the pointer to the Hub's "which to use" and the lane;
  `features/lod/CLAUDE.md` the lane, the lane shape, `createShowcaseTrees` and the tab's set rows,
  and p354 left its "later LOD plans".
- **Section 4, the root `CLAUDE.md`**: the map's instancing line, the bench tools under Commands
  and their `.cache/bench/progress.log` next to the other logs.
- **Section 5, `readme.md`**: instance sets in the pools' Features entry, an "Instance sets" row
  in the Technical highlights (the readme's performance table), the lane and `instanceStress` in
  the scene lists, and GPU-driven culling off the Roadmap highlights.
- **The verification** (2026-11-10, Apple M2, Chrome):
  - `yarn hub:build` passes: 111 pages, 1,334 public names, 100% documented, every `##` section
    covered. Its one warning, the search index at 534 KiB gzipped over 450 KiB, was 530 KiB before
    this phase. The LOD page read right in both themes on `yarn hub:preview`.
  - `yarn docs` has `createInstanceSetAsync`, `readInstanceSetStatsAsync` and the set's types (0
    errors; none of its 120 warnings names a set).
  - `yarn verify:scenes --only lodShowcase`: all 5 runs pass on WebGPU and on WebGL2 (SwiftShader,
    the set on its CPU backend).
  - `yarn verify:baselines --update`: Phase 5's changes, not recorded there (`InstanceRanges.ts`'
    exports, `STATE_REMOVED` / `LEVEL_REMOVED`, `InstanceMatrix.ts` as its own 0.3 kB lazy chunk
    with its four exports, `runWhenSceneLoadSettled`, the lazy `InstanceSetGpu.js` 4.9 → 5.5 kB and
    `InstanceSetCpu.js` 2.0 → 2.2 kB, `instanceStress.js` 2.5 → 4.3 kB, the impostor generators
    moving from `largeWorldRock.js` to `Foliage.js`), and this phase's (`InstanceSetData` on
    `aekasha/instancing`, `lodShowcase.js` 4.9 → 5.2 kB for the lane). The main chunk's
    `features/instancing` 3.9 → 4.6 kB (Phase 5's ranges and `removeInstances`); both embeds
    unchanged; docs 100%; no debug code in any build.
  - `yarn sbp --profile all`: every budget within (`features/instancing` 4.6 kB of its 5 KiB,
    `features/lod` 5.4 of 7).

### Phase 7 — Versioning, changelog, the plan done — done

1. **Versions** (`package.json`), bumped from what `main` has at the merge (today engine 6.2.0
   and app 1.20.0):
   - Engine minor: 6.2.0 → 6.3.0, with the project `version` the same. It adds API
     (`createInstanceSetAsync` and its types), and nothing in it breaks: the ε fix changes a
     fade's length by one frame, and the seams are `@internal`.
   - App minor: 1.20.0 → 1.21.0, for `instanceStress` and the lane.
   - The toolkit is unchanged.
2. **`CHANGELOG.md`**: the branch's entry with Engine (the set, the backends, the rules and the
   fix, the drawing pipeline seam, the debug folder), App (`instanceStress`, the lane) and
   Project (`devTools/bench/instanceStress.ts`) sections.
3. `yarn checkVersions --against main`.
4. **Mark the plan done** (`docs/plans/CLAUDE.md`).
   - The status becomes `implemented (Phases 0-7)`, and the file is `git mv`'d to
     `_DONE_p354_gpu-driven-culling.md`.
   - The references to its old name are updated: p350's status line, its Tier 3 row and its
     branches note; p308, p370 and p375's Related lines; `features/lod/CLAUDE.md`.
   - p350's Tier 4 row keeps three's `MeshletDrawingPipeline` for huge single meshes as the
     open question (§5).
5. **The PR**: branch `p354-phase0-spike` into `main` (p350: p354 gets its own branch), opened
   when asked.

**As built** (section by section, 2026-11-10, commits "phase 7 - section 1" to "section 3"):

- **Section 1, the versions.** `main` was still at the branch's base (`73663bb6`, p353's merge),
  so the bumps are step 1's: engine and project 6.3.0, app 1.21.0, the toolkit 3.0.0 (the branch
  changes nothing in `src/toolkit/`). `yarn checkVersions --against main` passes.
- **Section 2, the changelog.** The entry is headed by the branch's name, as the others are
  (`2026-11-10 — p354-phase0-spike`), with Engine, App and Project sections. Engine adds a Fixed
  list beyond step 2's list: `runSceneLoadSettledHooks` walking a copy (Phase 5 step 6) and the GPU
  memory tab's catch-all counted last (Phase 5 step 5). The SBP budget raises are under Project
  (`sbp.config.ts`). The sizes are from the committed bundle baseline: the main chunk 392.3 →
  395.8 kB gzip, `features/instancing` 2,827 → 4,673 B.
- **Section 3, the plan done.** More files named this one than step 4 listed, and fewer of those it
  listed did: p057, p058, p348 and p351's header lines, p350's `Blocks` line, 14 comments in 13
  files in `src/` and `features/instancing/CLAUDE.md` (`docs/plans/p354_gpu-driven-culling.md`)
  named it, and all were updated (the comments rewrapped at 100 columns). p350's status line, "Where
  it stands", the roadmap's done list, its Tier 3 row and its branches note say p354 is done. p308
  and p370 didn't name it: each Related line gained it (p308: §5's static scatter on sets; p370:
  its §12 question 3, whose text now says the cull and the hook are there to build on). `features/lod/CLAUDE.md` no longer named it
  (Phase 6 took p354 off its later plans). p350's Tier 4 row is unchanged (its open question was
  already three's `MeshletDrawingPipeline` for huge single meshes).

## 5. Not in scope, and left for later

- **Occlusion culling** (a Hi-Z pyramid from the previous frame's depth). Phase 0 drew about
  9-40k instances, mostly in the open, so it has little to win there. It's worth measuring only
  for dense content seen from inside (a city, a forest at eye level), as a plan of its own on
  top of the sets' cull.
- **Cluster (meshlet) LOD**: p350 Tier 4. The question left is whether three's
  `MeshletDrawingPipeline` serves huge single meshes and static `BundleGroup` content. For
  instanced LOD content Phase 0 found it slower, and it keeps the CPU cost.
- **The single dispatch for every slot, and the coarse cell pre-cull**: below about 500k
  instances neither is needed (Phase 0). Phase 3 measures it and takes one in only if the
  compute with the sun's slot passes about 2 ms at 1M.
- **Multi-draw-indirect**: WebGPU doesn't have it. A draw per (slot, level, group) stays.
- **Entities on top of a set**: per-instance gameplay, ECS visibility tags, raycasts against
  instances, spatial domains. Those stay the pool's (D2).
- **A visible-instance readback for gameplay** (which instances drew). It's debug only (D11).
  A production readback would lag a frame or two behind, since it must stay async to stall
  nothing.
- **Choosing the backend by device** (a set off, or a lower density, on a weak device): p240's
  device levels. This plan reports the numbers p240 needs (Phase 4).
- **p308's static scatter on sets**: whether `createStaticInstances` (p308 D1) creates a set
  for its large cases is p308's decision. Its Related line points here.
- **Level colours for sets in the LOD overlay** (D11), until a debugging need shows up.
- **A streamed range's visibility fade** (D1's `addInstances(…, { fade })`): Phase 5 step 3 found
  none needed while the cells load from a ring past the set's cull distance (no tree pops in or
  out); content streamed from a nearer ring pops in whole cells (580k copies in 30 s at half the
  ring). It needs a per-range fade the cull writes into the entries' fade byte, with the set's
  LOD fade, when such content shows up.
- **Spatial chunks for the CPU backend** (Phase 4): one `InstancedMesh` per level for the whole
  set, so three culls a level only as a whole, and past about 20k instances in a spread-out set
  the CPU backend draws more than tiled pools do (at 100k on `instanceStress`: a GPU frame of
  7.0 ms against the pools' 5.1, 1.8M triangles against 1.1M). A level mesh per (chunk, level),
  each with its own bounds, would give three's culling what the pools' tiles give it, at a draw
  call per chunk. Worth it when a WebGL2 device (p240's weak tier) shows a set's GPU frame as the
  limit.
