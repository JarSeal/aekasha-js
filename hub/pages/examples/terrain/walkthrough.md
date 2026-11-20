## The block

<<< src/app/examples/terrain/exampleTerrainBlock.terrainBlock.json

- `geometry.generator` names a block generator. The toolkit's `noiseTerrain` and `rulesTerrain`
  are registered by the app's install (`registerTerrainGenerators()` in `src/AppECSPlugins.ts`);
  their code loads with the first block that uses one, and runs on a worker.
- The heights are seeded simplex noise, `octaves` its `[frequency, amplitude]` pairs, scaled to
  `maxHeight`. The noise is the world's, sampled at the block's place (`grid`), so a neighbour
  with the same seed continues it.
- `rules` lay the material's layers into the vertex colours, on the CPU, once: layer 1 past 32°,
  layer 2 above 7 m where it's gentler than 35°, layer 3 past 45°; layer 0 is what no rule
  covers. `RGB_AO` keeps A for the horizon AO (`ao`), which darkens the valleys.
- `collider: HEIGHTFIELD` gives the block a fixed Rapier body of its own heights: the balls roll
  on it.
- `scatter` names the rocks below; `material` the ground's.

## The material and the rocks

<<< src/app/examples/terrain/exampleTerrainGround.material.json

The toolkit's terrain material through its JSON route: four texture sets as its layers (each a
`layer<i>` input), weighed by the block's vertex colours with the height blend, the vertex AO,
`DUAL_SCALE` anti-tiling, the macro variation, and the cliff layer projected triplanar on faces
steeper than the 35–50° gate. An app material JSON names a TSL file of its own, two lines:

<<< src/app/examples/terrain/exampleTerrainGround.tsl.ts

<<< src/app/examples/terrain/exampleTerrainRocks.scatter.json

The toolkit's `terrainScatter` places rocks by the block's own paint: Poisson-disk points over
the block, kept where layer 1 (the scree) weighs and the slope is under 42°, so none sit on the
cliffs. The items are the toolkit's procedural rocks, drawn as instances in cells, in
`exampleTerrainRock`: the toolkit's rock material over the scree's set.

## The scene

The scene JSON lists the block; the gather adds its material, texture sets, scatter and their
assets, so they're loaded before the scene file runs:

<<< src/app/examples/terrain/exampleTerrain.scene.json

<<< src/app/examples/terrain/exampleTerrain.ts#terrain-scene

- `saveRockGeometries` registers the toolkit's rocks under the ids the scatter names.
- `spawnTerrainBlock` makes the mesh, the material, the collider and the scatter. It's async (the
  generator runs on a worker), and the scene's load holds physics until the collider exists, so
  the balls drop alike on every visit. It returns `null` when the scene was left meanwhile.

<<< src/app/examples/terrain/exampleTerrain.ts#terrain-balls

A ball is the [physics example](hub:examples/physics)'s pattern: a mesh entity and a dynamic body
attached to it. A ball that rolls off the block's edge falls away; the oldest is deleted past 40.

## Try it

- Change the block's `seed` or `maxHeight`: another landscape, painted by the same rules.
- Move the snow rule's `height.min`, or add a `noise` to a rule to break its edge (it reads the
  macro texture: the [procedural rules](repo:docs/techniques/terrain-procedural-rules.md) page).
- Debug mode's [terrain debug views](hub:features/terrain#debugging) show the weights, the taps
  and the texel density.

Back to the [examples](hub:examples).
