Status: draft — not-implemented (Phase 0 written 2026-11-12; the rest is written from its results)
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

## Phase 0 — Which way to fewer draws

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
   5 measures it, when way 3 pays.
2. The output format, if way 3 pays: a GLB per cell from the asset pipeline, or geometry data in
   the manifest?
3. Code content's far proxies: a runtime path that merges a cell's code content once while it's
   near and keeps the proxy for `FAR` (memory held past the near layer's unload)?
4. Does the draws' cost hold on other hardware (a discrete GPU, a phone)? p376 measured one
   machine, where the frame was bound by its draws and fill, not its triangles. Phase 0 runs the
   reference and each way's best on a second machine when one is at hand.
5. The hidden members' scene graph walk: should Phase 0 step 1 find it a real share of the frame,
   taking a baked member's mesh out of the scene graph (as p375 does for a batched member) helps
   every merged scene, not only far content. A merging change of its own: here, or a follow-up in
   `p990_follow-ups-from-done-plans.md`?

## Branches and PRs

Decided 2026-11-12, when it stopped being a stub. Its own branch, `p377_hlod-streaming-cell-proxies`,
from p376's branch (Phase 0 builds on p376's spike tools, which aren't on `main` until p376's PR
merges), rebased onto `main` once p376's PR merges, and merged into `main`. Phase 0 changes only
app debug modules and dev tools: if nothing pays, the branch ends with the results and an app
patch, as p376's did; the bumps of the later phases are decided with them. The PR opens after the
last phase, when asked.
