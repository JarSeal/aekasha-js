Status: in progress | Phase 0 (spike) done, gate passed; Phases 1-2 implemented
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
    **Wrong for three's class** (found in Phase 1 S6): the `import()` keeps the engine's batch code
    lazy, but `BatchedMesh` is a statement of `three.core.js`, one module, whose kept statements
    stay in its chunk, the main one: +4.6 KiB gzip with `merging()`
    (`docs/issues/three-classes-ship-with-their-chunk.md`).
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
`isDebugScene`) and `npx tsx devTools/bench/batchedMeshSpike.ts` (committed with Phase 0,
`af9d4fa2`). The members are 20 indexed primitives of 400-1 100 triangles (1.2 M triangles in
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

## 3. Design (the gate passed)

### Decisions (2026-11-11, after the spike)

- **D1 — Grouped ids, no sort, compaction when fragmented.** A batch adds its members in geometry
  order at its build and draws with `sortObjects = false`: one draw per geometry on WebGPU, no
  per-pass sort. The batch counts its merged draws (`_mergedDrawCount`, read after a render, or
  its own count of geometry runs in id order, kept on add and remove). When that count passes twice the batch's geometry count, a
  compaction re-adds every member in geometry order in that frame (2 000 members: about 0.4 ms, the
  matrix writes), as p372 compacts a group past 25% waste. A range `customSort` (0.6 ms a pass at
  2 000, shadow passes included) is the fallback, decided in Phase 2 if LOD swaps fragment a batch
  often enough to make compactions frequent. Transparent members stay refused (p372's rule), so no
  batch needs the depth sort.
  **Decided in Phase 2 S6:** they do (a LOD dolly compacted every frame), so a batch with LOD
  members sorts by range on WebGPU, one without compacts, and neither on WebGL2 ("S6 decisions").
- **D2 — The spike scene is Phase 1's exit scene.** `batchedMeshSpike` (an `isDebugScene`) and
  `devTools/bench/batchedMeshSpike.ts` are committed with Phase 1 (after `yarn sbp` and
  `yarn verify:scenes --only batchedMeshSpike` pass). Phase 1 adds an `ENGINE` way to the scene
  (the same members in an engine batched group, `mode: "BATCHED"`) next to the spike's hand-built
  `BATCHED` way, which stays as the baseline, and the bench compares them.
- **D3 — p372's build starvation is its own fix**, not p375's: `docs/issues/merge-update-starves-worker-build.md`
  (an engine patch on its own branch). Batched groups don't build in the worker.
- **D4 — Per-member culling on by default** (`perObjectFrustumCulled`): with most members out of
  view it halved the GPU time; a group setting turns it off for a batch that is always in view.
- **D5 — Geometry slots** (Phase 3's decal pools, and any batch whose geometries change): reserve
  each slot at `addGeometry` and refill it with `setGeometryAt`; never `deleteGeometry` +
  `addGeometry` without `optimize()` (the buffer space leaks, spike item 6).

### Design

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
- **LOD (with p348):** a member's level is a different geometry id in the same batch, a geometry
  per level (`@three.ez/batched-mesh-extensions`' shared-vertex `addGeometryLOD` is out, spike item
  7). A level change is a remove and an add, which fragments the runs (D1). A level change cross-fades instead of popping
  (p351 Phase 2): for `fadeSeconds` the member has a second batch instance with the outgoing
  level's geometry, each with its signed fade for `lodDither`, and culling fades the same way;
  `fadeSeconds: 0` swaps instantly.
- **Debug:** p373's tab lists batched groups with their member count and visible count.
- **Smallest build:** the batch code (`MergeBatch.ts`) loads behind `import()` on the first
  batched group; three's `BatchedMesh` ships with `merging()` all the same (§1's correction), until
  the issue's fix; `yarn sbp` checks the feature's budget.

## 4. Phases (after the gate)

1. **Done.** Batched groups, sync, visibility, grouping and compaction (D1), `BatchedMesh` behind `import()`.
   Tests: the sync in both storage modes, compaction after removes and adds, `DISABLED` and
   culling to `setVisibleAt`. Commit the spike scene and bench (D2) and add the `ENGINE` way.
   **Exit:** 2 000 moving kinematic boxes in one engine batch match the spike's hand-built batch
   (CPU frame within the runs' noise, 23 draws on WebGPU) on both backends, and `yarn sbp` shows no
   `BatchedMesh` in the first download.
   **Sections** (the breakdown agreed 2026-11-11; each stopped for review):
   - S1 — the mode, settings and refusals — done (`6db6b464`).
   - S2 — the batch build behind `import()` — done.
   - S3 — the sync and the growing bounds — done.
   - S4 — grouping and compaction (D1) — done.
   - S5 — the debugger — done: the moved-member check skips a batched member (its `partIndex`),
     the overlay outlines it at its own mesh's pose, "Show unmerged" holds the batch, the windows
     and the tab's rows show the mode and the batch's figures, the pose fields move a batched
     member without a session. Tests: `debug/_dbg__MergingBatched.test.ts`.
   - S6 — the exit — done (its decisions: "S6 results"): `?bmsWay=engine` in `batchedMeshSpike` (mesh entities with
     `merge: { group, mode: 'BATCHED' }`) and `?bmsBodies=kinematic` (kinematic bodies moved in
     `APP_PHYSICS_STEP`, on the separate and engine ways), the bench's cases, a `scenes.config.ts`
     entry, then `yarn sbp` (no `BatchedMesh` in the first download; the `merging` budget, 8 KiB,
     was 7.7 KiB before S1), `yarn verify:baselines` (the new `APP_RENDER_SYNC_ORDER` key and
     `MergeGroupMode` change the API baseline), `yarn verify:scenes --only batchedMeshSpike`, and
     the numbers recorded here.

   **S6 results** (2026-11-11; the spike's machine and setup, §2's Results):
   - **Built:** `?bmsWay=engine` (mesh entities with `merge: { group, mode: 'BATCHED' }` into a
     group made with `perMemberCulling` from `?bmsCull`), `?bmsBodies=kinematic` (SEPARATE and
     ENGINE: a kinematic ball per member, `?bmsMove`'s share moved per fixed step in
     `APP_PHYSICS_STEP`; the scene is on the simulation lint's list), the probe reading the engine
     group's batch and its sync bracket reaching past `MERGE_BATCH_SYNC`, the bench's `engine`,
     `shadow: engine`, `move …: engine`, `inside: engine` and `kinematic move 100%: …` cases, and
     `scenes.config.ts`' `batchedMeshSpike` variants (`separate`, `batched`, `engine`,
     `kinematicSeparate`, `kinematicEngine`).
   - **Scene runner** (WebGPU, all four configurations): every variant loads without errors (17
     new, then `@separate` again: its first run met `yarn sbp`'s production gather). The
     snapshots: `@engine` against `@batched` and `@kinematicEngine` against `@kinematicSeparate`
     are pixel-identical, `@engine` against `@separate` 0.001 % of pixels over 8/255; the kinematic
     ones differ from the still ones (the members moved). The kinematic probe hash is the same for
     both ways and all three physics targets (`2fd77609`).
   - **Draws:** the engine's batch is 23 draws on WebGPU (20 merged runs) and 4 on WebGL2, as the
     hand-built one, in every case (shadow 45 and 7, inside 21 and 2, 483 of 2 000 visible).
   - **Kinematic** (every member a moving body; CPU frame, medians of 3 runs): separate 8.82 ms →
     engine 4.98 ms on WebGPU (−44 %), 9.69 → 4.98 ms on WebGL2 (−49 %); render submit 5.25 → 0.49
     and 6.07 → 0.43 ms.
   - **Engine against the hand-built batch** (still, the field in view; CPU frame): WebGL2 1.31
     against 0.87 ms (nocull 1.09 / 0.80, shadow 1.38 / 0.96, move 100 % 2.15 / 1.41, inside 2.27 /
     1.31), tight spreads; WebGPU 2.96 against 0.53 ms, its spread 0.94-3.16 (one page measured 1.07
     ms, then about 3 ms: §2's noise, a light load's clock). A CPU profile on WebGL2 (one page each,
     600 frames: 0.85 against 0.54 ms) puts the engine's extra 0.31 ms in three's
     `updateMatrixWorld` and `multiplyMatrices` over the 2 000 hidden member meshes (0.22 ms: the
     root scene's update forces every child's world matrix, so turning a member's
     `matrixAutoUpdate` off changes nothing, A/B measured), `mergeBatchSyncSystem` (0.08 ms: the
     version checks) and `object3DSyncSystem` (0.05 ms). The separate way pays the first and the
     last too.
   - **`yarn sbp` fails three budgets:** `BatchedMesh` is in the first download (three +4.6 kB
     gzip, the main chunk 382.6 → 388.6 kB, initial 392.8 kB against 387 kB). Its class is a
     statement of `three.core.js`, one module, and Rollup keeps a module's kept statements in that
     module's chunk: the `import()` of `MergeBatch.ts` (its own 2.7 kB lazy chunk) keeps
     `BatchedMesh` alive but can't move it out of three's chunk, so §1's "loads it behind
     `import()`" doesn't hold for three's class. And `_engine/features/merging` is 8.9 kB against
     its 8 KiB budget (22.3 → 26.0 kB minified, 10 → 12 modules: the mode, its refusals, `AUTO`'s
     batched key, the build dispatch in `MergeBuild.ts`, `MergeBatchFront.ts` 0.6 kB).
   - **`yarn verify:baselines --no-build`:** the same bundle growth, and the API changes S1-S5
     made (the new modules' `@internal` exports, `WORKER_BUILD_VERTICES` moved to `MergeBuild.ts`,
     `MergeGroupMode` on `aekasha/merging`); no debug code in the production build. Not recorded
     (`--update`) until the budget decisions.
   - **Decided (2026-11-11):** (1) `BatchedMesh` in the first download is accepted: the initial
     budget 387 → 393 KiB, `assets/index.js` 383 → 389 KiB (`sbp.config.ts`), and the fix (three
     resolved to its sources for the build) is its own issue,
     `docs/issues/three-classes-ship-with-their-chunk.md`; (2) the `merging` budget 8 → 9 KiB;
     (3) exit parity accepted: the engine's +0.3 ms at 2 000 still members is under the 1 ms the
     runs' noise allows, and separate meshes pay its largest part too. Taking a batched member's
     own mesh out of the scene graph while it's batched (the 0.22 ms) is a Phase 2 candidate
     (below). `yarn sbp` passes, and `yarn verify:baselines --update` recorded the bundle (the
     embeds' 16 B: S3's kernel change), API and docs baselines.

   **Decisions while building** (2026-11-11):
   - Exit parity is measured `ENGINE` against the spike's hand-built `BATCHED` way, the same field,
     no bodies (23 draws on WebGPU, CPU frame within the runs' noise); a kinematic case checks
     correctness and is compared with separate meshes with bodies.
   - A batched member keeps its own (hidden) mesh, and the sync reads that mesh's pose, not its
     `TRANSFORM`: physics' interpolation writes the mesh only (`PhysicsInterpolation.ts`), so a
     `TRANSFORM` read draws kinematic members stepped. The batch draws a member where its mesh
     would be drawn on its own (a `TRANSFORM` written after `MAIN` a frame later, as an own mesh).
   - Change detection: `OBJECT3D._lastVersion`; the kernel's `object3DSyncSystem` now bumps it
     with each copy in `TYPED_ARRAY` storage (it had no version there, p616's trap). A
     `BODY_DYNAMIC_VISUAL` member is written every frame.
   - Spatial index: members leave it (as baked ones); the batch is one entry, at its members'
     bounds' centre from its full build (instances are world matrices less that centre), its
     internal geometry carrying a copy of its bounding sphere, which the index measures a mesh by.
     The sphere grows with the sync and never shrinks; the group re-joins when it grew.
   - "Object culling" in §3 is lights only (`TAG_OBJECT_CULLED`): a member's instance follows
     `DISABLED`, `TAG_FRUSTUM_CULLED` (the opt-in) and `TAG_DRAW_HELD`. The visibility hooks moved
     to S2 (the scene step builds while the load's holds are on).
   - The mode is the group's: a scene entry's, else the first joining `merge`'s; a `merge` naming
     the other mode is refused. `BATCHED` refuses a mesh not directly under the root scene and a
     geometry whose index or attributes aren't the group's exactly; it refuses no body. No palette
     with `BATCHED`. `AUTO` keeps the modes apart (a `BAKED` key unchanged, so the ids stay) and its
     cap counts each geometry once per batched group.
   - Compaction is in place (`setGeometryIdAt` over the same live ids): a freed id between two
     instances of a geometry doesn't split their merged draw, and deleting and re-adding would
     reallocate the textures or sort the freed ids per add.
   - `updateMergeMember` does nothing for a batched member; `beginMergeMemberEdit` warns.
     `rebuildMergeGroup` makes a fresh batch in geometry order.
   - S5: only `BATCHED` gets a badge on the tab's rows (`BAKED` is the default and has none, so the
     baked rows and the scene runner's tab shots don't change); the group window's Mode row is on
     both modes (largeWorld's group window shot gains a row). A batched group's draws in the
     summary are its runs (WebGPU's count; the note says WebGL2 draws it in one). Found on the way
     (fixed in `MergeBatch.ts`): a full build's new batch was visible in a disabled or held group
     entity (`OBJECT3D`'s value replaced without the reconcile), and the build gave `TAG_MERGED`
     back to a group shown unmerged.

   **As built** (S1-S5; the detail is `features/merging/CLAUDE.md`'s "The mode" bullet): the builds
   moved out of `MergeGroups.ts` into `MergeBuild.ts` (both modes' dispatch, the `BAKED` build);
   `MergeBatch.ts` (the lazy chunk: build, sync, compaction) and `MergeBatchFront.ts` (the loader, a
   leaving member, the visibility hooks); `MERGE_MEMBER.instanceId` (`partIndex` stays -1 for a
   batched member, so the baked in-place paths skip it) and `_batchVersion`; the kernel's
   `APP_RENDER_SYNC_ORDER.MERGE_BATCH_SYNC` (-0.25) and the typed-mode version bump; S5's debugger
   reads a batch through the loader (`getGroupBatchState`, `getMergeBatchFigures`,
   `isMergeMemberBuilt` in `debug/_dbg__MergingInfo.ts`; Merge debugging's "Batched groups"). Tests:
   `MergeBatch.test.ts`, `MergingSchema.test.ts`, `ECSCoreSystems.test.ts`,
   `debug/_dbg__MergingBatched.test.ts`.

2. **Done.** LOD per member (with p348). Candidate from Phase 1's exit: a batched member's own mesh out of
   the scene graph while it's batched (three's world matrix update walks the hidden member meshes:
   0.22 ms at 2 000 on WebGL2), back in on a leave and in "Show unmerged"; measure with the bench's
   `engine` case against `batch grouped none`. Per-member LOD adds a second instance per fading
   member, so the members' cost matters more there.
   **Sections** (the breakdown agreed 2026-11-11; each stopped for review):
   - S1 — a batched member's own mesh out of the scene graph (the candidate above) — done (its
     results: "S1 results" below).
   - S2 — the seam and the refusals — done ("S2 results" below): a kernel draw delegate next to the LOD targets
     (`kernel/ecs/LodTargets.ts`), set by `merging()`'s install, which `LodFades.ts`' plain-mesh
     apply, cull and fade ask per call whether something else draws the entity. LOD keeps
     resolving the levels (refs, `AUTO`, pre-warm, dither) and the hidden mesh still gets each
     level (a leave shows the right one). `BATCHED` stops refusing `LOD` (`BAKED` keeps it until
     p376); each level's geometry must match the batch, its material be the group's and its
     `castShadow` the batch's; impostor levels refused.
   - S3 — level swaps and LOD culling, no fades — done ("S3 results" below): the batch holds every level geometry of its
     members; the apply swaps in place (`setGeometryIdAt`, not a remove and an add);
     `TAG_LOD_CULLED` joins the batched members' visibility.
   - S4 — cross-fades — done ("S4 results" below): a per-batch fade texture read at `batchIndirectIndex` through
     `setObjectLodFadeNode` (before the batch's first build; the shadow pass reads it too), a
     second instance per fading member with the outgoing level (`MERGE_MEMBER._fadeInstanceId`),
     cull fades, and the second instance through fade end, delete, leave, compaction and rebuild.
   - S5 — the debugger — done ("S5 results" below): the batch's fading instances and level
     geometries, the member window's level and fade instance; the LOD tab and overlay checked with
     batched members.
   - S6 — the exit — done ("S6 decisions" and "Phase 2's S6 results" below): `?bmsLod=…` in `batchedMeshSpike` (two or three hand-made levels per
     geometry) and a camera dolly; the bench's separate LOD meshes against the engine batch, still
     and dollying (swaps a second, compactions, runs), and a range `customSort` against compaction
     (decides D1's fallback); `scenes.config.ts` variants, `yarn sbp`, `yarn verify:baselines`,
     `yarn verify:scenes`. **Exit:** ≥ 30 % CPU frame against separate LOD meshes on both
     backends, WebGPU draws near one per geometry-level in use, fades without pops.

   **Decisions** (2026-11-11, before S1): the delegate, not a `LodTarget` resolved again at the
   join and leave; a level change in place; a shared-vertex chain level's duplicated vertices are
   accepted and their memory recorded in S6 (sharing them through `BatchedMesh`'s private
   `_geometryInfo` is a follow-up); S1 first and droppable. A `merging` budget over 9 KiB stops
   for a decision, not a raise.

   **S1 results** (2026-11-11; Phase 0's machine and setup):
   - **Built:** `TAG_MERGED`'s hooks (`MergeGroups.ts`) take a batched member's own mesh out of
     the scene graph (`detachBatchedMemberMesh`, `MergeBatchFront.ts`: a member with an instance)
     and put a mesh merging took out back under the root scene (`reattachMemberMesh`, a `WeakSet`
     of the detached meshes). So a leave, a dissolve or deleted group (`releaseMember`) and "Show
     unmerged" put it back; a rebuild, which keeps `TAG_MERGED`, leaves it out; a deleted member
     isn't put back (`deleteEntity` runs no remove hook). No rebuild handover was needed.
   - **Readers checked:** the sync and compaction compose the pose from position, quaternion and
     scale; `addMemberInstance`'s `syncMemberPose` updates the matrix itself; LOD's
     `measureEntity` reads a mesh without a parent as one at the root; frustum culling's
     `getMeshWorldBoundingSphere` calls `getWorldPosition` (updates the matrix); streaming's
     priming and fades traverse the object itself; `disposeMesh` takes it from no parent; the
     eligibility's root-scene check runs only at a join, after the member check.
   - **Raycasts:** three's `Raycaster` doesn't skip hidden objects, so a root-scene raycast hit a
     batched member's hidden mesh before (and the batch at the same distance); now it hits only
     the batch. New public `getMergeMemberAtBatchId(groupEntityId, batchId, world?)`
     (`MergeMemberEdit.ts`, on `aekasha/merging`: a walk of the group's members, no allocation)
     maps a hit's `batchId` to its member. Its Hub mention is Phase 4's (the Mesh merging page's
     picking). A baked group's hidden members are still hit by a root-scene raycast (unchanged,
     p372's).
   - **Measured** (`--only "engine,batch grouped none,engine nocull,batch grouped none nocull"`,
     every case containing those names, 3 runs each, before and after on the same day; the
     hand-built batch's rows don't run the engine's code, so they show the run's drift). WebGL2,
     CPU frame (render submit), engine against the hand-built batch in the same run:

     | Case          | Before: engine / batch | After: engine / batch | Gap before → after |
     | ------------- | ---------------------: | --------------------: | -----------------: |
     | still         |  1.26 (0.87) / 0.78 (0.61) | 1.10 (0.61) / 0.87 (0.67) | 0.48 → 0.23 ms |
     | still, nocull |  0.98 (0.56) / 0.76 (0.45) | 0.82 (0.32) / 0.73 (0.45) | 0.22 → 0.09 ms |
     | shadow        |  1.37 (1.05) / 0.86 (0.74) | 1.06 (0.73) / 0.94 (0.81) | 0.51 → 0.12 ms |
     | move 10 %     |  1.40 (0.91) / 0.88 (0.66) | 1.19 (0.64) / 0.88 (0.66) | 0.52 → 0.31 ms |
     | inside        |  2.11 (1.53) / 1.26 (0.93) | 1.51 (0.84) / 1.31 (0.97) | 0.85 → 0.20 ms |

     The render submit gap is gone in every case (the scene update no longer walks the members);
     what's left is the sync's version checks and `object3DSyncSystem` (Phase 1's profile: 0.08
     and 0.05 ms). Kinematic, every member a moving body: 4.96 → 4.67 ms on WebGL2, 5.11 → 4.74
     on WebGPU (render submit 0.42 → 0.25 and 0.48 → 0.34). WebGPU's pages switch between two
     clock states (the sync's pure-JS time 0.09-0.10 ms on a fast page, 0.33-0.40 on a slow one;
     §2's noise): on the fast pages `engine` is 0.66-0.81 ms against the hand-built 0.55-0.60, its
     render submit 0.40-0.45 against 0.45 (1.06-1.20 before); `engine nocull`'s three pages all
     ran slow (1.92-1.94, sync 0.39), so its row isn't a result. No errors but WebGL2's known
     shadow `.toInspector()` warning (§2), the same before. Draws unchanged (23 / 4). Kept.
   - **Tests:** `MergeBatchDetach.test.ts` (out with the build, a baked member stays, a waiting
     member stays until its build, back on a leave and a dissolve, out through a rebuild, a
     deleted member's not put back; a raycast hits only the batch and `getMergeMemberAtBatchId`
     maps it, undefined for a freed or unknown id and a baked group), and
     `_dbg__MergingBatched.test.ts`' "Show unmerged" checks the meshes' place both ways.

   **S2 results** (2026-11-11):
   - **The seam** (`kernel/ecs/LodTargets.ts`): `LodMeshDrawDelegate` (`isDrawing`,
     `applyLevel(entityId, world, level, fade)`, `setCulled(entityId, world, isCulled, fade)`,
     `setFade(entityId, world, progress)`), `setLodMeshDrawDelegate` and
     `getLodMeshDrawDelegateFor` (the delegate when it draws the entity now), all `@internal`.
     `LodFades.ts`: `applyMeshLevel` always sets the level on the mesh, then for a delegated entity
     calls `applyLevel` instead of making a fade copy; `setMeshCulled` hands a delegated entity's
     cull to `setCulled` (with or without a fade: the plain path relies on the visibility
     reconcile, which the batch doesn't read); `drawFade` ends the mesh's own copies first (a fade
     it started before it was delegated), then calls `setFade`. `LodSystem.ts`: the `LOD`'s remove
     hook shows level 0 through `applyLevelTo` (so the delegate hears it), the delete hook ends the
     fade through `drawFade` (`setFade(1)`). The delegate's `setFade` may come for a fade it didn't
     start; without one it does nothing. Not registered by merging yet (S3): until then a batched
     member's LOD swaps its detached own mesh and the batch keeps the geometry it joined with.
   - **The refusals** (`MergeEligibility.ts`): `BAKED` refuses a `LOD` ("it has a LOD (a BATCHED
     group draws its levels)"); `BATCHED` takes one when `getBatchLodRefusal(mesh, lod._levels)`
     passes: each resolved level's material and `castShadow` the mesh's, its geometry agreeing
     exactly with the mesh's (`getBatchMismatch` now names what it compares against, `owner`). The
     mesh agrees with the group, so every level does. Levels not resolved (no `lod()`) check
     nothing. `AUTO`'s `BATCHED` merge checks before a bucket, as for the other refusals.
   - **A later LOD** (`checkBatchedMemberLod`, `MergeGroups.ts`): a `LOD` add hook registered only
     when `ctx.isInstalled('lod')` (so after `lod()`'s, which resolves the levels); a batched member
     whose new levels its batch can't draw leaves its group (`removeFromMergeGroup`), warned
     (`Merge group "<id>": entity N leaves it, drawn on its own: <reason>.`) and recorded as a
     refusal for the Merging tab. A baked member's later LOD is left alone, as before.
   - **Tests:** `features/lod/LodMeshDrawDelegate.test.ts` (7: the plain path's fade copy and its
     disposal, which no unit test covered before; a delegated level change with its fade steps, a
     cull fading out and in, no fades, the remove and delete hooks, an entity leaving the delegate
     mid-fade and one joining it mid-fade, its plain copy disposed) and
     `features/merging/MergeBatchLod.test.ts` (10: the refusals at a join, `AUTO`'s, a later LOD
     kept, refused and left alone on a baked member). `yarn test` 3 253 passed; lint, both `tsc`,
     the docs ratchet clean.
   - **`yarn sbp` fails two budgets by 0.2 kB each:** `_engine/features/merging` 9.2 kB against
     9 KiB (8.9 before S1: S1's detach and S2's checks, about +0.35 kB) and the initial download
     393.2 kB against 393 KiB. **Decided (2026-11-11):** raised, `merging` 9 → 10 KiB and the
     initial 393 → 394 KiB (`sbp.config.ts`, with the reason), rather than moving the checks into
     the lazy chunk (about 0.25 kB saved, the join's refusal moved to the build, and S3's stubs
     over again). S3's and S4's first-download parts stay forwarding stubs, the batch side lazy.
     `assets/index.js` is 388.9 of its 389 KiB: watched in S3.

   **S3 results** (2026-11-11):
   - **Built:** `batchMemberLodDelegate` (`MergeBatchFront.ts`, forwarding stubs; set by merging's
     install, whatever its order with `lod()`): it draws a member with an instance and
     `TAG_MERGED` (one shown unmerged keeps the LOD's plain path). `MergeBatch.ts`: the batch holds
     every member's level geometries (`collectGeometries`, `addGeometries`: a build sizes and adds
     them, the unshown levels too; a LOD that came after the build adds its levels at its first
     apply); `applyBatchMemberLevel` swaps the instance's geometry in place
     (`setInstanceGeometry`: `setGeometryIdAt`, `geometryAt`, the order dirty, the sphere grown);
     `setBatchMemberLodCulled` hides or shows it (`isBatchMemberShown` now counts `TAG_LOD_CULLED`
     unless `TAG_LOD_TRANSITIONING`); `setBatchMemberFade(1)` hides a cull faded out;
     `refreshBatchMember` (`TAG_MERGED`'s add hook) gives a member merged again the level and
     visibility its own mesh got meanwhile. A faded level change switches at once until S4.
   - **Found:** `addSystem` runs higher orders first, so `MERGE_BATCH_SYNC` (-0.25) runs before
     `LOD_SELECTION` (-1.5), not after (this phase's proposal had it the other way): a frame's swaps
     are counted and compacted in the next frame's sync, one frame of extra WebGPU draws after a
     burst of swaps. Accepted (no extra per-frame system); `SystemStages.ts` says so.
   - **Tests:** `MergeBatchLod.test.ts` (20, 10 new: the levels in the batch, a swap in place and
     back, a faded swap at once without a copy, swaps splitting the runs and the next frame's
     compaction, a later LOD's levels added at its first apply, a rebuild keeping the levels and a
     leave showing it, a member merged again taking its mesh's level; culling hiding the instance
     and never the batch, a cull fading out kept until its end, a culled member hidden through a
     compaction and a `DISABLED` round trip). `yarn test` 3 263 passed; lint, both `tsc`, the docs
     ratchet clean. Not yet in a browser (S6's scene).
   - **`yarn sbp`:** `merging` 9.4 kB (of 10 KiB), the lazy `MergeBatch.js` 2.7 → 3.1 kB, the
     initial 393.4 kB (of 394); `assets/index.js` 389.1 kB went over its 389 KiB: raised to 390 KiB
     with the initial's reason (S2's decision; Phase 1 raised the two together).

   **S4 results** (2026-11-11):
   - **Built:** `MergeBatchFades.ts` (`createBatchFades`: a square `RedFormat` float texture of the
     batch's instance capacity, opaque, its node a `textureLoad` at three's `batchIndirectIndex`
     with a width uniform, registered with `setObjectLodFadeNode` before the batch's first build;
     grown by swapping the node's texture and width, so one node and the same shader code a batch;
     `setInstanceFade` writes one and flags the upload only on a change) and `MergeBatchLod.ts`
     (the delegate's work, moved out of `MergeBatch.ts`, which stays at 672 lines: a level fade's
     second instance with the outgoing geometry, `MERGE_MEMBER._fadeInstanceId`; cull fades;
     `MERGE_MEMBER._lodFade` the fade the batch draws; `endBatchMemberFade` for "Show unmerged").
     `MergeBatch.ts`: the fades in `BatchState`, `growInstances` and `deleteFadeInstance`, the
     second instance through the sync (its matrix), `setBatchMemberVisible`, a leave or delete and a
     compaction (each member's fade carried to its new id; the second instances stay put). The
     loader loads `MergeBatch.ts` and `MergeBatchLod.ts` together (two lazy chunks, 3.5 and 0.7 kB).
   - **Found (a Phase 1 bug):** three r187's `BatchedMesh.setInstanceCount` replaces the batch's
     indirect, matrices and colour textures, but `RenderObjects.get` rebuilds a render object only
     when its material's version (or its environment) changed, so a drawn batch kept reading the
     old textures. Seen in the browser check: mid-fade, the batch had grown (2 516 → 3 971) and
     the outgoing instances (ids past the old capacity) read nothing. Phase 1's joins past a drawn
     batch's capacity had the same fault (no browser check covered them). Fixed in
     `growInstances`: the material's `needsUpdate` after `setInstanceCount` (only the batch's cache
     key changed, so only it rebuilds). A three issue to report upstream, not filed.
   - **Browser check** (a scratch Playwright script on the bench's helpers, both backends,
     `?bmsWay=engine|separate&bmsLod=3&bmsCamera=inside&bmsShadow=true`; `?bmsLod` and
     `__aekBms.lod({ bias, fadeSeconds })` added to the scene for it, S6 extends them): settled,
     then 20 s fades started by a bias of 0.15 and shot 7 s in. No errors (Rapier's deprecated init
     warning only). The engine's batch held 3 865 instances (1 865 fading members' second
     instances): 473 merged draws on WebGPU until the fades end. Engine against separate: 0.08 %
     of pixels over 8/255 settled and 0.12 % mid-fade on both backends (the fade's progress differs
     a little between the pages): the batch dithers like separate meshes, the shadows too.
   - **Tests:** `MergeBatchLod.test.ts` (28, 8 new: a level fade's second instance and its steps
     and end, the dithered material, the second instance moving and hiding with the member, a
     compaction mid-fade, a leave, a delete, "Show unmerged" and a rebuild mid-fade, a cull fade
     out and in, the fade texture and its growth, a grown batch's rebuild). `yarn test` 3 271
     passed; lint, both `tsc`, the docs ratchet clean. `yarn sbp`: every budget passes (`merging`
     9.4 of 10 KiB, the initial 393.4 of 394, `assets/index.js` 389.2 of 390).

   **S5 results** (2026-11-11):
   - **Built** (debug code only, `_dbg__` modules): `getMergeBatchFigures` adds `batchInstances`
     (three's `instanceCount`: the members' and the level fades' outgoing instances),
     `levelGeometries` (held geometries that are a member's LOD level), `lodMembers`, `levelFades`,
     `cullFades` and `lodCulled`. The tab's row adds ", N fading" only while some fade (a group
     without fades reads as before: no tab shot changes). The group window's Batch row counts the
     LOD levels and the batch's instances (was the members'), and a LOD row ("2 members with a LOD:
     2 level fades, 0 cull fades, 0 LOD culled", or "no member has a LOD"). The member window: the
     state "LOD culled: its instance hidden", and a LOD row (`getMemberLodText`) only on a batched
     group's member or a member with a LOD (largeWorld's member window shot keeps its rows): "level
     1 of 2, fading from level 0 (instance #3), 17%", "… fading out to LOD culled" / "fading in
     from LOD culled", "a fade it came with: drawn whole until it ends", "LOD culled"; a baked
     member's later LOD "on its own mesh (not drawn: its group draws the geometry it joined with)".
     The LOD window's Kind is "mesh, drawn by its merge batch" while the delegate draws it (through
     the kernel's `getLodMeshDrawDelegateFor`: no merging import); the LOD overlay's loop is
     `writeLodOverlayBoxes(world, targets)`, exported for the tests.
   - **Found (fixed):** the merging overlay culled a batched group whole when the batch's
     `instanceCount` equalled its members: with level fades' outgoing instances that can hold
     while a member still waits for its build, so a waiting member in view outside the batch's
     sphere wasn't outlined. It counts the members with an instance now. It also skips a member
     the LOD culled (its instance hidden; one fading out is still outlined).
   - **Checked:** the LOD overlay and window over batched members whose own meshes are out of the
     scene graph: boxes at their own meshes' poses (moved too), coloured by level, none once
     culled; the window's state and distance as for a plain mesh; "Show unmerged" makes it a plain
     mesh again. Nothing needed changing in the LOD tab's figures (its counts are the selection's).
   - **Tests:** `debug/_dbg__MergingBatchedLod.test.ts` (10; the cull-whole test fails with the old
     count). `yarn test` 3 281 passed; lint, both `tsc`, the docs ratchet clean. Not in a browser
     (S6's scene).

   **S6 decisions** (2026-11-11):
   - **D1's fallback decided: per backend and LOD.** A smoke run of the dolly (`?bmsLod=3&bmsDolly=true`,
     one run, 120 frames) found the engine's batch compacting every frame (60 a second; its sync
     bracket 1.4 ms against 0.09 still, so a compaction is ~1.3 ms at 2 000 members, not §3's 0.4)
     and ending at 180 runs of 58 geometries in use: compaction leaves the level fades' second
     instances in place, and ~180 members always fade, so the runs never fell under twice the
     geometries. With a range `customSort` on top (still compacting) WebGPU drew 60 instead of 240
     (CPU 2.98 against 2.58 ms: the sort ~0.4 ms a pass). WebGL2 drew 2 either way. So a batch's
     `order` (`MergeBatch.ts`' `BatchOrder`): `NONE` on WebGL2 (no compaction, no sort: its
     multi-draw is one draw in any order), `COMPACT` on WebGPU, and `RANGE_SORT` on WebGPU once a
     member has a LOD (at the build, or a later LOD's first apply; for good), three sorting each
     pass by geometry range then depth. Compaction still carries fades (a batch can compact
     before its first LOD). Without a renderer (the tests) a batch is drawn as on WebGPU.
   - The smoke run's exit margin, before the change: dolly separate 9.41 ms against engine 2.58
     (WebGPU), 8.64 against 2.41 (WebGL2); mid-fade (S4's check) 17.6 against 1.9 ms.

   **Phase 2's S6 results** (2026-11-11; Phase 0's machine and setup, §2's Results):
   - **Built:** `?bmsDolly=true` in `batchedMeshSpike` (OVER only: the camera eases from (0, 95,
     110) to (0, 45, 50) and back every 10 s of app-loop time, looking at the centre, so the
     levels' bands sweep the field); the probe's per-frame LOD swaps and fading members
     (`getLodFrameStats`), the batch's merged draws, the swaps a second and `engineGroup()`; the
     bench's `lod still`, `lod dolly` and `lod dolly shadow` cases (separate and engine, `?bmsLod=3`)
     and the `check: lod fades` pair (S4's mid-fade shot, now diffed by the bench), the engine
     batch's runs, geometries in use and compactions read from the page's own `MergeBatch.ts`
     (the resource entry, `setResourceTimingBufferSize`); `scenes.config.ts`' `lodSeparate` and
     `lodEngine` variants. A range sort set by the scene on the engine's batch (the smoke run's
     comparison) went with D1's decision: the engine sorts a LOD batch itself.
   - **CPU frame** (medians of 3 runs, 120 + 300 frames; separate LOD meshes → engine batch):

     | Case               | WebGPU (ms)          | WebGL2 (ms)          |
     | ------------------ | -------------------: | -------------------: |
     | still              | 6.45 → 1.23 (−81 %)  | 5.50 → 1.25 (−77 %)  |
     | dolly              | 7.70 → 2.93 (−62 %)  | 5.34 → 1.40 (−74 %)  |
     | dolly, sun shadow  | 10.77 → 3.33 (−69 %) | 12.00 → 1.39 (−88 %) |
     | mid-fade (1 865)   | 14.89 → 3.86 (−74 %) | 16.59 → 1.51 (−91 %) |

     The engine's WebGPU dolly spread is 1.30-3.12 ms (§2's two clock states); WebGL2's spreads are
     under 0.05 ms. The dolly swaps ~340 levels a second with ~75 members fading, the same counts
     both ways. GPU time is about the same (WebGPU dolly 3.78 / 3.92 ms; WebGL2's timer unreliable,
     §2).
   - **Draws** (WebGPU): the engine's batch 55-58 merged draws for 58 geometry-levels in use on the
     dolly (the scene's 56 in all, 115 with the shadow), 55 still, 50 mid-fade, against separate
     meshes' 1 601-4 802; no compaction. WebGL2: 2-7 draws in the scene.
   - **Fades:** mid-fade, the engine's shot differs from separate meshes' by 0.17 % of pixels
     over 8/255 on WebGPU and 0.16 % on WebGL2 (the same in all 3 runs; S4's 0.12 % was by eye of
     one page each). The scene runner's still `@lodEngine` against `@lodSeparate`: no pixel over
     8/255 (max delta 2) in all three physics targets. No pops: a faded level change and a cull
     fade are the unit tests' (`MergeBatchLod.test.ts`).
   - **Memory** (the LOD levels in the batch): 60 geometry slots (20 geometries × 3 levels) in
     10 842 of 13 553 reserved vertices and 48 927 of 61 159 indices. The scene's levels are made
     on their own (not a shared-vertex chain), so the duplicated chain vertices of Phase 2's
     decision weren't measured here: sharing them through `BatchedMesh`'s private `_geometryInfo`
     stays a follow-up for a scene with chains.
   - **Checks:** `yarn test` 3 284 passed; lint, both `tsc`, the docs ratchet clean. `yarn sbp`:
     every budget passes (`merging` 9.4 of 10 KiB, the initial 393.4 of 394, `assets/index.js`
     389.2 of 390; the lazy `MergeBatch.js` 3.7 kB, `MergeBatchLod.js` 0.7 kB). `yarn
     verify:baselines`: Phase 2's bundle growth and `@internal` exports, and `getMergeMemberAtBatchId`
     on `aekasha/merging`; no debug code in the production build; recorded (`--update`).
     `yarn verify:scenes --only batchedMeshSpike`: all 28 runs load without errors (new: the scene
     has no recorded baselines), the probe hashes equal per pair.
   - **Exit: met** on both backends (≥ 30 % CPU, WebGPU draws one per geometry-level in use, fades
     matching separate meshes).

   **As built** (Phase 2; the detail is `features/merging/CLAUDE.md`'s "The mode" bullet): S1 a
   batched member's own mesh out of the scene graph and `getMergeMemberAtBatchId`; S2 the kernel's
   mesh draw delegate (`kernel/ecs/LodTargets.ts`) and `BATCHED`'s LOD refusals; S3 level swaps in
   place and LOD culling; S4 the batch's fade texture and a level fade's second instance; S5 the
   debugger's LOD figures and the overlay's cull-whole fix; S6 the batch's order (D1's fallback:
   `RANGE_SORT` for a LOD batch on WebGPU, `NONE` on WebGL2) and the exit. Tests:
   `MergeBatchDetach.test.ts`, `MergeBatchLod.test.ts`, `features/lod/LodMeshDrawDelegate.test.ts`,
   `debug/_dbg__MergingBatchedLod.test.ts`.

3. p309's decal pools on batched groups (if p309 has shipped, port;
   if not, p309 uses this). p309 hasn't shipped (2026-11-11: draft, blocked by p306, p304 and
   p307), so Phase 3 builds what its runtime pools (its D4) use and checks it with a stand-in pool.
   **Grounding** (r187, read 2026-11-11): merged draws join only entries of equal start and count,
   so only instances of one geometry merge: a pool of 128 conformed patches (a geometry each) is 128
   draws on WebGPU inside one render object, one multi-draw on WebGL2; a batch never freed a
   geometry (`BatchState.geometryIds` held each for good, its buffers growing with every new one);
   `BATCHED` refused transparent members, and p309's default is `BLEND`; three's batch colour is a
   `vec4` multiplied into the material's vertex colour, so `setColorAt`'s alpha fades a `BLEND`
   decal, but `_colorsTexture` appears at the first `setColorAt` (a drawn batch's render object
   must rebuild, S4's `growInstances` trap).
   **Decisions** (2026-11-11): (1) a decal is a member entity (a mesh with `merge: { group, mode:
   'BATCHED' }`), the pool an explicit batched group: scene ownership, `DISABLED`, per-member
   culling, the debugger, picking and Phases 1-2's r187 fixes come with it; (2) geometry slots
   (D5): a geometry no instance uses frees its slot (the batch drops it), a new one reuses a free
   slot it fits (`setGeometryAt`) before `addGeometry`; the group setting `geometryReserve: {
   vertices, indices }` sizes every slot alike (a FIFO pool's), and `updateMergeMember` on a
   batched member rewrites its geometry's slot, so a pool can keep N registered geometries and
   rewrite them; (3) `BATCHED` takes a transparent material, the group setting `transparentOrder:
   'DEPTH' | 'JOIN'` (default `DEPTH`, three's back to front; `JOIN` draws in join order, newest on
   top, for decals) orders it, and a member's `renderOrder` must be the batch's; (4)
   `setMergeMemberColor(entityId, color, opacity?, world?)` on `aekasha/merging`, batched members
   only (a baked one warns), written only on a change, no allocation. Out of scope (p309's): the
   toolkit pool (`createDecalPool`, `spawnDecal`, terrain patches, ribbons), atlases and material.
   A `merging` budget over 10 KiB stops for a decision.
   **Sections** (each stopped for review):
   - S1 — geometry slots: instance counts per geometry (members, LOD levels, fade second
     instances), a freed slot and its reuse by fit, `geometryReserve` (schema too),
     `updateMergeMember` rewriting a batched member's slot (a geometry past its reserve warns);
     three's per-geometry bounds after `setGeometryAt` checked. Tests: `MergeBatchSlots.test.ts`.
   - S2 — transparent batched groups: the refusal lifted for `BATCHED`, `transparentOrder` as
     `customSort`s (depth, or a join sequence per member), a transparent batch sorted on both
     backends and never compacted, the `renderOrder` rule.
   - S3 — `setMergeMemberColor` (a first-download stub, the work lazy), the colours texture's first
     appearance rebuilding the render object, colours kept through growth and compaction; JSDoc
     with `@example`.
   - S4 — the debugger: slots (in use, free, reserve), the transparent order, coloured members.
   - S5 — the exit: a decal stand-in in `batchedMeshSpike` (`?bmsDecals=blend|cutout`: conformed
     grid patches on a heightfield ground, spawned FIFO into a pool of 128 or 512, faded by
     opacity) against separate meshes in the bench (CPU frame, spawn cost, draws, buffers stable
     over a long churn), `scenes.config.ts` variants, `yarn sbp`, `yarn verify:baselines`,
     `yarn verify:scenes`; then p309's D4, its Phase 4 exit and its risk row rewritten from the
     results (the single-geometry pool kept or dropped). **Exit:** ≥ 30 % CPU frame against
     separate meshes on both backends, buffers that stop growing over 10 minutes of churn, `BLEND`
     decals matching separate meshes in a pixel diff.

   **S1 results** (2026-11-11):
   - **Built:** `MergeBatchSlots.ts` (in `MergeBatch.ts`' lazy chunk; `MergeBatch.ts` stays at
     ~750 lines): `BatchState`'s `slotGeometries`, `slotInstances`, `slotIsLevel` and `freeSlots`;
     `setInstanceSlot` (every instance add, delete and geometry change in `MergeBatch.ts` and
     `MergeBatchLod.ts` goes through it; a compaction only permutes, so it doesn't), a slot left
     with no instance freed (the batch drops the geometry) unless it holds a member's LOD level
     (`markLevelSlots` at a build and a later LOD's first apply; kept until a full build);
     `addGeometries` moved here, a new geometry taking the best-fitting free slot (the fewest
     reserved vertices, `setGeometryAt`) before `addGeometry`. Freed slots stay active in three
     (its `deleteGeometry` would let `addGeometry` reuse the id and append: the spike's leak).
     `geometryReserve: { vertices, indices? }` (`MergeGroupSettings`, the type
     `MergeGeometryReserve` on `aekasha/merging`, the scene's group entry: strict, positive
     integers, `BATCHED` only; `createMergeGroup` throws the same). `updateMergeMember` on a
     batched member (`updateBatchMemberGeometry`): a mesh with another geometry has its instance
     take it; changed data rewrites the slot (`rewriteGeometry`, bounds measured first: three
     keeps a copy of the geometry's own), or past the reserve moves it, every instance of it with
     it, to a slot that fits. The decision's "a geometry past its reserve warns" became that move,
     without a warning: nothing is lost, and the old slot is free for the next geometry.
   - **Tests:** `MergeBatchSlots.test.ts` (13: a slot freed and a shared one kept, reuse in place
     with the buffers unchanged, the best fit and a new slot, a full build without free slots, a
     freed slot not drawn (three's merged draws), a FIFO churn of 200 rounds with
     `geometryReserve` and 100 without (one buffer size throughout), a geometry past the reserve,
     `updateMergeMember`'s rewrite, move and new geometry, `geometryReserve`'s throws),
     `MergeBatchLod.test.ts` (+1: a level's slot kept with no instance, until a full build),
     `MergingSchema.test.ts` (+1). `yarn test` 3 299 passed; lint, both `tsc`, the docs ratchet
     clean (merging's exports 162 / 162).
   - **`yarn sbp`:** every budget passes: `merging` 9.5 kB of 10 KiB (+0.1), the lazy
     `MergeBatch.js` 3.7 → 4.3 kB, the initial 393.6 kB of 394 KiB, `assets/index.js` 389.4 of
     390. `yarn verify:scenes --only batchedMeshSpike` (a regression check: S1 changes every
     batch's bookkeeping): all 28 runs load without errors (the scene still has no recorded
     baselines), the kinematic probe hash `2fd77609` for both ways and all three targets, and the
     snapshot pairs as Phase 2's: engine against the hand-built batch and `@lodEngine` against
     `@lodSeparate` max delta 2, engine against separate 0.001 % over 8/255;
     `@kinematicEngine` against `@kinematicSeparate` max 6 in two runs but one `mainThread` page
     at 0.002 % (max 32), which the second run didn't repeat (the interpolated poses' frame timing).
     **For S2-S3:** the initial download has 0.4 kB left, so their first-download parts
     (`setMergeMemberColor`'s stub, the transparent rule) may cross it.

   **S2 results** (2026-11-11):
   - **Built:** `MergeEligibility.ts` refuses a transparent material in a `BAKED` group only (the
     reason now points at `BATCHED`), and a `BATCHED` member whose `renderOrder` isn't the
     group's first member's (`getGroupMesh` in place of `getGroupGeometry`); the batch takes that
     `renderOrder`. `BatchOrder` gains `DEPTH` and `JOIN`: a batch whose group's material is
     transparent gets its group's `transparentOrder` (`MergeTransparentOrder` on
     `aekasha/merging`, the schema's group entry, `createMergeGroup`'s throw), sorted every pass on
     both backends (WebGL2's multi-draw follows the sorted list) and never compacted; a LOD member
     leaves it (`noteBatchLodMember` turns only `COMPACT` into `RANGE_SORT`). `DEPTH` is three's
     own sort (`customSort` null), `JOIN` a per-batch `customSort` (`createJoinSort`, made once a
     batch) by `BatchState.joinSeq`, each instance's member's `MERGE_MEMBER._joinSeq`: given at the
     member's first build in `group.members`' order (`assignJoinSeqs`, before the build groups by
     geometry, one module-wide count), kept through a rebuild, carried by a compaction and to a
     level fade's outgoing instance. three types `customSort`'s items without `index`, which its
     render list sets: the sort reads it through a cast. The debugger's `order` type widened only
     (S4 shows the new orders).
   - **Tests:** `MergeBatchTransparent.test.ts` (7: `BAKED` refusing and `BATCHED` taking a
     transparent member; `DEPTH` back to front and `JOIN` in three's draw list (the indirect ids),
     through a newcomer in a freed id and a rebuild; sorted on WebGL2, not compacted at 5 runs of 2
     geometries, a LOD member leaving the order; an opaque batch's `COMPACT` / `NONE`;
     `renderOrder`; the throws), `MergingSchema.test.ts` (+1). `yarn test` 3 307 passed; lint, both
     `tsc`, the docs ratchet clean (merging's exports 163 / 163).
   - **`yarn sbp`:** every budget passes: `merging` 9.6 kB of 10 KiB (+0.1 on S1), the lazy
     `MergeBatch.js` 4.5 kB (+0.2), the initial 393.7 of 394 KiB, `assets/index.js` 389.5 of 390.
     `yarn verify:scenes --only batchedMeshSpike` after S1 (before S2's commit, `aa4e93ac`): see
     S1's results.

   **S3 results** (2026-11-11):
   - **Built:** `setMergeMemberColor(entityId, { color?, opacity? }, world?)` and
     `MergeMemberColorOptions` on `aekasha/merging` (`MergeMemberColor.ts`, its own module: a build
     drops it until an app calls it, so the first download didn't change). The options object, not
     an optional positional `opacity` (the coding standards: `world` is the only optional
     positional parameter); an option left out keeps the member's. Kept on `MERGE_MEMBER._color`
     (made at the first colour other than white and opaque, then changed in place), written only on
     a change; the batch side is `writeBatchMemberColor` / `writeMemberColor` (`MergeBatch.ts`):
     every new instance (a member's, a compaction's ids, a level fade's second instance) is written
     its member's colour, or white and opaque once the batch has colours. **Found:** three r187's
     `addInstance` resets a reused id's colour with a `Color`, which writes RGB only, so a
     faded-out member's alpha 0 would hide the next member in its id (a FIFO pool's every spawn).
     The batch's first colour sets the material's `needsUpdate` (S4's `growInstances` trap: the
     shader reads `batchColor` only when the colours texture was there at its build);
     `setInstanceCount` copies the colours, so growth keeps them. A baked member or an entity in no
     group warns.
   - **Tests:** `MergeMemberColor.test.ts` (6: the options kept, a write per change and one shader
     rebuild, a waiting member, a freed id's newcomer white and opaque, a compaction, a rebuild and
     growth keeping each member's colour, the warnings), `MergeBatchLod.test.ts` (+1: a level
     fade's second instance takes the colour, set before and during it). Removing the white reset
     or the `needsUpdate` fails its test. `yarn test` 3 314 passed; lint, both `tsc`, the docs
     ratchet clean (merging's exports 167 / 167, the `@example` included).
   - **`yarn sbp`:** every budget passes, the first download unchanged (`merging` 9.6 kB, the
     initial 393.7 kB); the lazy `MergeBatch.js` 4.6 kB (+0.1).
4. Docs (the Hub's Mesh merging page and `features/merging/CLAUDE.md`, a `lodShowcase` lane if
   per-member LOD lands), versioning (engine minor).

## 5. Risks

| Risk                                          | Mitigation                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| No CPU win worth the code on WebGPU           | The gate; the spike's numbers stay recorded, and p372/instancing cover the cases  |
| Per-instance features differ between backends | Spike items 4–6 on both backends                                                  |
| Merged draws need grouped members (r187)      | Grouped ids, no sort, compaction past twice the geometry count (D1); range sort the fallback |
| WebGPU gains multi-draw-indirect later        | Fewer draws still for interleaved members; re-run the spike (p370 open question 4) |

## 6. Open questions

1. Should a baked group switch a member into a batch while it's being edited (p373 D4), instead
   of showing its own mesh? Only if editing large groups shows a cost.
