Status: stub — not-implemented (rewritten 2026-11-12 around draws, after p376's Phase 0)
Category: Merging, LOD, Streaming
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 3.2)
Related: p376_hlod-merged-cluster-proxies.md (not adopted: its Phase 0's measurements and spike tools), \_DONE_p353_macro-streaming-grid.md (the far layer and its JSON far entries), p306_terrain-blocks-and-procedural-terrain-meshes.md (a block with its dressing as one far proxy), \_DONE_p347_lod-chain-generation.md (the build-time simplifier), \_DONE_p371_geometry-merging.md (the build-time GLB merge), \_DONE_p372_mesh-merge-groups.md (`AUTO` cells, the groups' cull)

# HLOD: Streaming Cell Proxies — Stub

**This is a stub.** Split from p376 (2026-11-12). p376's Phase 0 then measured what far merged
content costs, and its gate failed: proxies cut triangles without saving GPU time, and the cost
was the draws. So this stub now starts from draws, not triangles. It records the target and what's
known, so the real plan can be written once its first measurement says which way pays.

## What p376 measured (Apple M2, Chrome; p376 §3 Results)

- largeWorld with a far field of ruin sites 200 m-1 km out (`?hlodField=<sites>`), merged `AUTO`
  in 32 m cells: 150 sites made 743 groups (149,392 triangles), 400 sites 1,838 (387,048).
- Simplified proxies (`permissive`, maxError 0.2) cut 39-50 % of the groups' triangles in view at
  `AUTO`'s pick, up to 289,000 triangles a frame, and **no GPU time on WebGL2** in any view; on
  WebGPU the scene passes saved 0.9-1.4 ms in one view of three.
- **The draws are the cost**: one per group, 1,245-1,605 draws and 12-17 ms of CPU a frame at 400
  sites, against 560-650 draws and 4.7 ms at 150. A proxy level swaps a group's index, not its draw.
- The tools to measure with are on p376's branch: `devTools/bench/hlodSpike.ts` (`--step frames`,
  `--field`, the views, both backends, the WebGPU scene passes) and the probe
  (`src/app/shared/_dbg__hlodSpike.ts`). WebGPU's frame figure overstates (passes overlap on a
  tile-based GPU, `docs/issues/gpu-timer-webgpu-frame-sum.md`): compare per pass there.

## Goal

A streaming cell's (or a far region's) static content drawn, while far, in **few draws**: p353's
far layer showing a cell's content as one mesh per material (or per palette, p374), not as the
cell's groups one draw each. A simplified copy is secondary: it pays only where the frame is bound
by its triangles, which p376 didn't find.

## First: which way to fewer draws (a Phase 0)

Measure on p376's far field before building anything, each against today's 32 m groups:

1. **A cull**: groups hidden below a screen size (p348's `cullScreenSize` on the group entity, no
   levels). The draws a far view loses, and what it looks like.
2. **Larger `AUTO` cells for far content**: the same field at 64, 128 and 256 m cells (a mesh's
   `merge.cellSize`, no new code). Fewer, larger groups: fewer draws, but each culled whole (more
   triangles drawn off screen) and a longer rebuild when a member changes.
3. **A cell's content as one mesh** (this plan's proxy, at full detail): the draws and CPU of one
   merged mesh per material per streaming cell, built at runtime from the cell's groups for the
   measurement.

The result says whether this plan is a build-time cell proxy (3), a setting and a recommendation
(2), a group cull without levels (1), or several of them.

## What's known

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

1. One proxy per cell, or per cell and material (palettes, p374, would make it one)?
2. The output format: a GLB per cell from the asset pipeline, or geometry data in the manifest?
3. Code content's far proxies: a runtime path that merges a cell's code content once while it's
   near and keeps the proxy for `FAR` (memory held past the near layer's unload)?
4. Does the draws' cost hold on other hardware (a discrete GPU, a phone)? p376 measured one
   machine, where the frame was bound by its draws and fill, not its triangles.
