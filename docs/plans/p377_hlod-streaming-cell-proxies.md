Status: in progress | Phases 0-3 implemented (2026-11-12); Phases 2-6 written from Phase 0's Results (far entries for kit meshes, the larger-cells recommendation)
Category: Merging, LOD, Streaming
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 3.2)
Related: p376_hlod-merged-cluster-proxies.md (not adopted: its Phase 0's measurements and spike tools), \_DONE_p353_macro-streaming-grid.md (the far layer and its JSON far entries), p306_terrain-blocks-and-procedural-terrain-meshes.md (a block with its dressing as one far proxy), \_DONE_p347_lod-chain-generation.md (the build-time simplifier), \_DONE_p371_geometry-merging.md (the build-time GLB merge), \_DONE_p372_mesh-merge-groups.md (`AUTO` cells, the groups' cull), \_DONE_p374_multi-material-merging.md (palettes: one draw for several materials), \_DONE_p375_batched-mesh-batches.md (a batched member's mesh out of the scene graph), p378_baked-members-out-of-the-scene-graph.md (open question 5, split off after Phase 0)

# HLOD: Streaming Cell Proxies

Far static content drawn in few draws. Split from p376 (2026-11-12), whose Phase 0 measured what
far merged content costs and failed its gate: simplified proxies cut triangles without saving GPU
time, and the CPU frame followed the draws, one per merge group. So this plan starts from draws,
not triangles.

**It is measurement-first.** Four ways to fewer draws are on the table (a group cull, larger
`AUTO` cells, a cell's content as one mesh, today's far entries for kit meshes), and Phase 0
measures them on p376's far field before any is built. Its result chose the far entries for kit
meshes (a gather change: the far layer draws a cell's kit as one `InstancedMesh` per geometry and
material, as cheap as a merged proxy) and a larger-cells recommendation for far content that
doesn't stream; no cell proxy and no cull are built. The grounding, decisions and Phases 1-6 are
written from its Results, and the hidden members' cost it found is p378's.

## What p376 measured (Apple M2, Chrome; p376 §3 Results)

- largeWorld with a far field of ruin sites 200 m-1 km out (`?hlodField=<sites>`), merged `AUTO`
  in 32 m cells: 150 sites made 743 groups (149,392 triangles), 400 sites 1,838 (387,048).
- Simplified proxies (`permissive`, maxError 0.2) cut 39-50 % of the groups' triangles in view at
  `AUTO`'s pick, up to 289,000 triangles a frame, and **no GPU time on WebGL2** in any view; on
  WebGPU the scene passes saved 0.9-1.4 ms in one view of three.
- **The CPU follows the draws**: one per group, 1,245-1,605 draws and 12-17 ms of CPU a frame at 400
  sites, against 560-650 draws and 4.7 ms at 150. A proxy level swaps a group's index, not its draw.
- **Not all of that CPU is the draws** (read from p376's saved runs, `.cache/bench/hlodSpike-step3-*.json`):
  75-80 % of the CPU frame is the render submit (400 sites, WebGL2: 9-15 of 12-18 ms), the rest
  the systems. The submit holds the draws (each group in view drawn twice, by the scene pass and
  the AO pre-pass, plus the shadow's) and three's scene update, which still walks the baked
  members' hidden meshes: about 50 pieces a site, 20,000 members at 400 sites (only a batched
  member leaves the scene graph, p375 Phase 2 S1, which measured 0.26 ms per 2,000 on WebGL2).
  So "the draws are the cost" is p376's inference, not a split measured: Phase 0 step 1 splits it.
- The tools to measure with are on p376's branch: `devTools/bench/hlodSpike.ts` (`--step frames`,
  `--field`, the views, both backends, the WebGPU scene passes) and the probe
  (`src/app/shared/_dbg__hlodSpike.ts`). WebGPU's frame figure overstates (passes overlap on a
  tile-based GPU, `docs/issues/gpu-timer-webgpu-frame-sum.md`): compare per pass there.

## Goal

A streaming cell's (or a far region's) static content drawn, while far, in **few draws**: p353's
far layer showing a cell's content as one mesh per material (or per palette, p374), not as the
cell's groups one draw each. A simplified copy is secondary: it pays only where the frame is bound
by its triangles, which p376 didn't find. (After Phase 0: one `InstancedMesh` per geometry and
material, the far layer's existing group, is as few draws as it takes; D1.)

## Phase 0 — Which way to fewer draws — done

No engine change: spike code (debug modules and the bench) on p376's tools, measured before
anything is built. On p376's far field at 400 sites (150 for the trend), Apple M2, Chrome, both
backends, the debug env, set up as p376 §3 step 3 (the sky paused at 10:00, 1600 × 900, three
runs a backend, 120 + 300 frames a case, the views `start`, `far` and `ground`). The reference is
p376's `FULL`: 32 m `AUTO` cells, the members alive, no cull. WebGPU is compared by its scene
passes (`docs/issues/gpu-timer-webgpu-frame-sum.md`). Branch: p377's own, from p376's (its tools
aren't on `main` until p376's PR merges).

**What the spike adds**

- **The field** (`src/app/scenes/largeWorld/_dbg__largeWorldHlodField.ts`): `?hlodFieldCell=<m>`,
  the `AUTO` cell size (default 32), and `?hlodFieldAs=members|proxy|instanced`:
  - `members` (default): today's, merged `AUTO`.
  - `proxy` (way 3): after the scene step's builds, each field group's geometry copied into a mesh
    entity of its own (`saveBufferGeometry` as `hlodSpike:proxy:<group id>`, the group's material
    and pose), then the field's members deleted, and their groups with them (the spike checks none
    is left drawing). At 128 and 256 m cells (a streaming cell is a power of two of at least
    32 m), that's a cell's proxy at full detail as the far layer would load it: one mesh per
    material per cell, no members.
  - `instanced` (today's far layer): the same pieces as one `InstancedMesh` per cell, geometry and
    material, as `createFarGroupEntity` draws a cell's JSON far entries (p353 D7; the kit's four
    geometries in three materials make four a cell), no members. What a far cell would draw with
    no new code but a far entry for a kit mesh (today one needs explicit `lod` levels): the
    baseline way 3 has to beat.
- **The probe** (`src/app/shared/_dbg__hlodSpike.ts`):
  - `screenSizes()`: the field groups' screen sizes from the camera now (measured as `setLevel`
    measures them for `AUTO`), as quantiles, so the cull sizes come from the field, not a guess.
  - `setCull(size)`: every `BAKED` group entity gets `setMeshLod(id, { levels: [{ screenSize: 0 }],
    cullScreenSize: size, fadeSeconds: 0 })`, `0` removes it (`removeMeshLod`). The LOD pins level
    0's geometry at its add (p376 §1), so a rebuild under it would come back stale: fine for a
    static field measured after its builds, not for shipping (that's p376 D6's setting).
  - `cpuSplit(frames)`: the CPU frame's parts: the render submit (as now), one
    `scene.updateMatrixWorld()` timed on its own inside it (three's walk over every object, the
    hidden members included), the systems (the rest), and the scene graph's objects, the hidden
    ones apart.
  - Draws per pass: the field's drawn objects (groups, proxies or instanced meshes) in the main
    camera's frustum, which the scene pass and the AO pre-pass both draw, and in the sun's shadow
    frustum, next to the renderer's total.
  - `rebuildAsync(n)`: n field groups rebuilt one at a time (`rebuildMergeGroup`), each its build's
    time: the CPU frame that applies it over the median frame, or the worker's above
    `WORKER_BUILD_VERTICES` (65,536). What a member's add costs at each cell size (a move or a
    remove is in place at any size).
