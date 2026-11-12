Status: in progress | Phases 0-1 implemented; Phase 2 dropped (written 2026-11-12 from its stub, proposed from p377's Phase 0, its open question 5)
Category: Merging, Performance
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 3.3)
Related: \_DONE_p377_hlod-streaming-cell-proxies.md (Phase 0 measured the cost; its far field, `?hlodField`, and bench are this plan's measurement), \_DONE_p375_batched-mesh-batches.md (Phase 2 S1 took a batched member's mesh out of the scene graph), \_DONE_p372_mesh-merge-groups.md (the baked groups), \_DONE_p373_merge-debug-and-member-editing.md (edit sessions, "Show unmerged", picking), \_DONE_p353_macro-streaming-grid.md (a streamed member's priming and fades)

# Baked Merge Members Out of the Scene Graph

A baked merge member's own mesh stays in the scene graph, hidden (`TAG_MERGED`), while its group's
mesh draws it, and three walks it on every render. p377's Phase 0 found that walk to be a large
share of what merged content costs: this plan takes it away, for every merged scene, the way p375
took a batched member's mesh out (one mechanism for both modes), after a spike that measures it
against keeping the mesh in the graph with its matrix updates off, and names the rest of the
members' cost (the systems, the submit).

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

## Grounding (checked against the code, 2026-11-12, `main` at 2308fbec: engine 6.9.0, three r187)

**three's walks over a hidden member**

- `Object3D.updateMatrixWorld(force)`: `matrixAutoUpdate` composes the local matrix
  (`updateMatrix`, which sets `matrixWorldNeedsUpdate`), then `matrixWorldNeedsUpdate || force`
  multiplies the world matrix when `matrixWorldAutoUpdate`, and the children are walked with
  `force = true` from there on. The root scene has `matrixAutoUpdate` on (nothing in the engine
  turns it off), so it composes every walk and **forces every descendant's multiply**: a member
  with only `matrixAutoUpdate` off would still be multiplied each walk. "Stay in the graph, stop
  the work" needs both flags off (then a member costs the call, three flag checks and an empty
  child loop).
