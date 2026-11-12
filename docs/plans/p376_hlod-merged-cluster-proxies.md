Status: draft | not-implemented (Phase 0, the measurements, gates the rest)
Category: Merging, LOD
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 3.1)
Blocks: p377_hlod-streaming-cell-proxies.md
Related: \_DONE_p347_lod-chain-generation.md (the simplifier that makes the proxies), \_DONE_p348_ecs-lod-selection.md (the selection, `AUTO`), \_DONE_p351_impostor-billboard-lod.md (the plain-mesh fade), \_DONE_p372_mesh-merge-groups.md (the groups, the in-place writes), \_DONE_p373_merge-debug-and-member-editing.md (edit sessions, the Merging tab), \_DONE_p374_multi-material-merging.md (palette groups), \_DONE_p375_batched-mesh-batches.md (`BATCHED` groups have per-member LOD already), \_DONE_p353_macro-streaming-grid.md (why cell proxies are p377's)

# HLOD: Merged Cluster Proxies

A `BAKED` merge group drawn from far away as a simplified copy of its merged geometry (a proxy),
and hidden past a cull size: hierarchical LOD for merged static content. The group entity is the
LOD unit, as p372 decided; its members stay entities, and removing, disabling or moving one shows
in its proxies at once, without a rebuild.

**It is measurement-gated.** No plan so far measured what distant merged content costs: p372's
largeWorld table counts draws (686 → 76 a frame), and its triangles are the same merged and
dissolved. Phase 0 measures how far merged content simplifies and what drawing the proxies saves,
and the rest is built only if it pays (§3).

Written 2026-11-12 from the stub, after p372-p375 had shipped; the stub's claims were checked
against the code (§1), and several had moved.

---

## 1. Grounding (checked against the code, 2026-11-12)

- **A group's mesh** (`features/merging/MergeBuild.ts`): the first build makes a `THREE.Mesh` on
  the group entity (`createGroupMesh`: `OBJECT3D`, `TAG_IS_MESH`, `userData.entityId`, the
  material's ref), centred on its members' bounds. Each build registers its geometry as
  `mergeGroup:<id>` (`#<rebuilds>` while something still holds the previous one) and **swaps
  `mesh.geometry` in place** (`applyBuild`, lines 169-171), releasing the previous geometry's ref.
  `mergeGroupBuildSystem` runs at `APP_RENDER_SYNC_ORDER.MERGE_BUILD` (0.5), before
  `LOD_SELECTION` (-1.5) in the same frame.
- **The merged geometry is indexed**, its `userData.mergeParts` each part's vertex and index
  ranges. The in-place paths (`MergeRanges.ts`) write the base only: `rewritePartVertices`
  (positions, normals, tangents), `flipPartWinding`, `collapsePartIndex` and `restorePartIndex`
  (the index, restored from the member's own geometry).
- **The LOD pins level 0 at its add** (`features/lod/LodSystem.ts`, `resolveLevels`): an omitted
  level 0 geometry is `mesh.geometry` at that moment, and the component holds a ref on every
  level. A geometry swapped under it comes back at the next level-0 apply, kept alive by that ref.
  The radius is level 0's `getConservativeGeometryRadius`, measured at the add
  (`setMeshLodBounds`); `refreshLodBounds` is `lod()`'s, for an `InstancedMesh`.
- **`AUTO` doesn't make a chain** (`features/lod/LodAuto.ts`, `resolveAutoLod`): it waits for a
  chain that's requested or pending and otherwise warns and sets nothing. Chains come from an
  import's `lodChain` or `generateLodChain`, both `lod()`'s code, which `merging()` can't import
  (p370 §13). `setMeshLod(…, 'AUTO')` is async; with explicit levels it's synchronous.
- **A chain's levels share the base's vertex buffers** (`LodChains.ts`, unless
  `compactVertices`): only their index is their own. So an in-place vertex write moves every level
  too, while an index write (a collapse) reaches only the base. The chain is released with its
  base (`onGeometryDeleted`).
- **The simplifier** (`LodSimplify.ts`, meshoptimizer 1.1.1) uses `simplify` /
  `simplifyWithAttributes` with `LockBorder` and `Permissive` as options, never `simplifySloppy`.
  Edge collapses never join disconnected pieces, so every triangle of a level lies in one member's
  vertex range. Very low-poly pieces don't simplify (`features/lod/CLAUDE.md`: "a chain without
  levels warns"), and merged content is mostly such pieces (ruins, kit parts, boxes). meshoptimizer
  1.1.1 has a `Prune` flag (it removes disconnected parts below the target error) that
  `LodChainOptions` doesn't expose.
- **Streaming** (`features/merging/CLAUDE.md`, Streaming): a group doesn't load, unload, prime or
  fade with a cell, an `AUTO` group in a streamed cell collapses its members when the cell goes,
  and an explicit group across cells only warns. A `FAR` cell has no near layer loaded, so nothing
  to merge at runtime. No app scene both streams and merges.
- **`BATCHED` groups** (p375) draw their members' own LODs; HLOD is for `BAKED` groups.
  `getMergeRefusal` still refuses a `LOD` on a `BAKED` member, which stays.

## 2. Decisions

- **D1 Scope: group proxies only.** A `BAKED` group (palette groups included) gets proxy levels
  and an optional cull. Out of scope: a streaming cell's proxy (p377: built at build time, since a
  `FAR` cell's members aren't loaded; the stub's open question 1 for cells), the terrain case
  (p377, after p306), an impostor as a group's last level, and cheaper proxy materials (no normal
  map, baked albedo; §6).
- **D2 Runtime, per build** (the stub's open question 1, for groups): the members exist at
  runtime, so the chain is generated from each build's geometry, on the worker by
  `AppConfig.assets.simplifyWorkerTarget`. **A build of a group with `lod` is applied once its
  levels are resolved**: the group keeps drawing its previous geometry and levels meanwhile (new
  members on their own, as during a worker build), so a rebuild never pops a proxy back to full
  detail or a culled group into view. The scene step awaits the chains like the worker builds.
- **D3 The seam: the chain through `AUTO`, the levels before the apply.**
  - Public: `LodAutoDef.chain?: LodChainOptions | true`. An `AUTO` LOD whose geometry has no chain
    (none requested or pending) generates one with these options, instead of warning. Useful for
    any geometry made in code, not only groups.
  - Kernel, `@internal`: `resolveAutoLodAsync(geometry, auto, label)` in `kernel/mesh/Mesh.ts`, next
    to `setAutoLodResolverLoader`, returning the resolved `LodDef` (explicit levels) or null.
    `merging()` awaits it before the apply, then calls `setMeshLod(groupEntityId, def)`, which is
    synchronous, so that frame's selection already picks the group's level. No `lod()` import.
  - Without `lod()`: one warning (the existing `AUTO` one), and the group draws at full detail.
- **D4 `prune`**: `LodChainOptions.prune` (meshoptimizer's `Prune` flag), default false; a
  group's chain defaults to true (Phase 0 sets the group defaults). The resolved options record
  `prune` only when it's true, so the asset pipeline's cache keys and every prebuilt chain stay
  valid.
- **D5 The proxies keep the part table.** A group's chain never compacts vertices (its levels share
  the base's buffers). When the levels resolve, each level's index is reordered by part (a
  triangle's part is found from its first vertex by a binary search of `mergeParts`'
  `vertexStart`) and gets its own ranges (`userData.mergeParts`-shaped, the same `vertexStart`,
  its own `indexStart` and `indexCount`), plus a copy of its index as simplified. Then every
  in-place index write reaches the levels too: `collapsePartIndex` on each level, `flipPartWinding`
  on each level, and `restorePartIndex` for a level from its copy (the member's own geometry isn't
  what the level drew). The stub's "proxy rebuilt on edit, debounced" isn't needed:
  - a move (`updateMergeMember`, an edit session's end) writes the shared vertices, so the proxies
    follow;
  - a remove, a disable or an edit session's begin collapses the member in every level, so a
    removed member is never drawn far away;
  - a rebuild (a vertex count change, compaction, `rebuildMergeGroup`) makes a new chain (D2).
  The bounds: `growMergedBounds` grows each level's box and sphere too (three culls the drawn
  geometry by its own sphere), and the LOD's `radius` is set again from level 0 when it grew.
- **D6 The setting.** `MergeGroupSettings.lod?: MergeGroupLod`, where `MergeGroupLod` is `'AUTO'`
  or `{ maxPixelError?, cullScreenSize?, hysteresis?, bias?, fadeSeconds?, chain? }` (`LodAutoDef`'s
  fields; `chain` over the group defaults). It goes on `createMergeGroup`, a scene's group entry,
  and the scene's `AUTO` entry (every `AUTO` group of the scene; not per mesh, so it isn't in
  `AUTO`'s key). With `BATCHED`, `createMergeGroup` throws and the schema refuses it. Default: none.
- **D7 Fades** are the plain-mesh fades (p351 Phase 2): a level change draws the outgoing level
  through a temporary child copy of the group mesh, a cull fades the mesh itself, and the LOD's add
  hook dithers the group's material (`enableLodDither`; a palette group's merge material too).
  A build's new LOD is a first apply, which never fades: the switch between the old geometry and
  the new is the rebuild's, unfaded, as it is today.

## 3. Phase 0 — Measurements and gate

No engine change. Spike code: a debug module for largeWorld (`src/app/scenes/largeWorld/_dbg__largeWorld.ts`,
`window.__aekHlod`) and a bench (`devTools/bench/hlodSpike.ts`, on `batchedMeshSpike.ts`' model).

1. **How far merged content simplifies.** For each of largeWorld's 28 groups (and
   testDebugScene's `AUTO` lattice): vertices and triangles, then a chain of each variant
   (`generateLodChain` on a copy registered under a spike id; `prune` passed to the simplifier
   directly by the spike): default, `permissive`, `prune`, `prune` + `permissive`. Record each
   level's triangles, error × extent (metres) and the chain's time on the worker.
2. **What drawing proxies saves.** largeWorld from its start camera and from a far viewpoint
   (`largeWorldOverview`), `dayNight` at 10:00 (its shadow follows the camera), both backends:
   triangles per pass (main, shadow) and the GPU and CPU frame time, with the groups at full
   detail, then each group forced to the level its `AUTO` thresholds would pick (`maxPixelError`
   1) by swapping the mesh's geometry by hand, then the coarsest level.
3. **A larger far field** when step 2's savings are small: `?hlodField=<sites>` adds ruin sites
   (`largeWorldRuins.ts`) in a ring 200 m-1 km out, merged `AUTO` (32 m cells), and step 2 again.
   That's the kit-terrain case p370 §10 makes HLOD for.
4. **Load cost.** The chain time per group on the worker, summed over a scene's groups (what D2's
   scene step adds to a load).

**Gate:** the plan goes on when the proxies save at least a quarter of the merged groups'
triangles in a far view and a measurable GPU time (at least 0.2 ms a frame on the Apple M2, both
backends) in at least one of step 2's or step 3's views, at a load cost under 100 ms for largeWorld.
Otherwise the results go here, the status becomes "feasibility — not adopted", and p377 is
reconsidered. Phase 0 also sets the group defaults (D4: `ratios`, `maxError`, `prune`,
`permissive`).

### Results

Measured 2026-11-12, Apple M2, Chrome (WebGPU), debug env. The probe is
`src/app/shared/_dbg__hlodSpike.ts` (`window.__aekHlod`, loaded by largeWorld and testDebugScene:
shared, as two scenes use it, rather than `_dbg__largeWorld.ts`), the bench
`devTools/bench/hlodSpike.ts`. `prune` goes through the engine's own `simplifyLodChain` with
meshoptimizer's `Prune` flag added by a wrapper on the page's `MeshoptSimplifier` (which fails
when the engine's calls don't go through it). The worker path's levels (`generateLodChain` on a
registered copy) matched the main thread's in every group.

**Step 1: how far merged content simplifies.** Ratios `[0.5, 0.25, 0.1]`. A level's error is
`error × extent` in metres (normal deviation included, so an overestimate). Totals over the
groups: the triangles at each level, where a group whose chain stopped counts its last level.

largeWorld: 28 groups, 409 members, **8,336 triangles in all** (11 rock groups of 360-408, 9
platform groups of 12-300, 8 wall groups of 272-436). Per group: 0.2-0.6 ms on the main thread,
about 1.2 ms on the worker (the round trip).

| Variant | maxError | Groups with levels | Level 1 | Level 2 | Level 3 | Main thread, all groups |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| default | 0.05 | 11 of 28 | 22.5 % | 33.2 % | 37.8 % | 5.4 ms (worker 35 ms) |
| permissive | 0.05 | 20 of 28 | 38.9 % | 51.9 % | 57.7 % | 10.8 ms (worker 36 ms) |
| prune | 0.05 | 13 of 28 | 26.6 % | 37.5 % | 42.5 % | 5.6 ms |
| prune + permissive | 0.05 | 20 of 28 | 38.9 % | 52.8 % | 58.9 % | 14.2 ms |
| permissive | 0.1 | 26 of 28 | 47.5 % | 68.9 % | 78.1 % | 18.1 ms |
| prune + permissive | 0.1 | 26 of 28 | 47.5 % | 68.3 % | 80.1 % | 19.1 ms |
| permissive | 0.2 | 27 of 28 | 49.9 % | 74.9 % | 89.6 % | 19.3 ms |
| prune + permissive | 0.2 | 27 of 28 | 49.9 % | 74.5 % | 89.3 % | 19.3 ms |

(Saved share of the 8,336; worker times are the sum of the groups' chains made one at a time.)

testDebugScene: 13 groups (the `AUTO` lattice's 12 of 0.12 m boxes, 2.7 m extent; `p372_grid`'s
200 boxes), 8,400 triangles. Nothing without `permissive` (0 of 13 groups); with it, 50.0 / 69.0 /
73.3 % at 0.05 and 50.0 / 75.1 / 90.1 % at 0.1 and 0.2. `prune` alone: nothing, and with
`permissive` at 0.05 it did worse (61.4 % at level 3).

What it says:

- **Kit pieces need `permissive`.** A box's faces share no vertices (a normal per face), so the
  floor tiles and walls don't simplify without it, whatever the error; the platform groups need
  maxError 0.2 for all three levels (0.05: 1 of 9 groups, 0.1: 7 of 9).
- **`prune` adds nothing measurable** on top of `permissive` here (±2 % either way). A piece is
  pruned only when it's smaller than the error, and the target ratio is reached by collapses
  first. When everything is below the error (the lattice's 0.12 m boxes), the result falls under
  `LodSimplify.ts`' `MIN_GROUP_TRIANGLES` and the chain keeps the base (`prune`: "none"): for
  HLOD that's the cull's job, not a level's.
- **The errors are large for `AUTO`'s pixel test.** At `maxPixelError` 1 (1080 px, 60° FOV,
  k ≈ 935), a level is picked from `935 × errorM` metres: the rock groups' level 1 (0.2-0.3 m) from
  about 190-270 m, the walls' level 1 (0.6-0.9 m) from 560-880 m, the platforms' (1.24 m) from
  1.2 km, every level 3 (0.5-2.2 m) from 0.5-2 km. largeWorld's farthest group is about 200 m from
  the overview camera, so step 2's `AUTO` view will draw nearly every group at level 0; step 3's
  ring (200 m-1 km) is where the levels get picked. The normal term inflates the boxes' error
  (every platform level 1 is 1.24 m): lower `attributeWeights.normal` for a group chain is worth a
  look in step 3.
- **Load cost** (step 4, first figure): largeWorld's 28 chains take 35 ms on the worker one at a
  time and 19 ms of simplifier work at maxError 0.2: under the gate's 100 ms. The triangle saving
  the gate asks for (a quarter) is there from level 1 with `permissive`; whether 8,336 triangles
  are worth a GPU figure is step 2's question.

## 4. Phases (after the gate)

### Phase 1: `lod()` — `prune`, `AUTO`'s `chain`, the resolve seam

1. `LodChainOptions.prune` (`LodChainOptions.ts`; `resolveLodChainOptions` records it only when
   true, D4) passed as the `Prune` flag (`LodSimplify.ts`). Tests: a mesh of disconnected boxes
   below the error loses them, one above keeps them; a chain's resolved options without `prune`
   are unchanged (the asset pipeline's cache key test).
2. `LodAutoDef.chain` (`LodTypes.ts`, `LodSchema.ts` for a JSON mesh's `lod`): `resolveAutoLod`
   generates the chain with these options when the geometry has none and none is requested or
   pending (`generateLodChain`, on the worker by its target), then resolves as before. A
   `setMeshLod` that's replaced meanwhile drops the result, as now (the generated chain stays the
   geometry's). Tests in `LodAuto.test.ts`.
3. `resolveAutoLodAsync(geometry, auto, label)` (`kernel/mesh/Mesh.ts`, `@internal`): the
   resolver loaded through the existing loader, null with a warning without `lod()`. `setMeshLod`'s
   `AUTO` path calls it. Tests in `Mesh.test.ts` (with and without the loader).
4. Hub: the LOD page's `AUTO` section (`hub/pages/features/lod/guide.md`) gets `chain` and `prune`.

### Phase 2: `merging()` — group proxies

1. **The setting** (D6): `MergeGroupLod` and `MergeGroupSettings.lod` (`MergeTypes.ts`, exported on
   `aekasha/merging`), `createMergeGroup`'s check (`BATCHED` throws), the schema
   (`MergingSchema.ts`: the group entry and the `AUTO` entry, refused with `BATCHED`), the scene
   settings (`MergeSceneSettings.ts`: the `AUTO` entry's `lod` to its groups). The group chain
   defaults from Phase 0 in `MergeTypes.ts` (`DEFAULT_GROUP_LOD_CHAIN`, `@internal`), always with
   `compactVertices: false` (D5).
2. **The build with its levels** (D2, D3; `MergeBuild.ts`): for a group with `lod`, the build
   registers its geometry under its id first, awaits `resolveAutoLodAsync` (the build token checked
   after, as a worker build is), reorders the levels' indices by part and gives them their ranges
   (D5, `MergeRanges.ts`: `partitionLevelIndex`), then applies: `removeMeshLod`, the geometry
   swapped, the previous one released, `setMeshLod(groupEntityId, def)`. A dropped build releases
   its geometry (its chain goes with it). Without levels (no `lod()`, or nothing to simplify) the
   group is applied without a LOD. The scene step (`buildSceneMergeGroupsAsync`) awaits the levels.
3. **In place** (D5, `MergeInPlace.ts`, `MergeRanges.ts`): the levels' ranges kept on the group
   (`MergeGroupData._levels`: each level's geometry, ranges and index copy, `@internal`);
   `dropMember`, `collapseDisabledMember`, `restoreEnabledMember` and the mirroring flip write
   every level; `growMergedBounds` grows the levels' bounds, and the LOD's `radius` is measured
   again when they grew. No allocation, as the base's writes.
4. **Debug** (`debug/_dbg__MergingInfo.ts`, `_dbg__MergingWindows.ts`): the group window's LOD row
   ("level 1 of 3 · 12 400 of 48 000 triangles", "culled", "levels pending", "no levels: …"), and
   the summary's groups on a proxy level and culled. The LOD tab already lists the group entity (a
   plain mesh with a `LOD`).
5. **Tests** (`MergeLod.test.ts`, new): the build waits for its levels and is applied with them; a
   rebuild keeps the previous geometry and level until the new levels are in; a dropped build;
   without `lod()`; `BATCHED` refused; a removed, disabled and edit-session member collapsed in
   every level and restored; a move moving the levels (shared vertices); a mirroring flip; the
   bounds and radius after a move outward; a palette group's `aekMatIndex` in the levels; the
   scene step. The debugger's rows in `_dbg__Merging.test.ts`.

### Phase 3: showcase, Hub, docs

1. **The lane** (`src/app/scenes/lodShowcase/lanes/mergedProxy.ts`, `features/lod/CLAUDE.md`'s
   request): a group of kit pieces with `lod`, placed by the layout's bands so its proxy levels and
   its cull show from the start camera; the "LOD demo" tab's row shows its level and triangles.
2. **largeWorld**: its `AUTO` entry gets `lod` when Phase 0 measured it paying there.
3. **Hub**: the Mesh merging page (`hub/pages/features/mesh-merging/guide.md`) gets a "Far
   proxies (HLOD)" section (the setting, what follows a member and what rebuilds, the cost, when
   not to), linked from the LOD page; the example scene question is §6's.
4. `features/merging/CLAUDE.md` (Mesh merging: the setting, the build with its levels, the levels'
   ranges; Merge debugging: the rows; Refusals' "`LOD` in a `BAKED` group (until p376 …)" becomes
   permanent), `features/lod/CLAUDE.md` (`chain`, `prune`, the seam),
   `readme.md` if its LOD or merging lines change. `yarn sbp` (the merging and LOD budgets),
   `yarn verify:scenes` (lodShowcase, largeWorld), `yarn verify:baselines`, `yarn hub:build`.

### Phase 4: versions and done

Engine minor (the group `lod`, `AUTO`'s `chain`, `prune`), app minor (the lane), toolkit
unchanged; `CHANGELOG.md`, `yarn checkVersions --against main`; the plan marked done, the epic's
status and §11 updated.

## 5. Risks

- **Merged content barely simplifies** (§1): the gate's first question. `prune` drops small
  pieces whole, which is HLOD's main saving for kit content; a field of medium pieces may still not
  simplify, and sloppy simplification would break D5.
- **Load time** (D2): every group's chain at load. Phase 0 step 4 measures it; a scene with many
  large groups may need the chains built after the load (the group at full detail until then).
- **Index memory**: each level adds its index and a copy (D5), about half the base's index for a
  `[0.5, 0.25, 0.1]` chain, twice. Small next to the vertices, which the levels share.
- **A palette group's proxies** mix materials at the pieces' borders only (members are never joined),
  so none is expected; the test checks `aekMatIndex` stays per member.

## 6. Open questions

1. **An example scene?** The lodShowcase lane is the demo; `exampleMerging` could get a group with
   `lod` for the Hub's Mesh merging page instead of a new scene. Decided before Phase 3.
2. **Proxy materials** (p350 §5.1): a far level without the normal map, or the group's albedo
   baked into one small texture (p351's bake path) with a simple material. Only if Phase 0's
   per-pixel figures (p374 D5's kind) show the material, not the triangles, costing far away.
3. **An impostor as the last level**: a cluster's parallax makes one octahedral impostor a poor fit
   for a 32 m group; a cull is the default end.

## 7. Branches and PRs

One branch, `p376_hlod-merged-cluster-proxies`, from `main` into `main`, with its own bump (engine
minor, app minor); the PR opens after Phase 4. p377 gets its own branch when it stops being a stub.