- **The bench**: `devTools/bench/hlodSpike.ts --step draws` (`hlodSpikeDraws.ts`, on
  `hlodSpikeFrames.ts`' model): the cases below, a page each (the cull sizes on the reference's
  page), every figure above, the scene's load time (navigation to the loaded scene's first frame),
  and a screenshot per case and view (`.cache/bench/hlodSpike/draws/<backend>/<case>-<view>.png`)
  compared with the reference's (`devTools/verify/snapshotDiff.ts`' changed share and mean delta;
  two reference runs compared give the noise). About 50 pages: run in the background, its log in
  `.cache/bench/progress.log`.

**Steps**

1. **The split**: the reference and the field off (no `?hlodField`: the floor), with `cpuSplit`.
   How much of the 12-17 ms is the draws, how much three's walk over the 20,000 hidden members,
   how much the systems. This bounds what a way that keeps the members (1, 2) can win against one
   that doesn't (3, `instanced`).
2. **A cull** (way 1): 32 m cells, `setCull` at three sizes read from `screenSizes()` at `far`
   (culling about a quarter, a half and three quarters of the field's groups). The draws lost, the
   CPU and GPU saved, and the images: at which size the field's look holds (by eye on the saved
   images; the changed share is the figure).
3. **Larger cells** (way 2): 64, 128 and 256 m, `members`. The draws, the groups' triangles in
   view (a group is drawn whole once any of it is in view, its shadow too), the CPU and GPU, the
   rebuild and load times. Way 2 is for a scene that doesn't stream: a streamed `FAR` cell's
   members aren't loaded, so a streaming scene's far content is way 3's or the far entries' either
   way.
4. **A cell as one mesh** (way 3) and today's far layer: `proxy` at 32, 128 and 256 m, `instanced`
   at 128 and 256 m. `proxy` at 32 m has the reference's draws without its members: the members'
   own cost, which step 1 split into parts. `proxy` against `members` at one size is what a
   build-time proxy wins over larger cells, `proxy` against `instanced` what it wins over far
   entries.
5. **One draw a cell** (only when step 4's `proxy` pays, and when the ruins' three materials can
   be one palette by p374's rules): the field's `AUTO` with `palettes`, at step 4's best size. What
   open question 1's per-material draws cost.

Then at 150 sites: the reference and each way's best. With another machine at hand (the WSL2
machine's Windows Chrome on its own GPU, `devTools/verify/CLAUDE.md`), the reference and each
way's best there too (open question 4).

**What decides.** Each way against the reference at 400 sites. It pays when it saves at least
1 ms of CPU frame in two of the three views on both backends, loses no GPU time beyond the runs'
spread (WebGL2's GPU figure, WebGPU's scene passes), and, for ways 2-4, keeps the image inside
the reference's noise.

| Result | The plan becomes |
| --- | --- |
| A cull pays at a size whose look holds | a group cull: p376 D6's setting reduced to `cullScreenSize` and its fade, as a phase here or a small plan in the epic |
| Larger cells pay, and a rebuild at that size stays under 4 ms on the main thread (or goes to the worker) | a recommendation (far content's `cellSize`, on the Hub's Mesh merging page), nothing to build |
| `proxy` pays over `members` at the same size and over `instanced` | the build-time cell proxy (What's known below): the gather, the output (open question 2), the far layer's load |
| `instanced` within 1 ms of `proxy` | far entries for kit meshes (a mesh without explicit levels gets itself as its far entry): a gather change, not a proxy |
| None pays | p377 closes as p376 did: not adopted, the results kept |

Several can hold (a cull on larger cells; a cell proxy for streamed scenes beside larger cells
for the rest): the plan takes each that pays, the cheapest first. The figures go in a Results
subsection here, and the rest of the plan (grounding of the chosen way, decisions, phases) is
written from them.

**As built** (where the spike differs from the above):

- `proxy` merges a cell's pieces of one material directly (`mergeGeometryParts`, the same parts,
  matrices and material a group build takes, centred as a group's mesh), registered as
  `hlodField:proxy:<cell size>:<material>:<cx>,<cz>`: no members are made, rather than built,
  copied and deleted. Checked: at 32 and 256 m it draws exactly the groups' draws and triangles.
  So its load time is the merge on the main thread with no members, which a build-time proxy's
  load isn't either. `largeWorldRuins.ts`' `layoutRuins` places the pieces for all three ways.
- `setCull` acts on the field's objects (its groups, proxies or instanced meshes), not on every
  `BAKED` group, so largeWorld's own 28 groups are never culled; it sets `hysteresis: 0`, so the
  share culled is the share below the size. `screenSizes` measures an `InstancedMesh` by three's
  sphere over its instances (the LOD's `LodBounds.ts` fits its own: 109 of 208 culled at the
  median, not 104).
- `cpuSplitAsync` times the root scene's `updateMatrixWorld` (wrapped, summed per frame: two
  walks a frame, the scene pass and the AO pre-pass). `fieldDraws` counts what three draws
  (visible, then the bounding sphere). Both are in `src/app/shared/_dbg__hlodSpikeDraws.ts`.
- The bench holds the sky's clouds still (`setupSkyAsync`'s `holdClouds`: drift speed 0 through
  `updateSkyBox`): they drift per frame, and every page ran other frame counts, so the shots
  differed in the clouds alone (2.65 % of the pixels at `ground`; 0.01 % held). The image noise is
  floored at the scene runner's tolerance (0.2 % changed, a mean delta of 0.5): the bridge's
  snapshots are byte exact, and a proxy's float rounding (another pivot) is no change.
- One unrecorded warm-up load a backend (the dev server's first is cold). The output is per field
  size, `.cache/bench/hlodSpike/draws/<sites>-sites/`.
- **WebGPU's GPU figure doesn't decide** (decided 2026-11-12, from the results below): the
  `floor` case, no field at all, "lost" 1.6-6.4 ms of WebGPU scene pass time against the
  reference. A pass's time grows when the CPU frame shrinks (the passes overlap on the M2's
  tile-based GPU, `docs/issues/gpu-timer-webgpu-frame-sum.md`), so every way that saves CPU read
  as a GPU loss. The GPU condition is WebGL2's alone; WebGPU's scene passes stay in the tables.

### Results

Measured 2026-11-12, Apple M2, Chrome, debug env (`hlodSpike.ts --step draws`,
`devTools/bench/hlodSpikeDraws.ts`): 3 runs a backend, 120 + 300 frames a case, the views `start`,
`far` and `ground`, the sky at 10:00. The figures: `.cache/bench/hlodSpike-p377-draws-400.json`
and `-150.json`, the tables and snapshots in `.cache/bench/hlodSpike/draws/<sites>-sites/`.

