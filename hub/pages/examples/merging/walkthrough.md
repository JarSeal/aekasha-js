## The scene JSON

<<< src/app/examples/merging/exampleMerging.scene.json

- The kit's geometries and materials are the scene's, so the code names them by id.
- The gate is the JSON's one mesh. Its `"merge": "AUTO"` puts it in the stone's automatic group,
  like the meshes the code makes.
- `mergeGroups` gives the named floor group its settings (the tiles take the sun's shadow and
  cast none) and sets the scene's `AUTO` cells to 16 m: the 24 m courtyard is cut into four.
- A mesh's `merge` or a `mergeGroups` list puts `merging()` in the scene's
  [feature manifest](hub:features/scenes-and-assets#the-feature-manifest), so the app's boot fails
  without it.

## The kit

<<< src/app/examples/merging/exampleMerging.ts#merging-kit

1. The floor tiles name their group, `exampleMergingFloor`. It's made on first use, with the
   scene JSON's entry for it.
2. The wall blocks are `merge: 'AUTO'`: the engine groups them by material, shadow flags and
   cell. The top course's gaps come from a seeded random, so the ruin is the same on every visit.
3. The pillars are another geometry with the same material and shadow flags, so they join the
   same groups as the walls of their cell.

That makes five groups: the floor, and the stone in each of the four cells. Nothing is merged
while the scene's code runs: the pieces join at the load's end, after the JSON's gate exists, and
the first frame already draws them merged.

## Changing what's merged

<<< src/app/examples/merging/exampleMerging.ts#merging-edit

- **The gate** is a merged member, so moving it takes two calls:
  [`setTransform`](api:ECSWorld.setTransform) moves the entity, and
  [`updateMergeMember`](api:updateMergeMember) rewrites its part of the merged mesh where it is
  now (positions and normals: it turned). Without the second call it would still be drawn shut;
  in debug mode that warns once.
- **A pillar** leaves its group with [`removeFromMergeGroup`](api:removeFromMergeGroup): it's
  drawn on its own at once, and moves like any mesh. Its triangles in the merged mesh are
  collapsed in place, without a rebuild. Each toppled pillar adds its own draws.
- **Space** dissolves every group ([`dissolveMergeGroup`](api:dissolveMergeGroup)): each piece
  is drawn on its own again. Merging them again is the same `addToMergeGroup` calls as joining
  the first time, with the gate where it is now; the toppled pillars stay on their own.

## The scene file

<<< src/app/examples/merging/exampleMerging.ts#merging-scene

The draw count is three's `renderer.info.render.drawCalls`, read in `LATE_MAIN`, right after the
frame's render. In debug mode the profiler (F8) shows the same count, and its Objects tab the
group meshes.

## Other ways in

- An imported model merges by a `merge` custom property on its nodes, or by
  `spawnImportedAsset`'s `merge` for every piece (see
  [Imported models](hub:features/mesh-merging#imported-models)).
- [`createMergeGroup`](api:createMergeGroup) makes a group with settings of its own, and
  `persistent: true` keeps it across scene switches.

The [Mesh merging](hub:features/mesh-merging) page has when to merge and what can't be, and the
app's `largeWorld` scene merges 409 ruin pieces and props into 28 groups.

Back to the [examples](hub:examples).
