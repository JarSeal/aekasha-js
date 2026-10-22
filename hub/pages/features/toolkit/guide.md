## What's in it

The toolkit is sorted by kind. Its code has three entries, `aekasha/toolkit/ecs`,
`aekasha/toolkit/geometry` and `aekasha/toolkit/materials`; its assets (the materials' and
models' JSONs) are found by id, like the app's:

```text
src/toolkit/
  ecs/                      aekasha/toolkit/ecs
    effects/                FollowTool, HoverEffect, MutualGravity, SunShadowFit
    gameplay/               FollowObjectCameraRig, movingPlatform/
  geometry/                 aekasha/toolkit/geometry
    generate/               Asteroid, Foliage, Terrain
    scatter/                ScatterOnSurface
  materials/                aekasha/toolkit/materials
    <id>/                   <id>.material.json and <id>.tsl.ts
    TriplanarProjection.ts
  models/<category>/<id>/   the model next to its *.importedAsset.json
```

A piece that grows a second file gets a folder of its own inside its kind, as the moving
platform did.

### ECS effects

In `ecs/effects/`. Each is a system you register once per world, in the app's feature in
`src/AppECSPlugins.ts` (see [ECS](hub:features/ecs#plugins-and-hooks)); a second call on the same
world does nothing. Three of them act on the entities that have their component; the gravity
keeps a list of bodies instead.

- [`registerHoverToolEffect`](api:registerHoverToolEffect): an entity with a `HOVER` component
  ([`HoverToolData`](api:HoverToolData)) bobs on a sine around `baseY`, at `speed` and
  `amplitude`. Its `time` is the phase: give entities different ones and they don't bob in step.
- [`registerFollowToolEffect`](api:registerFollowToolEffect): an entity with a `FOLLOW` component
  ([`FollowToolData`](api:FollowToolData)) moves toward another entity plus an offset, at the
  same speed at any frame rate. A follower with a target link (a directional or spot light) moves
  its target too, so the light keeps shining on the leader from the same angle.
- [`registerSunShadowFitEffect`](api:registerSunShadowFitEffect): a directional light with a
  `SUN_SHADOW_FIT` component ([`SunShadowFitData`](api:SunShadowFitData)) fits its shadow camera
  to the main camera's view every frame, out to `maxDistance`, snapped to the shadow map's
  texels so the edges don't shimmer. A light the sky box drives is skipped with a warning (it
  follows the camera on its own).
- [`registerMutualGravityEffect`](api:registerMutualGravityEffect): Newtonian gravity between the
  bodies you add with [`addGravityBody`](api:addGravityBody) (an entity and its mass), on every
  physics step, for zero-g scenes. Each pair is computed once and pushed equal and opposite, so
  the cost grows with the square of the bodies: fine for tens. The settings
  ([`setMutualGravityConfig`](api:setMutualGravityConfig)) are global; the bodies are dropped on
  every scene exit. Deterministic with physics on the main thread only.

### Gameplay

In `ecs/gameplay/`, each with a system to register once per world:

- [`createFollowObjectCameraRig`](api:createFollowObjectCameraRig): a camera that follows an
  object at an offset, smoothed, reading the pose that's drawn. It can keep its view direction
  (`orientation: 'FIXED'`) and look ahead of where the object is going (`lookAhead`), as in the
  [character example](hub:examples/character#the-camera). Give it the scene's `sceneId` and it's
  deleted when the scene exits.
- [`createMovingPlatform`](api:createMovingPlatform): a kinematic platform moving along a closed
  path of points, on every physics step, so characters ride it: the body's user data carries the
  segment's velocities, which the dynamic character reads. It plays forward forever by default;
  `opts` sets the loops, the direction and the speed, and the returned
  [`controls`](api:MovingPlatformControls) pause, play, stop and play single segments. The
  controls write the body when you call them, not in the physics step: a scene that must replay
  exactly calls them from an `APP_PHYSICS_STEP` system.

### TSL materials

In `materials/<id>/`, each a `*.material.json` with its `*.tsl.ts`, so a scene lists it by id like
any material:

- **`triplanarCheckerboard`** and **`triplanarGrid`**: a checkerboard (with an optional "+" in
  every cell) and a grid of major and minor lines (with optional grooves along them), both in
  meters and projected from the three axes, so they need no UVs. Their switches are static
  defines: `alignToObject` (the pattern turns with the mesh; off, it's in world space and runs on
  across separate meshes), `fitToBounds` (a whole number of cells across the mesh's bounds),
  `dominantAxis` (one projection per surface instead of a blend: no doubled lines on ramps, hard
  seams on curves), and the checkerboard's `plusSigns`, the grid's `minorLines` and
  `seamNormals`. They share [`triplanarProjection`](api:triplanarProjection) and its helpers.
- **`asteroid`**: a rock surface in object space: mottled colours, pits, mineral speckles, and the
  roughness and a bump from the same noise. Every input is on its `colorNode`, and a mesh gives it
  a `seed` of its own (`matOverrides: { nodes: { colorNode: { seed: 7 } } }`) for a different rock.
  The `octaves` define sets the mottling's detail.

The [material editor](hub:features/debug-suite#editor-views) edits their inputs live. Writing
one of your own is [below](hub:features/toolkit#writing-a-tsl-material).

### Procedural geometry

In `geometry/`. Every generator takes a seed (an integer) and gives the same result for it, and
returns a geometry that isn't registered: save it with `saveBufferGeometry`, or hand it to an
instanced pool, which owns it.

- [`generateTerrain`](api:generateTerrain): a noise terrain grid, with its `heights` and a
  `getHeightAt(x, z)` that gives the height of the mesh's own triangle under the point, so what you
  place with it sits on the mesh. `heights` is row-major, and a `HEIGHTFIELD` collider reads
  column-major: transpose them, or give the body a `TRIMESH` of the geometry.
- [`generateTreeGeometry`](api:generateTreeGeometry) and
  [`generateBushGeometry`](api:generateBushGeometry): low-poly foliage. A tree is one geometry
  with two material groups (`materialGroups`: the trunk's and the canopy's).
- [`scatterOnSurface`](api:scatterOnSurface): placements on a mesh's surface, each with its
  position, normal, rotation and scale in world space, kept `minSpacing` apart (it may return
  fewer than `count` then). The app hands them to an instanced pool
  ([`createInstancedMeshPool`](api:createInstancedMeshPool) or
  [`createInstancedLodPool`](api:createInstancedLodPool)'s `spawn`), as `largeWorld` does for its
  trees, bushes and rocks. For a plain `InstancedMesh`,
  [`bakeScatterToInstancedMesh`](api:bakeScatterToInstancedMesh) writes them in;
  [`spawnScatterAsMeshEntities`](api:spawnScatterAsMeshEntities) makes a mesh entity of each, for
  a few.
- [`generateAsteroid`](api:generateAsteroid): a rocky body with craters. Next to its geometry it
  returns `hullVertices` for a `CONVEXHULL` collider and `hullVolume`, the volume the physics
  engine gives that collider, so a gravity mass of density × `hullVolume` matches the simulated
  body. The `asteroid` material dresses it.

The generators draw from the engine's
[`createSeededRandom`](api:utils/SeededRandom.createSeededRandom) (on `aekasha`). The toolkit's
geometry entry still exports it, deprecated until toolkit 3.0.0: import it from `aekasha`.

### Models

By category, in `models/<category>/<id>/`. The Ækasha symbol (`brand/aekashaSymbol/`): the Æ
glyph extruded with a small bevel, a Draco GLB with its `*.importedAsset.json`, ready for a
scene's `importedAssets`.

## Writing a TSL material

A TSL material is two files: the `*.material.json` that a scene lists by id, and the `*.tsl.ts`
whose functions build its nodes. The checkerboard is a small one:

::: code-group

<<< src/toolkit/materials/triplanarCheckerboard/triplanarCheckerboard.material.json title="triplanarCheckerboard.material.json"

<<< src/toolkit/materials/triplanarCheckerboard/triplanarCheckerboard.tsl.ts title="triplanarCheckerboard.tsl.ts" collapse

:::

- **The JSON.** `type` is a node material (`STANDARDNODEMATERIAL` and the like), `tslFile` its TSL
  file (relative to `src/app/`, or to `src/toolkit/` for the toolkit's), `params` three's own
  material props, `staticDefines` its switches, and `nodes` an object per socket, keyed by the
  material's node property it sets (`colorNode`, `normalNode`, `roughnessNode`, …), holding that
  socket's inputs.
- **The sockets.** The TSL file exports a function named after each socket in `nodes`, called as
  `(inputs, material, staticDefines)` when the material is created; what it returns goes into the
  socket (`null` leaves the material's own). A socket may set others on `material` too: the
  asteroid's `colorNode` sets its `roughnessNode` and `normalNode`, so all its inputs are in one
  place. A socket the file doesn't export is skipped with a warning.
- **The inputs** arrive as nodes: a number (or a boolean) as a uniform, a `#hex` string as a colour
  uniform, `[x, y]` to `[x, y, z, w]` or `{ x, y, z }` as a vector uniform, any other string as
  the texture with that id, sampled. Each is kept as
  `material.userData.uniforms['<socket>_<input>']` (`colorNode_checkerSize`): the material editor
  changes them there, live, and another socket can read them (the grid's `normalNode` reads its
  `colorNode`'s, so its JSON lists `colorNode` first). Check the inputs a socket needs and throw naming the missing one, as the toolkit's do.
- **The static defines** are plain values, resolved when the shader is built: branch on them in
  JavaScript ([`readBooleanDefines`](api:readBooleanDefines) fills in the defaults), so only the
  used paths are in the shader. A mesh's `matOverrides.staticDefines` makes its own variant of
  the material, with its own shader; `matOverrides.nodes` changes only inputs, so its variants
  share one (see [`getMaterialVariant`](api:getMaterialVariant)).
- **Loading.** A scene load loads the TSL files of the materials it lists. Code that creates one
  outside a load awaits [`loadTslMaterialFileAsync`](api:loadTslMaterialFileAsync) first.
- **Types.** `import type { Node, NodeMaterial } from 'three/webgpu'` gives the typed
  `Node<'float'>` and the rest, which `three/tsl`'s loose `Node` doesn't.

To start from a toolkit material, copy its folder into your app, give the JSON a new `id`, fix its
`$schema` and `tslFile` paths, and import the triplanar helpers from `aekasha/toolkit/materials`
in place of `../TriplanarProjection`.

## Using it

- **Import it.** Toolkit code is imported like the engine's, and its asset JSONs are found and
  checked like the app's: a scene lists the `triplanarCheckerboard` material or the
  `aekashaSymbol` model by id.
- **Copy it.** Copy a file into your app (into the folder of the scene that uses it, or
  `src/app/shared/` when several do: see
  [where the files go](hub:features/scenes-and-assets#where-the-files-go)), rename its ids (a
  JSON's `id`, a component's key) so they don't clash with the toolkit's, change its imports from
  the toolkit's own files to its entries, and change what you need. Your copy is yours; the
  toolkit's keeps getting fixes.
- The toolkit has its own version, next to the engine's and the app's, on the
  [Version](hub:version) page.

## See it

- The [toolkit example](hub:examples/toolkit): the model, two materials and `HoverEffect`.
- The app's `space` scene: toolkit asteroids under `MutualGravity`, at zero world gravity. Open it
  with `?isDebug=true&startScene=space`.
- The app's `largeWorld` scene: a generated terrain with scattered trees, bushes and rocks;
  `thirdPersonGymScene`: moving platforms and the follow camera.

## Read more

- The API reference: [`aekasha/toolkit`](hub:documentation/aekasha/toolkit), an entry per category.
