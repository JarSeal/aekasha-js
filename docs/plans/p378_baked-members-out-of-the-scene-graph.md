Status: draft | stub (proposed 2026-11-12 from p377's Phase 0, its open question 5)
Category: Merging, Performance
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 3.3)
Related: p377_hlod-streaming-cell-proxies.md (Phase 0 measured the cost; its far field, `?hlodField`, and bench are this plan's measurement), \_DONE_p375_batched-mesh-batches.md (Phase 2 S1 took a batched member's mesh out of the scene graph), \_DONE_p372_mesh-merge-groups.md (the baked groups), \_DONE_p373_merge-debug-and-member-editing.md (edit sessions, "Show unmerged", picking), \_DONE_p353_macro-streaming-grid.md (a streamed member's priming and fades)

# Baked Merge Members Out of the Scene Graph

A baked merge member's own mesh stays in the scene graph, hidden (`TAG_MERGED`), while its group's
mesh draws it, and three walks it on every render. p377's Phase 0 found that walk to be a large
share of what merged content costs: this plan takes it away, for every merged scene. A stub: its
grounding, decisions and phases are written when it starts.

## Why (p377 Phase 0, Apple M2, Chrome)

- p377's far field at 400 sites (20,808 hidden members, 22,741 objects in the scene graph): of the
  field's 8-11 ms of CPU a frame, about 40 % is its draws and **60 % its hidden members** (the
  reference against the same draws without members: 5.0-5.5 ms on WebGPU, 6.3-7.7 ms on WebGL2).
- **The walk**: `scene.updateMatrixWorld()` runs twice a frame (the scene pass and the AO
  pre-pass), 3.6-4.9 ms at 400 sites, **80-107 ns an object a walk**. The rest of the members'
  cost isn't split: the systems 0.9-1.7 ms more, and 0.5-2 ms of the render submit.
- Every merged scene pays it in proportion to its members: largeWorld's 409 about 0.07-0.09 ms a
  frame, a large kit-built world several milliseconds. Larger `AUTO` cells and a cull (p377) cut
  the draws, not this.

## What's known

- **p375 Phase 2 S1 does it for a batched member** (`MergeBatchFront.ts`):
  `detachBatchedMemberMesh` (`TAG_MERGED`'s add hook, a member with an instance) calls
  `removeFromParent` and remembers the mesh in a `WeakSet`; `reattachMemberMesh` (the remove hook:
  a leave, a dissolve, "Show unmerged") puts it back under the root scene. Its readers compose its
  pose or update its matrix themselves (the batch sync, compaction, `syncMemberPose`, the overlay,
  LOD's `measureEntity`, frustum culling's `getWorldPosition`). Measured: 0.26 ms less render
  submit per 2,000 members on WebGL2.
- **A baked member differs.** `BATCHED` refuses a mesh not directly under the root scene, so
  reattaching to the root is right there; a baked member may have another parent (an import's
  pieces), so the parent (and the place among its children) has to be kept. A baked group's
  hidden members are hit by a root-scene raycast today, next to the group's mesh (the merging
  `CLAUDE.md`'s Picking); out of the graph they aren't, which changes what a raycast returns.
- **Its readers** (to check one by one): the builds and the in-place writes read the `TRANSFORM`
  (`syncMemberPose`), not the mesh's matrix; the moved-member check (`mergeMoveCheckSystem`,
  debug) compares the member's world matrix with `_bakedMatrix`; edit sessions and "Show
  unmerged" take `TAG_MERGED` away (the remove hook would put the mesh back); a `DISABLED`
  member keeps `TAG_MERGED` (collapsed in place); streaming's priming compiles held objects
  (`preWarmObjectsAsync`) and fades a near layer's meshes, a merged member's own among them;
  `disposeMesh` takes a mesh from no parent.
- **Another way: stay in the graph, stop the work.** three r187's `updateMatrixWorld` calls each
  child's, which with `matrixAutoUpdate` on composes its matrix (`updateMatrix`) and multiplies
  its world matrix every walk. With `matrixAutoUpdate` off while merged, a hidden member costs the
  call and two flag checks, keeps its parent and its raycast hits, and its readers update its
  matrix themselves as detached ones do; the render's projection walk already stops at
  `visible === false`. Whether the call alone is small enough at 20,000 objects is a measurement.
- **The measurement** is p377's: `devTools/bench/hlodSpike.ts --step draws` on largeWorld's far
  field (`?hlodField=<sites>`), `members@32` against `proxy@32` (the same draws, no members),
  with `cpuSplit` (the walk timed on its own, the scene graph's objects, hidden ones apart). Its
  tools are on p376's and p377's branches until their PRs merge.

## Open questions

1. Out of the graph (p375's way, the parent kept) or in it with `matrixAutoUpdate` off: which
   saves more of the walk, and which breaks fewer readers? Both measured at 400 and 150 sites.
2. The raycast: a baked group's hidden members stop being hit when detached. Is anything relying
   on hitting them (the debugger, the app), and should `getMergeMemberAtFace` be the only way?
3. The systems' 0.9-1.7 ms and the submit's unsplit 0.5-2 ms of the members' cost: what are they
   (the members' `TRANSFORM` sync, frustum culling's walk over them, three's render lists)? The
   first phase splits them before deciding how far the plan reaches.
4. One mechanism for both modes: p375's batched detach generalized (the parent kept), or each
   mode its own?

## Branches and PRs

Its own branch from `main` (proposed 2026-11-12, in the p370 epic's Branches and PRs), after p376's
and p377's PRs merge (their bench and field are the measurement), merged into `main` with an engine
minor (a baked group's members change what a raycast hits) or patch, decided with its phases. The
PR opens after its last phase, when asked.
