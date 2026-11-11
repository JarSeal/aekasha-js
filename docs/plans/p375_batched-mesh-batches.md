Status: in progress | Phase 0 (spike) done, gate passed; Phase 1 implemented
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

2. LOD per member (with p348). Candidate from Phase 1's exit: a batched member's own mesh out of
   the scene graph while it's batched (three's world matrix update walks the hidden member meshes:
   0.22 ms at 2 000 on WebGL2), back in on a leave and in "Show unmerged"; measure with the bench's
   `engine` case against `batch grouped none`. Per-member LOD adds a second instance per fading
   member, so the members' cost matters more there. 3. p309's decal pools on batched groups (if p309 has shipped, port;
   if not, p309 uses this). 4. Docs (the Hub's Mesh merging page and `features/merging/CLAUDE.md`, a `lodShowcase` lane if
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
