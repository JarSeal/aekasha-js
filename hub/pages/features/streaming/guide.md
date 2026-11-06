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
every cell a terrain block, made and deleted with its own geometry, and two sets of props:

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
- **The cells around the focus are part of the scene load.** They load before the scene is
  entered, all at once and awaited, inside the physics hold, so a scene starts the same on every
  visit. Only the cells reached during play stream in over frames.

## The focus

The distance is measured from the main camera unless you set a focus:
[`setStreamingFocus`](api:setStreamingFocus) takes an entity (its position) or a point read on
every decision (a `Vector3` you keep moving). The cells' states are decided every
`updateIntervalFrames` frames (10).

## The debug tab

The drawer's Streaming tab shows the focus and its cell, the cells per state, the loads, unloads
and cancellations, and the budgets to try out live. Its overlay draws every tracked cell's outline
in its state's colour, and a row per cell opens its window: its state, load time, entities and
last transitions. To test a place without going there, **Freeze focus** or **Teleport focus to
cell** (or start with `?streamingFocus=x,z` in the debug env).

::: dev-only Measured
`streamingGrid` on an M2, with the test bridge's fixed frame step (`?aekTest=true`): flying at 30
and 60 m/s, no frame over 33 ms on WebGPU or WebGL 2 (the main thread's longest block 5-12 ms),
and 10 s hovering across a cell boundary loaded and unloaded nothing. The plan's
[Phase 1](repo:docs/plans/p353_macro-streaming-grid.md#phase-1--cells-and-the-state-machine-code-content--done)
has the numbers.
:::

## Not yet

World streaming is being built in phases. Cells don't release their assets on their own yet (a
cell's `unload` frees what it made, as the test scene's terrain does), nothing is primed before
it's first drawn, `FAR` cells show nothing, scene JSON objects aren't assigned to cells, and
physics bodies keep their own tiers (see
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
