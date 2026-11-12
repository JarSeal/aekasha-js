Status: stub — not-implemented
Category: Merging, LOD, Streaming
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 3.2)
Blocked by: p376_hlod-merged-cluster-proxies.md
Related: \_DONE_p353_macro-streaming-grid.md (the far layer and its JSON far entries), p306_terrain-blocks-and-procedural-terrain-meshes.md (a block with its dressing as one far proxy), \_DONE_p347_lod-chain-generation.md (the build-time simplifier), \_DONE_p371_geometry-merging.md (the build-time GLB merge)

# HLOD: Streaming Cell Proxies — Stub

**This is a stub.** Split from p376 (2026-11-12), which does a merge group's own proxies at runtime.
It records the target and what's known, so the real plan can be written once p376 has shipped
and its Phase 0 numbers show what proxies save.

## Goal

A streaming cell's static content drawn, while the cell is `FAR`, as one simplified proxy mesh
per material (or per palette): p353's far layer showing the cell's merged content, simplified as a
whole, instead of only the meshes that have explicit `lod` levels (p353 D7's far entries).

## What's known

- **Build time, not runtime** (p376 §1, D1): a `FAR` cell has no near layer loaded, so its members
  don't exist to merge, and a merge group doesn't load, unload or fade with a cell. The proxy is
  built when the data is gathered, as p353's far entries are, and loaded by the far layer as a
  cell-only asset.
- **What the gather needs:** the cell's near meshes' geometries in Node. JSON primitives, `MERGED`
  geometries (p371) and imported GLBs can be read there (`devTools/assetPipeline/gltf.ts` already
  merges at build time, p371); code-made geometries can't, so code content keeps registering its
  own far content (`registerStreamingCellContent` with `loadedAt: 'FAR'`).
- **The simplifier:** p347's `simplifyLodChain` already runs at build time
  (`devTools/assetPipeline/lodChains.ts`); p376's `prune` is what clusters need.
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
