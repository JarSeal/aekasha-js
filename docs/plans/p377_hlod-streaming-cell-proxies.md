Status: in progress | Phase 0 implemented (2026-11-12; the rest is written from its Results once reviewed)
Category: Merging, LOD, Streaming
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 3.2)
Related: p376_hlod-merged-cluster-proxies.md (not adopted: its Phase 0's measurements and spike tools), \_DONE_p353_macro-streaming-grid.md (the far layer and its JSON far entries), p306_terrain-blocks-and-procedural-terrain-meshes.md (a block with its dressing as one far proxy), \_DONE_p347_lod-chain-generation.md (the build-time simplifier), \_DONE_p371_geometry-merging.md (the build-time GLB merge), \_DONE_p372_mesh-merge-groups.md (`AUTO` cells, the groups' cull), \_DONE_p374_multi-material-merging.md (palettes: one draw for several materials), \_DONE_p375_batched-mesh-batches.md (a batched member's mesh out of the scene graph)

# HLOD: Streaming Cell Proxies

Far static content drawn in few draws. Split from p376 (2026-11-12), whose Phase 0 measured what
far merged content costs and failed its gate: simplified proxies cut triangles without saving GPU
time, and the CPU frame followed the draws, one per merge group. So this plan starts from draws,
not triangles.

**It is measurement-first.** Four ways to fewer draws are on the table (a group cull, larger
`AUTO` cells, a cell's content as one mesh, today's far entries for kit meshes), and Phase 0
measures them on p376's far field before any is built. Only Phase 0 is written: its result says
which way (or ways) this plan builds, and the grounding, decisions and phases are written from it.
None paying closes the plan as p376 was closed.

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
by its triangles, which p376 didn't find.

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

## What's known (for way 3 and the far entries)

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
   5 measures it, when way 3 pays. (Phase 0: way 3 didn't pay over the far entries; not run.)
2. The output format, if way 3 pays: a GLB per cell from the asset pipeline, or geometry data in
   the manifest?
3. Code content's far proxies: a runtime path that merges a cell's code content once while it's
   near and keeps the proxy for `FAR` (memory held past the near layer's unload)?
4. Does the draws' cost hold on other hardware (a discrete GPU, a phone)? p376 measured one
   machine, where the frame was bound by its draws and fill, not its triangles. Phase 0 runs the
   reference and each way's best on a second machine when one is at hand. (Phase 0: not run;
   still open.)
5. The hidden members' scene graph walk: should Phase 0 step 1 find it a real share of the frame,
   taking a baked member's mesh out of the scene graph (as p375 does for a batched member) helps
   every merged scene, not only far content. A merging change of its own: here, or a follow-up in
   `p990_follow-ups-from-done-plans.md`? (Phase 0: a real share, 60 % of the far field's CPU
   cost at 400 sites, the walk alone 3.6-4.9 ms of it; where it goes is still to decide.)

## Branches and PRs

Decided 2026-11-12, when it stopped being a stub. Its own branch, `p377_hlod-streaming-cell-proxies`,
from p376's branch (Phase 0 builds on p376's spike tools, which aren't on `main` until p376's PR
merges), rebased onto `main` once p376's PR merges, and merged into `main`. Phase 0 changes only
app debug modules and dev tools: if nothing pays, the branch ends with the results and an app
patch, as p376's did; the bumps of the later phases are decided with them. The PR opens after the
last phase, when asked.
