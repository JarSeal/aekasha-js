Status: in progress | Phases 0-1 implemented
Category: World, Streaming, Assets
Epic: p350_lod-system-research.md (Tier 2.1)
Related: p372_mesh-merge-groups.md (merge groups stay inside a cell), p376_hlod-merged-cluster-proxies.md (FAR proxies), \_DONE_p346_spatial-domains.md (the cell maths, and the `MANUAL` domain for this plan's Phase 4), \_DONE_p352_physics-simulation-tiers.md (Phase 4 here drives its tiers per cell; it took over p352's Phase 5), \_DONE_p343_deterministic-physics-tier-policy.md (deciding on fixed steps, §6), \_DONE_p348_ecs-lod-selection.md and \_DONE_p351_impostor-billboard-lod.md (what a `FAR` cell shows), p306_terrain-blocks-and-procedural-terrain-meshes.md (blocks are natural cell content; their sizes line up), \_DONE_p345_gpu-memory-and-draw-call-debugger.md (per-cell memory), p420_npc-simulation-tiers.md (NPCs need the cells around the player loaded)

# Macro Streaming Grid

Lets one scene be larger than what fits in memory at once. The world is cut into large square
cells. Each cell's content is loaded, shown at reduced detail, or unloaded depending on its
distance to a focus point (usually the player), through a per-cell state machine with asymmetric
thresholds. Asset ownership, priming and release work per cell, as they already do per scene.

This is **not** a second member grid (p350 §3.1): an unloaded cell has no entities to index. It
uses p346's shared cell maths, a build-time cell manifest, and one spatial domain for "which live
entities does this cell own".

---

## 1. Grounding