- Who walks: the renderer's `render` (`Renderer.js`: `if (scene.matrixWorldAutoUpdate === true)
  scene.updateMatrixWorld()`), once for the scene pass and once for PostFX's AO pre-pass
  (`PassNode`'s `renderer.render`); the shadow pass turns the scene's `matrixWorldAutoUpdate` off
  around its own render (`ShadowNode.js`), which is why p377 counted two walks, not three.
- **The projection walk** (`StandardDrawingPipeline.project`, every render: the scene pass, the
  AO pre-pass, each shadow map) returns at `visible === false`, so a hidden member costs one call
  and the check per render, in or out of `updateMatrixWorld`'s work. Out of the graph it costs
  nothing. This is a candidate for the submit's unsplit 0.5-2 ms.
- **Raycasts**: three's `Raycaster.intersectObject` doesn't check `visible`, so a root-scene
  raycast tests every hidden member's bounding sphere and hits its faces (the merging `CLAUDE.md`'s
  Picking: "a baked group's hidden members are still hit next to its mesh").

**p375's batched detach** (`MergeBatchFront.ts`): `TAG_MERGED`'s add hook (`MergeGroups.ts`'
install) calls `detachBatchedMemberMesh` (a member with `instanceId >= 0`: `removeFromParent`,
remembered in a `WeakSet`), its remove hook `reattachMemberMesh` (back under the root scene: a
leave through `releaseMember`, a dissolve, an edit session, "Show unmerged"). A rebuild keeps
`TAG_MERGED`, so the mesh stays out. Both hooks also carry the batch's LOD calls
(`refreshBatchMember`, `endBatchMemberFade`). `MergeBatchDetach.test.ts` tests it.

**Where a baked member's mesh lives.** `createMeshEntity` adds every mesh to the root scene unless
`doNotAddToScene`; `spawnImportedAsset`'s pieces are `createMeshEntity` meshes, so under the root
too (the stub's "an import's pieces" have no other parent); the `merge` prop, `AUTO`, JSON meshes
and streamed cells all go through it. A mesh under another parent comes only from
`addToGroupEntity` (a `doNotAddToScene` mesh) or an app's own `add`. `disposeGroup` (`Group.ts`,
a group entity's deletion) finds the entities to delete by walking `group.children`, so a child
taken out of its group would escape its group's deletion. A member may also have children of its
own (an app's attachment); they aren't drawn today (the projection stops at the hidden parent),
but they're walked.

**The readers of a baked member's mesh, one by one**

- The builds and the in-place writes: `syncMemberPose` (`MergeState.ts`) copies the `TRANSFORM`
  into the mesh and calls `mesh.updateWorldMatrix(true, false)`: with no parent the world matrix
  is the local one, right for a mesh that was directly under the (untransformed) root scene. Used
  by `collectBuildParts` (`MergeBuild.ts`), `rewriteMember` (`MergeInPlace.ts`, which then copies
  `matrixWorld` into `_bakedMatrix`), the batch build, `AUTO`'s cell and edit sessions' begin.
- The moved-member check (`debug/_dbg__MergeGroups.ts`, debug env): `mesh.updateWorldMatrix(true,
  false)`, then compares `matrixWorld` with `_bakedMatrix`. Detached and parentless: the same
  result. (With both auto flags off it would compare a stale matrix and never warn.)
- The overlay (`_dbg__MergingOverlay.ts`): a built member's box is `_bakedMatrix`; its own world
  matrix only while it waits or is in a session (then it's in the graph).
- Edit sessions and "Show unmerged" take `TAG_MERGED` away (the remove hook puts the mesh back
  before its own mesh draws); `endMergeMemberEdit` and the view's end give it back. A `DISABLED`
  member keeps `TAG_MERGED` (collapsed in place): it stays out.
- `object3DSyncSystem` (`MAIN`) keeps copying a dirty `TRANSFORM` into the mesh's position,
  quaternion and scale; nothing composes it until a reader does (`syncMemberPose`), as for a
  batched member.
- Frustum culling (`ObjectFrustumCullingSystem.ts`, opt-in `FRUSTUM_CULLING_ENABLED`):
  `getWorldPosition` updates the matrix itself; a baked member's tag does nothing while merged.
- LOD: a baked member's `LOD` is refused at the join and a later one left alone; `measureEntity`
  reads a parentless mesh as one at the root (p375).
- Streaming: priming (`StreamingPriming.ts`) compiles held objects with
  `renderer.compileAsync(rootScene, …)`: a detached member isn't compiled, which is right (its
  group draws it). The fades (`StreamingFades.ts`) traverse an entity's object and set its fade:
  harmless on a hidden, detached mesh. A cell's unload deletes its entities: `disposeMesh` takes a
  mesh from no parent.
- Raycasts in the engine: the debug Ray tester (`_dbg__RayTesterFire.ts`) casts at the root
  scene's children (it would hit the group only); input picking (`InputPicking.ts`) casts at the
  targets an app passes (a member's mesh passed directly is still tested, at its last world
  matrix, as today). The Hub's "Which member a ray hit" (`hub/pages/features/mesh-merging/
  guide.md`) shows a root-scene raycast with `getMergeMemberAtFace`; `MergeMemberEdit.test.ts`
  picks by a raycast of the group mesh alone.
- Debug traversals of the root scene: the GPU memory catch-all (`InstancedMesh`es only) and the
  profiler's census (repeats the projection's rules, so hidden objects are skipped either way).

**What runs per frame over every member** (the systems' 0.9-1.7 ms, not split yet; the field's
members are plain meshes: no body, no `LOD`, no culling opt-in, out of the spatial index):
`object3DSyncSystem` loops over every `OBJECT3D` entity each frame (`isDisabled`, the typed
store's slot and dirty flag or the `TRANSFORM`'s version), 20,808 iterations for nothing. The
other systems iterate their own components. The split (Phase 0 step 1) times them.

**The measurement** is p377's, on `main`: `devTools/bench/hlodSpike.ts --step draws`
(`hlodSpikeDraws.ts`) on largeWorld's far field (`?hlodField=<sites>`,
`_dbg__largeWorldHlodField.ts`), the probe's `cpuSplitAsync` (`src/app/shared/_dbg__hlodSpikeDraws.ts`:
the root scene's `updateMatrixWorld` wrapped and timed, the scene graph's objects counted, hidden
ones apart).

## Decisions (2026-11-12, written with the plan; D2 and D4 confirmed or changed by Phase 0)

- **D1. A spike first** (Phase 0, as p376's and p377's): app debug modules and the bench only, no
  engine change. It splits the systems and the submit (open question 3), and measures both ways
  (open question 1) on the far field, before the engine changes.
- **D2. Out of the graph, one mechanism for both modes** (open questions 1 and 4; Phase 0 step 3
  confirms it). p375's detach generalized: a member's mesh leaves the scene graph when it gets
  `TAG_MERGED` and its group draws it (batched: an instance; baked: built, `partIndex >= 0`), its
  parent is the root scene and it has no children; `reattachMemberMesh` is unchanged (back under
  the root). Any other member stays in the graph, hidden, as today: no parent or place among the
  children to keep, and a group entity's deletion still finds its children. Why out rather than
  frozen in the graph: out, a member costs nothing in the walk, the projection walks (every
  render: scene, AO, shadows) and a root-scene raycast; frozen, it still costs the call in each,
  and the readers that call `updateWorldMatrix` (`syncMemberPose`, the move check) get a stale
  matrix unless they compose it themselves, which out of the graph they already do (p375). Frozen
  is taken instead only if Phase 0 finds it within 0.3 ms of out at 400 sites on both backends
  (then it keeps the raycast hits and the parents, for no cost).
- **D3. A root-scene raycast hits a baked group's mesh only** (open question 2), as it already
  hits only a batched group's batch: `getMergeMemberAtFace` (baked) and `getMergeMemberAtBatchId`
  (batched) are the way from a hit to its member. Nothing in the engine relies on hitting the
  hidden members; an app's raycast of the root scene loses those hits, a behaviour change: engine
  minor (D6). A member under another parent (D2) is still hit.
- **D4. The systems and the submit are named, then decided** (open question 3): Phase 0 steps 1-2
  time each system and the projection walks. A merged member's share of a system that's 0.5 ms or
  more at 400 sites gets Phase 2 (written from the figures); below that, or when the fix is one
  for every static mesh (eg. `object3DSyncSystem` walking only dirty transforms: a kernel change
  with its own risks), it goes to `p990_follow-ups-from-done-plans.md` with the figures.
- **D5. The second walk is measured, not built here.** One `updateMatrixWorld` a frame instead of
  two (the AO pre-pass reusing the scene pass's) would halve the walk for everything, merged or
  not: a PostFX change for every scene. Phase 0 step 4 measures it; it pays → a follow-up in
  `p990_follow-ups-from-done-plans.md` (Rendering) with the figures.
- **D6. Versions**: engine minor (D3's raycast change; 6.9.0 → 6.10.0), app patch (Phase 0's
  spike modes, 1.24.0 → 1.24.1), Project for the bench's cases, in the last phase.
- **D7. No example scene**: nothing changes on screen; the Hub's Mesh merging page and its
  existing examples carry the change.

## Phase 0 — The split and the two ways (spike) — done

No engine change: app debug modules and the bench, on p377's far field and tools. Apple M2,
Chrome, both backends, the debug env, set up as p377's Phase 0 (the sky at 10:00, clouds held,
1600 × 900, three runs a backend, 120 + 300 frames a case, the views `start`, `far` and `ground`),
at 400 sites, then 150 for the trend. The reference is `members@32` (today), the floor of the
members' cost `proxy@32` (the same draws, no members).

**What the spike adds**

- `?hlodFieldMembers=graph|detached|frozen` (`_dbg__largeWorldHlodField.ts`; default `graph`,
  today's): after the scene step's builds, each field member with `TAG_MERGED` (its
  `OBJECT3D.value`) is taken out with `removeFromParent` (`detached`; put back on the scene's exit)
  or gets `matrixAutoUpdate` and `matrixWorldAutoUpdate` off (`frozen`; on again at exit). Both
  after the builds, so no reader runs on them while measured (static field).
- `cpuSplitAsync` adds, per frame: **each system's time** (the world's stage entries wrapped by
  id for the frames, as the walk is; `ECSWorld`'s `systems` map is private, so the spike reads it
  through a typed cast in its `_dbg__` module, never in the engine), and **the projection walks**
  (the root scene's `StandardDrawingPipeline.project` calls through the renderer's drawing
  pipeline, timed and counted per frame, each render's apart: scene, AO pre-pass, shadow).
- `?hlodFieldWalk=once` (the probe): the root scene's `updateMatrixWorld` wrapped to run once per
  main loop frame (the second call that frame returns at once): what one walk would save (D5).
- The bench's cases: `members@32:detached`, `members@32:frozen`, `members@32:walk-once` beside
  `members@32` and `proxy@32` (`hlodSpikeDraws.ts`), with the image checked against the
  reference's (the field is static, so the three must match it within the noise).

**As built** (where the spike differs from the above; 2026-11-12):

- `?hlodFieldMembers` applies to **every built baked member of the world** (`TAG_MERGED`,
  `partIndex >= 0`: the field's and largeWorld's own 409), with or without a field, not only the
  field's: step 3's "largeWorld without the field" has no field members, and Phase 1 takes every
  member out. It waits for the scene step's builds with a `MAIN` system: the world has members
  (they join at the step, after the scene code), each built and none `TAG_DRAW_HELD` (the step
  lets go of its holds after its builds); a frozen member's world matrix is composed before its
  flags go off. D2's rule decides which are taken (directly under the root scene, no children; the
  rest counted as skipped). The bench waits for `window.__aekHlodMembers.applied`.
- The split is `src/app/shared/_dbg__hlodSpikeSplit.ts`: the system timer (each `systems` entry's
  `fn` swapped for a timed one while `cpuSplitAsync` runs, the probe's own `hlodSpike:` systems
  left out; `systemsTimedMs` is their sum outside `LATE_MAIN`, which runs after the probe's frame
  end), the projection timer (the root scene's top-level `project` calls; its recursion runs the
  original, so the wrapper costs a call per render; a render's kind: another camera than the
  active one is a shadow's, the active one with an MRT the PostFX pre-pass, else the scene pass)
  and walk-once (the frame's first root walk runs, a later one returns and is counted, until a
  system after every other `APP_RENDER_SYNC` one starts the next frame). `performance.now()` is
  coarsened to 5 µs in the cross-origin isolated page: the systems table shows each system's mean
  a frame, not its median.
- The bench: a case is `floor` or a field case with `:detached`, `:frozen` or `:walk-once`;
  `--cases p378` is the list above (`p377` the default), `--reference <case>` the case the others
  are measured against (step 3's largeWorld alone: `--field 0 --cases floor,floor:detached
  --reference floor`). A mode case's image is compared with its base's (the page without the
  mode), the rebuilds run only on a `members` page without a mode, and p377's "what decides"
  leaves the mode cases out. The new tables (`formatMembersParts`): the CPU frame's parts per case
  and view with each run's difference from the reference's (the walk and its skipped calls, the
  projection by render kind, the systems, the submit less walk and projection), each system's mean
  ms a frame per case, and `frozen` against `detached` per view by D2's 0.3 ms.
- Smoke run (20 sites, one view, one run, 30 frames, both backends): 1,365 members detached or
  frozen after one frame, 0 skipped; the scene graph from 1,636 objects to 271 detached; walk-once
  skips one walk a frame; every mode's image 0.00 % changed. Not figures to decide on.

**Steps**

1. **The systems**: the reference and `proxy@32`, each system's median. Which systems the
   members' 0.9-1.7 ms is, and how much of it is per member (expected: `object3DSyncSystem`).
2. **The submit**: the same two cases, the projection walks' time per render and the rest. Which
   part of the submit's unsplit 0.5-2 ms the hidden members' projection is.
3. **The two ways**: `detached` and `frozen` against the reference and `proxy@32`, the CPU frame,
   the walk, the projection, the systems, the image. Then at 150 sites, and largeWorld without the
   field (409 members: `detached` against `graph`, expected under the noise).
4. **One walk a frame**: `walk-once` against the reference (D5).

**What decides.** D2's way stands unless `frozen` saves within 0.3 ms of `detached` at 400 sites
on both backends (then Phase 1 freezes instead, and its steps are written again). Phase 2 is
written or dropped by D4's rule from steps 1-2; D5's follow-up from step 4. The figures go in a
Results subsection here.

### Results

Measured 2026-11-12, Apple M2, Chrome, debug env (`hlodSpike.ts --step draws`): 3 runs a
backend, 120 + 300 frames a case, the views `start`, `far` and `ground`, the sky at 10:00, clouds
held. The figures: `.cache/bench/hlodSpike-p378-400.json`, `-150.json` and `-alone.json`, the full
tables in `.cache/runs/p378-400.log`, `-150.log` and `-alone.log`. Ranges are over the three views;
"saved" is the median of each run against the reference's run of the same index. WebGPU's GPU
figure doesn't decide (p377's Phase 0 As built); WebGL2's GPU lost nothing beyond the reference's
spread in any case, and every image was 0.00 % changed against its base.

**At 400 sites** (20,770 baked members, 22,741 objects in the scene graph; ms):

| | WebGPU | WebGL2 |
| --- | --- | --- |
| The reference (`members@32`): the CPU frame | 9.5-11.8 | 10.8-13.2 |
| its scene walk (two a frame) | 3.1-4.1 | 3.8-4.8 |
| its projection walks (scene + pre-pass + shadow) | 1.4-2.0 | 1.7-2.6 |
| its systems | 2.2-2.3 | 2.2 |
| `members@32:detached`: CPU saved | 3.1-5.1 | 5.0-6.7 |
| its walk / projection | 0.44-0.55 / 0.86-1.00 | 0.34-0.41 / 0.85-0.97 |
| `members@32:frozen`: CPU saved | 1.1-1.9 | 2.6-3.0 |
| its walk / projection | 2.1-2.4 / 1.3-1.8 | 2.2-2.8 / 1.3-2.0 |
| `frozen` against `detached` (CPU, positive = frozen costs more) | 2.2-3.1 | 2.4-3.7 |
| `proxy@32` (the same draws, no members): CPU saved | 4.5-6.2 | 5.8-7.6 |
| `members@32:walk-once`: CPU saved (its walk) | 1.8-3.1 (1.6) | 2.7-3.8 (1.8-1.9) |

- **Step 1, the systems**: the members' systems cost (reference against `proxy@32`, 1.2-1.3 ms) is
  `object3DSyncSystem`: 1.27-1.37 ms a frame with the members, 0.10-0.12 without, so 1.15-1.25 ms
  for 20,770 members (55-60 ns a member a frame, every frame, for no work: nothing is dirty). Out
  of the graph or frozen doesn't change it (1.17-1.52 ms), since the system iterates every
  `OBJECT3D` entity. The rest is small: `spatialIndexRebuildSystem` 0.06-0.07 ms more with the
  members, and the moved-member check (`mergeMoveCheckSystem`, debug env only) 0.08-0.09 ms on
  average.
- **Step 2, the submit**: p377's unsplit 0.5-2 ms is mostly **the projection walks over the hidden
  members**: 0.5-1.0 ms on WebGPU and 0.8-1.6 ms on WebGL2 over three renders (9-25 ns per hidden
  member per render, at the `visible === false` return). `detached` takes all of it (its projection
  equals `proxy@32`'s). What's left of the submit (less the walk and the projection) moves by
  -0.1 to -0.5 ms.
- **Step 3, the two ways**: the walk costs 68-106 ns an object a walk; `frozen` still costs 45-61
  ns an object (the call, the flag checks, the empty child loop), so it saves 40 % of the walk and
  little of the projection. `detached` saves 2.2-3.7 ms more than `frozen` at 400 sites, far past
  D2's 0.3 ms. `detached` comes within 0.8-1.2 ms of `proxy@32`, and that gap is the systems'
  `object3DSyncSystem` (above).
- **At 150 sites** (7,987 members): `detached` saves 1.1-1.4 ms on WebGPU and 1.0-1.4 ms on WebGL2,
  `frozen` 0.6-0.7 ms, `frozen` against `detached` 0.4-0.8 ms. `object3DSyncSystem`'s share is
  0.35-0.39 ms (45-50 ns a member).
- **largeWorld without the field** (409 members, `floor:detached` against `floor`): 0.05-0.21 ms
  saved (the walk 0.11-0.17 ms less), more than the 0.07-0.09 ms expected but within its runs'
  spread in two views; the image is unchanged.
- **Step 4, one walk a frame**: it halves the walk, as expected: one walk at 400 sites is 1.6-1.9
  ms of the reference's 3.1-4.8 ms, and the CPU saved is 1.8-3.8 ms, the image unchanged. Once the
  members are out (Phase 1), the walk at 400 sites is 0.34-0.55 ms, so one walk would save
  0.17-0.28 ms there, and 0.03-0.05 ms in largeWorld alone: about 35-50 ns per object in the
  graph a frame, for every scene.

**Decided after Phase 0** (2026-11-12):

- **D2 stands: out of the scene graph.** `frozen` is 2.2-3.7 ms behind `detached` at 400 sites on
  both backends (0.4-0.8 ms at 150), so Phase 1 is unchanged.
- **D4: Phase 2 is dropped.** The only member share of 0.5 ms or more is `object3DSyncSystem`'s
  (1.15-1.25 ms at 400 sites), and its fix is the kernel's for every static mesh: the system
  iterates every `OBJECT3D` entity each frame to find the dirty ones, so a member's cost is the
  iteration, which a merging-side skip can't avoid (the member is still in the storage it walks).
  The fix (the sync walking only dirty transforms, or the static ones kept apart) goes to
  `p990_follow-ups-from-done-plans.md` with these figures, and is worth a plan of its own: about
  55 ns per static mesh a frame in every scene. The spatial index's and the move check's shares
  (under 0.1 ms) go in the same follow-up, as figures only.
- **D5's follow-up**: one walk a frame halves the walk for every scene (about 35-50 ns per object
  in the graph a frame); with the members out it's 0.17-0.28 ms at 400 sites. A follow-up in
  `p990_follow-ups-from-done-plans.md` (Rendering) with these figures (Phase 4 step 3).

## Phase 1 — A baked member's mesh out of the scene graph — done

The engine change (D2), in the merging feature's first download:

1. `MergeBatchFront.ts`' detach becomes both modes' (`detachMemberMesh`, a small module of its
   own, `MergeSceneGraph.ts`, if the batch front reads wrong with it): leave when the member has an
   instance or `partIndex >= 0`, `object.parent` is the root scene and `object.children` is empty.
   The batch's LOD refresh stays where it is (a baked member has no instance, so it's a no-op).
   `reattachMemberMesh` unchanged. The `TAG_MERGED` hooks' comment and `MergeGroups.ts`' header
   say both modes.
2. The order in `applyBuild` is already right (`partIndex` set before `TAG_MERGED` is added, so the
   hook sees a built member); a rebuild keeps `TAG_MERGED` (stays out); a member in an edit
   session, or of a group shown unmerged, gets no `TAG_MERGED` (stays in).
3. The readers (Grounding) need no change; each is covered by a test (step 4). The moved-member
   check's comment says it reads a parentless mesh.
4. Tests (`MergeDetach.test.ts`, beside `MergeBatchDetach.test.ts`, whose header names both):
   a built baked member is out of the graph, back after a remove, a dissolve, a delete of its group,
   an edit session (and out again at its end), "Show unmerged" (debug) and its end; out across a
   rebuild, a worker build and a `DISABLED` round trip; a member under a group entity and one with
   a child stay in the graph (and the group's deletion deletes the first); a root-scene raycast hits
   the group mesh only, and `getMergeMemberAtFace` maps the hit; `updateMergeMember` and a rebuild
   of a detached member write the same positions as a fresh merge; a deleted detached member
   disposes; the moved-member check still warns for a moved detached member
   (`debug/_dbg__MergeGroups.test.ts`). `yarn test`.

**As built** (2026-11-12):

- The detach is its own module, `MergeSceneGraph.ts` (`detachMemberMesh`, `reattachMemberMesh`,
  the `WeakSet`; its header has D2's rule and why each reader doesn't need the mesh's place). The
  batch front kept only the batch's LOD calls, as `refreshMergedBatchMember` (a member with an
  instance) and `endUnmergedBatchMemberFade`; `TAG_MERGED`'s hooks call the visibility reconcile,
  the batch's LOD call, then the detach or reattach, in the order they ran before.
- D2's no-children rule applies to a batched member too: one with a child (an app's attachment)
  now stays in the graph, hidden, where p375 took it out with its child. Nothing draws differently.
- The tests are `MergeSceneGraph.test.ts` (beside the module, not `MergeDetach.test.ts`): all of
  step 4's list but two, which went to the files that already set them up: "Show unmerged" and its
  end (and a build during it) in `debug/_dbg__MergingUnmerged.test.ts` (the debug env; a `_dbg__`
  module isn't imported outside `_dbg__` files), the moved-member check in
  `debug/_dbg__MergeGroups.test.ts` (its members asserted out of the graph). The new file's tests
  fail 8 of 9 with the detach made batched-only again (the ninth, a member under a group entity
  or with a child staying in, passes either way). `MergeBatchDetach.test.ts`' first test now
  expects a baked member out too.
- The moved-member check's header no longer says the render updated the matrices: the check's
  own `updateWorldMatrix` does, a parentless mesh's being its local matrix.
- `devTools/verify/baselines/api.json` still lists `detachBatchedMemberMesh` and
  `reattachMemberMesh` under `MergeBatchFront.ts`: Phase 3's `yarn verify:baselines --update`
  records the moved and renamed `@internal` exports.
- `yarn test` (354 files, 3 337 tests), lint and `tsc` pass.

## Phase 2 — The members' other costs — dropped

Dropped by D4's rule (Phase 0's Results, "Decided after Phase 0"): the submit's unsplit part was
the hidden members' projection walks, which Phase 1 takes away with the walk. The one system share
over 0.5 ms, `object3DSyncSystem`'s (1.15-1.25 ms at 400 sites), needs a kernel fix for every
static mesh, so it goes to `p990_follow-ups-from-done-plans.md` (Phase 4 step 3).

## Phase 3 — Verification

1. `yarn test`, `yarn verify:scenes` (baselines recorded on `main` first: largeWorld,
   testDebugScene's `p372_grid` and lattice, `exampleMerging`, `batchedMeshSpike`'s variants and
   `lodShowcase`, each image unchanged), `yarn verify:baselines`, `yarn sbp` (merging's 10 KiB
   budget; the change is a few lines).
2. The bench again with the engine change, no spike mode: `members@32` against Phase 0's reference,
   `detached` and `proxy@32`, at 400 and 150 sites, both backends; largeWorld alone. The engine's
   figure should be Phase 0's `detached` within the runs' spread.
3. In the browser (largeWorld, `exampleMerging`): the Merging tab's "Show unmerged" and the pose
   fields' edit session on a baked member, its overlay box, the Ray tester's hit on a group.

## Phase 4 — Hub, docs, versions, done

1. The Hub's Mesh merging page (`hub/pages/features/mesh-merging/guide.md`): "Which member a ray
   hit" (a raycast hits the group's mesh only, both modes), the cost of merged content (the
   members' walk gone, Phase 3's figures). `yarn hub:build`.
2. The merging `CLAUDE.md`: "Out of the scene graph" moved from The mode into Mesh merging (both
   modes, D2's rule), Picking and Integration (D3), Tests; the figures.
3. Phase 0's follow-ups (D4, D5) in `p990_follow-ups-from-done-plans.md`; the p370 epic's Branches
   and PRs row (the bump decided).
4. Versions (D6), `CHANGELOG.md` (Engine, App, Project), `yarn checkVersions --against main`; mark
   the plan done (`git mv` to `_DONE_`, the references in p370, p377 and the merging `CLAUDE.md`).

## Open questions

1. Out of the graph (p375's way, the parent kept) or in it with `matrixAutoUpdate` off: which saves
   more of the walk, and which breaks fewer readers? Both measured at 400 and 150 sites. (D2: out,
   for members directly under the root scene, no parent to keep; "in it" needs both auto flags off;
   Phase 0 step 3 confirms.)
2. The raycast: a baked group's hidden members stop being hit when detached. Is anything relying
   on hitting them (the debugger, the app), and should `getMergeMemberAtFace` be the only way?
   (D3: nothing in the engine; yes, both modes; engine minor.)
3. The systems' 0.9-1.7 ms and the submit's unsplit 0.5-2 ms of the members' cost: what are they?
   (D4: Phase 0 steps 1-2 name them; Phase 2 or a follow-up from the figures.)
4. One mechanism for both modes: p375's batched detach generalized (the parent kept), or each
   mode its own? (D2: one mechanism, generalized; no parent kept: a member under another parent
   stays in the graph.)
5. A member under a group entity keeps today's cost. Worth a phase if an app's kit content is
   built that way (none in the repo is)? Not planned; a follow-up if one shows up.

## Branches and PRs

Its own branch, `p378_baked-members-out-of-the-scene-graph`, from `main` after p377's PR merged
(PR #87, 2308fbec: p376's and p377's bench and far field are on `main`), merged into `main` with
an engine minor and an app patch (D6). The PR opens after Phase 4, when asked.
