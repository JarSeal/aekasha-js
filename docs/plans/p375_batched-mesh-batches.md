Status: draft | Phase 0 (spike) done, gate passed; Phase 1 not started
Category: Merging, Rendering
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 2.2)
Related: \_DONE_p348_ecs-lod-selection.md (§4.4's `BatchedMesh` spike is this plan's Phase 0, run once), p309_terrain-decals.md (its runtime decal pools are `BatchedMesh`es; its WebGPU risk is answered here), \_DONE_p347_lod-chain-generation.md (shared-vertex chains), \_DONE_p354_gpu-driven-culling.md

# BatchedMesh Batches (movable and per-member-culled content)

The merge path for content a baked merge can't take: members that move, or that need their own
culling, visibility or LOD. A `BatchedMesh` holds many geometries with one material and a matrix
per member.

**It is spike-gated.** On WebGPU, three r186 drew a `BatchedMesh` as one draw call per visible
member (p370 §2.1), so it lowered only CPU cost (one render object, one pipeline, one bind group,
no per-object render-list work). three r187 merges consecutive draws that share a geometry range
into one `drawIndexed` with an instance count (#35259), so a batch whose members are drawn grouped
by geometry lowers the draw count too: to about one draw per geometry (or per geometry and level).
This plan is adopted only if Phase 0 measures a CPU or draw-count win that matters.

---

## 1. Grounding

- **r186 WebGPU draw loop** (history: r187 replaced it): one `drawIndexed` per entry of
  `_multiDrawStarts` / `_multiDrawCounts`, `firstInstance = i` as the member index, each counted
  in `info.render.drawCalls`.
- **r187 merged draws** (#35259; `objects/BatchedMesh.js` `_updateDrawParameters(…, 'merged')`
  builds `_mergedDrawStarts` / `Counts` / `InstanceCounts`, `WebGPUBackend.js` ~2146 issues one
  `drawIndexed(count, instanceCount, …)` per run, driven from `nodes/accessors/Batch.js` through
  `OnObjectUpdate`, so a shadow pass culls against its own camera, #34829). Only *adjacent*
  entries merge: the default `sortObjects = true` sorts opaque members by depth and interleaves
  geometries (the PR's numbers: three alternating geometries 18,019 → 12,133 draws; added per
  geometry with `sortObjects = false`, 18,014 → 4). So a batch adds its members grouped by
  geometry and draws with `sortObjects = false`, or a `customSort` by geometry range first, then
  depth. Also in r187: the sort corruption fix (#34828), draw ranges after `setGeometrySize()`
  (#34983), the previous-matrix leak (#35272) and precise `Box3` bounds (#34863).
- **Traps found reading r187** (2026-11-11, before the spike):
  - A freed instance id is reused lowest first (`addInstance`, `_availableInstanceIds.sort`), so
    with `sortObjects = false` a member added after deletes lands inside another geometry's run
    and splits it: a batch with churn (p309's FIFO pools, §3's level swaps) loses its merged draws
    unless a `customSort` orders by range.
  - `OnObjectUpdate` runs per render of the batch, so every shadow pass walks all members again
    (cull, and sort when on) against its own camera.
  - With `sortObjects = false`, `perObjectFrustumCulled = false` and no visibility change,
    `_updateDrawParameters` returns at once: the cheapest setup, without per-member culling.
  - `BatchedMesh` is about 18 kB minified, and `MergeEligibility.ts` reads type flags so that
    `merging()` doesn't ship it (its budget is 8 KiB): a `BATCHED` mode loads it behind `import()`.
- The WebGPU path no longer sets draw parameters in `onBeforeRender`, which
  `@three.ez/batched-mesh-extensions` overrides: the extension (item 7) is even less usable.
- `BatchedMesh` keeps member matrices in a data texture, supports per-member visibility, colour,
  `perObjectFrustumCulled` and `sortObjects`, and geometry slots that can be freed and reused.
- **No `BatchedMesh` in the engine** (checked 2026-11-04). The profiler census counts one as a
  whole object (`debug/profiler/_dbg__Census.ts`).
- p348's spike (its §4.4) answered the `@three.ez/batched-mesh-extensions` LOD question (item 7
  below; `features/lod/CLAUDE.md`, "Not `BatchedMesh`"); p309 plans decal pools on `BatchedMesh`
  with a WebGPU risk. This plan's spike answers the rest.
- p372 provides groups, members, the build system and eligibility rules.

## 2. Phase 0 — Spike (1 day) — done

In a test scene, 2 000 members of 20 geometries with one material, three ways: separate meshes, a
baked p372 group, a `BatchedMesh`. Both backends. Measure (profiler):

1. CPU frame time (render-list build, `renderer.render`) and GPU time, without and with a
   shadow-casting sun (each shadow pass walks the members again, §1);
2. draw calls as counted, with the members added in random order and `sortObjects` on (the
   default), and grouped by geometry with `sortObjects = false` or a `customSort` by range then
   depth (r187's merged draws, §1);
3. per-member matrix updates for 10% / 100% of members per frame;
4. per-instance colour and visibility on WebGPU (p309's risk);
5. `perObjectFrustumCulled` cost vs. benefit, against the setup that skips the walk (no sort, no
   culling, §1);
6. geometry slot reuse after deletes (p309's FIFO pools), and the draw count after that churn with
   `sortObjects = false` and with a `customSort` (freed ids split the runs, §1);
7. `@three.ez/batched-mesh-extensions`' `addGeometryLOD` under `WebGPURenderer` (p348 §4.4).
   Answered by p348's Phase 5 (`_DONE_p348_ecs-lod-selection.md` §4.4): broken on WebGPU r186 as
   shipped (0.0.12 never sets `_multiDrawBytesPerElement`), and once fixed no faster than p348's
   instanced LOD pool for 2,000 instances of one geometry (and 2,000 draws instead of 3).

Record the numbers here, in p348 §4.4 and in p309's risk row. **Gate:** continue only if
`BatchedMesh` beats separate meshes on CPU frame time or draw count by a margin worth a new code
path (proposed: ≥ 30% at 2 000 members) and works on both backends.

### Results (2026-11-11, three r187)

**Gate: passed** on both counts and both backends. At 2 000 members of 20 geometries, a batch's
CPU frame is 1.9 ms against separate meshes' 4.8 ms on WebGPU (−61%) and 0.8 against 3.5 ms on
WebGL2 (−76%), its draws 23 against 2 003 (WebGPU, members grouped, no sort) and 4 (WebGL2's
multi-draw), and per-member colour, visibility and slot reuse work the same on both backends.

How it was measured: the `batchedMeshSpike` scene (`src/app/scenes/batchedMeshSpike/`, an
`isDebugScene`) and `npx tsx devTools/bench/batchedMeshSpike.ts` (both kept uncommitted until the
gate's decision). The members are 20 indexed primitives of 400-1 100 triangles (1.2 M triangles in
all), one standard material, on a 45 × 45 grid of 3 m, seeded. Separate: a mesh entity each.
Baked: the same entities in one p372 group. Batched: one `BatchedMesh`, each member an entity with
only a `Transform`, its matrix written by a sync system at `POSE_PRODUCERS` when the `Transform`'s
version changed (`MAP` storage). MacBook (Apple Metal 3), headless Chromium on its GPU, both
backends (WebGL2 through the renderer tab's "Force WebGL"), the debug env on the dev server,
1600 × 900, camera still. Each case is 3 page loads of 120 warm-up and 300 measured frames. CPU
frame = the first `MAIN` system to the first `LATE_MAIN` one (the update and `renderer.render`);
GPU = the stats panel's timer (WebGL2's figures are unreliable: its timer gets about two frames in
three, and an upload stall shows as a spike). The medians of the 3 runs:

| Case (2 000 members)                    | WebGPU draws | WebGPU CPU (ms) | WebGPU GPU (ms) | WebGL2 draws | WebGL2 CPU (ms) |
| --------------------------------------- | -----------: | --------------: | --------------: | -----------: | --------------: |
| Separate meshes                         |        2 003 |            4.77 |            3.82 |        2 003 |            3.52 |
| Baked p372 group                        |            4 |            0.77 |            3.58 |            4 |            2.12 |
| Batch, random order, depth sort         |        1 913 |            0.88 |            3.37 |            4 |            0.92 |
| Batch, grouped, depth sort              |        1 913 |            1.09 |            3.40 |            4 |            1.05 |
| Batch, random order, `customSort` range |           23 |            2.59 |            3.57 |            4 |            1.42 |
| Batch, grouped, no sort                 |           23 |            1.86 |            3.73 |            4 |            0.84 |
| Batch, grouped, no sort, no culling     |           23 |            1.18 |            3.50 |            4 |            0.78 |
| Shadow: separate                        |        4 005 |            6.52 |           10.03 |        4 005 |            6.65 |
| Shadow: baked                           |            7 |            2.69 |           10.11 |            7 |            2.15 |
| Shadow: batch, random, depth sort       |        3 829 |            2.84 |            9.64 |            7 |            1.27 |
| Shadow: batch, random, range sort       |           45 |            3.10 |            8.77 |            7 |            2.14 |
| Shadow: batch, grouped, no sort         |           45 |            2.44 |            8.75 |            7 |            0.93 |
| Shadow: batch, grouped, no sort/cull    |           45 |            1.49 |            8.77 |            7 |            0.47 |
| Move 10%: separate                      |        2 003 |            3.76 |            3.55 |        2 003 |            5.93 |
| Move 10%: baked (in-place rewrite)      |            4 |            4.42 |            3.20 |            4 |            3.27 |
| Move 10%: batch, grouped, no sort       |           23 |            2.10 |            3.45 |            4 |            0.57 |
| Move 100%: separate                     |        2 003 |            5.74 |            3.54 |        2 003 |            8.22 |
| Move 100%: baked (in-place rewrite)     |            4 |           22.57 |            2.62 |            4 |           17.31 |
| Move 100%: batch, grouped, no sort      |           23 |            2.52 |            3.49 |            4 |            1.00 |
| Inside (483 in view): separate          |          484 |            2.61 |            2.00 |          484 |            1.70 |
| Inside: baked (culled whole: all drawn) |            2 |            2.98 |            3.15 |            2 |            0.66 |
| Inside: batch, grouped, no sort         |           21 |            1.53 |            1.68 |            2 |            0.52 |
| Inside: batch, grouped, no sort/cull    |           21 |            1.05 |            3.16 |            2 |            0.26 |
| Inside: batch, random, range sort       |           21 |            1.81 |            1.72 |            2 |            0.60 |

**Noise:** the 3 runs of a case agree within about 0.2 ms, but cases that ran minutes apart
differ by up to about 1 ms more than their work explains (the static baked group: 0.77 ms
here, 2.82 ms in a smoke run; the shadow cases vs. the shadowless ones). The likely causes are
macOS clock scaling on a light load and a `yarn test` run overlapping part of the run. Read
differences under about 1 ms between cases as unproven unless both backends agree. Separate meshes
against any batch (3-5 ms) and baked moving (20 ms) are well outside that.

Per item:

1. **CPU and GPU.** Every batch setup beats separate meshes by 45-80% on CPU, on both backends,
   with and without the sun's shadow. GPU time is the same for every way (the same triangles): the
   win is on the CPU. A static baked group is as cheap as a batch or cheaper, so baking stays the
   tool for static content (p370 §3). Each shadow pass walks the members again (§1): +0.3 to
   +0.6 ms at 2 000 members on WebGPU, against separate meshes' +1.8 ms.
2. **Draws (r187's merged draws).** Three's default depth sort defeats the merging: 1 913 draws for
   2 000 members, random or grouped order alike. Grouped with `sortObjects = false`, or a
   `customSort` by range, gives 20 draws (one per geometry, plus 3 of the scene). On WebGPU here,
   1 910 draws inside one render object cost little CPU (0.88 ms, the cheapest batch row): what
   separate meshes pay for is the render objects, not the `drawIndexed` calls. The range sort
   costs about 0.6 ms a pass at 2 000 members on both backends (the sort and its depths). WebGL2
   is always one multi-draw (4 draws in the scene), whatever the order.
3. **Moving members.** The sync writes 2 000 matrices in 0.41 ms (0.17 ms with none changed: the
   version checks). A batch with every member moving costs 2.5 ms (WebGPU) and 1.0 ms (WebGL2)
   against separate meshes' 5.7 and 8.2 ms. A baked group rewritten in place is the worst way
   for moving content (22.6 and 17.3 ms at 100%, 4.4 and 3.3 ms at 10%), as p370 §3 says.
   **Found:** `updateMergeMember` during a running worker build drops the build and starts it
   again (p372, `MergeGroups.ts`), so members updated every frame from the load on kept their
   group from ever building, drawn on their own (2 003 draws). The spike's mover waits for the
   first build (2 frames).
4. **Colour and visibility per member** (`setColorAt`, `setVisibleAt`, every 7th hidden: 1 714
   visible) render the same on both backends, without errors
   (`.cache/bench/batchedMeshSpike/check-colours-hidden-*.png`). p309's risk is answered.
5. **Per-member culling.** With most members out of view (the camera inside the field, 483 of
   2 000 in view), it halves the GPU time on WebGPU (3.16 → 1.68 ms) and triangles (1.2 M → 287 k).
   Its CPU cost is the member walk on every pass: 0.3-0.7 ms at 2 000 on WebGPU. Turned off with no
   sort and no visibility change, the walk is skipped (§1). Keep it on by default; turning it off
   suits a batch that is always in view.
6. **Slot reuse.** Instances: 10% of members deleted and re-added (freed ids, lowest first) with
   `sortObjects = false` split the runs: 20 → 384 merged draws on WebGPU. A range `customSort`
   keeps 20 but pays its 0.6 ms. Geometries: `deleteGeometry` + `addGeometry` reuses the id but
   appends the data (r187 reuses ids, never ranges), so the buffers filled up after 9 rounds with
   a 50% reserve ("Reserved space request exceeds the maximum buffer size"); `optimize()` after
   each delete or `setGeometryAt` on the same slot ran 40 rounds without growing. For p309's FIFO
   pools: reserve each slot's size at `addGeometry` and refill it with `setGeometryAt`.
7. Answered by p348 (above): `@three.ez/batched-mesh-extensions` stays out.

Unrelated, seen on the way: on WebGL2 every shadow case logs `THREE.TSL: ".toInspector()" is only
available with WebGPU`, the separate meshes too (the shadow path, not `BatchedMesh`).

**For §3** (decide before Phase 1): a batch's members drawn grouped need ids grouped, which churn
breaks (item 6). Either no sort and regroup a batch whose merged draws grew (re-add a geometry's
members in one block), or a range `customSort` always (0.6 ms per pass at 2 000). Per-member LOD
swaps (Phase 2) and decal pools (Phase 3) churn every frame, so this matters there more than for
moving members.

## 3. Design (if the gate passes)

- **Mode:** `merge: { group: "<id>" | "AUTO", mode: "BATCHED" }`; a group setting
  (`mergeGroups` entry `"mode": "BATCHED"`). Same eligibility as p372, except that kinematic and
  dynamic bodies and animated transforms are allowed.
- **Members** get `MERGE_MEMBER` with a batch instance id instead of a part range. Each geometry is
  added once per batch (`addGeometry`), each member as an instance (`addInstance`).
- **Sync:** a system at `APP_RENDER_SYNC` (after `POSE_PRODUCERS`, so interpolated physics poses
  are final), registered by `merging()`, writes the matrices of members whose transform changed
  (`setMatrixAt`), deciding as `instancedMeshPoolSyncSystem` does (`features/instancing/CLAUDE.md`):
  in `MAP` storage the `Transform`'s version, in `TYPED_ARRAY` the store's dirty flag, which
  `object3DSyncSystem` clears only for an `OBJECT3D` holder. Whether a batched member keeps its
  own (hidden) Object3D decides who clears the flag and whether this system still sees it (p616
  found pool instances that never moved in `TYPED_ARRAY` mode over this flag); Phase 1 tests both
  storage modes. Storages read once per frame, no allocation.
- **Visibility:** `DISABLED`, frustum and object culling map to `setVisibleAt` per member; the
  batch itself is never hidden for one member.
- **LOD (with p348):** a member's level is a different geometry id in the same batch (p347 chains
  share one vertex buffer, so `addGeometryLOD`-style index ranges are cheap if the spike's
  extension works; otherwise a geometry per level). A level change cross-fades instead of popping
  (p351 Phase 2): for `fadeSeconds` the member has a second batch instance with the outgoing
  level's geometry, each with its signed fade for `lodDither`, and culling fades the same way;
  `fadeSeconds: 0` swaps instantly.
- **Debug:** p373's tab lists batched groups with their member count and visible count.
- **Smallest build:** `BatchedMesh` loads behind `import()` on the first batched group, so an app
  that lists `merging()` without one doesn't download it (§1); `yarn sbp` checks the feature's
  budget.

## 4. Phases (after the gate)

1. Batched groups, sync, visibility. **Exit:** 2 000 moving kinematic boxes in one batch match the
   spike's numbers in the engine.
2. LOD per member (with p348). 3. p309's decal pools on batched groups (if p309 has shipped, port;
   if not, p309 uses this). 4. Docs (the Hub's Mesh merging page and `features/merging/CLAUDE.md`, a `lodShowcase` lane if
   per-member LOD lands), versioning (engine minor).

## 5. Risks

| Risk                                          | Mitigation                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| No CPU win worth the code on WebGPU           | The gate; the spike's numbers stay recorded, and p372/instancing cover the cases  |
| Per-instance features differ between backends | Spike items 4–6 on both backends                                                  |
| Merged draws need grouped members (r187)      | The sync keeps members grouped by geometry and the batch's sort by range (§1)     |
| WebGPU gains multi-draw-indirect later        | Fewer draws still for interleaved members; re-run the spike (p370 open question 4) |

## 6. Open questions

1. Should a baked group switch a member into a batch while it's being edited (p373 D4), instead
   of showing its own mesh? Only if editing large groups shows a cost.
