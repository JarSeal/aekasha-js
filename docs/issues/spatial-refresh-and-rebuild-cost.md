**Title:** A large `DYNAMIC` spatial domain costs ~0.2 µs per member every frame, even when nothing moved

Status: open | measured in p616 Phase 2, not changed
Category: Spatial, Performance
Found: 2026-10-20, p616 Phase 2 (D10's S2, measured)
Our workaround: make a large domain whose members rarely move `STATIC`, and call `invalidateSpatialDomain` after moving them (largeWorld's `FOLIAGE` does: it costs nothing in steady state)

## What happens

Every frame, `spatialIndexRebuildSystem` (`features/spatial/SpatialIndexSystem.ts`) does two things
to each `DYNAMIC` domain, and to an invalidated domain of any policy:

1. **The refresh** (`refreshDomainMembers`): each member's position and scaled radius read from its
   `Transform` into the grid.
2. **The rebuild** (`SpatialGrid.rebuild()`): the cells built again from scratch. That means a cell
   key and a `cellKeyToIndex` Map lookup or insert per member, then three counting passes.

Both run whether or not anything moved. p616's S2 took two of the refresh's four lookups per member
out (the TRANSFORM storage read once, the grid written by slot) and saved about 25 µs of ~345 µs.
The split, measured after it (largeWorld with its 1,500-member `FOLIAGE` invalidated every frame,
debug env, WebGL2 through SwiftShader, 300 frames, `lastRebuildMs` averaged per frame, three page
loads):

| Run | Whole system | `FOLIAGE` rebuild | `DEFAULT` rebuild (26 members) | Refresh and the rest |
| --- | ---: | ---: | ---: | ---: |
| 1 | 305 µs | 115 µs | 17.5 µs | ~172 µs |
| 2 | 349 µs | 158 µs | 17.3 µs | ~174 µs |
| 3 | 300 µs | 113 µs | 16.2 µs | ~171 µs |

"The rest" is the policy checks and the debug stats; the oracle was off. So the refresh is about
110 ns per member and the rebuild about 75-100 ns. Nothing in the template pays this today: the
real largeWorld's whole system costs 28-30 µs a frame (`DEFAULT` only).

## Why p616 left it

Both ways out below change the grid's data model, which is more than a review plan's perf step,
and no template scene needs them.

## A way out

- **Skip an unneeded rebuild.** When no member joined or left since the last rebuild, and none
  changed cell or tier, the cells are still right: queries read positions from the slot arrays,
  not the cells. The refresh can compare each member's new cell key with `lastCell` (the key the
  last rebuild stored per slot, which `removeMember` already keeps) and the domain rebuilds only
  on a difference. `maxIndexedRadius` would then be exact only after a real rebuild. It may
  overestimate in between, which `addMember` and `updateRadius` already allow. This saves the rebuild
  (up to ~115 µs above) in a frame where nothing crossed a cell, and costs the key computation in
  one where something did. Check against the oracle (`setSpatialGridOracleEnabled`).
- **The local radius per slot.** `localRadius` is a Map on the domain (one lookup per member per
  refresh). Kept in the grid as a per-slot array moved by the swap-remove, it's an array read.
  Estimated at a third of the refresh, not measured.
- Both keep the TRANSFORM `get` per member, which `MAP` storage mode can't avoid. (`TYPED_ARRAY`
  mode already reads the store's arrays by slot, since p616's P7.)

Either is an engine minor: no API change, the same query results.
