## Installing it

List [`streaming()`](api:streaming), from `aekasha/streaming`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)). Without it, the streaming
functions throw, and a scene whose JSON has `streaming` fails the boot, naming the feature (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

## Cells and rings

A scene streams once it has a cell size, in its JSON or from code
([`setSceneStreamingSettings`](api:setSceneStreamingSettings), over the JSON's):

```json
{ "streaming": { "cellSize": 64, "rings": { "resident": 1, "nearby": 2, "far": 4 } } }
```

Cells are squares on x and z (height doesn't count), `cellSize` metres wide: a power of two of at
least 32, so terrain blocks of 32 to 256 m tile them exactly. Each ring is a state's outermost
ring of cells around the focus's cell:

| State      | Default ring | What the cell has                                              |
| ---------- | ------------ | -------------------------------------------------------------- |
| `RESIDENT` | 0–1          | Everything.                                                    |
| `NEARBY`   | 2            | Everything, loaded a ring ahead of being seen up close.        |
| `FAR`      | 3–5          | Nothing yet: far stand-ins (impostors, coarse levels) to come. |
| `UNLOADED` | beyond       | Nothing.                                                       |

A cell moves to a nearer state as soon as the focus comes within its ring, but back only once the
focus is `margin` metres past it (a quarter of a cell by default), measured to the cell's edge: a
player standing on a boundary doesn't load and unload the cells beside it every step.

## Cell content

What a cell holds is code you register per cell: `load` creates it and returns the entities it
made, and `unload` takes it down (by default the entities are deleted). The test scene gives
every cell a terrain block with its own geometry, and two sets of props on shared ones:

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
- **The cells around the focus are part of the scene load.** They load before the scene is
  entered, all at once and awaited, inside the physics hold, so a scene starts the same on every
  visit. Only the cells reached during play stream in over frames.

## Priming

A cell reached during play is never drawn before it's ready. Its content is created hidden, then
primed: its textures upload a few a frame (`AppConfig.streaming.maxPrimeMsPerFrame`, 2 ms), the
shaders of materials it's the first to show compile in one go, and then it appears. The meshes of
materials drawn before show at once; each new material's take a frame, one at a time on WebGL 2
(`maxNewStructuresPerFrame`: a new shader still costs WebGL 2 about 10 ms of GPU time when first
drawn, even compiled) and eight on WebGPU. Without it, a new shader drawn cold stalls a frame for
100 to 500 ms, and several at once for seconds.

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

## The focus

The distance is measured from the main camera unless you set a focus:
[`setStreamingFocus`](api:setStreamingFocus) takes an entity (its position) or a point read on
every decision (a `Vector3` you keep moving). The cells' states are decided every
`updateIntervalFrames` frames (10).

## The debug tab

The drawer's Streaming tab shows the focus and its cell, the cells per state, the loads, unloads,
cancellations and asset releases, the primings (stalls, uploads, compiles), the cells' GPU memory,
and the budgets to try out live. Its
overlay draws every tracked cell's outline in its state's colour, and a row per cell opens its
window: its state, load and priming times, entities, GPU memory, assets and last transitions. To test a place without going there, **Freeze focus** or **Teleport focus to
cell** (or start with `?streamingFocus=x,z` in the debug env).

::: dev-only Measured
`streamingGrid` on an M2, with the test bridge's fixed frame step (`?aekTest=true`): flying at 30
and 60 m/s, no frame over 33 ms on WebGPU or WebGL 2 (the main thread's longest block 5-12 ms),
and 10 s hovering across a cell boundary loaded and unloaded nothing. Three flights out across the
grid and back (510 cell unloads) leave the GPU memory where it was, on both backends, and flying
with a new shader in every cell (the scene tab's "A shader per cell") misses no frame primed, where
unprimed it does. The plan's
[Phase 1](repo:docs/plans/p353_macro-streaming-grid.md#phase-1--cells-and-the-state-machine-code-content--done)
and Phase 2 have the numbers.
:::

## Not yet

World streaming is being built in phases. `FAR` cells show nothing, scene JSON objects aren't
assigned to cells, and physics bodies keep their own tiers (see
[the plan](repo:docs/plans/p353_macro-streaming-grid.md)).

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