**Step 1: the split** (400 sites; the CPU frame's medians, the range over the three views, ms):

| | WebGPU | WebGL2 |
| --- | --- | --- |
| The reference (`members@32`): the CPU frame | 10.6-11.5 | 11.7-13.7 |
| its render submit | 8.0-9.6 | 9.2-10.9 |
| in it, the scene graph walk (two a frame, 22,741 objects, 20,808 hidden) | 3.6-4.5 | 4.1-4.9 |
| its systems | 1.9-2.0 | 2.4-2.6 |
| `proxy@32` (the reference's draws, no members) | 5.4-5.9 | 5.3-6.0 |
| The floor (no field) | 2.4-2.8 | 2.3-2.4 |

- **The draws** (`proxy@32` against the floor): 1,119-1,477 draws for 2.9-3.6 ms, 2.1-2.8 µs a
  draw on both backends.
- **The members** (the reference against `proxy@32`, the same draws): 5.0-5.5 ms on WebGPU,
  6.3-7.7 ms on WebGL2. The walk is 80-107 ns an object a walk; the systems 0.9-1.7 ms more; the
  rest of the submit (0.5-2 ms) isn't split.
- So of the field's 8-11 ms, about 40 % is its draws and 60 % its hidden members: p376's "the
  draws are the cost" was half of it.

**Steps 2-4** (400 sites; the CPU frame saved against the reference, start / far / ground, the
medians of each run against the reference's run of the same index, ms):

| Case | WebGPU | WebGL2 | Image changed | Pays |
| --- | --- | --- | --- | --- |
| cull 25 % | -0.7 / 0.7 / 0.2 | -0.5 / 1.0 / 0.4 | ≤ 0.03 % | no |
| cull 50 % | 0.5 / 2.1 / 1.3 | 0.5 / 2.7 / 1.5 | ≤ 0.15 % | yes (two views) |
| cull 75 % | 1.5 / 2.9 / 1.8 | 1.9 / 4.2 / 2.8 | 0.10-0.33 % | no (the image) |
| `members@64` | 1.6 / 1.9 / 1.6 | 2.5 / 2.3 / 2.8 | ≤ 0.08 % | yes |
| `members@128` | 2.8 / 3.4 / 2.9 | 4.2 / 5.1 / 4.2 | ≤ 0.08 % | yes |
| `members@256` | 3.5 / 3.9 / 3.6 | 4.9 / 6.2 / 4.7 | ≤ 0.08 % | yes |
| `proxy@32` | 5.0 / 5.4 / 5.5 | 6.5 / 7.7 / 7.3 | ≤ 0.08 % | yes |
| `proxy@128` | 7.2 / 7.9 / 7.4 | 8.5 / 10.2 / 9.3 | ≤ 0.08 % | yes |
| `proxy@256` | 7.8 / 8.6 / 8.0 | 9.1 / 10.9 / 9.8 | ≤ 0.08 % | yes |
| `instanced@128` | 7.0 / 7.7 / 7.3 | 8.4 / 10.2 / 9.1 | ≤ 0.08 % | yes |
| `instanced@256` | 7.8 / 8.4 / 7.9 | 9.0 / 10.7 / 9.7 | ≤ 0.08 % | yes |

(WebGL2's GPU: no case lost time beyond the reference's spread, 0.56-0.85 ms; the floor saved
0.7-3.3 ms. The reference's own image noise: 0.00 %.)

- **A cull** takes the draws, not the members: their walk stays (4.4-4.6 ms), so half the field
  culled (986 draws fewer at `far`) saves 0.5-2.7 ms. Its sizes at `far`: 0.0090 / 0.0141 /
  0.0220 for a quarter, a half and three quarters. At 75 % the image goes past the noise (the
  culled sites are seen missing, 0.33 % at `far`).
- **Larger cells**: every rebuild took one frame on the main thread (none of 24 a size reached
  the worker: a 256 m group here is under 65,536 vertices), 0.4-1.2 ms over the median frame;
  single rebuilds of 3-14 ms came at every size, 32 m included, so not from the size. The load
  is the same (2.2-2.5 s).
- **A cell as one mesh**: `proxy` over `members` at 256 m saves 4.3-4.7 ms on both backends (the
  members' walk and systems). `instanced` is within 0.2 ms of `proxy` at 128 and 256 m on both
  (it draws 46-65 objects more at 256 m, 116-157 at 128 m: 0.1-0.2 ms). The load: `proxy`
  1.9-2.2 s, `instanced` 1.8-1.9 s, `members` 2.2-2.5 s, the floor 1.8-1.9 s (the field's creation
  63-80, 14-16 and about 100 ms).
- **Step 5** wasn't run: `proxy` doesn't pay over `instanced`.

**150 sites** (the trend: the reference and each way's best): the field costs 2.4-3.1 ms over the
floor. Saved: the 50 % cull 0.0-0.7 ms, `members@256` 0.6-1.0 ms, `proxy@256` 2.2-2.7 ms,
`instanced@256` 2.1-2.4 ms on both backends. Only `proxy` and `instanced` pay: the cull and
larger cells pay only with the larger field.

**A second machine**: not run (open question 4 stays open).

**What the table says** (cheapest first; the plan's phases are written from it once reviewed):

1. **`instanced` within 1 ms of `proxy`** (within 0.2 ms at both cell sizes and both field
   sizes): far entries for kit meshes, a gather change, not a build-time proxy. A cell drawn as
   one `InstancedMesh` per geometry and material is as cheap as its merged proxy, and the far
   layer draws that today.
2. **Larger cells pay** at 400 sites (1.6-6.2 ms) and not at 150 (under 1 ms), the rebuilds' medians
   under 4 ms on the main thread: a recommendation for a large field that doesn't stream (the
   Hub's Mesh merging page).
3. **A 50 % cull pays** at 400 sites in two views of three (1.3-2.7 ms), not at 150: the smallest
   of the ways, as it doesn't reach the members.
4. **Open question 5 answered**: the hidden members are 60 % of the far field's CPU cost, and
   every merged scene pays their walk (80-107 ns an object, twice a frame). Taking a baked
   member's mesh out of the scene graph (as p375 does for a batched one) is the largest single
   saving measured here, for any merged scene, streamed or not.

### Decided after Phase 0 (2026-11-12)

- **p377 takes the far entries for kit meshes** (the table's row 4): a streamed cell's JSON mesh
  without explicit `lod` levels gets itself as its far entry, grouped per cell, geometry and
  material into one `InstancedMesh` as today's far groups are (p353 D7). A gather change, not a
  build-time proxy: the cell proxy (way 3) and its open questions 1-3 aren't built. Its grounding,
  decisions and phases are written from these Results.
- **And the larger-cells recommendation** (row 2): far content that doesn't stream merges in
  larger `AUTO` cells (128-256 m at this density), documented on the Hub's Mesh merging page with
  these figures; nothing to build. It pays only with a large field (at 150 sites under 1 ms).
- **No cull.** The 50 % cull pays in two views of three at 400 sites only (1.3-2.7 ms) and not at
  150; it reaches the draws, not the members. p376 D6's setting isn't revived.
- **Open question 5 is a plan of its own** in the p370 epic (proposed `p378`, Tier 3.3): a baked
  member's mesh out of the scene graph, as p375 Phase 2 S1 does for a batched one. Its own branch
  and PR (a merging change for every merged scene, not far content); this field (`?hlodField`) is
  its measurement.
- **The second machine doesn't block** (open question 4): the far entries pay by a wide margin on
  the M2 (7-11 ms at 400 sites). The reference and `instanced@256` on the WSL2 machine's Windows
  Chrome go with the far entries' verification phase.

## Grounding: far entries for kit meshes (checked against the code, 2026-11-12)

A kit mesh here is a streamed cell's JSON mesh with a registered `geo` and `mat` and no `lod`:
a modular piece (a wall, a pillar, a floor tile, rubble), usually merged `AUTO` while near, as
p376's ruins are. What the far layer does with one today, and what the change touches:

- **The gather decides, in one function.** `getFarMeshProps` (`devTools/gather/streamingManifest.ts`)
  returns null for a mesh without `lod`, with `AUTO`, with empty `levels` or with a
  `cullScreenSize` over 0; `addFarEntry` adds nothing then. So a kit mesh's cell draws nothing of
  it from `FAR`: the content appears at the `nearby` ring (2 cells by default) and is gone past
  it, where the far ring (5) would show it. An oversized mesh is kept content and gets no far
  entry either way (D8: a far copy beside the near one would z-fight); that stays.
- **Grouping is already what Phase 0's `instanced` measured.** `getFarGroupKey` groups a cell's far
  entries by the string `geo` and `mat`, no `matOverrides`, and both shadow flags, into one
  `farMeshes` entry; `createFarGroupEntity` (`src/_engine/features/streaming/StreamingDataContent.ts`)
  draws it as one `InstancedMesh` (refs on the geometry and material, bounds over every instance,
  three's culling, not the ECS's). The spike's `instanced` (`_dbg__largeWorldHlodField.ts`) made
  the same meshes by hand: one a geometry per cell, `castShadow` on. A far entry that doesn't group
  (an inline `geo` or `mat`, or `matOverrides`) is a mesh of its own through `createSceneObject3Ds`:
  one draw each, no saving over the near content.
- **A far instance copies its transform.** `addFarEntry` pushes each entry's `position`, `rotation`,
  `quaternion` and `scale` into its group's `instances` (`StreamingFarInstance`), though it is
  the near entry's own transform (`getFarMeshProps` takes it from the mesh's props; the coarsest
  level changes only `geo`, `mat` and `castShadow`). The manifest is in `generatedAppData.json`,
  which `src/generated/index.ts` imports statically: the app's first download (775 KB before gzip
  today). Every kit mesh getting a far entry would write each transform twice: about 40-90 bytes
  each before gzip, so 0.8-1.8 MB for a 20,000-piece field. The near entry is already in the
  manifest's `meshes`, by an index the gather has (`cellMeshes.forEach`'s `index`).
- **A far mesh of its own keeps props it shouldn't.** `getFarMeshProps` drops `lod`, `appId` and the
  transform and keeps the rest: `merge`, `preWarm`, `frustumCullingEnabled`, `matOverrides`,
  `receiveShadow`. A far copy with `merge` would join a merge group from a `FAR` cell. Today only a
  `BATCHED` member with explicit levels and an inline `geo` / `mat` or `matOverrides` reaches it
  (a `BAKED` group refuses a `LOD`); a group's props are only `geo`, `mat` and the two shadows.
- **The near layer is merged; the far layer isn't, and the fades meet there.** A near ↔ far switch
  fades both layers at once (`releaseLeavingLayers`), but a merge group doesn't fade with a cell
  (the merging `CLAUDE.md`'s Streaming): its mesh draws the leaving members whole until their
  unload deletes them, and the incoming ones whole from the next build. So for `fadeSeconds` the
  group and the far `InstancedMesh` draw the same surfaces, one dithered: another vertex path
  (baked world positions against an instance matrix), so the dithered pixels can z-fight. Same
  look; checked by eye in the test scene. Explicit-levels far entries never met it (a `BAKED`
  group refuses a `LOD`, a `BATCHED` one fades its members).
- **Assets and memory.** `addFarMeshRefs` lists the far entry's `geo` and `mat` (and its material's
  textures) in the far layer, which loads them under its own owner key (`<sceneId>#<cellKey>/far`;
  a cache hit while the near layer has them). For a kit that's every far cell holding the kit's
  geometries, materials and textures: once in memory (registered by id), but held while any
  tracked cell is loaded. `far.bytesEstimate` becomes the near layer's for kit content.
- **The load cost.** A far layer's entries go 8 a unit (`ENTRIES_PER_UNIT`), a group one entry
  whatever its instances; `createFarGroupEntity` writes a matrix per instance. Phase 0's field
  created 20,000 instanced pieces in 14-16 ms in all, so a cell's groups are well inside
  `maxCreateMsPerFrame` (2 ms). Priming paces a far layer streamed in during play as any other
  (`maxShownObjectsPerFrame`, 16 on WebGL2: a kit's few groups a cell), and its fade dithers the
  kit's materials (`enableLodDither`), as the near layer's does already.
- **What reads the far data.** `createFarGroupEntity` (`far.instances`), the far unit
  (`if (far.instances)` tells a group from a mesh of its own), the Streaming tab's
  `countFarGroups` (the alive meshes' `count`, not the manifest) and the tests:
  `streamingManifest.test.ts` (the far entry test lists a `plain` mesh with no far entry, and
  "lists each layer's cell-only assets" expects none for its `crate`; both change),
  `StreamingDataContent.test.ts` (a manifest with `instances`). `StreamingFarMesh` and
  `StreamingFarInstance` are public types on `aekasha/schemas` (`devTools/verify/baselines/api.json`).
- **The scenes.** Two stream: `streamingGrid` (JSON content: the beacons, explicit levels, so far
  groups; the wall, oversized, kept) and `streamingPhysics` (code content only, no JSON meshes).
  Neither has a kit mesh, so turning far entries on for kit meshes changes neither scene's data.
  largeWorld, where Phase 0's field is, doesn't stream: its far field was code made, and the far
  layer's real path (the gather, the units, priming, the fades) has no kit content to run on yet.
- **Larger cells** need no code: `AUTO`'s `cellSize` is a scene's `mergeGroups` entry or a mesh's
  `merge` option. The Hub's Mesh merging page (`hub/pages/features/mesh-merging/guide.md`) picks
  the cell size from the view (its AUTO section: largeWorld's 50 m, the example's 16 m) and says
  a group is drawn whole once any of it is in view (When to merge); it has no figure for a large
  far field, and its Streaming section asks for an `AUTO` cell size dividing the streaming cell's.

## Decisions (2026-11-12, after Phase 0)

- **D1: a kit mesh is its own far entry, by default, when it groups.** A streamed cell's mesh (not
  kept) without `lod` gets a far entry of itself: its `geo`, `mat`, `castShadow` and
  `receiveShadow` at its transform, into its cell's group of that kind (`getFarGroupKey`). Only
  when it groups: a string `geo` and `mat` and no `matOverrides`. One that wouldn't group gets
  none, as today (a far mesh of its own is a draw a mesh: no fewer draws than its near content,
  and more than today's none). Unchanged: a mesh with explicit `levels` (its coarsest level, as
  p353 D7), `AUTO` (none: its chain isn't known at build time, the streaming `CLAUDE.md`'s
  Limits), a `cullScreenSize` over 0 (none), an oversized mesh (kept, none), a light (none).
  Default on: content that shows near and vanishes past the `nearby` ring is what a far ring is
  there to avoid, Phase 0 measured the instanced far layer as cheap as a merged proxy, and no
  scene's data changes (neither streaming scene has a kit mesh).
- **D2: two ways out, both existing rules or build-time only.** Per mesh: a `lod` with a
  `cullScreenSize` (`{ levels: [{ screenSize: 0 }], cullScreenSize }`) gets no far entry, as now:
  a mesh that vanishes at a distance has no stand-in (it needs `lod()` and costs a `LOD` near,
  which only clutter wants). Per scene: `streaming.farEntries: 'ALL' | 'LOD_LEVELS'` (default
  `'ALL'`; `'LOD_LEVELS'` is today's rule), build time only like `base` and `radii`: the gather
  reads it, the output drops it (`toRuntimeSettings`), `setSceneStreamingSettings` warns once and
  ignores it. No per-mesh field: the mesh schema gains nothing for a choice the scene makes once.
- **D3: a far group names its near entries, not their transforms.** `StreamingFarMesh` gains
  `entries?: number[]`, indices into the manifest's `meshes`, whose `position`, `rotation`,
  `quaternion` and `scale` are the instances. The gather writes `entries` for every group,
  explicit-levels ones too (their transform is the near entry's): a far instance costs an index
  in the first download instead of a second transform. `instances` stays in the type, still drawn
  when given, `@deprecated` (replaced by `entries`, removed in engine 7.0.0); the gather no longer
  writes it. A group is one with either; `createFarGroupEntity` takes the manifest's `meshes` to
  read them (it's `@internal`). Additive on `aekasha/schemas` (the API baseline gains a field).
- **D4: a far mesh of its own drops `merge`.** `getFarMeshProps` leaves `merge` out with `lod` and
  `appId`: a far copy never joins a merge group. A fix of p353 D7's rule (a `BATCHED` member with
  explicit levels and an inline `geo` / `mat` or `matOverrides` reaches it today), in the same
  change.
- **D5: the near ↔ far fade over a merge group is accepted.** For `fadeSeconds` the merged near
  content draws whole while the far group dithers in or out on the same surfaces (Grounding). Same
  look, one fade's length; Phase 3 checks it by eye at a far ring's edge. If it shows, it goes to
  `p990_follow-ups-from-done-plans.md` (a far group drawn with a depth offset needs a material
  variant per kit material), not into this plan.
- **D6: code content is unchanged.** Code-registered content keeps registering its own `FAR` units
  (`streamingGrid`'s rocks' impostor cells): the gather can't see code-made geometry. The cell
  proxy (way 3) and its open questions 1-3 aren't built (Decided after Phase 0).
- **D7: the test scene is `streamingGrid`**, the JSON content test scene. It gains a small kit in
  its JSON: three registered geometries (a block, a slab, a post, a few metres each) in two
  materials, a ruin of six pieces in each cell with odd `cx` and `cz` (64 cells, none a beacon's:
  those are at even `cx`; 384 meshes), with `merge: 'AUTO'` (the scene's `mergeGroups` `AUTO`
  entry at 32 m, which divides its 64 m cells). So near the ruins are merged, far they're the far
  layer's groups: the combination a large streamed world has. 384 meshes keep the app's generated
  data small
  (`yarn sbp` reports the change); the far layer's real path (the gather, the units, priming,
  the fades, the asset owners) runs on kit content for the first time. **Amended in Phase 3**
  (2026-11-12): 16 ruin cells, 96 meshes (`cx` and `cz` each -7, -3, 1 or 5): the 64 cost
  +11.6 KiB gzip on the app's first download, where every scene's JSON is; 16 cost +3.4 KiB, the
  budgets raised by it (Phase 3's As built; scene data out of the first download is a p990 item).
- **D8: larger cells are a recommendation, on the Hub's Mesh merging page.** For far content that
  doesn't stream: at a few hundred kit sites in view (Phase 0's 400 sites over a kilometre,
  20,000 pieces), `AUTO` in 128-256 m cells saves 2.8-6.2 ms of CPU a frame against 32 m on both
  backends, a rebuild still one main-thread frame (0.4-1.2 ms over the median); at 150 sites under
  1 ms, so the default holds for a normal scene. In a streaming scene the `AUTO` cell still
  divides the streaming cell (the page's Streaming section), and the far content is the far
  layer's (D1). The same section names what larger cells don't reach: the hidden members' walk
  (p378).
- **D9: the second machine is in the verification phase, and doesn't gate.** Phase 4 runs
  `members@32` and `instanced@256` at 400 sites on the WSL2 machine's Windows Chrome on its own GPU
  (`devTools/verify/CLAUDE.md`), both backends, and records them as open question 4's answer.
  The far entries ship whatever it shows: they're the far layer's existing draw, and a far ring
  showing kit content is the point of the ring.
- **D10: versions.** Engine minor: kit meshes' far entries (a changed default, D1), `farEntries`
  (D2), `entries` (D3), the `merge` fix (D4). App minor: `streamingGrid`'s kit (D7). Toolkit
  none. Project: Phase 0's bench and spike tools. All of it on p377's branch, bumped against
  `main` with p376 in it (merged into the branch): engine 6.8.1 → 6.9.0, app 1.23.1 → 1.24.0.

## Phase 1 — The gather: kit meshes' far entries — done

D1, D2 and D4, in `devTools/gather/streamingManifest.ts` and the streaming schema. The output's
shape doesn't change (groups still with `instances`; Phase 2 changes it), so the runtime draws
the new far entries as it draws the beacons'.

1. **The setting** (D2): `farEntries: z.enum(['ALL', 'LOD_LEVELS']).optional()` in
   `SceneStreamingSchema` (`StreamingSchema.ts`), documented as `base` and `radii` are (build time
   only; JSDoc and `describe`), and its type in `SceneStreamingSettings`. `toRuntimeSettings`
   drops it; `setSceneStreamingSettings` (`Streaming.ts`) warns for it in the same one-time
   warning as `base` and `radii`, its text naming all three. `.schemas/` follows on the next gather.
2. **The rule** (D1, D4): `getFarMeshProps(props, farEntries)`: with explicit `levels` as now;
   without `lod` and `farEntries` `'ALL'`, the mesh's own `geo`, `mat`, `castShadow` and
   `receiveShadow` at its transform; `AUTO`, a cull and anything else null. `merge` is dropped with
   `lod` and `appId` (D4). `addFarEntry` adds a self entry only when `getFarGroupKey` gives a key
   (D1: one that wouldn't group gets none); an explicit-levels entry that doesn't group stays a
   mesh of its own. The file header and `getFarMeshProps`' JSDoc say the new rule.
3. **Tests** (`streamingManifest.test.ts`): the far entry test's `plain` mesh joins the group of its
   `geo` / `mat` (a group can hold self entries and coarsest levels alike), and "lists each layer's
   cell-only assets" expects its `crate`'s far group and the far layer's assets. New: `'LOD_LEVELS'`
   gives today's output exactly; a mesh without `lod` and an inline `geo`, an inline `mat` or
   `matOverrides` gets none; a cull, `AUTO` and an oversized mesh none; a far mesh of its own has
   no `merge`; `farEntries` is dropped from the output; the schema refuses another value
   (`StreamingSchema`'s tests) and `setSceneStreamingSettings` warns once for it.
4. **Docs**: the streaming `CLAUDE.md`'s JSON content (Far entries) and Limits, and
   `devTools/gather/CLAUDE.md`'s step 3 (its far entry clause).

Exit: `yarn test`, lint and both `tsc` clean; `yarn gatherAppData` leaves `streamingGrid`'s and
`streamingPhysics`' generated data unchanged (neither has a kit mesh).

**As built** (2026-11-12):

- `getFarMeshProps` also returns `kind: 'SELF' | 'LEVELS'`, and a self entry's props are the
  mesh's whole props (without `lod`, `appId`, `merge` and the transform), not only D1's four:
  `getFarGroupKey` needs `matOverrides` to refuse it. A group writes only `geo`, `mat` and the two
  shadows either way, so the output is D1's. `addFarEntry` returns before listing any asset for a
  self entry that doesn't group, so its assets stay out of the far layer.
- `farEntries`' JSDoc and `describe` name engine 6.9.0 as the version `'ALL'` became the default
  (D10's minor).
- `setSceneStreamingSettings`' warning got a test of its own: `Streaming.ts` had no test file, so
  `Streaming.test.ts` installs the feature with a stand-in context.
- Exit: the generated data (`src/generated/`, every profile) is byte-identical before and after
  the rule; `yarn test` 353 files, 3,327 tests.
- The Hub's streaming page still says only a mesh with LOD `levels` gets a far stand-in
  (`guide.md`'s Far representations and its limits list): Phase 6 step 1.

## Phase 2 — The far layer: groups by their entries — done

D3: a far group names its near entries; the gather writes them, the runtime reads them.

1. **The types** (`StreamingManifest.ts`): `StreamingFarMesh.entries?: number[]` (indices into the
   manifest's `meshes`, whose transforms are the instances), `instances` and `StreamingFarInstance`
   `@deprecated` (replaced by `entries`; removed in engine 7.0.0), the JSDoc saying a group has
   one of them.
2. **The gather**: `addFarEntry` pushes the mesh's manifest index to its group's `entries` and no
   longer writes `instances`; `getFarMeshProps` returns the props alone (the transform was only
   for `instances`; a far mesh of its own still gets it in its props).
3. **The runtime** (`StreamingDataContent.ts`): `createFarGroupEntity(world, far, meshes)` reads
   each instance from `meshes[entry].props` (the same compose as now: `quaternion` over
   `rotation`, scale 1 by default), or from `instances` when a group has them; the far unit tells a
   group by `entries ?? instances`. No allocation per instance (the module's scratch objects).
   `createFarGroupEntity` is `@internal`; its JSDoc and the module header say the change.
4. **The Streaming tab**: its JSON content line counts the manifest's far instances
   (`entries` or `instances`) next to the far meshes, so a scene's far layer reads in one line.
5. **Tests**: `streamingManifest.test.ts` (groups by `entries`, none with `instances`, explicit-levels
   groups included; the indices point at the near entries), `StreamingDataContent.test.ts` (a group
   by `entries` draws its near entries' transforms, rotation and quaternion and scale included;
   one by `instances` still draws; a far unit with both kinds).
6. **The size**: `streamingGrid`'s `__streaming` before and after, in bytes (its 32 beacons' far
   instances), noted under the phase; the API baseline (`yarn verify:baselines --update` if the
   field shows in `api.json`).
7. **Docs**: the streaming `CLAUDE.md`'s JSON content (`farMeshes`: `props` and `entries`).

Exit: as Phase 1's, and `streamingGrid` draws its far beacons as before (`yarn verify:scenes --only
streamingGrid` inside its baseline).

**As built** (2026-11-12):

- `getFarMeshProps` returns `{ props, kind }`: the props keep the transform (a far mesh of its own
  draws at it; a group writes only its four fields), `kind` stays (Phase 1's As built).
  `addFarEntry` takes the mesh's manifest index (`cellMeshes.forEach`'s `index`, the same as its
  place in `manifest.meshes`, base meshes left out).
- `createFarGroupEntity(world, far, meshes)`: `entries` wins when a group has both; the instance
  matrix is `setFarInstanceMatrix` (the module's scratch objects) for either source, and the far
  unit tells a group by `isFarGroup` (`entries ?? instances`). The deprecated field is read
  without a lint suppression: the config doesn't enable `no-deprecated`.
- The tab's JSON content readout is five lines: the manifest's cells, meshes and lights, then
  `N far meshes: G groups (I instances), K of their own`. Its note now says Phase 1's rule too (a
  mesh without `lod` is its own far entry), which it didn't.
- `devTools/gather/CLAUDE.md`'s step 3 names `entries` as well.
- **The size** (`streamingGrid`, its 32 far groups of one beacon piece each, compact JSON as the
  build ships it): `__streaming` 19,636 → 18,450 bytes (-1,186, -6 %), its `farMeshes` 5,129 →
  3,943; `generatedAppData.json` on disk (pretty printed) 775,602 → 770,896. The only change in
  the generated data is those 32 groups.
- Exit: `yarn test` 353 files, 3,328 tests (1 skipped), lint and both `tsc` clean. `yarn
  verify:scenes --only streamingGrid`: all five configurations pass on the baseline's hash
  (`811c9dc5`; its snapshot is skipped), the Streaming tab's drawer shot 6.09 % changed (an
  unstable shot: its masked readouts, the JSON content box a row taller).
- `yarn verify:baselines`: `api.json` unchanged (it records exports and their kinds, not a type's
  fields, so `entries` doesn't show and nothing is updated), the docs ratchet unchanged, no debug
  code; the streaming chunks inside the tolerance. It flags two bundle changes this phase didn't
  make: a new `assets/DebugModules.js` (0.1 kB gzip) and `assets/largeWorld.js` +0.2 kB gzip,
  from the commits since `bundle.json` was last recorded (p376's and p377 Phase 0's, on
  largeWorld's spike modules). Left for Phase 5's `yarn verify:baselines --update`.

## Phase 3 — streamingGrid: kit content near and far — done

D7: the far layer's real path on kit content, merged near.

1. **The kit**, in `streamingGrid.scene.json`: three geometries (a block, a slab, a post, a few
   metres each, ids `streamingGridRuin*`) and two `STANDARD` materials, cell-only (the gather
   moves them into the cells); a six-piece ruin in each cell with odd `cx` and `cz` (64 cells,
   384 meshes), each piece `merge: 'AUTO'`, `castShadow` as the beacons; the scene's `mergeGroups`
   `AUTO` entry at 32 m. The entries are written by a one-off script in the scratchpad (a seeded
   layout per cell), the JSON committed, not the script. The scene's `description`, the file
   header of `streamingGrid.ts` and the streaming `CLAUDE.md`'s test scene line say it.
2. **What it shows**, in the debug env with the Streaming and Merging tabs, flying and hovering:
   - far cells draw their ruins: far groups alive and their instances (a ruin cell's far layer
     is up to three groups: geometry and material);
   - near cells' ruins are merged (`AUTO` groups, none refused; the merging streaming warnings:
     none, as 32 divides 64);
   - the near ↔ far switch (the hover crosses a boundary every period): by eye, with the tab's
     `fadeSeconds` at 2 s to see D5's fade over the merged ruins; a z-fight that shows is noted
     and goes to p990 (D5);
   - the counters stay clean: `unitErrors`, `unfadedTakeDowns` 0, `primingStalls` as before, the
     asset releases running, the far layer's GPU memory (the ruins' materials) per cell in the
     tab.
3. **What it costs**: `yarn sbp` against its baseline (the generated data's growth in the app's
   first download), and the flight's CPU frame with and without the far ruins (a build with
   `farEntries: 'LOD_LEVELS'` in the scene, then without), WebGPU and WebGL2, noted, not gating.
4. **Baselines**: the scene runner's `streamingGrid` baseline again (`yarn verify:scenes --only
   streamingGrid --update`, the image changed), and its Hub image (`streamingGrid.hub.png`,
   the Hub tab's Save Hub image).

Exit: the above recorded under the phase; `yarn verify:scenes --only streamingGrid` passes.

**As built** (2026-11-12, sections 1-2):

- **The kit**: `streamingGridRuinBlock` (box 3 × 2 × 2), `streamingGridRuinSlab` (box 4 × 0.5 × 3)
  and `streamingGridRuinPost` (cylinder r 0.4 × 5, 8 segments); `streamingGridRuinStone` (block,
  slab) and `streamingGridRuinTimber` (post), so geometry and material go together and a ruin cell's
  far layer is exactly three groups. A ruin: three blocks (two in a row, one stacked), a leaning
  slab, a standing post and one leaning or fallen; off the cell's centre by up to 12 m and turned,
  from the cell's seed (`getCellSeed + 3`). No `appId` (the data's size). The heights come from
  `streamingGrid.ts`' `createHeightField(53)`, each piece sunk 0.35 m (a slope, the far terrain's
  coarse level); the file header says changing it leaves them floating. The scene's `mergeGroups`
  entry follows `streaming`.
- **16 ruin cells, not 64** (D7 amended in section 3, decided 2026-11-12): the cells whose `cx`
  and `cz` are each -7, -3, 1 or 5 (one in four of the odd ones on each axis), 96 meshes. Every
  scene's JSON is in the app's first download, and D7's 64 cells (384 meshes) cost +11.6 KiB gzip
  on it (`yarn sbp`, below), the initial 405.6 against its 394 KiB budget; 16 cells cost +3.4 KiB.
  The far ring still holds up to nine ruin cells, and cell (1, 1), beside the flight's row, is
  one. The layout is per cell, so the 16 are the same ruins as before (the other 48 cells' blocks
  dropped from the JSON).
- **The gather's output** (16 cells): 129 manifest meshes (33 + 96), 80 far meshes, all groups (48
  the ruins': 16 per kind, 96 instances; 32 the beacons'), none of their own; a ruin cell's near
  and far layers both list the kit's two materials and three geometries, the base none. With 64
  cells it was 417 meshes and 224 groups (sections 1-2 ran on those).
- **The data's size** (compact JSON, as the build ships it): streamingGrid's scene 20,497 →
  50,202 bytes (`__streaming` 18,450 → 47,866), `generatedAppData.json` 340,770 → 370,475, gzip
  41.1 → 45.2 KB. With 64 cells: 137,119 bytes (`meshes` 79.7 KB, about 190 bytes a piece;
  `farMeshes` 29.5 KB, about 130 a group; `cells` 23.9 KB), gzip 53.6 KB, of which the ruin
  meshes 6.2, the cells 3.5 (64 more cells' lists and their unrounded `bounds`) and the far
  groups 1.2. Rounding the ruins' positions to 10 cm and turns to 0.01 rad would have saved
  1.25 KB, the cells' bounds to the centimetre 0.55 KB.
- **What it shows** (sections 1-2, with the 64 cells) (Apple M2, Chrome headless through the dev server, debug env, 1600 × 900; a
  Playwright script reading the runtime: `rt.cells`, `rt.stats`, the root scene's ruin
  `InstancedMesh`es, the `AUTO` groups of ruin material, `getMergeDebugStats`; then the tab's
  monitors). WebGPU a 73 s flight (two crossings), WebGL2 40 s:
  - far: the ruin far groups alive are always three per ruin cell at `FAR`, two instances each
    (30-96 groups as the flight moves; the tab's "224 far meshes: 224 groups (416 instances), 0 of
    their own");
  - near: every ruin `AUTO` group built (4-30 groups, 12-66 members), no refusal, no merging
    streaming warning; the console only Rapier's deprecated init warning (known);
  - the counters: `unitErrors`, `lateResults`, `loadsCancelled`, `unfadedTakeDowns`,
    `primingStalls` and `fadesReversed` 0 on both; the cell releases run (710 in the WebGPU flight)
    but free nothing (`assetsReleased` 0): the kit's assets (as the beacons') are held by many
    tracked cells, so they count under the scene and stay while any holds them (the Grounding's
    Assets and memory). So the tab's GPU memory is near 0 B, far 0 B, kept 787.5 KB (the terrain
    blocks): the far layer holds nothing per cell;
  - **the fade** (D5): the tab shows `fadeSeconds` but has no control for it, so the script set
    `rt.settings.fadeSeconds = 2` (read live). The hover doesn't switch a cell's level (its ±6 m
    stays inside the 16 m margin; it moves the focus cell only), so the switch was forced with the
    focus override (the tab's Freeze focus): at cell (-1, 1) the ruin cell (1, 1) is `NEARBY`, at
    (-2, 1) `FAR`; the camera still, 20 m from that ruin. Near → far and back, the near layer's
    fade out and the far layer's fade in ran together and ended by 2.4 s; in frames 0.4-1.9 s into
    each the ruin looks unchanged on both backends (no dither, no z-fight: the merged group draws
    whole, the far group dithers in or out on the same surfaces), while the cell's crates dither
    and its rocks turn to impostors. Nothing for p990.

**As built** (2026-11-12, section 3):

- **`yarn sbp`** (the app profile, gzip): with the 64 cells the initial 393.7 → 405.6 KiB
  (`assets/index.js` 389.5 → 401.4, the `app` group 14.4 → 26.0), three budgets failed (initial
  394, `assets/index.js` 390, `app` 15 KiB), so `yarn build` would have failed: hence the 16
  cells (above). With them: initial 397.4 KiB, `assets/index.js` 393.2, `app` 18.0; the budgets
  raised in `sbp.config.ts` with p377's note: initial 394 → 398, `assets/index.js` 390 → 394,
  `app` 15 → 19 KiB. The report's other diffs (`assets/DebugModules.js` new, `assets/largeWorld.js`
  +0.2 KiB) are Phase 2's known ones, for Phase 5's `yarn verify:baselines --update`. The app was
  0.3 KiB under its initial budget before this phase, so any ruins needed a raise. p990's Smallest
  build gains "Every scene's JSON is in the first download" (a scene's data loaded with it).
- **The flight's CPU frame** with the far ruins (`farEntries` `'ALL'`, 80 far meshes) and without
  (`'LOD_LEVELS'` in the scene JSON, 32: the beacons' only), 16 ruin cells. Apple M2, Chrome
  headless, 1600 × 900, prod test mode through the dev server (not a build: the dev server's
  modules, unminified), the test bridge's fixed 1/60 s frame, so each run is the same 2,240
  frames: one crossing, -560 → 560 m at 30 m/s; the first 120 left out. The CPU frame is the first
  `MAIN` system to the first `LATE_MAIN` one, the submit from the last `APP_RENDER_SYNC` one
  (Phase 0's probe). Three runs a case and backend, the cases alternating (a script in the
  scratchpad switching the JSON and gathering; the JSON restored after). Medians a run, ms:

  | | WebGPU CPU | WebGPU submit | WebGL2 CPU | WebGL2 submit | Draws (med / max) |
  | --- | --- | --- | --- | --- | --- |
  | far ruins (`ALL`) | 2.15 / 2.88 / 2.89 | 1.61 / 2.16 / 2.14 | 1.53 / 2.89 / 3.28 | 1.21 / 2.14 / 2.60 | 154 / 235 |
  | none (`LOD_LEVELS`) | 1.81 / 2.71 / 1.90 | 1.41 / 2.03 / 1.48 | 3.06 / 3.13 / 2.93 | 2.33 / 2.35 / 2.19 | 151 / 229 |

  The p99 5.3-6.3 ms in every run, no frame over 33 ms, no error. The far ruins add 3 draws at
  the median and 6 at most (the flight looks down along its row, so few far ruin cells are in the
  frustum; three culls a far group by its bounds): at Phase 0's 2.1-2.8 µs a draw, about 0.01 ms,
  well inside the runs' spread (a run's median moves 1-1.5 ms between runs of one case, both
  ways: Chrome's frame pacing, not the content). So no cost measurable at this size; not gating.

**As built** (2026-11-12, section 4):

- **The scene runner**: `yarn verify:scenes --only streamingGrid --update` recorded all five
  configurations (`workerSab`, `workerMsg`, `mainThread`, `prodTest`, `debugger`) on the same hash
  as before, `811c9dc5` (no bodies; its snapshot is skipped, so the ruins change no recorded
  figure but the debugger's shots, which are unstable by its settings); then the plain run: 5
  passed. That's the exit.
- **The Hub image** (`streamingGrid.hub.png`, 1600 × 1000, the Hub tab's `saveHubImageAsync`
  through the dev files, called by a script): a still camera at (68, 11, 72) looking towards
  (180, 0, 165), the cells settled (loaded, primed, no fade running): the merged ruin of cell
  (1, 1) in front, a beacon near and three far, the far rings to the skyline. It was the flight's
  start before (no ruin in view).

## Phase 4 — The Hub: larger cells for a large far field

D8, on the Hub's Mesh merging page (`hub/pages/features/mesh-merging/guide.md`); nothing to build.

1. **AUTO** (its "Pick the cell size" paragraph): larger cells for far content that doesn't stream,
   pointing at the new subsection.
2. **A new "### A large far field"** under When to merge, after Measured: Phase 0's figures (400
   sites over a kilometre, 20,000 pieces: 32 m against 64, 128 and 256 m, the CPU frame saved on
   both backends, the rebuild still one main-thread frame; at 150 sites under 1 ms), what a group
   drawn whole costs and why it doesn't here (far content is mostly in view), and what larger
   cells don't reach: every hidden member still walked by three's scene update (p378, named as
   a plan, `repo:` link).
3. **Streaming**: in a streaming scene the `AUTO` cell still divides the streaming cell, and the far
   rings draw the kit's far entries ([streaming](hub:features/streaming#far-representations)):
   so larger cells are for a world that doesn't stream.
4. `aek:tags` gain `cell size`, `far field`; `yarn hub:build`.

## Phase 5 — Verification

1. `yarn test`, `yarn lint`, both `tsc`, `yarn verify:baselines` (the API's `entries`, the bundle:
   `StreamingDataContent`'s chunk; the docs ratchet: no new undocumented export), `yarn sbp`
   (the streaming group's 4 KiB budget, the app's first download with Phase 3's data), `yarn
   verify:scenes` (every scene; `streamingGrid`'s baseline is Phase 3's, the rest unchanged),
   `yarn build`.
2. **The second machine** (D9, open question 4): on the WSL2 machine's Windows Chrome on its own GPU
   (`devTools/verify/CLAUDE.md`), `npx tsx devTools/bench/hlodSpike.ts --step draws --field 400
   --cases members@32,instanced@256`, both backends, 3 runs. The CPU frame saved and the GPU
   against Phase 0's M2 figures, into Phase 0's Results ("A second machine") and open question 4.
   WebGPU's GPU figure doesn't decide there either unless that GPU shows it doesn't overlap (the
   `floor` case added to the run tells: `--cases floor,members@32,instanced@256`).
3. `streamingGrid` on the same machine, flying, WebGPU and WebGL2: the frame and the priming's
   paced first draws with the far ruins (WebGL2's `maxShownObjectsPerFrame`), noted.

Exit: every check passes, the figures recorded; what fails goes back to its phase.

## Phase 6 — Hub, versions, done

1. **The Hub's streaming page** (`hub/pages/features/streaming/guide.md`, Far representations): a
   JSON mesh without `lod` is its own far entry when it groups, `farEntries`, the two ways out
   (D2), the near ↔ far fade over merged content (D5), and the test scene's ruins; its "From the
   scene JSON" list and the test scene's paragraph. `yarn hub:build`.
2. **CLAUDE files**: the streaming one's JSON content, Limits and test scene (each phase's,
   checked again), the merging one's Streaming bullet (a merged near layer's far layer: the far
   entries); `readme.md` only if its streaming line names far stand-ins.
3. **Versions** (D10): engine minor, app minor in `package.json`; a `CHANGELOG.md` entry with Engine
   (far entries for kit meshes, `farEntries`, `entries` and the deprecated `instances`, the `merge`
   fix), App (`streamingGrid`'s ruins; largeWorld's far field and the spike's debug modules from
   Phase 0) and Project (the HLOD bench's `draws` step); `yarn checkVersions --against main`.
4. **Done**: Status `implemented (Phases 0-6)`, `git mv` to `_DONE_p377_…`, the references: p370's
   Blocks, tier table and Branches and PRs, p378's Related, p376's mentions, the CLAUDE files.

## What was known before Phase 0 (way 3, not built)

Written with Phase 0, for the cell proxy had it paid; kept as the record of what a build-time
proxy would take (D6: not built). The far entries' own grounding is above.

- **Today's far layer** (p353 D7): a `FAR` cell draws only its far entries, and a JSON mesh gets
  one only with explicit `lod` levels (its coarsest; none for `AUTO`, a cull or code content). So
  a streamed cell's kit content draws nothing from `FAR` today: for a streaming scene the far
  content is way 3's or the far entries', whatever Phase 0 finds for ways 1 and 2.
- **Build time, not runtime** (p376 §1, D1): a `FAR` cell has no near layer loaded, so its members
  don't exist to merge, and a merge group doesn't load, unload or fade with a cell. A cell proxy is
  built when the data is gathered, as p353's far entries are, and loaded by the far layer as a
  cell-only asset.
- **What the gather needs:** the cell's near meshes' geometries in Node. JSON primitives, `MERGED`
  geometries (p371) and imported GLBs can be read there (`devTools/assetPipeline/gltf.ts` already
  merges at build time, p371); code-made geometries can't, so code content keeps registering its
  own far content (`registerStreamingCellContent` with `loadedAt: 'FAR'`).
- **The simplifier, if a proxy is simplified at all:** p347's `simplifyLodChain` already runs at
  build time (`devTools/assetPipeline/lodChains.ts`). Kit content needs `permissive` (a box's faces
  share no vertices) and a maxError near 0.2; meshoptimizer's `Prune` gained nothing measurable
  (p376 §3, step 1).
- **Fades:** a far layer's entities fade with p353's content fade (`StreamingFades.ts`), so the
  switch between a cell's members and its proxy needs nothing new.
- **Terrain** (p376's open question 2 in its stub): a block plus its static dressing as one far
  proxy, and how that meets terrain LOD (p350 §9 Q2; crack-free stitching unplanned). Waits for
  p306.

## Open questions

1. One proxy per cell, or per cell and material (palettes, p374, would make it one)? Phase 0 step
   5 measures it, when way 3 pays. (Closed: way 3 didn't pay over the far entries; step 5 not
   run, D6.)
2. The output format, if way 3 pays: a GLB per cell from the asset pipeline, or geometry data in
   the manifest? (Closed with 1: no proxy is built.)
3. Code content's far proxies: a runtime path that merges a cell's code content once while it's
   near and keeps the proxy for `FAR` (memory held past the near layer's unload)? (Closed with 1:
   code content keeps its own `FAR` units, D6.)
4. Does the draws' cost hold on other hardware (a discrete GPU, a phone)? p376 measured one
   machine, where the frame was bound by its draws and fill, not its triangles. Phase 0 runs the
   reference and each way's best on a second machine when one is at hand. (Phase 0: not run.
   Phase 5 runs the reference and `instanced@256` on the WSL2 machine, not gating: D9.)
5. The hidden members' scene graph walk: should Phase 0 step 1 find it a real share of the frame,
   taking a baked member's mesh out of the scene graph (as p375 does for a batched member) helps
   every merged scene, not only far content. A merging change of its own: here, or a follow-up in
   `p990_follow-ups-from-done-plans.md`? (Phase 0: a real share, 60 % of the far field's CPU
   cost at 400 sites, the walk alone 3.6-4.9 ms of it. Decided: a plan of its own in the epic,
   `p378_baked-members-out-of-the-scene-graph.md`, with its own branch.)

## Branches and PRs

Decided 2026-11-12, when it stopped being a stub. Its own branch, `p377_hlod-streaming-cell-proxies`,
from p376's branch (Phase 0 builds on p376's spike tools, which aren't on `main` until p376's PR
merges), rebased onto `main` once p376's PR merges, and merged into `main`. Phase 0 changes only
app debug modules and dev tools: if nothing pays, the branch ends with the results and an app
patch, as p376's did; the bumps of the later phases are decided with them. The PR opens after the
last phase, when asked.

Updated after Phase 0 (2026-11-12): something paid, so the branch carries Phases 1-6 too, with an
engine minor and an app minor (D10; Project for Phase 0's bench). p378 (open question 5) isn't on
this branch: its own branch from `main` (the p370 epic's Branches and PRs), after p377's merge or
beside it (they touch other files: the gather and streaming here, merging there).

Updated before Phase 1 (2026-11-12): p376 merged (PR #86, versioned engine 6.8.1 / app 1.23.1 on
`main`), and `main` was merged into this branch instead of a rebase. So the verification and the
version check (`yarn checkVersions --against main`) run against `main` with p376 in it, and
Phase 6 bumps from there: engine 6.9.0, app 1.24.0.
