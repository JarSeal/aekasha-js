## What's in it

The toolkit is sorted by kind. Its code has three entries, `aekasha/toolkit/ecs`,
`aekasha/toolkit/geometry` and `aekasha/toolkit/materials`; its assets (the materials' and
models' JSONs) are found by id, like the app's:

```text
src/toolkit/
  ecs/                      aekasha/toolkit/ecs
    effects/                FollowTool, HoverEffect, MutualGravity, SunShadowFit
    gameplay/               FollowObjectCameraRig, MovingPlatform
  geometry/                 aekasha/toolkit/geometry
    generate/               Asteroid, Foliage, Terrain
    scatter/                ScatterOnSurface
    SeededRandom.ts
  materials/                aekasha/toolkit/materials
    <id>/                   <id>.material.json and <id>.tsl.ts
    TriplanarProjection.ts
  models/<category>/<id>/   the model next to its *.importedAsset.json
```

A piece that grows a second file gets a folder of its own inside its kind.

### ECS effects

In `ecs/effects/`, a component and its system each, registered by the app's feature in
`src/AppECSPlugins.ts` (see [ECS](hub:features/ecs#plugins-and-hooks)):

- **`HoverEffect`**: bobs an entity up and down (the `HOVER` component).
- **`FollowTool`**: makes an entity follow a target.
- **`SunShadowFit`**: fits a directional light's shadow camera to the main camera's view, so
  shadows stay sharp wherever the camera looks.
- **`MutualGravity`**: Newtonian gravity between the bodies you add with
  [`addGravityBody`](api:addGravityBody), on every physics step, for zero-g scenes.

### Gameplay

In `ecs/gameplay/`, each with a system to register once per world:

- [`createFollowObjectCameraRig`](api:createFollowObjectCameraRig): a camera that follows a
  mesh at an offset, smoothed, reading the pose that's drawn. It can keep its view direction
  (`orientation: 'FIXED'`) and look ahead of where the mesh is going (`lookAhead`), as in the
  [character example](hub:examples/character#the-camera).
- [`createMovingPlatform`](api:createMovingPlatform): a kinematic platform moving along a path
  of points, on every physics step, so characters ride it.

### TSL materials

In `materials/<id>/`, each a `*.material.json` with its `*.tsl.ts`, so a scene lists it by id
like any material: `triplanarCheckerboard`, `triplanarGrid` (both projected from the three axes,
in world or object space, so they need no UVs) and `asteroid`. Their node inputs (colours,
scales) are params in the JSON, which the material editor edits live. The triplanar ones share
[`triplanarProjection`](api:triplanarProjection).

### Procedural geometry

In `geometry/`:

- [`generateTerrain`](api:generateTerrain): a seeded noise terrain, with its height samples and
  a `getHeightAt(x, z)` for placing things on it.
- [`generateTreeGeometry`](api:generateTreeGeometry) and
  [`generateBushGeometry`](api:generateBushGeometry): low-poly foliage.
- [`scatterOnSurface`](api:scatterOnSurface): placements on a mesh's surface, baked into an
  instanced mesh ([`bakeScatterToInstancedMesh`](api:bakeScatterToInstancedMesh)) or spawned as
  entities ([`spawnScatterAsMeshEntities`](api:spawnScatterAsMeshEntities)).
- [`generateAsteroid`](api:generateAsteroid): a rocky body from a seed.
- [`createSeededRandom`](api:createSeededRandom): the seeded random numbers they all use, so the
  same seed gives the same world.

### Models

By category, in `models/<category>/<id>/`. The Ækasha symbol (`brand/aekashaSymbol/`): the Æ
glyph extruded with a small bevel, a Draco GLB with its `*.importedAsset.json`, ready for a
scene's `importedAssets`.

## Using it

- **Import it.** Toolkit code is imported like the engine's, and its asset JSONs are found and
  checked like the app's: a scene lists the `triplanarCheckerboard` material or the `aekashaSymbol` model
  by id.
- **Copy it.** Copy a file into your app (into the folder of the scene that uses it, or
  `src/app/shared/` when several do: see
  [where the files go](hub:features/scenes-and-assets#where-the-files-go)), rename its ids (a
  JSON's `id`, a component's key) so they don't clash with the toolkit's, and change what you
  need. Your copy is yours; the toolkit's keeps getting fixes.
- The toolkit has its own version, next to the engine's and the app's, on the
  [Version](hub:version) page.

## See it

- The [toolkit example](hub:examples/toolkit): the model, two materials and `HoverEffect`.
- The app's `space` scene: toolkit asteroids under `MutualGravity`, at zero world gravity. Open it
  with `?isDebug=true&startScene=space`.

## Read more

- The API reference: [`aekasha/toolkit`](hub:documentation/aekasha/toolkit), an entry per category.