- **Scene loading** (`kernel/scene/SceneLoader.ts`, its steps in `src/_engine/kernel/scene/CLAUDE.md`):
  one load at a time, through `tearDownPrevScene` (the features' `exit` hooks: characters, then
  physics entities; the groups, loopers, `clearNonPersistent()`, the `worldCleared` hooks),
  `loadNextSceneAsync` (the cameras, the random streams restarted, the `beforeAssets` hooks:
  physics starts a fresh world (p101); `loadNextSceneAssets`, the scene code, the `created` hooks,
  `createNextSceneObject3Ds`, the previous scene's assets released) and `enterSceneAsync` (the
  `entered` hooks: physics waits for every pending create, `settlePendingPhysicsEntities`, and
  releases its stepping, held since `loadStart`). A feature takes part only through these scene
  hooks (`kernel/scene/SceneHooks.ts`, the `FeatureContext`'s `addSceneHooks`). Everything is per
  scene; nothing can be added or removed in parts.
- **Asset ownership** (`kernel/assets/AssetOwners.ts`): a `WeakMap` from asset to **one** owner
  scene id; cache hits re-tag the asset to the scene getting it (`retagAssetOwner`), a derived
  asset takes its base's (`copyAssetOwner`: LOD levels). `releaseSceneOwnedAssets`
  (`kernel/assets/SceneAssetRelease.ts`) frees what an exited scene still owns and nothing uses
  (ref count 0, no material using it, not a feature's `retainedTextures`, eg. the sky box's).
- **Priming:** `renderer.initTexture(texture)` uploads synchronously (r186); `compileAsync`
  compiles pipelines and is used for mesh `preWarm` (p350 §4). Since three r187 `compileAsync`
  builds up to 16 pipelines at once and yields to the next frame after a fixed 8 ms
  (`_compileYieldInterval`, not configurable, #34816), and node builds are shared across call
  depths (#35014), but GPU pipelines are keyed by the target's sample count, formats and colour
  space, and the PostFX pre-pass has its own MRT build, so a depth-0 compile doesn't spare the
  first PostFX frame (p057 Phase 3 measured ~200 ms on the Gym). `preWarmMesh` therefore compiles
  through the render pipeline's compiler (PostFX: the scene pass's and pre-pass's targets) in
  the engine's compile queue, and every engine render runs with no held target or MRT
  (`src/_engine/kernel/render/CLAUDE.md`'s Pre-warm compiles). Not three's
  `PassNode.compileAsync` (#35168): it holds the pass's target and MRT across the compile's
  yields, so the frames meanwhile render into the pass.
- **Asset worker** (`kernel/assets/AssetsAPI.ts`, the worker in `kernel/assets/worker/`):
  textures and GLTFs load off the main thread when `assets.workerTarget` is `WORKER_THREAD`.
- **p306:** terrain blocks are self-contained square units, 32–256 m, power of two.
- **Determinism (p101):** guaranteed for scene loads, in both worker targets.
- **Physics tiers** (`_DONE_p352`, `features/physics/PhysicsTiers.ts`,
  `features/physics/PhysicsTierPolicy.ts`, on `aekasha/physics`; `features/physics/CLAUDE.md`): a
  `DYNAMIC` `createPhysicsEntity` body can be `FULL`, `STATIC`, `DISABLED` or `REMOVED`
  (detached, ids and state kept engine side, slot freed). `requestPhysicsTier` applies at the
  next `APP_PHYSICS_STEP` sub-step and returns `false` when it refuses.
  The distance policy (`setPhysicsTierPolicy`, `cadence: 'STEPS'` by default, `_DONE_p343`) only
  calls it. What constrains this plan's Phase 4 is in §6.
- **Features opt in** (`src/_engine/kernel/init/CLAUDE.md`, Engine features): this plan is a new
  feature, `streaming()` (`features/streaming/`, its entry `aekasha/streaming`, a
  `StreamingFeature.ts`, its debug modules in `features/streaming/debug/`, a nested `CLAUDE.md`).
  It installs its system and scene hooks through the `FeatureContext`, cooperates with `spatial()`
  (§4.3), `lod()` (§3.3) and `lines()` (§7) through `ctx.isInstalled`, and `requires` none of
  them until a phase needs one. The scene JSON's `streaming` field is its `FeatureSchemaPart`
  (`schemas/FeatureSchemas.ts`), so the gather's feature manifest names it and `InitEngine` fails
  a scene that streams without the feature. A build without it carries none of it; `yarn sbp`
  budgets its folder like the others (`sbp.config.ts`). The kernel changes (§4.2's owner sets)
  stay `@internal` and small. The cell maths (`packCellKey`, `worldToCell`, `cellBounds`) is in
  `features/spatial/CellKey.ts`, `@internal`, and a feature imports no other feature's code at
  runtime (only character → physics): it moves to `src/_engine/utils/` (pure), where `spatial()`
  and p372's `AUTO` groups use it too, in this plan's Phase 1 unless p372 did it first (p370 §13).

## 2. Cells and rings

- A scene opts in with `streaming: { cellSize, rings }` in its `*.scene.json` (or in code before
  load). `cellSize` must be a power of two ≥ 32 m, so p306 blocks tile cells exactly. Cells are 2D
  (x/z); `y` is ignored for cell membership.
- Cell keys are p346's `packCellKey(cx, 0, cz)`, so a cell key means the same in the streaming
  layer, the debug overlays and any spatial domain with the same cell size.

| State      | Default ring (Chebyshev distance in cells) | Content                                        | Physics (p352)                             |
| ---------- | ------------------------------------------ | ---------------------------------------------- | ------------------------------------------ |
| `RESIDENT` | 0–1                                        | everything, all LOD levels                     | bodies by their own policy, usually `FULL` |
| `NEARBY`   | 2                                          | everything; LOD selection decides what's drawn | `STATIC` / `DISABLED`                      |
| `FAR`      | 3–5                                        | the cell's far representation only (§4.3)      | none (`REMOVED` or not created)            |
| `UNLOADED` | beyond                                     | nothing; the manifest entry is known           | none                                       |

- **Asymmetric thresholds.** A cell is promoted when the focus comes within its ring distance, and
  demoted only beyond the ring distance plus `margin` metres (default `cellSize / 4`), measured from
  the focus to the cell's edge, not its centre. Standing on a boundary never thrashes.
- `NEARBY` exists so that a cell's content is loaded and primed (§5) a ring before it can be seen
  up close.

## 3. Content

### 3.1 What a cell holds

Anything in the scene JSON with a position (meshes, imported assets, terrain blocks, scatter,
lights, physics objects once they're in the schema) is assigned to the cell containing its
position, at **build time** (§3.2). Exceptions:

- `streaming: 'ALWAYS'` on an entry keeps it in the scene's base (loaded with the scene, never
  unloaded). Cameras, the sky box, directional lights and anything persistent are base content
  automatically.
- **Oversized content** (bounding radius > `cellSize / 2`, eg. a long bridge, a large building) is
  assigned to every cell its bounds overlap and loaded while _any_ of them is at least `NEARBY`,
  ref-counted across them. This answers p350's worry about oversized members being "silently pinned
  `RESIDENT` forever".

Mesh merge groups (p372) never cross a cell: `AUTO` group cell sizes divide `cellSize`, and an
explicit group whose members span cells is warned about, so a cell unloads its groups whole. A
cell's groups are what p376's HLOD proxies simplify for the `FAR` state (§3.3).

Code-defined content registers per cell: `registerStreamingCellContent({ sceneId, cellKey, load,
unload? })` (one object, the coding standards' options rule; Phase 1 as built), where `load`
returns the created entity ids. That's Phase 1's whole content model, before the JSON path exists.

### 3.2 Build-time manifest

`gatherAppData` writes, per streaming scene, a `__streaming` block into `generatedAppData.json`:
`{ cellSize, base: [assetIds], cells: { [cellKey]: { assets: [ids], bounds, bytesEstimate } } }`.
Loading a cell's set is a lookup, not a runtime spatial query. `bytesEstimate` sums p300's
`__vramBytes` where present, so the debug tab can show the cost of a cell before loading it.

### 3.3 Far representations

A `FAR` cell shows only its cheap stand-ins: p348's coarsest levels with no physics, p351's
impostors or cross-quads, a terrain block's lowest chain level. Which entries have a far
representation is part of the manifest (an entry with `lod` has one; others are simply not shown
in `FAR`). Phase 5; until then `FAR` = `UNLOADED`.

**No popping** (p350 §3, p351 §2.4): a switch between a cell's far representation and its full
content cross-fades with p351's dither, and content a cell creates or deletes while it can be seen
fades in or out (the LOD fade from and to culled) instead of appearing or vanishing. The option is
`streaming.fadeSeconds` (default `AppConfig.lod.fadeSeconds`; 0 = instant), and deleting an
entity that is fading out waits for the fade.

## 4. Runtime

### 4.1 The state machine

Per cell: `UNLOADED → LOADING → LOADED(state) → UNLOADING → UNLOADED`, where `LOADED` carries
`RESIDENT` / `NEARBY` / `FAR`, and moving between those three is a content-level change (§3.3),
not a reload.

- `streamingSystem` at `MAIN`, every N frames (default 10): computes the focus cell, the wanted
  state of every cell in range, and queues transitions, nearest first.
- **Budgets:** at most `maxConcurrentLoads` cells loading (default 2), and entity creation for a
  loaded cell spread over frames under `maxCreateMsPerFrame` (default 2 ms), so a cell never lands
  in one frame.
- **Cancellation:** a `LOADING` cell that's no longer wanted finishes its asset requests (they
  may be shared), skips entity creation, and goes straight to `UNLOADING`. Each transition carries a
  generation counter, so a late result from a cancelled load is ignored.
- Nothing streams while a scene loads (`loopState.isLoadingScene`, `kernel/loop/MainLoop.ts`). A
  scene load creates the cells around the focus's initial position **as part of the load**, in the
  feature's `created` scene hook (awaited), inside p101's physics hold: physics' `entered` hook
  then waits for the cells' bodies like the scene's own, so a scene enter stays deterministic.
  Only cells crossed during play stream at runtime.

### 4.2 Ownership

`AssetOwners` changes from one owner per asset to a small owner set (or ref count per owner key):

- Owner keys are `sceneId` for base content and `sceneId#cellKey` for cell content. p345's tab
  groups by the part before `#`.
- `releaseCellOwnedAssets(sceneId, cellKey)` mirrors `releaseSceneOwnedAssets`: it drops the
  cell's ownership, and frees an asset only when no owner is left and nothing uses it. An asset
  shared by two cells stays while either holds it.
- Scene exit releases the scene key and every one of its cell keys, as today.

### 4.3 Entities that move

A dynamic body spawned by cell A can roll into cell B. Cell-owned entities join a `MANUAL` p346
domain, `STREAMING`, with the streaming `cellSize`. On unload, the cell queries the domain for the
entities currently inside it (by position, not by who spawned them):

- an entity spawned by this cell and still inside it is deleted with the cell;
- an entity spawned by this cell but now inside a loaded cell is re-owned by that cell;
- an entity spawned by another cell but now inside this one is deleted only if its own cell is
  also unloading (otherwise it stays with its owner).

The domain is rebuilt (`rebuildSpatialDomain`) only when a cell is about to unload (`MANUAL`: a
join or a move is seen only after a rebuild), so this costs nothing per frame. A rebuild costs
about 0.1 µs per member (p616 measured `FOLIAGE`'s 1,500 at 113-158 µs), once per unload.

## 5. Priming

A cell's textures and pipelines are primed while it's `NEARBY`, before it's close enough to see in
detail:

- `initTexture` per new texture, spread over frames by `maxPrimeMsPerFrame` (default 2 ms,
  Phase 0 finding 5): textures upload one after another while the frame is under budget, and one
  over it (an uncompressed texture over 1024² on WebGL2: 35-141 ms, the call can't be split) gets
  a frame of its own and is counted in the debug tab.
- `compileAsync` for the cell's **new material structures** only (finding 1: a material whose
  structure is compiled costs ~nothing), all in **one** call per cell (one stand-in per
  structure) in the compile queue, through the render pipeline's compiler under PostFX
  (`preWarmMesh`'s path), or its first visible frame compiles again (§1, finding 3). three r187's
  own 8 ms slicing keeps each frame's block at ≤ 17 ms, and one call is 2.5-3× faster than one per
  frame (finding 4), so no ms budget applies to compiles.
- On WebGL2, a cell's new structures first draw a few per frame even when primed (finding 7:
  8 at once cost a 67-183 ms frame in the GPU process). Phase 2 section 3 measured it: one per
  frame under PostFX (about 10 ms of GPU-process work each, so two a frame in a row already miss
  frames), and on WebGPU 8 at once draw clean.
- A cell is promoted to `RESIDENT` only once primed. If the focus outruns priming (a fast vehicle),
  the cell is promoted anyway and the stall is counted in the debug tab, which is the signal to
  widen the rings.

## 6. Physics

- Cell physics content is created through `createPhysicsEntity` at runtime, which in
  `WORKER_THREAD` mode is async: the first step a body takes part in depends on frame timing.
  **Runtime content creation is therefore not deterministic**, only scene loads are (§4.1). The
  determinism probe freezes the focus, so streaming adds nothing during a probe run. This is a
  documented limit, not a bug.
- **Tier changes can be deterministic, though.** `_DONE_p343` made the tier policy decide on
  fixed steps (`STEPS`: measure the focus on steps that are multiples of `interval`, decide
  `interval` steps later, hold stepping with `addPhysicsStepGate` while a `WORKER_THREAD` read
  is out). Cell states decided the same way make the tier side as deterministic as the focus,
  so a stretch of play that loads or unloads no content plays out the same. Deciding them in
  `streamingSystem` (`MAIN`, every N frames) lands the requests on frame-timing-dependent steps,
  like a `FRAMES` policy. Phase 4 decides; the step path is preferred if it doesn't complicate
  the content side (content loads can stay per frame, only the tier decision moves).

### 6.1 Per-cell tiers (Phase 4; formerly p352 Phase 5)

| Cell state | Dynamic bodies it owns                                                   |
| ---------- | ------------------------------------------------------------------------ |
| `RESIDENT` | their own tier policy if they're members, else `FULL`                    |
| `NEARBY`   | `STATIC` (default) or `DISABLED`, a scene setting                        |
| `FAR`      | `REMOVED` (the entity and its visual stay; Phase 5 decides what's shown) |
| `UNLOADED` | deleted with the cell; until Phase 5, `FAR` is `UNLOADED`                |

- `STATIC` still collides, but Rapier zeroes a body's velocities when it becomes `FIXED`, so it
  resumes from rest. `DISABLED` keeps pose and velocities exactly, but nothing collides with it
  or wakes it. `NEARBY` defaults to `STATIC` because something can reach it: an NPC whose cell is
  pinned (p420), a thrown object.

Constraints from p352 as built (each needs an answer in Phase 4):

1. **The cell wins over the policy.** The policy pass requests tiers for its members on its own,
   so a member in a non-`RESIDENT` cell must be skipped. Either the cell takes the entity out of
   the policy (`setPhysicsTierPolicyMember(id, false)`; removing a member leaves its tier as it
   is) and puts it back on `RESIDENT` (the policy places it from its current `target`, no new
   API), or the policy pass gains a skip check. The first is preferred.
2. **`FIXED` bodies have no tier** (`requestPhysicsTier` refuses anything not created `DYNAMIC`
   by `createPhysicsEntity`). Level colliders stay as they are while their cell's content is
   loaded (no slot, no per-frame sync, only broad-phase cost) and are deleted with it.
3. **Jointed bodies can't be `REMOVED`** (any joint, also one to a fixed anchor: refused at the
   request and again when it applies). A cell going `FAR` puts them in `DISABLED` or deletes
   them. A joint group changes tier as one, so a group across two cells in different states
   gets one owner: the cell of its member nearest the focus, as the policy's groups do.
4. **A create has no initial tier.** `createPhysicsEntity` makes the body as its params say
   (`FULL`), and `requestPhysicsTier` refuses a body that doesn't exist yet. A body created into
   a `NEARBY` cell would simulate `FULL` until its request lands (frames later in
   `WORKER_THREAD` mode). Phase 4 adds a create-time tier (eg. `PhysicsEntityOpts.initialTier`,
   applied in the create's own message, before its first step): an engine change in this plan.
5. **Capacity:** in `WORKER_THREAD` mode a `REMOVED → FULL` return takes a slot, and a full
   buffer (`maxBodies`) refuses it: the entity stays `REMOVED` and a `PhysicsCapacityError` is
   logged. A cell promoting many bodies at once can hit this; the Streaming tab counts it.
6. **A `REMOVED` body's state lives engine side** (keyed by body id) and is freed when its entity
   is deleted. It survives `FAR` (the entity stays), not `UNLOADED` (§8).
7. **Positions:** a `REMOVED` entity's `TRANSFORM` keeps the pose it was removed at; the
   `STREAMING` domain (§4.3) reads that, as the policy does.
8. **Deleting a body in flight is safe** (p352 Phase 3 checks delete while `REMOVED` and while a
   return waits for its reply), so a cell may unload without waiting for its transitions.

### 6.2 Other physics notes

- A body that has fallen asleep in a `NEARBY` cell is the common case and costs little; tiers are
  for the bodies that don't sleep and for slot pressure (`maxBodies`).
- Static level colliders are part of the cell and are deleted with it. A `FULL` body resting on a
  cell that unloads under it is the 'falls through the world' bug: a cell can't unload while it
  holds the focus's ring, and characters' and NPCs' cells are pinned (p420).

## 7. Debug

A "Streaming" drawer tab (`features/streaming/debug/_dbg__Streaming.ts`, registered from the
feature's install with `if (IS_DEBUG_ENV) ctx.onDebug(…)` as `lod()` does; a `streamingControls`
id in `DEFAULT_DEBUG_DRAWER_TAB_ORDER`): `createDebuggerTab` with a pane (the kit's property grid)
for the focus cell, per-state cell counts, the queue, loads in flight, priming stalls, oversized
uploads (an uncompressed texture over 1024² in cell content, Phase 0 finding 5) and the
settings, and a `debuggerListCMP` of cells (state, last load time, per-cell memory from the GPU
memory tab's owners, §4.2). A cell row opens a cell window (a window kind,
`registerDraggableWindowKind` at the `_dbg__` module's load, its grid `createDebugWindowGrid`):
its entities, assets and transitions. A top-down overlay of cell outlines coloured by state, drawn
with the line system at ground level (off with one log line without `lines()`), marked with
`markDebugHelper`. "Freeze focus" and "teleport focus to cell" for testing, and
`?streamingFocus=x,z` to start from a cell (read like `?startScene`: only in the debug env and
prod test mode, so a production build never reads it).

## 8. Not in this plan

- **Origin rebasing.** Rapier and the transform buffer use 32-bit floats, so positions jitter a few
  km from the origin. A world larger than ~4 km across needs a floating origin, which touches
  physics, cameras, the sky and every system holding world positions. Its own plan.
- **Server-side or procedural world generation**: cells come from authored scenes or code.
- **Saving cell state** (a moved crate stays moved after its cell reloads). p352's `REMOVED`
  keeps a body's state only while its entity exists, so it covers a cell in `FAR`, not one that
  unloads (its entities are deleted, and their state with them). Keeping it across an unload
  needs the cell to record its bodies' poses before deleting them; persistence beyond a session
  is p500 territory.

## 9. Phases

### Phase 0 — Measure (half a day) — done

`initTexture` and `compileAsync` cost per texture size and material type on WebGPU and the WebGL2
fallback, in `largeWorld`, with PostFX on and off (three r187's slicing and pass compile, §1).
Record the numbers here; they set §5's defaults.

**Setup** (2026-11-06): Apple M2, macOS 26.5, Chrome 156 headless, vsync at 60 Hz, three r187,
engine 6.1.1, the dev server with `?isProdTest=true&aekTest=true&startScene=largeWorld` (its frame:
16.67 ms, no frame missed, the main thread busy ≤ 6-9 ms of it). WebGL2 is the same Chrome with
`navigator.gpu` hidden, so ANGLE on Metal, not SwiftShader. A page probe on the app's own module
instances: frames from `requestAnimationFrame`, main-thread blocks from a `MessageChannel` ping
loop (vsync hides a block that fits in a frame's slack; the ping loop doesn't), 3 repeats each.
A "new structure" carries a unique literal in its `positionNode` and its `opacityNode`, because
three caches the vertex and fragment modules separately by their code (`Pipelines.js`): a literal
in one stage only leaves the other shared and measures a third to a half of the cost. The
pre-warm is `preWarmMesh`'s path (`runCompileAsync`, the pipeline's compiler under PostFX).
Uncapped frames (`--disable-gpu-vsync`) don't work as a measure: the GPU queue backs up and
`compileAsync`, which yields once a frame, takes 3-4× as long.

**`initTexture`**, the call's main-thread ms (range of 3; with mips, without them ±30%):

| size  | WebGPU RGBA8 | WebGPU ImageBitmap | WebGL2 RGBA8 | WebGL2 ImageBitmap |
| ----- | ------------ | ------------------ | ------------ | ------------------ |
| 256²  | 0.4-0.6      | 0.2-0.5            | 0.1          | 0.1-0.2            |
| 512²  | 1-1.2        | 0.5-0.7            | 0.1-0.2      | 0.5-0.6            |
| 1024² | 0.8-1.5      | 0.8-1.3            | 0.2-1.1      | 1.4-2.5            |
| 2048² | 2-4.5        | 1.9-4.7            | 44-46        | 34-40              |
| 4096² | 7.5-13.5     | 6-13.5             | 107-116      | 129-141            |

KTX2 (the asset pipeline's UASTC, transcoded to ASTC 4×4): 864², 10 mips: WebGPU 0.8-1.2 ms,
WebGL2 0.1-0.2 ms. No WebGPU upload missed a frame; every WebGL2 upload of 2048² and up did (one
33-50 ms frame at 2048², a 100-133 ms one at 4096²). One call can't be split.

**Compiles**, one material on a 32×16 sphere, cast and receive shadows, in view (median ms). "Cold":
the longest frame when it's first drawn without a pre-warm. "Pre-warm": the pre-warm's wall time.
"Depth 0": the longest first-draw frame after a direct compile only, under PostFX.

| material             | WebGPU PostFX on: cold / pre-warm / depth 0 | WebGPU off: cold / pre-warm | WebGL2 PostFX on: cold / pre-warm / depth 0 | WebGL2 off: cold / pre-warm |
| -------------------- | ------------------------------------------- | --------------------------- | ------------------------------------------- | --------------------------- |
| basic                | 83 / 166 / 17                               | 33 / 69                     | 100 / 117 / 50                              | 33 / 50                     |
| Lambert              | 317 / 396 / 117                             | 167 / 219                   | 233 / 267 / 117                             | 100 / 133                   |
| Phong (flat)         | 167 / 388 / 117                             | 183 / 219                   | 250 / 300 / 117                             | 133 / 150                   |
| standard             | 283 / 617 / 217                             | 283 / 346                   | 383 / 433 / 183                             | 183 / 233                   |
| standard, 3 maps     | 300 / 643 / 250                             | 300 / 355                   | 400 / 466 / 200                             | 200 / 234                   |
| physical (clearcoat) | 317 / 735 / 250                             | 333 / 380                   | 467 / 550 / 233                             | 233 / 267                   |
| standard, TSL noise  | 283 / 650 / 233                             | 300 / 345                   | 400 / 450 / 200                             | 183 / 251                   |
| standard, instanced  | 283 / 555 / 267                             | 300 / 353                   | 383 / 433 / 200                             | 183 / 217                   |
| standard, known      | 17 / 12 / 17                                | 17 / 6.5                    | 17 / 50 / 17                                | 17 / 17                     |

("Known": a new material of a structure already compiled, another colour.) After a pre-warm every
row's first draw is clean (16.7 ms), shadows included, and no frame is missed during it: the
longest main-thread block is ≤ 11 ms (physical), ≤ 7.6 ms for the rest.

**A cell**: 8 new structures (4 standard, 4 standard with 3 maps), pre-warmed together:

| backend | PostFX | one `compileAsync` call  | one call per material, one per frame | first draw after    |
| ------- | ------ | ------------------------ | ------------------------------------ | ------------------- |
| WebGPU  | on     | 2.0-3.0 s, block ≤ 17 ms | 5.4-6.3 s, block ≤ 14 ms             | clean               |
| WebGPU  | off    | 1.0-1.5 s, block ≤ 10 ms | 3.0 s, block ≤ 7 ms                  | clean               |
| WebGL2  | on     | 1.4-1.5 s, block ≤ 13 ms | 3.9-4.6 s, block ≤ 8 ms              | one 67-183 ms frame |
| WebGL2  | off    | 0.7-0.8 s, block ≤ 10 ms | 2.0-2.6 s, block ≤ 7 ms              | clean               |

No frame was missed during any of them but one (a 34 ms block, WebGPU, PostFX off, once in 3).

Findings, which §5 now follows:

1. **The cost is per new shader structure, not per material.** A material of a known structure
   costs 6-50 ms and no hitch, so a world drawing from a shared material set compiles almost
   nothing when it streams; a cell's priming is about the structures it brings first.
2. **A new structure must never be drawn cold:** 100-480 ms. On WebGPU the main thread is busy
   only 5-20 ms of it (the stall is in the GPU process: three creates a render pipeline
   synchronously on a draw), on WebGL2 all of it (GL compile and link). A main-thread budget like
   `maxCreateMsPerFrame` sees WebGL2's stall but not WebGPU's.
3. **Under PostFX the pre-warm has to go through the pipeline's compiler** (as §1 says): a depth-0
   compile alone leaves a 117-267 ms first draw on WebGPU, 50-233 ms on WebGL2. Through the passes
   it takes 1.1-2× the direct compile's wall time.
4. **A ms budget can't slice compiles; three's 8 ms slice already does.** During a pre-warm the
   main thread blocks ≤ 11 ms per material, ≤ 17 ms for a cell's 8 in one call, missing no frame
   at 60 Hz. Compiling one material per frame doesn't lower that much, and takes 2.5-3× as long
   (three builds up to 16 pipelines at once only inside one call). So a cell compiles its new
   structures in **one** call, and `maxPrimeMsPerFrame` budgets textures only.
5. **Textures:** under 2 ms up to 1024² on both backends, which fits a 2 ms budget. Above that,
   WebGPU stays at 2-14 ms, and WebGL2 can't avoid a stall (35-141 ms, one call). KTX2 costs
   ≤ 1.2 ms, so cell content should ship KTX2 (`yarn assets`), and the Streaming tab flags an
   uncompressed texture over 1024².
6. **The shadow pass, never pre-warmed, costs nothing visible on WebGPU:** a cell's 8 new
   structures draw clean the first time.
7. **WebGL2 under PostFX: a cell of 8 pre-warmed new structures still costs one 67-183 ms frame
   when they first draw together.** The main thread is busy only ~2 ms of it, with shadows on or
   off. Each structure alone draws clean, and so does the cell with PostFX off. So the GPU process
   does something on the first draw into the PostFX targets that `compileAsync` doesn't prime.
   Likely ANGLE's Metal backend building its pipeline state per program and target format; not
   verified. Phase 2 measures how many new structures can first draw in one frame on WebGL2, and
   spreads them.
8. **Speed bound:** priming must end while the focus crosses the `NEARBY` ring (one cell). A cell
   bringing 8 new structures takes up to 3 s (WebGPU, PostFX on), so at a 64 m `cellSize` the focus
   can move ~21 m/s (75 km/h) without a stall. A cell of known structures costs only its
   textures. These numbers are the dev build's; the GPU side doesn't change in production, and the
   JS node builds can only get faster.

### Phase 1 — Cells and the state machine (code content) — done

1. The `streaming()` feature (its install, entry, schema part, a `sbp.config.ts` budget line) and
   the cell maths in `src/_engine/utils/` unless p372 moved it (§1).
2. Scene `streaming` settings, rings, asymmetric thresholds, `streamingSystem`, budgets,
   cancellation (§2, §4.1).
3. `registerStreamingCellContent` (§3.1).
4. Debug tab and overlay (§7).

**Exit:** a test scene with a 16 × 16 grid of code-registered cells (procedural terrain blocks
with scattered props) streams while flying across it, with no frame over 33 ms caused by
streaming and no thrashing when hovering on a boundary.

As built (the feature's notes: `src/_engine/features/streaming/CLAUDE.md`; the Hub's Streaming
feature page, `hub/pages/features/streaming/`):

- **Files.** `StreamingFeature.ts` (`streaming()`, listed last in the template, after
  `viewports()`, so `isInstalled` sees `spatial()`, `lod()` and `lines()`), `StreamingSchema.ts`
  (`streamingSchemaPart`, on `aekasha/schemas`; zod), `StreamingSettings.ts` (the defaults and
  checks without zod: the schema's refine and `setSceneStreamingSettings` share them, so a build
  ships no schema), `StreamingRings.ts` (pure level maths), `StreamingCells.ts` (the machine, no
  engine state, tested with its own clock), `StreamingContent.ts` (the registry and the cell keys),
  `Streaming.ts` (the system, the scene hooks, the focus, the public API), `debug/`. The cell maths
  moved to `src/_engine/utils/CellKey.ts` (p372 hadn't). `SceneData.streaming` is typed with
  `import type`.
- **Settings.** `streaming: { cellSize, rings?: { resident, nearby, far }, margin? }`, each ring
  a state's outermost ring in cells (defaults 1, 2, 5), `resident <= nearby <= far` (equal rings
  give the state between no cells), unknown fields rejected. In code:
  `setSceneStreamingSettings(sceneId, settings | null | undefined)`, over the JSON's, kept across
  loads (read in the `created` hook, so the scene's code can set them). The budgets are a new
  `AppConfig.streaming` (`updateIntervalFrames` 10, `maxConcurrentLoads` 2, `maxCreateMsPerFrame`
  2), read at the install; the debug tab edits them live.
- **Thresholds.** A cell is promoted to the nearest level whose ring holds it (`ring <=
rings[level]`) and demoted once the focus is more than `rings[level] × cellSize + margin` from
  its edge (Chebyshev, metres), to the nearest level that still keeps it. `FAR` loads nothing
  until Phase 5 (`DEEPEST_LOADED_LEVEL = NEARBY`, one constant): a cell wanted `FAR` unloads.
- **Budgets.** `maxCreateMsPerFrame` is checked before each content unit, for loads and again for
  unloads; a frame always runs at least one of each (neither starves), and a unit started under
  budget runs to its end, so a frame can go over by one unit. Loads go nearest first, unloads
  farthest first.
- **Cancellation.** A `LOADING` cell no longer wanted skips its units not started and unloads what
  finished; an async unit that resolves after (a stale generation) is unloaded at once and counted
  (`lateResults`). `ctx.isCurrent()` lets a `load` stop after an `await`. A cell wanted again while
  it unloads finishes the unload, then loads again. A `load` that throws, rejects or returns no id
  array fails its unit (`unitErrors`), and the cell still loads.
- **Content.** `registerStreamingCellContent({ sceneId, cellKey, load, unload? })` and
  `unregisterStreamingCellContent(content)` (the same object); `getStreamingCellKey(cx, cz)`,
  `getStreamingCellKeyAt(x, z, cellSize)`, `getStreamingCellState(cellKey)`. A scene's
  registrations are dropped on its exit (its code registers them on every load). Without `unload`
  the returned entities are deleted.
- **Focus.** `setStreamingFocus(entityId | { x, z } | null)`, the main camera by default, kept
  across loads; while its entity doesn't exist the cells keep their states.
- **Scene loads.** The `created` hook builds the machine and loads every wanted cell with no
  budget, awaited; `exit` (reverse install order, so before physics' entities) unloads every
  cell and drops the scene's registrations. Nothing streams between `loadStart` and `loadSettled`.
- **Debug.** The Streaming tab, cell window and overlay as §7, a new built-in icon `streaming`
  (`streaming-cells.svg`: no existing one fit, and the spatial index's would put two identical
  icons on the rail), a debug-only focus override (`setStreamingFocusOverride`: Freeze focus,
  Teleport focus to cell and `?streamingFocus=x,z`, read in the install in the debug env and prod
  test mode) and a transition listener on the machine (the cell window's history; production
  code keeps none). Not yet: the priming stalls and oversized uploads rows (Phase 2, nothing to
  count before priming exists), and per-cell memory (Phase 2's owner keys).
- **The determinism probe doesn't freeze the focus yet** (§6): the probe is physics' debug code,
  and freezing a `streaming()` focus from it needs a kernel seam (a feature imports no other
  feature's code). Phase 1's content has no physics, so it moved to Phase 4.
- **The test scene** is the app's `streamingGrid` (`src/app/scenes/streamingGrid/`, in
  `OTHER_HUB_SCENES` for its Hub image, the feature page's example): 16 × 16 cells of 64 m, rings
  1 / 2 / 4, each three units: a terrain block (`generateTerrain` with the world's height field as
  its `heightModifier`, so neighbours share their edges; its own geometry, deleted by the unit's
  `unload`) and two units of scattered rocks and crates on shared geometries and materials. The
  main camera flies along row 0, hovers across the x = 128 boundary or stays (its scene tab,
  `streamingGridDemo`). `scenes.config.ts`: no snapshot (which cells have their props depends on
  frame timing), and the debugger configuration shoots the Streaming tab and a cell window
  (unstable shots: live readouts).

**Measured** (2026-11-06, Apple M2, Chrome 156 headless, the dev server with
`?isDebug=true&aekTest=true&startScene=streamingGrid`: the test bridge's fixed 1/60 s frame step,
so a speed is per frame; frames from `requestAnimationFrame`, main-thread blocks from a
`MessageChannel` ping loop, as Phase 0):

| backend | mode                           | frames over 33 ms | longest frame | longest main-thread block | loads / unloads |
| ------- | ------------------------------ | ----------------- | ------------- | ------------------------- | --------------- |
| WebGPU  | still, 5 s                     | 0                 | 16.7 ms       | 1-1.3 ms                  | 0 / 0           |
| WebGPU  | flying 30 m/s, 15 s            | 0                 | 16.7 ms       | 4.5-12.2 ms               | 35 / 35         |
| WebGPU  | flying 60 m/s, 15 s            | 0                 | 16.7 ms       | 3.1-8.3 ms                | 65-70 / 65      |
| WebGPU  | hovering ±6 m on x = 128, 10 s | 0                 | 16.7 ms       | 0.7-7.2 ms                | 0 / 0           |
| WebGL2  | still, 5 s                     | 0                 | 16.7 ms       | 3 ms                      | 0 / 0           |
| WebGL2  | flying 30 m/s, 15 s            | 0                 | 33.3 ms (one) | 5.4 ms                    | 35 / 35         |
| WebGL2  | flying 60 m/s, 15 s            | 0                 | 16.7 ms       | 4.6 ms                    | 65 / 65         |
| WebGL2  | hovering ±6 m on x = 128, 10 s | 0                 | 16.7 ms       | 3.4 ms                    | 0 / 0           |

The scene load creates the 25 cells around the camera. No load was cancelled and no unit failed.
WebGL2's one two-vsync frame came with no main-thread block over 5.4 ms (so not the cell
creation's JS), and the cells bring no new material structure (Phase 0 finding 1). The scene's
cells are cheap (17 entities and one 16 × 16 terrain block each; WebGPU's ranges are three runs, WebGL2's one), so the budgets were never the
bound; Phase 2's priming is what heavier cells will need.

### Phase 2 — Ownership and release

`AssetOwners` owner sets, `releaseCellOwnedAssets` (§4.2), priming (§5): first measure how many
primed new structures can first draw in one frame on WebGL2 under PostFX (Phase 0 finding 7) and
set the per-frame count from it.

**Exit:** p345's snapshot after flying out and back is within noise of the snapshot before.

Sections: 1. the kernel's owner sets, 2. streaming's per-cell ownership and release (with the
exit check), 3. the WebGL2 first-draw measurement, 4. priming. As built so far (sections 1-2):

- **Owner sets** (`kernel/assets/AssetOwners.ts`; the notes: `src/_engine/kernel/scene/CLAUDE.md`'s
  Asset ownership). One owner key (a string) or several (an array, the latest last) per asset; a
  cache hit adds the current owner instead of replacing it, which frees exactly what the single
  owner did for scenes. The current owner is the owner scope's (`runInAssetOwnerScope`,
  synchronous) or the scene's. Async loaders capture the scope at their call and register in it
  after their awaits: `loadTextureAsync` (arrays, atlas slots), `buildTextureArray` (a shared
  build's second caller gets the array too) and `importAssetAsync`. Without a scope nothing
  changed: a late registration takes the scene owner of its moment.
- **Release** (`SceneAssetRelease.ts`): `releaseAssetOwners` drops the released keys from an
  asset others hold too; one the released keys alone hold is freed when unused, else keeps them
  for their next release. `releaseSceneOwnedAssets` takes the scene's key and its cells'
  (`isSceneOwnerKey`), `releaseCellOwnedAssets(sceneId, cellKey)` one cell's (no log). The import
  registry's release takes the same matcher.
- **Cells** (`StreamingCells.ts`): `cell.ownerKey`; a unit's `load` runs in it up to its first
  `await`, and the public `ctx.runOwned(fn)` runs code after one in it (an engine minor). A
  finished unload releases the cell (`releaseCellAssets`, injected by `Streaming.ts`, so the
  machine stays engine-free in its tests), unless a cancelled load's async units are still out
  (`lateUnits`, the last to settle releases) or another cell object tracks the key. The scene's
  exit releases nothing (SceneLoader's scene release takes the cell keys); a reload of the same
  scene, which SceneLoader doesn't release, has `created` release the dropped cells it didn't load
  again. A release scans every registry: 3-5 µs per call at `streamingGrid`'s 17 assets, linear in
  the registered assets, so a world with thousands may want an owner → assets index (measure
  first).
- **Found: `disposeMesh` leaked three's render objects.** A deleted mesh entity was detached and
  its refs released, but its mesh never fired `dispose`, so three (r187) kept its render objects
  (uniform buffers, bindings) while its geometry and material lived, which shared ones always do:
  +2,380 uniform buffers (571 KB) per flight out and back across `streamingGrid`, growing. Fixed in
  `kernel/mesh/Mesh.ts` (`mesh.dispose()`), an engine-wide fix (any app deleting meshes on shared
  assets leaked).
- **Ref counts already free most of a code unit's assets** (a mesh's geometry and material on
  their last ref, and the material's registered textures with it), so `streamingGrid` frees
  nothing through the cell release (`assetsReleased` 0): the release is for what no entity holds,
  tested in `StreamingCells.test.ts` with the real registries (a texture a cancelled async unit
  registered before bailing out). `streamingGrid`'s terrain unit lost its own `unload`.
- **Debug.** The tab counts cell releases and assets freed, and shows the cells' GPU memory (a
  row's subtitle, the total and the largest); the cell window its GPU memory and the assets its
  owner key is on (`_dbg__StreamingMemory.ts`, the GPU memory tab's `collectGPUAssets` and its
  `getMemoryOwner`: an asset several cells share counts under the scene).

**Measured** (2026-11-06, Apple M2, Chrome 156 headless, `streamingGrid` on the dev server with
`?isDebug=true&aekTest=true`; the flight frozen, the focus override moved 2 m a frame from
x = -455.5 to +455.5 and back, three times, 180 frames at home after each; p345's snapshot at home
before the first): the registries (12 geometries, 4 materials, 1 texture), the entities (175) and
`renderer.info.memory` are the same after each of the three trips (510 unloads), on WebGPU and
WebGL2, and the snapshot diff names nothing left behind. Against the snapshot: +38 KB (two
terrain blocks and 75 uniform buffers of the start's cells that hadn't been drawn when it was
taken, the same after every trip). Before the `disposeMesh` fix: +571 KB per trip.

**Section 3, measured** (Phase 0 finding 7; 2026-11-06, Apple M2, Chrome 156 headless, the dev
server with `?isProdTest=true&aekTest=true&startScene=largeWorld`, WebGL2 as Phase 0's, ANGLE on
Metal): N meshes (32×16 spheres, cast and receive shadows, side by side 12 m in front of the main
camera), each its own new structure (Phase 0's unique literal in `positionNode` and
`opacityNode`), primed in one `compileAsync` of their group through the pipeline's compiler in
the compile queue (what section 4 will do), out of the scene; 20 frames later added to the scene
N at once or k a frame, the longest `requestAnimationFrame` interval of the next 40 (headless
frames run at ~18 ms, so a clean frame reads 18-20). Three trials each:

| shown              | WebGL2, PostFX on | WebGL2, PostFX off | WebGPU, PostFX on |
| ------------------ | ----------------- | ------------------ | ----------------- |
| 1 at once          | 19 / 20 / 27      | 19 / 18 / 18       | 19 / 19 / 19      |
| 2 at once          | 19 / 18 / 18      | 18 / 22 / 19       | 18 / 19 / 18      |
| 3 at once          | 25 / 25 / 26      | 18 / 18 / 19       | 19 / 19 / 19      |
| 4 at once          | 25 / 50 / 47      | 21 / 19 / 21       | 19 / 18 / 19      |
| 6 at once          | 73 / 70 / 57      | 37 / 36 / 28       | 19 / 19 / 19      |
| 8 at once          | 89 / 103 / 88     | 41 / 60 / 42       | 20 / 19 / 19      |
| 8, 1 a frame       | 19 / 20 / 19      | 19 / 18 / 20       | 18 / 19 / 19      |
| 8, 2 a frame       | 34 / 34 / 39 (×3) | 18 / 47 / 19       | 19 / 18 / 18      |
| 8, 4 a frame       | 63 / 63 / 66 (×2) | 33 / 39 / 34       | 28 / 18 / 18      |
| 4 cold, at once    | 1,652 / 1,674     | 1,025 / 974        | 2,441 / 2,330     |
| prime of 8 (wall)  | 1.2-2.0 s         | 0.6-0.8 s          | 1.5-1.6 s         |

Findings, which section 4 follows:

1. **WebGL2 pays about 10 ms of GPU-process work per primed new structure on its first draw**
   (8 at once: +70-85 ms under PostFX, +25-40 ms without). A single frame of 2 hides in the
   frame's slack, but 2 a frame in a row miss a frame each: **one new structure a frame on
   WebGL2**, PostFX on or off (off tolerates 2 to 4, but the same rule keeps a runtime PostFX
   switch out of it). Phase 0's "PostFX off draws 8 clean" didn't hold here: its cell drew its 8
   behind each other, these side by side, all in view and in the shadow map.
2. **WebGPU draws 8 primed new structures at once clean** (Phase 0 finding 6 again): no spreading,
   a cap only so a cell of dozens doesn't test it (8 a frame).
3. **Priming is what matters:** 4 cold structures at once stall 1-2.4 s on every backend.
4. **The rule is per new structure, not per mesh:** a mesh of a structure drawn before costs
   nothing (Phase 0 finding 1), so a cell's meshes of known structures show at once and only
   the ones bringing a new structure queue, one (WebGL2) or 8 (WebGPU) a frame.

### Phase 3 — Build-time manifest

Scene JSON assignment, oversized content, `__streaming` in generated data (§3.1–3.2).

### Phase 4 — Moving entities and physics

The `STREAMING` domain and re-owning (§4.3), per-cell tiers with p352 (§6.1, which took over
p352's Phase 5): the cell-over-policy rule, joint group owners, the create-time tier, and the step
or frame decision (§6).

Also (moved from Phase 1): the determinism probe freezes the streaming focus (§6). The probe is
`physics()`'s debug code and can't import `streaming()`, so it needs a kernel seam, eg. a small
`@internal` registry of freeze callbacks in `kernel/` that the probe calls when it arms and
disarms and `streaming()` adds one to (holding `focusOverride` at the last decided focus).

Needs only Phase 1 (cells and code-registered content); Phases 2-3 aren't prerequisites, so this
phase can run right after Phase 1 if the physics side is wanted first.

**Exit:** on a streaming version of `physicsTiers` (crate piles as code-registered cell content),
crates take their cell's tier and a policy member follows the policy only while its cell is
`RESIDENT`; a crate created into a `NEARBY` cell never simulates a step `FULL`; a crate that rolls
into a neighbouring cell is re-owned and unloads with it; no capacity refusal at default
`maxBodies`; the Physics API tab's tier counts match the cells' states, in all three targets.

### Phase 5 — Far representations

`FAR` content (§3.3) with p348 and p351.

## 10. Versioning, Hub and docs

Engine minor per phase that adds API (Phases 1–4); the `AssetOwners` change in Phase 2 is internal.
App minor for a streaming demo scene. `readme.md`: a Features entry when Phase 3 lands.

Each phase that changes what an app can do updates in the same branch: the feature's nested
`features/streaming/CLAUDE.md` (its line in the root's map), a Streaming feature page
(`hub/pages/features/streaming/`, `aek:covers` that file's section) and the root `CLAUDE.md`'s
Bootstrap flow (ten features). The streaming demo scene is the page's example (and a
`lodShowcase` lane, as `features/lod/CLAUDE.md` asks of later LOD plans, if a lane can show it);
`yarn hub:build` after the change.

## 11. Open questions

1. Should the focus support several points (split screen, a remote-controlled drone)? The state
   machine takes the union of rings; designing for one focus first.
2. Do lights belong to cells? Point and spot lights, yes (they have positions and are already
   spatially culled). The sky's lights and directional lights are base content.
3. Should cells be 3D for vertical worlds (caves under terrain)? 2D first; the key format already
   carries `y`.
