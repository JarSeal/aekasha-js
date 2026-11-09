Status: stub | Phase 0 (the spike) done, the real plan not written yet
Category: Rendering, LOD, GPU
Epic: p350_lod-system-research.md (Tier 3)
Related: \_DONE_p346_spatial-domains.md, \_DONE_p351_impostor-billboard-lod.md (impostor levels are bins too), p240_client-device-capability-sniffer.md (whether the GPU path is worth enabling on a device)

# GPU-Driven Culling & Per-Instance LOD — Stub

**This is a stub.** It records the target and what's known, so the real plan can be written once
p348 has shipped and its numbers show where the CPU path stops scaling. Phase 0's spike has
measured that (Phase 0 findings, below): the real plan is written from it.

## Goal

Move instance culling and LOD selection for instanced content off the CPU:

1. A compute pass reads every instance's bounds from a storage buffer, tests it against the camera
   frustum, picks its LOD level with p348's rules (screen size, bias), and appends its index to
   that level's visible list.
2. Each level draws with an indirect draw whose instance count the compute pass wrote. The vertex
   stage fetches the instance's matrix through the visible list.
3. No per-instance CPU work per frame: ten thousand or a million trees cost one dispatch and one
   indirect draw per level.

This is the realistic end state for the engine (p350 §7): "Nanite-lite" at instance granularity,
without meshlets or software rasterization.

## What's known (2026-10-02)

- three r186's WebGPU backend supports indirect draws (`geometry.indirect`, an
  `IndirectStorageBufferAttribute`; `renderers/common/Geometries.js:286`,
  `WebGPUBackend.js:2187`) and indirect compute dispatch (`WebGPUBackend.js:1925`).
- The engine has no compute passes yet (checked 2026-11-04). The only compute-related code is
  debug: the GPU timer (`src/_engine/debug/_dbg__GPUTimer.ts`) times compute dispatches with the
  frame's render contexts, and the stats panels show them (`src/_engine/debug/CLAUDE.md`, GPU
  timing), so the spike's dispatch cost is readable without new tooling.
- **The WebGL2 fallback (`forceWebGL`) has no compute.** The CPU path (p348) must stay and is
  chosen per backend.
- ECS state: GPU-culled instances have no ECS visibility tags (`TAG_FRUSTUM_CULLED`,
  `TAG_LOD_CULLED`). That's fine for instanced content, which has none of the per-entity hooks
  anyway, but anything gameplay-side reading "is this visible" can't use the GPU path.
- **The CPU path's cost, measured** (p616 Phase 2, largeWorld's 3,800 `LOD` entities and pool
  instances, debug env): LOD selection about 0.12-0.17 µs per entity a frame
  (`features/lod/CLAUDE.md`); `instancedMeshPoolSyncSystem` about 35 ns per instance with nothing
  moving (130-150 µs for 3,500). These are the numbers the GPU path has to beat, and the point
  where the CPU path stops scaling is somewhere above them: the real plan measures it first.
- **The pieces it builds on** (`features/instancing/CLAUDE.md`, `features/lod/CLAUDE.md`): the
  instanced LOD pool (`createInstancedLodPool`, one `InstancedMesh` per level, instances moved
  between them through `registerLodTarget`), its per-instance `lodFade` attribute
  (`createLodFadeAttribute`, `enableLodDither`, on `aekasha/lod`), and pool bounds that grow
  with their instances and never shrink.
