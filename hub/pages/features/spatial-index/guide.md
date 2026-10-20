## Installing it

List [`spatial()`](api:spatial), from `aekasha/spatial`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)): the index and the light
culling that queries it. Without it, nothing is indexed and no light is culled by its
contribution, and a scene whose JSON has `spatialDomains` fails the boot, naming the feature (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

## Domains

Each ECS world holds named domains, each its own grid with its own cell size, capacity and
update policy. An entity can be in several.

- **`DEFAULT`** ([`DEFAULT_SPATIAL_DOMAIN`](api:DEFAULT_SPATIAL_DOMAIN)) is the engine's. Meshes and point and spot lights join it by default (a mesh
  created with `spatialIndex: false` doesn't), and the engine culls lights with it. Its grid is
  built per scene, only once something is in it.
- **Your own** domains hold what your game asks about:

```ts
const world = getECSWorld();
registerSpatialDomain(world, {
  id: 'pickups',
  cellSize: 10, // About the size of a typical query
  maxMembers: 512,
  update: 'STATIC', // Rebuilt only when a member joins or leaves
  sceneId: 'myScene', // These settings end with the scene
});
joinSpatialDomain(pickupId, 'pickups', world);
```

## Queries

A query returns candidates, not results: every member whose cell the sphere or box touches. Test
the real distance yourself. Nothing is allocated, so a query is safe in a hot loop:

```ts
const candidates = new Uint32Array(64); // Allocated once, reused every frame
const grid = getSpatialDomain(world, 'pickups');
const count = grid ? grid.queryInto(playerPosition, 3, candidates) : 0;
for (let i = 0; i < Math.min(count, candidates.length); i++) {
  const entityId = candidates[i];
  // …the exact test, then the pickup
}
```

`queryVisit` calls a function per candidate instead, which returns `true` to stop (enough for "is
anything there?"), and `queryAABBInto` / `queryAABBVisit` take a box. A member whose radius is over twice the cell size (`oversizedRadiusMultiplier`) goes into
an oversized tier that every query checks, so one huge object doesn't slow the grid down.

## Keeping it current

| Update policy | The grid is rebuilt                                         | For                   |
| ------------- | ----------------------------------------------------------- | --------------------- |
| `DYNAMIC`     | Every frame, with fresh positions.                          | Things that move.     |
| `STATIC`      | In a frame where a member joined or left.                   | Things that stay put. |
| `MANUAL`      | Only on [`rebuildSpatialDomain`](api:rebuildSpatialDomain). | You decide when.      |

The rebuild runs at `APP_POST_PHYSICS`, so it sees this frame's physics poses. A member that
leaves a domain (or is deleted) is gone from its queries at once; one that joins or moves is
found at its new place after the next rebuild. So a `MANUAL` domain is rebuilt before it's
queried.
[`invalidateSpatialDomain`](api:invalidateSpatialDomain) refreshes a `STATIC` domain whose
members moved: a large domain whose members rarely move is cheaper `STATIC` and invalidated than
`DYNAMIC` (see [Known issues](#known-issues)). A member's radius comes from its component (a mesh's geometry, a light's range),
scaled by its transform; [`refreshSpatialRadius`](api:refreshSpatialRadius) reads it again after
a geometry change, and [`registerSpatialRadiusProvider`](api:registerSpatialRadiusProvider) gives
your own components one.

## Scene settings

Registered with a `sceneId`, a domain's settings are that scene's: they replace the domain's
world settings until the scene exits, and then the domain goes back to them, or is removed if it
had none. A scene's JSON can do the same with `spatialDomains`; `largeWorld` widens the default
grid's cells:

```json
{ "spatialDomains": [{ "id": "DEFAULT", "cellSize": 24 }] }
```

Instanced pool instances can join a domain too (the pool's `spatialDomain` option): see
[LOD and impostors](hub:features/lod#many-instances). Give them a domain of their own: in
`DEFAULT` they never count as a light's receivers (see [Known issues](#known-issues)).

## The debug tab

The drawer's Spatial index tab works per domain: its cells and members drawn over the scene, the
rebuild times, a cell size to try out (kept for the world or for one scene), and a brute-force
check that compares every query with a full scan. The engine's light culling is checked that
way; call [`validateSpatialGridQuery`](api:validateSpatialGridQuery) after a query of your own to
have it checked too (it does nothing unless the check is on).

## Known issues

- [Pool instances in `DEFAULT` never count as light receivers](hub:issues/pool-instances-not-light-receivers):
  a light whose only receivers nearby are pool instances is culled.
- [A large `DYNAMIC` domain costs about 0.2 µs per member every frame](hub:issues/spatial-refresh-and-rebuild-cost),
  even when nothing moved.

## Key APIs

- [`registerSpatialDomain`](api:registerSpatialDomain) and
  [`unregisterSpatialDomain`](api:unregisterSpatialDomain).
- [`joinSpatialDomain`](api:joinSpatialDomain), [`leaveSpatialDomain`](api:leaveSpatialDomain)
  and [`isInSpatialDomain`](api:isInSpatialDomain).
- [`invalidateSpatialDomain`](api:invalidateSpatialDomain) and
  [`rebuildSpatialDomain`](api:rebuildSpatialDomain).
- [`getSpatialDomain`](api:getSpatialDomain) and [`getSpatialGrid`](api:getSpatialGrid) (the
  `DEFAULT` grid, built if needed).
- [`SpatialGrid.queryInto`](api:SpatialGrid.queryInto) and
  [`SpatialGrid.queryVisit`](api:SpatialGrid.queryVisit).

## Read more

- The API reference: [Spatial](hub:documentation/engine/features/spatial).

::: claude-md
:::
