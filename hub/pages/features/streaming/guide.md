## Installing it

List [`streaming()`](api:streaming), from `aekasha/streaming`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)). Without it, the streaming
functions throw, and a scene whose JSON has `streaming` fails the boot, naming the feature (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

## Cells and rings

A scene streams once it has a cell size, in its JSON or from code
([`setSceneStreamingSettings`](api:setSceneStreamingSettings), over the JSON's):

```json
{ "streaming": { "cellSize": 64, "rings": { "resident": 1, "nearby": 2, "far": 5 } } }
```

Cells are squares on x and z (height doesn't count), `cellSize` metres wide: a power of two of at
least 32, so terrain blocks of 32 to 256 m tile them exactly. Each ring is a state's outermost
ring of cells around the focus's cell:

| State      | Default ring | What the cell has                                                       |
| ---------- | ------------ | ----------------------------------------------------------------------- |
| `RESIDENT` | 0–1          | Its near and kept content.                                              |
| `NEARBY`   | 2            | The same, loaded a ring ahead of being seen up close.                   |
| `FAR`      | 3–5          | Its far content (stand-ins: impostors, coarse levels) and kept content. |
| `UNLOADED` | beyond       | Nothing.                                                                |

What near, far and kept content are is in [Far representations](#far-representations).

A cell moves to a nearer state as soon as the focus comes within its ring, but back only once the
focus is `margin` metres past it (a quarter of a cell by default), measured to the cell's edge: a
player standing on a boundary doesn't load and unload the cells beside it every step.

## Cell content

What a cell holds is code you register per cell: `load` creates it and returns the entities it
made, and `unload` takes it down (by default the entities are deleted). `loadedAt` says at which
levels it's loaded ([Far representations](#far-representations)). The test scene gives every cell
a terrain block with its own geometry, kept from `FAR` in, its rocks near and their impostors
far, and its crates near:

<<< src/app/scenes/streamingGrid/streamingGrid.ts#streaming-cells

- **Register from the scene's code.** A scene's registrations go when it's left, and its code runs
  on every load before its cells do. [`getStreamingCellKey`](api:getStreamingCellKey) makes a
  cell's key from its indices, [`getStreamingCellKeyAt`](api:getStreamingCellKeyAt) from a point.
- **A unit is what a frame can't split.** Each frame loads units nearest first while it's under
  `AppConfig.streaming.maxCreateMsPerFrame` (2 ms), at most `maxConcurrentLoads` cells at a time
  (2): a cell of thousands of entities is many units, not one.
- **`load` can be async.** Check `ctx.isCurrent()` after every `await`: it's false once the cell
  is no longer wanted (or its scene was left), and what a cancelled load returns is unloaded as
  soon as it comes back.
- **What a cell loads is the cell's.** The assets a `load` registers or takes from the cache
  belong to its cell, as a scene's belong to the scene, and when the cell unloads, what it alone
  held and nothing uses is released: an asset another cell or the scene's own code holds stays.
  That's counted up to the `load`'s first `await` (an asset load started there stays the cell's
  too); code after an `await` that creates assets runs in `ctx.runOwned(() => …)`, or they're the
  scene's until it's left.
- **Get shared assets in each `load`.** A geometry or material goes when its last user does, so
  one the scene's code makes once and only cells use is gone once no cell holds it. Ask for it by
  id in each `load` (`createMaterial` and `createGeometry` with an id return the registered one, or
  make it again), as the test scene does. The scene JSON's content doesn't need this.
- **The cells around the focus are part of the scene load.** They load before the scene is
  entered, all at once and awaited, inside the physics hold, so a scene starts the same on every
  visit. Only the cells reached during play stream in over frames.

## Content from the scene JSON

A streaming scene's JSON content goes into cells on its own: when the scene is gathered, each of
its meshes and point and spot lights is put into the cell its `position` is in, and loads and
unloads with it as code content does. Cameras, sky boxes and the ambient, hemisphere and
directional lights stay with the scene.

```json
{
  "streaming": { "cellSize": 64, "base": ["tower"], "radii": { "castle": 90 } },
  "meshes": [
    {
      "props": {
        "appId": "tower",
        "geo": "towerGeo",
        "mat": "stone",
        "position": { "x": 8, "y": 0, "z": 8 }
      }
    }
  ]
}
```

- **Assets go with the content that uses them.** A texture, material, geometry or import that only
  cell content names (by id: a mesh's `geo` and `mat`, its LOD levels, a material's texture maps)
  loads with each cell that names it and is released when the last of them unloads. One the
  scene's own content uses, or that nothing names, loads with the scene. So the scene's code gets
  only those: list an asset it needs in `streaming.base`.
- **`streaming.base`** keeps meshes, lights (by app id) and assets (by id) with the scene: loaded
  with it, never unloaded.
- **Big content is in every cell it reaches.** A mesh more than half a cell across (a bridge, a
  wall, a large building) goes into every cell it overlaps and stays while any of them is loaded.
  A box, sphere, cylinder, capsule or cone is measured from its geometry; an imported model or a
  [merged geometry](hub:features/scenes-and-assets#merged-geometries) isn't, so give it a radius
  in `streaming.radii`. A cell that loads a merged geometry loads its parts with it.
- `base` and `radii` are read when the scene is gathered: setting them in code changes nothing.
  A cell size set in code has to be the JSON's, which the content was cut at.
- The Streaming tab shows each cell's JSON content and the estimated GPU memory of its own
  assets before it loads.

The test scene's beacons and wall are JSON: each beacon's textured material and geometries load
with the cells that have a beacon, and the wall, 320 m long, stays while any of its six cells is
loaded.

## Far representations

A `FAR` cell is seen from far away, so it shows cheap stand-ins instead of its content: a mesh's
coarsest level, an impostor, a terrain block's coarse level. A unit of content says where it's
loaded with `loadedAt`:

| `loadedAt`       | Loaded while the cell is            | For                                            |
| ---------------- | ----------------------------------- | ---------------------------------------------- |
| `'NEAR'`         | `RESIDENT`, `NEARBY` (the default). | Its full content.                              |
| `'FAR'`          | `FAR` only.                         | Its stand-ins.                                 |
| `'NEAR_AND_FAR'` | `RESIDENT`, `NEARBY` and `FAR`.     | What it keeps through every level: its ground. |

So a cell going from `NEARBY` to `FAR` loads its far content and unloads its near content, and its
kept content stays as it is. The test scene's rocks have a far unit drawing all of a cell's rocks
as one `InstancedMesh` of the rock's [octahedral impostor](hub:features/lod#impostors), an
instance where each rock is:

<<< src/app/scenes/streamingGrid/streamingGrid.ts#streaming-far-rocks

- **The cell never goes blank.** The content a cell is leaving stays drawn until the content
  replacing it is loaded and primed, then they cross-fade. A switch the cell changes its mind
  about before it's done is undone without a reload.
- **Everything streamed fades.** An entity a cell shows during play dithers in over the scene's
  `streaming.fadeSeconds`, and one it takes down dithers out first (its `unload` runs once the
  fade has ended), with the same screen-space dither as the
  [LOD cross-fades](hub:features/lod#cross-fades): `AppConfig.lod.fadeSeconds` by default
  (0.25 s), 0 for no fades. The cells a scene load brings appear with the scene, and leaving the
  scene takes them down at once.
- **A material a scene drew before a cell first fades it is built again.** Fading changes a
  material's shader (it gains the dither), and the change reaches every mesh using it, so a
  material the scene's own content shows and cells use too costs a compile the first time a cell
  draws it: call [`enableLodDither`](api:enableLodDither) on it in the scene's code.
- **Ground goes in `NEAR_AND_FAR`.** A far cell without its ground is a hole in the world. A kept
  unit's own LOD draws it coarsely far away (the test scene's terrain blocks have a hand-made
  4 × 4 level).

From the scene JSON, a mesh with LOD `levels` gets a far stand-in on its own: its coarsest level,
at the mesh's place. A cell's stand-ins with the same geometry, material and shadows are one
`InstancedMesh`, so a far cell costs a draw call per kind of stand-in:

```json
{
  "props": {
    "geo": "pillar",
    "mat": "stone",
    "position": { "x": 160, "y": 8, "z": 96 },
    "lod": { "levels": [{ "screenSize": 0.15 }, { "screenSize": 0, "geo": "pillarFar" }] }
  }
}
```

- A mesh whose LOD culls it (`cullScreenSize` over 0) gets none: it's hidden far away anyway. Nor
  does an `AUTO` one, nor a light.
- Big content (more than half a cell across) is kept: one entity while any of its cells is loaded
  at any level, its own LOD drawing it far away. It fades out only when the last of its cells
  takes it down.
- The far content's assets load with it: a cell switching to `FAR` loads the coarse geometry, and
  frees the full one once its near content is gone. The Streaming tab shows each cell's GPU memory
  per content (near, far, kept).

The test scene's beacons have a coarse level each, so its far cells draw them as far groups, and
its wall, 320 m long, is kept while any of its six cells is loaded.

## Priming

A cell reached during play is never drawn before it's ready. Its content is created hidden, then
primed: its textures upload a few a frame (`AppConfig.streaming.maxPrimeMsPerFrame`, 2 ms), the
shaders of materials it's the first to show compile in one go, and then it appears. The meshes of
materials drawn before show at once; each new material's take a frame, one at a time on WebGL 2
(`maxNewStructuresPerFrame`: a new shader still costs WebGL 2 about 10 ms of GPU time when first
drawn, even compiled) and eight on WebGPU. Without it, a new shader drawn cold stalls a frame for
100 to 500 ms, and several at once for seconds. On WebGL 2 the objects themselves are paced too,
16 a frame across the cells (`maxShownObjectsPerFrame`): an object's first draw costs WebGL 2 GPU
time even with a known shader, and a row of cells changing level at once would otherwise miss
frames. A cell let go of over a few frames stays invisible until its fade in starts, so it never
appears in parts, and each object draws once then, even off screen, so turning the camera
towards cells never seen costs nothing.

- **Draw from a shared set of materials.** A cell of materials already shown costs nothing to
  prime but its textures; every new one costs a compile, and on WebGL 2 a frame.
- **Ship textures as KTX2** (`yarn assets`). An uncompressed texture over 1024² can't be split and
  costs WebGL 2 35 to 140 ms: it gets a frame of its own, and the debug tab counts it.
- **Rings set how much time priming has.** A cell is primed while it's in the `NEARBY` ring; one
  the focus reaches first is shown unprimed, and the tab counts the stall. A cell bringing eight
  new shaders takes up to 2 s, about one 64 m cell at 30 m/s: a faster focus wants wider rings.
- **Create an async `load`'s entities at its end.** Its entities are hidden when it resolves, so
  one that creates entities and then awaits more could show them unprimed.
- The cells around the focus at a scene load aren't primed: they appear with the scene, behind its
  loading screen, like the rest of its content.

## Physics

A cell's dynamic bodies (made with `createPhysicsEntity`) follow the cell, with
[`physicsTiers()`](hub:features/physics#simulation-tiers) installed:

| Cell       | Its dynamic bodies                                                                           |
| ---------- | -------------------------------------------------------------------------------------------- |
| `RESIDENT` | `FULL`, or their tier policy's if they're in it.                                             |
| `NEARBY`   | `nearbyPhysicsTier`: `STATIC` (the default: still collides) or `DISABLED`.                   |
|            | A body with joints is `STATIC` for `DISABLED`.                                               |
| `FAR`      | Kept content's: `REMOVED` (out of the physics world, its state kept). With joints: `STATIC`. |
| unloaded   | Deleted with the cell (not saved: a crate moved and left is back next time).                 |

```json
{ "streaming": { "cellSize": 64, "nearbyPhysicsTier": "DISABLED" } }
```

- **A body starts in its cell's tier.** The bodies a `load` creates before its first `await` (or in
  `ctx.runOwned`) are made in the cell's tier, so a crate created into a `NEARBY` cell never
  simulates a step: as if [`requestPhysicsTier`](api:requestPhysicsTier) had applied before its
  first one. `createPhysicsEntity`'s `initialTier` does the same anywhere, and wins inside a cell.
- **The cell wins over the tier policy.** A body created with `tierPolicy: true` follows the
  policy only while its cell is `RESIDENT`: out of it, it has the cell's tier, and it's back in the
  policy when the cell is `RESIDENT` again. Bodies joined by joints change tier together, taking
  the nearest cell's: a chain lying across into a `NEARBY` cell simulates with its `RESIDENT`
  half.
- **A body's cell is the one it's in.** A crate that rolled or was pushed into another loaded cell
  belongs to that cell from the next decision on: it takes that cell's tier, stays when its own
  cell unloads (your `unload` never sees it), and goes when the cell it's in unloads. One
  somewhere nothing is loaded stays with its cell.
- **A far cell's bodies wait outside the world.** A kept unit's bodies are `REMOVED` while its cell
  is `FAR`: they take no part in the simulation and no slot, and come back where they were, with
  their velocities, when the cell comes near again. So a crate pushed in a cell that then goes far
  is where it was left. Near content's bodies are deleted with it, as when the cell unloads.
- **Return a unit's bodies once they exist.** Await their `createPhysicsEntity` calls before `load`
  returns their ids: an entity without its body yet isn't one to the cell.
- **Tier changes follow the frames.** Cells are decided every few frames and stream in over frames,
  so the steps a tier change lands on depend on frame timing: a scene's load is deterministic, but
  streaming during play isn't. The determinism probe holds the cells where the load put them.
- **Far cells still touch the near simulation.** A far cell's ground colliders (`FIXED`, so no
  tier) and its chains (`STATIC`) stay in the physics world, which changes the order the broad
  phase pairs contacts in: in `streamingPhysics` a few crates near the plough end up millimetres
  apart with and without the far ring. A scene is still deterministic, with a probe hash for each
  set of rings.
- The Streaming tab counts the cells' bodies per tier, those held out of the policy and those
  handed to another cell, and any off their cell's tier (none, unless something else sets one).

The `streamingPhysics` scene (`?startScene=streamingPhysics`) is a 12 × 12 grid of crate piles
that a plough mows through, its ground slabs, piles and jointed chains kept code content, so its
far cells' crates are `REMOVED` (purple) and their chains `STATIC`:

<<< src/app/scenes/streamingPhysics/streamingPhysics.ts#streaming-physics-pile

## The focus

The distance is measured from the main camera unless you set a focus:
[`setStreamingFocus`](api:setStreamingFocus) takes an entity (its position) or a point read on
every decision (a `Vector3` you keep moving). The cells' states are decided every
`updateIntervalFrames` frames (10).

## The debug tab

The drawer's Streaming tab shows the focus and its cell, the cells per state, the loads, unloads,
cancellations and asset releases, the primings (stalls, uploads, compiles), the fades (running,
turned around, and any shown content taken down without one), the cells' bodies by tier, the
cells' GPU memory per content (near, far, kept), the far groups and their instances, and the
budgets to try out live. Its overlay draws every tracked cell's outline in its state's colour,
and a row per cell opens its window: its state, each content's progress, owner key, GPU memory
and fade, its far groups, load and priming times, entities, assets and last transitions. To test
a place without going there, **Freeze focus** or **Teleport focus to cell** (or start with
`?streamingFocus=x,z` in the debug env).

::: dev-only Measured
`streamingGrid` on an M2, with the test bridge's fixed frame step (`?aekTest=true`): flying at 30
and 60 m/s, no frame over 33 ms on WebGPU or WebGL 2 (the main thread's longest block 5-12 ms),
and 10 s hovering across a cell boundary loaded and unloaded nothing. With the JSON content, three
flights out and back and a trip off the grid (where every cell-only asset is released) leave the
registries and entities exactly as they were, and the wall is there on exactly the frames one of
its cells is. Three flights out across the
grid and back (510 cell unloads) leave the GPU memory where it was, on both backends, and flying
with a new shader in every cell (the scene tab's "A shader per cell") misses no frame primed, where
unprimed it does. `streamingPhysics`, its plough mowing the 688 m row at 24 m/s for 3,600 steps,
in all three physics targets: no body of a `NEARBY` cell ran a step `FULL` (but chains kept
`FULL` by their `RESIDENT` half), no policy member was outside a `RESIDENT` cell, no body off its
cell's tier, 389-413 bodies moved to the cell they were in and none left behind, at most 476
bodies (no capacity refusal). With far content (rings 1 / 2 / 5), two flights out and back at 30 and 60 m/s on each backend:
764 layer loads and unloads and 1,528 fades a flight, none taken down unfaded, every far cell
drawing one instanced mesh per far group and holding no near memory, and the second flight leaving
the GPU memory, registries and entities exactly as the first, and no frame over 33 ms on either
backend once WebGL 2's newly shown objects were paced (5 frames of 33-37 ms a flight before, where
a column of cells changed level at once). `streamingPhysics` with a far ring: every
crate back from `REMOVED` exactly where it was left, chains `STATIC` far away, in all three
targets. The plan's
[Phase 1](repo:docs/plans/_DONE_p353_macro-streaming-grid.md#phase-1--cells-and-the-state-machine-code-content--done)
and Phases 2 to 5 have the numbers.
:::

## Not yet

- An `AUTO` LOD gets no far stand-in from the JSON (its levels aren't known when the scene is
  gathered): give a far unit in code, or explicit levels.
- An instanced LOD pool's instances don't fade (they share their pool's meshes): stream a pool
  whole, or keep it out of cells.
- An imported model's or a merged geometry's size isn't measured: give a big one a radius in
  `streaming.radii`.
- A cell's state isn't saved when it unloads: a crate moved in it is back where it started next
  time (it keeps its place while the cell is `FAR`).

See [the plan](repo:docs/plans/_DONE_p353_macro-streaming-grid.md).

## Key APIs

- [`streaming()`](api:streaming) and [`setSceneStreamingSettings`](api:setSceneStreamingSettings).
- [`registerStreamingCellContent`](api:registerStreamingCellContent) and
  [`unregisterStreamingCellContent`](api:unregisterStreamingCellContent).
- [`getStreamingCellKey`](api:getStreamingCellKey),
  [`getStreamingCellKeyAt`](api:getStreamingCellKeyAt) and
  [`getStreamingCellState`](api:getStreamingCellState).
- [`setStreamingFocus`](api:setStreamingFocus) and [`getStreamingFocus`](api:getStreamingFocus).

## Read more

- The API reference: [`aekasha/streaming`](hub:documentation/aekasha/streaming).

::: claude-md
:::