- **Where it goes** (SBP, `devTools/sbp/CLAUDE.md`): the GPU path is part of `instancing()` (with
  `lod()`'s rules ported), opted into per pool, and its compute code loads with an `import()` on
  the first pool that asks for it on a WebGPU backend, so a build or a device that doesn't use it
  downloads none of it; `yarn sbp`'s `instancing` and `lod` groups stay within their budgets.
- The instance attribute leak (`docs/issues/three-instanced-node-attribute-leak.md`, three
  r186 never deleted a removed `InstancedMesh`'s instance attributes) is fixed in three r187
  (#34603, #34690; p057 checks it).
- **three r187 (2026-10-30) ships a drawing pipeline hook and an experimental GPU-driven
  pipeline** (p057's review):
  - `renderer.drawingPipeline` (core, `renderers/common/StandardDrawingPipeline.js`, marked
    experimental): `begin`, `isCulled`, `pushRenderItem`, `project`, `prepareAsync`, the part
    that was `Renderer._projectObject`. It's the supported place for a GPU path to take over a
    pool's culling and submission without patching three (open question 4).
  - `MeshletDrawingPipeline` / `VisibilityBufferDrawingPipeline` (addons,
    `examples/jsm/pipelines/`, #35191, "experimental, interface might change", WebGPU only):
    64-triangle clusters with up to 6 simplified levels, compute frustum, normal-cone and
    two-phase Hi-Z occlusion culling per object and per cluster, LOD by projected error,
    indirect draws; it handles `InstancedMesh` instances, `THREE.LOD`, static `BundleGroup`s and
    `maskNode` (so `lodDither` survives). It falls back to the standard path for `VSMShadowMap`
    shadow passes (the app's shadow type), non-perspective cameras, reversed or log depth,
    transparent, non-`FrontSide`, `flatShading` or `vertexColors` materials, a texture `channel`
    other than 0, mirrored objects and storage instance matrices. Its LOD is continuous per
    cluster: no discrete p347 levels, impostor bins or cross-fades. About 190 KB raw plus ~90 KB
    of meshopt clusterizer and simplifier it bundles itself (a duplicate of the engine's
    `meshoptimizer`), so it could only ever be a lazy `import()` chunk.
  - InstancedMeshes now share shader builds (#35007): the instance matrix is a
    `referenceAttribute('instanceMatrix', 'mat4')`, bound per object. A GPU path's per-instance
    buffers (visible lists, fades) bind per object the same way (p058), or mark their builds
    object-specific as `LodFade.ts` does since p057.

## Open questions for the real plan

1. **Shadow passes.** Each shadow-casting light needs its own cull against its own frustum (or a
   conservative union). How many dispatches per frame is that with the sky's sun plus a few spot
   lights?
2. **Where instance data lives.** Pool transforms are on the ECS side today, synced into
   `instanceMatrix` by `instancedMeshPoolSyncSystem`. A GPU path wants them in a storage buffer
   written once (static instances) or from a dirty list (dynamic).
3. **Occlusion culling.** A Hi-Z pyramid from the previous frame's depth is the usual next step.
   Worth it only for dense scenes (cities, forests seen from inside); measure first.
4. **Interaction with three's own culling.** Instanced meshes on the GPU path must have
   `frustumCulled = false` (the whole batch is one object to three).
5. **Debugging.** A readback of per-level visible counts (async, debug only) for the LOD drawer
   tab (`features/lod/debug/_dbg__LOD.ts`), and the GPU memory tab's view of the storage
   buffers (a `registerGPUMemorySource`, `aekasha/debug`, if three's `info.memory` doesn't place
   them under an owner).
6. **Cross-fades** (p351 Phase 2, no popping). An instance changing level is appended to both
   levels' visible lists for `fadeSeconds`, each with its signed fade for `lodDither`, and fades
   out to culled the same way; the fade state per instance moves to the GPU. `fadeSeconds: 0`
   keeps instant switches. The GPU path must match the CPU path here, or a pool would pop only
   on one backend.

## Phase 0 findings (2026-11-09)

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

### The CPU path (instanced LOD pools), camera circling

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

### Three's `MeshletDrawingPipeline` as a drop-in (the same pools)

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

### The hand-written path (`instanceStress/gpuCullSpike.ts`)

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

### The cull per camera through `renderer.drawingPipeline`, the VSM sun shadow on

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

### Hysteresis and cross-fades on the GPU

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

### The pools' own materials, a draw per (level, group)

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

### What this means for the real plan

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

## Rough phases (to be refined)

0. **Spike — done** (see Phase 0 findings; measured on `instanceStress`, the compute wired from an
   ECS system, not yet through `drawingPipeline`). Two parts, on WebGPU, with p345's frame numbers
   before and after:
   - three's drop-in first (`renderer.drawingPipeline = new MeshletDrawingPipeline()`, a lazy
     `import()`) on largeWorld and lodShowcase: what it culls, what falls back (VSM shadows, the
     fades) and what it costs. If it covers a content class (static content in a `BundleGroup`,
     huge single meshes), that class can use it instead of this plan's path.
   - Then a TSL compute pass that frustum-culls 100k instances into one indirect draw, wired in
     through `renderer.drawingPipeline` rather than a patch: the hand-rolled path keeps what
     three's lacks (discrete levels, impostor bins, per-instance cross-fades, VSM shadows).
1. **Frustum culling + indirect draw** for one instanced pool type, behind a per-pool flag.
2. **Per-instance LOD** binned into per-level indirect draws (p348's rules ported to TSL).
3. **Shadow passes.**
4. **Occlusion culling**, if measured as worth it.
5. **Hub and docs** (second-to-last, per the plans' convention): the LOD feature page
   (`hub/pages/features/lod/`, which covers the pools too) and the instancing and LOD nested
   `CLAUDE.md` files, a `lodShowcase` lane for the GPU path
   (`features/lod/CLAUDE.md`'s lanes), then versioning.

## Not in scope

Cluster-level (meshlet) LOD of the engine's own stays out (p350 §8, Tier 4): since three r187 the
question is whether three's `MeshletDrawingPipeline` serves huge single meshes (terrain chunks,
large architecture), Phase 0's first part.
