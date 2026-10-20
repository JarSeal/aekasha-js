## Installing it

List [`lines()`](api:lines), from `aekasha/lines`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)). Without it, `createLines`
throws, naming the feature, and the debugger's drawing that uses lines (ray helpers, collider
wireframes, the LOD and spatial overlays, the character gizmos) is off, with one log line each.

## A line built once

```ts
import { box3EdgesToSegments, createLines, polylineToSegments } from 'aekasha/lines';

// A box outline, attached to the root scene
const outline = createLines({ segments: box3EdgesToSegments(box), color: 0x00ffff });

// A closed ring, 2px wide, pulsing between two colours
const ring = createLines({
  segments: polylineToSegments(ringPoints, true),
  width: 2,
  colorStyle: { type: 'PULSE', colors: [0xffcc00, 0xff4400], speed: 0.5 },
});
```

- `segments` is a flat `xyzxyz` list, six numbers a segment. The `*ToSegments` builders make one
  from a box, a polyline or a geometry's edges.
- [`createLines`](api:createLines) returns a [`LineObject`](api:LineObject): a plain handle, in
  no ECS world. `setSegments`, `setColor`, `setColorStyle`, `setWidth`, `setVisible`,
  `setLocalTransform` and `attach` change it, and `dispose()` removes it.
- A pulse runs on the main loop's time, not the wall clock: it follows the play speed.
  `autoPhase` puts many lines out of step. Changing colours is a uniform write; switching between
  a static colour and a pulse rebuilds the line's pipeline.

## A line refilled every frame

```ts
import { BOX_EDGE_SEGMENT_COUNT, createLines, writeBoxEdges } from 'aekasha/lines';

// Up to 32 trigger boxes, outlined again every frame
const outlines = createLines({ capacity: 32 * BOX_EDGE_SEGMENT_COUNT, growth: 'FIXED' });

// In a system, every frame
const w = outlines.beginWrite();
for (const t of triggers) writeBoxEdges(w, t.center, t.size, t.quaternion);
outlines.endWrite();
```

- `beginWrite()` returns the line's own [`LineWriter`](api:LineWriter) at the buffer's start, and
  `endWrite()` uploads exactly what was written: nothing is allocated, and no GPU buffer is made
  again.
- The `write*` builders ([`writeBoxEdges`](api:writeBoxEdges),
  [`writePolyline`](api:writePolyline), [`writeBox3Edges`](api:writeBox3Edges)) append to a
  writer, and [`BOX_EDGE_SEGMENT_COUNT`](api:BOX_EDGE_SEGMENT_COUNT) and
  [`polylineSegmentCount`](api:polylineSegmentCount) size the capacity. The writer's own
  `segment`, `vec` and `raw` append anything else.
- `growth: 'FIXED'` drops what doesn't fit, with one warning, so a refill never reallocates in
  the middle of a game. The default, `'GROW'`, doubles the buffer.
- A line's bounds are computed once, on its first commit, and lines aren't frustum-culled by
  default. A refilled line that should be culled sets both `frustumCulled` and
  `recomputeBounds`.

## Width and dashes

- A line 1px wide is three's `LineSegments`, the cheapest for very many segments. A wider one is
  drawn as screen-space quads by the thick-line backend, which is its own chunk: an app that only
  draws 1px lines never downloads it.
- Until that chunk has loaded, a wide line draws 1px and then upgrades itself. Await
  [`preloadFatLineBackend`](api:preloadFatLineBackend) before creating it when the width must be
  right on the first frame.
- The upgrade, or a `setWidth` across 1px, replaces the line's `object3D` (in the same place, with
  its children). Read `line.object3D` each time; never keep it.
- `dash: { dashPx, gapPx }` makes a line dashable, in screen pixels, and only the thick backend
  draws dashes: pin `backend: 'FAT'` with it. `setDash` changes the pattern later, and a gap of 0
  draws it solid.

## Lines and entities

- [`createLineEntity`](api:createLineEntity) makes the line an entity: its object is the entity's
  `OBJECT3D`, the ECS transform places it, deleting the entity disposes the line, and disposing
  the line deletes the entity.
- [`bindLineToEntity`](api:bindLineToEntity) ties an existing line's lifetime to an entity: the
  line goes when the entity does. `attach({ to: 'ENTITY', entityId })` only parents the line to
  the entity's object; use both for a line that follows an entity and goes with it.
- [`getLineForEntity`](api:getLineForEntity) returns an entity's line.

## Scene changes

A scene exit disposes every line that isn't `persistent` or tied to an entity, which goes with
its entity. A line made by scene code needs no cleanup of its own.

The app's `physicsTiers` scene draws its tier rings with lines attached to the plough they move
with: open it with `?isDebug=true&startScene=physicsTiers`.

## Key APIs

- [`lines`](api:lines), [`createLines`](api:createLines), [`getLine`](api:getLine) and
  [`LineObject`](api:LineObject), with [`LineProps`](api:LineProps).
- [`LineWriter`](api:LineWriter), the `write*` and `*ToSegments` builders, and
  [`preloadFatLineBackend`](api:preloadFatLineBackend) /
  [`isFatLineBackendAvailable`](api:isFatLineBackendAvailable).
- [`createLineEntity`](api:createLineEntity), [`bindLineToEntity`](api:bindLineToEntity) and
  [`getLineForEntity`](api:getLineForEntity).

## Read more

- The API reference: [Lines](hub:documentation/engine/features/lines/Lines),
  [LineObject](hub:documentation/engine/features/lines/LineObject) and
  [LineBuilders](hub:documentation/engine/features/lines/LineBuilders).

::: claude-md
:::
